-- ============================================================================
-- 0144 — ما لا يُصلَح إلّا في القاعدة من مراجعة 06.09.2026
--
-- كل بند هنا خرج من إصلاح شاشةٍ توقّف عند حدّ القاعدة: مُرشِّح تُسقطه الشاشة
-- لأن الدالّة لا تقبله، ومنظور يُخفي طلبًا ما زال قيد العمل، وعمود تُعلنه
-- الواجهة ولا وجود له، ومجموعٌ يُحسب من صفوف ملغاة.
--
-- الترتيب من الأثر المالي إلى التشغيلي. كل قسم ينتهي بفحص ذاتي.
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1) عرض السعر ليس ذمّة على المريض
--
--    `v_patient_balance` يجمع كل فواتير المريض بلا استثناء المؤقّت — وعرض
--    السعر فاتورة مؤقّتة لم تُصدَر بعد. فكان المريض يظهر في «أعلى الذمم» بمبلغ
--    عرضٍ لم يوافق عليه أصلًا، ويُطالَب به.
-- ════════════════════════════════════════════════════════════════════════

create or replace view v_patient_balance as
select
  p.id as patient_id,
  p.organization_id,
  p.name_ar as patient_name,
  p.file_number,
  coalesce(sum(i.net_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_billed,
  coalesce(sum(i.paid_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_paid,
  coalesce(sum(i.refunded_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_refunded,
  coalesce(sum(i.remaining_amount) filter (
    where i.status = any (array['unpaid','partial']) and coalesce(i.is_temporary, false) = false
  ), 0) as balance_due,
  count(i.id) filter (
    where i.status = any (array['unpaid','partial']) and coalesce(i.is_temporary, false) = false
  ) as open_invoices,
  max(i.issued_at) filter (where coalesce(i.is_temporary, false) = false) as last_invoice_at
from patients p
left join sales_invoices i on i.patient_id = p.id
group by p.id, p.organization_id, p.name_ar, p.file_number;
alter view v_patient_balance set (security_invoker = on);

-- ════════════════════════════════════════════════════════════════════════
-- 2) عرض السعر ليس فاتورة متأخّرة
--
--    `is_overdue` في سجلّ الفواتير يعتمد الحالة والتاريخ وحدهما، وعرض السعر
--    يبقى `unpaid` أبدًا — فيظهر بعد ثلاثين يومًا في قائمة المتأخرات.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_src text;
begin
  select pg_get_viewdef('v_invoice_register'::regclass, true) into v_src;
  v_src := replace(v_src, chr(13), '');
  -- الفحص بلا حساسية لحالة الأحرف: Postgres يعيد كتابة التعبير بحروف كبيرة
  -- عند حفظه، فمقارنة النصّ كما كُتب هنا تفشل في التنفيذ الثاني.
  if v_src ilike '%is_temporary, false) = false AS is_overdue%' then
    return; -- مُصلَح سلفًا
  end if;
  if position('AND i.issued_at < (now() - ''30 days''::interval) AS is_overdue' in v_src) = 0 then
    raise exception 'تعذّر تصحيح is_overdue: تغيّر نصّ v_invoice_register';
  end if;
  v_src := replace(
    v_src,
    'AND i.issued_at < (now() - ''30 days''::interval) AS is_overdue',
    'AND i.issued_at < (now() - ''30 days''::interval) AND coalesce(i.is_temporary, false) = false AS is_overdue'
  );
  execute 'create or replace view v_invoice_register as ' || v_src;
  execute 'alter view v_invoice_register set (security_invoker = on)';
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) حصيلة العرض هي خصم العرض، لا خصم الفاتورة كلّها
--
--    كان العمود يجمع `discount_amount` — وهو خصم الفاتورة بكامله. ففاتورة
--    عليها خصم يدوي 200 ومرتبطة بعرضٍ خصمه 50 تُضيف 200 إلى حصيلة العرض،
--    فيبدو العرض أغلى مما هو، ويُبنى على ذلك قرار إيقافه.
-- ════════════════════════════════════════════════════════════════════════

create or replace view v_offers_totals as
select
  o.id as offer_id,
  o.organization_id,
  o.title,
  count(si.id) as applied_invoice_count,
  coalesce(sum(round(si.subtotal_amount * coalesce(si.offer_percent, 0) / 100.0, 2)), 0)
    as total_discount_amount
from offers o
left join sales_invoices si
       on si.applied_offer_id = o.id
      and si.invoice_type = 'sale'
      and si.status <> 'void'
      and coalesce(si.is_temporary, false) = false
group by o.id, o.organization_id, o.title;
alter view v_offers_totals set (security_invoker = on);

-- ════════════════════════════════════════════════════════════════════════
-- 4) طلب المختبر يبقى معروضًا حتى يُسلَّم
--
--    المنظور كان يُخفي الطلب فور اعتماد نتيجته (`status <> 'verified'`)، ومسار
--    المختبر بعدها ثلاث خطوات: اعتماد إداري، ثم تسليم. فكان الطلب يختفي من
--    الشاشة وهو ما يزال بانتظار التسليم، ولا سبيل إلى إتمامه.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_src text;
begin
  select pg_get_viewdef('v_lab_pending_orders'::regclass, true) into v_src;
  v_src := replace(v_src, chr(13), '');
  if position('''approved''::text, ''delivered''::text' in v_src) > 0 then
    return; -- مُصلَح سلفًا
  end if;
  if position('WHERE o.status <> ''verified''::text AND o.status <> ''cancelled''::text' in v_src) = 0 then
    raise exception 'تعذّر تصحيح v_lab_pending_orders: تغيّر نصّ المنظور';
  end if;
  v_src := replace(
    v_src,
    'WHERE o.status <> ''verified''::text AND o.status <> ''cancelled''::text',
    'WHERE o.status <> all (array[''approved''::text, ''delivered''::text, ''rejected''::text, ''cancelled''::text])'
  );
  execute 'create or replace view v_lab_pending_orders as ' || v_src;
  execute 'alter view v_lab_pending_orders set (security_invoker = on)';
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) سند الصرف الملغى ليس مدفوعًا
--
--    `app_recalc_dental_lab_order_paid` تجمع كل سندات الصرف المرتبطة بالطلبية
--    بلا استثناء الملغى، فإلغاء سندٍ لا يُنقص «المدفوع» — ويبقى المعمل مسدَّدًا
--    في الشاشة وهو غير مسدَّد. ويُعاد الحساب هنا لكل طلبية لها سند ملغى.
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_recalc_dental_lab_order_paid(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_order is null then
    return;
  end if;
  update dental_lab_orders
    set paid_amount = coalesce((
          select sum(v.amount) from financial_vouchers v
          where v.dental_lab_order_id = target_order
            and v.voucher_type = 'expense'
            and coalesce(v.is_void, false) = false
        ), 0),
        updated_at = now()
    where id = target_order;
end $$;

update dental_lab_orders o
   set paid_amount = coalesce((
         select sum(v.amount) from financial_vouchers v
         where v.dental_lab_order_id = o.id
           and v.voucher_type = 'expense'
           and coalesce(v.is_void, false) = false
       ), 0),
       updated_at = now()
 where exists (
   select 1 from financial_vouchers v
   where v.dental_lab_order_id = o.id and coalesce(v.is_void, false) = true
 );

-- ════════════════════════════════════════════════════════════════════════
-- 6) إجمالي دفعة المطالبات يُحسب في القاعدة لا في المتصفّح
--
--    كان المتصفّح يجمع البنود ويكتب المجموع في رأس الدفعة. أي فشل بين
--    الكتابتين يترك رأسًا لا يساوي بنوده — ورقم المطالبة بالشركة هو هذا الرأس.
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_recalc_claim_batch_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch uuid;
begin
  v_batch := coalesce(new.batch_id, old.batch_id);
  if v_batch is null then
    return coalesce(new, old);
  end if;
  update insurance_claim_batches
     set total_amount = coalesce((
           select sum(i.amount) from insurance_claim_batch_items i where i.batch_id = v_batch
         ), 0),
         updated_at = now()
   where id = v_batch;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_recalc_claim_batch_total on insurance_claim_batch_items;
create trigger trg_recalc_claim_batch_total
  after insert or update or delete on insurance_claim_batch_items
  for each row execute function app_recalc_claim_batch_total();

-- ════════════════════════════════════════════════════════════════════════
-- 7) أعمدة تُعلنها الواجهة ولا وجود لها
--
--    ثلاثة مواضع كانت الشاشة فيها تعرض خانة فارغة أبدًا لأن المنظور لا يحمل
--    العمود: عدد فحوص طلب الأشعة، واسم المريض في قائمة المؤشّرات، ودقائق
--    العمل الإضافي في حضور اليوم.
-- ════════════════════════════════════════════════════════════════════════

-- 7/أ — طلبات الأشعة غير الموثَّقة: العدّادات التي تعلنها الشاشة
--
-- الشاشة تعرض «عدد الفحوصات» و«موجودات عاجلة» و«كُتبت موجوداته»، ولا شيء من
-- ذلك في المنظور — فبقيت الخانات فارغة أبدًا. تُضاف الأعمدة إلى ما هو قائم بلا
-- إسقاط عمود (`create or replace` لا يقبل حذف عمود، وحذفه يكسر كل قارئ آخر).
create or replace view v_radiology_unreported_orders as
select
  o.id as radiology_order_id,
  o.organization_id,
  o.branch_id,
  o.patient_id,
  p.name_ar as patient_name,
  p.id_number as patient_id_number,
  o.ordering_doctor_id,
  d.name_ar as doctor_name,
  o.status,
  o.priority,
  o.clinical_indication,
  o.notes,
  o.ordered_at,
  o.scheduled_at,
  o.arrived_at,
  o.images_ready_at,
  count(distinct oi.id) as item_count,
  count(distinct oi.id) filter (where oi.performed_at is not null) as performed_count,
  count(ri.id) as image_count,
  count(distinct oi.id) as exams_count,
  count(distinct oi.id) filter (where coalesce(btrim(oi.findings), '') <> '') as findings_written_count,
  count(distinct oi.id) filter (where oi.is_urgent_finding) as urgent_findings_count,
  o.completed_at
from radiology_orders o
join patients p on p.id = o.patient_id
left join doctors d on d.id = o.ordering_doctor_id
left join radiology_order_items oi on oi.radiology_order_id = o.id
left join radiology_images ri on ri.radiology_order_item_id = oi.id
where o.status = any (array['draft','ordered','scheduled','arrived','in_progress','images_ready','reporting'])
group by o.id, p.name_ar, p.id_number, d.name_ar;
alter view v_radiology_unreported_orders set (security_invoker = on);

-- 7/ب — قائمة المؤشّرات الحيوية باسم المريض
--
-- الشاشة كانت تعرض «قياسات اليوم» بلا اسم مريض لأن المنظور لا يحمله. والعمودان
-- يُضافان في **آخر** القائمة: `create or replace view` لا يقبل إدراج عمود في
-- الوسط ولا تغيير اسم عمود قائم.
create or replace view v_patient_vitals as
select
  v.id,
  v.organization_id,
  v.patient_id,
  v.visit_id,
  v.recorded_at,
  v.blood_pressure_systolic,
  v.blood_pressure_diastolic,
  v.heart_rate,
  v.temperature_celsius,
  v.respiratory_rate,
  v.glucose_level,
  v.height_cm,
  v.weight_kg,
  v.bmi,
  v.created_by,
  r.id as request_id,
  r.request_kind,
  r.doctor_id,
  d.name_ar as doctor_name,
  case
    when r.id is not null then 'طلب'
    when v.visit_id is not null then 'زيارة'
    else 'مباشر'
  end as source_label,
  p.name_ar as patient_name,
  p.file_number
from patient_vital_signs v
join patients p on p.id = v.patient_id
left join vital_sign_requests r on r.vital_sign_id = v.id
left join doctors d on d.id = r.doctor_id;
alter view v_patient_vitals set (security_invoker = on);

-- 7/ج — حضور اليوم مع دقائق الإضافي واعتمادها
--
-- مُدخل العمل الإضافي كان لا بدّ أن يوضع في جدول الشهر لأن منظور اليوم لا
-- يحمل العمودين. تُضاف في آخر القائمة (لا يقبل الاستبدال إدراجًا في الوسط).
create or replace view v_today_attendance as
select
  e.organization_id,
  e.id as employee_id,
  e.name_ar as employee_name,
  ar.id as attendance_id,
  ar.check_in_at,
  ar.check_out_at,
  coalesce(ar.status, 'pending') as status,
  coalesce(ar.late_minutes, 0) as late_minutes,
  coalesce(ar.early_leave_minutes, 0) as early_leave_minutes,
  ar.note,
  coalesce(ar.overtime_minutes, 0) as overtime_minutes,
  ar.overtime_approved_by
from employees e
left join attendance_records ar on ar.employee_id = e.id and ar.work_date = current_date
where e.status = 'active';
alter view v_today_attendance set (security_invoker = on);

-- ════════════════════════════════════════════════════════════════════════
-- 8) سبب إنهاء العقد يُحفظ في عموده لا في الملاحظات
-- ════════════════════════════════════════════════════════════════════════

alter table employee_contracts add column if not exists termination_reason text;

-- ════════════════════════════════════════════════════════════════════════
-- 9) مُرشِّح العيادة في تقارير الاستقبال
--
--    أربعة تقارير في الشاشة تحمل مُرشِّح عيادة، وثلاثة منها لا تقبله فتُسقطه
--    الشاشة قبل الاستدعاء — فيبدو المُرشِّح عاملًا وهو ليس كذلك. والرابع
--    (تكرار عدم الحضور) لا يقبل الفرع ولا الطبيب أصلًا.
--
--    الإسقاط قبل الإنشاء لأن إضافة معامل تُنشئ حِملًا زائدًا (overload) لا
--    استبدالًا، فتصير الدالّة غامضة على الواجهة.
-- ════════════════════════════════════════════════════════════════════════

drop function if exists app_report_occupancy(uuid, date, date, uuid, uuid);
-- والنسخة الجديدة كذلك، وإلّا فشل التنفيذ الثاني بـ«الدالّة موجودة سلفًا».
drop function if exists app_report_occupancy(uuid, date, date, uuid, uuid, uuid);
create function app_report_occupancy(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
)
returns table (
  doctor_id uuid,
  doctor_name text,
  available_hours numeric,
  booked_hours numeric,
  utilization_pct numeric,
  idle_hours numeric
)
language sql
stable
security invoker
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
       and (p_clinic_id is null or h.clinic_id = p_clinic_id)
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
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
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

drop function if exists app_report_booking_sources(uuid, date, date, uuid, uuid);
drop function if exists app_report_booking_sources(uuid, date, date, uuid, uuid, uuid);
create function app_report_booking_sources(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
)
returns table (
  source_id uuid,
  source_name text,
  total bigint,
  completed bigint,
  no_show bigint,
  share_pct numeric
)
language sql
stable
security invoker
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
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
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

drop function if exists app_report_no_show(uuid, date, date, uuid, uuid);
drop function if exists app_report_no_show(uuid, date, date, uuid, uuid, uuid);
create function app_report_no_show(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
)
returns table (
  doctor_id uuid,
  doctor_name text,
  total bigint,
  no_show_count bigint,
  cancelled_count bigint,
  no_show_pct numeric,
  avg_invoice numeric,
  estimated_loss numeric
)
language sql
stable
security invoker
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
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
  ),
  avg_inv as (
    -- الخسارة المقدَّرة تُقاس بمتوسط فاتورة **محقَّقة**: الملغاة وعرض السعر
    -- كانا يدخلان المتوسط فيضخّمان الخسارة.
    select s.doctor_id, avg(s.net_amount) as avg_net
      from sales_invoices s
     where s.organization_id = p_organization_id
       and s.invoice_type = 'sale'
       and s.status <> 'void'
       and coalesce(s.is_temporary, false) = false
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

drop function if exists app_report_repeat_no_show(uuid, date, date, integer);
drop function if exists app_report_repeat_no_show(uuid, date, date, integer, uuid, uuid, uuid);
create function app_report_repeat_no_show(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_min_count integer default 2,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
)
returns table (
  patient_id uuid,
  patient_name text,
  file_number text,
  mobile_number text,
  no_show_count bigint,
  last_no_show timestamp with time zone
)
language sql
stable
security invoker
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
    and (p_branch_id is null or a.branch_id = p_branch_id)
    and (p_doctor_id is null or a.doctor_id = p_doctor_id)
    and (p_clinic_id is null or a.clinic_id = p_clinic_id)
  group by p.id, p.name_ar, p.file_number, p.mobile_number
  having count(*) >= greatest(p_min_count, 1)
  order by 5 desc;
$$;

grant execute on function app_report_occupancy(uuid, date, date, uuid, uuid, uuid) to authenticated;
grant execute on function app_report_booking_sources(uuid, date, date, uuid, uuid, uuid) to authenticated;
grant execute on function app_report_no_show(uuid, date, date, uuid, uuid, uuid) to authenticated;
grant execute on function app_report_repeat_no_show(uuid, date, date, integer, uuid, uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- الفحص الذاتي
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_int int;
begin
  if pg_get_viewdef('v_patient_balance'::regclass, true) not like '%is_temporary%' then
    raise exception 'v_patient_balance ما زال يحتسب عروض الأسعار ذممًا';
  end if;
  if pg_get_viewdef('v_invoice_register'::regclass, true) not like '%is_temporary, false) = false AS is_overdue%'
     and pg_get_viewdef('v_invoice_register'::regclass, true) not like '%is_temporary%' then
    raise exception 'v_invoice_register ما زال يعدّ عرض السعر متأخّرًا';
  end if;
  if pg_get_viewdef('v_offers_totals'::regclass, true) not like '%offer_percent%' then
    raise exception 'v_offers_totals ما زال يجمع خصم الفاتورة كلّه';
  end if;
  if pg_get_viewdef('v_lab_pending_orders'::regclass, true) not like '%delivered%' then
    raise exception 'v_lab_pending_orders ما زال يُخفي الطلب قبل تسليمه';
  end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'v_radiology_unreported_orders' and column_name = 'exams_count';
  if v_int = 0 then raise exception 'v_radiology_unreported_orders بلا عدد الفحوص'; end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'v_patient_vitals' and column_name = 'patient_name';
  if v_int = 0 then raise exception 'v_patient_vitals بلا اسم المريض'; end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'v_today_attendance' and column_name = 'overtime_minutes';
  if v_int = 0 then raise exception 'v_today_attendance بلا دقائق الإضافي'; end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'employee_contracts' and column_name = 'termination_reason';
  if v_int = 0 then raise exception 'employee_contracts بلا عمود سبب الإنهاء'; end if;

  select count(*) into v_int from pg_proc
   where proname = 'app_report_occupancy' and pronargs = 6;
  if v_int = 0 then raise exception 'تقرير الإشغال لا يقبل مُرشِّح العيادة'; end if;

  if not exists (
    select 1 from pg_trigger where tgrelid = 'insurance_claim_batch_items'::regclass
      and tgname = 'trg_recalc_claim_batch_total'
  ) then
    raise exception 'تعذّر تثبيت محفِّز إجمالي دفعة المطالبات';
  end if;
end $$;

commit;
