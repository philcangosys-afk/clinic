-- ============================================================================
-- 0001_core_schema.sql
-- المرحلة 2 — المخطط الأساسي (Core Schema) لنظام إدارة العيادات الطبية
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) المؤسسات والفروع والعيادات والمستودعات (+ ربط زاتكا لكل عيادة/مستودع)
--   2) العضويات والأدوار والصلاحيات (متوافق حرفيًا مع shared/api.ts الحالي)
--   3) كتالوج المزايا (Feature Catalog) + مزايا كل مؤسسة (organization_features)
--   4) الجداول المرجعية العامة (Lookup) بدل عشرات الجداول المنفصلة
--   5) سجل التدقيق العام (audit_log)
--   6) دوال مساعدة + سياسات RLS لكل جدول
-- ============================================================================

-- ---------------------------------------------------------------------------
-- امتدادات مطلوبة
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) المؤسسات (Organizations)
-- ---------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_type text not null check (organization_type in ('clinic', 'medical_center')),
  created_by uuid not null references auth.users(id),
  legacy_full_access boolean not null default false,
  tax_number text,
  currency text not null default 'SAR' check (currency in ('SAR','AED','QAR','KWD','BHD','OMR')),
  default_vat_rate numeric(5,2) not null default 15.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) الفروع (Branches)
-- ---------------------------------------------------------------------------
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  code text,
  address text,
  city text,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- 3) شركات زاتكا (ZATCA) — ربط الفوترة الإلكترونية لكل عيادة/مستودع على حدة
--    (مكتشف من النظام القديم: كل عيادة وكل مستودع له ربط زاتكا مستقل)
-- ---------------------------------------------------------------------------
create table if not exists zatca_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  vat_number text not null,
  environment text not null default 'sandbox' check (environment in ('sandbox','simulation','production')),
  csr_config jsonb,               -- إعدادات شهادة زاتكا (بدون أي أسرار خام — قيم مرجعية فقط)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) المستودعات (Warehouses)
-- ---------------------------------------------------------------------------
create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  code text not null,
  name text not null,
  note text,
  zatca_company_id uuid references zatca_companies(id) on delete set null,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- 5) العيادات/الأقسام (Clinics) — تدعم عيادة رئيسية وفرعية + مستودعين لكل عيادة
--    (مكتشف من النظام القديم: عيادة = مستودع مورد + مستودع استهلاكي + زاتكا)
-- ---------------------------------------------------------------------------
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  parent_clinic_id uuid references clinics(id) on delete set null,
  name text not null,
  code text not null,
  clinic_type text,                         -- يربط لاحقًا بـ ClinicTypeProfile / clinic_exam_templates
  supplier_warehouse_id uuid references warehouses(id) on delete set null,
  consumable_warehouse_id uuid references warehouses(id) on delete set null,
  zatca_company_id uuid references zatca_companies(id) on delete set null,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- 6) العضويات (Organization Memberships) — متوافقة حرفيًا مع OrganizationMembership
--    في shared/api.ts الحالي حتى يعمل OrganizationAccessContext.tsx دون تعديل
-- ---------------------------------------------------------------------------
create table if not exists organization_memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  role_key text not null check (role_key in (
    'owner','organization_admin','branch_manager','doctor','nurse','receptionist',
    'pharmacist','lab_technician','radiology_technician','accountant','hr_manager','employee'
  )),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- دالة مساعدة: هل المستخدم الحالي عضو نشط في هذه المؤسسة؟
create or replace function app_is_member(target_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from organization_memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
  );
$$;

-- دالة مساعدة: هل المستخدم الحالي مالك/مدير المؤسسة؟
create or replace function app_is_org_admin(target_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from organization_memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role_key in ('owner','organization_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- 7) كتالوج المزايا (Feature Catalog) — قائمة ثابتة، تُعبَّأ لاحقًا من moduleRegistry
-- ---------------------------------------------------------------------------
create table if not exists feature_catalog (
  feature_key text primary key,
  name_ar text not null,
  name_en text not null,
  category_key text not null,
  description_ar text,
  is_core boolean not null default false,
  display_order int not null default 0
);

-- ---------------------------------------------------------------------------
-- 8) مزايا كل مؤسسة (Organization Features) — التحكم في ظهور المديولات
--    (يطابق شاشة "التحكم في ظهور مديولات كايزن" المكتشفة في المراجعة)
-- ---------------------------------------------------------------------------
create table if not exists organization_features (
  organization_id uuid not null references organizations(id) on delete cascade,
  feature_key text not null references feature_catalog(feature_key),
  enabled boolean not null default true,
  primary key (organization_id, feature_key)
);

-- ---------------------------------------------------------------------------
-- 9) صلاحيات الأعضاء الصريحة (Membership Permissions)
-- ---------------------------------------------------------------------------
create table if not exists membership_permissions (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null,
  granted boolean not null default true,
  primary key (organization_id, user_id, permission_key),
  foreign key (organization_id, user_id) references organization_memberships(organization_id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 10) حدود الخصم المسموح لكل مستخدم/صفة (لقطة 7)
-- ---------------------------------------------------------------------------
create table if not exists discount_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  applies_to_role text,                      -- صفة المستخدم (nullable لو الحد لمستخدم محدد)
  applies_to_user_id uuid references auth.users(id),
  min_percent numeric(5,2) not null default 0,
  max_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11) الجداول المرجعية العامة (Lookup) — بدل 22+ جدول لوائح منفصل
