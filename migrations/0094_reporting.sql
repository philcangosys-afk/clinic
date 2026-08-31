-- ============================================================================
-- 0094 — المرحلة 14: التقارير المالية والتشغيلية والتأمينية
-- ============================================================================
--
-- **لماذا مناظير موحّدة بدل تقارير مستقلّة**
--
-- كل تقرير كُتب على حدة يحمل تعريفه الخاصّ لـ"الإيراد" و"المحصَّل"، فيخرج
-- تقرير الإيراد برقم وتقرير الذمم برقم آخر لنفس اليوم، ولا أحد يعرف أيّهما
-- الصحيح. هنا كل رقم ماليّ يُشتقّ من **مصدر واحد**: بند الفاتورة كما جمّدته
-- المرحلة 11، والضريبة كما حسبتها `app_compute_line_tax` في المرحلة 12،
-- وحصّة الشركة كما أقرّتها المرحلة 13.
--
-- كل منظور هنا يلتزم بشكل واحد ليعمل عليه مرشّح واحد في الواجهة:
--   organization_id · branch_id · تاريخ واحد باسم `report_date`
--   · معرّفات الأبعاد (doctor_id, clinic_id, item_id, company_id) وأسماؤها
--
-- كلّها `security_invoker = on`: التقرير يرى ما يراه المستخدم لا أكثر، فلا
-- يتحوّل التقرير إلى ثغرة تتخطّى عزل المنشآت والفروع.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) صلاحيات التقارير — مفصولة عن صلاحيات التشغيل
-- ===========================================================================
--
-- من يُصدر الفواتير ليس بالضرورة من يرى إيراد المنشأة كاملًا، ومن يعالج
-- المطالبات ليس بالضرورة من يرى هوامش الأطباء. لذلك صلاحية مشاهدة منفصلة
-- لكل عائلة تقارير، وصلاحية ثالثة للتصدير لأن التصدير إخراجُ بيانات.
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('reports.financial',   'التقارير المالية',   'reports', 800),
  ('reports.insurance',   'التقارير التأمينية', 'reports', 802),
  ('reports.operational', 'التقارير التشغيلية', 'reports', 804),
  ('reports.export',      'تصدير التقارير',     'reports', 806)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- التصدير إخراجُ بيانات خارج النظام، فلا يُمنح مع القراءة تلقائيًا لكل دور.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'reports.financial'), ('accountant', 'reports.insurance'),
  ('accountant',     'reports.operational'), ('accountant', 'reports.export'),
  ('branch_manager', 'reports.financial'), ('branch_manager', 'reports.insurance'),
  ('branch_manager', 'reports.operational'), ('branch_manager', 'reports.export'),
  ('doctor',         'reports.operational'),
  ('receptionist',   'reports.operational')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) التقارير المالية
-- ===========================================================================

-- 2-1) الإيراد بحبّة **بند الفاتورة**، لا بحبّة الفاتورة.
-- بهذا يُجمع الإيراد حسب الفرع أو الطبيب أو العيادة أو الخدمة من مصدر واحد،
-- بدل أربعة مناظير تتفرّق أرقامها. الطبيب هنا طبيب **البند** لا الفاتورة:
-- زيارة يشترك فيها طبيبان تُنسب فيها كل خدمة لمن أدّاها فعلًا.
-- `v_report_doctor_productivity` مبنيّ فوق `v_report_revenue`، فيُسقَط أولًا
-- وإلا فشل إسقاط الأصل عند إعادة تنفيذ الهجرة (dependency error).
drop view if exists v_report_doctor_productivity;
drop view if exists v_report_revenue;
create view v_report_revenue
with (security_invoker = on) as
select
  li.id                                as line_id,
  inv.id                               as invoice_id,
  inv.invoice_number,
  inv.document_number,
  inv.document_type,
  inv.status                           as invoice_status,
  inv.organization_id,
  coalesce(li.branch_id, inv.branch_id) as branch_id,
  br.name                              as branch_name,
  coalesce(inv.issued_at::date, inv.created_at::date) as report_date,
  inv.issued_at,
  coalesce(li.doctor_id, inv.doctor_id) as doctor_id,
  d.name_ar                            as doctor_name,
  inv.clinic_id,
  c.name                               as clinic_name,
  li.item_id,
  coalesce(li.item_name_snapshot, it.name_ar, li.description) as item_name,
  it.item_type,
  it.medical_service_type,
  it.category_value_id,
  cat.name_ar                          as category_name,
  inv.patient_id,
  p.name_ar                            as patient_name,
  inv.is_insurance_invoice,
  -- **اسم الشركة يُقرأ من لقطة الفاتورة**، لا من عضوية المريض الحالية:
  -- المريض قد يغيّر شركته بعد الفوترة، فيتغيّر تقرير الشهر الماضي لو أخذناه
  -- من العضوية. المعرّف يُستنتج من المطالبة إن وُجدت لأنها لقطة الوقت نفسه.
  inv.insurance_company_name,
  cf_comp.company_id                   as insurance_company_id,
  li.qty,
  li.list_price,
  li.price,
  round(li.price * li.qty, 2)          as gross_amount,
  li.discount_amount,
  li.taxable_base,
  li.vat_category,
  li.vat_rate,
  li.vat_amount,
  li.net_amount,
  li.patient_share,
  li.insurer_share,
  li.source_type,
  li.visit_id
