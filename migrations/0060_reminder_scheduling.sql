-- ---------------------------------------------------------------------------
-- 0060_reminder_scheduling.sql — تشغيل خط التذكيرات فعليًا
-- ---------------------------------------------------------------------------
-- 0054 بنى **خط التسليم** كاملًا: جدول وظائف التذكير، حالات الرسالة، عدّاد
-- المحاولات، التراجع الأُسّي، الإلغاء عند تغيّر الموعد، ودوال التأكيد والفشل.
-- وكُتبت دالة الحافة `appointment-reminders`.
--
-- وكل ذلك **لا يعمل**، لأن لا شيء يستدعيه:
--
--     pg_cron_installed   = false
--     Edge Functions      = 0 منشورة
--
-- أي أن التذكيرات تُنشأ في القاعدة ثم تبقى معلَّقة إلى الأبد. وهذا أسوأ من
-- غياب الميزة: الشاشة تقول «تذكير مجدول» فيطمئن الموظف ولا يتصل بالمريض،
-- والرسالة لا تُرسَل أبدًا.
--
-- هذا الملف يُنشئ الجدولة. وهو **الخطوة الأولى من ثلاث** — الاثنتان
-- الأخريان خارج SQL وموصوفتان في آخر الملف.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) الامتدادات
--
-- تُنشأ داخل كتلة تلتقط الخطأ: قاعدة اختبار محلية أو نسخة بلا هذين
-- الامتدادين يجب أن تُكمل بقية الهجرة لا أن تتوقف عندها. غيابهما يمنع
-- الجدولة وحدها، ولا يمنع أي شيء آخر في هذا الملف.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'pg_cron غير متاح هنا (%). فعّله من: Supabase → Database → Extensions', sqlerrm;
end $$;

do $$
begin
  execute 'create extension if not exists pg_net';
exception when others then
  raise notice 'pg_net غير متاح هنا (%). فعّله من: Supabase → Database → Extensions', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 2) دالة الإعداد
--
-- **المفتاح لا يُكتب في هذا الملف ولا يمرّ به.** يُخزَّن في Vault من لوحة
-- Supabase، ولا تحمل الجدولة إلا **اسمه**؛ فيُقرأ لحظة التنفيذ. لو كُتب
-- المفتاح في نص الوظيفة لصار مقروءًا لكل من يطالع `cron.job`، ولبقي في
-- ملفات الهجرة وفي مستودع git إلى الأبد.
--
-- وظيفتان لا واحدة، لأنهما عملان مختلفان:
--
--   • `reminders_enqueue` — SQL خالص داخل القاعدة، يحوّل المواعيد القادمة
--     إلى رسائل معلَّقة. لا يحتاج شبكة، فيُجدوَل مباشرةً.
--
--   • `reminders_dispatch` — نداء HTTP لدالة الحافة التي تُسلّم للمزوّد.
--     فُصل عن الأول عمدًا: انقطاع مزوّد الرسائل يجب ألا يمنع تسجيل التذكير
--     المستحق في القاعدة. الرسائل تتراكم معلَّقة، وتُرسَل حين يعود المزوّد،
--     بلا فقدان.
-- ---------------------------------------------------------------------------
create or replace function app_setup_reminder_schedules(
  p_functions_base_url text,
  p_secret_name        text default 'reminders_service_key',
  p_enqueue_cron       text default '*/5 * * * *',
  p_dispatch_cron      text default '*/1 * * * *'
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
  -- الجدولة إعداد على مستوى المشروع لا المنشأة، فلا يصحّ ربطها بمنشأة بعينها.
  -- تُشغَّل عادةً من محرّر SQL حيث `auth.uid()` فارغ (دور القاعدة نفسه)؛ وإن
  -- استُدعيت من مستخدم مسجَّل فلا بد أن يكون مالكًا أو مديرًا في مكان ما.
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

  -- إزالة أي جدولة سابقة بنفس الاسم: `cron.schedule` يُحدِّث الموجود، لكن
  -- الإزالة الصريحة تجعل إعادة التشغيل بعنوان مختلف تعمل بلا لبس.
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

  perform cron.schedule(
    'reminders_dispatch',
    p_dispatch_cron,
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret
                                           from vault.decrypted_secrets
                                          where name = %L)
        ),
        body := '{}'::jsonb
      );$cmd$,
      v_url, p_secret_name
    )
  );

  v_out := format('تمت الجدولة: reminders_enqueue (%s) و reminders_dispatch (%s) على %s',
                  p_enqueue_cron, p_dispatch_cron, v_url);
  raise notice '%', v_out;
  return v_out;
