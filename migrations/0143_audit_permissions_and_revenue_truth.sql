-- ============================================================================
-- 0143 — تصحيحات مراجعة شاملة: مفردة صلاحيات واحدة، وأرقام إيراد صادقة،
--        ودورة مناقلة مخزنية قابلة للبدء، وإجراء أسنان يُفوتَر فعلًا.
--
-- كل بند هنا خطأ مُثبَت بالفحص لا تحسينًا مقترحًا. الترتيب من الأخطر ماليًّا.
--
-- ملاحظة على الأسلوب: كل الأقسام تعتمد `create or replace` و`on conflict`
-- فالملفّ يُنفَّذ مرّتين بلا أثر مختلف، وكل قسم ينتهي بفحص ذاتي يرفع خطأً
-- عربيًّا إن لم يتحقّق ما بُني له.
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1) مفردة صلاحيات واحدة: صلاحيات «فتح الشاشة» تدخل كتالوج الصلاحيات
--
--    المشكلة المُثبَتة: الواجهة تحكم ظهور الشاشات بمفاتيح على هيئة
--    `<الميزة>.view` (38 مفتاحًا في سجل الموديولات)، وكتالوج القاعدة يستعمل
--    مفاتيح نطاقات مختلفة (`lab.view` مقابل `laboratory.view`، `gl.view`
--    مقابل `accounting.view`...). التقاطع 16 فقط. ونافذة الصلاحيات في شاشة
--    المستخدمين تعرض مفاتيح الواجهة وتكتبها عبر `app_set_member_permission`،
--    وهي ترفض أي مفتاح ليس في الكتالوج:
--        raise exception 'صلاحية غير معروفة: %'
--    فالنتيجة أن 22 من 38 صلاحية في تلك النافذة زرٌّ يفشل دائمًا، وأن عمود
--    «الوضع الفعلي ومصدره» يقول «غير ممنوحة» عن شاشات يراها العضو فعلًا.
--
--    العلاج: مفتاح `<الميزة>.view` لكل ميزة في الكتالوج، في نطاق `screens`
--    ليبقى مفصولًا بصريًّا عن صلاحيات التنفيذ، مع افتراضات الأدوار مطابقة
--    لخريطة الأدوار في الواجهة حرفًا بحرف — فلا يبقى تعريفان لما يراه الدور.
-- ════════════════════════════════════════════════════════════════════════

insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
select
  f.feature_key || '.view',
  'فتح شاشة: ' || f.name_ar,
  'screens',
  'رؤية شاشات «' || f.name_ar || '» في القائمة وفتحها. لا تمنح هذه الصلاحية حقّ التعديل؛ كل عملية لها صلاحيتها الخاصة.',
  9000 + f.display_order
from feature_catalog f
on conflict (permission_key) do nothing;