from sales_invoice_items li
join sales_invoices inv     on inv.id = li.invoice_id
left join branches  br      on br.id  = coalesce(li.branch_id, inv.branch_id)
left join doctors   d       on d.id   = coalesce(li.doctor_id, inv.doctor_id)
left join clinics   c       on c.id   = inv.clinic_id
left join items     it      on it.id  = li.item_id
left join lookup_values cat on cat.id = it.category_value_id
left join patients  p       on p.id   = inv.patient_id
left join lateral (
  select pol.company_id
    from insurance_claim_forms f
    join patient_insurance_memberships mem on mem.id = f.membership_id
    join insurance_policies pol on pol.id = mem.policy_id
   where f.sales_invoice_id = inv.id
   order by f.created_at limit 1
) cf_comp on true
where inv.status <> 'void'
  and coalesce(inv.is_temporary, false) = false;

comment on view v_report_revenue is
  'الإيراد بحبّة بند الفاتورة: كل أبعاد التجميع (فرع/طبيب/عيادة/خدمة/شركة) في مصدر واحد، فلا تتفرّق الأرقام بين التقارير. الفواتير الملغاة والمؤقّتة مستبعَدة.';

-- 2-2) المقبوضات حسب طريقة الدفع.
-- السندات المرتجعة تظهر بإشارة سالبة في `signed_amount` ليصحّ الجمع مباشرةً،
-- وتبقى `amount` موجبةً لمن يريد عدّ الحركات.
drop view if exists v_report_receipts;
create view v_report_receipts
with (security_invoker = on) as
select
  v.id                        as voucher_id,
  v.voucher_number,
  v.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  v.voucher_date              as report_date,
  v.voucher_type,
  v.payment_method_value_id,
  pm.name_ar                  as payment_method_name,
  pm.code                     as payment_method_code,
  coalesce((pm.extra->>'affects_drawer')::boolean, false) as affects_drawer,
  v.cash_register_id,
  reg.name                    as register_name,
  v.cash_shift_id,
  v.patient_id,
  p.name_ar                   as patient_name,
  v.doctor_id,
  d.name_ar                   as doctor_name,
  v.amount,
  case when v.voucher_type in ('refund','payment') then -v.amount else v.amount end
                              as signed_amount,
  v.refund_of_voucher_id is not null as is_refund,
  v.created_by,
  v.created_at,
  v.is_void,
  alloc.sales_invoice_id,
  inv.invoice_number
from financial_vouchers v
left join lookup_values pm on pm.id = v.payment_method_value_id
left join branches      br on br.id = v.branch_id
left join cash_registers reg on reg.id = v.cash_register_id
left join patients      p  on p.id  = v.patient_id
left join doctors       d  on d.id  = v.doctor_id
left join voucher_invoice_allocations alloc on alloc.voucher_id = v.id
left join sales_invoices inv on inv.id = alloc.sales_invoice_id
where coalesce(v.is_void, false) = false;

comment on view v_report_receipts is
  'المقبوضات والمصروفات حسب طريقة الدفع والصندوق والمناوبة. `signed_amount` موقَّعة ليصحّ الجمع، والسندات الملغاة مستبعَدة.';

-- 2-3) الفواتير غير المسدَّدة مع أعمار الدين.
-- التقادم يُحسب من تاريخ **الإصدار** لا الإنشاء: مسوّدةٌ عمرها شهر ليست دينًا.
drop view if exists v_report_outstanding;
create view v_report_outstanding
with (security_invoker = on) as
select
  inv.id                      as invoice_id,
  inv.invoice_number,
  inv.document_number,
  inv.organization_id,
  inv.branch_id,
  br.name                     as branch_name,
  inv.issued_at::date         as report_date,
  inv.status,
  inv.patient_id,
  p.name_ar                   as patient_name,
  p.file_number,
  p.phone_1                   as patient_phone,
  inv.doctor_id,
  d.name_ar                   as doctor_name,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  (current_date - inv.issued_at::date) as days_outstanding,
  case
    when inv.issued_at is null then 'غير مُصدَرة'
    when current_date - inv.issued_at::date <= 30  then '٠–٣٠'
    when current_date - inv.issued_at::date <= 60  then '٣١–٦٠'
    when current_date - inv.issued_at::date <= 90  then '٦١–٩٠'
    else 'أكثر من ٩٠'
  end                         as ageing_bucket
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
where inv.status in ('unpaid','partial')
  and inv.remaining_amount > 0
  and coalesce(inv.is_temporary, false) = false;

