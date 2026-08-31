-- ============================================================================
-- 0100 — المرحلة 20: الموارد البشرية والرواتب
-- ============================================================================
--
-- **ما كان قائمًا** (0019–0024): ملفات الموظفين، والعقود، والحضور بحساب
-- التأخير والانصراف المبكّر، والإجازات بأرصدتها وتحقّقها، وقوالب الورديات
-- وإسنادها.
--
-- **ما ينقصه — وكلّه في مسار الراتب**:
--
--   • **لا دورة راتب إطلاقًا**: `basic_salary` و`housing_allowance` أرقامٌ في
--     ملف الموظف، لا مسير يُحسب ويُعتمد ويُدفع. الراتب يُحسب خارج النظام،
--     فلا قسيمة ولا ملف تحويل ولا قيدٌ محاسبيّ.
--   • لا بدلات ولا استقطاعات معرَّفة: البدل الرابع يعني عمودًا جديدًا في جدول
--     الموظفين، وهو ما لا يحتمله التوسّع.
--   • لا سلف ولا قروض: تُخصم على الورق فتُنسى.
--   • لا عمل إضافي ولا تبديل مناوبات.
--   • **الإجازة لا تُفحص ضدّ جدول الطبيب ولا مواعيده**: يُعتمد للطبيب إجازةٌ
--     وله عشرون موعدًا في تلك الأيام.
--   • لا سجل ترقيات ولا تنقلات، ولا حساب بنكيّ، ولا تنبيه انتهاء وثيقة.
--
-- **المبدأ**: الراتب **يُحسب** من مكوّناته لا يُكتب يدويًّا، والمسير المعتمَد
-- لا يُعدَّل — يُلغى بإلغاء منظَّم يعكس قيده.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('hr.view',            'عرض ملفات الموظفين',       'hr', 1300),
  ('hr.manage',          'إدارة ملفات الموظفين',     'hr', 1302),
  ('hr.attendance',      'إدارة الحضور والورديات',   'hr', 1304),
  ('hr.overtime_approve','اعتماد العمل الإضافي',     'hr', 1306),
  ('hr.leave_approve',   'اعتماد الإجازات',          'hr', 1308),
  ('payroll.view',       'عرض مسيّرات الرواتب',      'hr', 1310),
  ('payroll.run',        'احتساب مسير الرواتب',      'hr', 1312),
  ('payroll.approve',    'اعتماد مسير الرواتب',      'hr', 1314),
  ('payroll.pay',        'صرف الرواتب',              'hr', 1316),
  ('payroll.loans',      'إدارة السلف والقروض',      'hr', 1318)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **من يحتسب لا يعتمد**: الفصل بين الاحتساب والاعتماد هو ما يمنع أن يزيد
-- أحدٌ بندًا في مسيرٍ يعتمده بنفسه.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'hr.view'), ('accountant', 'payroll.view'),
  ('accountant',     'payroll.run'), ('accountant', 'payroll.pay'),
  ('accountant',     'payroll.loans'),
  ('branch_manager', 'hr.view'), ('branch_manager', 'hr.manage'),
  ('branch_manager', 'hr.attendance'), ('branch_manager', 'hr.overtime_approve'),
  ('branch_manager', 'hr.leave_approve'), ('branch_manager', 'payroll.view'),
  ('branch_manager', 'payroll.approve')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) ملف الموظف: البنك والحالة والترقيات
-- ===========================================================================
alter table employees
  add column if not exists bank_name         text,
  add column if not exists bank_iban         text,
  add column if not exists bank_account_name text,
  add column if not exists department_id     uuid,
  add column if not exists job_title         text,
  add column if not exists updated_by        uuid references auth.users(id);

create table if not exists employee_position_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  change_type     text not null
                    check (change_type in ('hire','promotion','transfer','salary_change',
                                           'title_change','suspension','termination','reinstatement')),
  effective_date  date not null,
  from_branch_id  uuid references branches(id),
  to_branch_id    uuid references branches(id),
  from_job_title  text,
  to_job_title    text,
  from_salary     numeric(14,2),
  to_salary       numeric(14,2),
  reason          text,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_position_history_emp
  on employee_position_history (organization_id, employee_id, effective_date desc);

comment on table employee_position_history is
  'سجل الترقيات والتنقلات وتغيّر الراتب. **يُكتب تلقائيًّا** عند تغيّر الراتب أو الفرع أو المسمّى، فلا يعتمد على تذكّر أحد.';

alter table employee_position_history enable row level security;

