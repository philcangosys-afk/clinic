-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- رحلة المريض الكاملة — المرحلة العاشرة
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/patient-journey.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **ما الفرق بين هذا الملف والأدلّة العشرة قبله؟**
--
-- تلك تفحص كل وحدة على حدة: المختبر وحده، الصيدلية وحدها، التأمين وحده. وكل
-- واحدة تبني بياناتها بنفسها في أنظف صورة ممكنة. أمّا هذا فيمشي في الرحلة
-- **كما يمشي فيها المريض**: مريضٌ واحد، وموعدٌ واحد، وزيارةٌ واحدة تمرّ من
-- الحجز إلى الإغلاق المالي — لأن أخطاء التكامل لا تظهر إلّا حين تُسلَّم مخرجات
-- مرحلة إلى مدخلات التالية.
--
-- الرحلة: فرع ← عيادة ← طبيب ← خدمة ← فحص الوقت والمورد ← تأكيد ← وصول ←
-- رقم دور ← نداء ← بدء الزيارة ← فحص وتشخيص ← أوامر مختبر وأشعة ودواء ←
-- تنفيذها ← فاتورة ← ضريبة ← تأمين ← إكمال الزيارة ← إغلاقها.
--
-- ثم اثنتا عشرة حالة حديّة، كلٌّ منها كان يمكن أن يمرّ صامتًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org       uuid;
  v_owner     uuid;
  v_recep_u   uuid;
  v_doc_u     uuid;
  v_branch    uuid;
  v_branch2   uuid;
  v_dept      uuid;
  v_clinic    uuid;
  v_doctor    uuid;
  v_patient   uuid;
  v_consult   uuid;
  v_lab_item  uuid;
  v_rad_item  uuid;
  v_drug      uuid;
  v_lab_test  uuid;
  v_rad_exam  uuid;
  v_wh        uuid;
  v_lot       uuid;
  v_resource  uuid;
  v_company   uuid;
  v_policy    uuid;
  v_member    uuid;
  v_contract  uuid;
  v_list      uuid;
  v_appt      uuid;
  v_visit     uuid;
  v_lab_order uuid;
  v_rad_order uuid;
  v_presc     uuid;
  v_presc_it  uuid;
  v_invoice   uuid;
  v_icd       uuid;
  v_slot      timestamptz;
  v_rec       record;
  v_num       numeric;
  v_int       int;
  v_txt       text;
  v_json      jsonb;
