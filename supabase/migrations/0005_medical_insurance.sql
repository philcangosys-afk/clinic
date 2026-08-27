-- ============================================================================
-- 0005_medical_insurance.sql
-- المرحلة 2 (تابع) — التأمين الطبي: بوليصات، مطالبات، ونماذج UCAF/DCAF/OCAF
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0004 مباشرة (يعتمد عليها جميعًا)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) إعدادات نظام التأمين الطبي التفصيلية (لقطة 87)
--   2) شركات التأمين (رئيسية/فرعية) والبوليصات وعضويات المرضى فيها
--   3) متابعة حالات الموافقات المسبقة (Pre-authorization Tracking)
--   4) فواتير التأمين المجمعة (Batch Claims)
--   5) نماذج UCAF/DCAF/OCAF الموحّدة (رأس علائقي + بيانات الحقول الديناميكية JSONB
--      لأن كل نموذج من الثلاثة له حقول مختلفة حسب معايير مجلس الضمان الصحي CCHI،
--      + بنود مطالبة علائقية منفصلة لفرض منع تكرار الخدمة في نفس النموذج)
--   6) Trigger: إنشاء نماذج التأمين تلقائيًا عند فواتير الكشفية/المراجعة (لقطة 87)
--      — يربط منطق 0004 (consultation_fee_rules) بمنطق هذا الملف مباشرة
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) إعدادات نظام التأمين الطبي التفصيلية (لقطة 87)
-- ---------------------------------------------------------------------------
create table if not exists insurance_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  vat_responsibility text not null default 'patient' check (vat_responsibility in ('patient','insurance_company','by_item_category')),
  default_ucaf_template text not null default 'UCAF-2',
  default_dcaf_template text not null default 'DCAF-2',
  prevent_duplicate_policy_name boolean not null default true,
  prevent_duplicate_services_in_claim_line boolean not null default true,
  notify_treating_doctor_on_changes boolean not null default true,
  notify_form_owner_on_changes boolean not null default true,
  notify_specific_user_ids_on_doctor_edits uuid[] not null default '{}',
  notify_roles_on_doctor_edits text[] not null default '{}',
  disable_patient_max_copay_field boolean not null default false,
  auto_create_forms_on_consultation_invoice boolean not null default true,
  exclude_offer_discount_invoices_from_auto_create boolean not null default true,
  allow_doctor_edit_radiology_data boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) شركات التأمين (تدعم شركة رئيسية + شركات فرعية/شبكات تابعة)
-- ---------------------------------------------------------------------------
create table if not exists insurance_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_company_id uuid references insurance_companies(id) on delete set null,
  name_ar text not null,
  name_en text,
  tax_number text,
  phone text,
  email text,
  address text,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_insurance_companies_org on insurance_companies (organization_id);

-- بوليصات كل شركة — "منع تكرار اسم البوليصة لنفس شركة التأمين في نفس الكلاس" (لقطة 87)
create table if not exists insurance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_id uuid not null references insurance_companies(id) on delete cascade,
  policy_name text not null,
  policy_number text,
  policy_class text,                                   -- "رقم/اسم الفئة" (Class)
  default_copay_percent numeric(5,2) not null default 0,
  default_max_amount numeric(12,2),
  default_consultation_limit numeric(12,2),
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, policy_name, policy_class)
);
create index if not exists idx_insurance_policies_company on insurance_policies (company_id);

-- عضوية كل مريض في بوليصة معينة (المصدر العلائقي؛ الحقول النصية السريعة في
-- patients من 0002 تبقى للعرض المختصر، وهذا الجدول هو مصدر الحقيقة التفصيلي)
create table if not exists patient_insurance_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  policy_id uuid not null references insurance_policies(id) on delete cascade,
  membership_number text not null,
  relation text not null default 'self' check (relation in ('self','spouse','child','other')),
  copay_percent_override numeric(5,2),
  max_amount_override numeric(12,2),
  expiry_date date,
  eligibility_status text not null default 'unknown' check (eligibility_status in ('eligible','not_eligible','unknown','expired')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (patient_id, policy_id, membership_number)
);
create index if not exists idx_patient_memberships_patient on patient_insurance_memberships (patient_id);

