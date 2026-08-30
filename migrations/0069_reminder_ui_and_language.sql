-- ---------------------------------------------------------------------------
-- 0069_reminder_ui_and_language.sql — لغة المريض، وإعادة الإرسال، وسجل الموعد
-- ---------------------------------------------------------------------------
-- بعد أن صار خط التسليم يعمل (0054) وله جدولة (0060)، بقيت ثلاثة نواقص
-- عملية:
--
--   • **لا لغة للمريض.** `message_templates` قالب واحد لكل حدث، فالمريض
--     الناطق بالإنجليزية يستلم رسالة عربية. والعمود غير موجود أصلًا في
--     `patients`.
--
--   • **لا إعادة إرسال.** رسالة فشلت نهائيًا لا سبيل لإعادة محاولتها إلا
--     بتعديل الصف يدويًا في القاعدة.
--
--   • **لا سجل ظاهر.** الموظف لا يعرف: هل أُرسل تذكير الأربع والعشرين ساعة؟
--     ولماذا فشل تذكير الساعتين؟ فيتصل بالمريض احتياطًا في كل مرة.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) لغة المريض المفضّلة
-- ---------------------------------------------------------------------------
alter table patients
  add column if not exists preferred_language text not null default 'ar';

alter table patients drop constraint if exists patients_preferred_language_check;
alter table patients add constraint patients_preferred_language_check
  check (preferred_language in ('ar', 'en'));

-- قالب لكل لغة. الافتراضي `ar` على القوالب القائمة، فلا يتغيّر سلوك اليوم.
alter table message_templates
  add column if not exists language text not null default 'ar';

alter table message_templates drop constraint if exists message_templates_language_check;
alter table message_templates add constraint message_templates_language_check
  check (language in ('ar', 'en'));

