-- ============================================================================
-- 0243_business_day_refunds_vs_expenses.sql — سداد المورد ليس «مرتجعًا»
-- ============================================================================
-- سؤال المالك (10/10/2026): يومية 14 تعرض «المرتجع 363.29» و«غير محصَّل
-- 363.29» — ما هذا وأين أجده؟
--
-- السبب: 363.29 هو سند سداد فاتورة الشراء 104 (شركة عالم السعر الأقل)، سندٌ
-- من نوع «مصروف» دخل اليومية. و`v_business_day_summary` (0147/0191) كان يعدّ
-- **كلّ** سندٍ ليس سند قبض «مرتجعًا للمرضى»، فيطرحه من المحصَّل:
--   المحصَّل فعليًّا = 6,031.25 − 363.29 = 5,667.96
--   غير محصَّل      = 6,031.25 − 5,667.96 = 363.29
-- والفواتير كلّها مدفوعة في الحقيقة. وكذلك `v_business_day_collections` كان
-- يطرح سداد المورد من تحصيل «مدى» في جدول طرق الدفع.
--
-- الإصلاح:
--   • «المرتجع» = سندات الاسترداد للمرضى فقط: سندٌ ليس قبضًا ومرتبطٌ بفاتورة
--     مبيعات أو بسند قبضٍ يستردّه (`related_sales_invoice_id` /
--     `refund_of_voucher_id`) — وهو ما يكتبه `app_refund_invoice_payment`.
--   • عمودٌ جديد في آخر المنظور `expenses_amount`: ما صُرف في اليومية لغير
--     المرضى (سداد موردين، مصروفات، رواتب، إيداع…) — يُعرض منفصلًا ولا يدخل
--     المحصَّل ولا غير المحصَّل.
--   • جدول «المحصَّل حسب طريقة الدفع» يعدّ القبض والاسترداد فقط.
--
-- منظوران فقط، لا بيانات تُعدَّل. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

create or replace view public.v_business_day_summary as
select
  d.id                                    as business_day_id,
  d.organization_id,
  d.branch_id,
  d.day_number,
  d.business_date,
  d.opened_at,
  d.closed_at,
  d.closed_by,
  d.note,
  (d.closed_at is null)                   as is_open,
  coalesce(inv.invoices_count, 0)         as invoices_count,
  coalesce(inv.gross_amount, 0)           as gross_amount,
  coalesce(inv.discount_amount, 0)        as discount_amount,
  coalesce(inv.vat_amount, 0)             as vat_amount,
  coalesce(inv.exemption_amount, 0)       as exemption_amount,
  coalesce(inv.net_amount, 0)             as net_amount,
  coalesce(vch.collected_amount, 0)       as collected_amount,
  coalesce(vch.refunded_amount, 0)        as refunded_amount,
  coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0) as net_collected_amount,
  coalesce(inv.net_amount, 0) - (coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0))
                                          as outstanding_amount,
  d.scheduled_close_at,
  d.auto_closed,
  d.opened_by,
  -- 0243: المصروف في اليومية لغير المرضى — في آخر الأعمدة
  coalesce(vch.expenses_amount, 0)        as expenses_amount
from business_days d
left join lateral (
  select count(*)                                     as invoices_count,
         sum(i.subtotal_amount)                       as gross_amount,
         sum(i.discount_amount)                       as discount_amount,
         sum(i.vat_amount)                            as vat_amount,
         sum(i.exemption_amount)                      as exemption_amount,
         sum(i.net_amount)                            as net_amount
    from sales_invoices i
   where i.business_day_id = d.id
     and i.status <> 'void'
     and not coalesce(i.is_temporary, false)
) inv on true
left join lateral (
  select sum(case when v.voucher_type = 'receipt' then v.amount else 0 end) as collected_amount,
         sum(case when v.voucher_type <> 'receipt'
                   and (v.related_sales_invoice_id is not null or v.refund_of_voucher_id is not null)
                  then v.amount else 0 end)                                 as refunded_amount,
         sum(case when v.voucher_type <> 'receipt'
                   and v.related_sales_invoice_id is null
                   and v.refund_of_voucher_id is null
                  then v.amount else 0 end)                                 as expenses_amount
    from financial_vouchers v
   where v.business_day_id = d.id
     and not coalesce(v.is_void, false)
) vch on true;

alter view public.v_business_day_summary set (security_invoker = on);
grant select on public.v_business_day_summary to authenticated;

-- طرق الدفع: القبض والاسترداد للمرضى فقط — سداد المورد ليس تحصيلًا
create or replace view public.v_business_day_collections as
select v.business_day_id,
       v.organization_id,
       coalesce(lv.name_ar, 'غير محدَّدة'::text) as method_name,
       coalesce((lv.extra ->> 'affects_drawer')::boolean, false) as affects_drawer,
       count(*) as vouchers_count,
       sum(case when v.voucher_type = 'receipt' then v.amount else - v.amount end) as amount
  from financial_vouchers v
  left join lookup_values lv on lv.id = v.payment_method_value_id
 where v.business_day_id is not null
   and not coalesce(v.is_void, false)
   and (v.voucher_type = 'receipt'
        or v.related_sales_invoice_id is not null
        or v.refund_of_voucher_id is not null)
 group by v.business_day_id, v.organization_id, lv.name_ar, lv.extra;

alter view public.v_business_day_collections set (security_invoker = on);
grant select on public.v_business_day_collections to authenticated;

commit;