-- التغيير يُسجَّل من حيث يقع، لا من نيّة المستخدم
create or replace function app_log_employee_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'UPDATE' then
    if coalesce(new.basic_salary, 0) is distinct from coalesce(old.basic_salary, 0) then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_salary, to_salary, created_by)
      values (new.organization_id, new.id, 'salary_change', current_date,
              old.basic_salary, new.basic_salary, auth.uid());
    end if;
    if new.branch_id is distinct from old.branch_id then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_branch_id, to_branch_id,
                                             created_by)
      values (new.organization_id, new.id, 'transfer', current_date,
              old.branch_id, new.branch_id, auth.uid());
    end if;
    if coalesce(new.job_title, '') is distinct from coalesce(old.job_title, '') then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_job_title, to_job_title,
                                             created_by)
      values (new.organization_id, new.id, 'title_change', current_date,
              old.job_title, new.job_title, auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_log_employee_change on employees;
create trigger trg_log_employee_change
  after update of basic_salary, branch_id, job_title on employees
  for each row execute function app_log_employee_change();

-- ===========================================================================
-- 3) مكوّنات الراتب: بدلات واستقطاعات معرَّفة
-- ===========================================================================
create table if not exists salary_components (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,
  name_ar         text not null,
  name_en         text,
  component_type  text not null check (component_type in ('allowance','deduction')),
  calculation     text not null default 'fixed'
                    check (calculation in ('fixed','percent_of_basic','percent_of_gross')),
  default_value   numeric(14,4) not null default 0,
  is_taxable      boolean not null default false,
  affects_gosi    boolean not null default false,
  gl_account_id   uuid references chart_of_accounts(id),
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_salary_component_code
  on salary_components (organization_id, code);

create table if not exists employee_salary_components (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  component_id     uuid not null references salary_components(id),
  value            numeric(14,4) not null default 0,
  effective_from   date not null default current_date,
  effective_to     date,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

create index if not exists idx_emp_components
  on employee_salary_components (employee_id, effective_from);

comment on table salary_components is
  'تعريف البدلات والاستقطاعات. البدل الجديد صفٌّ هنا لا عمودٌ في جدول الموظفين — التوسّع بالبيانات لا بالمخطّط.';

alter table salary_components enable row level security;
alter table employee_salary_components enable row level security;

-- ===========================================================================
-- 4) السلف والقروض
-- ===========================================================================
create table if not exists employee_loans (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  loan_type         text not null default 'advance'
                      check (loan_type in ('advance','loan')),
  amount            numeric(14,2) not null check (amount > 0),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  installments_count integer not null check (installments_count > 0),
  paid_amount       numeric(14,2) not null default 0,
  start_month       date not null,
  status            text not null default 'active'
                      check (status in ('active','settled','cancelled')),
  reason            text,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_employee_loans
  on employee_loans (organization_id, employee_id, status);

comment on table employee_loans is
  'السلف والقروض. الخصم يقع في مسير الراتب تلقائيًّا، فلا تُنسى سلفةٌ على الورق.';

alter table employee_loans enable row level security;

-- ===========================================================================
-- 5) العمل الإضافي وتبديل المناوبات
-- ===========================================================================
alter table attendance_records
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists overtime_minutes     integer not null default 0,
  add column if not exists overtime_approved_by uuid references auth.users(id),
  add column if not exists overtime_approved_at timestamptz,
  add column if not exists absence_reason       text;

comment on column attendance_records.overtime_approved_by is
  'العمل الإضافي **لا يُحتسب في الراتب قبل اعتماده**: دقائق مسجَّلة بلا اعتماد ليست مستحقّة.';

create table if not exists shift_swap_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  requester_id      uuid not null references employees(id),
  target_employee_id uuid not null references employees(id),
  swap_date         date not null,
  target_date       date,
  requester_shift_id uuid references shift_templates(id),
  target_shift_id   uuid references shift_templates(id),
  status            text not null default 'pending'
                      check (status in ('pending','accepted','approved','rejected','cancelled')),
  reason            text,
  accepted_at       timestamptz,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  constraint shift_swap_not_self check (requester_id <> target_employee_id)
);

alter table shift_swap_requests enable row level security;

comment on table shift_swap_requests is
  'تبديل المناوبات: يقبله الزميل أوّلًا ثم يعتمده المسؤول. قبولُ الزميل وحده لا يكفي، واعتماد المسؤول وحده يفرض على زميلٍ لم يوافق.';

