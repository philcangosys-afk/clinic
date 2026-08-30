-- ---------------------------------------------------------------------------
-- 0054_reminder_delivery_pipeline.sql — المهمة 9: تشغيل التذكيرات فعليًا
-- ---------------------------------------------------------------------------
-- ما بناه 0050 وما ينقصه:
--
--   بنى الجدول والمُحفِّز ودالة المعالجة — وهي أساس سليم. لكن ثلاث فجوات
--   تمنعها من العمل كخط تسليم حقيقي:
--
--   1. **الرسالة تُعتبر مُرسَلة قبل أن تُرسَل.** الدالة تُدرج صفًا في
--      `message_log` بحالة `queued`، ثم تُعلّم المهمة `sent` وتضبط
--      `appointments.sms_reminder_sent = true` **في نفس اللحظة** — قبل أن يرى
--      مزوّد الرسائل شيئًا. فلو رفض المزوّد الرسالة أو انقطع، يبقى النظام
--      يقول "أُرسل التذكير" ولا يعيد المحاولة أبدًا. والمريض لا يحضر.
--
--   2. **لا إعادة محاولة.** العمودان `attempts` و`last_error` موجودان ولا
--      يكتب فيهما أحد. أي خطأ عابر = تذكير ضائع نهائيًا.
--
--   3. **لا مُشغِّل.** كتلة `pg_cron` في 0050 لا تفعل شيئًا لأن الامتداد غير
--      مثبَّت في المشروع. فالدالة موجودة ولا يستدعيها أحد — أي أن التذكيرات
--      لم تُرسَل ولا مرة منذ بنائها.
--
--   هذا الملف يفصل **الإخراج للطابور** عن **التسليم المؤكَّد**، ويجعل الحالة
--   لا تتقدّم إلا بردّ المزوّد.

-- ---------------------------------------------------------------------------
-- 1) حالات الرسالة
-- ---------------------------------------------------------------------------
-- الحالات المطلوبة: pending / processing / sent / failed / cancelled.
-- والموجودة: queued / sent / failed / delivered. `queued` يعادل `pending`
-- فيُبقى عليه لئلا تُعاد كتابة صفوف قائمة، ويُضاف الناقص.
alter table message_log drop constraint if exists message_log_status_check;
alter table message_log add constraint message_log_status_check check (
  status in ('pending','queued','processing','sent','delivered','failed','cancelled')
);

alter table message_log add column if not exists attempts integer not null default 0;
alter table message_log add column if not exists last_error text;
alter table message_log add column if not exists next_attempt_at timestamptz;
alter table message_log add column if not exists failed_at timestamptz;

-- ربط الرسالة بمهمة التذكير التي ولّدتها.
--
-- بدونه كان تأكيد المزوّد على رسالة واحدة يُعلّم **كل** مهام التذكير المعلَّقة
-- للموعد `sent` — فالموعد له مهمتان (24h و2h)، وتأكيد رسالة الـ24 ساعة كان
-- يُغلق مهمة الساعتين أيضًا فلا يصل التذكير الثاني أبدًا.
alter table message_log add column if not exists reminder_job_id uuid
  references appointment_reminder_jobs(id) on delete set null;
create index if not exists idx_message_log_reminder_job
  on message_log (reminder_job_id) where reminder_job_id is not null;

-- الرسائل المستحقة للإرسال أو لإعادة المحاولة — فهرس جزئي لأن الغالبية
-- العظمى من السجل رسائل منتهية لا يمسّها المُشغِّل أبدًا.
create index if not exists idx_message_log_dispatchable
  on message_log (next_attempt_at, created_at)
  where status in ('pending','queued','processing');