-- افتراضات الأدوار — منقولة من `client/lib/organization-access.ts`. أي تعديل
-- هناك يجب أن يُقابله تعديل هنا، وإلّا اختلف ما يراه العضو عمّا يقوله النظام
-- إنه يراه.
with role_screens(role_key, feature_key) as (
  values
    -- مدير الفرع: كل الشاشات
    ('branch_manager', '*'),
    -- الطبيب
    ('doctor', 'core_dashboard'), ('doctor', 'appointments'), ('doctor', 'patients'),
    ('doctor', 'medical_records'), ('doctor', 'patient_journey'), ('doctor', 'medical_services'),
    ('doctor', 'doctors'), ('doctor', 'prescriptions'), ('doctor', 'documents'),
    ('doctor', 'notifications'), ('doctor', 'doctor_workspace'), ('doctor', 'quality'),
    -- التمريض
    ('nurse', 'core_dashboard'), ('nurse', 'reception'), ('nurse', 'appointments'),
    ('nurse', 'patients'), ('nurse', 'medical_records'), ('nurse', 'patient_journey'),
    ('nurse', 'nursing'), ('nurse', 'assets'), ('nurse', 'documents'),
    ('nurse', 'notifications'), ('nurse', 'doctor_workspace'), ('nurse', 'quality'),
    -- الاستقبال
    ('receptionist', 'core_dashboard'), ('receptionist', 'reception'), ('receptionist', 'appointments'),
    ('receptionist', 'patients'), ('receptionist', 'patient_journey'), ('receptionist', 'billing_payments'),
    ('receptionist', 'documents'), ('receptionist', 'notifications'), ('receptionist', 'patient_portal'),
    -- فنّي المختبر
    ('lab_technician', 'core_dashboard'), ('lab_technician', 'patients'), ('lab_technician', 'laboratory'),
    ('lab_technician', 'assets'), ('lab_technician', 'notifications'),
    -- فنّي الأشعة
    ('radiology_technician', 'core_dashboard'), ('radiology_technician', 'patients'),
    ('radiology_technician', 'radiology'), ('radiology_technician', 'assets'),
    ('radiology_technician', 'notifications'),
    -- الصيدلي
    ('pharmacist', 'core_dashboard'), ('pharmacist', 'patients'), ('pharmacist', 'pharmacy'),
    ('pharmacist', 'prescriptions'), ('pharmacist', 'dispensing'), ('pharmacist', 'notifications'),
    -- المحاسب
    ('accountant', 'core_dashboard'), ('accountant', 'billing_payments'), ('accountant', 'insurance_claims'),
    ('accountant', 'accounting'), ('accountant', 'reports'), ('accountant', 'assets'),
    ('accountant', 'documents'), ('accountant', 'notifications'), ('accountant', 'integrations'),
    -- مدير الموارد البشرية
    ('hr_manager', 'core_dashboard'), ('hr_manager', 'hr'), ('hr_manager', 'reports'),
    ('hr_manager', 'documents'), ('hr_manager', 'notifications'),
    -- موظف
    ('employee', 'core_dashboard'), ('employee', 'notifications'),
    -- الصفات الإدارية تتخطّى الفحص أصلًا، وتُدرَج لتصدُق شاشة «الوضع الفعلي»
    ('owner', '*'), ('organization_admin', '*')
)
insert into role_default_permissions (role_key, permission_key)
select rs.role_key, f.feature_key || '.view'
from role_screens rs
join feature_catalog f on rs.feature_key = '*' or f.feature_key = rs.feature_key
on conflict (role_key, permission_key) do nothing;

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from feature_catalog f
  where not exists (
    select 1 from permission_catalog p where p.permission_key = f.feature_key || '.view'
  );
  if v_missing > 0 then
    raise exception 'تعذّر إدراج صلاحيات فتح الشاشات: بقيت % ميزة بلا مفتاح', v_missing;
  end if;

  if not exists (
    select 1 from role_default_permissions
     where role_key = 'receptionist' and permission_key = 'reception.view'
  ) then
    raise exception 'تعذّر إدراج افتراضات الأدوار لصلاحيات الشاشات';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) الإيراد: الفاتورة الملغاة وعرض السعر ليسا إيرادًا
--
--    المشكلة المُثبَتة: `v_daily_revenue` — وهو المصدر الذي يُرسم منه منحنى
--    الإيراد — يستثني صراحةً `status <> 'void'` و`is_temporary = false`. أما
--    ثمانية مصادر أخرى تُقرأ في نفس الشاشات فلا تستثني شيئًا، فتُحتسب
--    الفاتورة التي أُلغيت بعد إصدارها، وعرض السعر الذي لم يصر فاتورة، إيرادًا
--    محقّقًا. النتيجة أن البطاقات أعلى شاشة التقارير تخالف الرسم أسفلها في
--    نفس الشاشة ونفس الفترة، وأن الإقرار الضريبي يُبنى على ضريبة لم تُستحقّ.
-- ════════════════════════════════════════════════════════════════════════