begin
  -- ═══════════════════════════════════════════════════════════════════════
  -- المشهد: منشأة كاملة
  -- ═══════════════════════════════════════════════════════════════════════
  insert into auth.users (id, email) values (gen_random_uuid(), 'jr-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'jr-recep@test.local')
    returning id into v_recep_u;
  insert into auth.users (id, email) values (gen_random_uuid(), 'jr-doctor@test.local')
    returning id into v_doc_u;
  insert into organizations (name, organization_type, created_by)
    values ('مجمّع رحلة المريض', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep_u, 'receptionist', true), (v_org, v_doc_u, 'doctor', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into branches (organization_id, name) values (v_org, 'فرع آخر')
    returning id into v_branch2;

  v_dept   := app_save_department(v_org, null, jsonb_build_object(
                'code','DEP-1','name_ar','قسم الباطنة','department_type','clinical'));
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','CL-1','name','عيادة الباطنة ١','branch_id', v_branch,
                'department_id', v_dept, 'default_visit_duration', 20));

  insert into doctors (organization_id, name_ar, user_id, is_enabled)
    values (v_org, 'د. سالم', v_doc_u, true) returning id into v_doctor;
  insert into doctor_clinics (organization_id, doctor_id, clinic_id, is_primary)
    values (v_org, v_doctor, v_clinic, true);
  insert into doctor_schedules (organization_id, doctor_id, clinic_id, branch_id,
                                day_of_week, start_time, end_time, slot_duration_minutes, capacity)
  select v_org, v_doctor, v_clinic, v_branch, d, '08:00', '16:00', 20, 1
    from generate_series(1, 7) d;

  insert into patients (organization_id, name_ar, birth_date, gender)
    values (v_org, 'عبدالله المريض', current_date - interval '35 years', 'male')
    returning id into v_patient;

  -- الخدمات
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type,
                     duration_minutes, vat_rate_override)
    values (v_org, 'service', 'CONS', 'كشف باطنة', 300, 'consultation', 20, 15)
    returning id into v_consult;

  v_lab_item := app_save_lab_test(v_org, null, jsonb_build_object(
                  'code','CBC','name_ar','صورة دم كاملة','price', 120,
                  'specimen_type','blood'));
  select id into v_lab_test from lab_tests
   where organization_id = v_org and code = 'CBC';
  select billing_item_id into v_lab_item from lab_tests where id = v_lab_test;

  insert into lab_reference_ranges (organization_id, lab_test_id, gender,
                                    min_age_days, max_age_days,
                                    low_value, high_value, critical_low, critical_high)
    values (v_org, v_lab_test, 'any', 0, 40000, 4, 11, 2, 20);

  insert into resources (organization_id, branch_id, code, name_ar, resource_type, is_active)
    values (v_org, v_branch, 'XR-1', 'جهاز أشعة', 'device', true) returning id into v_resource;

  v_rad_item := app_save_radiology_exam(v_org, null, jsonb_build_object(
                  'code','CXR','name_ar','أشعة صدر','price', 250, 'modality','xray'));
  select id into v_rad_exam from radiology_exams where organization_id = v_org and code = 'CXR';
  select billing_item_id into v_rad_item from radiology_exams where id = v_rad_exam;

  -- الصيدلية
  insert into warehouses (organization_id, branch_id, code, name)
    values (v_org, v_branch, 'WH', 'صيدلية الفرع') returning id into v_wh;
  v_drug := app_save_drug(v_org, null, jsonb_build_object(
              'code','AMOX','name_ar','أموكسيسيلين ٥٠٠','price', 25, 'reorder_level', 10));
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              qty_remaining, qty_received, unit_cost, selling_price, expiry_date)
    values (v_org, v_wh, v_drug, 'L1', 100, 100, 10, 25, current_date + 365)
    returning id into v_lot;

  -- التأمين
  insert into insurance_companies (organization_id, name_ar) values (v_org, 'بوبا')
    returning id into v_company;
  insert into insurance_policies (organization_id, company_id, policy_name, policy_number,
                                  default_copay_percent, annual_limit)
    values (v_org, v_company, 'بوليصة الشركة', 'P-1', 20, 10000) returning id into v_policy;
  insert into patient_insurance_memberships (organization_id, patient_id, policy_id,
                                             membership_number, relation, eligibility_status,
                                             expiry_date, is_active)
    values (v_org, v_patient, v_policy, 'MB-1', 'self', 'eligible', current_date + 300, true)
    returning id into v_member;

  insert into price_lists (organization_id, name, list_kind, insurance_company_id,
                           effective_from, is_active, priority)
    values (v_org, 'أسعار بوبا', 'insurance', v_company, current_date - 30, true, 5)
    returning id into v_list;
  insert into price_list_items (organization_id, price_list_id, item_id, price, effective_from)
    values (v_org, v_list, v_consult, 250, current_date - 30);

  insert into insurance_contracts (organization_id, company_id, name_ar, price_list_id,
                                   default_copay_percent, effective_from, status, created_by)
    values (v_org, v_company, 'عقد بوبا ٢٠٢٦', v_list, 10, current_date - 30, 'active', v_owner)
    returning id into v_contract;

  raise notice '— المشهد جاهز: فرع وقسم وعيادة وطبيب وجدول وخدمات ومخزون وتأمين —';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١) سلسلة الحجز: فرع ← عيادة ← طبيب ← خدمة
  -- ═══════════════════════════════════════════════════════════════════════
  if not exists (select 1 from app_clinics_for_branch(v_org, v_branch) where id = v_clinic) then
    raise exception 'فشل: العيادة لا تظهر تحت فرعها';
  end if;
  if exists (select 1 from app_clinics_for_branch(v_org, v_branch2) where id = v_clinic) then
    raise exception 'فشل: العيادة تظهر تحت فرع غير فرعها';
  end if;
  if not exists (select 1 from app_doctors_for_clinic(v_org, v_clinic) where id = v_doctor) then
    raise exception 'فشل: الطبيب لا يظهر تحت عيادته';
  end if;
  raise notice '✅ ١) سلسلة فرع ← عيادة ← طبيب مترابطة ومعزولة';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٢) فتحة زمنية متاحة فعلًا
  -- ═══════════════════════════════════════════════════════════════════════
  select slot_start into v_slot
    from app_doctor_available_slots(v_doctor, current_date + 1, v_clinic, 20)
   where is_free
   order by slot_start
   limit 1;
  if v_slot is null then
    raise exception 'فشل: لا فتحة متاحة رغم جدول دوام كامل';
  end if;
  raise notice '✅ ٢) الفتحات تُشتقّ من جدول الطبيب لا من فراغ';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٣) الحجز، ومنع الازدواج على الفتحة نفسها
  -- ═══════════════════════════════════════════════════════════════════════
  insert into appointments (organization_id, patient_id, doctor_id, clinic_id, branch_id,
                            scheduled_start, scheduled_end, status, item_id)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch,
            v_slot, v_slot + interval '20 minutes', 'scheduled', v_consult)
    returning id into v_appt;

  begin
    insert into appointments (organization_id, patient_id, doctor_id, clinic_id, branch_id,
                              scheduled_start, scheduled_end, status)
      values (v_org, v_patient, v_doctor, v_clinic, v_branch,
              v_slot + interval '5 minutes', v_slot + interval '25 minutes', 'scheduled');
    raise exception 'فشل: حُجز موعدان متداخلان لنفس الطبيب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    raise notice '✅ ٣) الحجز يتمّ، والتداخل على الطبيب نفسه مرفوض';
  end;

  -- الفتحة صارت مشغولة في المنظور
  if exists (select 1 from app_doctor_available_slots(v_doctor, v_slot::date, v_clinic, 20)
              where slot_start = v_slot and is_free) then
    raise exception 'فشل: الفتحة المحجوزة ما زالت تظهر متاحة';
  end if;
  raise notice '✅ ٤) الفتحة المحجوزة تختفي من المتاح فورًا';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٥) التأكيد ← الوصول ← رقم الدور ← النداء ← بدء الزيارة
  -- ═══════════════════════════════════════════════════════════════════════
  perform app_reception_transition(v_appt, 'confirm');
  select * into v_rec from app_reception_transition(v_appt, 'arrive');
  select queue_number into v_int from appointments where id = v_appt;
  if v_int is null then
    raise exception 'فشل: لم يُمنح رقم دور عند الوصول';
  end if;

  -- تسجيل وصولٍ ثانٍ مرفوض أصلًا — والرقم لا يتغيّر
  begin
    perform app_reception_transition(v_appt, 'arrive');
    raise exception 'فشل: قُبل تسجيل وصول مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
  end;
  if (select queue_number from appointments where id = v_appt) <> v_int then
    raise exception 'فشل: تغيّر رقم الدور';
  end if;

  perform app_reception_transition(v_appt, 'call');
  select * into v_rec from app_reception_transition(v_appt, 'start');
  v_visit := v_rec.visit_id;
  if v_visit is null then
    raise exception 'فشل: بدء الزيارة لم يُنشئ زيارة';
  end if;
  raise notice '✅ ٥) تأكيد ← وصول برقم دور ثابت ← نداء ← زيارة أُنشئت';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٦) الزيارة: فحص وتشخيص وأوامر
  -- ═══════════════════════════════════════════════════════════════════════
  select id into v_icd from icd10_codes limit 1;

  -- **الوصلة التي كانت مكسورة**: قبل 0090 كانت الزيارة تُولد `completed`
  -- بحكم القيمة الافتراضية، فينقل الاستقبال الموعد إلى «جارٍ» وتبقى الزيارة
  -- «مكتملة» — ولا يستطيع الطبيب بدءها لأن الانتقال يُعدّ إعادة فتح.
  if (select status from patient_visits where id = v_visit) <> 'in_progress' then
    raise exception 'فشل: الزيارة المُنشأة من الاستقبال حالتها % لا «جارية»',
      (select status from patient_visits where id = v_visit);
  end if;
  if (select started_at from patient_visits where id = v_visit) is null then
    raise exception 'فشل: وقت بدء الزيارة لم يُختم من الاستقبال';
  end if;

  update patient_visits set main_complaint = 'حرارة وسعال منذ ثلاثة أيام'
   where id = v_visit;

  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_consult, 1, 250, 'performed');

  -- أمر مختبر
  insert into lab_orders (organization_id, patient_id, visit_id, ordering_doctor_id, branch_id, status)
    values (v_org, v_patient, v_visit, v_doctor, v_branch, 'ordered')
    returning id into v_lab_order;
  insert into lab_order_items (organization_id, lab_order_id, lab_test_id)
    values (v_org, v_lab_order, v_lab_test);
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_lab_item, 1, 120, 'ordered');

  -- أمر أشعة
  insert into radiology_orders (organization_id, patient_id, visit_id, ordering_doctor_id,
                                branch_id, status)
    values (v_org, v_patient, v_visit, v_doctor, v_branch, 'ordered')
    returning id into v_rad_order;
  insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_rad_order, v_rad_exam);
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_rad_item, 1, 250, 'ordered');

  -- وصفة
  insert into prescriptions (organization_id, patient_id, visit_id, doctor_id, clinic_id,
                             branch_id, status, created_by)
    values (v_org, v_patient, v_visit, v_doctor, v_clinic, v_branch, 'issued', v_owner)
    returning id into v_presc;
  insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed,
                                  dosage_instructions, frequency, duration_days)
    values (v_presc, v_drug, 21, 'قرص بعد الأكل', 'ثلاث مرات يوميًا', 7)
    returning id into v_presc_it;

  raise notice '✅ ٦) الزيارة تولد «جارية» من الاستقبال، وتحمل شكوى وأوامر ووصفة';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٧) المختبر: سحب ← نتيجة ← اعتماد
  -- ═══════════════════════════════════════════════════════════════════════
  perform app_set_lab_order_status(v_lab_order, 'specimen_collected');
  perform app_set_lab_order_status(v_lab_order, 'received');
  perform app_set_lab_order_status(v_lab_order, 'in_progress');

  perform app_enter_lab_result((select id from lab_order_items where lab_order_id = v_lab_order limit 1), '8', 8);
  perform app_set_lab_order_status(v_lab_order, 'verified');
  perform app_set_lab_order_status(v_lab_order, 'approved');
  perform app_set_lab_order_status(v_lab_order, 'delivered');
  if (select status from lab_orders where id = v_lab_order) <> 'delivered' then
    raise exception 'فشل: سلسلة المختبر لم تكتمل';
  end if;
  raise notice '✅ ٧) المختبر: سحب ← تنفيذ ← نتيجة ← مراجعة ← اعتماد';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٨) الأشعة: جدولة تحجز الجهاز ← تصوير ← تقرير ← اعتماد
  -- ═══════════════════════════════════════════════════════════════════════
  perform app_schedule_radiology_order(v_rad_order, v_resource, now() + interval '1 hour', 30);
  if (select booking_id from radiology_orders where id = v_rad_order) is null then
    raise exception 'فشل: الجدولة لم تحجز الجهاز';
  end if;
  perform app_set_radiology_order_status(v_rad_order, 'arrived');
  perform app_set_radiology_order_status(v_rad_order, 'in_progress');
  perform app_set_radiology_order_status(v_rad_order, 'images_ready');
  update radiology_order_items set findings = 'رئتان سليمتان', impression = 'لا خلل ظاهر'
   where radiology_order_id = v_rad_order;
  perform app_set_radiology_order_status(v_rad_order, 'reporting');
  perform app_set_radiology_order_status(v_rad_order, 'verified');
  raise notice '✅ ٨) الأشعة: جدولة تحجز الجهاز ← تصوير ← تقرير ← اعتماد';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ٩) الصيدلية: حجز ← صرف ← نقص المخزون
  -- ═══════════════════════════════════════════════════════════════════════
  v_json := app_reserve_prescription(v_presc, v_wh);
  if (select reserved_quantity from inventory_lots where id = v_lot) <> 21 then
    raise exception 'فشل: الحجز لم يُسجَّل على الدفعة';
  end if;

  perform app_dispense_prescription(v_presc, v_wh,
    jsonb_build_array(jsonb_build_object('prescription_item_id', v_presc_it, 'qty', 21)));

  if (select qty_remaining from inventory_lots where id = v_lot) <> 79 then
    raise exception 'فشل: المخزون لم ينقص بالصرف (%)',
      (select qty_remaining from inventory_lots where id = v_lot);
  end if;
  if (select status from prescriptions where id = v_presc) <> 'dispensed' then
    raise exception 'فشل: الوصفة لم تُعلَّم مصروفة';
  end if;
  raise notice '✅ ٩) الصيدلية: حجز ← صرف FEFO ← نقص فعليّ في الرصيد';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١٠) التغطية قبل الفوترة
  -- ═══════════════════════════════════════════════════════════════════════
  select price into v_num
    from app_resolve_item_price_v2(v_org, v_consult, v_branch, v_company, null, current_date);
  if v_num <> 250 then
    raise exception 'فشل: سعر الكشف لمريض بوبا % لا ٢٥٠ من قائمة العقد', v_num;
  end if;

  v_json := app_insurance_coverage(v_member, v_consult, 250);
  if not (v_json->>'covered')::boolean then
    raise exception 'فشل: الكشف غير مغطّى (%)', v_json->'blocks';
  end if;
  if (v_json->>'copay_percent')::numeric <> 10 then
    raise exception 'فشل: نسبة التحمّل % لا ١٠٪ من العقد', v_json->>'copay_percent';
  end if;
  if (v_json->>'patient_share')::numeric <> 25 then
    raise exception 'فشل: حصّة المريض % لا ٢٥', v_json->>'patient_share';
  end if;
  raise notice '✅ ١٠) التسعير من العقد، والتحمّل من العقد، والحصّتان محسوبتان قبل الفوترة';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١١) الفاتورة: خدمات الزيارة، ضريبة، تأمين
  -- ═══════════════════════════════════════════════════════════════════════
  select app_create_sales_invoice(
    p_organization_id := v_org,
    p_items := (
      select jsonb_agg(jsonb_build_object(
        'item_id', s.item_id, 'qty', s.qty, 'price', s.unit_price,
        'visit_service_id', s.id))
        from patient_visit_services s where s.visit_id = v_visit),
    p_patient_id := v_patient,
    p_visit_id := v_visit,
    p_appointment_id := v_appt,
    p_doctor_id := v_doctor,
    p_clinic_id := v_clinic,
    p_is_insurance := true,
    p_insurance := jsonb_build_object(
      'company_name', 'بوبا', 'policy_number', 'P-1',
      'membership_number', 'MB-1', 'copay_percent', 10),
    p_paid_amount := 0
  ) into v_invoice;

  if v_invoice is null then raise exception 'فشل: لم تُصدَر الفاتورة'; end if;

  select count(*) into v_int from sales_invoice_items where invoice_id = v_invoice;
  if v_int <> 3 then
    raise exception 'فشل: الفاتورة تحمل % بندًا لا ثلاثة', v_int;
  end if;

  -- الضريبة حُسبت على الكشف (١٥٪ تجاوز على الصنف)
  select vat_amount into v_num from sales_invoice_items
   where invoice_id = v_invoice and item_id = v_consult;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: لم تُحتسب ضريبة على بند نسبته ١٥٪';
  end if;

  -- خدمات الزيارة انتقلت إلى «مفوترة»
  select count(*) into v_int from patient_visit_services
   where visit_id = v_visit and status in ('invoiced','paid');
  if v_int <> 3 then
    raise exception 'فشل: % خدمة فقط انتقلت إلى مفوترة', v_int;
  end if;
  raise notice '✅ ١١) الفاتورة تحمل خدمات الزيارة الثلاث، وتحسب الضريبة، وتنقل حالة الخدمات';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١٢) الإغلاق: لا يُقبل قبل السداد؟ بل لا يُقبل قبل الفوترة — وقد فُوترت
  -- ═══════════════════════════════════════════════════════════════════════
  perform app_set_visit_status(v_visit, 'completed');
  perform app_set_visit_status(v_visit, 'signed');
  perform app_set_visit_status(v_visit, 'closed');
  if (select status from patient_visits where id = v_visit) <> 'closed' then
    raise exception 'فشل: الزيارة لم تُغلق';
  end if;
  raise notice '✅ ١٢) الزيارة اكتملت ووُقّعت وأُغلقت ماليًا';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١٣) الرحلة كلها ظاهرة في سجلّ واحد
  -- ═══════════════════════════════════════════════════════════════════════
  select * into v_rec from v_visit_register where id = v_visit;
  if v_rec.id is null then
    raise exception 'فشل: الزيارة لا تظهر في سجل الزيارات';
  end if;
  if v_rec.invoice_id is distinct from v_invoice then
    raise exception 'فشل: سجل الزيارات لا يربط الزيارة بفاتورتها';
  end if;
  if v_rec.has_services_no_invoice then
    raise exception 'فشل: السجل يقول إن ثمّة خدمة بلا فاتورة وقد فُوترت كلها';
  end if;
  if not exists (select 1 from audit_log where entity_id = v_visit and module = 'visits') then
    raise exception 'فشل: أحداث الزيارة لا أثر لها في التدقيق';
  end if;
  raise notice '✅ ١٣) الرحلة مترابطة: زيارة ← فاتورة ← تدقيق في سجلّ واحد';

  -- ═══════════════════════════════════════════════════════════════════════
  -- ١٤) الخطّ الزمنيّ يجمع الرحلة كلها ويعرف حالة الزيارة
  -- ═══════════════════════════════════════════════════════════════════════
  select count(distinct event_type) into v_int
    from app_get_patient_timeline(v_patient, null, null, null);
  if v_int < 6 then
    raise exception 'فشل: الخطّ الزمنيّ يعرض % نوع حدث فقط', v_int;
  end if;
  for v_txt in
    select k from unnest(array['appointment_created','arrival','call','visit',
                               'lab_order','radiology_order','prescription',
                               'dispensing','invoice']) k
  loop
    if not exists (select 1 from app_get_patient_timeline(v_patient, null, null, array[v_txt])) then
      raise exception 'فشل: الحدث «%» غائب عن الخطّ الزمنيّ لرحلة المريض', v_txt;
    end if;
  end loop;
  select status into v_txt
    from app_get_patient_timeline(v_patient, null, null, array['visit'])
   where visit_id = v_visit;
  if v_txt <> 'مغلقة ماليًا' then
    raise exception 'فشل: الخطّ الزمنيّ لا يعرف حالة الزيارة (%)', coalesce(v_txt, 'فارغة');
  end if;
  raise notice '✅ ١٤) الخطّ الزمنيّ يجمع الرحلة كلها ويعرض حالة الزيارة';

  raise notice '';
  raise notice '═══ الرحلة الكاملة نجحت من الحجز إلى الإغلاق ═══';
  raise notice '';

  -- ═══════════════════════════════════════════════════════════════════════
  --                          الحالات الحديّة
  -- ═══════════════════════════════════════════════════════════════════════

  -- (١) خدمة مؤرشفة لا تُحجز ولا تُنفَّذ
  update items set is_archived = true, archived_at = now() where id = v_rad_item;
  v_json := app_check_service_eligibility(v_rad_item, v_patient, v_branch, 'execution');
  if (v_json->>'ok')::boolean then
    raise exception 'فشل حديّ ١: خدمة مؤرشفة قُبلت';
  end if;
  update items set is_archived = false, archived_at = null where id = v_rad_item;
  raise notice '✅ حديّ ١: الخدمة المؤرشفة لا تُنفَّذ';

  -- (٢) خدمة تشترط موافقة مسبقة تُمنع بلا موافقة، وتُقبل بموافقتها هي
  declare v_mri uuid; v_pa uuid;
  begin
    insert into items (organization_id, item_type, code, name_ar, price,
                       medical_service_type, requires_preauthorization)
      values (v_org, 'service', 'MRI', 'رنين', 2000, 'radiology', true) returning id into v_mri;

    v_json := app_check_service_eligibility(v_mri, v_patient, v_branch, 'execution');
    if (v_json->>'ok')::boolean then
      raise exception 'فشل حديّ ٢: نُفِّذت خدمة تشترط موافقة بلا موافقة';
    end if;

    -- موافقة على **خدمة أخرى** لا تكفي
    insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                             item_id, requested_amount, status, created_by)
      values (v_org, v_patient, v_member, v_consult, 250, 'pending', v_owner) returning id into v_pa;
    perform app_set_preauth_status(v_pa, 'approved', null, 250, 'A-1');
    v_json := app_check_service_eligibility(v_mri, v_patient, v_branch, 'execution');
    if (v_json->>'ok')::boolean then
      raise exception 'فشل حديّ ٢: موافقة على خدمة أخرى فتحت الرنين';
    end if;

    insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                             item_id, requested_amount, status, created_by)
      values (v_org, v_patient, v_member, v_mri, 2000, 'pending', v_owner) returning id into v_pa;
    perform app_set_preauth_status(v_pa, 'approved', null, 2000, 'A-2');
    v_json := app_check_service_eligibility(v_mri, v_patient, v_branch, 'execution');
    if not (v_json->>'ok')::boolean then
      raise exception 'فشل حديّ ٢: مُنعت خدمة لها موافقتها (%)', v_json->'blocks';
    end if;
  end;
  raise notice '✅ حديّ ٢: الموافقة المسبقة تُمنع وتُفتح بخدمتها هي وحدها';

  -- (٣) الحجز خارج دوام الطبيب
  begin
    insert into appointments (organization_id, patient_id, doctor_id, clinic_id, branch_id,
                              scheduled_start, scheduled_end, status)
      values (v_org, v_patient, v_doctor, v_clinic, v_branch,
              (current_date + 2)::timestamptz + interval '3 hours',
              (current_date + 2)::timestamptz + interval '3 hours 20 minutes', 'scheduled');
    raise exception 'فشل حديّ ٣: حُجز موعد خارج دوام الطبيب';
  exception when others then
    if sqlerrm like 'فشل حديّ%' then raise; end if;
    raise notice '✅ حديّ ٣: الحجز خارج الدوام مرفوض';
  end;

  -- (٤) الحجز في عيادة لا يعمل بها الطبيب
  declare v_cl2 uuid;
  begin
    v_cl2 := app_save_clinic(v_org, null, jsonb_build_object(
               'code','CL-2','name','عيادة الجلدية','branch_id', v_branch));
    begin
      insert into appointments (organization_id, patient_id, doctor_id, clinic_id, branch_id,
                                scheduled_start, scheduled_end, status)
        values (v_org, v_patient, v_doctor, v_cl2, v_branch,
                (current_date + 3)::timestamptz + interval '9 hours',
                (current_date + 3)::timestamptz + interval '9 hours 20 minutes', 'scheduled');
      raise exception 'فشل حديّ ٤: حُجز الطبيب في عيادة لا يعمل بها';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ٤: الطبيب لا يُحجز في عيادة غير مرتبط بها';
    end;
  end;

  -- (٥) دواء منتهي الصلاحية لا يُصرَف حتى لو كان الرصيد كافيًا
  declare v_lot_x uuid; v_p2 uuid; v_pi2 uuid;
  begin
    insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                                qty_remaining, qty_received, unit_cost, expiry_date)
      values (v_org, v_wh, v_drug, 'EXP', 500, 500, 10, current_date - 1)
      returning id into v_lot_x;
    insert into prescriptions (organization_id, patient_id, status, created_by)
      values (v_org, v_patient, 'issued', v_owner) returning id into v_p2;
    insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
      values (v_p2, v_drug, 500) returning id into v_pi2;
    begin
      perform app_dispense_prescription(v_p2, v_wh,
        jsonb_build_array(jsonb_build_object('prescription_item_id', v_pi2, 'qty', 500)));
      raise exception 'فشل حديّ ٥: صُرف من دفعة منتهية';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ٥: الدفعة المنتهية لا تُصرَف ولو كفى رصيدها';
    end;
  end;

  -- (٦) نتيجة مختبر حرجة تُعلَّم وتظهر في منظورها
  declare v_lo2 uuid;
  begin
    insert into lab_orders (organization_id, patient_id, ordering_doctor_id, branch_id, status)
      values (v_org, v_patient, v_doctor, v_branch, 'ordered') returning id into v_lo2;
    insert into lab_order_items (organization_id, lab_order_id, lab_test_id)
      values (v_org, v_lo2, v_lab_test);
    perform app_set_lab_order_status(v_lo2, 'specimen_collected');
    perform app_set_lab_order_status(v_lo2, 'received');
    perform app_set_lab_order_status(v_lo2, 'in_progress');
    perform app_enter_lab_result((select id from lab_order_items where lab_order_id = v_lo2 limit 1), '25', 25);
    if not exists (select 1 from v_critical_results
                    where source_order_id = v_lo2 and source_kind = 'lab' and is_open) then
      raise exception 'فشل حديّ ٦: نتيجة فوق الحدّ الحرج لم تُنشئ بلاغًا مفتوحًا';
    end if;
  end;
  raise notice '✅ حديّ ٦: النتيجة الحرجة تُعلَّم وتظهر لمن يجب أن يراها';

  -- (٧) إغلاق زيارة على خدمة لم تُفوتَر مرفوض
  declare v_v2 uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
      values (v_org, v_patient, v_doctor, current_date, 'in_progress') returning id into v_v2;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_v2, v_consult, 1, 250, 'performed');
    perform app_set_visit_status(v_v2, 'completed');
    perform app_set_visit_status(v_v2, 'signed');
    begin
      perform app_set_visit_status(v_v2, 'closed');
      raise exception 'فشل حديّ ٧: أُغلقت زيارة على خدمة لم تُفوتَر';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ٧: الإغلاق يُمنع على إيراد لم يُفوتَر';
    end;
  end;

  -- (٨) الزيارة المغلقة لا تُعدَّل مباشرةً
  begin
    update patient_visits set main_complaint = 'تعديل بعد الإغلاق' where id = v_visit;
    raise exception 'فشل حديّ ٨: عُدِّلت زيارة مغلقة';
  exception when others then
    if sqlerrm like 'فشل حديّ%' then raise; end if;
    raise notice '✅ حديّ ٨: الزيارة المغلقة لا تُعدَّل إلّا بإعادة فتح مسجَّلة';
  end;

  -- (٩) استهلاك السقف السنوي ينقل التكلفة إلى المريض
  declare v_json2 jsonb;
  begin
    insert into sales_invoices (organization_id, patient_id, invoice_type, status,
                                net_amount, is_insurance_invoice, insurance_share_amount)
      values (v_org, v_patient, 'sale', 'paid', 12000, true, 11000);
    v_json2 := app_insurance_coverage(v_member, v_consult, 250);
    if (v_json2->>'covered')::boolean then
      raise exception 'فشل حديّ ٩: التغطية استمرّت بعد استهلاك السقف';
    end if;
    if (v_json2->>'patient_share')::numeric <> 250 then
      raise exception 'فشل حديّ ٩: المريض لا يتحمّل كامل المبلغ بعد نفاد السقف (%)',
        v_json2->>'patient_share';
    end if;
  end;
  raise notice '✅ حديّ ٩: نفاد السقف ينقل كامل المبلغ إلى المريض لا يُسقطه';

  -- (١٠) جهاز الأشعة لا يُحجز مرّتين في الوقت نفسه
  declare v_ro2 uuid;
  begin
    insert into radiology_orders (organization_id, patient_id, ordering_doctor_id,
                                  branch_id, status)
      values (v_org, v_patient, v_doctor, v_branch, 'ordered') returning id into v_ro2;
    insert into radiology_order_items (radiology_order_id, radiology_exam_id)
      values (v_ro2, v_rad_exam);
    begin
      perform app_schedule_radiology_order(v_ro2, v_resource, now() + interval '75 minutes', 30);
      raise exception 'فشل حديّ ١٠: حُجز الجهاز في وقت مشغول';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ١٠: الجهاز لا يُحجز مرّتين في وقت متداخل';
    end;
  end;

  -- (١١) الفاتورة لا تحمل خدمة من زيارة أخرى
  declare v_s3 uuid; v_v3 uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
      values (v_org, v_patient, v_doctor, current_date, 'in_progress') returning id into v_v3;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_v3, v_consult, 1, 250, 'performed') returning id into v_s3;
    begin
      perform app_create_sales_invoice(
        p_organization_id := v_org,
        p_items := jsonb_build_array(jsonb_build_object(
          'item_id', v_consult, 'qty', 1, 'price', 250, 'visit_service_id', v_s3)),
        p_patient_id := v_patient,
        p_visit_id := v_v2);
      raise exception 'فشل حديّ ١١: فُوترت خدمة تخصّ زيارة أخرى';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ١١: الفاتورة لا تلتقط خدمة من زيارة أخرى';
    end;
  end;

  -- (١٢) العزل بين المنشآت: بيانات منشأة أخرى لا تُلمس
  declare v_org2 uuid; v_owner2 uuid; v_pat2 uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'jr-other@test.local')
      returning id into v_owner2;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'medical_center', v_owner2) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_owner2::text, true);
    insert into patients (organization_id, name_ar) values (v_org2, 'مريض الغير')
      returning id into v_pat2;

    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    begin
      perform app_insurance_coverage(v_member, v_consult, 250);  -- المسموح
      insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
        values (v_org, v_pat2, v_doctor, current_date, 'planned');
      raise exception 'فشل حديّ ١٢: أُنشئت زيارة لمريض من منشأة أخرى';
    exception when others then
      if sqlerrm like 'فشل حديّ%' then raise; end if;
      raise notice '✅ حديّ ١٢: مريض منشأة أخرى لا تُبنى عليه زيارة هنا';
    end;
  end;

  -- (١٣) الموافقة المسبقة تُستهلَك بالفوترة فلا تُستعمل مرّتين
  declare v_mri2 uuid; v_pa3 uuid; v_inv2 uuid;
  begin
    insert into items (organization_id, item_type, code, name_ar, price,
                       medical_service_type, requires_preauthorization)
      values (v_org, 'service', 'MRI2', 'رنين ثانٍ', 1800, 'radiology', true)
      returning id into v_mri2;
    insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                             item_id, requested_amount, status, created_by)
      values (v_org, v_patient, v_member, v_mri2, 1800, 'pending', v_owner) returning id into v_pa3;
    perform app_set_preauth_status(v_pa3, 'approved', null, 1800, 'A-3');

    select app_create_sales_invoice(
      p_organization_id := v_org,
      p_items := jsonb_build_array(jsonb_build_object(
        'item_id', v_mri2, 'qty', 1, 'price', 1800)),
      p_patient_id := v_patient,
      p_is_insurance := true) into v_inv2;

    if (select consumed_at from insurance_preauthorizations where id = v_pa3) is null then
      raise exception 'فشل حديّ ١٣: الموافقة لم تُستهلَك بالفوترة — تُستعمل مرّة ثانية';
    end if;
    if (select preauthorization_id from sales_invoice_items
         where invoice_id = v_inv2 and item_id = v_mri2) is distinct from v_pa3 then
      raise exception 'فشل حديّ ١٣: سطر الفاتورة لا يشير إلى الموافقة التي استعملها';
    end if;
    -- ولا تُقبل مرّة ثانية
    v_json := app_check_service_eligibility(v_mri2, v_patient, v_branch, 'execution');
    if (v_json->>'ok')::boolean then
      raise exception 'فشل حديّ ١٣: موافقة مستهلَكة أعادت فتح الخدمة';
    end if;
  end;
  raise notice '✅ حديّ ١٣: الموافقة تُستهلَك بالفوترة وتُربط بسطرها ولا تُعاد';

  raise notice '';
  raise notice '═══ كل الحالات الحديّة نجحت ═══';
end $$;

rollback;
