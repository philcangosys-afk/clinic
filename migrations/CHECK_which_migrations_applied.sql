-- ============================================================================
-- فحص: أيّ هجرات نُفِّذت فعلًا على هذه القاعدة؟
-- ============================================================================
-- استعلام قراءة فقط — لا يُنشئ ولا يُعدّل ولا يحذف أيّ شيء. آمن تمامًا على
-- قاعدة الإنتاج. شغّله في محرّر SQL في Supabase قبل أيّ شيء آخر، وابدأ
-- التنفيذ من أول سطر يظهر فيه «ناقصة».
--
-- ملاحظة مهمة: ملفات مجلد `e2e/sql` **اختبارات** وليست هجرات. لا تُنفَّذ على
-- قاعدة الإنتاج إطلاقًا. الملفات التي تُنفَّذ هي ملفات مجلد `migrations` فقط.
-- ============================================================================

with expected(seq, migration_file, subject, sentinel_kind, sentinel) as (
  values
    ( 91, '0091_billing_and_payments.sql',      'الفوترة والمدفوعات',        'class', 'public.cash_register_shifts'),
    ( 92, '0092_vat_and_zatca.sql',             'الضريبة والفوترة الإلكترونية','class', 'public.einvoice_documents'),
    ( 93, '0093_insurance_claims_and_nphies.sql','مطالبات التأمين',          'class', 'public.nphies_messages'),
    ( 94, '0094_reporting.sql',                 'التقارير',                  'class', 'public.v_report_revenue'),
    ( 95, '0095_security_audit_pdpl.sql',       'الأمن والتدقيق',            'class', 'public.medical_record_access_log'),
    ( 96, '0096_packages_and_subscriptions.sql','الباقات والاشتراكات',       'class', 'public.v_package_catalog'),
    ( 97, '0097_purchasing_and_suppliers.sql',  'المشتريات والموردون',       'class', 'public.purchase_orders'),
    ( 98, '0098_advanced_inventory.sql',        'المخزون المتقدّم',          'class', 'public.warehouse_locations'),
    ( 99, '0099_general_ledger.sql',            'الأستاذ العام',             'class', 'public.fiscal_periods'),
    (100, '0100_hr_and_payroll.sql',            'الموارد البشرية والرواتب',  'class', 'public.payroll_runs'),
    (101, '0101_assets_and_maintenance.sql',    'الأصول والصيانة',           'class', 'public.assets'),
    (102, '0102_documents_and_signatures.sql',  'المستندات والتواقيع',       'class', 'public.document_signatures'),
    (103, '0103_notifications.sql',             'التنبيهات الداخلية',        'class', 'public.notification_rules'),
    (104, '0104_patient_portal.sql',            'بوابة المريض',              'class', 'public.patient_portal_accounts'),
    (105, '0105_doctor_workspace.sql',          'مساحة الطبيب والنتائج الحرجة','class','public.critical_result_notifications'),
    (106, '0106_quality.sql',                   'الجودة والحوادث',           'class', 'public.quality_incidents'),
    (107, '0107_organization_policies.sql',     'سياسات المنشأة',            'class', 'public.organization_policies'),
    (108, '0108_users_and_permissions.sql',     'المستخدمون والصلاحيات',     'proc',  'app_set_membership_role'),
    (109, '0109_locale_and_gcc.sql',            'اللغة وإعدادات الخليج',     'class', 'public.organization_locale_settings'),
    (110, '0110_integrations.sql',              'التكاملات',                 'class', 'public.integration_settings'),
    (111, '0111_analytics.sql',                 'التحليلات',                 'class', 'public.v_analytics_daily'),
    (112, '0112_launch_readiness.sql',          'جاهزية الإطلاق',            'proc',  'app_launch_readiness')
)
select
  e.seq                as "#",
  e.migration_file     as "الملف",
  e.subject            as "الموضوع",
  case when (
    case when e.sentinel_kind = 'class'
         then to_regclass(e.sentinel) is not null
         else exists (select 1 from pg_proc p
                        join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = e.sentinel)
    end
  ) then '✅ منفَّذة' else '❌ ناقصة — نفّذها' end as "الحالة"
from expected e
order by e.seq;