-- 2/أ — مؤشّرات الفواتير (البطاقات الأربع أعلى شاشة التقارير)
create or replace function app_invoice_kpis(
  p_organization_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  gross_amount numeric,
  discount_amount numeric,
  discount_rate_percent numeric,
  net_amount numeric,
  paid_amount numeric,
  collection_rate_percent numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- الدالّة بصلاحيات المالك (كما كانت) فتتجاوز عزل الصفوف، ولم يكن فيها فحص
  -- عضوية: أي مستخدم مسجَّل يقرأ مؤشّرات أي منشأة بتمرير معرّفها. الفحص هنا
  -- يعيد العزل الذي تتجاوزه.
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;

  return query
  select
    coalesce(sum(si.subtotal_amount), 0),
    coalesce(sum(si.discount_amount), 0),
    case when coalesce(sum(si.subtotal_amount), 0) = 0 then 0
      else round((sum(si.discount_amount) / sum(si.subtotal_amount)) * 100, 2)
    end,
    coalesce(sum(si.net_amount), 0),
    coalesce(sum(si.paid_amount), 0),
    case when coalesce(sum(si.net_amount), 0) = 0 then 0
      else round((sum(si.paid_amount) / sum(si.net_amount)) * 100, 2)
    end
  from sales_invoices si
  where si.organization_id = p_organization_id
    and si.invoice_type = 'sale'
    and si.status <> 'void'
    and coalesce(si.is_temporary, false) = false
    and si.created_at::date between p_date_from and p_date_to;
end $$;

-- 2/ب — كشف ضريبة القيمة المضافة
create or replace view v_vat_statement_sales_invoices as
select
  organization_id,
  created_at::date as invoice_date,
  id as invoice_id,
  invoice_number,
  subtotal_amount,
  vat_amount,
  net_amount
from sales_invoices
where invoice_type = 'sale'
  and status <> 'void'
  and coalesce(is_temporary, false) = false
  and vat_amount > 0;
alter view v_vat_statement_sales_invoices set (security_invoker = on);

-- 2/ج — الربحية التقديرية
create or replace view v_invoice_profitability as
select
  si.id as invoice_id,
  si.organization_id,
  si.created_at,
  si.net_amount as gross_revenue,
  coalesce(sum(i.cost_price * sii.qty), 0) as estimated_cost,
  si.net_amount - coalesce(sum(i.cost_price * sii.qty), 0) as estimated_profit
from sales_invoices si
join sales_invoice_items sii on sii.invoice_id = si.id
left join items i on i.id = sii.item_id
where si.invoice_type = 'sale'
  and si.status <> 'void'
  and coalesce(si.is_temporary, false) = false
group by si.id, si.organization_id, si.created_at, si.net_amount;
alter view v_invoice_profitability set (security_invoker = on);

-- 2/د — الإيراد حسب مصدر المريض
create or replace view v_daily_revenue_by_source as
select
  si.organization_id,
  si.created_at::date as revenue_date,
  si.source_value_id,
  lv.name_ar as source_name_ar,
  sum(si.net_amount) as net_amount,
  count(*) as invoice_count
from sales_invoices si
left join lookup_values lv on lv.id = si.source_value_id
where si.invoice_type = 'sale'
  and si.status <> 'void'
  and coalesce(si.is_temporary, false) = false
group by si.organization_id, si.created_at::date, si.source_value_id, lv.name_ar;
alter view v_daily_revenue_by_source set (security_invoker = on);

-- 2/هـ — إجماليات العروض. الشرط في `on` لأن الوصل خارجي: العرض الذي لم
-- يُستعمل بعد يجب أن يبقى في القائمة بصفر.
create or replace view v_offers_totals as
select
  o.id as offer_id,
  o.organization_id,
  o.title,
  count(si.id) as applied_invoice_count,
  coalesce(sum(si.discount_amount), 0) as total_discount_amount
from offers o
left join sales_invoices si
       on si.applied_offer_id = o.id
      and si.invoice_type = 'sale'
      and si.status <> 'void'
      and coalesce(si.is_temporary, false) = false
group by o.id, o.organization_id, o.title;
alter view v_offers_totals set (security_invoker = on);

-- 2/و — الأصناف الأكثر مبيعًا.
--
-- الخلل هنا أدقّ من البقية: الشرط كان `left join sales_invoices si on … and
-- si.invoice_type = 'sale'`، والمجاميع تقرأ من `sales_invoice_items` لا من
-- `sales_invoices`. فالشرط لا يُسقط سطرًا واحدًا — يجعل `si` فارغًا فقط —
-- والمجاميع تبقى كما هي. أي أن بنود المرتجعات والفواتير الملغاة والعروض
-- المؤقّتة كانت تُحتسب كلّها مبيعات. العلاج بشرط وجود على البنود نفسها، مع
-- إبقاء الوصل الخارجي حتى يبقى الصنف الذي لم يُبَع بعد ظاهرًا بصفر.
create or replace view v_sales_by_item as
select
  i.id as item_id,
  i.organization_id,
  i.name_ar as item_name,
  i.item_type,
  coalesce(sum(sii.qty), 0) as qty_sold,
  coalesce(sum(sii.price * sii.qty), 0) as gross_revenue,
  coalesce(sum(sii.net_amount), 0) as net_revenue
from items i
left join sales_invoice_items sii
       on sii.item_id = i.id
      and exists (
            select 1 from sales_invoices si
             where si.id = sii.invoice_id
               and si.invoice_type = 'sale'
               and si.status <> 'void'
               and coalesce(si.is_temporary, false) = false
          )
group by i.id, i.organization_id, i.name_ar, i.item_type;
alter view v_sales_by_item set (security_invoker = on);

-- 2/ز — الإيراد حسب الطبيب وحسب العيادة
create or replace view v_revenue_by_doctor as
select
  d.id as doctor_id,
  d.organization_id,
  d.name_ar as doctor_name,
  coalesce(inv.invoice_count, 0) as invoice_count,
  coalesce(inv.net_amount, 0) as net_amount,
  coalesce(inv.cash_amount, 0) as cash_amount,
  coalesce(inv.insurance_amount, 0) as insurance_amount,
  coalesce(appt.appointment_count, 0) as appointment_count
from doctors d
left join (
  select
    doctor_id,
    count(*) as invoice_count,
    sum(net_amount) as net_amount,
    sum(net_amount) filter (where not is_insurance_invoice) as cash_amount,
    sum(net_amount) filter (where is_insurance_invoice) as insurance_amount
  from sales_invoices
  where invoice_type = 'sale'
    and status <> 'void'
    and coalesce(is_temporary, false) = false
  group by doctor_id
) inv on inv.doctor_id = d.id
left join (
  select doctor_id, count(*) as appointment_count
  from appointments
  group by doctor_id
) appt on appt.doctor_id = d.id;
alter view v_revenue_by_doctor set (security_invoker = on);

create or replace view v_revenue_by_clinic as
select
  c.id as clinic_id,
  c.organization_id,
  c.name as clinic_name,
  coalesce(inv.invoice_count, 0) as invoice_count,
  coalesce(inv.net_amount, 0) as net_amount,
  coalesce(appt.appointment_count, 0) as appointment_count
from clinics c
left join (
  select clinic_id, count(*) as invoice_count, sum(net_amount) as net_amount
  from sales_invoices
  where invoice_type = 'sale'
    and status <> 'void'
    and coalesce(is_temporary, false) = false
  group by clinic_id
) inv on inv.clinic_id = c.id
left join (
  select clinic_id, count(*) as appointment_count
  from appointments
  group by clinic_id
) appt on appt.clinic_id = c.id;
alter view v_revenue_by_clinic set (security_invoker = on);

-- 2/ح — الإيراد حسب الطبيب/العيادة **لفترة**.
--
-- المنظورَان أعلاه لا يحملان تاريخًا، فجدولا «الإيراد حسب الطبيب» و«حسب
-- العيادة» في شاشة التقارير كانا يعرضان إيراد كل التاريخ تحت مرشّح فترة:
-- يغيّر المستخدم «من/إلى» فيتحرّك الرسم ولا يتحرّك الجدولان. وتغيير شكل
-- المنظورَين يكسر كل قارئ لهما، فالمخرج دالّتان تقبلان المدى.
-- الإسقاط قبل الإنشاء: تغيير أعمدة `returns table` لا يقبله `create or
-- replace`، فبدونه لا يمكن تصحيح شكل الدالّة في ترحيل لاحق.
drop function if exists app_revenue_by_doctor(uuid, date, date);
drop function if exists app_revenue_by_clinic(uuid, date, date);

create function app_revenue_by_doctor(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns table (
  doctor_id uuid,
  doctor_name text,
  invoice_count bigint,
  net_amount numeric,
  cash_amount numeric,
  insurance_amount numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    d.id,
    d.name_ar,
    count(si.id) as invoice_count,
    coalesce(sum(si.net_amount), 0) as net_amount,
    coalesce(sum(si.net_amount) filter (where not si.is_insurance_invoice), 0) as cash_amount,
    coalesce(sum(si.net_amount) filter (where si.is_insurance_invoice), 0) as insurance_amount
  from doctors d
  left join sales_invoices si
         on si.doctor_id = d.id
        and si.invoice_type = 'sale'
        and si.status <> 'void'
        and coalesce(si.is_temporary, false) = false
        and si.created_at::date between p_from and p_to
  where d.organization_id = p_organization_id
  group by d.id, d.name_ar
  having count(si.id) > 0
  order by coalesce(sum(si.net_amount), 0) desc;
$$;

create function app_revenue_by_clinic(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns table (
  clinic_id uuid,
  clinic_name text,
  invoice_count bigint,
  net_amount numeric,
  appointment_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- عدّ المواعيد داخل نفس المدى كذلك: كان الجدول يعرض مواعيد كل التاريخ إلى
  -- جانب إيراد فترة، فيُقرأ منهما «متوسّط قيمة الموعد» وهو قسمة على مقام من
  -- زمن آخر.
  select
    c.id,
    c.name,
    coalesce(inv.invoice_count, 0),
    coalesce(inv.net_amount, 0),
    coalesce(appt.appointment_count, 0)
  from clinics c
  left join (
    select si.clinic_id, count(*) as invoice_count, sum(si.net_amount) as net_amount
    from sales_invoices si
    where si.organization_id = p_organization_id
      and si.invoice_type = 'sale'
      and si.status <> 'void'
      and coalesce(si.is_temporary, false) = false
      and si.created_at::date between p_from and p_to
    group by si.clinic_id
  ) inv on inv.clinic_id = c.id
  left join (
    select a.clinic_id, count(*) as appointment_count
    from appointments a
    where a.organization_id = p_organization_id
      and a.scheduled_start::date between p_from and p_to
    group by a.clinic_id
  ) appt on appt.clinic_id = c.id
  where c.organization_id = p_organization_id
    and (inv.invoice_count is not null or appt.appointment_count is not null)
  order by coalesce(inv.net_amount, 0) desc;
$$;

grant execute on function app_revenue_by_doctor(uuid, date, date) to authenticated;
grant execute on function app_revenue_by_clinic(uuid, date, date) to authenticated;

do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'app_invoice_kpis';
  if v_src not like '%status <> ''void''%' then
    raise exception 'مؤشّرات الفواتير ما زالت تحتسب الفواتير الملغاة';
  end if;

  foreach v_src in array array[
    'v_vat_statement_sales_invoices','v_invoice_profitability','v_daily_revenue_by_source',
    'v_offers_totals','v_sales_by_item','v_revenue_by_doctor','v_revenue_by_clinic'
  ] loop
    if pg_get_viewdef(v_src::regclass, true) not like '%void%' then
      raise exception 'المنظور % ما زال يحتسب الفواتير الملغاة', v_src;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) «خدمات نُفِّذت ولم تُفوتَر» تعرض ما لم يُنفَّذ بعد
--
--    المنظور كان يشمل `draft` و`ordered` — أي مسوّدة أُدخلت في الزيارة وطلبًا
--    أُرسل ولم يُنجَز — تحت عنوان «عملٌ أُنجز ولم يُحاسَب عليه»، ويجمع قيمتها
--    في بطاقة إجمالي التسرّب. فيُطارَد المريض بفاتورة خدمة لم تُقدَّم له.
-- ════════════════════════════════════════════════════════════════════════

create or replace view v_unbilled_performed_services as
select
  s.id,
  s.organization_id,
  s.visit_id,
  v.patient_id,
  p.name_ar as patient_name,
  p.file_number,
  s.item_id,
  i.name_ar as item_name,
  i.medical_service_type,
  s.qty,
  s.unit_price,
  s.qty * coalesce(s.unit_price, 0) as line_total,
  v.doctor_id,
  d.name_ar as doctor_name,
  v.clinic_id,
  v.visit_date,
  current_date - v.visit_date::date as days_since_visit,
  s.status
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
left join doctors d on d.id = v.doctor_id
where s.status = 'performed';
alter view v_unbilled_performed_services set (security_invoker = on);

-- ════════════════════════════════════════════════════════════════════════
-- 4) المناقلة المخزنية: قيمة افتراضية لا يقبلها قيدها
--
--    `0098` شدّد قيد الحالة إلى
--      draft, requested, approved, rejected, shipped, received, cancelled
--    ولم يُصحّح القيمة الافتراضية للعمود، فبقيت `'pending'`. فأي إدراج لا
--    يذكر الحالة صراحةً يُرفض بالقيد — ولذلك جدول المناقلات فارغ تمامًا: لا
--    يمكن إنشاء طلب مناقلة واحد من الشاشة.
-- ════════════════════════════════════════════════════════════════════════

alter table stock_transfers alter column status set default 'draft';

do $$
begin
  if (
    select column_default from information_schema.columns
     where table_name = 'stock_transfers' and column_name = 'status'
  ) not like '%draft%' then
    raise exception 'تعذّر تصحيح القيمة الافتراضية لحالة المناقلة';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) إجراء الأسنان يُعلَّم «نُفِّذ» ولا يُفوتَر أبدًا
--
--    الدالّة تُنشئ بند الخدمة بشرط `v_visit is not null`، والزيارة تأتي من
--    `p_visit_id` أو من زيارة الإجراء. ولوحة المخطّط تُخطّط الإجراء بلا زيارة
--    (`p_visit_id => null`) وتُتمّه بلا زيارة كذلك، فيُستكمَل الإجراء ويُغيَّر
--    حال السنّ ولا يُنشأ بند فوترة قطعًا — وأحد أغلى أعمال عيادة الأسنان
--    يخرج من الفاتورة بصمت.
--
--    العلاج داخل الدالّة لا في الشاشة، فيسري على كل من يستدعيها: إن لم تُمرَّر
--    زيارة تُختار زيارة المريض المفتوحة، وإن لم توجد وكانت الفوترة مطلوبة
--    يُرفع خطأ صريح بدل الصمت. والطبيب يُستكمَل من الزيارة كذلك، لأن
--    `performed_by` في بند الخدمة يشير إلى الأطباء لا إلى حسابات المستخدمين.
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_complete_tooth_procedure(
  p_procedure_id uuid,
  p_note text default null,
  p_visit_id uuid default null,
  p_bill boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proc   tooth_procedures%rowtype;
  v_after  text;
  v_visit  uuid;
  v_doctor uuid;
  v_vs     uuid;
  v_price  numeric;
begin
  select * into v_proc from tooth_procedures where id = p_procedure_id;
  if v_proc.id is null then
    raise exception 'الإجراء غير موجود';
  end if;
  if not app_is_member(v_proc.organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(v_proc.organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if v_proc.status = 'completed' then
    raise exception 'الإجراء منفَّذ سلفًا';
  end if;
  if v_proc.status = 'cancelled' then
    raise exception 'الإجراء ملغى — لا يُنفَّذ';
  end if;

  v_visit := coalesce(p_visit_id, v_proc.visit_id);

  -- الزيارة المفتوحة للمريض: ما لم تُغلق ولم تُلغَ، والأحدث أوّلًا. هذا هو
  -- ما يفعله موظّف الاستقبال ذهنيًّا حين يقول «سجّلها على زيارة اليوم».
  if v_visit is null then
    select pv.id
      into v_visit
      from patient_visits pv
     where pv.organization_id = v_proc.organization_id
       and pv.patient_id = v_proc.patient_id
       -- الحالات التي ما زالت تقبل إضافة خدمة. الزيارة الموقَّعة أو المغلقة
       -- لا تُعدَّل، وحرّاس القاعدة يرفضون الكتابة فيها أصلًا.
       and pv.status in ('planned', 'waiting', 'in_progress')
     order by pv.visit_date desc, pv.created_at desc
     limit 1;
  end if;

  if p_bill and v_proc.item_id is not null and v_visit is null then
    raise exception 'لا توجد زيارة مفتوحة لهذا المريض، فلا يمكن فوترة الإجراء. افتح زيارة من الاستقبال أو من السجل الطبي ثم أعِد المحاولة.';
  end if;

  -- الطبيب: من الإجراء إن سُجّل، وإلّا من الزيارة التي سيُفوتَر عليها.
  v_doctor := v_proc.doctor_id;
  if v_doctor is null and v_visit is not null then
    select pv.doctor_id into v_doctor from patient_visits pv where pv.id = v_visit;
  end if;

  -- بند الخدمة في الزيارة: الجسر بين ما جرى سريريًّا وما يُفوتَر.
  if p_bill and v_proc.item_id is not null and v_visit is not null
     and v_proc.visit_service_id is null then
    select price into v_price from items where id = v_proc.item_id;
    insert into patient_visit_services (organization_id, visit_id, item_id,
                                        qty, unit_price, note, performed_by, created_by)
    values (v_proc.organization_id, v_visit, v_proc.item_id, 1,
            coalesce(v_price, 0),
            'سنّ ' || v_proc.tooth_number,
            -- `performed_by` في هذا الجدول يشير إلى `doctors` لا إلى
            -- `auth.users`: مَن نفّذ الخدمة طبيبٌ لا حسابُ مستخدم.
            v_doctor, auth.uid())
    returning id into v_vs;
  end if;

  update tooth_procedures
     set status           = 'completed',
         performed_at     = now(),
         performed_by     = auth.uid(),
         doctor_id        = coalesce(doctor_id, v_doctor),
         visit_id         = v_visit,
         visit_service_id = coalesce(v_vs, visit_service_id),
         note             = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note),
         updated_at       = now()
   where id = p_procedure_id;

  -- حال السنّ بعد الإجراء — من الخريطة الواحدة، وفقط حين يكون للإجراء أثر.
  v_after := app_tooth_condition_after(v_proc.procedure_kind);
  if v_after is not null then
    perform app_set_tooth_condition(v_proc.organization_id, v_proc.patient_id,
                                    v_proc.tooth_number, v_after,
                                    v_proc.tooth_type, v_proc.surfaces, null);
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_proc.organization_id, auth.uid(), 'medical_records', 'update',
          v_proc.patient_id, 'إتمام إجراء على السنّ ' || v_proc.tooth_number,
          v_proc.procedure_kind);

  return p_procedure_id;
end $$;

revoke execute on function app_complete_tooth_procedure(uuid, text, uuid, boolean) from public, anon;
grant execute on function app_complete_tooth_procedure(uuid, text, uuid, boolean) to authenticated;

do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'app_complete_tooth_procedure';
  if v_src not like '%لا توجد زيارة مفتوحة%' then
    raise exception 'تعذّر تحديث دالّة إتمام إجراء السنّ';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 6) الحضور: المناوبة المُسندة لا تُقاس عليها بداية الدوام
--
--    `app_calc_attendance_status` تحسب التأخير من `shift_template_id` في صفّ
--    الحضور — وشاشة الحضور لا تكتب هذا العمود قطعًا. فالنتيجة أن موظفًا مناوبته
--    الثامنة صباحًا يسجّل حضوره الحادية عشرة فيُحسب «حاضر» وتأخيره صفر، ولا
--    يُخصم عليه شيء في الراتب. أي أن سماحية التأخير المضبوطة في قالب المناوبة
--    لا أثر لها في النظام كلّه.
--
--    العلاج في القاعدة لا في الشاشة: محفِّز يُكمل المناوبة من إسناد الموظّف
--    لهذا اليوم قبل أن تعمل دالّة الحساب — فيسري على كل من يكتب حضورًا، وعلى
--    ما يُستورد من أجهزة البصمة لاحقًا. الاسم يبدأ بـ`trg_a` ليعمل قبل
--    `trg_calc_attendance_status` (المحفِّزات المتساوية في التوقيت تعمل بترتيب
--    أسمائها أبجديًّا).
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_fill_attendance_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.shift_template_id is null then
    select a.shift_template_id
      into new.shift_template_id
      from employee_shift_assignments a
     where a.employee_id = new.employee_id
       and a.organization_id = new.organization_id
       and (a.effective_from is null or a.effective_from <= new.work_date)
       and (a.effective_to is null or a.effective_to >= new.work_date)
       -- 0=الأحد … 6=السبت، نفس ترقيم extract(dow) المستعمل في 0019
       and extract(dow from new.work_date)::smallint = any (a.weekdays)
     order by a.effective_from desc nulls last, a.created_at desc
     limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_aa_fill_attendance_shift on attendance_records;
create trigger trg_aa_fill_attendance_shift
  before insert or update on attendance_records
  for each row execute function app_fill_attendance_shift();

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'attendance_records'::regclass
       and tgname = 'trg_aa_fill_attendance_shift'
  ) then
    raise exception 'تعذّر تثبيت محفِّز إكمال مناوبة الحضور';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 7) الأشعة: ختم «نُفِّذ» على الفحص يتخطّى حرّاس الطلب