comment on view v_report_outstanding is
  'الفواتير غير المسدَّدة بأعمار الدين محسوبةً من تاريخ الإصدار — المسوّدة ليست دينًا.';

-- 2-4) الخصومات والاستردادات — **بسببها ومَن أقرّها**.
-- خصمٌ بلا سبب ولا مُقرٍّ هو الباب الذي يخرج منه المال بلا أثر، ولذلك
-- يجمع هذا المنظور الاثنين في تدفّق واحد للمراجعة.
drop view if exists v_report_discounts_refunds;
create view v_report_discounts_refunds
with (security_invoker = on) as
select
  'discount'                  as entry_kind,
  inv.id                      as reference_id,
  inv.invoice_number          as reference_number,
  inv.organization_id,
  inv.branch_id,
  br.name                     as branch_name,
  coalesce(inv.issued_at::date, inv.created_at::date) as report_date,
  inv.patient_id,
  p.name_ar                   as patient_name,
  inv.doctor_id,
  d.name_ar                   as doctor_name,
  inv.discount_amount         as amount,
  inv.discount_percent        as percent_value,
  inv.discount_reason         as reason,
  inv.discount_by             as acted_by,
  u.email                     as acted_by_email
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
left join auth.users u on u.id = inv.discount_by
where coalesce(inv.discount_amount, 0) > 0
  and inv.status <> 'void'
union all
select
  'refund',
  v.id,
  v.voucher_number,
  v.organization_id,
  v.branch_id,
  br.name,
  v.voucher_date,
  v.patient_id,
  p.name_ar,
  v.doctor_id,
  d.name_ar,
  v.amount,
  null::numeric,
  v.description,
  v.created_by,
  u.email
from financial_vouchers v
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = v.patient_id
left join doctors  d  on d.id  = v.doctor_id
left join auth.users u on u.id = v.created_by
where v.refund_of_voucher_id is not null
  and coalesce(v.is_void, false) = false
union all
select
  'void',
  inv.id,
  inv.invoice_number,
  inv.organization_id,
  inv.branch_id,
  br.name,
  coalesce(inv.voided_at::date, inv.updated_at::date),
  inv.patient_id,
  p.name_ar,
  inv.doctor_id,
  d.name_ar,
  inv.net_amount,
  null::numeric,
  inv.void_reason,
  inv.voided_by,
  u.email
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
left join auth.users u on u.id = inv.voided_by
where inv.status = 'void';

comment on view v_report_discounts_refunds is
  'الخصومات والاستردادات والإلغاءات في تدفّق واحد بسببها ومَن أقرّها — خصمٌ بلا سبب ولا مُقرٍّ لا يظهر هنا نظيفًا.';

-- 2-5) الإشعارات الدائنة والمدينة (المرحلة 12).
drop view if exists v_report_credit_debit_notes;
create view v_report_credit_debit_notes
with (security_invoker = on) as
select
  n.id                        as note_id,
  n.document_number,
  n.document_type,
  n.note_type,
  n.note_reason,
  n.organization_id,
  n.branch_id,
  br.name                     as branch_name,
  coalesce(n.issued_at::date, n.created_at::date) as report_date,
  n.patient_id,
  p.name_ar                   as patient_name,
  n.corrects_invoice_id,
  orig.invoice_number         as corrects_invoice_number,
  orig.document_number        as corrects_document_number,
  n.subtotal_amount,
  n.vat_amount,
  n.net_amount,
  n.created_by,
  u.email                     as created_by_email
from sales_invoices n
left join sales_invoices orig on orig.id = n.corrects_invoice_id
left join branches br on br.id = n.branch_id
left join patients p  on p.id  = n.patient_id
left join auth.users u on u.id = n.created_by
where n.document_type in ('credit_note','debit_note');

comment on view v_report_credit_debit_notes is
  'الإشعارات الدائنة والمدينة مرتبطةً بالفاتورة التي تصحّحها وسببها — لا تُحذف فاتورة مُصدَرة، بل تُصحَّح بإشعار.';

