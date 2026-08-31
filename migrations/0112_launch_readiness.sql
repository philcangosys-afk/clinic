-- ============================================================================
-- 0112 — المرحلة 32: جاهزية الإطلاق
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- هذه آخر مراحل الخطّة، ووظيفتها سؤالٌ واحد: **هل هذه المنشأة جاهزة للعمل
-- الحقيقي؟** — ولا يُجاب عنه بقائمة مهام يشطبها المستخدم بيده. قائمةٌ تُشطب
-- يدويًّا تقول ما ادّعاه من شطبها، لا ما في النظام.
--
-- فكل فحصٍ هنا **يُحسب من قاعدة البيانات لحظة السؤال**: لا خانة تُعلَّم، ولا
-- حالة تُحفظ، ولا شيء يبقى «مكتملًا» بعد أن يتغيّر ما بُني عليه. وإن حُذفت
-- قائمة الأسعار غدًا عاد الفحص أحمر من تلقاء نفسه.
--
-- والتصنيف ثلاثي وصريح:
--   • مانع (blocker): العمل به يُنتج بيانات خاطئة أو مخالفة نظامية.
--   • تحذير (warning): يعمل، لكن بنقصٍ سيُكلّف لاحقًا.
--   • معلومة (info): للعلم لا للتوقّف.
-- ============================================================================

-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if to_regclass('public.patient_portal_accounts') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql  (بوابة المريض)';
  end if;
  if to_regclass('public.critical_result_notifications') is null then
    v_missing := v_missing || E'\n  • 0105_doctor_workspace.sql  (مساحة الطبيب والنتائج الحرجة)';
  end if;
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if to_regclass('public.organization_policies') is null then
    v_missing := v_missing || E'\n  • 0107_organization_policies.sql  (سياسات المنشأة)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'app_set_membership_role') then
    v_missing := v_missing || E'\n  • 0108_users_and_permissions.sql  (المستخدمون والصلاحيات)';
  end if;
  if to_regclass('public.organization_locale_settings') is null then
    v_missing := v_missing || E'\n  • 0109_locale_and_gcc.sql  (اللغة وإعدادات الخليج)';
  end if;
  if to_regclass('public.integration_settings') is null then
    v_missing := v_missing || E'\n  • 0110_integrations.sql  (التكاملات)';
  end if;
  if to_regclass('public.v_analytics_daily') is null then
    v_missing := v_missing || E'\n  • 0111_analytics.sql  (التحليلات)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0112_launch_readiness.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

