-- ---------------------------------------------------------------------------
-- 0176 — الاستقبال بسجلّ كلّ يوم: من خرج يبقى في مكانه ويتغيّر لونه
--
-- قرار المالك بعد 0175:
--   • **من خرج لا يغادر الطابور ولا ينتقل إلى آخره** — يبقى في مكانه ويصير
--     أخضر. (0175 كانت تُنزله إلى الآخر.)
--   • **كلّ يوم يعرض يومه**، والأيام السابقة بتغيير التاريخ في الشاشة.
--
-- فالمنظور يحمل الآن كلّ الأيام — الحاضر ومن خرج — والشاشة تصفّي بتاريخ
-- الموعد. كان يعرض الحاضرين بلا حدّ تاريخ أصلًا، فحاضرٌ لم يُغلق أمس يظهر
-- في طابور اليوم؛ التصفية باليوم تُعيده إلى يومه.
--
-- وضغط الأطباء (`v_reception_queue_by_doctor`) سؤالٌ عن الآن: يُحصر في اليوم.
--
-- منقولةٌ من 0175 كما هي عدا المواضع المعلَّمة (0176). وتُنفَّذ بعد 0175.
-- ---------------------------------------------------------------------------

begin;

drop view if exists v_reception_queue_ordered;
drop view if exists v_reception_queue_by_doctor;
drop view if exists v_reception_queue;

create view v_reception_queue as
select
  a.id                       as appointment_id,
  a.organization_id,
  a.branch_id,
  a.queue_number,
  a.status,
  a.priority,
  a.scheduled_start,
  a.checked_in_1_at          as arrived_at,
  a.checked_in_2_at          as checked_in_at,
  a.called_at,
  a.entered_at,
  a.left_at,
  a.note,
  p.id                       as patient_id,
  p.name_ar                  as patient_name,
  p.file_number,
  p.mobile_number,
  p.blood_type,
  p.insurance_company_name,
  (p.insurance_company_name is not null
     and (p.insurance_membership_expiry is null
          or p.insurance_membership_expiry >= current_date))            as insurance_valid,
  d.id                       as doctor_id,
  d.name_ar                  as doctor_name,
  c.id                       as clinic_id,
  c.name                     as clinic_name,

  (select string_agg(h.name_ar, '، ' order by h.sort_order)
     from patient_health_conditions phc
     join health_conditions h on h.id = phc.condition_id
    where phc.patient_id = p.id and phc.is_checked)                     as medical_alert,

  case
    when a.checked_in_1_at is null then null
    else floor(extract(epoch from (coalesce(a.called_at, now()) - a.checked_in_1_at)) / 60)::integer
  end                                                                   as waiting_minutes,

  inv.invoice_id,
  inv.invoice_status,
  inv.remaining_amount,

  p.name_en                  as patient_name_en,
  vt.name_ar                 as visit_type_name,
  dir.display_name           as sent_by_name,
  coalesce(agr.remaining_total, 0)                                      as agreement_remaining,
  coalesce(dbt.deferred_total, 0)                                       as deferred_amount,
  exists (
    select 1 from patient_visits pv
     where pv.appointment_id = a.id
       and (pv.closed_at is not null or pv.signed_at is not null)
  )                                                                     as treated,
  it.name_ar                 as service_name

from appointments a
join patients p on p.id = a.patient_id
join doctors  d on d.id = a.doctor_id
left join clinics c on c.id = a.clinic_id
left join lookup_values vt on vt.id = a.visit_type_value_id
left join items it on it.id = a.item_id
left join v_organization_members_directory dir
       on dir.user_id = a.sent_by_user_id
      and dir.organization_id = a.organization_id
left join lateral (
  select s.id as invoice_id, s.status as invoice_status, s.remaining_amount
    from sales_invoices s
   where s.appointment_id = a.id and s.invoice_type = 'sale'
   order by s.created_at desc
   limit 1
) inv on true
left join lateral (
  select sum(coalesce(ta.remaining_amount, 0)) as remaining_total
    from treatment_agreements ta
   where ta.patient_id = p.id
     and coalesce(ta.is_disabled, false) = false
     and coalesce(ta.remaining_amount, 0) > 0
) agr on true
left join lateral (
  select sum(coalesce(s2.remaining_amount, 0)) as deferred_total
    from sales_invoices s2
   where s2.patient_id = p.id
     and s2.invoice_type = 'sale'
     and coalesce(s2.status, '') <> 'void'
     and coalesce(s2.is_temporary, false) = false
     and coalesce(s2.remaining_amount, 0) > 0
) dbt on true
-- (0176) من خرج يبقى في سجلّ يومه — والشاشة تصفّي بالتاريخ (اليوم افتراضًا)
where a.status in ('confirmed','arrived','checked_in','called','in_progress','walk_in','waiting','completed');