-- ---------------------------------------------------------------------------
-- 3) متابعة حالات الموافقات المسبقة (Pre-authorization Tracking)
-- ---------------------------------------------------------------------------
create table if not exists insurance_preauthorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  membership_id uuid references patient_insurance_memberships(id) on delete set null,
  doctor_id uuid references doctors(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  service_description text,
  requested_amount numeric(12,2),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  approval_number text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  note text,
  created_by uuid references auth.users(id)
);
create index if not exists idx_preauth_org_status on insurance_preauthorizations (organization_id, status);

-- ---------------------------------------------------------------------------
-- 4) فواتير التأمين المجمعة (Batch Claims)
-- ---------------------------------------------------------------------------
create table if not exists insurance_claim_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_id uuid not null references insurance_companies(id) on delete restrict,
  batch_number bigserial,
  period_start date,
  period_end date,
  total_amount numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','submitted','accepted','rejected','partially_paid')),
  submitted_at timestamptz,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, batch_number)
);

create table if not exists insurance_claim_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references insurance_claim_batches(id) on delete cascade,
  sales_invoice_id uuid not null references sales_invoices(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  unique (batch_id, sales_invoice_id)
);
create index if not exists idx_claim_batch_items_batch on insurance_claim_batch_items (batch_id);

-- ---------------------------------------------------------------------------
-- 5) نماذج المطالبات الموحّدة UCAF/DCAF/OCAF
--    رأس علائقي مشترك + form_data (jsonb) للحقول الخاصة بكل نموذج حسب معايير
--    CCHI (تختلف الحقول جوهريًا بين العام/الأسنان/العيون) — بدل 3 جداول منفصلة
--    مكررة الشكل، بنفس نهج الفحص الطبي الديناميكي المعتمد للعيادات.
-- ---------------------------------------------------------------------------
create table if not exists insurance_claim_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  form_type text not null check (form_type in ('ucaf','dcaf','ocaf')),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  membership_id uuid references patient_insurance_memberships(id) on delete set null,
  sales_invoice_id uuid references sales_invoices(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  form_data jsonb not null default '{}'::jsonb,
  auto_created boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_claim_forms_patient on insurance_claim_forms (patient_id, created_at desc);
create index if not exists idx_claim_forms_org_type on insurance_claim_forms (organization_id, form_type, status);

-- بنود المطالبة (خدمات) — "منع تكرار الخدمات في نفس سطر المطالبة" عبر قيد فريد
create table if not exists insurance_claim_form_items (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references insurance_claim_forms(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  service_code text,
  description text,
  qty numeric(12,2) not null default 1,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (form_id, item_id)
);

-- تحديد الخانات الإجبارية لكل نموذج (رقمية/نصية) بشكل منفصل لكل UCAF/DCAF/OCAF
create table if not exists insurance_form_field_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  form_type text not null check (form_type in ('ucaf','dcaf','ocaf')),
  field_key text not null,
  field_type text not null default 'text' check (field_type in ('text','numeric')),
  is_required boolean not null default false,
  unique (organization_id, form_type, field_key)
);

-- ============================================================================
-- Trigger: إنشاء نماذج التأمين تلقائيًا عند فواتير الكشفية/المراجعة (لقطة 87)
-- يعتمد على consultation_fee_rules من 0004 لتحديد أن الصنف "كشفية/مراجعة"،
-- ويستثني فواتير العروض حسب الإعداد، ويحدد نوع النموذج (UCAF/DCAF/OCAF)
-- بحسب clinic_type للعيادة (heuristic بسيط، قابل للتخصيص لاحقًا من لوحة الإدارة).
-- ============================================================================
create or replace function app_auto_create_insurance_claim_form()
returns trigger
language plpgsql
security definer
as $$
declare
  v_invoice sales_invoices%rowtype;
  v_settings insurance_settings%rowtype;
  v_is_consultation boolean;
  v_clinic_type text;
  v_form_type text;
  v_membership_id uuid;
begin
  select * into v_invoice from sales_invoices where id = new.invoice_id;
  if v_invoice.id is null or not v_invoice.is_insurance_invoice then
    return new;
  end if;

  select * into v_settings from insurance_settings where organization_id = v_invoice.organization_id;
  if v_settings.organization_id is null or not v_settings.auto_create_forms_on_consultation_invoice then
    return new;
  end if;

  if v_settings.exclude_offer_discount_invoices_from_auto_create and coalesce(v_invoice.offer_percent, 0) > 0 then
    return new;
  end if;

  select exists (
    select 1 from consultation_fee_rules r
    where r.organization_id = v_invoice.organization_id
      and r.is_disabled = false
      and (r.consultation_item_id = new.item_id or r.follow_up_item_id = new.item_id)
  ) into v_is_consultation;

  if not v_is_consultation then
    return new;
  end if;

  select clinic_type into v_clinic_type from clinics where id = v_invoice.clinic_id;
  v_form_type := case
    when v_clinic_type ilike '%dental%' or v_clinic_type ilike '%أسنان%' then 'dcaf'
    when v_clinic_type ilike '%eye%' or v_clinic_type ilike '%ophthal%' or v_clinic_type ilike '%عيون%' then 'ocaf'
    else 'ucaf'
  end;

  select id into v_membership_id from patient_insurance_memberships
    where patient_id = v_invoice.patient_id and is_active = true
    order by created_at desc limit 1;

  -- لا نُنشئ نموذجًا مكررًا لنفس الفاتورة إن وُجد أصلًا
  if not exists (select 1 from insurance_claim_forms where sales_invoice_id = v_invoice.id) then
    insert into insurance_claim_forms (
      organization_id, form_type, patient_id, doctor_id, clinic_id,
      membership_id, sales_invoice_id, status, auto_created
    ) values (
      v_invoice.organization_id, v_form_type, v_invoice.patient_id, v_invoice.doctor_id, v_invoice.clinic_id,
      v_membership_id, v_invoice.id, 'draft', true
    );
  end if;

  return new;
end;
$$;
drop trigger if exists trg_auto_create_insurance_claim_form on sales_invoice_items;
create trigger trg_auto_create_insurance_claim_form
  after insert on sales_invoice_items
  for each row execute function app_auto_create_insurance_claim_form();

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table insurance_settings enable row level security;
alter table insurance_companies enable row level security;
alter table insurance_policies enable row level security;
alter table patient_insurance_memberships enable row level security;
alter table insurance_preauthorizations enable row level security;
alter table insurance_claim_batches enable row level security;
alter table insurance_claim_batch_items enable row level security;
alter table insurance_claim_forms enable row level security;
alter table insurance_claim_form_items enable row level security;
alter table insurance_form_field_requirements enable row level security;

create policy "insurance_settings_read_members" on insurance_settings
  for select using (app_is_member(organization_id));
create policy "insurance_settings_insert_admins" on insurance_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "insurance_settings_update_admins" on insurance_settings
  for update using (app_is_org_admin(organization_id));

create policy "insurance_companies_all_members" on insurance_companies
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "insurance_policies_all_members" on insurance_policies
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "patient_memberships_all_members" on patient_insurance_memberships
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "preauth_all_members" on insurance_preauthorizations
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "claim_batches_all_members" on insurance_claim_batches
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "claim_batch_items_all_members" on insurance_claim_batch_items
  for all using (exists (select 1 from insurance_claim_batches b where b.id = insurance_claim_batch_items.batch_id and app_is_member(b.organization_id)))
  with check (exists (select 1 from insurance_claim_batches b where b.id = insurance_claim_batch_items.batch_id and app_is_member(b.organization_id)));

create policy "claim_forms_all_members" on insurance_claim_forms
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "claim_form_items_all_members" on insurance_claim_form_items
  for all using (exists (select 1 from insurance_claim_forms f where f.id = insurance_claim_form_items.form_id and app_is_member(f.organization_id)))
  with check (exists (select 1 from insurance_claim_forms f where f.id = insurance_claim_form_items.form_id and app_is_member(f.organization_id)));

create policy "form_requirements_read_members" on insurance_form_field_requirements
  for select using (app_is_member(organization_id));
create policy "form_requirements_manage_admins" on insurance_form_field_requirements
  for all using (app_is_org_admin(organization_id)) with check (app_is_org_admin(organization_id));

-- ============================================================================
-- نهاية 0005_medical_insurance.sql
-- الخطوة التالية: 0006_dynamic_exam_builder.sql
--   (clinic_exam_templates بمخطط JSON Schema لكل تخصص، patient_visits مع exam_data
--    jsonb، dental_chart_entries، body_diagram_annotations)
-- ============================================================================