-- ---------------------------------------------------------------------------
-- 2) المعالجة: تُخرج للطابور ولا تدّعي الإرسال
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
    select mt.template_text into v_template
      from message_templates mt
     where mt.organization_id = v_job.organization_id
       and mt.event_key = 'appointment_reminder'
       and mt.channel = 'sms' and not mt.is_disabled
     limit 1;
    select * into v_patient from patients where id = v_job.patient_id;
    select d.name_ar into v_doctor_name from doctors d where d.id = v_job.doctor_id;

    -- أسباب إلغاء دائمة لا تُعاد المحاولة معها: لا قالب، أو مريض محذوف، أو
    -- محظور عن الرسائل، أو بلا رقم جوال. تُسجَّل بالسبب لا تُهمَل بصمت —
    -- "لا قالب رسائل" خطأ إعداد يجب أن يظهر لا أن يبتلعه النظام.
    if v_template is null or v_patient.id is null
       or v_patient.block_sms or coalesce(btrim(v_patient.mobile_number),'') = '' then
      update appointment_reminder_jobs
         set status = 'cancelled',
             last_error = case
               when v_template is null then 'لا يوجد قالب رسائل مفعَّل لحدث appointment_reminder'
               when v_patient.id is null then 'المريض غير موجود'
               when v_patient.block_sms then 'المريض محظور عن الرسائل'
               else 'لا يوجد رقم جوال للمريض' end,
             processed_at = now(), updated_at = now()
       where id = v_job.id;
      continue;
    end if;

    v_message := replace(v_template, '{{patient_name}}', coalesce(v_patient.name_ar, ''));
    v_message := replace(v_message, '{{doctor_name}}', coalesce(v_doctor_name, ''));
    v_message := replace(v_message, '{{appointment_time}}',
                 to_char(v_job.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));

    insert into message_log (
      organization_id, patient_id, appointment_id, channel, event_key,
      message_text, external_recipient, status, next_attempt_at, created_by, reminder_job_id
    ) values (
      v_job.organization_id, v_job.patient_id, v_job.appointment_id, 'sms',
      'appointment_reminder', v_message, v_patient.mobile_number, 'pending', now(), null, v_job.id
    );

    -- المهمة تصبح `processing` لا `sent`: الرسالة في الطابور ولم تُسلَّم بعد.
    -- و`sms_reminder_sent` لم يعد يُضبط هنا — يضبطه تأكيد المزوّد وحده.
    update appointment_reminder_jobs
       set status = 'processing', attempts = attempts + 1, updated_at = now()
     where id = v_job.id;

    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$$;

