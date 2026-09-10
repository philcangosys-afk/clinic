-- =============================================================================
-- 0154_medical_reports_and_journey.sql
-- التقارير الطبية، والفحص المهنيّ، وحقول رحلة المريض والعمل السريريّ.
-- =============================================================================
--
-- خمسة نواقص أثبتتها مقابلة النظام المرجعيّ بالشيفرة:
--
-- ١) **لا سبيل لإصدار إجازة مرضية من النظام.** المرجع يُصدر أربعة أنواع من
--    التقارير الطبية ويحفظ لكلٍّ رقمًا وجهةً ومديرًا طبيًّا وشركة تأمين وحالة
--    تحرير. عندنا قوالب مستندات عامّة تطبع أيّ ورقة، ولا سجلّ للصادر ولا
--    حقوله — فلا يُعرف كم إجازة صدرت ولا لمن ولا من وقّعها.
--
-- ٢) **`occupational_exam_results` بلا كاتب.** الجدول موجود (تبنّته 0149)،
--    و`v_occupational_exam_report` يقرؤه وتعرضه شاشة التقارير — **فارغًا
--    أبدًا**، لأنّ لا شاشة ولا دالّة تكتب فيه.
--
-- ٣) **«المرسل» غير مسجَّل.** المرجع يعرض في شاشة الدور من أرسل المريض إلى
--    الطبيب. عندنا لا عمود له، فمن أرسل مريضًا إلى عيادة مزدحمة لا يُعرف.
--
-- ٤) **المدّة المتوقّعة للزيارة** تُختار في المرجع عند الإرسال ولا حقل لها.
--
-- ٥) **إجراء السنّ بلا سياقه السريريّ.** المرجع يسجّل على السنّ: الشكوى
--    الرئيسية، التشخيص، المضاعفات، التخدير، المضادات الحيوية الوقائية، تثقيف
--    المريض، والزيارة التالية. عندنا الأسطح والحالة والتخطيط وحدها.
--
-- كل ما يلي إضافةٌ محضة: لا عمود يُحذف ولا يتغيّر نوعه، ولا صفٌّ قائم يتأثّر.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) التقارير الطبية
--
-- سجلٌّ للصادر لا مجرّد طباعة: التقرير الطبيّ وثيقة تُقدَّم لجهة عمل أو محكمة
-- أو شركة تأمين، فلا بدّ من رقمٍ يُرجع إليه، ومن معرفة من أصدره ومتى وماذا
-- كتب فيه. والإلغاء تعطيلٌ بسبب لا حذف — قاعدة المشروع تمنع محو البيانات
-- الطبية، وتقريرٌ صدر ثمّ اختفى أسوأ من تقريرٍ ملغًى ظاهرٍ سببه.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists medical_reports (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations(id) on delete cascade,
  branch_id                   uuid references branches(id),
  patient_id                  uuid not null references patients(id) on delete cascade,
  visit_id                    uuid references patient_visits(id),
  doctor_id                   uuid references doctors(id),

  report_type                 text not null,
  report_number               bigint,
  report_prefix               text,
  report_date                 date not null default current_date,

  -- «إلى» في المرجع: الجهة التي يُقدَّم لها التقرير (جهة عمل، مدرسة، محكمة)
  issued_to                   text,
  medical_director_name       text,
  insurance_company_name      text,

  diagnosis_text              text,
  body                        text,

  -- إجازة مرضية
  leave_start_date            date,
  leave_end_date              date,
  -- العدد محسوبٌ لا مكتوب: رقمٌ يُدخَل يدويًّا يخالف التاريخين يومًا ما،
  -- وجهة العمل تقرأ الرقم لا التاريخين.
  leave_days                  integer generated always as (
                                case when leave_start_date is not null and leave_end_date is not null
                                     then (leave_end_date - leave_start_date) + 1 end
                              ) stored,

  -- إحالة طبية
  referral_facility           text,
  referral_specialty_value_id uuid references lookup_values(id),

  -- نموذج الدخول والخروج
  admission_at                timestamptz,
  discharge_at                timestamptz,

  status                      text not null default 'issued',
  cancel_reason               text,
  cancelled_at                timestamptz,
  cancelled_by                uuid references auth.users(id),

  created_by                  uuid references auth.users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint medical_reports_type_check check (
    report_type in ('medical_leave','referral','admission_discharge','custom')),
  constraint medical_reports_status_check check (status in ('draft','issued','cancelled')),
  constraint medical_reports_leave_order_check check (
    leave_start_date is null or leave_end_date is null or leave_end_date >= leave_start_date),
  constraint medical_reports_admission_order_check check (
    admission_at is null or discharge_at is null or discharge_at >= admission_at),
  constraint medical_reports_cancel_reason_check check (
    status <> 'cancelled' or nullif(btrim(coalesce(cancel_reason,'')),'') is not null)
);