--     تغطي: مصادر المرضى، أنواع المرضى، الجنسيات، المدن، العناوين، المهن،
--     المؤهلات العلمية، جهات العمل، أنواع الملفات، أنواع الإجازات،
--     طرق الدفع، صناديق البيع، تصنيفات الفواتير، مصادر الفواتير، إلخ.
-- ---------------------------------------------------------------------------
create table if not exists lookup_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = فئة نظامية عامة لكل المؤسسات
  key text not null,                          -- مفتاح ثابت بالكود: 'patient_sources' | 'nationalities' | ...
  name_ar text not null,
  name_en text not null,
  unique (organization_id, key)
);

create table if not exists lookup_values (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references lookup_categories(id) on delete cascade,
  name_ar text not null,
  name_en text,
  code text,
  parent_value_id uuid references lookup_values(id) on delete set null,  -- لدعم الشجرة (فئات الأصناف/المصاريف)
  extra jsonb not null default '{}'::jsonb,   -- حقول إضافية خاصة بنوع اللائحة (مثال: عمولة طريقة الدفع)
  sort_order int not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 12) طرق الدفع كتخصص من lookup_values مع حقول مالية إضافية داخل extra:
--     { "commission_percent": 2.5, "max_amount": 1000, "iban": "...", "is_atm": true }
--     (لا حاجة لجدول منفصل — نموذج extra jsonb يكفي ويطابق الحقول المكتشفة في لقطة 25)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 13) محافظ المرضى (Patient Wallets) — كيان مستقل ومباشر
--     (تحسين متعمد عن النظام القديم الذي اعتمد على جدول طرق الدفع لنفس الغرض
--      وتسبب بخطأ تشغيلي فعلي شوهد أثناء المراجعة: "لا يوجد بنك معرف كمحفظة")
-- ---------------------------------------------------------------------------
create table if not exists patient_wallets (
  patient_id uuid primary key,   -- fk تُضاف في migration المرضى (0002) بعد إنشاء جدول patients
  organization_id uuid not null references organizations(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 14) سجل التدقيق العام (Audit Log) — يطابق "أرشيف المراقبة" المكتشف بالكامل
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  device_name text,
  action_type text not null check (action_type in ('add','update','delete','login','logout','print','export')),
  module text not null,             -- اسم الوحدة/الشاشة (مثال: 'patients', 'invoices')
  entity_id uuid,
  entity_title text,
  details text,
  reason text
);
create index if not exists idx_audit_log_org_date on audit_log (organization_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 15) تنبيهات التواريخ المنتهية الموحّدة (Expiring Alerts) — View قابل للتوسعة
--     يبدأ فارغًا هنا ويُغذّى بـ UNION ALL من كل جدول له تاريخ انتهاء
--     (تراخيص المنشأة، دفعات المخزون، عقود الاتفاقيات...) عند إضافتها لاحقًا
-- ---------------------------------------------------------------------------
create table if not exists facility_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  authority_name text not null,      -- المؤسسة/المنظومة الحكومية
  license_number text not null,
  start_date date,
  end_date date not null,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace view expiring_alerts as
  select organization_id, 'facility_license'::text as alert_type, authority_name as title, end_date as expires_on
  from facility_licenses
  where is_disabled = false;

-- ============================================================================
-- تفعيل Row Level Security (RLS) على كل الجداول أعلاه
-- ============================================================================
alter table organizations enable row level security;
alter table branches enable row level security;
alter table zatca_companies enable row level security;
alter table warehouses enable row level security;
alter table clinics enable row level security;
alter table organization_memberships enable row level security;
alter table organization_features enable row level security;
alter table membership_permissions enable row level security;
alter table discount_limits enable row level security;
alter table lookup_categories enable row level security;
alter table lookup_values enable row level security;
alter table patient_wallets enable row level security;
alter table audit_log enable row level security;
alter table facility_licenses enable row level security;
alter table feature_catalog enable row level security;

