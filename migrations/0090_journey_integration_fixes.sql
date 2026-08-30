-- ---------------------------------------------------------------------------
-- 0090 — إصلاحات تكامل رحلة المريض
-- ---------------------------------------------------------------------------
-- المرحلة العاشرة. هذه الهجرة **لا تضيف ميزة**: كل ما فيها أخطاء كشفها
-- `e2e/sql/patient-journey.test.sql` حين مشى في الرحلة كاملةً بمريضٍ واحد.
--
-- كل مرحلةٍ سابقة نجحت في دليلها وحدها. والخلل في **الوصلات** بينها: حيث
-- تُسلَّم مخرجات مرحلة إلى مدخلات التالية، ولا دليلَ وحدةٍ ينظر إلى ذلك.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الزيارة تولد «مخطَّطة» لا «مكتملة»
-- ===========================================================================
--
-- 0087 أضاف `status` بقيمة افتراضية `'completed'`، وكان ذلك صحيحًا **للصفوف
-- القائمة** — زياراتٌ ماضية انتهت فعلًا. لكنه بقي افتراضًا للصفوف **الجديدة**
-- أيضًا، والنتيجة:
--
--   • كل زيارة يبدأها موظف الاستقبال تُولَد «مكتملة» قبل أن يراها الطبيب.
--   • فلا تظهر في `v_incomplete_visits` أبدًا، ودورة الحياة كلها تُتجاوَز في
--     أكثر المسارات استعمالًا في النظام.
--   • وأسوأ: `app_set_visit_status(visit,'in_progress')` من «مكتملة» يُعدّ
--     **إعادة فتح**، فيطلب سببًا مكتوبًا وصلاحية `visits.reopen` — أي أن
--     الطبيب لا يستطيع بدء الزيارة التي سُلِّمت إليه للتوّ.
--
-- الافتراض الصحيح للصف الجديد هو `'planned'`.
alter table patient_visits alter column status set default 'planned';

comment on column patient_visits.status is
  'دورة الزيارة: planned مخطَّطة (الافتراضي للجديد)، waiting منتظرة، in_progress جارية، completed مكتملة، signed موقَّعة سريريًا، closed مغلقة ماليًا، cancelled ملغاة.';

-- ===========================================================================
-- 2) الاستقبال يحرّك حالة الزيارة لا حالة الموعد وحدها
-- ===========================================================================
--
-- `app_reception_transition` كانت تُنشئ الزيارة وتنقل **الموعد** إلى
-- `in_progress`، وتترك **الزيارة** على حالها. فحالتان لشيء واحد تفترقان من
-- اللحظة الأولى: الموعد جارٍ والزيارة مكتملة.
--
-- تُعاد كتابة الفرعين المعنيّين فقط — `start` و`finish` — بترقيع الدالة
-- القائمة عبر مُحفِّز على `appointments`، لا بإعادة كتابة الدالة كلها:
-- إعادة كتابتها تعني نسخ مئتي سطر لم تتغيّر، وكل نسخة فرصة لخطأ.
create or replace function app_sync_visit_with_reception()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit patient_visits%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_visit from patient_visits where appointment_id = new.id;
  if v_visit.id is null then
    return new;
  end if;

  if new.status = 'in_progress' and v_visit.status in ('planned','waiting') then
    update patient_visits
       set status = 'in_progress',
           started_at = coalesce(started_at, now()),
           updated_at = now()
     where id = v_visit.id;

  elsif new.status = 'completed' and v_visit.status = 'in_progress' then
    update patient_visits
       set status = 'completed',
           ended_at = coalesce(ended_at, now()),
           updated_at = now()
     where id = v_visit.id;

  elsif new.status in ('cancelled','no_show')
        and v_visit.status in ('planned','waiting') then
    -- زيارةٌ لم تبدأ ومريضُها لم يحضر: تُلغى بسببها لا تبقى معلّقة إلى الأبد.
    update patient_visits
       set status = 'cancelled',
           cancel_reason = coalesce(new.no_show_reason, 'ألغي الموعد'),
           updated_at = now()
     where id = v_visit.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_visit_with_reception on appointments;
