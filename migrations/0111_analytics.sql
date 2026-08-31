-- ============================================================================
-- 0111 — المرحلة 31: التحليلات والاتجاهات
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- النظام مليء بالتقارير منذ المرحلة 14 (خمسة عشر منظورًا)، وكلّها تُجيب عن
-- سؤال «ماذا حدث؟» صفًّا صفًّا. وما ينقص سؤالٌ آخر تمامًا:
--
--     **«هل نتحسّن أم نتراجع؟»**
--
-- ولا يُجاب عنه بقائمة، بل بسلسلةٍ زمنية ومقارنةٍ بفترةٍ سابقة. وبلا ذلك
-- يبقى الرقم بلا معنى: «١٢ حالة عدم حضور» ليست خبرًا حتى تُقارن بالشهر
-- الماضي.
--
-- ومبدآن يحكمان هذا الملف:
--
--   1) **الحساب في القاعدة لا في الشاشة.** لو حسبت الشاشة الفروق بنفسها
--      لاختلف رقم لوحة التحكم عن رقم التقرير عن رقم التصدير، ولصار لكل
--      شاشة حقيقتها. المصدر واحد هنا.
--   2) **لا مقارنة بلا أساس.** إن كانت الفترة السابقة صفرًا فلا نسبة تغيّر
--      — تُترك فارغة ولا تُكتب «+100%» ولا «∞».
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحية
-- ===========================================================================
-- المفتاح `advanced_analytics.view` لا `analytics.view`: ميزة التحليلات
-- المتقدّمة قائمة في كتالوج المزايا منذ 0001، وقاعدة النظام أن صلاحية فتح
-- الموديول هي «مفتاح الميزة + view». اختراع مفتاحٍ ثانٍ يعني بابين لغرفة واحدة.
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if to_regclass('public.patient_portal_accounts') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql  (بوابة المريض)';
  end if;
  if to_regclass('public.critical_result_notifications') is null then
    v_missing := v_missing || E'\n  • 0105_doctor_workspace.sql  (مساحة الطبيب والنتائج الحرجة)';
  end if;
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if to_regclass('public.organization_policies') is null then
    v_missing := v_missing || E'\n  • 0107_organization_policies.sql  (سياسات المنشأة)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'app_set_membership_role') then
    v_missing := v_missing || E'\n  • 0108_users_and_permissions.sql  (المستخدمون والصلاحيات)';
  end if;
  if to_regclass('public.organization_locale_settings') is null then
    v_missing := v_missing || E'\n  • 0109_locale_and_gcc.sql  (اللغة وإعدادات الخليج)';
  end if;
  if to_regclass('public.integration_settings') is null then
    v_missing := v_missing || E'\n  • 0110_integrations.sql  (التكاملات)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0111_analytics.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select 'advanced_analytics.view', 'عرض التحليلات', 'analytics', 2300
where not exists (select 1 from permission_catalog
                   where permission_key = 'advanced_analytics.view');

insert into role_default_permissions (role_key, permission_key)
select r, 'advanced_analytics.view' from (values ('branch_manager'), ('accountant')) as v(r)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r
                     and d.permission_key = 'advanced_analytics.view');