-- feature_catalog جدول مرجعي عام بلا بيانات حساسة: قراءة فقط لأي مستخدم موثّق، لا كتابة من العميل
create policy "feature_catalog_read_authenticated" on feature_catalog
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- سياسات organizations: يراها فقط أعضاؤها؛ ينشئها أي مستخدم موثّق (Onboarding)
-- ---------------------------------------------------------------------------
create policy "org_select_members" on organizations
  for select using (app_is_member(id));
create policy "org_insert_self" on organizations
  for insert with check (created_by = auth.uid());
create policy "org_update_admins" on organizations
  for update using (app_is_org_admin(id));

-- ---------------------------------------------------------------------------
-- سياسات عامة قياسية لبقية الجداول المرتبطة بـ organization_id مباشرة
-- (نمط موحّد: قراءة/كتابة لأعضاء المؤسسة، تعديل حساس لمدراء المؤسسة فقط عند الحاجة)
-- ---------------------------------------------------------------------------
create policy "branches_all_members" on branches
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "zatca_read_members" on zatca_companies
  for select using (app_is_member(organization_id));
create policy "zatca_write_admins" on zatca_companies
  for insert with check (app_is_org_admin(organization_id));
create policy "zatca_update_admins" on zatca_companies
  for update using (app_is_org_admin(organization_id));
create policy "zatca_delete_admins" on zatca_companies
  for delete using (app_is_org_admin(organization_id));

create policy "warehouses_all_members" on warehouses
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "clinics_all_members" on clinics
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "memberships_select_members" on organization_memberships
  for select using (app_is_member(organization_id));
create policy "memberships_manage_admins" on organization_memberships
  for insert with check (app_is_org_admin(organization_id) or user_id = auth.uid());
create policy "memberships_update_admins" on organization_memberships
  for update using (app_is_org_admin(organization_id));
create policy "memberships_delete_admins" on organization_memberships
  for delete using (app_is_org_admin(organization_id));

create policy "features_select_members" on organization_features
  for select using (app_is_member(organization_id));
create policy "features_manage_admins" on organization_features
  for insert with check (app_is_org_admin(organization_id));
create policy "features_update_admins" on organization_features
  for update using (app_is_org_admin(organization_id));

create policy "permissions_select_members" on membership_permissions
  for select using (app_is_member(organization_id));
create policy "permissions_manage_admins" on membership_permissions
  for all using (app_is_org_admin(organization_id)) with check (app_is_org_admin(organization_id));

create policy "discount_limits_all_members" on discount_limits
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "lookup_categories_read" on lookup_categories
  for select using (organization_id is null or app_is_member(organization_id));
create policy "lookup_categories_manage_admins" on lookup_categories
  for insert with check (app_is_org_admin(organization_id));
create policy "lookup_categories_update_admins" on lookup_categories
  for update using (app_is_org_admin(organization_id));

create policy "lookup_values_read" on lookup_values
  for select using (
    exists (
      select 1 from lookup_categories c
      where c.id = lookup_values.category_id
        and (c.organization_id is null or app_is_member(c.organization_id))
    )
  );
create policy "lookup_values_manage_admins" on lookup_values
  for all using (
    exists (
      select 1 from lookup_categories c
      where c.id = lookup_values.category_id and app_is_org_admin(c.organization_id)
    )
  );

create policy "wallets_all_members" on patient_wallets
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "audit_log_select_members" on audit_log
  for select using (app_is_member(organization_id));
create policy "audit_log_insert_members" on audit_log
  for insert with check (app_is_member(organization_id));

create policy "licenses_all_members" on facility_licenses
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- Trigger: عند إنشاء مؤسسة جديدة (Onboarding.tsx) — أنشئ تلقائيًا:
--   1) الفرع الرئيسي
--   2) عضوية "owner" لمنشئ المؤسسة
--   3) المزايا الافتراضية حسب نوع المنشأة (عيادة / مركز طبي)
-- ملاحظة: بدون هذا الـ Trigger، شاشة Onboarding.tsx الحالية تُنشئ صف organizations
-- فقط دون أي عضوية، فيبقى المستخدم عالقًا في "needsOnboarding" إلى الأبد — هذا
-- إصلاح لمنطق ناقص كان موجودًا في الهيكل الذي بناه المستخدم مسبقًا.
-- ============================================================================
create or replace function app_after_organization_created()
returns trigger
language plpgsql
security definer
as $$
declare
  main_branch_id uuid;
  clinic_default_features text[] := array[
    'core_dashboard','reception','appointments','patients','medical_records',
    'patient_journey','medical_services','departments_clinics','doctors',
    'prescriptions','billing_payments','hr','diagnosis','reports','audit_log','settings'
  ];
  medical_center_added_features text[] := array[
    'laboratory','radiology','pharmacy','dispensing','insurance_claims',
    'packages','accounting','procurement','inventory','messaging',
    'nursing','advanced_analytics'
  ];
  all_features text[];
  fkey text;
