-- ============================================================================
-- 0002_patients_doctors_appointments.sql
-- المرحلة 2 (تابع) — ملف المريض، ملف الطبيب، المواعيد، الحالة الصحية
-- يُنفَّذ بعد 0001_core_schema.sql مباشرة، بنفس طريقة SQL Editor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) الأطباء (Doctors) — يطابق نموذج "بيانات الطبيب" الموثّق (~35 حقل)
-- ---------------------------------------------------------------------------
create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id),          -- ربط اختياري بحساب دخول للطبيب
  file_number bigserial,
  clinic_id uuid references clinics(id) on delete set null,
  name_ar text not null,
  name_en text,
  job_title text,
  specialty_value_id uuid references lookup_values(id),
  medical_record_sections jsonb not null default '[]'::jsonb,  -- أنواع العيادات/التخصصات المرخّص بها للطبيب
  address text,
  id_number text,
  gender text check (gender in ('male','female')),
  nationality_value_id uuid references lookup_values(id),
  mobile_number text,
  email text,
  birth_date date,

  -- حالة الملف والحجز
  is_enabled boolean not null default true,
  disabled_from_booking boolean not null default false,
  receive_appointment_confirmation_sms boolean not null default true,
  hide_patient_messages boolean not null default false,
  force_session_selection boolean not null default false,
  allowed_booking_user_ids uuid[],                 -- فارغ/NULL = مسموح للجميع

  -- إعدادات الكشفية الخاصة بالطبيب (تطغى على إعداد المؤسسة العام إن وُجدت)
  consultation_fee_renewal_days int,
  free_reviews_count int,
  consultation_fee_service_codes jsonb not null default '[]'::jsonb,

  -- إعدادات الموعد
  default_appointment_duration_minutes int,        -- NULL = استخدام إعداد المؤسسة العام
  patient_waiting_minutes int,
  invoice_source_value_id uuid references lookup_values(id),

  -- حقول تأمين إضافية حرة (5 خانات كما في النظام القديم)
  insurance_extra_fields jsonb not null default '{}'::jsonb,

  -- هيئة التخصص
  specialty_authority text,
  specialty_authority_number text,

  -- توقيعات/أختام
  use_default_signature boolean not null default true,
  signature_url text,
  use_default_stamp boolean not null default true,
  stamp_url text,
  order_stamp_url text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, file_number)
);
create index if not exists idx_doctors_org on doctors (organization_id);

-- أوقات دوام الطبيب (شبكة Work/Block التي تُبنى منها شاشة جدول المواعيد)
create table if not exists doctor_working_hours (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  is_blocked boolean not null default false,   -- true = Block (خارج الدوام) / false = Work (متاح)
  created_at timestamptz not null default now()
);
create index if not exists idx_doctor_hours_doctor on doctor_working_hours (doctor_id, starts_at);

-- ---------------------------------------------------------------------------
-- 2) الحالة الصحية المرجعية (Health Conditions) — قائمة الأمراض الكاملة الموثّقة
-- ---------------------------------------------------------------------------
create table if not exists health_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = قائمة نظامية عامة
  name_ar text not null,
  name_en text not null,
  sort_order int not null default 0
);

-- ---------------------------------------------------------------------------
-- 3) المرضى (Patients) — يطابق نموذج "ملف المريض" الموثّق بالكامل (~50 حقل)
-- ---------------------------------------------------------------------------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  file_number bigserial,
  file_date timestamptz not null default now(),

  -- الهوية الأساسية
  name_ar text not null,
  name_en text,
  birth_date date,
  gender text check (gender in ('male','female')),
  nationality_value_id uuid references lookup_values(id),
  profession_value_id uuid references lookup_values(id),
  marital_status text,
  city_value_id uuid references lookup_values(id),
  address text,
  district text,
  street text,
  building_number text,
  postal_code text,
  id_type text,
  id_number text,
  mobile_number text,
  emergency_number text,
  phone_1 text,
  phone_2 text,
  work_entity_value_id uuid references lookup_values(id),
  tax_number text,
  is_tax_registered boolean not null default false,

  -- الاتصال والمصدر
  customer_type_value_id uuid references lookup_values(id),
  source_value_id uuid references lookup_values(id),
  source_details text,
  treating_doctor_id uuid references doctors(id) on delete set null,
  participating_doctor_ids uuid[] not null default '{}',
  children_count int,
  educational_qualification_value_id uuid references lookup_values(id),
  email_1 text,
  email_2 text,
  father_whatsapp text,
  facebook text,
  website text,
  default_discount_percent numeric(5,2) not null default 0,
  general_note text,

  -- التأمين (تفصيل أعمق يُبنى في موديول التأمين المستقل لاحقًا)
  insurance_company_name text,
  insurance_policy_number text,
  insurance_policy_category text,
  insurance_membership_number text,
  insurance_relation text,
  insurance_membership_expiry date,

  file_type_value_id uuid references lookup_values(id),
  passport_number text,
  father_id_number text,
  mother_id_number text,
  blood_type text,
  other_id_type text,
  other_id_number text,
  guarantor_name text,
  guarantor_number text,
  guarantor_details text,
  nearest_person_name text,
  nearest_person_number text,
  gln_number text,
  local_order_weight_kg numeric(6,2),

  -- الحجب الجزئي (4 مفاتيح مستقلة بسبب لكل منها — موثّق من مركز حجوبات المرضى)
  block_invoices boolean not null default false,
  block_invoices_reason text,
  block_appointments boolean not null default false,
  block_appointments_reason text,
  block_sms boolean not null default false,
  block_sms_reason text,
  block_file boolean not null default false,
  block_file_reason text,

  e_signature_enabled boolean not null default false,
  electronic_signature_url text,
  is_newborn boolean not null default false,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, file_number)
);
create index if not exists idx_patients_org on patients (organization_id);
create index if not exists idx_patients_name on patients using gin (to_tsvector('simple', coalesce(name_ar,'') || ' ' || coalesce(name_en,'')));
create index if not exists idx_patients_mobile on patients (mobile_number);

