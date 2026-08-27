-- =====================================================================
-- 0018_patient_journey.sql
-- المرحلة 5.4 — رحلة المريض (Patient Journey)
-- =====================================================================
-- لا جداول جديدة هنا — فقط VIEW مُجمِّع (UNION ALL) يلتقط كل الأحداث
-- المرتبطة بمريض واحد من كل الوحدات القديمة والجديدة، بترتيب زمني واحد،
-- بدون أي جدول "نسخة" يحتاج مزامنة (نفس فلسفة "آراء مباشرة Live Views"
-- المعتمدة منذ 0010). أي حدث جديد يُضاف مستقبلاً لمريض يظهر تلقائيًا هنا
-- بمجرد إضافة فرع UNION له — لا حاجة لأي Trigger أو مهمة مجدولة.
--
-- الأعمدة الموحّدة لكل فرع:
--   patient_id, organization_id, event_at, event_type, title, subtitle,
--   status, source_module, source_id
-- =====================================================================

create or replace view v_patient_journey as
-- 1) المواعيد
select
  a.patient_id,
  a.organization_id,
  a.scheduled_start as event_at,
  'appointment'::text as event_type,
  'موعد'::text as title,
  coalesce(d.name_ar, '')::text as subtitle,
  a.status::text as status,
  'appointments'::text as source_module,
  a.id as source_id
from appointments a
left join doctors d on d.id = a.doctor_id

union all
-- 2) ملاحظات المريض (لا عمود organization_id مباشر — نصل عبر patients)
select
  n.patient_id,
  p.organization_id,
  n.created_at as event_at,
  'note'::text as event_type,
  coalesce(n.title, 'ملاحظة')::text as title,
  left(n.body, 200)::text as subtitle,
  null::text as status,
  'patient_notes'::text as source_module,
  n.id as source_id
from patient_notes n
join patients p on p.id = n.patient_id

union all
-- 3) الزيارات
select
  v.patient_id,
  v.organization_id,
  v.visit_date as event_at,
  'visit'::text as event_type,
  'زيارة'::text as title,
  coalesce(v.main_complaint, '')::text as subtitle,
  null::text as status,
  'patient_visits'::text as source_module,
  v.id as source_id
from patient_visits v

union all
-- 4) مستندات المريض
select
  doc.patient_id,
  doc.organization_id,
  doc.created_at as event_at,
  'document'::text as event_type,
  coalesce(doc.file_name, 'مستند')::text as title,
  coalesce(doc.category, '')::text as subtitle,
  null::text as status,
  'patient_documents'::text as source_module,
  doc.id as source_id
from patient_documents doc

union all
-- 5) مطالبات التأمين
select
  c.patient_id,
  c.organization_id,
  c.created_at as event_at,
  'insurance_claim'::text as event_type,
  'مطالبة تأمين'::text as title,
  coalesce(c.form_type, '')::text as subtitle,
  c.status::text as status,
  'insurance_claim_forms'::text as source_module,
  c.id as source_id
from insurance_claim_forms c

union all
-- 6) اشتراك باقات المريض
select
  pp.patient_id,
  pp.organization_id,
  pp.purchased_at as event_at,
  'package_purchase'::text as event_type,
  'اشتراك باقة'::text as title,
  coalesce(pk.name_ar, '')::text as subtitle,
  pp.status::text as status,
  'patient_packages'::text as source_module,
  pp.id as source_id
from patient_packages pp
left join packages pk on pk.id = pp.package_id

union all
-- 7) طلبات المختبر
select
  lo.patient_id,
  lo.organization_id,
  lo.ordered_at as event_at,
  'lab_order'::text as event_type,
  'طلب مختبر'::text as title,
  ''::text as subtitle,
  lo.status::text as status,
  'lab_orders'::text as source_module,
  lo.id as source_id
from lab_orders lo

union all
-- 8) طلبات الأشعة
select
  ro.patient_id,
  ro.organization_id,
  ro.ordered_at as event_at,
  'radiology_order'::text as event_type,
  'طلب أشعة'::text as title,
  ''::text as subtitle,
  ro.status::text as status,
  'radiology_orders'::text as source_module,
  ro.id as source_id
from radiology_orders ro

union all
-- 9) الوصفات الطبية
select
  pr.patient_id,
  pr.organization_id,
  pr.issued_at as event_at,
  'prescription'::text as event_type,
  'وصفة طبية'::text as title,
  ''::text as subtitle,
  pr.status::text as status,
  'prescriptions'::text as source_module,
  pr.id as source_id
from prescriptions pr

union all
-- 10) الفواتير (بيع/مرتجع) — مرتبطة بمريض فعلي فقط (استبعاد العملاء الخارجيين)
select
  si.patient_id,
  si.organization_id,
  si.created_at as event_at,
  'invoice'::text as event_type,
  ('فاتورة #' || si.invoice_number::text)::text as title,
  si.invoice_type::text as subtitle,
  si.status::text as status,
  'sales_invoices'::text as source_module,
  si.id as source_id
from sales_invoices si
where si.patient_id is not null;

comment on view v_patient_journey is
  'خط زمني موحّد لكل الأحداث المرتبطة بمريض واحد من عشر وحدات مختلفة — مواعيد، ملاحظات، زيارات، مستندات، تأمين، باقات، مختبر، أشعة، وصفات، فواتير. لا جدول فعلي — كل الأعمدة تُحسب مباشرة من الجداول الأصلية (Live View) فلا حاجة لأي مزامنة أو Trigger.';

-- فهارس مساعدة على الجداول المصدر لتسريع فرز الـ VIEW حسب (patient_id) ثم التاريخ
-- (لا حاجة لفهرس على الـ VIEW نفسه لأنه غير Materialized)
create index if not exists idx_patient_notes_patient_created on patient_notes (patient_id, created_at desc);
create index if not exists idx_patient_visits_patient_date on patient_visits (patient_id, visit_date desc);
create index if not exists idx_patient_documents_patient_created on patient_documents (patient_id, created_at desc);
create index if not exists idx_insurance_claim_forms_patient_created on insurance_claim_forms (patient_id, created_at desc);