-- ===========================================================================
-- 6) الإجازة تُفحص ضدّ جدول الطبيب ومواعيده
-- ===========================================================================
--
-- **هذا أخطر ما في الوحدة**: تُعتمد إجازة لطبيبٍ وله مواعيد مؤكَّدة في تلك
-- الأيام، فيصل المرضى ولا يجدونه. الفحص هنا لا يمنع الإجازة — يمنع
-- **اعتمادها صامتةً**: إمّا تُعالَج المواعيد وإمّا يُسجَّل قرارٌ صريح.
create or replace function app_check_leave_conflicts(
  p_employee_id uuid,
  p_start_date  date,
  p_end_date    date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp     employees%rowtype;
  v_doctor  uuid;
  v_appts   integer := 0;
  v_slots   integer := 0;
  v_blocks  text[] := '{}';
begin
  select * into v_emp from employees where id = p_employee_id;
  if v_emp.id is null then raise exception 'الموظف غير موجود'; end if;

  -- ربط الموظف بالطبيب عبر حساب المستخدم أو رقم الهوية
  select d.id into v_doctor
    from doctors d
   where d.organization_id = v_emp.organization_id
     and ((v_emp.user_id is not null and d.user_id = v_emp.user_id)
       or (v_emp.national_id is not null and d.id_number = v_emp.national_id))
   limit 1;

  if v_doctor is not null then
    select count(*) into v_appts
      from appointments a
     where a.doctor_id = v_doctor
       and a.scheduled_start::date between p_start_date and p_end_date
       and a.status in ('scheduled','confirmed','waiting');
    if v_appts > 0 then
      v_blocks := v_blocks || format('%s موعدًا محجوزًا للطبيب في هذه الفترة', v_appts)::text;
    end if;

    select count(*) into v_slots
      from doctor_working_hours w
     where w.doctor_id = v_doctor;
    if v_slots > 0 then
      v_blocks := v_blocks || 'الطبيب له جدول عمل معتمَد — عطّل أيّامه أو انقل مواعيده'::text;
    end if;
  end if;

  return jsonb_build_object(
    'has_conflicts', array_length(v_blocks, 1) is not null,
    'doctor_id',     v_doctor,
    'appointments',  v_appts,
    'blocks',        to_jsonb(v_blocks));
end $$;

create or replace function app_approve_leave_request(
  p_request_id       uuid,
  p_conflict_note    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r    leave_requests%rowtype;
  v_conf jsonb;
begin
  select * into v_r from leave_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'طلب الإجازة غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'hr.leave_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد الإجازات (hr.leave_approve)';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'لا يُعتمد طلب حالته %', v_r.status;
  end if;

  v_conf := app_check_leave_conflicts(v_r.employee_id, v_r.start_date, v_r.end_date);
  if (v_conf->>'has_conflicts')::boolean
     and coalesce(trim(p_conflict_note), '') = '' then
    raise exception 'تعارض مع جدول الطبيب أو مواعيده: %. عالِج المواعيد أو سجّل قرارًا صريحًا',
      array_to_string(array(select jsonb_array_elements_text(v_conf->'blocks')), '؛ ');
  end if;

  update leave_requests
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         reason = case when p_conflict_note is not null
                       then coalesce(reason, '') || ' | قرار التعارض: ' || p_conflict_note
                       else reason end,
         updated_at = now()
   where id = p_request_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_r.organization_id, auth.uid(), 'hr', 'update', p_request_id,
          'اعتماد إجازة',
          format('إجازة من %s إلى %s', v_r.start_date, v_r.end_date), p_conflict_note);
end $$;

create or replace function app_approve_shift_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s shift_swap_requests%rowtype;
begin
  select * into v_s from shift_swap_requests where id = p_swap_id for update;
  if v_s.id is null then raise exception 'طلب التبديل غير موجود'; end if;
  if not app_has_permission(v_s.organization_id, 'hr.attendance') then
    raise exception 'صلاحيتك لا تسمح باعتماد تبديل المناوبات (hr.attendance)';
  end if;
  -- **قبول الزميل شرطٌ للاعتماد**: الاعتماد وحده يفرض مناوبةً على من لم يوافق
  if v_s.status <> 'accepted' then
    raise exception 'لا يُعتمد التبديل قبل قبول الزميل (الحالة %)', v_s.status;
  end if;

  update shift_swap_requests
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_swap_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_s.organization_id, auth.uid(), 'hr', 'update', p_swap_id,
          'اعتماد تبديل مناوبة', format('تبديل بتاريخ %s', v_s.swap_date));
end $$;