-- الآن بعد وجود جدول patients نربط قيد المفتاح الأجنبي لمحافظ المرضى (من 0001)
alter table patient_wallets
  add constraint patient_wallets_patient_fk foreign key (patient_id) references patients(id) on delete cascade;

-- سجلات الحالة الصحية لكل مريض (checkbox + ملاحظة لكل مرض)
create table if not exists patient_health_conditions (
  patient_id uuid not null references patients(id) on delete cascade,
  condition_id uuid not null references health_conditions(id) on delete cascade,
  is_checked boolean not null default true,
  note text,
  primary key (patient_id, condition_id)
);

-- الحقول الحرة الأخرى في "الحالة الصحية" (سوابق شخصية/علاجية/عائلية/تحسس/عادات)
create table if not exists patient_medical_history (
  patient_id uuid primary key references patients(id) on delete cascade,
  personal_history text,
  treatment_history text,
  family_history text,
  drug_allergy text,           -- أو NKA / NO كقيمة خاصة
  special_habits text,
  health_status_notes text,
  updated_at timestamptz not null default now()
);

-- ملاحظات/متابعة المريض عبر الزمن (Timeline of Notes — مختلف عن الحقل الفردي general_note)
create table if not exists patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  title text,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  is_disabled boolean not null default false
);

-- ملفات خارجية محجوبة قبل حتى إنشاء ملف مريض (Blacklist)
create table if not exists blocked_external_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text,
  mobile_number text,
  phone_number text,
  id_number text,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) المواعيد (Appointments) — بحالات متعددة + طوابع زمنية لكل مرحلة استقبال
-- ---------------------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  clinic_id uuid references clinics(id) on delete set null,
  doctor_id uuid not null references doctors(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,

  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,

  status text not null default 'scheduled' check (status in (
    'new','scheduled','confirmed','unconfirmed','arrived','checked_in',
    'called','in_progress','completed','no_show','cancelled_by_patient','walk_in','waiting'
  )),

  -- الطوابع الزمنية لكل مرحلة (نظام الدور: استقبال1→استقبال2→نداء→دخول→خروج)
  checked_in_1_at timestamptz,
  checked_in_2_at timestamptz,
  called_at timestamptz,
  entered_at timestamptz,
  left_at timestamptz,

  visit_type_value_id uuid references lookup_values(id),
  source_value_id uuid references lookup_values(id),
  note text,
  sms_reminder_sent boolean not null default false,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_appointments_doctor_time on appointments (doctor_id, scheduled_start);
create index if not exists idx_appointments_patient on appointments (patient_id, scheduled_start desc);
create index if not exists idx_appointments_org_status on appointments (organization_id, status);

-- قائمة الانتظار (Waitlist) منفصلة عن الجدول الزمني — بلا موعد محدد
create table if not exists appointment_waitlist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  specialty_value_id uuid references lookup_values(id),
  registration_note text,
  status text not null default 'waiting' check (status in ('waiting','booked','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- تفعيل RLS
-- ============================================================================
alter table doctors enable row level security;
alter table doctor_working_hours enable row level security;
alter table health_conditions enable row level security;
alter table patients enable row level security;
alter table patient_health_conditions enable row level security;
alter table patient_medical_history enable row level security;
alter table patient_notes enable row level security;
alter table blocked_external_contacts enable row level security;
alter table appointments enable row level security;
alter table appointment_waitlist enable row level security;

create policy "doctors_all_members" on doctors
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "doctor_hours_all_members" on doctor_working_hours
  for all using (exists (select 1 from doctors d where d.id = doctor_working_hours.doctor_id and app_is_member(d.organization_id)))
  with check (exists (select 1 from doctors d where d.id = doctor_working_hours.doctor_id and app_is_member(d.organization_id)));

create policy "health_conditions_read" on health_conditions
  for select using (organization_id is null or app_is_member(organization_id));
create policy "health_conditions_manage_admins" on health_conditions
  for all using (app_is_org_admin(organization_id)) with check (app_is_org_admin(organization_id));

create policy "patients_all_members" on patients
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "patient_conditions_all_members" on patient_health_conditions
  for all using (exists (select 1 from patients p where p.id = patient_health_conditions.patient_id and app_is_member(p.organization_id)))
  with check (exists (select 1 from patients p where p.id = patient_health_conditions.patient_id and app_is_member(p.organization_id)));

create policy "patient_history_all_members" on patient_medical_history
  for all using (exists (select 1 from patients p where p.id = patient_medical_history.patient_id and app_is_member(p.organization_id)))
  with check (exists (select 1 from patients p where p.id = patient_medical_history.patient_id and app_is_member(p.organization_id)));

create policy "patient_notes_all_members" on patient_notes
  for all using (exists (select 1 from patients p where p.id = patient_notes.patient_id and app_is_member(p.organization_id)))
  with check (exists (select 1 from patients p where p.id = patient_notes.patient_id and app_is_member(p.organization_id)));

create policy "blocked_contacts_all_members" on blocked_external_contacts
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "appointments_all_members" on appointments
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "waitlist_all_members" on appointment_waitlist
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- نهاية 0002_patients_doctors_appointments.sql
-- الخطوة التالية: 0003_billing_inventory.sql (الفوترة والمخزون)
-- ============================================================================