--
--    `app_set_radiology_order_status` تحمل ثلاثة حرّاس عند بدء التنفيذ: صلاحية
--    `rad.perform`، وتسلسل الحالات، و**نفي الحمل** قبل أي فحص مُشعِّع لمريضة.
--    لكن شاشة الأشعة تختم `performed_at` على بند الفحص بتحديث مباشر، ومحفِّز
--    `app_radiology_order_auto_complete` يرفع الطلب إلى «الصور جاهزة» من نفسه —
--    فالطريق كلّه يمرّ بلا أيٍّ من الحرّاس الثلاثة. أي أن فحصًا مُشعِّعًا يمكن أن
--    يُسجَّل منفَّذًا لمريضة لم يُسجَّل نفي حملها، وبيد من لا يملك صلاحية التنفيذ.
--
--    الحارس هنا على البند نفسه، فيسري على الشاشة وعلى أي مسار آخر. ويُتجاوز
--    حين لا يوجد مستخدم (تنفيذ الترحيلات أو خدمة خلفية بمفتاح الخدمة) لأن
--    فحص الصلاحية بلا مستخدم لا معنى له وكان سيُعطّل الترحيلات نفسها.
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_guard_radiology_item_performed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order  radiology_orders%rowtype;
  v_needs  boolean;
  v_gender text;
