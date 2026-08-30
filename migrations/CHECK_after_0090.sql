-- ---------------------------------------------------------------------------
-- تحقّق بعد تشغيل 0083 → 0090
-- ---------------------------------------------------------------------------
--   انسخه إلى محرّر SQL في Supabase واضغط Run.
--
--   **للقراءة فقط.** لا يكتب حرفًا واحدًا ولا يغيّر شيئًا.
--
--   يجيب سؤالين:
--     ١) هل طُبّقت الهجرات فعلًا وكاملةً؟
--     ٢) هل تسرّبت بيانات اختبار إلى قاعدتك؟
-- ---------------------------------------------------------------------------

do $$
declare
  v_t        text;
  v_missing  text := '';
  v_n        int;
  v_junk_org int := 0;
  v_ok       boolean := true;
begin
  raise notice ' ';
  raise notice '═══════════ حالة الهجرات ═══════════';

  -- ── الجداول التي أضافتها 0083 → 0090
  foreach v_t in array array[
    'lab_test_components','lab_reference_ranges','lab_result_amendments',
    'resource_bookings','exam_template_sections','exam_template_fields',
    'exam_field_options','procedure_codes','inventory_reservations',
    'insurance_networks','insurance_contracts','insurance_coverage_rules'
  ] loop
    if to_regclass('public.' || v_t) is null then
      v_missing := v_missing || v_t || '  ';
    end if;
  end loop;

  -- ── الدوال الأساسية
  foreach v_t in array array[
    'app_set_lab_order_status','app_enter_lab_result','app_set_radiology_order_status',
    'app_book_resource','app_clone_exam_template','app_set_visit_status',
    'app_dispense_prescription','app_cancel_dispensing','app_adjust_stock','app_save_drug',
    'app_insurance_coverage','app_set_claim_form_status','app_resubmit_claim_form',
    'app_active_preauthorization','app_resolve_item_price_v2'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_t) then
      v_missing := v_missing || v_t || '()  ';
    end if;
  end loop;

  if v_missing <> '' then
    v_ok := false;
    raise notice '❌ ناقص: %', v_missing;
    raise notice '   شغّل ZainCare_0083_to_0090.sql مرّة أخرى.';
  else
    raise notice '✅ الجداول الاثنا عشر والدوال الخمس عشرة كلها موجودة';
  end if;

  -- ── ترحيل البيانات القديمة
  select count(*) into v_n from lab_orders where status = 'completed';
  if v_n > 0 then
    v_ok := false;
    raise notice '❌ بقي % طلب مختبر على الحالة القديمة completed', v_n;
  end if;

  select count(*) into v_n from radiology_orders where status in ('completed','reported');
  if v_n > 0 then
    v_ok := false;
    raise notice '❌ بقي % طلب أشعة على حالة قديمة', v_n;
  end if;

  select count(*) into v_n from items
   where medical_service_type in ('lab','package','product');
  if v_n > 0 then
    v_ok := false;
    raise notice '❌ بقي % صنف على نوع خدمة قديم', v_n;
  end if;

  if v_ok then
    raise notice '✅ الترحيل تمّ: لا صفّ باقٍ على حالة قديمة';
  end if;

  -- ── حالة الزيارة الافتراضية (إصلاح 0090)
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'patient_visits'
         and column_name = 'status') like '%planned%' then
    raise notice '✅ الزيارة الجديدة تولد «مخطَّطة» لا «مكتملة» (إصلاح 0090)';
  else
    v_ok := false;
    raise notice '❌ 0090 غير مطبَّقة: الزيارة ما زالت تولد مكتملة';
  end if;

  raise notice ' ';
  raise notice '═══════════ نظافة القاعدة ═══════════';

  -- ── بيانات ملف الاختبار `legacy-data-seed.sql`
  --
  -- هذا الملف **للاختبار وحده** ولا يُشغَّل على قاعدة حقيقية. وهو كتلة
  -- `do` واحدة، فإن فشل في أيّ سطر تراجع كاملًا ولم يُدخل شيئًا. هذا الفحص
  -- يؤكّد ذلك بدل الاكتفاء بالافتراض.
  select count(*) into v_junk_org from organizations
   where name in ('منشأة ببيانات قديمة','منشأة اختبار الصيدلية','منشأة اختبار التأمين',
                  'مجمّع رحلة المريض','منشأة اختبار الزيارات','منشأة صلاحيات التأمين',
                  'منشأة صلاحيات الصيدلية','منشأة أخرى');

  if v_junk_org = 0 then
    raise notice '✅ لا أثر لبيانات اختبار — القاعدة نظيفة';
  else
    raise notice '⚠️  وُجدت % منشأة اختبار. لحذفها شغّل CLEANUP_test_data.sql', v_junk_org;
    for v_t in select name || '  (' || id::text || ')' from organizations
                where name in ('منشأة ببيانات قديمة','منشأة اختبار الصيدلية',
                               'منشأة اختبار التأمين','مجمّع رحلة المريض',
                               'منشأة اختبار الزيارات','منشأة صلاحيات التأمين',
                               'منشأة صلاحيات الصيدلية','منشأة أخرى')
    loop
      raise notice '     • %', v_t;
    end loop;
  end if;

  -- ── منشآتك الحقيقية
  raise notice ' ';
  select count(*) into v_n from organizations;
  raise notice 'إجمالي المنشآت في القاعدة: %  (منها % اختبارية)', v_n, v_junk_org;
  for v_t in select name from organizations order by created_at limit 10 loop
    raise notice '     • %', v_t;
  end loop;

  raise notice ' ';
  if v_ok and v_junk_org = 0 then
    raise notice '═══════════════════════════════════════';
    raise notice '  ✅ كل شيء سليم — تابع الدفع والنشر';
    raise notice '═══════════════════════════════════════';
  end if;
end $$;