-- ===========================================================================
-- 3) التقارير التأمينية
-- ===========================================================================

-- 3-1) المطالبات حسب الحالة، بمدّة المعالجة.
-- المدّة تُقاس من **الإرسال** إلى الردّ لا من الإنشاء: المطالبة التي تنتظر
-- استكمال ملفّها عندنا ليست بطئًا من الشركة.
drop view if exists v_report_claims;
create view v_report_claims
with (security_invoker = on) as
select
  cf.id                       as claim_form_id,
  cf.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.submitted_at::date, cf.created_at::date) as report_date,
  cf.created_at,
  cf.submitted_at,
  cf.responded_at,
  cf.paid_at,
  cf.status,
  cf.form_type,
  cf.nphies_status,
  cf.patient_id,
  p.name_ar                   as patient_name,
  cf.doctor_id,
  d.name_ar                   as doctor_name,
  cf.clinic_id,
  cl.name                     as clinic_name,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.claimed_amount,
  cf.approved_amount,
  cf.rejected_amount,
  cf.settled_amount,
  coalesce(cf.approved_amount, 0) - coalesce(cf.settled_amount, 0) as unsettled_amount,
  cf.resubmission_count,
  cf.rejection_code,
  cf.rejection_reason,
  case when cf.submitted_at is not null and cf.responded_at is not null
       then round(extract(epoch from (cf.responded_at - cf.submitted_at)) / 86400.0, 2)
  end                         as days_to_response,
  case when cf.submitted_at is not null and cf.paid_at is not null
       then round(extract(epoch from (cf.paid_at - cf.submitted_at)) / 86400.0, 2)
  end                         as days_to_payment,
  case when cf.submitted_at is not null and cf.responded_at is null
       then round(extract(epoch from (now() - cf.submitted_at)) / 86400.0, 2)
  end                         as days_awaiting_response
from insurance_claim_forms cf
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = cf.patient_id
left join doctors  d  on d.id  = cf.doctor_id
left join clinics  cl on cl.id = cf.clinic_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

comment on view v_report_claims is
  'المطالبات بحالتها ومبالغها ومدّة معالجتها. المدّة تُقاس من الإرسال لا من الإنشاء، فلا يُحمَّل المؤمِّن تأخيرَنا.';

-- 3-2) الرفض حسب الشركة والسبب والخدمة والطبيب — بحبّة البند.
-- الرفض على مستوى المطالبة يُخفي أن سببها بندٌ واحد متكرّر؛ هنا يظهر البند.
drop view if exists v_report_claim_rejections;
create view v_report_claim_rejections
with (security_invoker = on) as
select
  ci.id                       as claim_item_id,
  ci.form_id                  as claim_form_id,
  ci.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.responded_at::date, cf.submitted_at::date, cf.created_at::date) as report_date,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.doctor_id,
  d.name_ar                   as doctor_name,
  cf.patient_id,
  p.name_ar                   as patient_name,
  ci.item_id,
  coalesce(it.name_ar, ci.description) as item_name,
  it.medical_service_type,
  ci.service_code,
  ci.status                   as item_status,
  ci.rejection_code,
  ci.rejection_reason,
  ci.qty,
  ci.claimed_amount,
  ci.approved_amount,
  ci.rejected_amount
from insurance_claim_form_items ci
join insurance_claim_forms cf on cf.id = ci.form_id
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join items    it on it.id = ci.item_id
left join doctors  d  on d.id  = cf.doctor_id
left join patients p  on p.id  = cf.patient_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id
where coalesce(ci.rejected_amount, 0) > 0
   or ci.status in ('rejected','partially_approved');

comment on view v_report_claim_rejections is
  'الرفض بحبّة البند: الشركة والسبب والكود والخدمة والطبيب — لتُعالَج الأسباب المتكرّرة بدل عدّ المطالبات المرفوضة.';

-- 3-3) الموافقات المسبقة التي قاربت الانتهاء ولم تُستهلك.
-- الموافقة المنتهية غير المستهلكة خدمةٌ أُدّيت ولن تُدفع — تُلاحَق قبل انتهائها.
drop view if exists v_report_preauth_expiring;
create view v_report_preauth_expiring
with (security_invoker = on) as
select
  pa.id                       as preauthorization_id,
  pa.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  pa.valid_to                 as report_date,
  pa.status,
  pa.approval_number,
  pa.reference_number,
  pa.patient_id,
  p.name_ar                   as patient_name,
  pa.doctor_id,
  d.name_ar                   as doctor_name,
  pa.item_id,
  coalesce(it.name_ar, pa.service_description) as item_name,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  pa.requested_amount,
  pa.approved_amount,
  pa.qty,
  pa.valid_from,
  pa.valid_to,
  (pa.valid_to - current_date) as days_remaining,
  pa.consumed_at,
  pa.consumed_invoice_id
