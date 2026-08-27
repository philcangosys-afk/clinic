-- ============================================================================
-- 0010_reports.sql
-- المرحلة 2 (الأخيرة في خارطة الطريق الأصلية) — مركز التقارير والإحصائيات
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0009 مباشرة (يعتمد عليها جميعًا)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- فلسفة هذا الملف: كل التقارير أدناه مبنية كـ Views (وليس جداول مخزَّنة) لأنها
-- تُحسب من بيانات موجودة أصلًا في 0001-0009 — هذا يضمن أن التقرير **لا يفقد
-- التزامن أبدًا** مع أحدث حركة مالية/طبية، بنفس فلسفة dental_lab_balances
-- و expiring_alerts في الملفات السابقة. الـ Views تُبنى فوق جداول محمية أصلًا
-- بـ RLS (security invoker افتراضيًا في Postgres) فلا حاجة لأي سياسة RLS إضافية
-- عليها؛ المستخدم يرى فقط صفوف مؤسسته تلقائيًا تمامًا كما لو استعلم الجداول مباشرة.
--
-- يغطي هذا الملف:
--   1) إصلاح فجوة إسناد: ربط الفاتورة بالعرض الفعلي المُطبَّق عليها (كانت النسبة
--      فقط محفوظة بلا معرفة أي عرض بالتحديد — يمنع تقرير "إجماليات العروض")
--   2) تقارير الإيراد (يومي/حسب المصدر/حسب العيادة/حسب الطبيب/نقدي مقابل تأمين)
--   3) إحصائية المبيعات حسب الخدمات والمصادر
--   4) إجماليات العروض والأطباء
--   5) إحصائية الفواتير المؤقتة والاتفاقيات
--   6) الربحية الحقيقية لكل فاتورة (تقدير تكلفة مبسّط)
--   7) كشوف ضريبة القيمة المضافة (فواتير + سندات قبض)
--   8) كشف المرتجعات
--   9) مؤشرات الأداء الحيّة (نسبة الخصم % / نسبة التحصيل %) كدالة بمدى تاريخ
--  10) إعدادات ورق الطباعة (A4 مقابل رول حراري 80mm) — فجوة موثّقة من لقطة 82
--      لم تُبنَ في أي ملف سابق
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ربط الفاتورة بالعرض الفعلي المُطبَّق عليها (كان offer_percent رقمًا فقط
--    بلا معرفة أي عرض بالتحديد منذ 0003 — يمنع بناء تقرير "إجماليات العروض")
-- ---------------------------------------------------------------------------
alter table sales_invoices
  add column if not exists applied_offer_id uuid references offers(id) on delete set null;
create index if not exists idx_sales_invoices_offer on sales_invoices (applied_offer_id) where applied_offer_id is not null;

-- ---------------------------------------------------------------------------
-- 2) تقارير الإيراد
-- ---------------------------------------------------------------------------
create or replace view v_daily_revenue as
select
  organization_id,
  created_at::date as revenue_date,
  count(*) as invoice_count,
  sum(subtotal_amount) as gross_amount,
  sum(discount_amount) as discount_amount,
  sum(vat_amount) as vat_amount,
  sum(net_amount) as net_amount,
  sum(paid_amount) as paid_amount
from sales_invoices
where invoice_type = 'sale'
group by organization_id, created_at::date;

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
group by si.organization_id, si.created_at::date, si.source_value_id, lv.name_ar;

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
  from sales_invoices where invoice_type = 'sale'
  group by clinic_id
) inv on inv.clinic_id = c.id
left join (
  select clinic_id, count(*) as appointment_count
  from appointments
  group by clinic_id
) appt on appt.clinic_id = c.id;

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
  select doctor_id,
    count(*) as invoice_count,
    sum(net_amount) as net_amount,
    sum(net_amount) filter (where not is_insurance_invoice) as cash_amount,
    sum(net_amount) filter (where is_insurance_invoice) as insurance_amount
  from sales_invoices where invoice_type = 'sale'
  group by doctor_id
) inv on inv.doctor_id = d.id
left join (
  select doctor_id, count(*) as appointment_count
  from appointments
  group by doctor_id
) appt on appt.doctor_id = d.id;

-- ---------------------------------------------------------------------------
-- 3) إحصائية المبيعات حسب الخدمات
-- ---------------------------------------------------------------------------
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
left join sales_invoice_items sii on sii.item_id = i.id
left join sales_invoices si on si.id = sii.invoice_id and si.invoice_type = 'sale'
group by i.id, i.organization_id, i.name_ar, i.item_type;

-- ---------------------------------------------------------------------------
-- 4) إجماليات العروض والأطباء
-- ---------------------------------------------------------------------------
create or replace view v_offers_totals as
select
  o.id as offer_id,
  o.organization_id,
  o.title,
  count(si.id) as applied_invoice_count,
  coalesce(sum(si.discount_amount), 0) as total_discount_amount
from offers o
left join sales_invoices si on si.applied_offer_id = o.id and si.invoice_type = 'sale'
group by o.id, o.organization_id, o.title;

-- "إجماليات الأطباء" مغطاة بالكامل عبر v_revenue_by_doctor أعلاه

-- ---------------------------------------------------------------------------
-- 5) إحصائية الفواتير المؤقتة والاتفاقيات
-- ---------------------------------------------------------------------------
create or replace view v_temporary_invoices_stats as
select organization_id, count(*) as temp_invoice_count, sum(net_amount) as total_amount
from sales_invoices
where is_temporary = true
group by organization_id;

create or replace view v_agreements_stats as
select organization_id,
  count(*) as agreement_count,
  sum(total_amount) as total_amount,
  sum(invoiced_amount) as total_invoiced,
  sum(remaining_amount) as total_remaining
