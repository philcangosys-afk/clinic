-- ---------------------------------------------------------------------------
-- 0070_reminder_schedule_headers_fix.sql — إصلاح ترويسات نداء دالة الحافة
-- ---------------------------------------------------------------------------
-- **عطل في 0060 أكتشفه هنا وأصلحه:** الجدولة كانت ترسل ترويسة
-- `Authorization` وحدها، بينما دالة الحافة `appointment-reminders` تفحص
-- ترويسة **`x-cron-secret`** قبل أي عمل:
--
--     if (CRON_SECRET && request.headers.get("x-cron-secret") !== CRON_SECRET)
--       return 401
--
-- فكل نداء مجدول كان سيُرفض بـ401، وتبقى الرسائل معلَّقة إلى الأبد — بلا خطأ
-- ظاهر في القاعدة، لأن `net.http_post` لا يُخطئ حين يردّ الخادم 401. عطل
-- صامت تمامًا: الجدولة تعمل، والدالة ترفض، ولا أحد يعلم.
--
-- ولهذا وُضع منظور `v_reminder_pipeline_health` في 0060: هو ما كان سيكشفه
-- (رسائل معلَّقة تتراكم بلا إرسال ناجح).
--
-- الترويستان معًا مطلوبتان:
--   • `Authorization: Bearer <service_role>` — لأن دوال الحافة تتحقق من JWT
--     افتراضيًا قبل أن يصل الطلب إلى شيفرتك.
--   • `x-cron-secret` — الحارس الخاص بالدالة، حتى لا يكفي تسريب مفتاح
--     الخدمة وحده لإغراق المرضى برسائل.
-- ---------------------------------------------------------------------------

begin;

create or replace function app_setup_reminder_schedules(
  p_functions_base_url text,
  p_secret_name        text default 'reminders_service_key',
  p_enqueue_cron       text default '*/5 * * * *',
  p_dispatch_cron      text default '*/1 * * * *',
  p_cron_secret_name   text default 'reminders_cron_secret'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_out text;
begin
  if auth.uid() is not null and not exists (
       select 1 from organization_memberships m
        where m.user_id = auth.uid()
          and m.is_active
          and m.role_key in ('owner', 'organization_admin')
     ) then
    raise exception 'إعداد الجدولة من صلاحية مالك المنشأة أو مديرها';
  end if;

  if coalesce(btrim(p_functions_base_url), '') = '' then
    raise exception 'مرِّر عنوان دوال المشروع، مثال: https://<project-ref>.supabase.co/functions/v1';
  end if;
  v_url := rtrim(btrim(p_functions_base_url), '/') || '/appointment-reminders';

  begin
    perform cron.unschedule('reminders_enqueue');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('reminders_dispatch');
  exception when others then null;
  end;

  perform cron.schedule(
    'reminders_enqueue',
    p_enqueue_cron,
    'select app_process_due_appointment_reminders();'
  );

  -- الأسرار تُقرأ من Vault **باسمها لحظة التنفيذ**، ولا تُكتب في نص الوظيفة:
  -- ما يُكتب في `cron.job` يقرؤه كل من يطالع الجدول، ويبقى في كل نسخة
  -- احتياطية إلى الأبد.
  perform cron.schedule(
    'reminders_dispatch',
    p_dispatch_cron,
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
             (select decrypted_secret from vault.decrypted_secrets where name = %L), ''),
          'x-cron-secret', coalesce(
             (select decrypted_secret from vault.decrypted_secrets where name = %L), '')
        ),
        body := '{}'::jsonb
      );$cmd$,
      v_url, p_secret_name, p_cron_secret_name
    )
  );

  v_out := format('تمت الجدولة على %s — التجهيز %s، التسليم %s. الأسرار المطلوبة في Vault: %s و%s',
                  v_url, p_enqueue_cron, p_dispatch_cron, p_secret_name, p_cron_secret_name);
  raise notice '%', v_out;
  return v_out;
end;
$$;

comment on function app_setup_reminder_schedules(text, text, text, text, text) is
  'تُنشئ وظيفتَي pg_cron لخط التذكيرات وترسل ترويستَي Authorization وx-cron-secret معًا. الأسرار تُقرأ من Vault بأسمائها لحظة التنفيذ ولا تُخزَّن في الجدولة.';

-- التوقيع تغيّر (معامل خامس)، فالنسخة القديمة تُسقَط حتى لا يصير النداء
-- ملتبسًا بين دالتين — وهو ما يجعل القاعدة ترفض الاثنتين.
drop function if exists app_setup_reminder_schedules(text, text, text, text);

revoke all on function app_setup_reminder_schedules(text, text, text, text, text) from public, anon;
grant execute on function app_setup_reminder_schedules(text, text, text, text, text) to authenticated;

commit;
