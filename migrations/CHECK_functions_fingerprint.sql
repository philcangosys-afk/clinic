-- ============================================================================
-- فحص: هل دوالّ قاعدتك مطابقة للنسخ المرجعية؟
-- ============================================================================
-- استعلام **قراءة فقط** — لا يُنشئ ولا يُعدّل ولا يحذف شيئًا. آمن تمامًا.
--
-- لماذا؟ بعض الهجرات تُعدّل دوالّ قائمة بدل إعادة كتابتها. هذا يفترض أن نصّ
-- الدالّة في قاعدتك هو النصّ المرجعي نفسه. تبيّن أن قاعدتك متأخّرة عن مجلد
-- الهجرات في بعض الدوالّ (مثلًا `app_audit_log_auto` عندك من نسخة 0025/0043
-- لا 0048)، ولذلك توقّف الجزء 1 برسالة «تغيّر نصّ الدالّة».
--
-- شغّل هذا الاستعلام وأرسل لي الناتج كما هو. عمود «الحالة» يقول كل شيء.
-- ============================================================================

with expected(fn, ref_md5, source_migration) as (
  values
    ('app_after_organization_created',     '1c1865f67990ab500103ddd2ff89a7c4', 'تهيئة المنشأة الجديدة'),
    ('app_audit_log_auto',                 'e0992cda125822c703a756f327ba31da', '0048_audit_coverage.sql'),
    ('app_create_sales_invoice',           'bf036ea8e6a2376f61d5e923ac6a060c', '0052_create_sales_invoice_rpc.sql'),
    ('app_get_patient_timeline',           '9cce4b615886e2235c689a105cb7bede', '0090_journey_integration_fixes.sql'),
    ('app_recalc_invoice_paid_amount',     'e9ff783e5dacdc6d505ef6cf397eca82', 'دورة الفوترة'),
    ('app_seed_default_chart_of_accounts', 'a6bec296854b102798bdc32ed4f29486', '0017_accounting.sql'),
    ('app_validate_package_usage',         'f44b32dda31f11ba013cce629d07a657', '0075_package_usage_guards.sql'),
    ('app_compute_line_tax',               null,                               '0092_vat_and_zatca.sql (تُنشأ لاحقًا)'),
    ('app_create_invoice_from_visit',      null,                               '0057_visit_orders_billing.sql')
)
select
  e.fn                                  as "الدالّة",
  e.source_migration                    as "مصدرها",
  case
    when p.oid is null                       then '⬜ غير موجودة عندك'
    when e.ref_md5 is null                   then '➖ لا نسخة مرجعية — أرسل البصمة: '
                                                  || md5(pg_get_functiondef(p.oid))
    when md5(pg_get_functiondef(p.oid)) = e.ref_md5
                                             then '✅ مطابقة'
    else '❌ مختلفة — بصمتك: ' || md5(pg_get_functiondef(p.oid))
  end                                   as "الحالة"
from expected e
left join pg_proc p
  on p.proname = e.fn
 and p.pronamespace = 'public'::regnamespace
order by e.fn;
