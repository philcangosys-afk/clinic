-- ---------------------------------------------------------------------------
-- 0163_member_names_not_auth_users.sql — إصلاح: منظوران يقرآن auth.users
-- ---------------------------------------------------------------------------
-- **عيبٌ أدخلتُه في 0161 و0162.** المنظوران يجلبان اسم المستخدم بربطٍ مباشر
-- بـ`auth.users`، وكلاهما `security_invoker = on` — أي يُنفَّذان بصلاحية
-- المستخدم الذي يستعلم، ودور `authenticated` لا يملك القراءة من `auth.users`.
-- النتيجة عند التشغيل:
--
--   permission denied for table users [42501]
--
-- فتسقط بطاقات ضغط الأطباء في شاشة الاستقبال، وتسقط شبكة الدفعات في الفاتورة.
--
-- **والعلاج ليس منح الصلاحية.** الرسالة التي يعرضها Supabase تقترح
-- `grant select on auth.users to authenticated` — وذلك يفتح بريد كل مستخدمي
-- المشروع لكل مستخدمٍ مسجَّل، في كل منشأة، إلى الأبد، لأجل عمودين. توسعةُ
-- صلاحيةٍ عامّة علاجًا لحاجةٍ ضيّقة هي كيف تُفتَح الأنظمة.
--
-- المصدر الصحيح موجود منذ 0026: `v_organization_members_directory` — يقرأ
-- `organization_memberships` و`doctors` و`employees`، **ولا يمسّ `auth.users`
-- إطلاقًا**، وهو `security_invoker` تعمل عليه سياسات RLS، وتقرؤه الواجهة
-- سلفًا في أربع شاشات. وهو يعطي **الاسم** لا البريد — وهو ما يريده الموظّف
-- فعلًا: «سارة» لا `sara@clinic.sa`.
--
-- ولأنّ اسم العمود يتغيّر (`sent_by_email` ← `sent_by_name`، و`user_email`
-- ← `user_name`) لا يكفي `create or replace`: تغيير اسم عمودٍ قائم يستلزم
-- الحذف وإعادة البناء. وترتيب الحذف من التابع إلى الأصل.
--
-- **أثرٌ جانبيّ مقصود:** العضو الذي غادر المنشأة (`is_active = false`) يظهر
-- اسمه فارغًا لا خطأً — الدليل يقصر على النشطين. وهذا أصدق من عرض اسم
-- موظّفٍ لم يعد موجودًا كأنّه ما زال.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) طابور الاستقبال — الحذف من التابع إلى الأصل ثم البناء بالعكس
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

  -- ── أعمدة 0161 ───────────────────────────────────────────────────────────
  p.name_en                  as patient_name_en,
  vt.name_ar                 as visit_type_name,

  -- **التغيير:** الاسم من دليل أعضاء المنشأة، لا البريد من `auth.users`.
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
-- الربط بالمنشأة لا بالمستخدم وحده: المستخدم قد يكون عضوًا في منشأتين،
-- والاسم المعروض يختلف بينهما (طبيبٌ هنا وموظّفٌ هناك).
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
where a.status in ('confirmed','arrived','checked_in','called','in_progress','walk_in','waiting');

alter view v_reception_queue set (security_invoker = on);
revoke all on v_reception_queue from anon;
grant select on v_reception_queue to authenticated;

comment on view v_reception_queue is
  'طابور الاستقبال: صفٌّ لكل موعدٍ حاضر، بوقت الانتظار والتنبيه الطبّي والتأمين والفاتورة، ومنذ 0161 بالاسم الإنجليزي ونوع الزيارة والمرسل ومتبقّي الاتفاقيات والآجل وهل عولج والخدمة. اسم المرسل من دليل الأعضاء لا من auth.users (0163).';

