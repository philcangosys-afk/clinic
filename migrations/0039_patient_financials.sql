-- 0039: إحصائيات المرضى المالية (لقطة 30)
--
-- الفجوة: لم يكن هناك أي تقرير يعرض لكل مريض إجمالي أعماله ومدفوعاته
-- والمتبقي عليه. المعلومة موجودة موزَّعة على الفواتير لكن بلا تجميع.
--
-- قرار: الفواتير الملغاة (void) والمؤقتة (عروض الأسعار) مستبعدة، لأنها لا
-- تمثّل التزامًا ماليًا فعليًا على المريض. إدخالها كان سيضخّم المديونية
-- بأرقام لم تُستحق أصلًا.
--
-- المرتجعات (invoice_type = 'return') تدخل بإشارة سالبة لتخفّض الإجمالي،
-- وهو السلوك المحاسبي الصحيح: المرتجع يقلّل ما على المريض لا يزيده.

create or replace view v_patient_financials as
select
  si.organization_id,
  si.patient_id,
  p.file_number,
  p.name_ar                 as patient_name,
  p.mobile_number,
  p.insurance_company_name,
  count(*)                  as invoice_count,
  sum(
    case when si.invoice_type = 'return' then -si.net_amount else si.net_amount end
  )                         as total_work,
  sum(
    case when si.invoice_type = 'return' then -si.paid_amount else si.paid_amount end
  )                         as total_paid,
  sum(
    case when si.invoice_type = 'return' then -si.remaining_amount else si.remaining_amount end
  )                         as total_remaining,
  max(si.created_at)        as last_invoice_at
from sales_invoices si
join patients p on p.id = si.patient_id
where si.status <> 'void'
  and si.is_temporary = false
  and si.patient_id is not null
group by
  si.organization_id, si.patient_id, p.file_number,
  p.name_ar, p.mobile_number, p.insurance_company_name;