end;
$$;

comment on function app_setup_reminder_schedules(text, text, text, text) is
  'تُنشئ وظيفتَي pg_cron لخط التذكيرات: تجهيز الرسائل المستحقة داخل القاعدة، ونداء دالة الحافة للتسليم. المفتاح يُقرأ من Vault باسمه ولا يُخزَّن في الجدولة.';

revoke all on function app_setup_reminder_schedules(text, text, text, text) from public, anon;
grant execute on function app_setup_reminder_schedules(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) نافذة فحص: هل الخط يعمل فعلًا؟
--
-- السؤال «هل التذكيرات تعمل؟» كان لا جواب له إلا بقراءة ثلاثة جداول يدويًا.
-- هذا المنظور يُجيب عنه بصف واحد، ويكشف الحالة الصامتة الخطرة: رسائل
-- معلَّقة تتراكم بلا أن يُسلّمها أحد — أي أن الجدولة متوقفة.
-- ---------------------------------------------------------------------------
create or replace view v_reminder_pipeline_health as
select
  m.organization_id,
  count(*) filter (where m.status in ('pending','queued','processing'))            as معلَّقة,
  count(*) filter (where m.status in ('sent','delivered'))                          as مُرسَلة,
  count(*) filter (where m.status = 'failed')                                       as فاشلة,
  count(*) filter (where m.status in ('pending','queued','processing')
                     and m.created_at < now() - interval '30 minutes')              as معلَّقة_أكثر_من_نصف_ساعة,
  max(m.created_at) filter (where m.status in ('sent','delivered'))                 as آخر_إرسال_ناجح
from message_log m
where m.reminder_job_id is not null
group by m.organization_id;

alter view v_reminder_pipeline_health set (security_invoker = on);
revoke all on v_reminder_pipeline_health from anon;
grant select on v_reminder_pipeline_health to authenticated;

commit;

-- ===========================================================================
-- الخطوتان المتبقيتان — خارج SQL
-- ===========================================================================
--
-- (أ) نشر دالة الحافة، من مجلد المشروع:
--
--       supabase login
--       supabase link --project-ref rgzdvrluwbwoutvuejmz
--       supabase functions deploy appointment-reminders
--
-- (ب) ضبط الأسرار. مفاتيح مزوّد الرسائل تُضبط للدالة:
--
--       supabase secrets set SMS_PROVIDER_URL=... SMS_PROVIDER_KEY=... SMS_SENDER=...
--
--     ومفتاح الخدمة يُخزَّن في Vault ليقرأه pg_cron — من لوحة Supabase:
--     Project Settings → Vault → New secret، بالاسم `reminders_service_key`
--     وقيمته مفتاح `service_role`.
--
--     **لا تكتب المفتاح في ملف هجرة ولا في مستودع git.** Vault هو الموضع
--     الوحيد الصحيح له، ولهذا لا تحمل الجدولة إلا اسمه.
--
-- (ج) ثم شغّل الإعداد مرة واحدة:
--
--       select app_setup_reminder_schedules(
--         'https://rgzdvrluwbwoutvuejmz.supabase.co/functions/v1'
--       );
--
-- (د) للتحقق:
--
--       select jobname, schedule, active from cron.job;
--       select * from v_reminder_pipeline_health;
--
--     صفر في «مُرسَلة» مع رقم يكبر في «معلَّقة_أكثر_من_نصف_ساعة» يعني أن
--     الجدولة لا تعمل أو أن الدالة غير منشورة.
-- ===========================================================================