create view v_reception_queue_ordered as
select q.*,
       app_queue_rank(q.priority) as priority_rank,
       coalesce(rs.waiting_warning_minutes, 20)  as warning_minutes,
       coalesce(rs.waiting_critical_minutes, 40) as critical_minutes,
       case
         when q.waiting_minutes is null then 'none'
         when q.waiting_minutes >= coalesce(rs.waiting_critical_minutes, 40) then 'critical'
         when q.waiting_minutes >= coalesce(rs.waiting_warning_minutes, 20)  then 'warning'
         else 'ok'
       end as waiting_state
from v_reception_queue q
left join reception_settings rs on rs.organization_id = q.organization_id
order by
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
group by q.organization_id, q.branch_id, q.doctor_id, q.doctor_name;

comment on view v_reception_queue_by_doctor is
  'ضغط الطابور على كل طبيب: عدد المنتظرين والمُنادَين والداخلين وأطول انتظار. الأطباء بلا منتظرين لا يظهرون.';

revoke all on v_reception_queue_by_doctor from anon;
grant select on v_reception_queue_by_doctor to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) دفعات الفاتورة — المستخدم بالاسم لا بالبريد
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists v_invoice_payments;

create view v_invoice_payments as
select
  a.id                                as allocation_id,
  a.sales_invoice_id                  as invoice_id,
  v.id                                as voucher_id,
  v.organization_id,
  v.voucher_number,
  v.voucher_date,
  v.voucher_type,
  case
    when v.refund_of_voucher_id is not null then 'استرداد'
    when v.voucher_type = 'receipt'         then 'قبض'
    when v.voucher_type = 'expense'         then 'صرف'
    else coalesce(v.voucher_type, '—')
  end                                 as movement_label,
  pm.name_ar                          as payment_method_name,
  cr.name                             as register_name,
  d.name_ar                           as doctor_name,

  -- **التغيير:** الاسم من دليل أعضاء المنشأة، لا البريد من `auth.users`.
  dir.display_name                    as user_name,

  case when v.voucher_type = 'expense' then -a.amount else a.amount end as amount,
  a.amount                            as allocated_amount,
  v.is_void,
  v.void_reason,
  v.refund_of_voucher_id is not null   as is_refund,
  v.bank_transfer_ref,
  v.description                       as note,
  (select al.device_name
     from audit_log al
    where al.entity_id = v.id
      and al.module = 'financial_vouchers'
      and al.action_type = 'add'
      and al.device_name is not null
    order by al.occurred_at
    limit 1)                          as device_name,
  v.created_at
from voucher_invoice_allocations a
join financial_vouchers v on v.id = a.voucher_id
left join lookup_values pm on pm.id = v.payment_method_value_id
left join cash_registers cr on cr.id = v.cash_register_id
left join doctors d on d.id = v.doctor_id
left join v_organization_members_directory dir
       on dir.user_id = v.created_by
      and dir.organization_id = v.organization_id;

alter view v_invoice_payments set (security_invoker = on);
revoke all on v_invoice_payments from anon;
grant select on v_invoice_payments to authenticated;

comment on view v_invoice_payments is
  'دفعات الفاتورة: سندٌ وتاريخٌ ونوعٌ وصندوقٌ وطبيبٌ ومستخدمٌ وقيمةٌ بإشارتها وجهازٌ وملاحظة. المصدر تخصيصات السندات نفسها التي يُحسب منها المدفوع. اسم المستخدم من دليل الأعضاء لا من auth.users (0163).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) حارسٌ: لا يبقى في هذين المنظورين أثرٌ لـ auth.users
--
-- الفحص في الترقية نفسها لا في ذاكرة من كتبها: أيّ إعادةٍ لهما مستقبلًا
-- تمرّ من هنا، فإن عادت المشكلة سقطت الترقية بدل أن تسقط الشاشة عند الموظّف.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if pg_get_viewdef('v_reception_queue'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_reception_queue ما زال يقرأ auth.users';
  end if;
  if pg_get_viewdef('v_invoice_payments'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_invoice_payments ما زال يقرأ auth.users';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0163_member_names_not_auth_users.sql
-- ---------------------------------------------------------------------------