-- ===========================================================================
-- 2) السلسلة اليومية — أساس كل رسم بياني
--    يومٌ واحد لكل منشأة/فرع، بكل ما يُقاس في ذلك اليوم.
-- ===========================================================================
drop view if exists v_analytics_daily;
create view v_analytics_daily
with (security_invoker = on) as
with days as (
  select organization_id, branch_id, day from (
    select organization_id, branch_id, scheduled_start::date as day
      from appointments
    union
    select organization_id, branch_id, visit_date::date from patient_visits
    union
    select organization_id, branch_id, created_at::date from sales_invoices
    union
    select organization_id, branch_id, created_at::date from patients
  ) s
  where day is not null
),
appt as (
  select organization_id, branch_id, scheduled_start::date as day,
         count(*)                                            as appointments_total,
         count(*) filter (where status = 'no_show')           as no_shows,
         count(*) filter (where status = 'cancelled_by_patient') as patient_cancellations,
         avg(extract(epoch from (entered_at - checked_in_1_at)) / 60)
           filter (where checked_in_1_at is not null and entered_at is not null)
                                                              as avg_waiting_minutes
    from appointments group by 1, 2, 3
),
vis as (
  select organization_id, branch_id, visit_date::date as day,
         count(*)                                             as visits_total,
         count(*) filter (where status in ('draft','in_progress')) as visits_open
    from patient_visits group by 1, 2, 3
),
newp as (
  select organization_id, branch_id, created_at::date as day, count(*) as new_patients
    from patients group by 1, 2, 3
),
inv as (
  select organization_id, branch_id, created_at::date as day,
         count(*)                          as invoices_count,
         sum(coalesce(net_amount, 0))      as revenue,
         sum(coalesce(remaining_amount, 0)) as outstanding_added
    from sales_invoices
   where status <> 'void'
   group by 1, 2, 3
)
select
  d.organization_id,
  d.branch_id,
  d.day                                        as report_date,
  coalesce(a.appointments_total, 0)            as appointments_total,
  coalesce(a.no_shows, 0)                      as no_shows,
  coalesce(a.patient_cancellations, 0)         as patient_cancellations,
  round(a.avg_waiting_minutes)::int            as avg_waiting_minutes,
  coalesce(v.visits_total, 0)                  as visits_total,
  coalesce(v.visits_open, 0)                   as visits_open,
  coalesce(n.new_patients, 0)                  as new_patients,
  coalesce(i.invoices_count, 0)                as invoices_count,
  round(coalesce(i.revenue, 0), 2)             as revenue,
  round(coalesce(i.outstanding_added, 0), 2)   as outstanding_added
from days d
left join appt a on a.organization_id = d.organization_id
                and a.branch_id is not distinct from d.branch_id and a.day = d.day
left join vis  v on v.organization_id = d.organization_id
                and v.branch_id is not distinct from d.branch_id and v.day = d.day
left join newp n on n.organization_id = d.organization_id
                and n.branch_id is not distinct from d.branch_id and n.day = d.day
left join inv  i on i.organization_id = d.organization_id
                and i.branch_id is not distinct from d.branch_id and i.day = d.day;

comment on view v_analytics_daily is
  'سلسلة يومية لكل منشأة/فرع: المواعيد وعدم الحضور والانتظار والزيارات والمرضى الجدد والإيراد.';

