-- ---------------------------------------------------------------------------
-- 0068_reception_reports.sql — تقارير الاستقبال والمواعيد
-- ---------------------------------------------------------------------------
-- الأرقام كلها كانت تُحسب في المتصفح من صفوف مجلوبة: يجلب العميل مواعيد
-- الشهر ثم يعدّها. ثلاث مشكلات في ذلك:
--
--   • **الحدّ الأقصى للصفوف.** PostgREST يسقّف الرد، فتقرير شهر فيه ثلاثة
--     آلاف موعد يُحسب على ألف — ويظهر رقمًا **يبدو صحيحًا** وهو ناقص.
--
--   • **المنطقة الزمنية.** التجميع بالأيام في المتصفح يستعمل منطقة جهاز
--     الموظف، فيختلف تقرير من يفتحه من جهاز بإعداد مختلف.
--
--   • **الانتظار مقيسًا مرتين.** الشاشة تحسبه بطريقة والتقرير بأخرى، فيختلف
--     الرقمان ولا يُعرف أيهما الصحيح.
--
-- الدوال هنا تحسب في القاعدة، بنفس التعريفات المستعملة في لوحة الاستقبال
-- (0065): الانتظار من الوصول إلى النداء، لا من إنشاء الموعد.
--
-- كل الدوال تأخذ نفس المرشِّحات، فالتقارير الخمسة تتحرّك معًا بشريط واحد.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) تقرير المواعيد — الأعداد بالحالة
-- ---------------------------------------------------------------------------
create or replace function app_report_appointments(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_branch_id       uuid default null,
  p_doctor_id       uuid default null,
  p_clinic_id       uuid default null,
  p_visit_type_id   uuid default null,
  p_source_id       uuid default null,
  p_insurance       text default null
)
returns table (
  total          bigint,
  confirmed      bigint,
  unconfirmed    bigint,
  cancelled      bigint,
  no_show        bigint,
  completed      bigint,
  walk_in        bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    count(*),
    count(*) filter (where a.status = 'confirmed'),
    count(*) filter (where a.status in ('new','scheduled','unconfirmed')),
    count(*) filter (where a.status in ('cancelled_by_patient','cancelled_by_staff')),
    count(*) filter (where a.status = 'no_show'),
    count(*) filter (where a.status = 'completed'),
    count(*) filter (where a.status in ('walk_in','waiting'))
  from appointments a
  join patients p on p.id = a.patient_id
  where a.organization_id = p_organization_id
    and app_is_member(a.organization_id)
    and app_can_access_branch(a.organization_id, a.branch_id)
    -- المقارنة بتاريخ المنشأة لا بتاريخ متصفح الموظف: `::date` يُقيَّم
    -- بمنطقة الخادم الزمنية، فيتطابق التقرير مهما اختلف جهاز من يفتحه.
    and a.scheduled_start::date between p_from and p_to
    and (p_branch_id     is null or a.branch_id = p_branch_id)
    and (p_doctor_id     is null or a.doctor_id = p_doctor_id)
    and (p_clinic_id     is null or a.clinic_id = p_clinic_id)
    and (p_visit_type_id is null or a.visit_type_value_id = p_visit_type_id)
    and (p_source_id     is null or a.source_value_id = p_source_id)
    and (p_insurance     is null or p.insurance_company_name = p_insurance);
$$;

-- ---------------------------------------------------------------------------
-- 2) تقرير الانتظار — لكل طبيب
--
-- ثلاثة أزمنة مختلفة لا زمن واحد:
--   • حتى النداء     = الوصول ← النداء            (انتظار الاستقبال)
--   • حتى بدء الزيارة = الوصول ← الدخول            (الانتظار الكلي للمريض)
--   • داخل العيادة    = الدخول ← الخروج            (زمن الطبيب)
--
-- خلطها في رقم واحد يجعل تحسين أيٍّ منها مستحيلًا: لا يُعرف أين الاختناق.
-- ---------------------------------------------------------------------------
create or replace function app_report_waiting(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_branch_id       uuid default null,
  p_doctor_id       uuid default null,
  p_clinic_id       uuid default null
)
returns table (
  doctor_id            uuid,
  doctor_name          text,
  clinic_name          text,
  patients_count       bigint,
  avg_wait_to_call     numeric,
  max_wait_to_call     numeric,
  avg_wait_to_start    numeric,
  avg_in_clinic        numeric
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    d.id, d.name_ar, max(c.name),
    count(*) filter (where a.checked_in_1_at is not null),
    round(avg(extract(epoch from (a.called_at  - a.checked_in_1_at)) / 60)::numeric, 1),
    round(max(extract(epoch from (a.called_at  - a.checked_in_1_at)) / 60)::numeric, 1),
    round(avg(extract(epoch from (a.entered_at - a.checked_in_1_at)) / 60)::numeric, 1),
    round(avg(extract(epoch from (a.left_at    - a.entered_at))     / 60)::numeric, 1)
  from appointments a
  join doctors d on d.id = a.doctor_id
  left join clinics c on c.id = a.clinic_id
  where a.organization_id = p_organization_id
    and app_is_member(a.organization_id)
    and app_can_access_branch(a.organization_id, a.branch_id)
    and a.scheduled_start::date between p_from and p_to
    and (p_branch_id is null or a.branch_id = p_branch_id)
    and (p_doctor_id is null or a.doctor_id = p_doctor_id)
    and (p_clinic_id is null or a.clinic_id = p_clinic_id)
  group by d.id, d.name_ar
  order by 5 desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- 3) تقرير الإشغال
