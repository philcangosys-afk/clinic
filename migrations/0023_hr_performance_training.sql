-- ============================================================================
-- 0023_hr_performance_training.sql
-- المرحلة 6.5 — الموارد البشرية الموسّعة: تقييم الأداء + التدريب والتطوير
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0022 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) معايير التقييم — نفس نمط "نظامي عام + خاص بالمؤسسة" (organization_id
-- قابل لـ null) المعتمد في leave_types/lab_test_categories
-- ---------------------------------------------------------------------------
create table if not exists performance_review_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name_ar text not null,
  name_en text,
  weight numeric(5,2) not null default 1 check (weight > 0),   -- وزن نسبي عند حساب الدرجة الكلية
  created_at timestamptz not null default now()
);
create index if not exists idx_perf_criteria_org on performance_review_criteria (organization_id);

-- ---------------------------------------------------------------------------
-- 2) دورات التقييم (مثال: تقييم الربع الأول 2026)
-- ---------------------------------------------------------------------------
create table if not exists performance_review_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name_ar text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists idx_perf_cycles_org on performance_review_cycles (organization_id);

-- ---------------------------------------------------------------------------
-- 3) تقييم كل موظف ضمن دورة
-- ---------------------------------------------------------------------------
create table if not exists performance_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  cycle_id uuid not null references performance_review_cycles(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  reviewer_user_id uuid references auth.users(id),
  overall_score numeric(5,2) not null default 0,  -- يُحسَب تلقائيًا من أوزان المعايير — لا يُعدَّل يدويًا
  comments text,
  status text not null default 'draft' check (status in ('draft','submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id)
);
create index if not exists idx_perf_reviews_employee on performance_reviews (employee_id);
create index if not exists idx_perf_reviews_cycle on performance_reviews (cycle_id);

-- ---------------------------------------------------------------------------
-- 4) درجة كل معيار داخل تقييم واحد (1 إلى 5)
-- ---------------------------------------------------------------------------
create table if not exists performance_review_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references performance_reviews(id) on delete cascade,
  criterion_id uuid not null references performance_review_criteria(id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  note text,
  unique (review_id, criterion_id)
);
create index if not exists idx_perf_scores_review on performance_review_scores (review_id);

-- ---------------------------------------------------------------------------
-- حساب الدرجة الكلية تلقائيًا من متوسط المعايير المرجَّح بالوزن — يُعاد
-- الحساب فورًا عند أي إضافة/تعديل/حذف لدرجة معيار واحد
-- ---------------------------------------------------------------------------
create or replace function app_recalc_review_overall_score()
returns trigger
language plpgsql
as $$
declare
  v_review_id uuid;
  v_weighted_sum numeric;
  v_weight_total numeric;
begin
  v_review_id := coalesce(new.review_id, old.review_id);

  select coalesce(sum(s.score * c.weight), 0), coalesce(sum(c.weight), 0)
  into v_weighted_sum, v_weight_total
  from performance_review_scores s
  join performance_review_criteria c on c.id = s.criterion_id
  where s.review_id = v_review_id;

  update performance_reviews
    set overall_score = case when v_weight_total > 0 then round(v_weighted_sum / v_weight_total, 2) else 0 end,
        updated_at = now()
    where id = v_review_id;

  return null;
end;
$$;

drop trigger if exists trg_recalc_review_score_ins on performance_review_scores;
create trigger trg_recalc_review_score_ins
  after insert or update or delete on performance_review_scores
  for each row execute function app_recalc_review_overall_score();

-- ---------------------------------------------------------------------------
-- 5) برامج التدريب
-- ---------------------------------------------------------------------------
create table if not exists training_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name_ar text not null,
  name_en text,
  description text,
  hours numeric(6,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_training_programs_org on training_programs (organization_id);

-- ---------------------------------------------------------------------------
-- 6) تسجيل الموظفين في برامج التدريب
-- ---------------------------------------------------------------------------
create table if not exists training_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  program_id uuid not null references training_programs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  status text not null default 'enrolled' check (status in ('enrolled','completed','cancelled')),
  completed_at timestamptz,
  certificate_storage_path text,
  note text,
  created_at timestamptz not null default now(),
  unique (program_id, employee_id)
);
create index if not exists idx_training_enrollments_employee on training_enrollments (employee_id);
create index if not exists idx_training_enrollments_program on training_enrollments (program_id);

