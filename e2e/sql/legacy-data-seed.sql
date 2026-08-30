-- ---------------------------------------------------------------------------
-- بذرة بيانات قديمة — لاختبار الترحيل لا لاختبار المخطط
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/legacy-data-seed.sql
--
-- **سبب وجود هذا الملف**: كل أدلّتي السابقة تُشغَّل على قاعدة **فارغة**، فكل
-- `update ... where status = 'X'` فيها لا يطابق صفًا واحدًا ويمرّ صامتًا.
-- والنتيجة أن ترتيب «إسقاط القيد ثم الترحيل» لم يُختبَر إطلاقًا — حتى فشل
-- على قاعدة المستخدم الحقيقية بـ:
--
--     ERROR: new row for relation "lab_orders" violates check constraint
--            "lab_orders_status_check"
--
-- هذا الملف يزرع صفوفًا بالحالات **القديمة** قبل تشغيل الهجرات، فيصير
-- الترحيل مسارًا حيًّا يُختبَر لا فرعًا ميتًا يُتخطّى.
--
-- يُشغَّل على قاعدة عند 0082، ثم تُشغَّل الهجرات 0083 → 0090 فوقه.
-- ---------------------------------------------------------------------------

-- ###########################################################################
--  ⛔ لا تُشغّل هذا الملف على قاعدة إنتاج ⛔
--
--  ينشئ منشأة ومريضًا وطبيبًا وأصنافًا وطلباتٍ **وهمية** لاختبار الترحيل.
--  مكانه قاعدة اختبار محلّية عند 0082 قبل تشغيل 0083 → 0090، لا قاعدتك.
--
--  الحارس أدناه يرفض التشغيل إن وجد أيّ منشأة فيها مرضى — أي إن كانت
--  القاعدة مستعملة فعلًا.
-- ###########################################################################

do $guard$
begin
  if exists (select 1 from patients limit 1) then
    raise exception using
      message = 'مرفوض: هذه قاعدة فيها مرضى — ملف البذرة للاختبار وحده',
      hint    = 'شغّله على قاعدة اختبار فارغة عند 0082، لا على قاعدتك.';
  end if;
  if to_regclass('public.inventory_reservations') is not null then
    raise exception using
      message = 'مرفوض: الهجرات 0083 → 0090 مطبَّقة بالفعل على هذه القاعدة',
      hint    = 'البذرة تُزرع **قبل** الهجرات لا بعدها.';
  end if;
end $guard$;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_patient uuid;
  v_doctor  uuid;
  v_item    uuid;
  v_test    uuid;
  v_exam    uuid;
  v_visit   uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'legacy@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة ببيانات قديمة', 'clinic', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into patients (organization_id, name_ar) values (v_org, 'مريض قديم')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب قديم')
    returning id into v_doctor;

  -- ── صنف بنوع الخدمة القديم `lab` (رُحِّل إلى `laboratory` في 0083)
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'LEG-LAB', 'تحليل قديم', 100, 'lab') returning id into v_item;

  -- ── وصنفان بنوعين حُذفا في 0083
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'product', 'LEG-PKG', 'باقة قديمة', 500, 'package');
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'product', 'LEG-PRD', 'منتج قديم', 50, 'product');

  insert into lab_tests (organization_id, code, name_ar, billing_item_id)
    values (v_org, 'LEG-CBC', 'صورة دم قديمة', v_item) returning id into v_test;
  insert into radiology_exams (organization_id, code, name_ar, modality)
    values (v_org, 'LEG-CXR', 'أشعة قديمة', 'xray') returning id into v_exam;

  insert into patient_visits (organization_id, patient_id, doctor_id, visit_date)
    values (v_org, v_patient, v_doctor, current_date - 10) returning id into v_visit;

  -- ── طلبات مختبر بالحالة القديمة `completed` — هذه هي التي كسرت الترحيل
  insert into lab_orders (organization_id, patient_id, visit_id, ordering_doctor_id, status)
    values (v_org, v_patient, v_visit, v_doctor, 'completed'),
           (v_org, v_patient, v_visit, v_doctor, 'ordered'),
           (v_org, v_patient, v_visit, v_doctor, 'cancelled');

  -- ── وطلبات أشعة بالحالتين القديمتين `completed` و`reported`
  insert into radiology_orders (organization_id, patient_id, visit_id, ordering_doctor_id, status)
    values (v_org, v_patient, v_visit, v_doctor, 'completed'),
           (v_org, v_patient, v_visit, v_doctor, 'reported'),
           (v_org, v_patient, v_visit, v_doctor, 'ordered');

  raise notice '✔ زُرعت بيانات قديمة: صنف lab، وصنفا package/product،';
  raise notice '  و٣ طلبات مختبر منها completed، و٣ طلبات أشعة منها completed و reported';
end $$;
