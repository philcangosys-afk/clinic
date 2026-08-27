-- ============================================================================
-- 0020_hr_leave.sql
-- المرحلة 6.2 — الموارد البشرية الموسّعة: الإجازات
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0019 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أنواع الإجازات — نفس نمط "فئات نظامية عامة + فئات خاصة بالمؤسسة"
-- المعتمد في lab_test_categories/radiology_exam_categories (organization_id
-- قابل للقيمة null = نوع نظامي عام تراه كل المؤسسات، أو مخصَّص لمؤسسة واحدة)
-- ---------------------------------------------------------------------------
create table if not exists leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = نوع نظامي عام
  name_ar text not null,
  name_en text,
  annual_entitlement_days numeric(6,2) not null default 0,  -- المستحق سنويًا لكل موظف
  is_paid boolean not null default true,
  requires_approval boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_types_org on leave_types (organization_id);

-- ---------------------------------------------------------------------------
-- 2) أرصدة الإجازات السنوية لكل موظف/نوع/سنة
-- ---------------------------------------------------------------------------
create table if not exists leave_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete restrict,
  year integer not null,
  entitled_days numeric(6,2) not null default 0,
  used_days numeric(6,2) not null default 0,    -- يُحدَّثه Trigger عند اعتماد/إلغاء الطلبات — لا يُعدَّل يدويًا من الواجهة
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);
create index if not exists idx_leave_balances_employee on leave_balances (employee_id, year);

-- ---------------------------------------------------------------------------
-- 3) طلبات الإجازة — سير عمل طلب ← اعتماد/رفض ← (إلغاء محتمل لاحقًا)
-- ---------------------------------------------------------------------------
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  days_count numeric(6,2) not null default 0,   -- تُحسَب تلقائيًا قبل الإدخال (Trigger)
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists idx_leave_requests_org_status on leave_requests (organization_id, status);
create index if not exists idx_leave_requests_employee on leave_requests (employee_id, start_date desc);

-- ---------------------------------------------------------------------------
-- حساب عدد أيام الطلب تلقائيًا، ومنع تداخل الطلبات النشطة لنفس الموظف،
-- ومنع تجاوز الرصيد المتاح — كل ذلك في قاعدة البيانات لا الواجهة فقط
-- ---------------------------------------------------------------------------
create or replace function app_validate_leave_request()
returns trigger
language plpgsql
as $$
declare
  v_overlap_count integer;
  v_balance record;
  v_leave_type leave_types%rowtype;
begin
  new.days_count := (new.end_date - new.start_date + 1);
  new.updated_at := now();

  select * into v_leave_type from leave_types where id = new.leave_type_id;

  -- منع تداخل الطلبات (نشطة = معلّقة أو معتمدة) لنفس الموظف في نفس الفترة
  select count(*) into v_overlap_count
  from leave_requests lr
  where lr.employee_id = new.employee_id
    and lr.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and lr.status in ('pending','approved')
    and lr.start_date <= new.end_date
    and lr.end_date >= new.start_date;
  if v_overlap_count > 0 then
    raise exception 'يوجد طلب إجازة آخر (معلّق أو معتمد) يتداخل مع هذه الفترة لهذا الموظف';
  end if;

  -- فحص الرصيد المتاح فقط لأنواع الإجازات المدفوعة التي تتطلب موافقة
  if v_leave_type.is_paid then
    select entitled_days, used_days into v_balance
    from leave_balances
    where employee_id = new.employee_id and leave_type_id = new.leave_type_id
      and year = extract(year from new.start_date)::int;

    if v_balance is null then
      -- لا رصيد مُعرَّف بعد لهذا الموظف/النوع/السنة — يُعامَل كرصيد صفري
      if new.days_count > 0 then
        raise exception 'لا يوجد رصيد إجازات مُعرَّف لهذا الموظف لنوع الإجازة "%" لسنة %', v_leave_type.name_ar, extract(year from new.start_date)::int;
      end if;
    elsif (v_balance.entitled_days - v_balance.used_days) < new.days_count then
      raise exception 'الرصيد المتبقي (%) أقل من عدد أيام الطلب (%)', (v_balance.entitled_days - v_balance.used_days), new.days_count;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_leave_request on leave_requests;
create trigger trg_validate_leave_request
  before insert or update of start_date, end_date, leave_type_id, employee_id
  on leave_requests
  for each row execute function app_validate_leave_request();