from insurance_preauthorizations pa
left join patient_visits v on v.id = pa.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = pa.patient_id
left join doctors  d  on d.id  = pa.doctor_id
left join items    it on it.id = pa.item_id
left join patient_insurance_memberships mem on mem.id = pa.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id
where pa.status in ('approved','partially_approved')
  and pa.consumed_at is null
  and pa.valid_to is not null;

comment on view v_report_preauth_expiring is
  'الموافقات المعتمَدة غير المستهلكة وأيّامها المتبقّية — الموافقة التي تنتهي بلا فوترة خدمةٌ لن تُدفع.';

-- 3-4) الفارق بين حصّة التأمين المتوقَّعة والتسوية الفعلية.
-- **هذا المنظور لا يحوّل الفارق إلى المريض.** يعرضه فقط ليُراجَع بقاعدة
-- مكتوبة، كما تشترط المرحلة 13.
drop view if exists v_report_settlement_variance;
create view v_report_settlement_variance
with (security_invoker = on) as
select
  cf.id                       as claim_form_id,
  cf.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.paid_at::date, cf.responded_at::date, cf.created_at::date) as report_date,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.patient_id,
  p.name_ar                   as patient_name,
  cf.sales_invoice_id,
  inv.invoice_number,
  inv.insurance_share_amount  as expected_insurer_share,
  cf.claimed_amount,
  cf.approved_amount,
  cf.settled_amount,
  coalesce(inv.insurance_share_amount, 0) - coalesce(cf.approved_amount, 0)
                              as approval_variance,
  coalesce(cf.approved_amount, 0) - coalesce(cf.settled_amount, 0)
                              as settlement_variance,
  cf.status
from insurance_claim_forms cf
left join sales_invoices inv on inv.id = cf.sales_invoice_id
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = cf.patient_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

comment on view v_report_settlement_variance is
  'الفرق بين حصّة التأمين المتوقَّعة في الفاتورة والمعتمَد والمسدَّد. عرضٌ للمراجعة فقط — لا يُحوَّل الفرق إلى المريض من هنا.';

-- ===========================================================================
-- 4) التقارير التشغيلية
-- ===========================================================================

-- 4-1) المواعيد والوصول وعدم الحضور ووقت الانتظار.
-- الانتظار يُقاس من **الوصول الفعليّ** أو الموعد المجدول أيّهما أحدث: مريضٌ
-- حضر قبل موعده بساعة لم ينتظرنا ساعة.
drop view if exists v_report_appointments;
create view v_report_appointments
with (security_invoker = on) as
select
  a.id                        as appointment_id,
  a.organization_id,
  a.branch_id,
  br.name                     as branch_name,
  a.scheduled_start::date     as report_date,
  a.scheduled_start,
  a.scheduled_end,
  a.status,
  a.doctor_id,
  d.name_ar                   as doctor_name,
  a.clinic_id,
  c.name                      as clinic_name,
  a.patient_id,
  p.name_ar                   as patient_name,
  a.item_id,
  it.name_ar                  as item_name,
  a.no_show_reason,
  a.cancellation_reason,
  coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) as arrived_at,
  a.called_at,
  a.entered_at,
  a.left_at,
  (a.status = 'no_show')      as is_no_show,
  (coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) is not null) as did_arrive,
  case when a.entered_at is not null
        and coalesce(a.checked_in_1_at, a.checked_in_2_at) is not null
       then round(extract(epoch from (a.entered_at
              - greatest(coalesce(a.checked_in_1_at, a.checked_in_2_at), a.scheduled_start)
            )) / 60.0, 1)
  end                         as wait_minutes,
  case when a.entered_at is not null and a.left_at is not null
       then round(extract(epoch from (a.left_at - a.entered_at)) / 60.0, 1)
  end                         as consultation_minutes,
  v.id                        as visit_id,
  v.status                    as visit_status,
  case when v.started_at is not null and v.ended_at is not null
       then round(extract(epoch from (v.ended_at - v.started_at)) / 60.0, 1)
  end                         as visit_minutes
from appointments a
left join branches br on br.id = a.branch_id
left join doctors  d  on d.id  = a.doctor_id
left join clinics  c  on c.id  = a.clinic_id
left join patients p  on p.id  = a.patient_id
left join items    it on it.id = a.item_id
left join patient_visits v on v.appointment_id = a.id;