begin
  -- لا يعنينا إلّا لحظة الختم: من «غير منفَّذ» إلى «منفَّذ».
  if new.performed_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.performed_at is not null then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select * into v_order from radiology_orders where id = new.radiology_order_id;
  if v_order.id is null then
    return new;
  end if;

  if not app_is_member(v_order.organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(v_order.organization_id, 'rad.perform') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ التصوير (rad.perform)';
  end if;

  select bool_or(e.pregnancy_check_required)
    into v_needs
    from radiology_order_items i
    join radiology_exams e on e.id = i.radiology_exam_id
   where i.radiology_order_id = v_order.id;

  if coalesce(v_needs, false) then
    select gender into v_gender from patients where id = v_order.patient_id;
    if v_gender = 'female' and v_order.pregnancy_confirmed_not is not true then
      raise exception 'هذا الفحص يُشعّع — سجّل نفي الحمل قبل تسجيل التنفيذ';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_radiology_item_performed on radiology_order_items;
create trigger trg_guard_radiology_item_performed
  before insert or update on radiology_order_items
  for each row execute function app_guard_radiology_item_performed();

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'radiology_order_items'::regclass
       and tgname = 'trg_guard_radiology_item_performed'
  ) then
    raise exception 'تعذّر تثبيت حارس تنفيذ فحص الأشعة';
  end if;
end $$;

commit;