from treatment_agreements
where is_disabled = false
group by organization_id;

-- ---------------------------------------------------------------------------
-- 6) الربحية الحقيقية لكل فاتورة — تقدير مبسّط (Cost of Goods Sold)
--    يستخدم items.cost_price كأساس تكلفة (سعر تكلفة ثابت وقت الاستعلام) بدل
--    إعادة حساب متوسط مرجح لحظي (Point-in-time Weighted Average) لكل بند —
--    تبسيط متعمد وواضح، قابل للترقية لاحقًا لتكلفة فعلية من inventory_lots
--    عند ربط كل بند فاتورة بدفعة مخزون محدَّدة وقت البيع.
-- ---------------------------------------------------------------------------
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
group by si.id, si.organization_id, si.created_at, si.net_amount;

-- ---------------------------------------------------------------------------
-- 7) كشوف ضريبة القيمة المضافة
-- ---------------------------------------------------------------------------
create or replace view v_vat_statement_sales_invoices as
select organization_id, created_at::date as invoice_date, id as invoice_id, invoice_number,
  subtotal_amount, vat_amount, net_amount
from sales_invoices
where invoice_type = 'sale' and vat_amount > 0;

create or replace view v_vat_statement_vouchers as
select organization_id, voucher_date, id as voucher_id, voucher_number, voucher_type, amount, vat_amount
from financial_vouchers
where vat_amount is not null and vat_amount > 0;

-- ---------------------------------------------------------------------------
-- 8) كشف المرتجعات
-- ---------------------------------------------------------------------------
create or replace view v_returns_statement_items as
select
  si.organization_id,
  si.id as return_invoice_id,
  si.created_at::date as return_date,
  si.original_invoice_id,
  sii.item_id,
  i.name_ar as item_name,
  sii.qty,
  sii.net_amount
from sales_invoices si
join sales_invoice_items sii on sii.invoice_id = si.id
left join items i on i.id = sii.item_id
where si.invoice_type = 'return';

create or replace view v_returns_statement_receipts as
select
  fv.organization_id,
  fv.id as voucher_id,
  fv.voucher_date,
  fv.amount,
  va.sales_invoice_id as return_invoice_id
from financial_vouchers fv
join voucher_invoice_allocations va on va.voucher_id = fv.id
join sales_invoices si on si.id = va.sales_invoice_id
where si.invoice_type = 'return';

-- ---------------------------------------------------------------------------
-- 9) مؤشرات الأداء الحيّة لمدى تاريخ محدد (نسبة الخصم % / نسبة التحصيل %)
--    (لقطة 47/98: تُعرَض أسفل شاشة الفواتير القديمة) — دالة بمعاملات بدل View
--    لأن المدى الزمني يتغيّر مع كل استعلام من الواجهة
-- ---------------------------------------------------------------------------
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
language sql
stable
security definer
as $$
  select
    coalesce(sum(subtotal_amount), 0) as gross_amount,
    coalesce(sum(discount_amount), 0) as discount_amount,
    case when coalesce(sum(subtotal_amount), 0) = 0 then 0
      else round((sum(discount_amount) / sum(subtotal_amount)) * 100, 2)
    end as discount_rate_percent,
    coalesce(sum(net_amount), 0) as net_amount,
    coalesce(sum(paid_amount), 0) as paid_amount,
    case when coalesce(sum(net_amount), 0) = 0 then 0
      else round((sum(paid_amount) / sum(net_amount)) * 100, 2)
    end as collection_rate_percent
  from sales_invoices
  where organization_id = p_organization_id
    and invoice_type = 'sale'
    and created_at::date between p_date_from and p_date_to;
$$;

-- ---------------------------------------------------------------------------
-- 10) إعدادات ورق الطباعة (A4 مقابل رول حراري 80mm) — فجوة موثّقة من قائمة
--     "التحكم" (لقطة 82) لم تُبنَ في أي ملف سابق
-- ---------------------------------------------------------------------------
create table if not exists print_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  invoice_paper_size text not null default 'a4' check (invoice_paper_size in ('a4','thermal_80mm')),
  receipt_paper_size text not null default 'thermal_80mm' check (receipt_paper_size in ('a4','thermal_80mm')),
  report_paper_size text not null default 'a4' check (report_paper_size in ('a4','thermal_80mm')),
  show_logo boolean not null default true,
  footer_note text,
  updated_at timestamptz not null default now()
);
alter table print_settings enable row level security;
create policy "print_settings_read_members" on print_settings
  for select using (app_is_member(organization_id));
create policy "print_settings_insert_admins" on print_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "print_settings_update_admins" on print_settings
  for update using (app_is_org_admin(organization_id));

-- ============================================================================
-- نهاية 0010_reports.sql — نهاية المرحلة 2 (بناء المخطط الخلفي الكامل)
-- كل الوحدات العشر من خارطة الطريق الأصلية مكتملة الآن: 0001 الأساس والصلاحيات ·
-- 0002 المرضى/الأطباء/المواعيد · 0003 الفوترة/المخزون/المشتريات · 0004 الضريبة/
-- الخصومات/العروض · 0005 التأمين الطبي · 0006 الفحص الطبي الديناميكي · 0007
-- معامل الأسنان · 0008 الموارد البشرية/الرواتب · 0009 الرسائل/SMS · 0010 التقارير.
--
-- المرحلة التالية (المرحلة 3 من خطة العمل الأصلية): إعادة تصميم واجهات المشروع
-- (Frontend) بهيكلة عصرية مبنية على module-registry.ts الحالي، وربطها فعليًا
-- بهذا المخطط الخلفي عبر Supabase Client بدل شاشة العرض التجريبية Index.tsx.
-- ============================================================================