comment on view v_report_appointments is
  'المواعيد والوصول وعدم الحضور ووقت الانتظار ومدّة الزيارة. الانتظار يُقاس من الوصول أو الموعد أيّهما أحدث، فلا يُحسب حضورُ المريض المبكّر انتظارًا علينا.';

-- 4-2) إنتاجية الأطباء: زيارات وخدمات وإيراد ليومٍ وطبيب.
-- الإيراد هنا **إيراد البند المنسوب للطبيب**، لا إيراد الفاتورة كاملًا،
-- وإلا نُسب عمل المختبر إلى طبيب العيادة.
drop view if exists v_report_doctor_productivity;
create view v_report_doctor_productivity
with (security_invoker = on) as
with visits as (
  select v.organization_id, v.branch_id, v.doctor_id, v.visit_date::date as report_date,
         count(*) as visit_count,
         count(*) filter (where v.status in ('signed','closed')) as completed_visits,
         avg(case when v.started_at is not null and v.ended_at is not null
                  then extract(epoch from (v.ended_at - v.started_at)) / 60.0 end)
           as avg_visit_minutes
  from patient_visits v
  where v.status <> 'cancelled'
  group by 1,2,3,4
),
revenue as (
  select r.organization_id, r.branch_id, r.doctor_id, r.report_date,
         count(*)                as line_count,
         sum(r.qty)              as service_qty,
         sum(r.net_amount)       as net_revenue,
         sum(r.patient_share)    as patient_share,
         sum(r.insurer_share)    as insurer_share
  from v_report_revenue r
  group by 1,2,3,4
)
select
  coalesce(vs.organization_id, rv.organization_id) as organization_id,
  coalesce(vs.branch_id, rv.branch_id)             as branch_id,
  br.name                                          as branch_name,
  coalesce(vs.doctor_id, rv.doctor_id)             as doctor_id,
  d.name_ar                                        as doctor_name,
  coalesce(vs.report_date, rv.report_date)         as report_date,
  coalesce(vs.visit_count, 0)                      as visit_count,
  coalesce(vs.completed_visits, 0)                 as completed_visits,
  round(vs.avg_visit_minutes::numeric, 1)          as avg_visit_minutes,
  coalesce(rv.line_count, 0)                       as line_count,
  coalesce(rv.service_qty, 0)                      as service_qty,
  coalesce(rv.net_revenue, 0)                      as net_revenue,
  coalesce(rv.patient_share, 0)                    as patient_share,
  coalesce(rv.insurer_share, 0)                    as insurer_share
from visits vs
full outer join revenue rv
  on rv.organization_id = vs.organization_id
 and rv.doctor_id is not distinct from vs.doctor_id
 and rv.branch_id is not distinct from vs.branch_id
 and rv.report_date = vs.report_date
left join branches br on br.id = coalesce(vs.branch_id, rv.branch_id)
left join doctors  d  on d.id  = coalesce(vs.doctor_id, rv.doctor_id);

comment on view v_report_doctor_productivity is
  'إنتاجية الطبيب يوميًّا: زيارات ومدّتها وخدمات وإيراد منسوب لبنوده هو — لا لإيراد الفاتورة كاملةً.';

-- 4-3) الطلبات (مختبر وأشعة وخدمات) في تدفّق واحد بمدّة الإنجاز.
drop view if exists v_report_orders;
create view v_report_orders
with (security_invoker = on) as
select
  'lab'                       as order_kind,
  lo.id                       as order_id,
  lo.organization_id,
  lo.branch_id,
  br.name                     as branch_name,
  lo.ordered_at::date         as report_date,
  lo.ordered_at,
  lo.resulted_at              as finished_at,
  lo.status,
  lo.priority,
  lo.patient_id,
  p.name_ar                   as patient_name,
  lo.ordering_doctor_id       as doctor_id,
  d.name_ar                   as doctor_name,
  lo.clinic_id,
  c.name                      as clinic_name,
  lo.visit_id,
  lo.sales_invoice_id,
  case when lo.resulted_at is not null
       then round(extract(epoch from (lo.resulted_at - lo.ordered_at)) / 3600.0, 2)
  end                         as turnaround_hours
from lab_orders lo
left join branches br on br.id = lo.branch_id
left join patients p  on p.id  = lo.patient_id
left join doctors  d  on d.id  = lo.ordering_doctor_id
left join clinics  c  on c.id  = lo.clinic_id
union all
select
  'radiology',
  ro.id,
  ro.organization_id,
  ro.branch_id,
  br.name,
  ro.ordered_at::date,
  ro.ordered_at,
  ro.reported_at,
  ro.status,
  ro.priority,
  ro.patient_id,
  p.name_ar,
  ro.ordering_doctor_id,
  d.name_ar,
  ro.clinic_id,
  c.name,
  ro.visit_id,
  ro.sales_invoice_id,
  case when ro.reported_at is not null
       then round(extract(epoch from (ro.reported_at - ro.ordered_at)) / 3600.0, 2)
  end
