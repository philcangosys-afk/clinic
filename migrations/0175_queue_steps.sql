-- ---------------------------------------------------------------------------
-- 0175 — الطابور بأربع خطوات واضحة، مشتركةٍ بين الطبيب والاستقبال
--
-- الشكوى: «النداء والدخول والخروج ليست واضحة، والمنطق غير مفهوم». وكانت
-- محقّة في أربعة أشياء:
--
--   (١) **خمس خطوات وأربع تسميات لكلّ واحدة.** «استقبال ١» و«استقبال ٢»،
--       و«حضر/وصول/تسجيل الوصول»، و«دخول/بدء الزيارة/الدخول إلى العيادة»،
--       و«إنهاء/خروج/إنهاء الزيارة» — الفعل الواحد باسمٍ مختلف في كلّ شاشة.
--   (٢) **«خرج» يُخفي المريض.** اللوحة لا تعرض المكتمل، فعمود «خروج» فارغٌ
--       أبدًا، والاستقبال لا يرى من خرج ليحصّل فاتورته.
--   (٣) **الاستقبال لا يملك «خرج»:** `reception.finish` ممنوحةٌ للطبيب ومدير
--       الفرع ولم تُمنح لموظّف الاستقبال — فالزرّ عنده معطَّلٌ دائمًا.
--   (٤) **الطبيب يرى الحالة بالإنجليزية** ولا يملك من شاشته إلّا «بدء الزيارة».
--
-- قرار المالك:
--   • **وصل** — الاستقبال (دُمج «استقبال ١» و«استقبال ٢» في خطوةٍ واحدة).
--   • **نداء** — الاستقبال.
--   • **دخل** و**خرج** — الطبيب أو الاستقبال، أيّهما سبق.
--   • ويعرف كلٌّ منهما ما فعله الآخر بتغيّر الحالة في لوحته — فورًا لا بعد
--     دورة تحديث.
--
-- هذه الترقية تُصلح ما في القاعدة من ذلك؛ والتسميات والأزرار في الواجهة.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) «خرج» للاستقبال
-- ═══════════════════════════════════════════════════════════════════════════
insert into role_default_permissions (role_key, permission_key)
select 'receptionist', 'reception.finish'
where exists (select 1 from permission_catalog where permission_key = 'reception.finish')
  and not exists (select 1 from role_default_permissions
                   where role_key = 'receptionist' and permission_key = 'reception.finish');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) لوحة الاستقبال: من خرج اليوم يبقى ظاهرًا
--
-- منقولةٌ من 0163 كما هي، إلّا ثلاثة مواضع مُعلَّمة:
--   • `v_reception_queue`: يُضاف المكتمل **اليوم** — الاستقبال يحتاجه ليحصّل.
--     و«اليوم» يوم الرياض لا يوم UTC: عيادةٌ تُغلق بعد التاسعة مساءً كانت
--     سترى مرضى الغد مكتملين أمس.
--   • `v_reception_queue_ordered`: من خرج في آخر اللوحة لا بين المنتظرين.
--   • `v_reception_queue_by_doctor`: ضغط الطبيب لا يعدّ من خرج.
-- ═══════════════════════════════════════════════════════════════════════════
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
where a.status in ('confirmed','arrived','checked_in','called','in_progress','walk_in','waiting')
   -- (0175) من خرج اليوم — بيوم الرياض
   or (a.status = 'completed'
       and a.left_at >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'));

alter view v_reception_queue set (security_invoker = on);
revoke all on v_reception_queue from anon;
grant select on v_reception_queue to authenticated;

comment on view v_reception_queue is
  'طابور الاستقبال: صفٌّ لكل موعدٍ حاضر أو خرج اليوم، بوقت الانتظار والتنبيه الطبّي والتأمين والفاتورة والاسم الإنجليزي ونوع الزيارة والمرسل ومتبقّي الاتفاقيات والآجل وهل عولج والخدمة (0161، 0163، 0175).';

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
  (q.status = 'completed'),          -- (0175) من خرج في آخر اللوحة
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
where q.status <> 'completed'        -- (0175) الضغط على الطبيب لا يعدّ من خرج
group by q.organization_id, q.branch_id, q.doctor_id, q.doctor_name;

comment on view v_reception_queue_by_doctor is
  'ضغط الطابور على كل طبيب: عدد المنتظرين والمُنادَين والداخلين وأطول انتظار. الأطباء بلا منتظرين لا يظهرون، ومن خرج لا يُعدّ (0175).';

revoke all on v_reception_queue_by_doctor from anon;
grant select on v_reception_queue_by_doctor to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) قائمة الطبيب: وقت الخروج
--
-- منقولةٌ من 0105 كما هي، ويُلحق بآخرها `left_at` — فالطبيب يرى الخطوات
-- الأربع بأوقاتها كما يراها الاستقبال.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_doctor_worklist
with (security_invoker = on) as
select
  a.id                  as appointment_id,
  a.organization_id,
  a.branch_id,
  a.doctor_id,
  doc.user_id           as doctor_user_id,
  a.patient_id,
  p.name_ar             as patient_name,
  p.file_number,
  a.scheduled_start,
  a.scheduled_end,
  a.status,
  cl.name               as clinic_name,
  a.checked_in_1_at,
  a.called_at,
  a.entered_at,
  case when a.checked_in_1_at is not null
       then round(extract(epoch from (coalesce(a.entered_at, now()) - a.checked_in_1_at)) / 60)::int
  end                   as waiting_minutes,
  v.id                  as visit_id,
  v.status              as visit_status,
  a.scheduled_start::date as report_date,
  a.left_at                                  -- (0175)
from appointments a
join patients p on p.id = a.patient_id
left join doctors doc on doc.id = a.doctor_id
left join clinics cl on cl.id = a.clinic_id
left join patient_visits v on v.appointment_id = a.id;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) البثّ الفوريّ للمواعيد
--
-- ما يضغطه الطبيب يظهر في لوحة الاستقبال خلال ثانية، والعكس — لا بعد
-- عشرين ثانية. وسياسات RLS تسري على البثّ كما على القراءة.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_all boolean;
begin
  select puballtables into v_all from pg_publication where pubname = 'supabase_realtime';
  if not found then
    raise notice 'لا نشر باسم supabase_realtime — اللوحتان تتحدّثان بالاستطلاع الدوريّ';
    return;
  end if;
  if v_all then
    return;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- حرسٌ ختاميّ
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if pg_get_viewdef('v_reception_queue'::regclass, true) not like '%completed%' then
    raise exception 'v_reception_queue لا يعرض من خرج';
  end if;
  if pg_get_viewdef('v_reception_queue'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_reception_queue يقرأ auth.users';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'v_doctor_worklist' and column_name = 'left_at') then
    raise exception 'v_doctor_worklist بلا left_at';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
