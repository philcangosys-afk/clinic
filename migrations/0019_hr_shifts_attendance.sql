-- ============================================================================
-- 0019_hr_shifts_attendance.sql
-- المرحلة 6.1 — الموارد البشرية الموسّعة: المناوبات والجداول + الحضور والانصراف
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0018 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- أول ملف من مجموعة الموارد البشرية الموسّعة — لا جدول لأي من هذه الموديولات
-- (الحضور/الانصراف، الإجازات، العقود، التوظيف، تقييم الأداء، التدريب، الشِفتات،
-- تقارير الموارد البشرية) كان موجودًا سابقًا؛ فقط `employees`/`employee_documents`
-- من 0008. هذا الملف يبني موديولَين مرتبطَين معًا: الشِفتات (القالب) والحضور
-- (التنفيذ اليومي الفعلي الذي يعتمد على القالب).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) قوالب المناوبات
-- ---------------------------------------------------------------------------
create table if not exists shift_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name_ar text not null,
  name_en text,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  grace_minutes integer not null default 0 check (grace_minutes >= 0),   -- سماحية تأخير قبل اعتباره "تأخير"
  is_night_shift boolean not null default false,   -- مناوبة تمتد لليوم التالي (end_time < start_time)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_shift_templates_org on shift_templates (organization_id);

-- ---------------------------------------------------------------------------
-- 2) إسناد المناوبات للموظفين (جدول دوري — أيام أسبوع محددة لكل إسناد)
-- ---------------------------------------------------------------------------
create table if not exists employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  shift_template_id uuid not null references shift_templates(id) on delete restrict,
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}',   -- 0=أحد ... 6=سبت (نفس ترقيم extract(dow from ...))
  effective_from date not null default current_date,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_shift_assignments_employee on employee_shift_assignments (employee_id, effective_from desc);
create index if not exists idx_shift_assignments_org on employee_shift_assignments (organization_id);

-- ---------------------------------------------------------------------------
-- 3) سجلات الحضور والانصراف اليومية
-- ---------------------------------------------------------------------------
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  shift_template_id uuid references shift_templates(id) on delete set null,  -- لقطة من المناوبة السارية وقت التسجيل
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null default 'pending' check (
    status in ('pending','present','late','absent','on_leave','holiday')
  ),
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists idx_attendance_org_date on attendance_records (organization_id, work_date desc);
create index if not exists idx_attendance_employee on attendance_records (employee_id, work_date desc);

-- ---------------------------------------------------------------------------
-- حساب حالة الحضور تلقائيًا من توقيت الحضور مقارنة بالمناوبة — نفس مبدأ
-- "الحماية من قاعدة البيانات لا من الواجهة فقط" المعتمد في كل مراحل هذا المشروع
-- ---------------------------------------------------------------------------
create or replace function app_calc_attendance_status()
returns trigger
language plpgsql
as $$
declare
  v_shift shift_templates%rowtype;
  v_expected_in timestamptz;
  v_expected_out timestamptz;
begin
  -- حالات يدوية صريحة (غياب/إجازة/عطلة) بلا توقيت حضور — تُترك كما أدخلها المستخدم
  if new.check_in_at is null and new.check_out_at is null then
    if new.status = 'pending' then
      new.status := 'absent';
    end if;
    new.late_minutes := 0;
    new.early_leave_minutes := 0;
    return new;
  end if;

  if new.shift_template_id is not null then
    select * into v_shift from shift_templates where id = new.shift_template_id;
  end if;

  if v_shift.id is not null and new.check_in_at is not null then
    v_expected_in := new.work_date + v_shift.start_time;
    if new.check_in_at > v_expected_in + (v_shift.grace_minutes || ' minutes')::interval then
      new.late_minutes := extract(epoch from (new.check_in_at - (v_expected_in + (v_shift.grace_minutes || ' minutes')::interval)))::integer / 60;
      new.status := 'late';
    else
      new.late_minutes := 0;
      if new.status = 'pending' then
        new.status := 'present';
      end if;
    end if;
  elsif new.check_in_at is not null and new.status = 'pending' then
    new.status := 'present';
    new.late_minutes := 0;
  end if;

  if v_shift.id is not null and new.check_out_at is not null then
    v_expected_out := new.work_date + v_shift.end_time
      + case when v_shift.is_night_shift then interval '1 day' else interval '0' end;
    if new.check_out_at < v_expected_out then
      new.early_leave_minutes := extract(epoch from (v_expected_out - new.check_out_at))::integer / 60;
    else
      new.early_leave_minutes := 0;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_calc_attendance_status on attendance_records;
create trigger trg_calc_attendance_status
  before insert or update of check_in_at, check_out_at, status
  on attendance_records
  for each row execute function app_calc_attendance_status();

-- ---------------------------------------------------------------------------
-- عرض: حضور اليوم لكل الموظفين النشطين (للوحة المتابعة اليومية)
-- ---------------------------------------------------------------------------
create or replace view v_today_attendance as
select
  e.organization_id,
  e.id as employee_id,
  e.name_ar as employee_name,
  ar.id as attendance_id,
  ar.check_in_at,
  ar.check_out_at,
  coalesce(ar.status, 'pending') as status,
  coalesce(ar.late_minutes, 0) as late_minutes
from employees e
left join attendance_records ar
  on ar.employee_id = e.id and ar.work_date = current_date
where e.status = 'active';

-- ============================================================================
-- تفعيل Row Level Security (RLS) — نفس نمط "كل أعضاء المؤسسة" المعتمد
-- لوحدات العمليات (employees/employee_documents من 0008) وليس نمط الأدوار
-- الخاص بالمحاسبة، لأن الحضور عملية تشغيلية يومية لا بيانات مالية حساسة
-- ============================================================================
alter table shift_templates enable row level security;
alter table employee_shift_assignments enable row level security;
alter table attendance_records enable row level security;

create policy "shift_templates_all_members" on shift_templates
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "employee_shift_assignments_all_members" on employee_shift_assignments
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "attendance_records_all_members" on attendance_records
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- نهاية 0019_hr_shifts_attendance.sql
-- الخطوة التالية: 0020_hr_leave.sql (أنواع الإجازات، أرصدة الإجازات، طلبات
-- الإجازة بسير عمل طلب ← اعتماد/رفض، مع خصم تلقائي من الرصيد عند الاعتماد)
-- ============================================================================