from radiology_orders ro
left join branches br on br.id = ro.branch_id
left join patients p  on p.id  = ro.patient_id
left join doctors  d  on d.id  = ro.ordering_doctor_id
left join clinics  c  on c.id  = ro.clinic_id
union all
select
  'service',
  s.id,
  s.organization_id,
  v.branch_id,
  br.name,
  s.created_at::date,
  s.created_at,
  s.status_changed_at,
  s.status,
  null,
  v.patient_id,
  p.name_ar,
  coalesce(s.performed_by, v.doctor_id),
  d.name_ar,
  v.clinic_id,
  c.name,
  s.visit_id,
  null::uuid,
  case when s.status_changed_at is not null
       then round(extract(epoch from (s.status_changed_at - s.created_at)) / 3600.0, 2)
  end
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = v.patient_id
left join doctors  d  on d.id  = coalesce(s.performed_by, v.doctor_id)
left join clinics  c  on c.id  = v.clinic_id;

comment on view v_report_orders is
  'الطلبات الطبّية كلّها (مختبر/أشعة/خدمات) في تدفّق واحد بمدّة الإنجاز بالساعات.';

-- 4-4) صرف الأدوية.
drop view if exists v_report_dispensing;
create view v_report_dispensing
with (security_invoker = on) as
select
  di.id                       as dispensing_item_id,
  dr.id                       as dispensing_record_id,
  di.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(dr.dispensed_at::date, dr.created_at::date) as report_date,
  dr.dispensed_at,
  dr.status,
  dr.patient_id,
  p.name_ar                   as patient_name,
  dr.pharmacist_id,
  dr.warehouse_id,
  w.name                      as warehouse_name,
  di.drug_item_id             as item_id,
  it.name_ar                  as item_name,
  di.lot_id,
  lot.lot_number,
  lot.expiry_date,
  di.quantity_dispensed       as qty,
  di.unit_price,
  round(coalesce(di.unit_price, 0) * coalesce(di.quantity_dispensed, 0), 2) as value_amount,
  dr.prescription_id,
  pr.doctor_id,
  d.name_ar                   as doctor_name,
  dr.sales_invoice_id
from dispensing_items di
join dispensing_records dr on dr.id = di.dispensing_record_id
left join prescriptions pr on pr.id = dr.prescription_id
left join patient_visits v on v.id = pr.visit_id
left join branches   br  on br.id  = v.branch_id
left join patients   p   on p.id   = dr.patient_id
left join warehouses w   on w.id   = dr.warehouse_id
left join items      it  on it.id  = di.drug_item_id
left join inventory_lots lot on lot.id = di.lot_id
left join doctors    d   on d.id   = pr.doctor_id;

comment on view v_report_dispensing is
  'صرف الأدوية بحبّة البند: الدواء والتشغيلة وتاريخ صلاحيتها والكمّية والقيمة والصيدليّ والطبيب الواصف.';

-- 4-5) حركة المخزون.
drop view if exists v_report_stock_movements;
create view v_report_stock_movements
with (security_invoker = on) as
select
  m.id                        as movement_id,
  m.organization_id,
  w.branch_id,
  br.name                     as branch_name,
  m.created_at::date          as report_date,
  m.created_at,
  m.movement_type,
  m.warehouse_id,
  w.name                      as warehouse_name,
  m.item_id,
  it.name_ar                  as item_name,
  it.item_type,
  m.lot_id,
  lot.lot_number,
  lot.expiry_date,
  m.qty,
  m.unit_price,
  m.total_amount,
  m.patient_id,
  p.name_ar                   as patient_name,
  m.doctor_id,
  d.name_ar                   as doctor_name,
  m.related_sales_invoice_id,
  m.related_purchase_invoice_id,
  m.related_stock_transfer_id,
  m.note,
  m.created_by
from inventory_movements m
left join warehouses w on w.id = m.warehouse_id
left join branches   br on br.id = w.branch_id
left join items      it on it.id = m.item_id
left join inventory_lots lot on lot.id = m.lot_id
left join patients   p  on p.id  = m.patient_id
left join doctors    d  on d.id  = m.doctor_id;

comment on view v_report_stock_movements is
  'حركة المخزون بنوعها وتشغيلتها وقيمتها ومرجعها (فاتورة بيع أو شراء أو تحويل).';