--
-- الساعات المتاحة من `doctor_working_hours` (غير المحجوبة)، والمحجوزة من
-- المواعيد الفعلية. طبيب بلا دوام مسجَّل تظهر ساعاته المتاحة صفرًا ونسبته
-- فارغة — لا 100% ولا صفر: **لا يُعرف** أفضل من رقم مختلَق.
-- ---------------------------------------------------------------------------
create or replace function app_report_occupancy(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_branch_id       uuid default null,
  p_doctor_id       uuid default null
)
returns table (
  doctor_id        uuid,
  doctor_name      text,
  available_hours  numeric,
  booked_hours     numeric,
  utilization_pct  numeric,
  idle_hours       numeric
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with work as (
    select h.doctor_id,
           sum(extract(epoch from (h.ends_at - h.starts_at)) / 3600.0) as hours
      from doctor_working_hours h
      join doctors d on d.id = h.doctor_id
     where d.organization_id = p_organization_id
       and not h.is_blocked
       and h.starts_at::date between p_from and p_to
       and (p_doctor_id is null or h.doctor_id = p_doctor_id)
     group by h.doctor_id
  ),
  booked as (
    select a.doctor_id,
           sum(extract(epoch from (a.scheduled_end - a.scheduled_start)) / 3600.0) as hours
      from appointments a
     where a.organization_id = p_organization_id
       and app_can_access_branch(a.organization_id, a.branch_id)
       and a.scheduled_start::date between p_from and p_to
       and a.status not in ('cancelled_by_patient','cancelled_by_staff','no_show')
       and (p_branch_id is null or a.branch_id = p_branch_id)
       and (p_doctor_id is null or a.doctor_id = p_doctor_id)
     group by a.doctor_id
  )
  select d.id, d.name_ar,
         round(coalesce(w.hours, 0)::numeric, 1),
         round(coalesce(b.hours, 0)::numeric, 1),
         case when coalesce(w.hours, 0) > 0
              then round((coalesce(b.hours, 0) / w.hours * 100)::numeric, 1) end,
         case when coalesce(w.hours, 0) > 0
              then round(greatest(w.hours - coalesce(b.hours, 0), 0)::numeric, 1) end
  from doctors d
  left join work   w on w.doctor_id = d.id
  left join booked b on b.doctor_id = d.id
  where d.organization_id = p_organization_id
    and app_is_member(d.organization_id)
    and (p_doctor_id is null or d.id = p_doctor_id)
    and (coalesce(w.hours, 0) > 0 or coalesce(b.hours, 0) > 0)
  order by 5 desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- 4) تقرير مصادر الحجز