create or replace function app_launch_readiness(p_org uuid)
returns table (
  check_key   text,
  severity    text,
  title       text,
  detail      text,
  item_count  integer,
  is_ok       boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_locale organization_locale_settings;
  v_n      integer;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  v_locale := app_locale(p_org);

  -- ═══════════════════════════════════════════════════════════════════════
  -- الأساسيات التي لا يعمل النظام بدونها
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from branches where organization_id = p_org;
  return query select 'branches', 'blocker', 'فروع المنشأة',
    case when v_n = 0 then 'لا يوجد فرع واحد — كل عملية تشغيلية تُنسب إلى فرع'
         else format('%s فرعًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from clinics
   where organization_id = p_org and not coalesce(is_disabled, false);
  return query select 'clinics', 'blocker', 'العيادات',
    case when v_n = 0 then 'لا عيادة نشطة — لا يمكن حجز موعد ولا فتح زيارة'
         else format('%s عيادة نشطة', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from doctors
   where organization_id = p_org and coalesce(is_enabled, true);
  return query select 'doctors', 'blocker', 'الأطباء',
    case when v_n = 0 then 'لا طبيب مفعَّل'
         else format('%s طبيبًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from items
   where organization_id = p_org and item_type = 'service'
     and not coalesce(is_disabled, false);
  return query select 'services', 'blocker', 'كتالوج الخدمات',
    case when v_n = 0 then 'لا خدمة واحدة — لا فوترة بلا خدمات'
         else format('%s خدمة', v_n) end,
    v_n, v_n > 0;

  -- **قائمة الأسعار الأساسية**: بلا قائمة أساسية تخرج الفواتير بأسعار صفرية
  select count(*) into v_n from price_lists
   where organization_id = p_org and list_kind = 'base'
     and coalesce(is_active, true)
     and (effective_to is null or effective_to >= current_date);
  return query select 'base_price_list', 'blocker', 'قائمة الأسعار الأساسية',
    case when v_n = 0
         then 'لا قائمة أسعار أساسية — الأسعار في الفواتير ستخرج صفرية'
         else 'موجودة' end,
    v_n, v_n > 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- المالية
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from chart_of_accounts where organization_id = p_org;
  return query select 'chart_of_accounts', 'warning', 'دليل الحسابات',
    case when v_n = 0
         then 'لا دليل حسابات — العمليات لن تُرحَّل محاسبيًّا (المحاسبة موديول اختياري)'
         else format('%s حسابًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from fiscal_periods p
    join fiscal_years y on y.id = p.fiscal_year_id
   where p.organization_id = p_org and p.status = 'open'
     and current_date between p.start_date and p.end_date;
  return query select 'open_fiscal_period', 'warning', 'الفترة المالية',
    case when v_n = 0
         then 'لا فترة مالية مفتوحة لتاريخ اليوم — القيود ستُرفض'
         else 'مفتوحة' end,
    v_n, v_n > 0;

  select count(*) into v_n from organization_vat_settings where organization_id = p_org;
  return query select 'vat_settings', 'warning', 'إعدادات الضريبة',
    case when v_n = 0 then 'لم تُضبط بعد'
         else format('مضبوطة (الافتراض لدولتك %s%%)',
                     (select vat_rate from app_country_defaults(v_locale.country_code))) end,
    v_n, v_n > 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- الحوكمة والصلاحيات
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from organization_memberships
   where organization_id = p_org and role_key = 'owner' and is_active;
  return query select 'owners', 'warning', 'مالكو المنشأة',
    case when v_n <= 1
         then 'مالكٌ واحد فقط — إن فقد وصوله لا يبقى من يدير المنشأة'
         else format('%s مالكًا', v_n) end,
    v_n, v_n > 1;

  select count(*) into v_n from v_duty_conflicts where organization_id = p_org;
  return query select 'duty_conflicts', 'warning', 'تعارض المهام',
    case when v_n = 0 then 'لا تعارض'
         else format('%s حالة يملك فيها شخصٌ طرفَي عملية واحدة', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- سلامة المرضى — **الأشدّ**
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from critical_result_notifications
   where organization_id = p_org and acknowledged_at is null;
  return query select 'critical_open', 'blocker', 'قيم حرجة بلا إقرار',
    case when v_n = 0 then 'لا شيء معلّق'
         else format('%s قيمة حرجة لم يُقَرّ بها بعد', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from v_pending_consents
   where organization_id = p_org and consent_status in ('missing','expired')
     and status in ('performed','invoiced','paid','claimed')
     and consent_override_reason is null;
  return query select 'consents_missing', 'blocker', 'إجراءات نُفّذت بلا موافقة',
    case when v_n = 0 then 'لا شيء'
         else format('%s إجراءً منفَّذًا بلا موافقة موقَّعة ولا تجاوز موثَّق', v_n) end,
    v_n, v_n = 0;

  -- تُقيَّد بالجدول: `severity` اسم عمود خارج في هذه الدالّة أيضًا
  select count(*) into v_n from quality_incidents q
   where q.organization_id = p_org and q.status <> 'closed'
     and q.severity in ('major','sentinel');
  return query select 'severe_incidents', 'warning', 'بلاغات سلامة جسيمة مفتوحة',
    case when v_n = 0 then 'لا شيء' else format('%s بلاغًا', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- التشغيل
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from patient_visits
   where organization_id = p_org and status in ('draft','in_progress')
     and visit_date < now() - make_interval(days => (app_org_policy(p_org)).visit_open_alert_days);
  return query select 'stale_visits', 'warning', 'زيارات مفتوحة متأخّرة',
    case when v_n = 0 then 'لا شيء'
         else format('%s زيارة لم تُغلق — لا تُفوتر ولا تدخل مطالبة', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from assets
   where organization_id = p_org and requires_calibration and status <> 'disposed'
     and next_calibration_date is not null and next_calibration_date < current_date;
  return query select 'overdue_calibration', 'blocker', 'أجهزة متأخّرة المعايرة',
    case when v_n = 0 then 'لا شيء'
         else format('%s جهازًا لا يجوز استخدامه حتى تُجدَّد معايرته', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from inventory_lots
   where organization_id = p_org and qty_remaining > 0
     and expiry_date is not null and expiry_date < current_date;
  return query select 'expired_stock', 'blocker', 'دفعات منتهية في المخزون',
    case when v_n = 0 then 'لا شيء'
         else format('%s دفعة منتهية وما زال لها رصيد', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- التكاملات واللغة
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from (
    select 1 from einvoice_documents where organization_id = p_org and failed_permanently
    union all
    select 1 from nphies_messages where organization_id = p_org and failed_permanently
  ) d;
  return query select 'integration_dead', 'warning', 'رسائل تكامل متوقّفة',
    case when v_n = 0 then 'لا شيء'
         else format('%s رسالة استنفدت محاولاتها', v_n) end,
    v_n, v_n = 0;

  if v_locale.data_language = 'en' then
    select coalesce(sum(missing_en), 0) into v_n from v_translation_coverage
     where organization_id = p_org;
    return query select 'translation_gap', 'warning', 'أسماء تنقصها الإنجليزية',
      case when v_n = 0 then 'التغطية كاملة'
           else format('%s اسمًا سيُعرض بالعربية رغم اختيار الإنجليزية', v_n) end,
      v_n, v_n = 0;
  end if;

  if v_locale.enforce_id_validation then
    select count(*) into v_n from patients
     where organization_id = p_org and id_number is not null and trim(id_number) <> ''
       and not app_validate_national_id(v_locale.country_code, id_number);
    return query select 'invalid_ids', 'warning', 'أرقام هوية لا تجتاز التحقّق',
      case when v_n = 0 then 'لا شيء' else format('%s ملفًا', v_n) end,
      v_n, v_n = 0;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- معلومات للعلم
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from organization_features
   where organization_id = p_org and enabled;
  return query select 'features', 'info', 'المزايا المفعَّلة',
    format('%s ميزة', v_n), v_n, true;

  select count(*) into v_n from patients where organization_id = p_org;
  return query select 'patients', 'info', 'الملفات المسجَّلة',
    format('%s ملفًا', v_n), v_n, true;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'app_launch_readiness'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- فحص ذاتي
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_launch_readiness') then
    raise exception 'دالّة جاهزية الإطلاق غير موجودة';
  end if;

  -- **لا جدول حالة**: وجود جدولٍ يحفظ «تمّ» يعني قائمةً تُشطب يدويًّا
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'launch_checklist') then
    raise exception 'ظهر جدول قائمة مهام يدوية — الجاهزية تُحسب لا تُعلَّم';
  end if;
end $$;