alter view v_reception_queue set (security_invoker = on);
revoke all on v_reception_queue from anon;
grant select on v_reception_queue to authenticated;

comment on view v_reception_queue is
  'طابور الاستقبال: صفٌّ لكل موعدٍ حاضر أو خرج — كلّ الأيام، والشاشة تصفّي باليوم، بوقت الانتظار والتنبيه الطبّي والتأمين والفاتورة والاسم الإنجليزي ونوع الزيارة والمرسل ومتبقّي الاتفاقيات والآجل وهل عولج والخدمة (0161، 0163، 0175، 0176).';

create view v_reception_queue_ordered as
select q.*,
       app_queue_rank(q.priority) as priority_rank,
       coalesce(rs.waiting_warning_minutes, 20)  as warning_minutes,
       coalesce(rs.waiting_critical_minutes, 40) as critical_minutes,
       case
         when q.waiting_minutes is null then 'none'
         -- (0175) من خرج لا ينتظر شيئًا
         when q.status = 'completed' then 'none'
         when q.waiting_minutes >= coalesce(rs.waiting_critical_minutes, 40) then 'critical'
         when q.waiting_minutes >= coalesce(rs.waiting_warning_minutes, 20)  then 'warning'
         else 'ok'
       end as waiting_state
from v_reception_queue q
left join reception_settings rs on rs.organization_id = q.organization_id
order by
  -- (0176) من خرج يبقى في مكانه ويتغيّر لونه — لا ينتقل إلى آخر اللوحة
  app_queue_rank(q.priority),
  q.arrived_at nulls last,
  q.scheduled_start;

alter view v_reception_queue_ordered set (security_invoker = on);
revoke all on v_reception_queue_ordered from anon;
grant select on v_reception_queue_ordered to authenticated;

create view v_reception_queue_by_doctor
with (security_invoker = on) as
select
  q.organization_id,
  q.branch_id,
  q.doctor_id,
  q.doctor_name,
  count(*)                                                          as total,
  count(*) filter (where q.status in ('confirmed','walk_in','waiting'))  as waiting_count,
  count(*) filter (where q.status = 'arrived')                      as arrived_count,
  count(*) filter (where q.status = 'checked_in')                   as checked_in_count,
  count(*) filter (where q.status = 'called')                       as called_count,
  count(*) filter (where q.status = 'in_progress')                  as in_progress_count,
  max(q.waiting_minutes)                                            as longest_wait_minutes,
  min(q.scheduled_start)                                            as first_slot
from v_reception_queue q
where q.status <> 'completed'        -- الضغط على الطبيب لا يعدّ من خرج
  -- (0176) واليوم وحده: الطابور صار يحمل كلّ الأيام، والضغط سؤالٌ عن الآن
  and q.scheduled_start >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')
  and q.scheduled_start <  (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') + interval '1 day'
group by q.organization_id, q.branch_id, q.doctor_id, q.doctor_name;

comment on view v_reception_queue_by_doctor is
  'ضغط الطابور على كل طبيب: عدد المنتظرين والمُنادَين والداخلين وأطول انتظار. الأطباء بلا منتظرين لا يظهرون، ومن خرج لا يُعدّ، واليوم وحده (0175، 0176).';

revoke all on v_reception_queue_by_doctor from anon;
grant select on v_reception_queue_by_doctor to authenticated;


do $$
begin
  if pg_get_viewdef('v_reception_queue_ordered'::regclass, true) ilike '%order by (q.status%' then
    raise exception 'الطابور ما زال ينقل من خرج إلى الآخر';
  end if;
  if pg_get_viewdef('v_reception_queue'::regclass, true) not like '%completed%' then
    raise exception 'v_reception_queue لا يعرض من خرج';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
