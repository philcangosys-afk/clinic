-- 0041: إضافة تجميع حسب الطبيب لإحصائيات المرضى المالية (لقطة 30)
--
-- المواصفة تطلب فلترة إحصائيات المرضى حسب الطبيب، والعرض `v_patient_financials`
-- (0039) كان يجمّع على مستوى المريض فقط بلا أي بُعد للطبيب.
--
-- قرار: يُضاف عرض منفصل بدل تعديل الأصلي. السبب أن التجميع حسب (مريض × طبيب)
-- يضاعف صفوف المريض الذي عالجه أكثر من طبيب — فلو غُيّر العرض الأصلي لأصبح
-- مجموع أعمدته أكبر من الحقيقة في أي شاشة تستخدمه بلا تجميع إضافي. الفصل
-- يُبقي `v_patient_financials` صحيحًا كما هو ويضيف البُعد الجديد بأمان.

create or replace view v_patient_financials_by_doctor as
select
  si.organization_id,
  si.patient_id,
  si.doctor_id,
  d.name_ar                 as doctor_name,
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
left join doctors d on d.id = si.doctor_id
where si.status <> 'void'
  and si.is_temporary = false
  and si.patient_id is not null
group by
  si.organization_id, si.patient_id, si.doctor_id, d.name_ar,
  p.file_number, p.name_ar, p.mobile_number, p.insurance_company_name;