-- ---------------------------------------------------------------------------
-- عند تحوّل الطلب إلى "معتمد" ← خصم الأيام من الرصيد تلقائيًا (وإنشاء صف رصيد
-- افتراضي إن لم يوجد، بقيمة المستحق السنوي من leave_types)
-- عند رجوع طلب كان "معتمدًا" إلى "مرفوض"/"ملغى" ← إعادة الأيام للرصيد (عكس الخصم)
-- ---------------------------------------------------------------------------
create or replace function app_apply_leave_approval()
returns trigger
language plpgsql
as $$
declare
  v_year int;
  v_leave_type leave_types%rowtype;
begin
  v_year := extract(year from new.start_date)::int;

  if old.status <> 'approved' and new.status = 'approved' then
    select * into v_leave_type from leave_types where id = new.leave_type_id;
    insert into leave_balances (organization_id, employee_id, leave_type_id, year, entitled_days, used_days)
    values (new.organization_id, new.employee_id, new.leave_type_id, v_year, coalesce(v_leave_type.annual_entitlement_days, 0), new.days_count)
    on conflict (employee_id, leave_type_id, year)
    do update set used_days = leave_balances.used_days + new.days_count, updated_at = now();
    new.approved_at := now();
  elsif old.status = 'approved' and new.status in ('rejected','cancelled') then
    update leave_balances
      set used_days = greatest(0, used_days - new.days_count), updated_at = now()
      where employee_id = new.employee_id and leave_type_id = new.leave_type_id and year = v_year;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_leave_approval on leave_requests;
create trigger trg_apply_leave_approval
  before update of status
  on leave_requests
  for each row execute function app_apply_leave_approval();

-- ---------------------------------------------------------------------------
-- عرض: ملخص أرصدة الإجازات الحالية لكل موظف (السنة الحالية)
-- ---------------------------------------------------------------------------
create or replace view v_leave_balances_current_year as
select
  lb.organization_id,
  lb.employee_id,
  e.name_ar as employee_name,
  lb.leave_type_id,
  lt.name_ar as leave_type_name,
  lb.entitled_days,
  lb.used_days,
  (lb.entitled_days - lb.used_days) as remaining_days
from leave_balances lb
join employees e on e.id = lb.employee_id
join leave_types lt on lt.id = lb.leave_type_id
where lb.year = extract(year from current_date)::int;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table leave_types enable row level security;
alter table leave_balances enable row level security;
alter table leave_requests enable row level security;

create policy "leave_types_select_members" on leave_types
  for select using (organization_id is null or app_is_member(organization_id));
create policy "leave_types_manage_admins" on leave_types
  for insert with check (
    organization_id is not null and (
      app_is_org_admin(organization_id) or
      exists (select 1 from organization_memberships m where m.organization_id = leave_types.organization_id and m.user_id = auth.uid() and m.role_key = 'hr_manager' and m.is_active)
    )
  );
create policy "leave_types_update_admins" on leave_types
  for update using (
    organization_id is not null and (
      app_is_org_admin(organization_id) or
      exists (select 1 from organization_memberships m where m.organization_id = leave_types.organization_id and m.user_id = auth.uid() and m.role_key = 'hr_manager' and m.is_active)
    )
  );
create policy "leave_types_delete_admins" on leave_types
  for delete using (
    organization_id is not null and (
      app_is_org_admin(organization_id) or
      exists (select 1 from organization_memberships m where m.organization_id = leave_types.organization_id and m.user_id = auth.uid() and m.role_key = 'hr_manager' and m.is_active)
    )
  );

create policy "leave_balances_all_members" on leave_balances
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "leave_requests_all_members" on leave_requests
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ---------------------------------------------------------------------------
-- أنواع إجازات نظامية افتراضية (organization_id = null) تراها كل المؤسسات
-- ---------------------------------------------------------------------------
insert into leave_types (organization_id, name_ar, name_en, annual_entitlement_days, is_paid, requires_approval)
select null, v.name_ar, v.name_en, v.days, v.is_paid, true
from (values
  ('إجازة سنوية', 'Annual Leave', 30, true),
  ('إجازة مرضية', 'Sick Leave', 30, true),
  ('إجازة طارئة', 'Emergency Leave', 5, true),
  ('إجازة بدون راتب', 'Unpaid Leave', 0, false)
) as v(name_ar, name_en, days, is_paid)
where not exists (select 1 from leave_types where organization_id is null and name_ar = v.name_ar);

-- ============================================================================
-- نهاية 0020_hr_leave.sql
-- الخطوة التالية: 0021_hr_contracts.sql (عقود عمل مُصنَّفة ومؤرشفة بإصدارات،
-- تذكير بانتهاء العقد يُضاف إلى شاشة التنبيهات الموحَّدة)
-- ============================================================================