-- تعيين completed_at تلقائيًا عند تحوّل التسجيل إلى "مكتمل" — بلا الاعتماد
-- على أن تُرسِل الواجهة التاريخ الصحيح بنفسها
create or replace function app_set_training_completed_at()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'completed' and new.status = 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_training_completed_at on training_enrollments;
create trigger trg_set_training_completed_at
  before update of status on training_enrollments
  for each row execute function app_set_training_completed_at();

-- ---------------------------------------------------------------------------
-- عرض: ملخص تدريب كل موظف (عدد البرامج المكتملة/إجمالي ساعات التدريب)
-- ---------------------------------------------------------------------------
create or replace view v_employee_training_summary as
select
  e.organization_id,
  e.id as employee_id,
  e.name_ar as employee_name,
  count(*) filter (where te.status = 'completed') as completed_programs,
  count(*) filter (where te.status = 'enrolled') as in_progress_programs,
  coalesce(sum(tp.hours) filter (where te.status = 'completed'), 0) as total_completed_hours
from employees e
left join training_enrollments te on te.employee_id = e.id
left join training_programs tp on tp.id = te.program_id
group by e.organization_id, e.id, e.name_ar;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table performance_review_criteria enable row level security;
alter table performance_review_cycles enable row level security;
alter table performance_reviews enable row level security;
alter table performance_review_scores enable row level security;
alter table training_programs enable row level security;
alter table training_enrollments enable row level security;

create policy "perf_criteria_select_members" on performance_review_criteria
  for select using (organization_id is null or app_is_member(organization_id));
create policy "perf_criteria_manage_admins" on performance_review_criteria
  for insert with check (organization_id is not null and app_is_member(organization_id));
create policy "perf_criteria_update_admins" on performance_review_criteria
  for update using (organization_id is not null and app_is_member(organization_id));
create policy "perf_criteria_delete_admins" on performance_review_criteria
  for delete using (organization_id is not null and app_is_member(organization_id));

create policy "perf_cycles_all_members" on performance_review_cycles
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "perf_reviews_all_members" on performance_reviews
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "perf_scores_all_members" on performance_review_scores
  for all using (
    exists (select 1 from performance_reviews r where r.id = performance_review_scores.review_id and app_is_member(r.organization_id))
  ) with check (
    exists (select 1 from performance_reviews r where r.id = performance_review_scores.review_id and app_is_member(r.organization_id))
  );

create policy "training_programs_all_members" on training_programs
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "training_enrollments_all_members" on training_enrollments
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ---------------------------------------------------------------------------
-- معايير تقييم نظامية افتراضية (organization_id = null) تراها كل المؤسسات
-- ---------------------------------------------------------------------------
insert into performance_review_criteria (organization_id, name_ar, name_en, weight)
select null, v.name_ar, v.name_en, v.weight
from (values
  ('جودة العمل', 'Work Quality', 1.5),
  ('الالتزام بالمواعيد', 'Punctuality', 1.0),
  ('العمل الجماعي', 'Teamwork', 1.0),
  ('التواصل مع المرضى', 'Patient Communication', 1.5),
  ('المبادرة والتطور', 'Initiative & Growth', 1.0)
) as v(name_ar, name_en, weight)
where not exists (select 1 from performance_review_criteria where organization_id is null and name_ar = v.name_ar);

-- ============================================================================
-- نهاية 0023_hr_performance_training.sql
-- الخطوة التالية: 0024_hr_reports.sql (عروض تجميعية فقط — تقرير حضور شهري،
-- تقرير إجازات، تقرير انتهاء عقود، تقرير أداء وتدريب — بلا أي جدول جديد)
-- ============================================================================