begin
  insert into branches (organization_id, name, is_main)
  values (new.id, new.name, true)
  returning id into main_branch_id;

  insert into organization_memberships (organization_id, user_id, branch_id, role_key, is_active)
  values (new.id, new.created_by, main_branch_id, 'owner', true);

  all_features := clinic_default_features;
  if new.organization_type = 'medical_center' then
    all_features := all_features || medical_center_added_features;
  end if;

  foreach fkey in array all_features loop
    insert into organization_features (organization_id, feature_key, enabled)
    values (new.id, fkey, true)
    on conflict (organization_id, feature_key) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_after_organization_created on organizations;
create trigger trg_after_organization_created
  after insert on organizations
  for each row execute function app_after_organization_created();

-- ============================================================================
-- تعبئة كتالوج المزايا (Feature Catalog) من moduleRegistry الحالي
-- ============================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order) values
  ('core_dashboard','الرئيسية','Dashboard','لوحة التحكم', true, 10),
  ('reception','الاستقبال والانتظار','Reception','الاستقبال والمواعيد', false, 20),
  ('appointments','المواعيد','Appointments','الاستقبال والمواعيد', false, 30),
  ('patients','المرضى','Patients','الاستقبال والمواعيد', false, 40),
  ('medical_records','السجل الطبي','Medical Records','الاستقبال والمواعيد', false, 50),
  ('patient_journey','رحلة المريض','Patient Journey','الاستقبال والمواعيد', false, 60),
  ('medical_services','الخدمات','Services','الكتالوج الطبي', false, 70),
  ('departments_clinics','الأقسام والعيادات','Departments & Clinics','الكتالوج الطبي', false, 80),
  ('doctors','الأطباء','Doctors','الكتالوج الطبي', false, 90),
  ('laboratory','المختبر','Laboratory','الكتالوج الطبي', false, 100),
  ('radiology','الأشعة والتصوير الطبي','Radiology','الكتالوج الطبي', false, 110),
  ('pharmacy','الصيدلية','Pharmacy','الصيدلية والوصفات', false, 120),
  ('prescriptions','الأدوية والوصفات','Prescriptions','الصيدلية والوصفات', false, 130),
  ('dispensing','صرف الأدوية','Dispensing','الصيدلية والوصفات', false, 140),
  ('insurance_claims','التأمين والمطالبات','Insurance Claims','المالية والتأمين', false, 150),
  ('billing_payments','الفوترة والمدفوعات','Billing & Payments','المالية والتأمين', false, 160),
  ('packages','الباقات','Packages','المالية والتأمين', false, 170),
  ('hr','الموظفون','HR','الموارد البشرية', false, 180),
  ('diagnosis','الأمراض والتشخيص','Diagnosis','الإدارة', false, 280),
  ('content','المحتوى','Content','الإدارة', false, 290),
  ('reports','التقارير','Reports','الإدارة', false, 300),
  ('advanced_analytics','التحليلات المتقدمة','Advanced Analytics','الإدارة', false, 305),
  ('accounting','الحسابات ودليل الحسابات','Accounting','التشغيل والإدارة', false, 310),
  ('procurement','المشتريات والموردون','Procurement','التشغيل والإدارة', false, 320),
  ('inventory','حركات المخزون','Inventory','التشغيل والإدارة', false, 330),
  ('messaging','الرسائل والتنبيهات','Messaging','التشغيل والإدارة', false, 340),
  ('audit_log','سجل التدقيق','Audit Log','التشغيل والإدارة', false, 350),
  ('settings','الإعدادات','Settings','الإعدادات', true, 1000),
  ('nursing','التمريض','Nursing','الكتالوج الطبي', false, 115),
  ('emergency','الطوارئ','Emergency','الكتالوج الطبي', false, 116),
  ('inpatient','التنويم','Inpatient','الكتالوج الطبي', false, 117),
  ('procedures','الإجراءات','Procedures','الكتالوج الطبي', false, 118),
  ('referrals','الإحالات','Referrals','الكتالوج الطبي', false, 119)
on conflict (feature_key) do nothing;

-- ============================================================================
-- نهاية 0001_core_schema.sql
-- الخطوة التالية: 0002_patients_doctors_appointments.sql
-- ============================================================================
