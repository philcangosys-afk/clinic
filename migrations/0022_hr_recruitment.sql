-- ============================================================================
-- 0022_hr_recruitment.sql
-- المرحلة 6.4 — الموارد البشرية الموسّعة: التوظيف
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0021 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) الوظائف الشاغرة
-- ---------------------------------------------------------------------------
create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  title_ar text not null,
  title_en text,
  description text,
  status text not null default 'open' check (status in ('open','on_hold','closed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_postings_org on job_postings (organization_id, status);

-- ---------------------------------------------------------------------------
-- 2) المرشحون
-- ---------------------------------------------------------------------------
create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_posting_id uuid references job_postings(id) on delete set null,
  name_ar text not null,
  mobile text,
  email text,
  cv_storage_path text,
  source text,    -- موقع توظيف/إحالة/تقديم مباشر...
  status text not null default 'applied' check (
    status in ('applied','screening','interview','offer','hired','rejected')
  ),
  rejection_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_candidates_org_status on candidates (organization_id, status);
create index if not exists idx_candidates_job_posting on candidates (job_posting_id);

-- ---------------------------------------------------------------------------
-- 3) مراحل المقابلات لكل مرشح
-- ---------------------------------------------------------------------------
create table if not exists candidate_interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  stage text not null default 'phone_screen' check (stage in ('phone_screen','technical','final')),
  scheduled_at timestamptz,
  interviewer_name text,
  outcome text not null default 'pending' check (outcome in ('pending','passed','failed')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_candidate_interviews_candidate on candidate_interviews (candidate_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- ⭐ ربط اختياري من employees لمصدر التوظيف — "لمسة سحرية": عند تحويل مرشح
-- إلى "مُوظَّف" يُنشأ سجل employees تلقائيًا بدل إعادة كتابة بياناته يدويًا،
-- نفس فلسفة إعادة الاستخدام المعتمدة في صرف الأدوية (0015) وفواتير الشراء
-- ---------------------------------------------------------------------------
alter table employees
  add column if not exists source_candidate_id uuid references candidates(id) on delete set null;
create index if not exists idx_employees_source_candidate on employees (source_candidate_id);

create or replace function app_create_employee_on_hire()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'hired' and new.status = 'hired' then
    -- لا يُكرَّر الإنشاء إن كان يوجد أصلًا موظف من هذا المرشح
    if not exists (select 1 from employees where source_candidate_id = new.id) then
      insert into employees (organization_id, name_ar, mobile_1, source_candidate_id, hire_date)
      values (new.organization_id, new.name_ar, new.mobile, new.id, current_date);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_employee_on_hire on candidates;
create trigger trg_create_employee_on_hire
  after update of status on candidates
  for each row execute function app_create_employee_on_hire();

-- ---------------------------------------------------------------------------
-- عرض: مسار خط التوظيف (Pipeline) — عدد المرشحين في كل حالة لكل وظيفة شاغرة
-- ---------------------------------------------------------------------------
create or replace view v_recruitment_pipeline as
select
  jp.organization_id,
  jp.id as job_posting_id,
  jp.title_ar as job_title,
  jp.status as job_status,
  count(*) filter (where c.status = 'applied') as applied_count,
  count(*) filter (where c.status = 'screening') as screening_count,
  count(*) filter (where c.status = 'interview') as interview_count,
  count(*) filter (where c.status = 'offer') as offer_count,
  count(*) filter (where c.status = 'hired') as hired_count,
  count(*) filter (where c.status = 'rejected') as rejected_count
from job_postings jp
left join candidates c on c.job_posting_id = jp.id
group by jp.id, jp.organization_id, jp.title_ar, jp.status;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table job_postings enable row level security;
alter table candidates enable row level security;
alter table candidate_interviews enable row level security;

create policy "job_postings_all_members" on job_postings
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "candidates_all_members" on candidates
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "candidate_interviews_all_members" on candidate_interviews
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- نهاية 0022_hr_recruitment.sql
-- الخطوة التالية: 0023_hr_performance_training.sql (دورات تقييم الأداء،
-- تقييمات فردية بمعايير قابلة للتخصيص، برامج تدريب، تسجيل حضور التدريب)
-- ============================================================================