--
-- المواعيد بلا مصدر تظهر باسمها الصريح «غير محدَّد» لا تُحذف من التقرير:
-- نصيبها هو المؤشّر الحقيقي على جودة الإدخال، وإخفاؤه يُجمِّل الأرقام.
-- ---------------------------------------------------------------------------
create or replace function app_report_booking_sources(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_branch_id       uuid default null,
  p_doctor_id       uuid default null
)
returns table (
  source_id    uuid,
  source_name  text,
  total        bigint,
  completed    bigint,
  no_show      bigint,
  share_pct    numeric
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with rows as (
    select a.source_value_id, a.status
      from appointments a
     where a.organization_id = p_organization_id
       and app_is_member(a.organization_id)
       and app_can_access_branch(a.organization_id, a.branch_id)
       and a.scheduled_start::date between p_from and p_to
       and (p_branch_id is null or a.branch_id = p_branch_id)
       and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  )
  select r.source_value_id,
         coalesce(lv.name_ar, 'غير محدَّد'),
         count(*),
         count(*) filter (where r.status = 'completed'),
         count(*) filter (where r.status = 'no_show'),
         round((count(*)::numeric / nullif((select count(*) from rows), 0) * 100), 1)
  from rows r
  left join lookup_values lv on lv.id = r.source_value_id
  group by r.source_value_id, lv.name_ar
  order by 3 desc;
$$;

-- ---------------------------------------------------------------------------
-- 5) تقرير الإلغاء وعدم الحضور
--
-- **الخسارة تقديرية بإفصاح.** تُحسب بمتوسط صافي فواتير الطبيب في نفس الفترة
-- مضروبًا في عدد المتغيّبين. ليست خسارة محقّقة: قد يُملأ الموعد بمريض آخر،
-- وقد لا يكون للطبيب فواتير في الفترة أصلًا فتظهر فارغة. الرقم مؤشّر ترتيب
-- لا بند محاسبي — ولا يُدرج في أي قائمة دخل.
-- ---------------------------------------------------------------------------
create or replace function app_report_no_show(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_branch_id       uuid default null,
  p_doctor_id       uuid default null
)
returns table (
  doctor_id         uuid,
  doctor_name       text,
  total             bigint,
  no_show_count     bigint,
  cancelled_count   bigint,
  no_show_pct       numeric,
  avg_invoice       numeric,
  estimated_loss    numeric
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with base as (
    select a.doctor_id, a.status
      from appointments a
     where a.organization_id = p_organization_id
       and app_is_member(a.organization_id)
       and app_can_access_branch(a.organization_id, a.branch_id)
       and a.scheduled_start::date between p_from and p_to
       and (p_branch_id is null or a.branch_id = p_branch_id)
       and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  ),
  avg_inv as (
    select s.doctor_id, avg(s.net_amount) as avg_net
      from sales_invoices s
     where s.organization_id = p_organization_id
       and s.invoice_type = 'sale'
       and s.created_at::date between p_from and p_to
     group by s.doctor_id
  )
  select d.id, d.name_ar,
         count(*),
         count(*) filter (where b.status = 'no_show'),
         count(*) filter (where b.status in ('cancelled_by_patient','cancelled_by_staff')),
         round((count(*) filter (where b.status = 'no_show')::numeric / nullif(count(*), 0) * 100), 1),
         round(ai.avg_net::numeric, 2),
         round((count(*) filter (where b.status = 'no_show') * ai.avg_net)::numeric, 2)
  from base b
  join doctors d on d.id = b.doctor_id
  left join avg_inv ai on ai.doctor_id = d.id
  group by d.id, d.name_ar, ai.avg_net
  order by 4 desc;
$$;

-- ---------------------------------------------------------------------------
-- 6) المرضى المتكرّرون في عدم الحضور — للتنقّل من الرقم إلى الأسماء
-- ---------------------------------------------------------------------------
create or replace function app_report_repeat_no_show(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_min_count       integer default 2
)
returns table (
  patient_id    uuid,
  patient_name  text,
  file_number   text,
  mobile_number text,
  no_show_count bigint,
  last_no_show  timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name_ar, p.file_number::text, p.mobile_number,
         count(*), max(a.updated_at)
  from appointments a
  join patients p on p.id = a.patient_id
  where a.organization_id = p_organization_id
    and app_is_member(a.organization_id)
    and app_can_access_branch(a.organization_id, a.branch_id)
    and a.status = 'no_show'
    and a.scheduled_start::date between p_from and p_to
  group by p.id, p.name_ar, p.file_number, p.mobile_number
  having count(*) >= greatest(p_min_count, 1)
  order by 5 desc;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'app_report_appointments(uuid,date,date,uuid,uuid,uuid,uuid,uuid,text)',
    'app_report_waiting(uuid,date,date,uuid,uuid,uuid)',
    'app_report_occupancy(uuid,date,date,uuid,uuid)',
    'app_report_booking_sources(uuid,date,date,uuid,uuid)',
    'app_report_no_show(uuid,date,date,uuid,uuid)',
    'app_report_repeat_no_show(uuid,date,date,integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