-- 4-6) رحلة المريض من الموعد حتى التحصيل — قمع تشغيليّ.
-- كل صفّ موعدٌ واحد، وأعمدته مراحله. الفجوة بين عمودين متجاورين هي المكان
-- الذي يتسرّب منه المال أو المريض.
drop view if exists v_report_patient_funnel;
create view v_report_patient_funnel
with (security_invoker = on) as
select
  a.id                        as appointment_id,
  a.organization_id,
  a.branch_id,
  br.name                     as branch_name,
  a.scheduled_start::date     as report_date,
  a.patient_id,
  p.name_ar                   as patient_name,
  a.doctor_id,
  d.name_ar                   as doctor_name,
  a.clinic_id,
  c.name                      as clinic_name,
  a.status                    as appointment_status,
  (coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) is not null) as reached_reception,
  v.id                        as visit_id,
  (v.id is not null)          as reached_visit,
  v.status                    as visit_status,
  (v.status in ('signed','closed')) as visit_signed,
  inv.id                      as invoice_id,
  (inv.id is not null)        as reached_invoice,
  inv.status                  as invoice_status,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  (coalesce(inv.paid_amount, 0) > 0) as reached_payment,
  (inv.status = 'paid')       as fully_collected,
  cf.id                       as claim_form_id,
  cf.status                   as claim_status
from appointments a
left join branches br on br.id = a.branch_id
left join patients p  on p.id  = a.patient_id
left join doctors  d  on d.id  = a.doctor_id
left join clinics  c  on c.id  = a.clinic_id
left join patient_visits v on v.appointment_id = a.id
left join lateral (
  select i.* from sales_invoices i
   where i.visit_id = v.id and i.status <> 'void'
   order by i.created_at limit 1
) inv on true
left join lateral (
  select f.* from insurance_claim_forms f
   where f.visit_id = v.id
   order by f.created_at desc limit 1
) cf on true;

comment on view v_report_patient_funnel is
  'قمع رحلة المريض: موعد ← استقبال ← زيارة ← توقيع ← فاتورة ← تحصيل ← مطالبة. الفجوة بين مرحلتين متجاورتين هي موضع التسرّب.';

-- ===========================================================================
-- 5) الأذونات
-- ===========================================================================
grant select on
  v_report_revenue, v_report_receipts, v_report_outstanding,
  v_report_discounts_refunds, v_report_credit_debit_notes,
  v_report_claims, v_report_claim_rejections, v_report_preauth_expiring,
  v_report_settlement_variance,
  v_report_appointments, v_report_doctor_productivity, v_report_orders,
  v_report_dispensing, v_report_stock_movements, v_report_patient_funnel
to authenticated;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
declare
  v_missing text[] := '{}';
  v_v text;
  v_no_invoker text[] := '{}';
begin
  foreach v_v in array array[
    'v_report_revenue','v_report_receipts','v_report_outstanding',
    'v_report_discounts_refunds','v_report_credit_debit_notes',
    'v_report_claims','v_report_claim_rejections','v_report_preauth_expiring',
    'v_report_settlement_variance','v_report_appointments',
    'v_report_doctor_productivity','v_report_orders','v_report_dispensing',
    'v_report_stock_movements','v_report_patient_funnel']
  loop
    if not exists (select 1 from information_schema.views
                    where table_schema = 'public' and table_name = v_v) then
      v_missing := v_missing || v_v;
      continue;
    end if;
    -- **التقرير لا يجوز أن يتخطّى العزل**: منظور بلا security_invoker يعرض
    -- بيانات المنشآت الأخرى لمن يملك حقّ القراءة على المنظور وحده.
    if not exists (
      select 1 from pg_class cl
       join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'public' and cl.relname = v_v
         and cl.reloptions::text like '%security_invoker=on%') then
      v_no_invoker := v_no_invoker || v_v;
    end if;
    -- كل تقرير يجب أن يحمل أعمدة المرشّح الموحّد
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_v
                      and column_name = 'organization_id') then
      raise exception 'المنظور % بلا organization_id — لا يمكن عزله', v_v;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_v
                      and column_name = 'report_date') then
      raise exception 'المنظور % بلا report_date — لا يمكن ترشيحه بنطاق تاريخ', v_v;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'مناظير تقارير ناقصة: %', array_to_string(v_missing, ', ');
  end if;
  if array_length(v_no_invoker, 1) > 0 then
    raise exception 'مناظير تقارير بلا security_invoker: %', array_to_string(v_no_invoker, ', ');
  end if;

  if not exists (select 1 from permission_catalog
                  where permission_key = 'reports.financial') then
    raise exception 'صلاحية التقارير المالية غير مضافة';
  end if;
end $$;