-- **المفتاح الفريد يجب أن يتّسع للّغة.**
--
-- كان `unique (organization_id, event_key, channel)` — أي قالب واحد لكل حدث
-- وقناة. فإضافة عمود `language` وحده كانت ستبقى بلا أثر: القاعدة ترفض قالبًا
-- إنجليزيًا لأن العربي يشغل المفتاح. عمودٌ يُضاف ولا يمكن استعماله أسوأ من
-- عمود غير موجود — يوهم أن الميزة قائمة.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'message_templates'::regclass
       and contype = 'u'
       and conname like '%event_key%channel%'
  loop
    execute format('alter table message_templates drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists uq_message_templates_org_event_channel_lang
  on message_templates (organization_id, event_key, channel, language);

-- ---------------------------------------------------------------------------
-- 2) اختيار القالب بلغة المريض مع تراجع مضمون
--
-- التراجع إلى العربية لا الفشل: منشأة لم تُنشئ قالبًا إنجليزيًا يجب أن
-- يستلم مرضاها الرسالة بالعربية، لا أن تسقط رسالتهم بصمت. رسالة بلغة أخرى
-- خير من لا رسالة.
-- ---------------------------------------------------------------------------
create or replace function app_pick_message_template(
  p_organization_id uuid,
  p_event_key       text,
  p_channel         text,
  p_language        text default 'ar'
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select mt.template_text
    from message_templates mt
   where mt.organization_id = p_organization_id
     and mt.event_key = p_event_key
     and mt.channel = p_channel
     and not mt.is_disabled
   order by (mt.language = coalesce(p_language, 'ar')) desc,
            (mt.language = 'ar') desc
   limit 1;
$$;

revoke all on function app_pick_message_template(uuid, text, text, text) from public, anon;
grant execute on function app_pick_message_template(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) إعادة إرسال رسالة
--
-- **لا تُنشأ رسالة ثانية**: الصف نفسه يُعاد إلى `pending` وتُصفَّر محاولاته.
-- إنشاء صف جديد كان سيجعل سجل الموعد يمتلئ بنسخ من نفس التذكير، فلا يُعرف
-- كم مرة أُزعج المريض فعلًا.
-- ---------------------------------------------------------------------------
create or replace function app_resend_message(p_message_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row message_log%rowtype;
begin
  select * into v_row from message_log where id = p_message_id for update;
  if v_row.id is null then
    raise exception 'الرسالة غير موجودة';
  end if;
  if not app_has_permission(v_row.organization_id, 'messages.resend') then
    raise exception 'صلاحيتك لا تسمح بإعادة إرسال الرسائل';
  end if;
  if v_row.status in ('pending','queued','processing') then
    raise exception 'الرسالة في طور الإرسال أصلًا';
  end if;

  -- المحظور عن الرسائل لا تُعاد إليه: الحظر يُفحص عند الإدخال (0063)، وإعادة
  -- الإرسال تحديثٌ لا إدخال، فلولا هذا الفحص لكانت بابًا يلتفّ على الحظر.
  if app_check_contact_block(v_row.organization_id, v_row.patient_id,
       (select mobile_number from patients where id = v_row.patient_id), 'messaging') then
    raise exception 'هذا المريض محظور من استقبال الرسائل';
  end if;

  update message_log
     set status = 'pending',
         attempts = 0,
         last_error = null,
         failed_at = null,
         next_attempt_at = null,
         sent_at = null
   where id = p_message_id;
end;
$$;

revoke all on function app_resend_message(bigint) from public, anon;
grant execute on function app_resend_message(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) إرسال تأكيد الآن
-- ---------------------------------------------------------------------------
create or replace function app_send_appointment_confirmation(p_appointment_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt     appointments%rowtype;
  v_patient  patients%rowtype;
  v_doctor   text;
  v_template text;
  v_message  text;
  v_id       bigint;
begin
  select * into v_appt from appointments where id = p_appointment_id;
  if v_appt.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_permission(v_appt.organization_id, 'messages.resend') then
    raise exception 'صلاحيتك لا تسمح بإرسال الرسائل';
  end if;
  if v_appt.status in ('cancelled_by_patient','cancelled_by_staff','no_show','completed') then
    raise exception 'لا يُرسل تأكيد لموعد حالته «%»', v_appt.status;
  end if;

  select * into v_patient from patients where id = v_appt.patient_id;
  if coalesce(btrim(v_patient.mobile_number), '') = '' then
    raise exception 'لا يوجد رقم جوال لهذا المريض';
  end if;
  select d.name_ar into v_doctor from doctors d where d.id = v_appt.doctor_id;

  v_template := app_pick_message_template(v_appt.organization_id, 'appointment_confirmation', 'sms',
                                          v_patient.preferred_language);
  -- لا قالب = رسالة افتراضية لا فشل: التأكيد إجراء يدوي طلبه موظف الآن،
  -- ورفضه لأن الإعداد ناقص يعطّل عملًا قائمًا لأجل إعداد يُصلَح لاحقًا.
  v_message := coalesce(
    replace(replace(replace(v_template,
      '{{patient}}', coalesce(v_patient.name_ar, '')),
      '{{doctor}}',  coalesce(v_doctor, '')),
      '{{datetime}}', to_char(v_appt.scheduled_start, 'YYYY-MM-DD HH24:MI')),
    format('تأكيد موعدك مع %s بتاريخ %s', coalesce(v_doctor, 'العيادة'),
           to_char(v_appt.scheduled_start, 'YYYY-MM-DD HH24:MI'))
  );

  insert into message_log (organization_id, patient_id, appointment_id, channel, event_key,
                           message_text, status, created_by)
  values (v_appt.organization_id, v_appt.patient_id, p_appointment_id, 'sms',
          'appointment_confirmation', v_message, 'pending', auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_send_appointment_confirmation(uuid) from public, anon;
grant execute on function app_send_appointment_confirmation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) منظور سجل رسائل الموعد
--
-- يجمع وظيفة التذكير بالرسالة الناتجة عنها: الموظف يسأل «هل وصل تذكير
-- الأربع والعشرين ساعة؟» لا «ما حالة الرسالة رقم 91723؟».
-- ---------------------------------------------------------------------------
create or replace view v_appointment_messages as
select
  m.id                as message_id,
  m.organization_id,
  m.appointment_id,
  m.patient_id,
  m.channel,
  m.event_key,
  m.message_text,
  m.status,
  m.attempts,
  m.last_error,
  m.next_attempt_at,
  m.sent_at,
  m.failed_at,
  m.created_at,
  m.provider_message_id,
  j.reminder_type,
  j.due_at            as reminder_due_at,
  j.status            as reminder_status
from message_log m
left join appointment_reminder_jobs j on j.id = m.reminder_job_id
where m.appointment_id is not null;

alter view v_appointment_messages set (security_invoker = on);
revoke all on v_appointment_messages from anon;
grant select on v_appointment_messages to authenticated;

-- منظور مختصر: حالة تذكيرَي الموعد في صف واحد
create or replace view v_appointment_reminder_status as
select
  j.appointment_id,
  j.organization_id,
  max(j.due_at)    filter (where j.reminder_type = '24h') as due_24h,
  max(j.status)    filter (where j.reminder_type = '24h') as status_24h,
  max(j.due_at)    filter (where j.reminder_type = '2h')  as due_2h,
  max(j.status)    filter (where j.reminder_type = '2h')  as status_2h,
  max(j.attempts)                                        as max_attempts,
  max(j.last_error)                                      as last_error,
  max(j.processed_at)                                    as last_processed_at
from appointment_reminder_jobs j
group by j.appointment_id, j.organization_id;

alter view v_appointment_reminder_status set (security_invoker = on);
revoke all on v_appointment_reminder_status from anon;
grant select on v_appointment_reminder_status to authenticated;

-- ---------------------------------------------------------------------------
-- 6) لغة المريض في مولّد التذكيرات
--
-- تُعاد كتابة `app_process_due_appointment_reminders` لتختار القالب بلغة
-- المريض. بقية المنطق كما استقرّ في 0054 — بما فيه أسباب الإلغاء الدائمة
-- التي لا تُعاد المحاولة معها.
-- ---------------------------------------------------------------------------
create or replace function app_process_due_appointment_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job         record;
  v_template    text;
  v_patient     patients%rowtype;
  v_doctor_name text;
  v_message     text;
  v_processed   integer := 0;
begin
  for v_job in
    select j.id, j.organization_id, j.appointment_id, j.reminder_type, j.attempts,
           a.patient_id, a.doctor_id, a.scheduled_start
      from appointment_reminder_jobs j
      join appointments a on a.id = j.appointment_id
     where j.status = 'pending' and j.due_at <= now()
       and a.status in ('new','scheduled','confirmed','unconfirmed')
     order by j.due_at
     for update of j skip locked
     limit greatest(1, least(p_limit, 500))
  loop
    select * into v_patient from patients where id = v_job.patient_id;
    select d.name_ar into v_doctor_name from doctors d where d.id = v_job.doctor_id;

    v_template := app_pick_message_template(v_job.organization_id, 'appointment_reminder', 'sms',
                                            coalesce(v_patient.preferred_language, 'ar'));

    -- أسباب إلغاء دائمة لا تُعاد المحاولة معها، وتُسجَّل بالسبب لا تُهمَل
    -- بصمت: «لا قالب رسائل» خطأ إعداد يجب أن يظهر لا أن يبتلعه النظام.
    if v_template is null or v_patient.id is null
       or v_patient.block_sms or coalesce(btrim(v_patient.mobile_number), '') = '' then
      update appointment_reminder_jobs
         set status = 'cancelled',
             last_error = case
               when v_template is null then 'لا يوجد قالب رسالة مفعَّل للتذكير'
               when v_patient.id is null then 'المريض غير موجود'
               when v_patient.block_sms then 'المريض محظور من الرسائل'
               else 'لا يوجد رقم جوال للمريض'
             end,
             processed_at = now(), updated_at = now()
       where id = v_job.id;
      continue;
    end if;

    v_message := replace(replace(replace(v_template,
      '{{patient}}',  coalesce(v_patient.name_ar, '')),
      '{{doctor}}',   coalesce(v_doctor_name, '')),
      '{{datetime}}', to_char(v_job.scheduled_start, 'YYYY-MM-DD HH24:MI'));

    insert into message_log (organization_id, patient_id, appointment_id, channel, event_key,
                             message_text, status, reminder_job_id)
    values (v_job.organization_id, v_job.patient_id, v_job.appointment_id, 'sms',
            'appointment_reminder', v_message, 'pending', v_job.id);

    -- «قيد المعالجة» لا «أُرسلت»: الإرسال لم يقع بعد، ومن يعلّمها مرسَلة
    -- هنا يكذب على نفسه ويمنع إعادة المحاولة عند فشل المزوّد.
    update appointment_reminder_jobs
       set status = 'processing', updated_at = now()
     where id = v_job.id;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function app_process_due_appointment_reminders(integer) from public, anon;
grant execute on function app_process_due_appointment_reminders(integer) to authenticated;

commit;
