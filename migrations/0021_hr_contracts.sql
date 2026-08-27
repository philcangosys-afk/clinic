-- ============================================================================
-- 0021_hr_contracts.sql
-- المرحلة 6.3 — الموارد البشرية الموسّعة: العقود والملفات
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0020 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) عقود العمل — سجل مُؤرشَف بإصدارات (كل تجديد/تعديل عقد جديد يرتبط بالسابق)
-- ---------------------------------------------------------------------------
create table if not exists employee_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  previous_contract_id uuid references employee_contracts(id) on delete set null,  -- العقد الذي جدَّده/عدَّله هذا العقد
  contract_number text,
  contract_type text not null default 'permanent' check (contract_type in ('permanent','fixed_term','probation')),
  start_date date not null,
  end_date date,    -- null يعني عقد غير محدد المدة (permanent) — إلزامي لـ fixed_term/probation
  basic_salary numeric(12,2) not null default 0,   -- لقطة من الراتب وقت توقيع هذا العقد (لا يتبع employees.basic_salary لاحقًا)
  status text not null default 'active' check (status in ('active','renewed','terminated','expired')),
  storage_path text,     -- مسار ملف العقد الممسوح (PDF/صورة)
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contract_type = 'permanent' or end_date is not null),
  check (end_date is null or end_date >= start_date)
);
create index if not exists idx_employee_contracts_employee on employee_contracts (employee_id, start_date desc);
create index if not exists idx_employee_contracts_org on employee_contracts (organization_id);
create index if not exists idx_employee_contracts_expiry on employee_contracts (organization_id, end_date) where end_date is not null;

-- ---------------------------------------------------------------------------
-- عند إضافة عقد جديد يحمل previous_contract_id (تجديد/تعديل) ← يُوسَم العقد
-- السابق تلقائيًا بالحالة 'renewed' — فلا يبقى "نشطًا" عقدان لنفس الموظف بالخطأ
-- ---------------------------------------------------------------------------
create or replace function app_mark_previous_contract_renewed()
returns trigger
language plpgsql
as $$
begin
  if new.previous_contract_id is not null then
    update employee_contracts
      set status = 'renewed', updated_at = now()
      where id = new.previous_contract_id and employee_id = new.employee_id;
  end if;
  return new;
end;
$$;

-- ⚠️ يجب أن يكون BEFORE INSERT لا AFTER: الفهرس الفريد "عقد نشط واحد فقط"
-- أدناه يُفحَص فورًا مع إدخال الصف الجديد، فإن بقي العقد السابق "active" حتى
-- لحظة الفحص يُرفَض الإدخال خطأً رغم أنه تجديد صحيح — لذا يجب وسم السابق
-- بـ "renewed" قبل إدخال الصف الجديد لا بعده (اكتُشف هذا فعليًا أثناء
-- الاختبار المحلي: BEFORE/AFTER لهما فرق حاسم هنا وليس تفصيلاً نظريًا)
drop trigger if exists trg_mark_previous_contract_renewed on employee_contracts;
create trigger trg_mark_previous_contract_renewed
  before insert on employee_contracts
  for each row execute function app_mark_previous_contract_renewed();

-- منع عقدين "نشطين" (active) في آنٍ واحد لنفس الموظف — الانتقال يجب أن يمر
-- عبر previous_contract_id (تجديد) أو إنهاء العقد الحالي صريحًا (termination)
create unique index if not exists uq_employee_contracts_one_active
  on employee_contracts (employee_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- عرض: العقود مع حالة الانتهاء المحسوبة لحظيًا (بلا أي تعديل على status
-- المخزَّن، تمامًا كفلسفة "الحماية لا تعني الكتابة التلقائية على بيانات
-- ما زالت بحاجة لإجراء بشري" — إنهاء/تجديد العقد فعل صريح من المستخدم)
-- ---------------------------------------------------------------------------
create or replace view v_employee_contracts_status as
select
  c.*,
  e.name_ar as employee_name,
  (c.status = 'active' and c.end_date is not null and c.end_date < current_date) as is_overdue_for_renewal,
  (c.status = 'active' and c.end_date is not null and c.end_date >= current_date and c.end_date <= current_date + interval '30 days') as expiring_within_30_days
from employee_contracts c
join employees e on e.id = c.employee_id;

-- ---------------------------------------------------------------------------
-- توسعة شاشة التنبيهات الموحَّدة لتشمل انتهاء عقود العمل (نفس نمط 0008/0003)
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
  where pim.expiry_date is not null and pim.is_active = true
  union all
  select c.organization_id, 'employee_contract_expiry'::text as alert_type,
         e.name_ar as title, c.end_date as expires_on
  from employee_contracts c
  join employees e on e.id = c.employee_id
  where c.status = 'active' and c.end_date is not null;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table employee_contracts enable row level security;

create policy "employee_contracts_all_members" on employee_contracts
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- نهاية 0021_hr_contracts.sql
-- الخطوة التالية: 0022_hr_recruitment.sql (وظائف شاغرة، مرشحون، مراحل
-- المقابلات، حتى قرار التوظيف النهائي الذي يُنشئ سجل employee تلقائيًا)
-- ============================================================================
