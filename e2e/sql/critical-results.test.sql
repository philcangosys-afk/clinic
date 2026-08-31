-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات القيم الحرجة ومساحة عمل الطبيب — 0105
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/critical-results.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS**: الإبلاغ تنبيهٌ داخل النظام، والاتصال الهاتفي
-- يُوثَّق يدويًّا كما جرى فعلًا.
--
-- الخطر هنا سلامة مرضى مباشرة: قيمة مختبر مميتة تُسجَّل ولا يعلم بها الطبيب،
-- أو يُقَرّ بها بضغطة زر بلا فهم. كل فحص يحاول ذلك ويتوقّع المنع أو الإبلاغ.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_docu    uuid;   -- مستخدم الطبيب
  v_techu   uuid;   -- فنّي المختبر
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_test    uuid;
  v_order   uuid;
  v_item    uuid;
  v_crit    uuid;
  v_int     integer;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'cr-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cr-doctor@test.local')
    returning id into v_docu;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cr-tech@test.local')
    returning id into v_techu;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار القيم الحرجة', 'medical_center', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_docu, 'doctor', true), (v_org, v_techu, 'lab_technician', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','CR1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, user_id, name_ar, clinic_id)
    values (v_org, v_docu, 'د. ليلى', v_clinic) returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض حرِج')
    returning id into v_patient;

  v_test := app_save_lab_test(v_org, null, jsonb_build_object(
              'name_ar','بوتاسيوم','code','K','specimen_type','blood','price','60'));

  insert into lab_orders (organization_id, branch_id, patient_id, ordering_doctor_id,
                          status, ordered_at)
    values (v_org, v_branch, v_patient, v_doctor, 'in_progress', now())
    returning id into v_order;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) النتيجة العادية لا تُنشئ بلاغًا
  -- ═════════════════════════════════════════════════════════════════════════
  insert into lab_order_items (organization_id, lab_order_id, lab_test_id,
                               result_value, is_critical, entered_at)
    values (v_org, v_order, v_test, '4.1', false, now());
  if exists (select 1 from critical_result_notifications where organization_id = v_org) then
    raise exception 'فشل: نتيجة عادية أنشأت بلاغ قيمة حرجة';
  end if;
  raise notice '✅ ١) النتيجة ضمن المعدّل لا تُنشئ بلاغًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) **القيمة الحرجة تُنشئ بلاغًا وتُنبّه طبيبها شخصيًّا**
  -- ═════════════════════════════════════════════════════════════════════════
  insert into lab_order_items (organization_id, lab_order_id, lab_test_id,
                               result_value, is_critical, entered_at)
    values (v_org, v_order, v_test, '7.9', true, now())
    returning id into v_item;

  select id into v_crit from critical_result_notifications
   where organization_id = v_org and source_item_id = v_item;
  if v_crit is null then
    raise exception 'فشل: القيمة الحرجة لم تُنشئ بلاغًا';
  end if;
  if (select result_value from critical_result_notifications where id = v_crit) <> '7.9' then
    raise exception 'فشل: البلاغ لا يحمل القيمة نفسها';
  end if;

  -- الطبيب الطالب نفسه يُنبَّه، لا صاحب صلاحية عامة فحسب
  if not exists (select 1 from notifications
                  where organization_id = v_org and user_id = v_docu
                    and event_key = 'critical_result' and severity = 'critical') then
    raise exception 'فشل: الطبيب الطالب لم يُنبَّه بالقيمة الحرجة';
  end if;
  -- ومتابع القيم الحرجة (فنّي المختبر) يُنبَّه أيضًا
  if not exists (select 1 from notifications
                  where organization_id = v_org and user_id = v_techu
                    and event_key = 'critical_result') then
    raise exception 'فشل: متابع القيم الحرجة لم يُنبَّه';
  end if;
  raise notice '✅ ٢) القيمة الحرجة تُنشئ بلاغًا وتُنبّه الطبيب والمتابع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) لا بلاغين لنتيجة واحدة مهما تكرّر التعديل
  -- ═════════════════════════════════════════════════════════════════════════
  update lab_order_items set result_value = '8.1' where id = v_item;
  update lab_order_items set result_value = '8.2' where id = v_item;
  select count(*) into v_int from critical_result_notifications
   where organization_id = v_org and source_item_id = v_item;
  if v_int <> 1 then
    raise exception 'فشل: النتيجة الواحدة أنشأت % بلاغًا', v_int;
  end if;
  raise notice '✅ ٣) بلاغ واحد لكل نتيجة مهما تكرّر تعديلها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) **الإقرار يشترط إعادة القراءة والإجراء**
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_docu::text, true);
  begin
    perform app_acknowledge_critical_result(v_crit, '   ', 'أوقفت الدواء');
    raise exception 'فشل: أُقِرّ بقيمة حرجة بلا إعادة قراءة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%إعادة قراءة%' then raise; end if;
  end;
  begin
    perform app_acknowledge_critical_result(v_crit, 'بوتاسيوم 8.2', '  ');
    raise exception 'فشل: أُقِرّ بقيمة حرجة بلا إجراء متَّخذ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%الإجراء المتَّخذ مطلوب%' then raise; end if;
  end;
  raise notice '✅ ٤) الإقرار لا يمرّ بلا إعادة قراءة ولا إجراء';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) من لا يملك صلاحية الإقرار لا يُقِرّ
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_techu::text, true);
  begin
    perform app_acknowledge_critical_result(v_crit, 'بوتاسيوم 8.2', 'أبلغت الطبيب');
    raise exception 'فشل: أقرّ فنّي المختبر نيابة عن الطبيب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%critical.acknowledge%' then raise; end if;
  end;

  -- لكنه يوثّق الاتصال الهاتفي، وهو دوره فعلًا
  begin
    perform app_record_critical_phone_call(v_crit, '   ');
    raise exception 'فشل: وُثّق إبلاغ بلا اسم من أُبلغ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%اسم من أُبلغ%' then raise; end if;
  end;
  perform app_record_critical_phone_call(v_crit, 'د. ليلى — هاتفيًّا');
  if (select phoned_at from critical_result_notifications where id = v_crit) is null then
    raise exception 'فشل: لم يُوثَّق الاتصال';
  end if;
  raise notice '✅ ٥) الفنّي يوثّق الإبلاغ ولا يُقِرّ نيابة عن الطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الإقرار الصحيح يُغلق البلاغ ويُسجَّل في التدقيق، ولا يتكرّر
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_docu::text, true);
  perform app_acknowledge_critical_result(
    v_crit, 'بوتاسيوم ثمانية فاصلة اثنين', 'أوقفت مدرّ البول وطلبت تخطيط قلب عاجل');
  select read_back_text into v_txt from critical_result_notifications where id = v_crit;
  if v_txt is null or v_txt = '' then
    raise exception 'فشل: نص إعادة القراءة لم يُحفظ';
  end if;
  if (select acknowledged_by from critical_result_notifications where id = v_crit) <> v_docu then
    raise exception 'فشل: الإقرار لم يُنسب للطبيب';
  end if;
  if not exists (select 1 from audit_log
                  where organization_id = v_org and entity_id = v_crit
                    and entity_title = 'إقرار بقيمة حرجة') then
    raise exception 'فشل: الإقرار لم يدخل سجل التدقيق';
  end if;
  begin
    perform app_acknowledge_critical_result(v_crit, 'مرّة أخرى', 'لا شيء');
    raise exception 'فشل: أُقِرّ بالبلاغ مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سلفًا%' then raise; end if;
  end;
  raise notice '✅ ٦) الإقرار يُحفظ بنصّه وصاحبه ويدخل التدقيق، ولا يتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) البلاغ لا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    delete from critical_result_notifications where id = v_crit;
    raise exception 'فشل: حُذف بلاغ قيمة حرجة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  raise notice '✅ ٧) بلاغ القيمة الحرجة لا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) **التصعيد**: ما لم يُقَرّ به خلال المهلة يُرفع، والمُقَرّ به لا يُصعَّد
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_item2 uuid; v_crit2 uuid; v_esc integer;
  begin
    insert into lab_order_items (organization_id, lab_order_id, lab_test_id,
                                 result_value, is_critical, entered_at)
      values (v_org, v_order, v_test, '9.5', true, now())
      returning id into v_item2;
    select id into v_crit2 from critical_result_notifications where source_item_id = v_item2;

    -- لم تمضِ المهلة بعد
    v_esc := app_escalate_critical_results(v_org, 30);
    if v_esc <> 0 then
      raise exception 'فشل: صُعّد بلاغ قبل انقضاء مهلته';
    end if;

    -- نُقدّم زمن الاكتشاف لمحاكاة مرور المهلة
    update critical_result_notifications
       set detected_at = now() - interval '45 minutes' where id = v_crit2;
    v_esc := app_escalate_critical_results(v_org, 30);
    if v_esc <> 1 then
      raise exception 'فشل: لم يُصعَّد البلاغ المتأخّر (%)', v_esc;
    end if;
    if (select escalation_level from critical_result_notifications where id = v_crit2) <> 1 then
      raise exception 'فشل: مستوى التصعيد لم يرتفع';
    end if;
    if not exists (select 1 from notifications
                    where organization_id = v_org
                      and event_key = 'critical_unacknowledged') then
      raise exception 'فشل: التصعيد لم يُنبّه أحدًا';
    end if;

    -- والبلاغ المُقَرّ به لا يُصعَّد أبدًا
    perform set_config('request.jwt.claim.sub', v_docu::text, true);
    perform app_acknowledge_critical_result(v_crit2, 'تسعة فاصلة خمسة', 'أدخلت المريض الطوارئ');
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    update critical_result_notifications
       set detected_at = now() - interval '5 hours' where id = v_crit2;
    v_esc := app_escalate_critical_results(v_org, 30);
    if v_esc <> 0 then
      raise exception 'فشل: صُعّد بلاغٌ أُقِرّ به';
    end if;
  end;
  raise notice '✅ ٨) التصعيد يقع على المتأخّر وحده، ولا يمسّ ما أُقِرّ به';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) الأشعة: الاكتشاف العاجل يُنشئ بلاغًا أيضًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_exam uuid; v_ro uuid; v_ri uuid;
  begin
    v_exam := app_save_radiology_exam(v_org, null, jsonb_build_object(
                'name_ar','أشعة صدر','code','CXR','modality','xray','price','200'));
    insert into radiology_orders (organization_id, branch_id, patient_id,
                                  ordering_doctor_id, status, ordered_at)
      values (v_org, v_branch, v_patient, v_doctor, 'reporting', now())
      returning id into v_ro;
    insert into radiology_order_items (radiology_order_id, radiology_exam_id,
                                       impression, is_urgent_finding)
      values (v_ro, v_exam, 'استرواح صدري ضاغط', true)
      returning id into v_ri;

    if not exists (select 1 from critical_result_notifications
                    where source_kind = 'radiology' and source_item_id = v_ri) then
      raise exception 'فشل: الاكتشاف العاجل في الأشعة لم يُنشئ بلاغًا';
    end if;
  end;
  raise notice '✅ ٩) الاكتشاف العاجل في الأشعة يُنشئ بلاغًا كالمختبر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) منظور القيم الحرجة يفصل المفتوح عن المُقَرّ ويقيس زمن الاستجابة
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_critical_results
                  where organization_id = v_org and is_open) then
    raise exception 'فشل: المنظور لا يُظهر بلاغًا مفتوحًا';
  end if;
  if not exists (select 1 from v_critical_results
                  where organization_id = v_org and not is_open
                    and minutes_to_ack is not null) then
    raise exception 'فشل: المنظور لا يقيس زمن الاستجابة للمُقَرّ به';
  end if;
  raise notice '✅ ١٠) المنظور يفصل المفتوح عن المُقَرّ ويقيس زمن الاستجابة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) قائمة عمل الطبيب: مواعيده وزمن انتظار مرضاه
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_appt uuid;
  begin
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, checked_in_1_at,
                              created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              now() + interval '1 hour', now() + interval '1 hour 30 minutes',
              'scheduled', now() - interval '20 minutes', v_owner)
      returning id into v_appt;

    select waiting_minutes into v_int from v_doctor_worklist where appointment_id = v_appt;
    if v_int is null or v_int < 15 then
      raise exception 'فشل: زمن انتظار المريض غير محسوب (%)', v_int;
    end if;
    if (select doctor_user_id from v_doctor_worklist where appointment_id = v_appt) <> v_docu then
      raise exception 'فشل: قائمة العمل لا تربط الموعد بمستخدم الطبيب';
    end if;
  end;
  raise notice '✅ ١١) قائمة عمل الطبيب تعرض مواعيده وزمن انتظار مرضاه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) الزيارات المفتوحة تظهر بعمرها
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_visit uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_patient, v_doctor, v_clinic, v_branch,
              current_date - 3, 'in_progress')
      returning id into v_visit;
    select days_open into v_int from v_doctor_open_visits where visit_id = v_visit;
    if coalesce(v_int, 0) <> 3 then
      raise exception 'فشل: عمر الزيارة المفتوحة غير صحيح (%)', v_int;
    end if;
  end;
  raise notice '✅ ١٢) الزيارات المفتوحة تظهر بعمرها ليُغلقها الطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) عزل المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_owner2 uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'cr-other@test.local')
      returning id into v_owner2;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'clinic', v_owner2) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_owner2::text, true);
    begin
      perform app_escalate_critical_results(v_org, 30);
      raise exception 'فشل: صعّد غريبٌ بلاغات منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لست عضوًا%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١٣) عزل المنشآت قائم على القيم الحرجة';

  raise notice '——— كل فحوص القيم الحرجة نجحت ———';
end $$;

rollback;