create trigger trg_sync_visit_with_reception
  after update of status on appointments
  for each row execute function app_sync_visit_with_reception();

-- والاتجاه الآخر: `app_reception_transition` تُحدِّث **الموعد أوّلًا** ثم
-- تُنشئ الزيارة. فمُحفِّزُ الموعد يعمل والزيارة لم تُخلق بعد، فلا يجد شيئًا
-- يزامنه. الزيارة الجديدة إذن تستنتج حالتها من موعدها لحظة ميلادها.
create or replace function app_init_visit_status_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt_status text;
begin
  if new.appointment_id is null then
    return new;
  end if;
  select a.status into v_appt_status from appointments a where a.id = new.appointment_id;

  if v_appt_status = 'in_progress' and new.status = 'planned' then
    new.status     := 'in_progress';
    new.started_at := coalesce(new.started_at, now());
  elsif v_appt_status = 'completed' and new.status = 'planned' then
    new.status   := 'completed';
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_init_visit_status on patient_visits;
create trigger trg_init_visit_status
  before insert on patient_visits
  for each row execute function app_init_visit_status_from_appointment();

-- الزيارة التي أنشأها الاستقبال قبل هذه الهجرة وموعدها جارٍ: تُصحَّح مرّة.
update patient_visits v
   set status = 'in_progress', started_at = coalesce(v.started_at, a.called_at, a.checked_in_1_at)
  from appointments a
 where a.id = v.appointment_id
   and a.status = 'in_progress'
   and v.status = 'completed'
   and v.signed_at is null and v.closed_at is null;

-- ===========================================================================
-- 3) الزيارة المغلقة أو الموقَّعة: الحارس كان يمنع حتى تحديثات النظام نفسه
-- ===========================================================================
--
-- `app_guard_signed_visit` (0087) يمنع أيّ `update` على زيارة موقَّعة أو
-- مغلقة. وهذا صحيح للمستخدم، وخاطئ للنظام: مُحفِّزٌ داخليّ يريد ختم
-- `updated_at` أو مزامنة حالة يُمنع أيضًا، فتتعطّل مسارات مشروعة.
--
-- الحلّ: استثناء صريح ومحدود للأعمدة التي لا تحمل محتوى سريريًا.
create or replace function app_guard_signed_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status not in ('signed','closed') then
    return new;
  end if;

  -- تغيير الحالة نفسها يمرّ عبر `app_set_visit_status` وحدها، وهي تفرض
  -- الصلاحية والسبب. أمّا هنا فنمنع تعديل **المحتوى**.
  if new.status is distinct from old.status then
    return new;
  end if;

  if new.main_complaint    is distinct from old.main_complaint
     or new.exam_data      is distinct from old.exam_data
     or new.notes          is distinct from old.notes
     or new.doctor_id      is distinct from old.doctor_id
     or new.clinic_id      is distinct from old.clinic_id
     or new.visit_date     is distinct from old.visit_date
     or new.next_visit_plan is distinct from old.next_visit_plan then
    raise exception 'الزيارة % — لا تُعدَّل مباشرةً، أعد فتحها بسبب مسجَّل',
      case old.status when 'signed' then 'موقَّعة' else 'مغلقة' end;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- 4) الفاتورة تلتقط الموافقة المسبقة وتستهلكها
-- ===========================================================================
--
-- 0089 أضاف `consumed_at` إلى الموافقات و`preauthorization_id` إلى سطور
-- الفاتورة، ولم يكن ثمّة ما يملؤهما: الموافقة تبقى «غير مستهلَكة» بعد أن
-- استُعملت فعلًا، فتُستعمل مرّة أخرى لخدمة ثانية داخل نافذتها.
create or replace function app_consume_preauth_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv sales_invoices%rowtype;
  v_pa  insurance_preauthorizations%rowtype;
begin
  if new.item_id is null then
    return new;
  end if;
  select * into v_inv from sales_invoices where id = new.invoice_id;
  if v_inv.id is null or v_inv.patient_id is null or not v_inv.is_insurance_invoice then
    return new;
  end if;

  v_pa := app_active_preauthorization(v_inv.patient_id, new.item_id, current_date);
  if v_pa.id is null then
    return new;
  end if;

  update insurance_preauthorizations
     set consumed_at = now(), consumed_invoice_id = new.invoice_id, updated_at = now()
   where id = v_pa.id and consumed_at is null;

  new.preauthorization_id := v_pa.id;
  return new;
