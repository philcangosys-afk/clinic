-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المؤشرات الحيوية — 0139
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/vitals-guards.test.sql
--
-- الرحلة: الاستقبال يطلب قياسًا عامًّا ← يظهر في طابور المختبر ← يُسجَّل
-- فتُحسب كتلة الجسم ويُغلق الطلب ← يصل لوحة الطبيب ← يظهر في ملف المريض.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_p2      uuid;
  v_req     uuid;
  v_vital   uuid;
  v_int     int;
  v_num     numeric;
  v_txt     text;
  v_arr     text[];
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'vit-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار المؤشرات', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع الرئيسي', 'VT-1') returning id into v_branch;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9201, 'د. المؤشرات') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض القياس', '1000000008') returning id into v_patient;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض آخر', '2038475618') returning id into v_p2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الطلب العام ستة قياسات، والسكر ليس منها
  -- ═════════════════════════════════════════════════════════════════════════
  v_req := app_request_vital_signs(v_org, v_patient, v_doctor, 'general',
                                   null, 'routine', 'قبل دخول الطبيب',
                                   null, v_branch);
  select measures into v_arr from vital_sign_requests where id = v_req;
  if array_length(v_arr, 1) <> 6 then
    raise exception 'فشل: الطلب العام % قياسًا لا 6', array_length(v_arr, 1);
  end if;
  if 'glucose' = any(v_arr) then
    raise exception 'فشل: السكر في الطلب العام';
  end if;
  if not ('blood_pressure' = any(v_arr) and 'heart_rate' = any(v_arr)
          and 'temperature' = any(v_arr) and 'respiratory_rate' = any(v_arr)
          and 'weight' = any(v_arr) and 'height' = any(v_arr)) then
    raise exception 'فشل: الطلب العام ينقصه قياس من الستة';
  end if;
  raise notice '✅ ١) الطلب العام = الستة المعتادة بلا سكر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الطلب يظهر في طابور القياس بمعلوماته
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), max(patient_name) into v_int, v_txt
    from v_vital_sign_queue where request_id = v_req;
  if v_int <> 1 then raise exception 'فشل: الطلب لا يظهر في الطابور'; end if;
  if v_txt <> 'مريض القياس' then raise exception 'فشل: اسم المريض لم يصل الطابور'; end if;
  raise notice '✅ ٢) الطلب في طابور القياس باسم المريض وطبيبه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) لا طلبان معلّقان لمريض واحد
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_request_vital_signs(v_org, v_patient, v_doctor, 'general');
    raise exception 'فشل: قُبل طلب ثانٍ والأول معلّق';
  exception when others then
    if sqlerrm not like '%معلّق لهذا المريض%' then raise; end if;
  end;
  raise notice '✅ ٣) لا يُكرَّر الطلب المعلّق لنفس المريض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الطلب الخاص: قياس مجهول مرفوض، وقائمة فارغة مرفوضة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_request_vital_signs(v_org, v_p2, v_doctor, 'custom',
                                    array['blood_pressure','oxygen_saturation']);
    raise exception 'فشل: قُبل قياس غير معروف';
  exception when others then
    if sqlerrm not like '%قياس غير معروف%' then raise; end if;
  end;
  begin
    perform app_request_vital_signs(v_org, v_p2, v_doctor, 'custom', array[]::text[]);
    raise exception 'فشل: قُبل طلب خاص فارغ';
  exception when others then
    if sqlerrm not like '%قياسًا واحدًا على الأقل%' then raise; end if;
  end;
  raise notice '✅ ٤) الطلب الخاص لا يقبل قياسًا مجهولًا ولا قائمة فارغة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) قياس فارغ مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_record_vital_signs(v_org, v_patient, '{}'::jsonb, v_req);
    raise exception 'فشل: سُجّل قياس بلا قيمة واحدة';
  exception when others then
    if sqlerrm not like '%قيمة واحدة على الأقل%' then raise; end if;
  end;
  raise notice '✅ ٥) القياس الفارغ مرفوض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) القيم المستحيلة مرفوضة — والحرجة مقبولة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_record_vital_signs(v_org, v_patient,
      jsonb_build_object('blood_pressure_systolic', '1200'), v_req);
    raise exception 'فشل: قُبل ضغط 1200';
  exception when others then
    if sqlerrm not like '%خارج المدى المعقول%' then raise; end if;
  end;
  begin
    perform app_record_vital_signs(v_org, v_patient,
      jsonb_build_object('blood_pressure_systolic', '110',
                         'blood_pressure_diastolic', '120'), v_req);
    raise exception 'فشل: قُبل انبساطي أعلى من الانقباضي';
  exception when others then
    if sqlerrm not like '%مساويًا أو أعلى%' then raise; end if;
  end;
  raise notice '✅ ٦) الخطأ الكتابي مرفوض، والانبساطي لا يتجاوز الانقباضي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) التسجيل يحسب كتلة الجسم ويُغلق الطلب
  -- ═════════════════════════════════════════════════════════════════════════
  v_vital := app_record_vital_signs(
    v_org, v_patient,
    jsonb_build_object('blood_pressure_systolic', '120',
                       'blood_pressure_diastolic', '78',
                       'heart_rate', '78',
                       'temperature_celsius', '37.6',
                       'respiratory_rate', '18',
                       'height_cm', '175',
                       'weight_kg', '78'),
    v_req, null, null, v_branch);

  select bmi into v_num from patient_vital_signs where id = v_vital;
  if v_num is null then raise exception 'فشل: كتلة الجسم لم تُحسب'; end if;
  if round(v_num, 2) <> 25.47 then
    raise exception 'فشل: كتلة الجسم % لا 25.47', v_num;
  end if;

  select status into v_txt from vital_sign_requests where id = v_req;
  if v_txt <> 'done' then raise exception 'فشل: الطلب لم يُغلق (%)', v_txt; end if;
  select count(*) into v_int from vital_sign_requests
   where id = v_req and vital_sign_id = v_vital and recorded_at is not null;
  if v_int <> 1 then raise exception 'فشل: الطلب لم يُربط بالقياس'; end if;
  raise notice '✅ ٧) القياس يُسجَّل، وكتلة الجسم تُحسب في القاعدة (25.47)، والطلب يُغلق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الطلب المُغلق لا يُسجَّل عليه مرة أخرى
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_record_vital_signs(v_org, v_patient,
      jsonb_build_object('heart_rate', '80'), v_req);
    raise exception 'فشل: سُجّل قياس على طلب مُغلق';
  exception when others then
    if sqlerrm not like '%مُغلق سلفًا%' then raise; end if;
  end;
  raise notice '✅ ٨) الطلب لا يُنفَّذ مرتين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) القياس يصل لوحة الطبيب
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_doctor_vitals_inbox
   where doctor_id = v_doctor and patient_id = v_patient;
  if v_int <> 1 then raise exception 'فشل: القياس لم يصل لوحة الطبيب'; end if;
  select bmi into v_num from v_doctor_vitals_inbox
   where doctor_id = v_doctor and patient_id = v_patient;
  if round(v_num, 2) <> 25.47 then raise exception 'فشل: كتلة الجسم لم تصل الطبيب'; end if;
  raise notice '✅ ٩) القياس وكتلة الجسم يصلان لوحة الطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) ملف المريض يعرف مصدر كل قياس
  -- ═════════════════════════════════════════════════════════════════════════
  select source_label into v_txt from v_patient_vitals where id = v_vital;
  if v_txt <> 'طلب' then raise exception 'فشل: مصدر القياس % لا «طلب»', v_txt; end if;
  raise notice '✅ ١٠) ملف المريض يقول إن مصدر القياس طلبٌ لا زيارة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) قياس مباشر بلا طلب — قياس الاستقبال عند الدخول
  -- ═════════════════════════════════════════════════════════════════════════
  v_vital := app_record_vital_signs(v_org, v_p2,
    jsonb_build_object('heart_rate', '72', 'temperature_celsius', '36.8'),
    null, null, null, v_branch);
  select source_label into v_txt from v_patient_vitals where id = v_vital;
  if v_txt <> 'مباشر' then raise exception 'فشل: مصدر القياس المباشر % لا «مباشر»', v_txt; end if;
  select bmi into v_num from patient_vital_signs where id = v_vital;
  if v_num is not null then
    raise exception 'فشل: كتلة جسم مُحتسبة بلا طول ولا وزن';
  end if;
  raise notice '✅ ١١) القياس المباشر يعمل، وبلا طول ووزن لا تُختلق كتلة جسم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) العزل بين المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_org2 uuid; v_pat2 uuid;
  begin
    insert into organizations (name, organization_type, created_by)
      values ('منشأة غريبة', 'medical_center', v_owner) returning id into v_org2;
    insert into patients (organization_id, name_ar, id_number)
      values (v_org2, 'مريض غريب', '1000000009') returning id into v_pat2;
    begin
      perform app_request_vital_signs(v_org, v_pat2, v_doctor, 'general');
      raise exception 'فشل: قُبل طلب لمريض من منشأة أخرى';
    exception when others then
      if sqlerrm not like '%غير موجود في هذه المنشأة%' then raise; end if;
    end;
    begin
      perform app_record_vital_signs(v_org, v_pat2,
        jsonb_build_object('heart_rate', '70'));
      raise exception 'فشل: سُجّل قياس لمريض من منشأة أخرى';
    exception when others then
      if sqlerrm not like '%غير موجود في هذه المنشأة%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٢) لا طلب ولا تسجيل لمريض من منشأة أخرى';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الإلغاء يُخرج الطلب من الطابور مرّة واحدة
  -- ═════════════════════════════════════════════════════════════════════════
  v_req := app_request_vital_signs(v_org, v_p2, v_doctor, 'custom',
                                   array['glucose'], 'urgent');
  select count(*) into v_int from v_vital_sign_queue where request_id = v_req;
  if v_int <> 1 then raise exception 'فشل: الطلب الخاص لا يظهر في الطابور'; end if;
  perform app_cancel_vital_request(v_req, 'المريض غادر');
  select count(*) into v_int from v_vital_sign_queue where request_id = v_req;
  if v_int <> 0 then raise exception 'فشل: الطلب الملغى ما زال في الطابور'; end if;
  begin
    perform app_cancel_vital_request(v_req, 'مرة ثانية');
    raise exception 'فشل: أُلغي طلب ملغى';
  exception when others then
    if sqlerrm not like '%مُغلق سلفًا%' then raise; end if;
  end;
  raise notice '✅ ١٣) الإلغاء يُخرجه من الطابور ولا يتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الإخطارات داخلية فقط
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from notifications
   where organization_id = v_org and event_key in ('vitals_requested','vitals_ready');
  if v_int = 0 then raise exception 'فشل: لم يُسجَّل أيّ إخطار للمؤشرات'; end if;
  select count(*) into v_int from notification_rules
   where organization_id = v_org
     and event_key in ('vitals_requested','vitals_ready')
     and channel <> 'internal';
  if v_int > 0 then raise exception 'فشل: قناة غير internal'; end if;
  raise notice '✅ ١٤) الإخطارات مسجَّلة وبالقناة internal وحدها';

  raise notice '——— كل فحوص المؤشرات الحيوية نجحت ———';
end $$;

rollback;
