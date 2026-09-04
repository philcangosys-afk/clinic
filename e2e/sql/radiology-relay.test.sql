-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات حلقة الأشعة وطلبات الاستقبال — 0138
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/radiology-relay.test.sql
--
-- الرحلة المُختبَرة كاملةً: طبيب يطلب صورة ← تظهر في قائمة عمل الأشعة ←
-- المختصّ يرفع صورتين بملاحظة ← تُختم الحالة ← تصل صندوق الطبيب ← تظهر في
-- ملف المريض. ثم طلبات الطبيب إلى الاستقبال.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner   uuid;
  v_tech    uuid;
  v_org     uuid;
  v_branch  uuid;
  v_dept    uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_item    uuid;
  v_exam    uuid;
  v_exam2   uuid;
  v_order   uuid;
  v_order2  uuid;
  v_req     uuid;
  v_int     int;
  v_txt     text;
begin
  -- ── تهيئة
  insert into auth.users (id, email) values (gen_random_uuid(), 'rad-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'rad-tech@test.local')
    returning id into v_tech;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار حلقة الأشعة', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع الرئيسي', 'RR-1') returning id into v_branch;
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_tech, 'radiology_technician', true);

  v_dept := app_save_department(v_org, null,
             jsonb_build_object('name_ar', 'الأشعة', 'department_type', 'clinical'));
  insert into clinics (organization_id, name, code)
    values (v_org, 'عيادة الباطنة', 'INT') returning id into v_clinic;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9101, 'د. تجربة') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number, phone_1)
    values (v_org, 'مريض الأشعة', '2038475618', '0500000000')
    returning id into v_patient;

  insert into items (organization_id, code, name_ar)
    values (v_org, 'RAD-CH', 'صورة صدر') returning id into v_item;
  insert into radiology_exams (organization_id, billing_item_id, code, name_ar, modality, body_part)
    values (v_org, v_item, 'CXR', 'أشعة صدر', 'xray', 'chest') returning id into v_exam;
  insert into radiology_exams (organization_id, billing_item_id, code, name_ar, modality, body_part)
    values (v_org, v_item, 'KUB', 'أشعة بطن', 'xray', 'abdomen') returning id into v_exam2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الطبيب يطلب صورتين
  -- ═════════════════════════════════════════════════════════════════════════
  v_order := app_create_radiology_order(
    v_org, v_patient, v_doctor, array[v_exam, v_exam2],
    'urgent', 'ألم صدري مستمر', 'يفضَّل وضع الوقوف', null, v_branch, v_clinic);

  if v_order is null then raise exception 'فشل: لم يُنشأ الطلب'; end if;
  select status into v_txt from radiology_orders where id = v_order;
  if v_txt <> 'ordered' then raise exception 'فشل: حالة الطلب % لا ordered', v_txt; end if;
  select count(*) into v_int from radiology_order_items where radiology_order_id = v_order;
  if v_int <> 2 then raise exception 'فشل: عدد البنود % لا 2', v_int; end if;
  raise notice '✅ ١) طلب أشعة بفحصين، الحالة ordered';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الطلب يظهر في قائمة عمل الأشعة بتعليمات التصوير
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), max(clinical_indication) into v_int, v_txt
    from v_radiology_console_queue where order_id = v_order;
  if v_int <> 1 then raise exception 'فشل: الطلب لا يظهر في قائمة عمل الأشعة'; end if;
  if v_txt <> 'ألم صدري مستمر' then
    raise exception 'فشل: تعليمات التصوير لم تصل المختصّ';
  end if;
  select image_count into v_int from v_radiology_console_queue where order_id = v_order;
  if v_int <> 0 then raise exception 'فشل: عدّاد الصور ليس صفرًا قبل الرفع'; end if;
  raise notice '✅ ٢) الطلب وتعليماته يظهران لمختصّ الأشعة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) صندوق الطبيب فارغ ما دامت الصور لم تُرفع
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_doctor_inbox where order_id = v_order;
  if v_int <> 0 then
    raise exception 'فشل: الطلب يظهر في صندوق الطبيب قبل رفع أي صورة';
  end if;
  raise notice '✅ ٣) لا شيء يصل الطبيب قبل وجود صورة فعلية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الرفع بلا صور مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_radiology_deliver_images(v_org, v_patient, v_doctor, v_exam,
                                         '[]'::jsonb, v_order, null, v_branch);
    raise exception 'فشل: قُبل الحفظ بلا صور';
  exception when others then
    if sqlerrm not like '%صورة واحدة على الأقل%' then raise; end if;
  end;
  raise notice '✅ ٤) «حفظ وإرسال» بلا صورة مرفوض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) المختصّ يرفع صورتين بملاحظة
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_radiology_deliver_images(
    v_org, v_patient, v_doctor, v_exam,
    jsonb_build_array(
      jsonb_build_object('path', v_org::text || '/radiology/a.jpg', 'name', 'a.jpg',
                         'mime', 'image/jpeg', 'size', '10240'),
      jsonb_build_object('path', v_org::text || '/radiology/b.jpg', 'name', 'b.jpg',
                         'mime', 'image/jpeg', 'size', '20480')),
    v_order, 'الصورة الثانية بوضع جانبي', v_branch);

  select count(*) into v_int
    from radiology_images ri
    join radiology_order_items oi on oi.id = ri.radiology_order_item_id
   where oi.radiology_order_id = v_order;
  if v_int <> 2 then raise exception 'فشل: عدد الصور % لا 2', v_int; end if;

  select count(*) into v_int from radiology_images ri
    join radiology_order_items oi on oi.id = ri.radiology_order_item_id
   where oi.radiology_order_id = v_order and ri.organization_id is null;
  if v_int > 0 then raise exception 'فشل: صورة بلا منشأة'; end if;
  raise notice '✅ ٥) رُفعت صورتان بملاحظة، وكلتاهما موسومة بالمنشأة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الحالة لا تُختم ما دام فحصٌ لم يُنفَّذ — والمُحفِّز لا يكتب حالة محذوفة
  -- ═════════════════════════════════════════════════════════════════════════
  select status into v_txt from radiology_orders where id = v_order;
  if v_txt = 'completed' then
    raise exception 'فشل: كُتبت الحالة المحذوفة completed';
  end if;
  if v_txt <> 'in_progress' then
    raise exception 'فشل: الحالة % والفحص الثاني لم يُنفَّذ بعد', v_txt;
  end if;
  raise notice '✅ ٦) الطلب لا يُختم جاهزًا وفحصٌ منه لم يُنفَّذ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) بعد الفحص الثاني تنتقل الحالة إلى images_ready تلقائيًّا
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_radiology_deliver_images(
    v_org, v_patient, v_doctor, v_exam2,
    jsonb_build_array(jsonb_build_object('path', v_org::text || '/radiology/c.jpg',
                                         'name', 'c.jpg', 'mime', 'image/jpeg')),
    v_order, null, v_branch);

  select status into v_txt from radiology_orders where id = v_order;
  if v_txt <> 'images_ready' then
    raise exception 'فشل: الحالة % لا images_ready بعد إنجاز البنود كلها', v_txt;
  end if;
  select count(*) into v_int from radiology_orders
   where id = v_order and images_ready_at is not null;
  if v_int <> 1 then raise exception 'فشل: images_ready_at لم يُختم'; end if;
  raise notice '✅ ٧) اكتمال البنود ينقل الحالة إلى images_ready ويختم وقتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) النتيجة تصل صندوق الطبيب بملاحظة المختصّ
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), max(tech_note) into v_int, v_txt
    from v_doctor_inbox where order_id = v_order;
  if v_int <> 1 then raise exception 'فشل: الطلب لم يصل صندوق الطبيب'; end if;
  select image_count into v_int from v_doctor_inbox where order_id = v_order;
  if v_int <> 3 then raise exception 'فشل: عدد الصور في الصندوق % لا 3', v_int; end if;
  if v_txt is null then raise exception 'فشل: ملاحظة المختصّ لم تصل الطبيب'; end if;
  raise notice '✅ ٨) الصور وملاحظة المختصّ تصل صندوق الطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) الصور تظهر في ملف المريض
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_patient_radiology_images where patient_id = v_patient;
  if v_int <> 3 then raise exception 'فشل: صور ملف المريض % لا 3', v_int; end if;
  select count(*) into v_int from v_patient_radiology_images
   where patient_id = v_patient and exam_name is null;
  if v_int > 0 then raise exception 'فشل: صورة بلا اسم فحص في ملف المريض'; end if;
  raise notice '✅ ٩) الصور الثلاث في ملف المريض، ولكلٍّ اسم فحصها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) رفعٌ بلا طلب سابق يُنشئ الطلب باسم الطبيب المختار
  -- ═════════════════════════════════════════════════════════════════════════
  v_order2 := app_radiology_deliver_images(
    v_org, v_patient, v_doctor, v_exam,
    jsonb_build_array(jsonb_build_object('path', v_org::text || '/radiology/walkin.jpg',
                                         'name', 'walkin.jpg')),
    null, 'مراجعة مباشرة بلا طلب', v_branch);
  if v_order2 is null or v_order2 = v_order then
    raise exception 'فشل: لم يُنشأ طلب جديد للرفع المباشر';
  end if;
  select count(*) into v_int from radiology_orders
   where id = v_order2 and ordering_doctor_id = v_doctor;
  if v_int <> 1 then
    raise exception 'فشل: الطلب المباشر لم يُنسب للطبيب المختار';
  end if;
  raise notice '✅ ١٠) الرفع بلا طلب سابق يُنشئ طلبًا منسوبًا للطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) العزل: مريض من منشأة أخرى مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_org2 uuid; v_pat2 uuid;
  begin
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'medical_center', v_owner) returning id into v_org2;
    insert into patients (organization_id, name_ar, id_number)
      values (v_org2, 'مريض غريب', '1000000008') returning id into v_pat2;
    begin
      perform app_create_radiology_order(v_org, v_pat2, v_doctor, array[v_exam]);
      raise exception 'فشل: قُبل طلب لمريض من منشأة أخرى';
    exception when others then
      if sqlerrm not like '%غير موجود في هذه المنشأة%' then raise; end if;
    end;
  end;
  raise notice '✅ ١١) لا يُطلب فحص لمريض من منشأة أخرى';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) الطلب الملغى لا تُرفع له صور
  -- ═════════════════════════════════════════════════════════════════════════
  update radiology_orders set status = 'cancelled' where id = v_order2;
  begin
    perform app_radiology_deliver_images(
      v_org, v_patient, v_doctor, v_exam,
      jsonb_build_array(jsonb_build_object('path', 'x/y.jpg', 'name', 'y.jpg')),
      v_order2, null, v_branch);
    raise exception 'فشل: رُفعت صورة لطلب ملغى';
  exception when others then
    if sqlerrm not like '%ملغى أو مرفوض%' then raise; end if;
  end;
  raise notice '✅ ١٢) الطلب الملغى مُغلق أمام الرفع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) طلبات الطبيب إلى الاستقبال
  -- ═════════════════════════════════════════════════════════════════════════
  v_req := app_create_staff_request(v_org, 'call_patient', v_patient, v_doctor,
                                    'أدخِل المريض الآن', null, 'urgent', null, v_branch);
  perform app_create_staff_request(v_org, 'collect_payment', v_patient, v_doctor,
                                   'قيمة الأشعة', 200, 'routine', null, v_branch);
  perform app_create_staff_request(v_org, 'note', v_patient, v_doctor,
                                   'المريض يحتاج كرسيًا متحركًا', null, 'routine', null, v_branch);

  select count(*) into v_int from v_reception_requests
   where organization_id = v_org and status = 'pending' and request_type <> 'follow_up';
  if v_int <> 3 then raise exception 'فشل: طلبات الاستقبال % لا 3', v_int; end if;
  raise notice '✅ ١٣) ثلاثة أنواع طلبات تصل الاستقبال';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) تحصيل بلا مبلغ، وملاحظة بلا نص — مرفوضان
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_create_staff_request(v_org, 'collect_payment', v_patient, v_doctor, 'بلا مبلغ');
    raise exception 'فشل: قُبل طلب تحصيل بلا مبلغ';
  exception when others then
    if sqlerrm not like '%مبلغًا موجبًا%' then raise; end if;
  end;
  begin
    perform app_create_staff_request(v_org, 'note', v_patient, v_doctor, '   ');
    raise exception 'فشل: قُبلت ملاحظة فارغة';
  exception when others then
    if sqlerrm not like '%نصّ الملاحظة%' then raise; end if;
  end;
  raise notice '✅ ١٤) الطلب الناقص مرفوض عند مصدره';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) إنهاء الطلب مرّة واحدة فقط
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_resolve_staff_request(v_req, 'done', 'أُدخل المريض');
  select status into v_txt from staff_requests where id = v_req;
  if v_txt <> 'done' then raise exception 'فشل: الطلب لم يُغلق'; end if;
  begin
    perform app_resolve_staff_request(v_req, 'done', 'مرة ثانية');
    raise exception 'فشل: أُغلق طلب مغلق سلفًا';
  exception when others then
    if sqlerrm not like '%مُغلق سلفًا%' then raise; end if;
  end;
  raise notice '✅ ١٥) الطلب لا يُغلق مرتين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 16) موعد المتابعة يذهب لجدول الطلبات القائم لا لجدول جديد
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_doctor_request_followup(v_org, v_patient, v_doctor,
                                      current_date + 14, 'متابعة بعد أسبوعين',
                                      'morning', v_clinic, v_branch);
  select count(*) into v_int from appointment_requests
   where organization_id = v_org and source = 'doctor' and status = 'pending';
  if v_int <> 1 then raise exception 'فشل: طلب المتابعة لم يُسجَّل في appointment_requests'; end if;
  select count(*) into v_int from v_reception_requests
   where organization_id = v_org and request_type = 'follow_up';
  if v_int <> 1 then raise exception 'فشل: طلب المتابعة لا يظهر عند الاستقبال'; end if;
  raise notice '✅ ١٦) موعد المتابعة في جدوله القائم، وظاهر عند الاستقبال';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 17) تاريخ متابعة في الماضي مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_doctor_request_followup(v_org, v_patient, v_doctor, current_date - 1);
    raise exception 'فشل: قُبل تاريخ متابعة ماضٍ';
  exception when others then
    if sqlerrm not like '%اليوم أو بعده%' then raise; end if;
  end;
  raise notice '✅ ١٧) تاريخ المتابعة الماضي مرفوض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 18) الإخطارات وصلت فعلًا — لا واجهة صامتة
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from notifications
   where organization_id = v_org
     and event_key in ('radiology_order_created','radiology_images_ready',
                       'staff_request_created','followup_requested');
  if v_int = 0 then
    raise exception 'فشل: لم يُسجَّل أيّ إخطار لأحداث الحلقة';
  end if;
  select count(*) into v_int from notification_rules
   where organization_id = v_org and channel <> 'internal';
  if v_int > 0 then
    raise exception 'فشل: قاعدة تنبيه بقناة غير internal — لا قنوات خارجية';
  end if;
  raise notice '✅ ١٨) الإخطارات مسجَّلة، وكلها بالقناة internal وحدها';

  raise notice '——— كل فحوص حلقة الأشعة نجحت ———';
end $$;

rollback;
