-- ---------------------------------------------------------------------------
-- اختبارات الأشعة وحجز الموارد — 0084
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/radiology-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- ثلاثة عشر فحصًا: الفحص يُنشأ مع خدمته المالية من نوع «أشعة»، حجز الجهاز
-- يمنع التداخل على مستوى المحرّك، إعادة الجدولة تنقل الحجز ولا تضيف ثانيًا،
-- القفز في الحالات مرفوض، فحص الحمل يمنع البدء، التقرير بلا انطباع لا
-- يُعتمد، الإلغاء يحرّر الجهاز، ولكل انتقال صلاحيته.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_tech    uuid;
  v_branch  uuid;
  v_woman   uuid;
  v_man     uuid;
  v_exam    uuid;
  v_item    uuid;
  v_device  uuid;
  v_order   uuid;
  v_line    uuid;
  v_booking uuid;
  v_start   timestamptz;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rad-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'rad-tech@test.local')
    returning id into v_tech;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الأشعة', 'clinic', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_tech, 'radiology_technician', true);
  insert into branches (organization_id, name, code) values (v_org, 'فرع الأشعة', 'RD-A')
    returning id into v_branch;
  insert into patients (organization_id, name_ar, gender, birth_date)
    values (v_org, 'امرأة', 'female', current_date - interval '30 years') returning id into v_woman;
  insert into patients (organization_id, name_ar, gender, birth_date)
    values (v_org, 'رجل', 'male', current_date - interval '35 years') returning id into v_man;
  insert into resources (organization_id, branch_id, resource_type, name_ar)
    values (v_org, v_branch, 'device', 'جهاز الأشعة السينية') returning id into v_device;

  v_start := date_trunc('hour', now() + interval '2 days');

  -- ── 1) الفحص يُنشأ مع خدمته المالية
  v_exam := app_save_radiology_exam(v_org, null, jsonb_build_object(
    'name_ar','أشعة صدر','code','CXR','modality','xray','body_part','صدر',
    'estimated_duration_minutes','15','price','150'));

  select billing_item_id into v_item from radiology_exams where id = v_exam;
  if v_item is null then
    raise exception 'فشل: الفحص أُنشئ بلا خدمة مالية';
  end if;
  if (select medical_service_type from items where id = v_item) <> 'radiology' then
    raise exception 'فشل: الخدمة ليست من نوع أشعة';
  end if;
  raise notice '✅ الفحص يُنشأ مع خدمته المالية من نوع «أشعة»';

  -- ── 2) الأشعة السينية تُشعّع: فحص الحمل مطلوب افتراضيًا
  if not (select pregnancy_check_required from radiology_exams where id = v_exam) then
    raise exception 'فشل: أشعة سينية بلا اشتراط فحص الحمل';
  end if;
  raise notice '✅ فحص الحمل مشترط تلقائيًا للأشعة المشعّة';

  -- ── 3) الطلب والجدولة على الجهاز
  insert into radiology_orders (organization_id, patient_id, status)
    values (v_org, v_woman, 'ordered') returning id into v_order;
  insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_order, v_exam) returning id into v_line;

  v_booking := app_schedule_radiology_order(v_order, v_device, v_start);
  if (select status from radiology_orders where id = v_order) <> 'scheduled' then
    raise exception 'فشل: الطلب لم ينتقل إلى مجدول';
  end if;
  raise notice '✅ الجدولة تحجز الجهاز وتنقل الحالة';

  -- ── 4) التداخل مرفوض على مستوى المحرّك
  --
  -- المنع بقيد `exclude` لا بفحص `select` قبل `insert`: بين القراءة والكتابة
  -- فجوةٌ تكفي لمرور طلبين متزامنين.
  begin
    perform app_book_resource(v_device, v_start + interval '5 minutes',
                              v_start + interval '20 minutes', 'radiology');
    raise exception 'فشل: قُبل حجز متداخل على الجهاز';
  exception when others then
    if sqlerrm not like '%محجوز في هذا الوقت%' then raise; end if;
    raise notice '✅ تداخل حجز الجهاز مرفوض';
  end;

  -- ── 5) وقتٌ خالٍ يُقبل
  perform app_book_resource(v_device, v_start + interval '1 hour',
                            v_start + interval '80 minutes', 'radiology');
  raise notice '✅ الوقت الخالي يُقبل';

  -- ── 6) إعادة الجدولة تنقل الحجز ولا تضيف ثانيًا
  select count(*) into v_int from resource_bookings
   where resource_id = v_device and radiology_order_id = v_order;
  if v_int <> 1 then raise exception 'فشل: حجوز الطلب % لا ١', v_int; end if;

  perform app_schedule_radiology_order(v_order, v_device, v_start + interval '3 hours');
  select count(*) into v_int from resource_bookings
   where resource_id = v_device and radiology_order_id = v_order;
  if v_int <> 1 then
    raise exception 'فشل: إعادة الجدولة أضافت حجزًا ثانيًا (%)', v_int;
  end if;
  raise notice '✅ إعادة الجدولة تنقل الحجز';

  -- ── 7) القفز في الحالات مرفوض
  begin
    perform app_set_radiology_order_status(v_order, 'verified');
    raise exception 'فشل: قُبل القفز إلى verified';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
    raise notice '✅ القفز في حالات الأشعة مرفوض';
  end;

  -- ── 8) فحص الحمل يمنع البدء
  perform app_set_radiology_order_status(v_order, 'arrived');
  begin
    perform app_set_radiology_order_status(v_order, 'in_progress');
    raise exception 'فشل: بدأ فحص مشعّ لامرأة بلا نفي حمل';
  exception when others then
    if sqlerrm not like '%نفي الحمل%' then raise; end if;
    raise notice '✅ فحص الحمل يمنع بدء التصوير';
  end;

  update radiology_orders set pregnancy_confirmed_not = true, pregnancy_checked_by = v_owner
   where id = v_order;
  perform app_set_radiology_order_status(v_order, 'in_progress');
  raise notice '✅ بعد نفي الحمل يبدأ التصوير';

  -- ── 9) التقرير بلا انطباع لا يُعتمد
  perform app_set_radiology_order_status(v_order, 'images_ready');
  perform app_set_radiology_order_status(v_order, 'reporting');
  begin
    perform app_set_radiology_order_status(v_order, 'verified');
    raise exception 'فشل: اعتُمد تقرير بلا انطباع';
  exception when others then
    if sqlerrm not like '%بلا انطباع%' then raise; end if;
    raise notice '✅ الاعتماد يشترط انطباعًا مكتوبًا';
  end;

  update radiology_order_items
     set findings = 'رئتان صافيتان', impression = 'طبيعي'
   where id = v_line;
  perform app_set_radiology_order_status(v_order, 'verified');
  if (select verified_by from radiology_orders where id = v_order) is null then
    raise exception 'فشل: المعتمِد لم يُسجَّل';
  end if;
  perform app_set_radiology_order_status(v_order, 'delivered');
  raise notice '✅ سلسلة التقرير والاعتماد والتسليم';

  -- ── 10) الإلغاء يحرّر الجهاز
  insert into radiology_orders (organization_id, patient_id, status)
    values (v_org, v_man, 'ordered') returning id into v_order;
  insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_order, v_exam);
  perform app_schedule_radiology_order(v_order, v_device, v_start + interval '6 hours');

  select count(*) into v_int from resource_bookings
   where resource_id = v_device and radiology_order_id = v_order;
  if v_int <> 1 then raise exception 'فشل: الحجز لم يُنشأ'; end if;

  perform app_set_radiology_order_status(v_order, 'cancelled', 'اعتذر المريض');
  select count(*) into v_int from resource_bookings
   where resource_id = v_device and radiology_order_id = v_order;
  if v_int <> 0 then
    raise exception 'فشل: الحجز بقي بعد إلغاء الطلب — يمنع مريضًا آخر بلا سبب';
  end if;
  raise notice '✅ الإلغاء يحرّر الجهاز';

  -- ── 11) الإلغاء يحتاج سببًا
  insert into radiology_orders (organization_id, patient_id, status)
    values (v_org, v_man, 'ordered') returning id into v_order;
  begin
    perform app_set_radiology_order_status(v_order, 'cancelled');
    raise exception 'فشل: قُبل إلغاء بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ الإلغاء يحتاج سببًا';
  end;

  -- ── 12) المورد المعطَّل لا يُحجز
  update resources set is_active = false where id = v_device;
  begin
    perform app_book_resource(v_device, v_start + interval '10 hours',
                              v_start + interval '11 hours', 'radiology');
    raise exception 'فشل: حُجز مورد معطَّل';
  exception when others then
    if sqlerrm not like '%معطَّل%' then raise; end if;
    raise notice '✅ المورد المعطَّل لا يُحجز';
  end;
  update resources set is_active = true where id = v_device;

  -- ── 13) لكل انتقال صلاحيته
  perform set_config('request.jwt.claim.sub', v_tech::text, true);
  insert into radiology_orders (organization_id, patient_id, status)
    values (v_org, v_man, 'ordered') returning id into v_order;
  insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_order, v_exam) returning id into v_line;

  perform app_set_radiology_order_status(v_order, 'arrived');
  perform app_set_radiology_order_status(v_order, 'in_progress');
  perform app_set_radiology_order_status(v_order, 'images_ready');

  begin
    perform app_set_radiology_order_status(v_order, 'reporting');
    raise exception 'فشل: فني الأشعة كتب التقرير';
  exception when others then
    if sqlerrm not like '%rad.report%' then raise; end if;
    raise notice '✅ كتابة التقرير تحتاج صلاحيتها (الفني يصوّر ولا يقرّر)';
  end;

  raise notice '——— كل فحوص الأشعة نجحت ———';
end $$;

rollback;
