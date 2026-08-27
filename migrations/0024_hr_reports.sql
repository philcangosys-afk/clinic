-- ============================================================================
-- 0024_hr_reports.sql
-- المرحلة 6.6 (الأخيرة) — تقارير الموارد البشرية
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0023 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- آخر ملف في كامل مجموعة الموارد البشرية الموسّعة — **بلا أي جدول جديد**،
-- فقط عروض تجميعية (Live Views) فوق كل ما بُني في 0019-0023. بعض التقارير
-- (أرصدة الإجازات، حالة العقود) لها عروض جاهزة أصلًا من مراحلها — الشاشة
-- تعيد استخدامها مباشرة بدل تكرارها، ويُضاف هنا فقط ما هو جديد فعليًا:
-- ملخص حضور شهري، آخر تقييم أداء لكل موظف، ولوحة ملخص عامة على مستوى المؤسسة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ملخص الحضور الشهري لكل موظف
-- ---------------------------------------------------------------------------
create or replace view v_hr_attendance_monthly as
select
  ar.organization_id,
  ar.employee_id,
  e.name_ar as employee_name,
  date_trunc('month', ar.work_date)::date as month,
  count(*) filter (where ar.status = 'present') as present_days,
  count(*) filter (where ar.status = 'late') as late_days,
  count(*) filter (where ar.status = 'absent') as absent_days,
  count(*) filter (where ar.status = 'on_leave') as on_leave_days,
  coalesce(sum(ar.late_minutes), 0) as total_late_minutes
from attendance_records ar
join employees e on e.id = ar.employee_id
group by ar.organization_id, ar.employee_id, e.name_ar, date_trunc('month', ar.work_date);

-- ---------------------------------------------------------------------------
-- 2) آخر تقييم أداء مُرسَل لكل موظف (عبر كل الدورات — أحدث دورة فقط)
-- ---------------------------------------------------------------------------
create or replace view v_hr_latest_performance as
select distinct on (pr.employee_id)
  pr.organization_id,
  pr.employee_id,
  e.name_ar as employee_name,
  pc.name_ar as cycle_name,
  pr.overall_score,
  pc.period_end
from performance_reviews pr
join employees e on e.id = pr.employee_id
join performance_review_cycles pc on pc.id = pr.cycle_id
order by pr.employee_id, pc.period_end desc;

-- ---------------------------------------------------------------------------
-- 3) لوحة ملخص عامة على مستوى المؤسسة — صف واحد لكل مؤسسة
-- ---------------------------------------------------------------------------
create or replace view v_hr_dashboard_summary as
select
  o.id as organization_id,
  (select count(*) from employees e where e.organization_id = o.id and e.status = 'active') as active_employees_count,
  (select count(*) from leave_requests lr where lr.organization_id = o.id and lr.status = 'pending') as pending_leave_requests_count,
  (select count(*) from employee_contracts c
     where c.organization_id = o.id and c.status = 'active' and c.end_date is not null
       and c.end_date >= current_date and c.end_date <= current_date + interval '30 days'
  ) as contracts_expiring_soon_count,
  (select count(*) from candidates c where c.organization_id = o.id and c.status not in ('hired','rejected')) as open_candidates_count,
  (select round(avg(pr.overall_score), 2) from performance_reviews pr
     join performance_review_cycles pc on pc.id = pr.cycle_id
     where pr.organization_id = o.id and pc.status = 'open'
  ) as avg_open_cycle_score,
  (select coalesce(sum(tp.hours), 0) from training_enrollments te
     join training_programs tp on tp.id = te.program_id
     where te.organization_id = o.id and te.status = 'completed'
       and te.completed_at >= date_trunc('year', current_date)
  ) as training_hours_this_year
from organizations o;

-- ============================================================================
-- نهاية 0024_hr_reports.sql — نهاية كامل مجموعة الموارد البشرية الموسّعة
-- لا خطوة تالية بعد هذا الملف ضمن ترتيب المستخدم المطلوب.
-- ============================================================================