revoke all on function app_process_due_appointment_reminders(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) تأكيد المزوّد — نجاحًا أو فشلًا
--
--   تُستدعى من دالة الحافة بمفتاح الخدمة بعد ردّ مزوّد الرسائل. هنا فقط تتقدّم
--   الحالة إلى `sent`، وهنا فقط يُضبط `sms_reminder_sent`.
-- ---------------------------------------------------------------------------
create or replace function app_mark_message_sent(
  -- `message_log.id` من نوع bigint (تسلسلي) لا uuid — افترضتُ uuid فرفضت
  -- القاعدة الاستدعاء بـ `function ... (bigint, unknown) does not exist`.
  p_message_id bigint,
  p_provider_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_appointment uuid; v_job uuid;
begin
  update message_log
     set status = 'sent', sent_at = now(),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         last_error = null, next_attempt_at = null
   where id = p_message_id
   returning appointment_id, reminder_job_id into v_appointment, v_job;

  -- المهمة المعنيّة وحدها لا كل مهام الموعد: للموعد تذكيران (24h و2h)،
  -- وتأكيد أحدهما لا يعني تسليم الآخر.
  if v_job is not null then
    update appointment_reminder_jobs
       set status = 'sent', processed_at = now(), updated_at = now()
     where id = v_job;
  end if;
  if v_appointment is not null then
    update appointments set sms_reminder_sent = true where id = v_appointment;
  end if;
end;
$$;

-- الحد الأقصى للمحاولات ثلاث، والتأجيل تصاعدي (5 ثم 25 ثم 125 دقيقة).
--
-- لماذا تصاعدي لا ثابت: عطل المزوّد عادةً يدوم دقائق، وإعادة المحاولة كل
-- دقيقة تُغرقه بطلبات فاشلة وقد تُوقف الحساب. والتصاعد يمنح العطل وقتًا
-- ليزول قبل المحاولة التالية.
create or replace function app_mark_message_failed(
  -- `message_log.id` من نوع bigint (تسلسلي) لا uuid — افترضتُ uuid فرفضت
  -- القاعدة الاستدعاء بـ `function ... (bigint, unknown) does not exist`.
  p_message_id bigint,
  p_error text,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_job uuid;
  v_final boolean;
begin
  update message_log
     set attempts = attempts + 1, last_error = left(coalesce(p_error,''), 1000)
   where id = p_message_id
   returning attempts, reminder_job_id into v_attempts, v_job;

  if not found then return; end if;

  v_final := coalesce(p_permanent, false) or v_attempts >= 3;

  if v_final then
    update message_log
       set status = 'failed', failed_at = now(), next_attempt_at = null
     where id = p_message_id;
    if v_job is not null then
      update appointment_reminder_jobs
         set status = 'failed', last_error = left(coalesce(p_error,''), 1000),
             processed_at = now(), updated_at = now()
       where id = v_job;
    end if;
  else
    update message_log
       set status = 'pending',
           next_attempt_at = now() + (interval '5 minutes' * power(5, v_attempts - 1))
     where id = p_message_id;
  end if;
end;
$$;

revoke all on function app_mark_message_sent(bigint, text) from public, anon, authenticated;
revoke all on function app_mark_message_failed(bigint, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) سحب الرسائل المستحقة — تستدعيها دالة الحافة
--
--   تُعلّم ما تسحبه `processing` في نفس الاستعلام (`skip locked`) فلا تسحب
--   نسختان من الدالة نفس الرسالة وتُرسلها مرتين للمريض.
-- ---------------------------------------------------------------------------
create or replace function app_claim_pending_messages(p_limit integer default 50)
returns table (
  id bigint, organization_id uuid, channel text, recipient text, message_text text, attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with claimed as (
    select m.id from message_log m
     where m.status in ('pending','queued')
       and coalesce(m.next_attempt_at, m.created_at) <= now()
     order by coalesce(m.next_attempt_at, m.created_at)
     for update skip locked
     limit greatest(1, least(p_limit, 200))
  )
  update message_log m
     set status = 'processing'
    from claimed c
   where m.id = c.id
  returning m.id, m.organization_id, m.channel,
            coalesce(m.external_recipient, '') as recipient,
            m.message_text, m.attempts;
end;
$$;

revoke all on function app_claim_pending_messages(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) إلغاء التذكيرات المعلَّقة عند إلغاء الموعد
--
--   مُحفِّز 0050 يلغي مهام التذكير عند تغيّر الحالة، لكنه لا يمسّ الرسائل
--   التي خرجت للطابور بالفعل. فموعد يُلغى بعد دقيقة من إخراج التذكير كان
--   المريض سيتلقى تذكيرًا بموعد ملغى.
-- ---------------------------------------------------------------------------
create or replace function app_cancel_pending_messages_on_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('cancelled_by_patient','cancelled_by_staff','no_show','completed')
     or (new.scheduled_start is distinct from old.scheduled_start) then
    update message_log
       set status = 'cancelled', next_attempt_at = null,
           last_error = case
             when new.scheduled_start is distinct from old.scheduled_start
               then 'أُلغيت: تغيّر وقت الموعد وأُعيدت جدولة التذكير'
             else 'أُلغيت: تغيّرت حالة الموعد إلى ' || new.status end
     where appointment_id = new.id
       and event_key = 'appointment_reminder'
       and status in ('pending','queued','processing');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cancel_pending_messages on appointments;
create trigger trg_cancel_pending_messages
  after update of status, scheduled_start on appointments
  for each row execute function app_cancel_pending_messages_on_appointment_change();
