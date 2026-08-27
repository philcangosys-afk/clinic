-- ============================================================================
-- 0008_hr_payroll.sql
-- المرحلة 2 (تابع) — الموارد البشرية والرواتب
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0007 مباشرة (يعتمد عليها جميعًا)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) بيانات الموظفين (لقطة 78) — إجمالي الراتب محسوب تلقائيًا
--   2) وثائق/تراخيص الموظفين (إقامة، رخصة مهنية...) تُغذّي التنبيهات الموحّدة
--   3) إكمال ربط financial_vouchers.employee_ref_id بجدول employees (كان معلّقًا
--      منذ 0003 بتعليق صريح "سيُربط لاحقًا")، مع قيد يضمن وجود موظف لكل صرف راتب
--   4) توسعة expiring_alerts (من 0001، وسّعها 0003 سابقًا) لتشمل وثائق الموظفين
--      وانتهاء عضويات التأمين — إتمام لنمط "شاشة التنبيهات الموحّدة" (لقطة 80)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) بيانات الموظفين (لقطة 78) — جاهز للرواتب فورًا
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,   -- ربط اختياري بحساب دخول (نفس نمط doctors.user_id)
  file_number bigserial,
  name_ar text not null,
  name_en text,
  mobile_1 text,
  phone_1 text,
  source_country_phone_code text,
  profession_value_id uuid references lookup_values(id),
  status text not null default 'active' check (status in ('active','terminated')),

  basic_salary numeric(12,2) not null default 0,
  housing_allowance numeric(12,2) not null default 0,
  transportation_allowance numeric(12,2) not null default 0,
  other_allowances numeric(12,2) not null default 0,
  total_salary numeric(12,2) generated always as (
    basic_salary + housing_allowance + transportation_allowance + other_allowances
  ) stored,

  job_number text,
  birth_date date,
  hire_date date,
  termination_date date,
  national_id text,
  nationality_value_id uuid references lookup_values(id),

  is_disabled boolean not null default false,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, file_number)
);
create index if not exists idx_employees_org on employees (organization_id);

-- "عدد الأيام" في الشاشة القديمة يعتمد على current_date فلا يمكن أن يكون عمودًا
-- محسوبًا مخزَّنًا (STORED) — يُقدَّم كدالة تُستدعى وقت العرض بدل ذلك
create or replace function app_employee_days_employed(p_employee_id uuid)
returns int
language sql
stable
security definer
as $$
  select case
    when e.termination_date is not null and e.hire_date is not null then (e.termination_date - e.hire_date)
    when e.hire_date is not null then (current_date - e.hire_date)
    else null
  end
  from employees e
  where e.id = p_employee_id;
$$;

-- ---------------------------------------------------------------------------
-- 2) وثائق/تراخيص الموظفين (إقامة، رخصة مهنية، شهادة صحية...)
-- ---------------------------------------------------------------------------
create table if not exists employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  document_type_value_id uuid references lookup_values(id),
  document_number text,
  issue_date date,
  expiry_date date,
  storage_path text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_employee_documents_employee on employee_documents (employee_id);
create index if not exists idx_employee_documents_expiry on employee_documents (organization_id, expiry_date) where expiry_date is not null;

-- ---------------------------------------------------------------------------
-- 3) إكمال ربط صرف الرواتب بجدول الموظفين (كان عمود بلا FK منذ 0003)
-- ---------------------------------------------------------------------------
alter table financial_vouchers
  add constraint financial_vouchers_employee_fk foreign key (employee_ref_id) references employees(id) on delete set null;

-- قاعدة عمل موثّقة: "صرف راتب" يمر من نفس سندات الصرف كنوع خاص، مرتبط بموظف
-- إجباريًا (بدل مورد) — نفرضها الآن كقيد صريح بدل الاعتماد على انضباط الواجهة فقط
alter table financial_vouchers
  add constraint chk_salary_requires_employee check (voucher_type <> 'salary' or employee_ref_id is not null);

-- ---------------------------------------------------------------------------
-- 4) توسعة شاشة التنبيهات الموحّدة لتشمل وثائق الموظفين وعضويات التأمين
-- ---------------------------------------------------------------------------
create or replace view expiring_alerts as
  select organization_id, 'facility_license'::text as alert_type, authority_name as title, end_date as expires_on
  from facility_licenses
  where is_disabled = false
  union all
  select organization_id, 'inventory_lot_expiry'::text as alert_type,
         coalesce(lot_number, 'دفعة بلا رقم') as title, expiry_date as expires_on
  from inventory_lots
  where expiry_date is not null and qty_remaining > 0
  union all
  select ed.organization_id, 'employee_document_expiry'::text as alert_type,
         e.name_ar as title, ed.expiry_date as expires_on
  from employee_documents ed
  join employees e on e.id = ed.employee_id
  where ed.expiry_date is not null and e.is_disabled = false
  union all
  select pim.organization_id, 'insurance_membership_expiry'::text as alert_type,
         p.name_ar as title, pim.expiry_date as expires_on
  from patient_insurance_memberships pim
  join patients p on p.id = pim.patient_id
  where pim.expiry_date is not null and pim.is_active = true;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table employees enable row level security;
alter table employee_documents enable row level security;

create policy "employees_all_members" on employees
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "employee_documents_all_members" on employee_documents
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ---------------------------------------------------------------------------
-- أنواع وثائق الموظفين القابلة للإدارة
-- ---------------------------------------------------------------------------
insert into lookup_categories (organization_id, key, name_ar, name_en) values
  (null, 'employee_document_types', 'أنواع وثائق الموظفين', 'Employee Document Types')
on conflict (key) where organization_id is null do nothing;

insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('إقامة','Residency Permit',10),
  ('رخصة مهنية','Professional License',20),
  ('شهادة صحية','Health Certificate',30),
  ('عقد عمل','Employment Contract',40),
  ('تأمين طبي','Medical Insurance',50),
  ('أخرى','Other',60)
) as v(name_ar, name_en, sort_order)
where c.key = 'employee_document_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- ============================================================================
-- نهاية 0008_hr_payroll.sql
-- الخطوة التالية: 0009_messaging_sms.sql
--   (قوالب الرسائل لكل حدث، أرشيف الرسائل، رصيد SMS المدفوع مسبقًا)
-- ============================================================================