-- ===========================================================================
-- 7) دورة الراتب
-- ===========================================================================
create table if not exists payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  run_number        text,
  period_month      date not null,
  status            text not null default 'draft'
                      check (status in ('draft','calculated','approved','paid','cancelled')),
  employee_count    integer not null default 0,
  total_gross       numeric(14,2) not null default 0,
  total_deductions  numeric(14,2) not null default 0,
  total_net         numeric(14,2) not null default 0,
  calculated_at     timestamptz,
  calculated_by     uuid references auth.users(id),
  approved_at       timestamptz,
  approved_by       uuid references auth.users(id),
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id),
  journal_entry_id  uuid references journal_entries(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users(id),
  cancel_reason     text,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

-- مسير واحد لكل شهر وفرع: مسيران يعنيان راتبًا مزدوجًا
create unique index if not exists uq_payroll_run_period
  on payroll_runs (organization_id, period_month, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled';

create table if not exists payroll_run_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  payroll_run_id    uuid not null references payroll_runs(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  basic_salary      numeric(14,2) not null default 0,
  allowances_total  numeric(14,2) not null default 0,
  overtime_amount   numeric(14,2) not null default 0,
  gross_salary      numeric(14,2) not null default 0,
  absence_deduction numeric(14,2) not null default 0,
  late_deduction    numeric(14,2) not null default 0,
  loan_deduction    numeric(14,2) not null default 0,
  other_deductions  numeric(14,2) not null default 0,
  deductions_total  numeric(14,2) not null default 0,
  net_salary        numeric(14,2) not null default 0,
  worked_days       numeric(6,2),
  absent_days       numeric(6,2),
  late_minutes      integer not null default 0,
  overtime_minutes  integer not null default 0,
  bank_iban         text,
  note              text,
  created_at        timestamptz not null default now()
);

create table if not exists payroll_item_details (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  payroll_run_item_id uuid not null references payroll_run_items(id) on delete cascade,
  component_id        uuid references salary_components(id),
  detail_kind         text not null
                        check (detail_kind in ('basic','allowance','deduction','overtime',
                                               'absence','late','loan')),
  label               text not null,
  amount              numeric(14,2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_payroll_items_run on payroll_run_items (payroll_run_id);
create index if not exists idx_payroll_details_item on payroll_item_details (payroll_run_item_id);

comment on table payroll_item_details is
  'تفصيل كل مبلغ في قسيمة الراتب. قسيمةٌ تعرض إجماليًّا بلا تفصيله لا تُقنع موظّفًا اعترض على رقم.';

alter table payroll_runs enable row level security;
alter table payroll_run_items enable row level security;
alter table payroll_item_details enable row level security;

-- **المسير المعتمَد لا يُعدَّل ولا يُحذف**
create or replace function app_guard_approved_payroll()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if TG_TABLE_NAME = 'payroll_runs' then
    if TG_OP = 'DELETE' then
      if old.status in ('approved','paid') then
        raise exception 'المسير المعتمَد لا يُحذف — استخدم الإلغاء المنظَّم';
      end if;
      return old;
    end if;
    -- يُسمح بانتقال الحالة نفسها وبالإلغاء، لا بتعديل المبالغ
    if old.status in ('approved','paid')
       and (new.total_net is distinct from old.total_net
         or new.total_gross is distinct from old.total_gross) then
      raise exception 'مبالغ المسير المعتمَد لا تُعدَّل — ألغِه ثم أعد احتسابه';
    end if;
    return new;
  end if;

  select status into v_status from payroll_runs
   where id = coalesce(new.payroll_run_id, old.payroll_run_id);
  if v_status in ('approved','paid') then
    raise exception 'بنود المسير المعتمَد لا تُعدَّل ولا تُحذف';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_approved_payroll on payroll_runs;
create trigger trg_guard_approved_payroll
  before update or delete on payroll_runs
  for each row execute function app_guard_approved_payroll();

drop trigger if exists trg_guard_approved_payroll_items on payroll_run_items;
create trigger trg_guard_approved_payroll_items
  before insert or update or delete on payroll_run_items
  for each row execute function app_guard_approved_payroll();

-- ===========================================================================
-- 8) الاحتساب
-- ===========================================================================
create or replace function app_calculate_payroll_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run     payroll_runs%rowtype;
  v_emp     record;
  v_item    uuid;
  v_start   date;
  v_end     date;
  v_days    integer;
  v_daily   numeric;
  v_allow   numeric;
  v_ot_min  integer;
  v_ot_amt  numeric;
  v_late    integer;
  v_late_amt numeric;
  v_absent  numeric;
  v_abs_amt numeric;
  v_loan    numeric;
  v_gross   numeric;
  v_ded     numeric;
  v_net     numeric;
  v_comp    record;
  v_n       int := 0;
  v_g       numeric := 0;
  v_d       numeric := 0;
  v_nt      numeric := 0;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.run') then
    raise exception 'صلاحيتك لا تسمح باحتساب الرواتب (payroll.run)';
  end if;
  if v_run.status not in ('draft','calculated') then
    raise exception 'لا يُعاد احتساب مسير حالته %', v_run.status;
  end if;

  v_start := date_trunc('month', v_run.period_month)::date;
  v_end   := (date_trunc('month', v_run.period_month) + interval '1 month - 1 day')::date;
  v_days  := v_end - v_start + 1;

  -- إعادة الاحتساب تمسح النتائج السابقة، لا تُضيف إليها
  delete from payroll_item_details
   where payroll_run_item_id in (select id from payroll_run_items where payroll_run_id = p_run_id);
  delete from payroll_run_items where payroll_run_id = p_run_id;

  for v_emp in
    select e.* from employees e
     where e.organization_id = v_run.organization_id
       and coalesce(e.is_disabled, false) = false
       and coalesce(e.status, 'active') = 'active'
       and (v_run.branch_id is null or e.branch_id = v_run.branch_id)
       -- من عُيّن بعد نهاية الشهر أو انتهت خدمته قبل بدايته ليس في المسير
       and (e.hire_date is null or e.hire_date <= v_end)
       and (e.termination_date is null or e.termination_date >= v_start)
  loop
    v_daily := round(coalesce(v_emp.basic_salary, 0) / nullif(v_days, 0), 4);

    -- البدلات: من المكوّنات المعرَّفة السارية في الشهر
    v_allow := 0;
    -- البدلات القديمة في ملف الموظف تبقى محسوبة حتى تُنقل إلى مكوّنات
    v_allow := v_allow + coalesce(v_emp.housing_allowance, 0)
                       + coalesce(v_emp.transportation_allowance, 0)
                       + coalesce(v_emp.other_allowances, 0);

    -- الحضور
    select coalesce(sum(a.late_minutes), 0),
           coalesce(sum(case when a.overtime_approved_by is not null
                             then a.overtime_minutes else 0 end), 0),
           count(*) filter (where a.status = 'absent')
      into v_late, v_ot_min, v_absent
      from attendance_records a
     where a.employee_id = v_emp.id
       and a.work_date between v_start and v_end;

    -- الإضافيّ بمعامل 1.5 على أجر الساعة، والاعتماد شرطٌ سبق فحصه أعلاه
    v_ot_amt  := round(coalesce(v_ot_min, 0) / 60.0 * (v_daily / 8.0) * 1.5, 2);
    v_late_amt := round(coalesce(v_late, 0) / 60.0 * (v_daily / 8.0), 2);
    v_abs_amt := round(coalesce(v_absent, 0) * v_daily, 2);

    -- قسط السلفة: لا يتجاوز المتبقّي منها
    select coalesce(sum(least(l.installment_amount, l.amount - l.paid_amount)), 0)
      into v_loan
      from employee_loans l
     where l.employee_id = v_emp.id and l.status = 'active'
       and l.start_month <= v_end
       and l.amount > l.paid_amount;

    v_gross := round(coalesce(v_emp.basic_salary, 0) + v_allow + v_ot_amt, 2);

    insert into payroll_run_items (organization_id, payroll_run_id, employee_id,
                                   basic_salary, allowances_total, overtime_amount,
                                   gross_salary, absence_deduction, late_deduction,
                                   loan_deduction, worked_days, absent_days,
                                   late_minutes, overtime_minutes, bank_iban)
    values (v_run.organization_id, p_run_id, v_emp.id,
            coalesce(v_emp.basic_salary, 0), v_allow, v_ot_amt, v_gross,
            v_abs_amt, v_late_amt, v_loan,
            v_days - coalesce(v_absent, 0), coalesce(v_absent, 0),
            coalesce(v_late, 0), coalesce(v_ot_min, 0), v_emp.bank_iban)
    returning id into v_item;

    insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                      label, amount)
    values (v_run.organization_id, v_item, 'basic', 'الراتب الأساسي',
            coalesce(v_emp.basic_salary, 0));
    if v_allow > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'allowance', 'البدلات', v_allow);
    end if;
    if v_ot_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'overtime',
              format('عمل إضافي معتمَد (%s دقيقة)', v_ot_min), v_ot_amt);
    end if;
    if v_abs_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'absence',
              format('غياب %s يومًا', v_absent), -v_abs_amt);
    end if;
    if v_late_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'late',
              format('تأخير %s دقيقة', v_late), -v_late_amt);
    end if;
    if v_loan > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'loan', 'قسط سلفة', -v_loan);
    end if;

    -- المكوّنات المعرَّفة
    v_ded := 0;
    for v_comp in
      select sc.*, esc.value
        from employee_salary_components esc
        join salary_components sc on sc.id = esc.component_id
       where esc.employee_id = v_emp.id
         and sc.is_active
         and esc.effective_from <= v_end
         and (esc.effective_to is null or esc.effective_to >= v_start)
    loop
      declare v_amt numeric;
      begin
        v_amt := case v_comp.calculation
          when 'percent_of_basic' then round(coalesce(v_emp.basic_salary, 0) * v_comp.value / 100, 2)
          when 'percent_of_gross' then round(v_gross * v_comp.value / 100, 2)
          else v_comp.value
        end;

        insert into payroll_item_details (organization_id, payroll_run_item_id,
                                          component_id, detail_kind, label, amount)
        values (v_run.organization_id, v_item, v_comp.id,
                case when v_comp.component_type = 'allowance' then 'allowance' else 'deduction' end,
                v_comp.name_ar,
                case when v_comp.component_type = 'allowance' then v_amt else -v_amt end);

        if v_comp.component_type = 'allowance' then
          v_allow  := v_allow + v_amt;
          v_gross  := v_gross + v_amt;
        else
          v_ded := v_ded + v_amt;
        end if;
      end;
    end loop;

    v_net := round(v_gross - v_abs_amt - v_late_amt - v_loan - v_ded, 2);

    update payroll_run_items
       set allowances_total = v_allow, gross_salary = v_gross,
           other_deductions = v_ded,
           deductions_total = round(v_abs_amt + v_late_amt + v_loan + v_ded, 2),
           net_salary = v_net
     where id = v_item;

    v_g  := v_g + v_gross;
    v_d  := v_d + v_abs_amt + v_late_amt + v_loan + v_ded;
    v_nt := v_nt + v_net;
    v_n  := v_n + 1;
  end loop;

  update payroll_runs
     set status = 'calculated', employee_count = v_n,
         total_gross = round(v_g, 2), total_deductions = round(v_d, 2),
         total_net = round(v_nt, 2),
         calculated_at = now(), calculated_by = auth.uid(), updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'احتساب مسير رواتب',
          format('%s موظفًا، إجمالي %s، صافي %s', v_n, round(v_g, 2), round(v_nt, 2)));

  return v_n;