-- ===========================================================================
-- 3) المقارنة بفترة سابقة — **الحساب هنا لا في الشاشة**
-- ===========================================================================
create or replace function app_analytics_summary(
  p_org  uuid,
  p_from date,
  p_to   date
)
returns table (
  metric_key      text,
  metric_name     text,
  current_value   numeric,
  previous_value  numeric,
  change_percent  numeric,
  higher_is_better boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days     int;
  v_prev_to  date;
  v_prev_from date;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  if p_to < p_from then
    raise exception 'نهاية الفترة قبل بدايتها';
  end if;

  -- الفترة السابقة بطول الفترة الحالية نفسها: مقارنة أسبوعٍ بشهرٍ لا معنى لها
  v_days      := (p_to - p_from) + 1;
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  return query
  with cur as (
    select
      coalesce(sum(appointments_total), 0)::numeric  as appointments,
      coalesce(sum(no_shows), 0)::numeric            as no_shows,
      coalesce(sum(visits_total), 0)::numeric        as visits,
      coalesce(sum(new_patients), 0)::numeric        as new_patients,
      coalesce(sum(revenue), 0)::numeric             as revenue,
      avg(avg_waiting_minutes)::numeric              as waiting
    from v_analytics_daily
     where organization_id = p_org and report_date between p_from and p_to
  ),
  prv as (
    select
      coalesce(sum(appointments_total), 0)::numeric  as appointments,
      coalesce(sum(no_shows), 0)::numeric            as no_shows,
      coalesce(sum(visits_total), 0)::numeric        as visits,
      coalesce(sum(new_patients), 0)::numeric        as new_patients,
      coalesce(sum(revenue), 0)::numeric             as revenue,
      avg(avg_waiting_minutes)::numeric              as waiting
    from v_analytics_daily
     where organization_id = p_org and report_date between v_prev_from and v_prev_to
  ),
  pairs as (
    select 'appointments'::text as k, 'المواعيد'::text as n,
           c.appointments as cur_v, p.appointments as prev_v, true as hib
      from cur c cross join prv p
    union all
    select 'visits', 'الزيارات', c.visits, p.visits, true from cur c cross join prv p
    union all
    select 'new_patients', 'مرضى جدد', c.new_patients, p.new_patients, true
      from cur c cross join prv p
    union all
    select 'revenue', 'الإيراد', c.revenue, p.revenue, true from cur c cross join prv p
    union all
    select 'no_shows', 'عدم الحضور', c.no_shows, p.no_shows, false
      from cur c cross join prv p
    union all
    select 'avg_waiting', 'متوسّط الانتظار (د)', c.waiting, p.waiting, false
      from cur c cross join prv p
  )
  select
    pairs.k,
    pairs.n,
    round(coalesce(pairs.cur_v, 0), 2),
    round(coalesce(pairs.prev_v, 0), 2),
    -- **لا نسبة تغيّر بلا أساس**: قسمةٌ على صفر تُترك فارغة لا تُكتب ∞
    case when coalesce(pairs.prev_v, 0) = 0 then null
         else round(((coalesce(pairs.cur_v, 0) - pairs.prev_v) / pairs.prev_v) * 100, 1) end,
    pairs.hib
  from pairs;
end $$;

-- ===========================================================================
-- 4) مناظير مساعدة
-- ===========================================================================

-- أكثر الخدمات طلبًا: يجيب «فيمَ نعمل فعلًا؟»
drop view if exists v_analytics_top_services;
create view v_analytics_top_services
with (security_invoker = on) as
select
  s.organization_id,
  v.branch_id,
  s.item_id,
  i.name_ar        as item_name,
  i.name_en        as item_name_en,
  count(*)         as times_performed,
  sum(coalesce(s.qty, 1))                                   as total_qty,
  round(sum(coalesce(s.unit_price, 0) * coalesce(s.qty, 1)), 2) as total_value,
  v.visit_date::date as report_date
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join items i on i.id = s.item_id
where s.status in ('performed','invoiced','paid','claimed')
group by s.organization_id, v.branch_id, s.item_id, i.name_ar, i.name_en, v.visit_date::date;

-- ساعات الذروة: متى يزدحم المكان؟ أساس توزيع المناوبات
drop view if exists v_analytics_peak_hours;
create view v_analytics_peak_hours
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  extract(dow  from scheduled_start)::int  as weekday,
  extract(hour from scheduled_start)::int  as hour_of_day,
  count(*)                                 as appointments,
  count(*) filter (where status = 'no_show') as no_shows,
  scheduled_start::date                    as report_date
from appointments
group by organization_id, branch_id,
         extract(dow from scheduled_start), extract(hour from scheduled_start),
         scheduled_start::date;

grant select on v_analytics_daily, v_analytics_top_services,
                v_analytics_peak_hours to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'app_analytics_summary'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 5) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_analytics_summary') then
    raise exception 'دالّة ملخّص التحليلات غير موجودة';
  end if;

  foreach v_v in array array['v_analytics_daily','v_analytics_top_services',
                             'v_analytics_peak_hours']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'منظور التحليلات % بلا security_invoker', v_v;
    end if;
  end loop;
end $$;
