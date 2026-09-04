-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المختبر — 0083
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/lab-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- خمسة عشر فحصًا: الفحص يُنشأ مع خدمته المالية، الخدمة من نوع «مختبر»،
-- المدى المرجعي يختلف بالعمر والجنس، القفز في الحالات مرفوض، النتيجة قبل
-- استلام العينة مرفوضة، التعليم الشاذّ والحرج، سجلّ التعديل يُحفظ، الطلب
-- ينتقل تلقائيًا إلى «صدرت النتيجة»، النتيجة الناقصة تمنع الإصدار، لكل
-- انتقال صلاحيته، والمسلَّم نهائي.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org    uuid;
  v_owner  uuid;
  v_tech   uuid;
  v_child  uuid;
  v_adult  uuid;
  v_test   uuid;
  v_item   uuid;
  v_order  uuid;
  v_line   uuid;
  v_res    jsonb;
  v_low    numeric;
  v_txt    text;
  v_int    int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'lab-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'lab-tech@test.local')
    returning id into v_tech;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار المختبر', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_tech, 'lab_technician', true);
  insert into patients (organization_id, name_ar, gender, birth_date)
    values (v_org, 'طفل', 'male', current_date - interval '3 years') returning id into v_child;
  insert into patients (organization_id, name_ar, gender, birth_date)
    values (v_org, 'بالغ', 'male', current_date - interval '40 years') returning id into v_adult;

  -- ── 1) الفحص يُنشأ مع خدمته المالية
  v_test := app_save_lab_test(v_org, null, jsonb_build_object(
    'name_ar','هيموغلوبين','code','HGB','specimen_type','blood',
    'specimen_container','أنبوب EDTA','unit','g/dL','price','80'));

  select billing_item_id into v_item from lab_tests where id = v_test;
  if v_item is null then
    raise exception 'فشل: الفحص أُنشئ بلا خدمة مالية';
  end if;
  if (select medical_service_type from items where id = v_item) <> 'laboratory' then
    raise exception 'فشل: الخدمة ليست من نوع مختبر';
  end if;
  raise notice '✅ الفحص يُنشأ مع خدمته المالية من نوع «مختبر»';

  -- ── 2) خدمة من نوع آخر مرفوضة
  perform app_save_service(v_org, null, jsonb_build_object(
    'name_ar','كشف','code','CONS-1','medical_service_type','consultation','price','100'));
  begin
    perform app_save_lab_test(v_org, null, jsonb_build_object(
      'name_ar','فحص خاطئ','code','BAD2','specimen_type','blood',
      'billing_item_id', (select id from items where code = 'CONS-1')));
    raise exception 'فشل: قُبلت خدمة ليست من نوع مختبر';
  exception when others then
    if sqlerrm not like '%من نوع «مختبر»%' then raise; end if;
    raise notice '✅ الخدمة المرتبطة يجب أن تكون من نوع مختبر';
  end;

  -- ── 3) المدى المرجعي بالعمر والجنس
  insert into lab_reference_ranges (organization_id, lab_test_id, gender, min_age_days, max_age_days,
                                    low_value, high_value, critical_low, critical_high, unit)
    values (v_org, v_test, 'any',  0, 4380, 11.0, 14.0, 7.0, 20.0, 'g/dL'),
           (v_org, v_test, 'male', 4381, null, 13.5, 17.5, 8.0, 22.0, 'g/dL');

  select low_value into v_low from app_lab_reference_for_patient(v_test, v_child);
  if v_low <> 11.0 then raise exception 'فشل: مدى الطفل % لا 11', v_low; end if;
  select low_value into v_low from app_lab_reference_for_patient(v_test, v_adult);
  if v_low <> 13.5 then raise exception 'فشل: مدى البالغ % لا 13.5', v_low; end if;
  raise notice '✅ المدى المرجعي يختلف بالعمر والجنس';

  -- ── 4) الطلب ودورته
  insert into lab_orders (organization_id, patient_id, status)
    values (v_org, v_adult, 'ordered') returning id into v_order;
  insert into lab_order_items (lab_order_id, lab_test_id, organization_id)
    values (v_order, v_test, v_org) returning id into v_line;

  begin
    perform app_set_lab_order_status(v_order, 'verified');
    raise exception 'فشل: قُبل القفز من ordered إلى verified';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
    raise notice '✅ القفز في حالات الطلب مرفوض';
  end;

  -- ── 5) نتيجة قبل استلام العينة مرفوضة
  begin
    perform app_enter_lab_result(v_line, '15');
    raise exception 'فشل: قُبلت نتيجة قبل استلام العينة';
  exception when others then
    if sqlerrm not like '%والطلب في حالة%' then raise; end if;
    raise notice '✅ لا نتيجة قبل استلام العينة';
  end;

  perform app_set_lab_order_status(v_order, 'specimen_collected');
  perform app_set_lab_order_status(v_order, 'received');

  -- ── 6) التعليم: طبيعي، شاذّ، حرج
  --
  -- هذا الفحص وُضع بعد عيبٍ حقيقي: `v_ref is not null` في plpgsql تكون
  -- صادقة فقط إذا كان **كل** حقل غير فارغ، ومدى بلا `text_reference` يجعلها
  -- كاذبة — فلم تكن أي نتيجة تُعلَّم شاذة ولا حرجة إطلاقًا.
  v_res := app_enter_lab_result(v_line, '15');
  if (v_res ->> 'is_abnormal')::boolean then
    raise exception 'فشل: 15 داخل المدى وعُلِّمت شاذة';
  end if;

  v_res := app_enter_lab_result(v_line, '12', null, 'إعادة');
  if not (v_res ->> 'is_abnormal')::boolean or (v_res ->> 'is_critical')::boolean then
    raise exception 'فشل: 12 شاذة غير حرجة (%)', v_res;
  end if;

  v_res := app_enter_lab_result(v_line, '6.5', null, 'إعادة');
  if not (v_res ->> 'is_critical')::boolean then
    raise exception 'فشل: 6.5 دون الحدّ الحرج ولم تُعلَّم (%)', v_res;
  end if;
  raise notice '✅ التعليم الشاذّ والحرج';

  -- ── 7) سجلّ التعديل
  select count(*) into v_int from lab_result_amendments where lab_order_item_id = v_line;
  if v_int <> 2 then
    raise exception 'فشل: توقّعنا تعديلين مسجَّلين فجاء %', v_int;
  end if;
  select previous_value into v_txt from lab_result_amendments
   where lab_order_item_id = v_line order by amended_at limit 1;
  if v_txt <> '15' then
    raise exception 'فشل: القيمة السابقة لم تُحفظ (%)', v_txt;
  end if;
  raise notice '✅ سجلّ تعديل النتائج يحفظ النسخة السابقة';

  -- ── 8) الانتقال التلقائي إلى «صدرت النتيجة»
  if (select status from lab_orders where id = v_order) <> 'resulted' then
    raise exception 'فشل: الطلب لم ينتقل تلقائيًا إلى resulted';
  end if;
  raise notice '✅ اكتمال النتائج ينقل الطلب تلقائيًا';

  -- ── 9) القيمة الحرجة تُنشئ بلاغًا مفتوحًا بانتظار إقرار الطبيب (المرحلة 25)
  --     المنظور القديم `v_lab_critical_results` كان يعرضها بلا حالة إقرار،
  --     فحلّ محلّه `v_critical_results` الذي يحمل حالتها.
  if not exists (select 1 from v_critical_results
                  where source_order_id = v_order and source_kind = 'lab' and is_open) then
    raise exception 'فشل: القيمة الحرجة لا تظهر كبلاغ مفتوح';
  end if;
  raise notice '✅ القيم الحرجة تُنشئ بلاغًا مفتوحًا بانتظار الإقرار';

  -- ── 10) سلسلة الاعتماد
  perform app_set_lab_order_status(v_order, 'verified');
  perform app_set_lab_order_status(v_order, 'approved');
  perform app_set_lab_order_status(v_order, 'delivered');
  if (select approved_by from lab_orders where id = v_order) is null then
    raise exception 'فشل: المعتمِد لم يُسجَّل';
  end if;
  raise notice '✅ سلسلة المراجعة والاعتماد والتسليم';

  -- ── 11) المسلَّم نهائي
  begin
    perform app_set_lab_order_status(v_order, 'resulted');
    raise exception 'فشل: قُبل انتقال من delivered';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
    raise notice '✅ الطلب المسلَّم نهائي';
  end;

  -- ── 12) النتيجة الناقصة تمنع الإصدار
  insert into lab_orders (organization_id, patient_id, status)
    values (v_org, v_adult, 'received') returning id into v_order;
  insert into lab_order_items (lab_order_id, lab_test_id, organization_id)
    values (v_order, v_test, v_org);
  perform app_set_lab_order_status(v_order, 'in_progress');
  begin
    perform app_set_lab_order_status(v_order, 'resulted');
    raise exception 'فشل: صدرت نتيجة وبعض الفحوص فارغة';
  exception when others then
    if sqlerrm not like '%بلا نتيجة%' then raise; end if;
    raise notice '✅ النتيجة الناقصة تمنع الإصدار';
  end;

  -- ── 13) الإلغاء والرفض يحتاجان سببًا
  begin
    perform app_set_lab_order_status(v_order, 'rejected');
    raise exception 'فشل: قُبل رفض بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ الرفض يحتاج سببًا';
  end;

  -- ── 14) لكل انتقال صلاحيته
  perform set_config('request.jwt.claim.sub', v_tech::text, true);
  insert into lab_orders (organization_id, patient_id, status)
    values (v_org, v_adult, 'ordered') returning id into v_order;
  insert into lab_order_items (lab_order_id, lab_test_id, organization_id)
    values (v_order, v_test, v_org) returning id into v_line;

  perform app_set_lab_order_status(v_order, 'specimen_collected');
  perform app_set_lab_order_status(v_order, 'received');
  perform app_enter_lab_result(v_line, '14');

  begin
    perform app_set_lab_order_status(v_order, 'verified');
    raise exception 'فشل: فني المختبر راجع النتيجة';
  exception when others then
    if sqlerrm not like '%lab.verify%' then raise; end if;
    raise notice '✅ المراجعة تحتاج صلاحيتها (الفني يسحب ويُدخل ولا يراجع)';
  end;

  raise notice '——— كل فحوص المختبر نجحت ———';
end $$;

rollback;