comment on table medical_reports is
  'سجلّ التقارير الطبية الصادرة: إجازة مرضية، إحالة، دخول وخروج، وتقرير خاصّ. الإلغاء تعطيلٌ بسبب لا حذف.';

create index if not exists idx_medical_reports_patient
  on medical_reports (patient_id, report_date desc);
create index if not exists idx_medical_reports_org
  on medical_reports (organization_id, report_date desc);
create index if not exists idx_medical_reports_type
  on medical_reports (organization_id, report_type, status);
create unique index if not exists uq_medical_report_number
  on medical_reports (organization_id, report_number)
  where report_number is not null;

alter table medical_reports enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'medical_reports'
                    and policyname = 'medical_reports_all_members') then
    create policy medical_reports_all_members on medical_reports
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
end $$;

-- الفرع من الزيارة إن وُجدت — لا يُخمَّن ولا يُترك للواجهة
create or replace function app_medical_report_branch()
returns trigger
language plpgsql
as $$
begin
  if new.branch_id is null and new.visit_id is not null then
    select v.branch_id into new.branch_id
      from patient_visits v
     where v.id = new.visit_id and v.organization_id = new.organization_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_medical_reports_branch on medical_reports;
create trigger trg_medical_reports_branch
  before insert or update on medical_reports
  for each row execute function app_medical_report_branch();


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) إصدار التقرير — نداءٌ واحد ذرّيّ
--
-- الترقيم والإدراج في معاملة واحدة: ترقيمٌ ينجح ثمّ إدراجٌ يفشل يترك فجوة في
-- تسلسل التقارير، والفجوة في وثيقة رسمية تعني تقريرًا اختفى.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_issue_medical_report(
  p_organization_id uuid,
  p_patient_id uuid,
  p_report_type text,
  p_doctor_id uuid default null,
  p_visit_id uuid default null,
  p_report_date date default null,
  p_issued_to text default null,
  p_medical_director_name text default null,
  p_insurance_company_name text default null,
  p_diagnosis_text text default null,
  p_body text default null,
  p_leave_start_date date default null,
  p_leave_end_date date default null,
  p_referral_facility text default null,
  p_referral_specialty_value_id uuid default null,
  p_admission_at timestamptz default null,
  p_discharge_at timestamptz default null,
  p_status text default 'issued'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id     uuid;
  v_branch uuid;
  v_number bigint;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  -- التقرير الطبيّ وثيقة سريرية: يُصدرها طبيبٌ أو إدارة المنشأة، لا الاستقبال
  if not app_has_role(p_organization_id, array['owner','organization_admin','doctor','branch_manager']) then
    raise exception 'صلاحيتك لا تسمح بإصدار التقارير الطبية';
  end if;

  if p_report_type not in ('medical_leave','referral','admission_discharge','custom') then
    raise exception 'نوع تقرير غير معروف: %', p_report_type;
  end if;
  if coalesce(p_status,'issued') not in ('draft','issued') then
    raise exception 'حالة غير مقبولة عند الإصدار: %', p_status;
  end if;

  if not exists (select 1 from patients p
                  where p.id = p_patient_id and p.organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_doctor_id is not null and not exists (select 1 from doctors d
                  where d.id = p_doctor_id and d.organization_id = p_organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_visit_id is not null and not exists (select 1 from patient_visits v
                  where v.id = p_visit_id and v.organization_id = p_organization_id) then
    raise exception 'الزيارة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;

  -- ما يخصّ كل نوع يُفرض هنا لا في الشاشة: إجازةٌ بلا تاريخين ورقةٌ لا تُقبل
  if p_report_type = 'medical_leave'
     and (p_leave_start_date is null or p_leave_end_date is null) then
    raise exception 'الإجازة المرضية تتطلّب تاريخ البداية وتاريخ النهاية';
  end if;
  if p_report_type = 'referral'
     and nullif(btrim(coalesce(p_referral_facility,'')),'') is null then
    raise exception 'الإحالة الطبية تتطلّب الجهة المُحال إليها';
  end if;
  if p_report_type = 'admission_discharge' and p_admission_at is null then
    raise exception 'نموذج الدخول والخروج يتطلّب تاريخ الدخول';
  end if;

  if p_visit_id is not null then
    select v.branch_id into v_branch from patient_visits v where v.id = p_visit_id;
  end if;

  -- المسوّدة بلا رقم: الرقم يُحجز للصادر وحده حتى لا تترك مسوّدةٌ مهملة فجوة
  if coalesce(p_status,'issued') = 'issued' then
    v_number := app_next_document_number(p_organization_id, 'medical_report', v_branch);
  end if;

  insert into medical_reports (
    organization_id, branch_id, patient_id, visit_id, doctor_id,
    report_type, report_number, report_date,
    issued_to, medical_director_name, insurance_company_name,
    diagnosis_text, body,
    leave_start_date, leave_end_date,
    referral_facility, referral_specialty_value_id,
    admission_at, discharge_at,
    status, created_by
  ) values (
    p_organization_id, v_branch, p_patient_id, p_visit_id, p_doctor_id,
    p_report_type, v_number, coalesce(p_report_date, current_date),
    nullif(btrim(p_issued_to),''), nullif(btrim(p_medical_director_name),''),
    nullif(btrim(p_insurance_company_name),''),
    nullif(btrim(p_diagnosis_text),''), nullif(btrim(p_body),''),
    p_leave_start_date, p_leave_end_date,
    nullif(btrim(p_referral_facility),''), p_referral_specialty_value_id,
    p_admission_at, p_discharge_at,
    coalesce(p_status,'issued'), auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

comment on function app_issue_medical_report(uuid, uuid, text, uuid, uuid, date, text, text, text,
  text, text, date, date, text, uuid, timestamptz, timestamptz, text) is
  'إصدار تقرير طبيّ: الترقيم والإدراج في معاملة واحدة، وشروط كل نوع مفروضة في القاعدة.';

revoke all on function app_issue_medical_report(uuid, uuid, text, uuid, uuid, date, text, text, text,
  text, text, date, date, text, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function app_issue_medical_report(uuid, uuid, text, uuid, uuid, date, text, text, text,
  text, text, date, date, text, uuid, timestamptz, timestamptz, text) to authenticated;


create or replace function app_cancel_medical_report(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  select r.organization_id, r.status into v_org, v_status
    from medical_reports r where r.id = p_report_id;
  if not found then
    raise exception 'التقرير غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(v_org, array['owner','organization_admin','doctor','branch_manager']) then
    raise exception 'صلاحيتك لا تسمح بإلغاء التقارير الطبية';
  end if;
  if v_status = 'cancelled' then
    raise exception 'التقرير ملغًى أصلًا';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'سبب الإلغاء مطلوب';
  end if;

  -- الرقم يبقى: تقريرٌ ملغًى برقمه أوضح من فجوة في التسلسل
  update medical_reports
     set status = 'cancelled',
         cancel_reason = btrim(p_reason),
         cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = p_report_id;
end;
$$;

revoke all on function app_cancel_medical_report(uuid, text) from public, anon;
grant execute on function app_cancel_medical_report(uuid, text) to authenticated;


-- سجلّ التقارير بأسمائه — لتقرأه الشاشة في استعلام واحد
create or replace view v_medical_reports
with (security_invoker = on) as
select
  r.id, r.organization_id, r.branch_id, r.patient_id, r.visit_id, r.doctor_id,
  r.report_type, r.report_number, r.report_date,
  r.issued_to, r.medical_director_name, r.insurance_company_name,
  r.diagnosis_text, r.body,
  r.leave_start_date, r.leave_end_date, r.leave_days,
  r.referral_facility, r.referral_specialty_value_id,
  r.admission_at, r.discharge_at,
  r.status, r.cancel_reason, r.cancelled_at,
  r.created_by, r.created_at,
  p.name_ar        as patient_name,
  p.file_number    as patient_file_number,
  d.name_ar        as doctor_name,
  lv.name_ar       as referral_specialty_name
from medical_reports r
join patients p on p.id = r.patient_id
left join doctors d on d.id = r.doctor_id
left join lookup_values lv on lv.id = r.referral_specialty_value_id;

comment on view v_medical_reports is
  'سجلّ التقارير الطبية بأسماء المريض والطبيب والتخصّص — قراءةٌ واحدة للشاشة.';

grant select on v_medical_reports to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الفحص المهنيّ — كاتبٌ للجدول الذي يُقرأ ولا يُكتب
--
-- `occupational_exam_results` واحدٌ لكل زيارة (قيد فريد على `visit_id` من
-- 0149)، فالحفظ إدراجٌ أو تحديث على المفتاح نفسه لا إدراجٌ ثانٍ يفشل.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'occupational_exam_results'
                    and policyname = 'occupational_exam_results_all_members') then
    create policy occupational_exam_results_all_members on occupational_exam_results
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
end $$;

create or replace function app_save_occupational_exam(
  p_organization_id uuid,
  p_patient_id uuid,
  p_visit_id uuid,
  p_exam_purpose text,
  p_fitness_status text,
  p_employer_value_id uuid default null,
  p_restrictions_note text default null,
  p_certificate_number text default null,
  p_exam_date date default null,
  p_next_exam_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(p_organization_id, array['owner','organization_admin','doctor','branch_manager']) then
    raise exception 'صلاحيتك لا تسمح بتسجيل نتائج الفحص المهنيّ';
  end if;

  if p_exam_purpose not in ('pre_employment','periodic','return_to_work','exit') then
    raise exception 'غرض فحص غير معروف: %', p_exam_purpose;
  end if;
  if p_fitness_status not in ('fit','fit_with_restrictions','unfit','pending') then
    raise exception 'حالة لياقة غير معروفة: %', p_fitness_status;
  end if;
  -- «لائق مع قيود» بلا بيان القيود ليس نتيجة: الجهة الطالبة لا تعرف ما تتجنّبه
  if p_fitness_status = 'fit_with_restrictions'
     and nullif(btrim(coalesce(p_restrictions_note,'')),'') is null then
    raise exception 'حدِّد القيود حين تكون النتيجة «لائق مع قيود»';
  end if;

  if not exists (select 1 from patients p
                  where p.id = p_patient_id and p.organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from patient_visits v
                  where v.id = p_visit_id and v.organization_id = p_organization_id
                    and v.patient_id = p_patient_id) then
    raise exception 'الزيارة المحدَّدة لا تخصّ هذا المريض في هذه المنشأة';
  end if;

  insert into occupational_exam_results (
    organization_id, patient_id, visit_id, exam_purpose, fitness_status,
    employer_value_id, restrictions_note, certificate_number,
    exam_date, next_exam_due_date, created_by
  ) values (
    p_organization_id, p_patient_id, p_visit_id, p_exam_purpose, p_fitness_status,
    p_employer_value_id, nullif(btrim(p_restrictions_note),''), nullif(btrim(p_certificate_number),''),
    coalesce(p_exam_date, current_date), p_next_exam_due_date, auth.uid()
  )
  on conflict (visit_id) do update set
    exam_purpose        = excluded.exam_purpose,
    fitness_status      = excluded.fitness_status,
    employer_value_id   = excluded.employer_value_id,
    restrictions_note   = excluded.restrictions_note,
    certificate_number  = excluded.certificate_number,
    exam_date           = excluded.exam_date,
    next_exam_due_date  = excluded.next_exam_due_date,
    updated_at          = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_save_occupational_exam(uuid, uuid, uuid, text, text, uuid, text, text, date, date)
  from public, anon;
grant execute on function app_save_occupational_exam(uuid, uuid, uuid, text, text, uuid, text, text, date, date)
  to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) رحلة المريض: المرسل والمدّة المتوقّعة
-- ═══════════════════════════════════════════════════════════════════════════

alter table appointments
  add column if not exists sent_by_user_id uuid references auth.users(id),
  add column if not exists expected_duration_minutes integer;

comment on column appointments.sent_by_user_id is
  'من أرسل المريض إلى الطبيب — «المرسل» في شاشة الدور. بدونه لا يُعرف مصدر ازدحام عيادة.';
comment on column appointments.expected_duration_minutes is
  'المدّة المتوقّعة للزيارة بالدقائق كما قدّرها المُرسِل عند الإرسال.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_expected_duration_check') then
    alter table appointments add constraint appointments_expected_duration_check
      check (expected_duration_minutes is null
             or (expected_duration_minutes > 0 and expected_duration_minutes <= 600));
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) إجراء السنّ بسياقه السريريّ
--
-- سجلٌّ على السنّ نفسه لا في ملاحظة حرّة: من يفتح السنّ بعد سنة يحتاج أن يعرف
-- ما الشكوى وما التخدير وهل أُعطي مضادّ وقائيّ — لا أن يقرأ سطرًا واحدًا.
-- ═══════════════════════════════════════════════════════════════════════════

alter table tooth_procedures
  add column if not exists chief_complaint         text,
  add column if not exists diagnosis_text          text,
  add column if not exists complications           text,
  add column if not exists anesthesia              text,
  add column if not exists antibiotic_prophylaxis  text,
  add column if not exists patient_education       text,
  add column if not exists next_visit_date         date;

comment on column tooth_procedures.chief_complaint is 'الشكوى الرئيسية على هذا السنّ.';
comment on column tooth_procedures.next_visit_date is 'الزيارة التالية المخطَّطة لهذا السنّ.';


-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) إرسال المريض إلى الطبيب — بنوع الزيارة ومدّتها والمرسِل، وبفحص الكشفية
--
-- `app_add_walk_in` (0050) تُبقى كما هي: تستعملها شاشة الاستقبال ولا سبب
-- لتغيير توقيعها. وهذه تغلّفها فتُضيف ما ينقص في **معاملة واحدة**: إضافةٌ
-- تنجح ثمّ تحديثٌ يفشل كانت ستضع المريض في الطابور بلا نوع زيارة ولا مرسِل.
--
-- **فحص فاتورة الكشفية:** المرجع يمنع إرسال المريض قبل أن تُفتَح له فاتورة
-- كشفية أو مراجعة، ويترك للموظّف تجاوزًا صريحًا. عندنا لم يكن تحقّقٌ إطلاقًا،
-- فيدخل المريض على الطبيب ويخرج بلا أن يمرّ على المحاسبة.
--
-- والفحص **يُغلق نفسه حين لا قواعد كشفية معرَّفة**: منشأةٌ لم تُعرِّف أصنافها
-- بعد لا يُعطَّل عندها الاستقبال كلّه — نفس مبدأ «دوامٌ غير مسجَّل يمرّ».
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_send_patient_to_doctor(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid default null,
  p_priority text default 'normal',
  p_note text default null,
  p_visit_type_value_id uuid default null,
  p_expected_duration_minutes integer default null,
  p_skip_consultation_check boolean default false
)
returns table (appointment_id uuid, queue_number integer, consultation_checked boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id       uuid;
  v_queue    integer;
  v_rules    integer := 0;
  v_paidlike integer := 0;
  v_checked  boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;

  if not coalesce(p_skip_consultation_check, false) then
    select count(*) into v_rules
      from consultation_fee_rules r
     where r.organization_id = p_organization_id
       and r.is_disabled = false
       and r.consultation_item_id is not null;

    if v_rules > 0 then
      v_checked := true;
      -- فاتورة اليوم تحمل صنف كشفية أو مراجعة من قواعد المنشأة
      select count(*) into v_paidlike
        from sales_invoices si
        join sales_invoice_items sii on sii.invoice_id = si.id
       where si.organization_id = p_organization_id
         and si.patient_id = p_patient_id
         and si.invoice_type = 'sale'
         and si.status <> 'void'
         and coalesce(si.is_temporary, false) = false
         and si.created_at >= date_trunc('day', now())
         and exists (
           select 1 from consultation_fee_rules r
            where r.organization_id = p_organization_id
              and r.is_disabled = false
              and sii.item_id in (r.consultation_item_id, r.follow_up_item_id));

      if v_paidlike = 0 then
        raise exception 'لم تُفتَح للمريض فاتورة كشفية أو مراجعة اليوم — افتحها أوّلًا، أو فعّل «عدم التحقق من فاتورة الكشفية» إن كنت متأكّدًا';
      end if;
    end if;
  end if;

  v_id := app_add_walk_in(
    p_organization_id, p_patient_id, p_doctor_id, p_clinic_id, p_priority, p_note);

  update appointments a
     set visit_type_value_id       = coalesce(p_visit_type_value_id, a.visit_type_value_id),
         expected_duration_minutes = p_expected_duration_minutes,
         sent_by_user_id           = auth.uid()
   where a.id = v_id
   returning a.queue_number into v_queue;

  return query select v_id, v_queue, v_checked;
end;
$$;

comment on function app_send_patient_to_doctor(uuid, uuid, uuid, uuid, text, text, uuid, integer, boolean) is
  'إرسال المريض إلى طابور الطبيب بنوع الزيارة ومدّتها والمرسِل، مع فحص فاتورة الكشفية وتجاوزٍ صريح.';

revoke all on function app_send_patient_to_doctor(uuid, uuid, uuid, uuid, text, text, uuid, integer, boolean)
  from public, anon;
grant execute on function app_send_patient_to_doctor(uuid, uuid, uuid, uuid, text, text, uuid, integer, boolean)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) تخطيط إجراء السنّ يقبل سياقه السريريّ
--
-- الدالّة تُعاد كما هي في 0141 عدا `insert` واحدة: تقرأ المفاتيح السبعة
-- الجديدة من نفس `jsonb` الذي تستقبله، فلا يتغيّر توقيعها ولا يتأثّر مستدعٍ
-- قديم — من لا يُرسل المفاتيح تبقى حقوله فارغة كما كانت.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_plan_tooth_procedures(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_procedures      jsonb,   -- [{tooth, tooth_type, item_id, surfaces[], note}]
  p_doctor_id       uuid default null,
  p_visit_id        uuid default null,
  p_branch_id       uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   jsonb;
  v_n     integer := 0;
  v_kind  text;
  v_tooth text;
  v_type  text;
  v_item  uuid;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if p_procedures is null or jsonb_typeof(p_procedures) <> 'array'
     or jsonb_array_length(p_procedures) = 0 then
    raise exception 'أضف إجراءً واحدًا على الأقل';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  for v_row in select * from jsonb_array_elements(p_procedures) loop
    v_tooth := v_row->>'tooth';
    v_type  := coalesce(v_row->>'tooth_type', 'permanent');
    v_item  := nullif(v_row->>'item_id','')::uuid;

    if v_item is not null then
      select dental_procedure_kind into v_kind from items
       where id = v_item and organization_id = p_organization_id;
      if not found then
        raise exception 'الخدمة غير موجودة في هذه المنشأة';
      end if;
    else
      v_kind := nullif(v_row->>'procedure_kind','');
    end if;

    -- الحقول السريرية مُضافة في 0154: تُقرأ من المفتاح إن وُجد وتبقى فارغة
    -- إن لم يُرسَل — فالمستدعي القديم يعمل كما كان بلا تغيير
    insert into tooth_procedures (organization_id, branch_id, patient_id, visit_id,
                                  doctor_id, tooth_number, tooth_type, surfaces,
                                  item_id, procedure_kind, status, note, planned_by,
                                  chief_complaint, diagnosis_text, complications,
                                  anesthesia, antibiotic_prophylaxis, patient_education,
                                  next_visit_date)
    values (p_organization_id, p_branch_id, p_patient_id, p_visit_id, p_doctor_id,
            v_tooth, v_type,
            coalesce((select array_agg(x) from jsonb_array_elements_text(
                        coalesce(v_row->'surfaces', '[]'::jsonb)) x), '{}'),
            v_item, v_kind, 'planned',
            nullif(btrim(coalesce(v_row->>'note','')), ''), auth.uid(),
            nullif(btrim(coalesce(v_row->>'chief_complaint','')), ''),
            nullif(btrim(coalesce(v_row->>'diagnosis_text','')), ''),
            nullif(btrim(coalesce(v_row->>'complications','')), ''),
            nullif(btrim(coalesce(v_row->>'anesthesia','')), ''),
            nullif(btrim(coalesce(v_row->>'antibiotic_prophylaxis','')), ''),
            nullif(btrim(coalesce(v_row->>'patient_education','')), ''),
            nullif(v_row->>'next_visit_date','')::date);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) أقرب موعد متاح
--
-- في النظام المرجعيّ زرٌّ يجد أوّل خانة فارغة للطبيب. عندنا كان الموظّف يبحث
-- بعينه في شبكة اليوم ثمّ ينتقل ليوم بعده — فيحجز في أوّل فراغٍ يراه لا في
-- أقرب فراغ فعليّ، ويترك فجوات في جدول الطبيب.
--
-- البحث في القاعدة لا في المتصفّح: المواعيد تتغيّر بين لحظة التحميل ولحظة
-- الاختيار، وشبكةٌ محمَّلة قبل دقيقتين تقترح خانةً حُجزت.
--
-- **لا تحجز الدالّة شيئًا** — تُعيد وقتًا مقترحًا فقط، والحجز يبقى بمساره
-- المعتاد بكل تحقّقاته. اقتراحٌ يحجز كان سيملأ الجدول بمواعيد لم تُؤكَّد.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_next_available_slot(
  p_organization_id uuid,
  p_doctor_id uuid,
  p_duration_minutes integer default 30,
  p_from timestamptz default null,
  p_days_ahead integer default 14,
  p_step_minutes integer default 5
)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_from     timestamptz;
  v_until    timestamptz;
  v_duration interval;
  v_step     interval;
  v_slot     timestamptz;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not exists (select 1 from doctors d
                  where d.id = p_doctor_id and d.organization_id = p_organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;

  v_from     := coalesce(p_from, now());
  v_until    := v_from + make_interval(days => greatest(coalesce(p_days_ahead, 14), 1));
  v_duration := make_interval(mins => greatest(coalesce(p_duration_minutes, 30), 1));
  v_step     := make_interval(mins => greatest(coalesce(p_step_minutes, 5), 1));

  -- الخانات المرشَّحة: داخل فترة دوامٍ غير محجوبة، وتتّسع للمدّة كاملة
  select c.slot into v_slot
    from doctor_working_hours w
    cross join lateral generate_series(
      greatest(w.starts_at, v_from), w.ends_at - v_duration, v_step) as c(slot)
   where w.doctor_id = p_doctor_id
     and coalesce(w.is_blocked, false) = false
     and w.ends_at > v_from
     and w.starts_at < v_until
     and c.slot + v_duration <= v_until
     -- لا تتقاطع مع فترة حجب للطبيب نفسه
     and not exists (
       select 1 from doctor_working_hours b
        where b.doctor_id = p_doctor_id
          and b.is_blocked = true
          and b.starts_at < c.slot + v_duration
          and b.ends_at   > c.slot)
     -- ولا مع موعدٍ قائم: الملغى ومن لم يحضر لا يشغلان الخانة
     and not exists (
       select 1 from appointments a
        where a.doctor_id = p_doctor_id
          and a.organization_id = p_organization_id
          and a.status not in ('cancelled_by_patient','cancelled_by_staff','no_show')
          and a.scheduled_start < c.slot + v_duration
          and a.scheduled_end   > c.slot)
   order by c.slot
   limit 1;

  return v_slot;
end;
$$;

comment on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer) is
  'أوّل خانة تتّسع للمدّة في دوام الطبيب بلا تقاطع مع حجبٍ أو موعد قائم. تقترح ولا تحجز.';

revoke all on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer)
  from public, anon;
grant execute on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