end;
$$;

drop trigger if exists trg_consume_preauth_on_invoice on sales_invoice_items;
create trigger trg_consume_preauth_on_invoice
  before insert on sales_invoice_items
  for each row execute function app_consume_preauth_on_invoice();

-- ===========================================================================
-- 5) خطّ الرحلة يعرف حالة الزيارة
-- ===========================================================================
--
-- **لا منظور جديد هنا.** `app_get_patient_timeline` (0067) يجمع الرحلة
-- بالفعل من أربعة عشر مصدرًا، وإضافة منظورٍ ثانٍ لنفس الغرض تعني خطّين
-- زمنيّين يفترقان. الناقص فيه شيء واحد: حدث الزيارة يعرض الشكوى ولا يعرض
-- **حالتها** — أضافها 0087 ولم يعرفها الخطّ الزمني بعد، فزيارةٌ موقَّعة
-- وزيارةٌ ملغاة تبدوان سواءً في رحلة المريض.
create or replace function app_patient_timeline_visit_status(p_visit_id uuid)
returns text
language sql
stable
as $$
  select case v.status
    when 'planned'     then 'مخطَّطة'
    when 'waiting'     then 'منتظرة'
    when 'in_progress' then 'جارية'
    when 'completed'   then 'مكتملة'
    when 'signed'      then 'موقَّعة'
    when 'closed'      then 'مغلقة ماليًا'
    when 'cancelled'   then 'ملغاة'
    else v.status
  end
  from patient_visits v where v.id = p_visit_id;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_get_patient_timeline';

  -- الاستبدال بالنصّ لا بإعادة الكتابة: الدالة أربعمئة سطر لم يتغيّر منها
  -- إلّا سطر واحد، وكل نسخة يدوية فرصة لخطأ.
  if v_def like '%''زيارة طبية'', coalesce(v.main_complaint, ''—''), null, ''medical_records''%' then
    v_def := replace(v_def,
      '''زيارة طبية'', coalesce(v.main_complaint, ''—''), null, ''medical_records''',
      '''زيارة طبية'', coalesce(v.main_complaint, ''—''), app_patient_timeline_visit_status(v.id), ''medical_records''');
    execute v_def;
  elsif v_def not like '%app_patient_timeline_visit_status%' then
    raise exception 'تعذّر ترقيع الخطّ الزمني: شكل الدالة تغيّر — راجع 0067';
  end if;
end $$;

revoke all on function app_patient_timeline_visit_status(uuid) from public, anon;
grant execute on function app_patient_timeline_visit_status(uuid) to authenticated;

-- ===========================================================================
-- 5.1) إزالة الخطّ الزمنيّ المكرَّر
-- ===========================================================================
--
-- `v_patient_journey` (0018) و`app_get_patient_timeline` (0067) يجيبان السؤال
-- نفسه من المصادر نفسها. المنظور القديم **لا يقرؤه شيء** في التطبيق منذ 0067
-- — تحقّقتُ بفحص شجرة العميل كلها — وبقاؤه يعني خطّين زمنيّين يفترقان كلما
-- أُضيف حدث إلى أحدهما دون الآخر، وهو ما حدث فعلًا: المنظور لا يعرف الصرف
-- ولا المطالبات ولا حالات الزيارة التي أضافها 0087.
--
-- يُحذف لأنه منظور مشتقّ لا بيانات فيه: لا شيء يضيع.
drop view if exists v_patient_journey;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'patient_visits'
         and column_name = 'status') not like '%planned%' then
    raise exception 'الزيارة الجديدة ما زالت تولد مكتملة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_sync_visit_with_reception')
     or not exists (select 1 from pg_trigger where tgname = 'trg_init_visit_status') then
    raise exception 'مزامنة الاستقبال مع الزيارة غير مركَّبة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_consume_preauth_on_invoice') then
    raise exception 'استهلاك الموافقة المسبقة عند الفوترة غير مركَّب';
  end if;
end $$;