end $$;

create or replace function app_approve_payroll_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run  payroll_runs%rowtype;
  v_bad  int;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد المسيّرات (payroll.approve)';
  end if;
  if v_run.status <> 'calculated' then
    raise exception 'لا يُعتمد مسير حالته % — احتسبه أوّلًا', v_run.status;
  end if;
  -- **من احتسب لا يعتمد**
  if v_run.calculated_by is not null and v_run.calculated_by = auth.uid() then
    raise exception 'لا يعتمد المسيرَ من احتسبه — يلزم معتمِد آخر';
  end if;

  select count(*) into v_bad from payroll_run_items
   where payroll_run_id = p_run_id and net_salary < 0;
  if v_bad > 0 then
    raise exception '% موظفًا بصافي سالب — راجع الاستقطاعات قبل الاعتماد', v_bad;
  end if;

  update payroll_runs
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'اعتماد مسير رواتب', format('صافي %s', v_run.total_net));
end $$;

-- الصرف: يخصم أقساط السلف ويولّد القيد المحاسبيّ
create or replace function app_pay_payroll_run(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run   payroll_runs%rowtype;
  v_item  record;
  v_je    uuid;
  v_exp   uuid;
  v_cash  uuid;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.pay') then
    raise exception 'صلاحيتك لا تسمح بصرف الرواتب (payroll.pay)';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'لا يُصرف مسير حالته % — يلزم اعتماده', v_run.status;
  end if;

  -- خصم أقساط السلف من أرصدتها
  for v_item in
    select pri.employee_id, pri.loan_deduction
      from payroll_run_items pri
     where pri.payroll_run_id = p_run_id and pri.loan_deduction > 0
  loop
    update employee_loans
       set paid_amount = least(amount, paid_amount + v_item.loan_deduction),
           status = case when least(amount, paid_amount + v_item.loan_deduction) >= amount
                         then 'settled' else status end,
           updated_at = now()
     where employee_id = v_item.employee_id and status = 'active'
       and amount > paid_amount;
  end loop;

  -- القيد المحاسبيّ: مصروف رواتب مدين، النقد دائن
  select id into v_exp from chart_of_accounts
   where organization_id = v_run.organization_id and account_type = 'expense'
     and (code like '51%' or name_ar like '%رواتب%')
   order by code limit 1;
  select id into v_cash from chart_of_accounts
   where organization_id = v_run.organization_id and account_type = 'asset'
     and (code like '11%' or name_ar like '%نقد%' or name_ar like '%بنك%')
   order by code limit 1;

  if v_exp is not null and v_cash is not null and v_run.total_net > 0 then
    insert into journal_entries (organization_id, branch_id, entry_date, reference_type,
                                 reference_id, status, description, created_by)
    values (v_run.organization_id, v_run.branch_id,
            (date_trunc('month', v_run.period_month) + interval '1 month - 1 day')::date,
            'manual', p_run_id, 'draft',
            format('رواتب %s', to_char(v_run.period_month, 'YYYY-MM')), auth.uid())
    returning id into v_je;

    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, branch_id, line_number)
    values (v_je, v_run.organization_id, v_exp, v_run.total_net, 0,
            'مصروف رواتب', v_run.branch_id, 1),
           (v_je, v_run.organization_id, v_cash, 0, v_run.total_net,
            'صرف رواتب', v_run.branch_id, 2);

    -- الترحيل قد يُرفض إن كانت الفترة مقفلة؛ يبقى القيد مسوّدة والصرف قائمًا
    begin
      perform app_post_journal_entry(v_je);
    exception when others then
      raise notice 'تعذّر ترحيل قيد الرواتب (%) — بقي مسوّدة', sqlerrm;
    end;
  end if;

  update payroll_runs
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         journal_entry_id = v_je, updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'صرف رواتب', format('صُرف %s', v_run.total_net));

  return v_je;
end $$;

-- **الإلغاء المنظَّم**: يعكس القيد ويردّ أقساط السلف
create or replace function app_cancel_payroll_run(
  p_run_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run  payroll_runs%rowtype;
  v_item record;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'صلاحيتك لا تسمح بإلغاء المسيّرات (payroll.approve)';
  end if;
  if v_run.status = 'cancelled' then raise exception 'المسير ملغى سلفًا'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإلغاء مطلوب'; end if;

  -- عكس القيد إن كان مرحَّلًا — لا حذفه
  if v_run.journal_entry_id is not null then
    begin
      if (select status from journal_entries where id = v_run.journal_entry_id) = 'posted' then
        perform app_reverse_journal_entry(v_run.journal_entry_id,
                                          format('إلغاء مسير رواتب: %s', p_reason));
      else
        delete from journal_entry_lines where journal_entry_id = v_run.journal_entry_id;
        delete from journal_entries where id = v_run.journal_entry_id;
      end if;
    exception when others then
      raise notice 'تعذّر عكس قيد الرواتب (%) — يلزم عكسه يدويًّا', sqlerrm;
    end;
  end if;

  -- ردّ أقساط السلف المخصومة
  if v_run.status = 'paid' then
    for v_item in
      select employee_id, loan_deduction from payroll_run_items
       where payroll_run_id = p_run_id and loan_deduction > 0
    loop
      update employee_loans
         set paid_amount = greatest(0, paid_amount - v_item.loan_deduction),
             status = case when greatest(0, paid_amount - v_item.loan_deduction) < amount
                           then 'active' else status end,
             updated_at = now()
       where employee_id = v_item.employee_id
         and status in ('active','settled');
    end loop;
  end if;

  update payroll_runs
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = p_reason, updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'إلغاء مسير رواتب', 'أُلغي المسير وعُكس قيده ورُدّت أقساط السلف', p_reason);
end $$;

-- ملف التحويل البنكيّ
create or replace function app_payroll_bank_file(p_run_id uuid)
returns table (
  employee_name text,
  job_number    text,
  bank_iban     text,
  net_salary    numeric,
  is_ready      boolean,
  issue         text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_run payroll_runs%rowtype;
begin
  select * into v_run from payroll_runs where id = p_run_id;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.pay') then
    raise exception 'صلاحيتك لا تسمح بإخراج ملف التحويل (payroll.pay)';
  end if;
  -- **لا ملف تحويل قبل الاعتماد**: ملفٌ يُصدَّر من مسيرٍ لم يُعتمد قد يُرفع للبنك
  if v_run.status not in ('approved','paid') then
    raise exception 'لا يُخرَج ملف التحويل من مسير حالته %', v_run.status;
  end if;

  return query
  select e.name_ar,
         e.job_number::text,
         pri.bank_iban,
         pri.net_salary,
         (pri.bank_iban is not null and btrim(pri.bank_iban) <> '' and pri.net_salary > 0),
         case
           when pri.bank_iban is null or btrim(pri.bank_iban) = '' then 'لا آيبان مسجَّل'
           when pri.net_salary <= 0 then 'صافي صفر أو سالب'
         end
    from payroll_run_items pri
    join employees e on e.id = pri.employee_id
   where pri.payroll_run_id = p_run_id
   order by e.name_ar;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================
drop view if exists v_payroll_register;
create view v_payroll_register
with (security_invoker = on) as
select
  pri.id               as payroll_item_id,
  pr.id                as payroll_run_id,
  pr.organization_id,
  pr.branch_id,
  br.name              as branch_name,
  pr.period_month      as report_date,
  pr.run_number,
  pr.status,
  pri.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  e.job_title,
  pri.basic_salary,
  pri.allowances_total,
  pri.overtime_amount,
  pri.gross_salary,
  pri.absence_deduction,
  pri.late_deduction,
  pri.loan_deduction,
  pri.other_deductions,
  pri.deductions_total,
  pri.net_salary,
  pri.worked_days,
  pri.absent_days,
  pri.late_minutes,
  pri.overtime_minutes,
  pri.bank_iban,
  (pri.bank_iban is null or btrim(pri.bank_iban) = '') as missing_iban
from payroll_run_items pri
join payroll_runs pr on pr.id = pri.payroll_run_id
join employees e on e.id = pri.employee_id
left join branches br on br.id = pr.branch_id;

comment on view v_payroll_register is
  'سجل الرواتب بحبّة الموظف: الأساسي والبدلات والإضافيّ والاستقطاعات والصافي، ومن ينقصه آيبان.';

drop view if exists v_employee_documents_expiry;
create view v_employee_documents_expiry
with (security_invoker = on) as
select
  d.id                 as document_id,
  d.organization_id,
  e.branch_id,
  br.name              as branch_name,
  d.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  d.document_type_value_id,
  lv.name_ar           as document_type,
  d.document_number,
  d.issue_date,
  d.expiry_date        as report_date,
  (d.expiry_date - current_date) as days_to_expiry,
  case
    when d.expiry_date is null                          then 'بلا تاريخ انتهاء'
    when d.expiry_date < current_date                   then 'منتهية'
    when d.expiry_date <= current_date + 30             then 'تنتهي خلال شهر'
    when d.expiry_date <= current_date + 90             then 'تنتهي خلال ثلاثة أشهر'
    else 'سارية'
  end                  as expiry_status
from employee_documents d
join employees e on e.id = d.employee_id
left join branches br on br.id = e.branch_id
left join lookup_values lv on lv.id = d.document_type_value_id;

comment on view v_employee_documents_expiry is
  'وثائق الموظفين وتواريخ انتهائها. الإقامة أو الرخصة المنتهية تُعطّل الموظف عن العمل نظاميًّا قبل أن يلاحظها أحد.';

drop view if exists v_employee_loans_status;
create view v_employee_loans_status
with (security_invoker = on) as
select
  l.id                 as loan_id,
  l.organization_id,
  e.branch_id,
  l.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  l.loan_type,
  l.amount,
  l.paid_amount,
  l.amount - l.paid_amount as remaining_amount,
  l.installment_amount,
  l.installments_count,
  case when l.installment_amount > 0
       then ceil((l.amount - l.paid_amount) / l.installment_amount) end as remaining_installments,
  l.start_month        as report_date,
  l.status,
  l.reason
from employee_loans l
join employees e on e.id = l.employee_id;

comment on view v_employee_loans_status is
  'السلف والقروض بأرصدتها المتبقّية وعدد أقساطها الباقية.';

drop view if exists v_attendance_summary;
create view v_attendance_summary
with (security_invoker = on) as
select
  a.organization_id,
  e.branch_id,
  br.name              as branch_name,
  a.employee_id,
  e.name_ar            as employee_name,
  date_trunc('month', a.work_date)::date as report_date,
  count(*)                                          as recorded_days,
  count(*) filter (where a.status = 'present')      as present_days,
  count(*) filter (where a.status = 'absent')       as absent_days,
  count(*) filter (where coalesce(a.late_minutes, 0) > 0) as late_days,
  coalesce(sum(a.late_minutes), 0)                  as total_late_minutes,
  coalesce(sum(a.early_leave_minutes), 0)           as total_early_minutes,
  coalesce(sum(a.overtime_minutes), 0)              as total_overtime_minutes,
  coalesce(sum(case when a.overtime_approved_by is not null
                    then a.overtime_minutes else 0 end), 0) as approved_overtime_minutes
from attendance_records a
join employees e on e.id = a.employee_id
left join branches br on br.id = e.branch_id
group by a.organization_id, e.branch_id, br.name, a.employee_id, e.name_ar,
         date_trunc('month', a.work_date);

comment on view v_attendance_summary is
  'ملخّص الحضور الشهريّ. الإضافيّ المعتمَد منفصلٌ عن المسجَّل — المسجَّل بلا اعتماد ليس مستحقًّا.';

grant select on v_payroll_register, v_employee_documents_expiry,
                v_employee_loans_status, v_attendance_summary to authenticated;

-- ===========================================================================
-- 10) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['employee_position_history','salary_components',
                               'employee_salary_components','employee_loans',
                               'shift_swap_requests','payroll_runs',
                               'payroll_run_items','payroll_item_details']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_calculate_payroll_run','app_approve_payroll_run',
                             'app_pay_payroll_run','app_cancel_payroll_run',
                             'app_payroll_bank_file','app_check_leave_conflicts',
                             'app_approve_leave_request','app_approve_shift_swap']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الرواتب % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where indexname = 'uq_payroll_run_period') then
    raise exception 'لا حارس ضدّ مسيرين لنفس الشهر — راتبٌ مزدوج';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_approved_payroll') then
    raise exception 'المسير المعتمَد قابل للتعديل';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_log_employee_change') then
    raise exception 'تغيّر الراتب أو الفرع لا يُسجَّل';
  end if;
end $$;
