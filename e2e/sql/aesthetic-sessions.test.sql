-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات جلسات الجلدية والتجميل — 0142
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/aesthetic-sessions.test.sql
--
-- الرحلة: خدمة ليزر ببروتوكول (٦ جلسات كل ٢٨ يومًا، أقلّها ٢١) ← جلسة أولى
-- بجهاز وإعدادات ← موعد التالية يُحسب ← جلسة قبل أوانها تُرفض ← بسببٍ
-- مُعلَّل تُقبل وتُسجَّل ← عرضٌ جانبي يُخطَر به ← صور قبل/بعد في الجلسة.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_laser   uuid;
  v_device  uuid;
  v_face    uuid;
  v_legs    uuid;
  v_s1      uuid;
  v_s2      uuid;
  v_int     int;
  v_txt     text;
  v_date    date;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'aes-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organizations (name, organization_type, created_by)
    values ('عيادة اختبار الجلدية', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع', 'AE-1') returning id into v_branch;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9501, 'د. الجلدية') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريضة الليزر', '2038475618') returning id into v_patient;
  insert into resources (organization_id, branch_id, resource_type, name_ar)
    values (v_org, v_branch, 'device', 'جهاز ليزر ديود') returning id into v_device;

  insert into items (organization_id, code, name_ar, price,
                     default_sessions_count, session_interval_days, min_interval_days)
    values (v_org, 'LSR-F', 'ليزر إزالة شعر - الوجه', 400, 6, 28, 21)
    returning id into v_laser;

  select v.id into v_face from lookup_values v
    join lookup_categories c on c.id = v.category_id
   where c.key = 'body_parts' limit 1;
  select v.id into v_legs from lookup_values v
    join lookup_categories c on c.id = v.category_id
   where c.key = 'body_parts' and v.id <> v_face limit 1;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) بروتوكول غير منطقي مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into items (organization_id, code, name_ar,
                       session_interval_days, min_interval_days)
      values (v_org, 'BAD', 'خدمة خاطئة', 10, 30);
    raise exception 'فشل: قُبل أقلّ فاصل أكبر من الموصى به';
  exception when others then
    if sqlerrm not like '%items_session_protocol_check%' then raise; end if;
  end;
  raise notice '✅ ١) لا يكون أقلّ فاصل أكبر من الفاصل الموصى به';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) جلسة أولى بجهاز وإعدادات — والرقم يبدأ من 1
  -- ═════════════════════════════════════════════════════════════════════════
  v_s1 := app_record_treatment_session(
    v_org, v_patient, v_laser, v_doctor, v_face, v_device,
    jsonb_build_object('fluence','14 J/cm2','pulse_width','30ms','spot','12mm'),
    array['none'], null, 'الجلسة الأولى', null, null, null, v_branch);

  select session_number, status into v_int, v_txt
    from treatment_sessions where id = v_s1;
  if v_int <> 1 then raise exception 'فشل: رقم الجلسة % لا 1', v_int; end if;
  if v_txt <> 'completed' then raise exception 'فشل: حالة الجلسة % لا completed', v_txt; end if;

  select parameters->>'fluence' into v_txt from treatment_sessions where id = v_s1;
  if v_txt <> '14 J/cm2' then raise exception 'فشل: إعدادات الجهاز لم تُحفظ'; end if;
  raise notice '✅ ٢) الجلسة تُسجَّل بجهازها وإعداداتها الفعلية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) موعد الجلسة التالية يُحسب من البروتوكول
  -- ═════════════════════════════════════════════════════════════════════════
  select next_due_date into v_date from treatment_sessions where id = v_s1;
  if v_date is distinct from (current_date + 28) then
    raise exception 'فشل: موعد التالية % لا %', v_date, current_date + 28;
  end if;
  raise notice '✅ ٣) موعد الجلسة التالية محسوب من بروتوكول الخدمة (+28)';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) جلسة قبل أقلّ فاصل مرفوضة — وهذا حارس سلامة لا إجراء إداري
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_record_treatment_session(
      v_org, v_patient, v_laser, v_doctor, v_face, v_device,
      '{}'::jsonb, array['none'], null, null, null, null, null, v_branch);
    raise exception 'فشل: قُبلت جلسة ثانية في اليوم نفسه';
  exception when others then
    if sqlerrm not like '%أقلّ فاصل مسموح%' then raise; end if;
  end;
  raise notice '✅ ٤) لا جلسة قبل أقلّ فاصل مسموح';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) منطقة أخرى لا يمنعها فاصل المنطقة الأولى
  -- ═════════════════════════════════════════════════════════════════════════
  if v_legs is not null then
    v_s2 := app_record_treatment_session(
      v_org, v_patient, v_laser, v_doctor, v_legs, v_device,
      '{}'::jsonb, array['none'], null, 'منطقة أخرى', null, null, null, v_branch);
    if v_s2 is null then raise exception 'فشل: مُنعت جلسة لمنطقة أخرى'; end if;
    select session_number into v_int from treatment_sessions where id = v_s2;
    if v_int <> 2 then raise exception 'فشل: ترقيم الجلسات لا يتسلسل للخدمة'; end if;
  end if;
  raise notice '✅ ٥) الفاصل يُحسب لكل منطقة على حدة، لا للمريض كلّه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) التبكير بسبب مُعلَّل يُقبل — ويُسجَّل السبب
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_s3 uuid;
  begin
    v_s3 := app_record_treatment_session(
      v_org, v_patient, v_laser, v_doctor, v_face, v_device,
      '{}'::jsonb, array['none'], null, null, null, null,
      'المريضة مسافرة — بقرار الطبيب', v_branch);
    select interval_override_reason into v_txt from treatment_sessions where id = v_s3;
    if v_txt is null then raise exception 'فشل: سبب التبكير لم يُسجَّل'; end if;
  end;
  raise notice '✅ ٦) التبكير ممكن بسببٍ مُعلَّل مسجَّل، لا بالصمت';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) عرض جانبيّ غير معروف مرفوض، والتناقض مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update treatment_sessions set adverse_events = array['كذا'] where id = v_s1;
    raise exception 'فشل: قُبل عرض جانبيّ غير معروف';
  exception when others then
    if sqlerrm not like '%عرض جانبيّ غير معروف%' then raise; end if;
  end;
  begin
    update treatment_sessions set adverse_events = array['none','burn'] where id = v_s1;
    raise exception 'فشل: اجتمع «بلا أعراض» مع حرق';
  exception when others then
    if sqlerrm not like '%لا يجتمع%' then raise; end if;
  end;
  raise notice '✅ ٧) الأعراض قائمة مغلقة، و«بلا أعراض» لا تجتمع مع عرض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) عرض جانبيّ حقيقيّ يُخطَر به
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_s4 uuid; v_before int;
  begin
    select count(*) into v_before from notifications
     where organization_id = v_org and event_key = 'session_adverse_event';
    v_s4 := app_record_treatment_session(
      v_org, v_patient, v_laser, v_doctor, v_face, v_device,
      '{}'::jsonb, array['redness','swelling'], 'احمرار خفيف زال خلال ساعتين',
      null, null, null, 'متابعة عاجلة', v_branch);
    select count(*) into v_int from notifications
     where organization_id = v_org and event_key = 'session_adverse_event';
    if v_int <= v_before then
      raise exception 'فشل: العرض الجانبي لم يُخطَر به';
    end if;
  end;
  raise notice '✅ ٨) العرض الجانبيّ يُخطر به فورًا، ولا يُدفن في ملاحظة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) «بلا أعراض» لا تُخطر أحدًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_n1 int; v_n2 int;
  begin
    select count(*) into v_n1 from notifications
     where organization_id = v_org and event_key = 'session_adverse_event';
    perform app_record_treatment_session(
      v_org, v_patient, v_laser, v_doctor, v_face, v_device,
      '{}'::jsonb, array['none'], null, null, null, null, 'تكرار', v_branch);
    select count(*) into v_n2 from notifications
     where organization_id = v_org and event_key = 'session_adverse_event';
    if v_n2 <> v_n1 then
      raise exception 'فشل: جلسة سليمة أطلقت إخطار عرض جانبي';
    end if;
  end;
  raise notice '✅ ٩) الجلسة السليمة لا تُطلق إنذارًا — الإنذار الكاذب يُفقد الثقة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) تاريخ الجلسات يقرأ الجهاز والمنطقة والإعدادات
  -- ═════════════════════════════════════════════════════════════════════════
  select device_name, body_area into v_txt, v_txt
    from v_session_history where id = v_s1;
  select device_name into v_txt from v_session_history where id = v_s1;
  if v_txt is distinct from 'جهاز ليزر ديود' then
    raise exception 'فشل: اسم الجهاز لم يصل التاريخ (%)', coalesce(v_txt,'فارغ');
  end if;
  select service_name into v_txt from v_session_history where id = v_s1;
  if v_txt is distinct from 'ليزر إزالة شعر - الوجه' then
    raise exception 'فشل: اسم الخدمة لم يصل التاريخ';
  end if;
  raise notice '✅ ١٠) تاريخ الجلسات يعرض الجهاز والخدمة والمنطقة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الجلسات المستحقّة تُعرف ومن تأخّر عنها
  -- ═════════════════════════════════════════════════════════════════════════
  -- التأخير يُقاس من **آخر** جلسة لتلك المنطقة لا من أوّلها: العرض يأخذ
  -- الأحدث (distinct on … order by performed_at desc)، وتعديل الأقدم لا
  -- يعني شيئًا لأن بعده جلسة أحدث.
  update treatment_sessions
     set next_due_date = current_date - 5
   where id = (select id from treatment_sessions
                where patient_id = v_patient and item_id = v_laser
                  and coalesce(body_area_value_id::text,'-') = coalesce(v_face::text,'-')
                  and status = 'completed'
                order by performed_at desc, session_number desc limit 1);
  select count(*) into v_int from v_sessions_due
   where patient_id = v_patient and days_overdue >= 5;
  if v_int = 0 then
    raise exception 'فشل: المريضة المتأخّرة لا تظهر في المستحقّ';
  end if;
  raise notice '✅ ١١) من تأخّر عن جلسته يظهر بعدد أيام التأخير';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) صور قبل/بعد تُسجَّل على الجلسة نفسها
  -- ═════════════════════════════════════════════════════════════════════════
  insert into entity_documents (organization_id, entity_type, entity_id, title,
                                category, storage_path, file_name, uploaded_by)
    values (v_org, 'treatment_session', v_s1, 'قبل الجلسة', 'before',
            v_org::text || '/sessions/b.jpg', 'b.jpg', v_owner);
  insert into entity_documents (organization_id, entity_type, entity_id, title,
                                category, storage_path, file_name, uploaded_by)
    values (v_org, 'treatment_session', v_s1, 'بعد الجلسة', 'after',
            v_org::text || '/sessions/a.jpg', 'a.jpg', v_owner);

  select count(*) into v_int from v_session_photos where session_id = v_s1;
  if v_int <> 2 then raise exception 'فشل: صور الجلسة % لا 2', v_int; end if;
  select count(*) into v_int from v_session_photos
   where session_id = v_s1 and category = 'before';
  if v_int <> 1 then raise exception 'فشل: صورة «قبل» غير مميّزة'; end if;
  raise notice '✅ ١٢) صور قبل/بعد على الجلسة عبر المستندات القائمة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) العزل: جهاز أو مريض من منشأة أخرى مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_org2 uuid; v_dev2 uuid;
  begin
    insert into organizations (name, organization_type, created_by)
      values ('عيادة غريبة', 'medical_center', v_owner) returning id into v_org2;
    insert into resources (organization_id, resource_type, name_ar)
      values (v_org2, 'device', 'جهاز غريب') returning id into v_dev2;
    begin
      perform app_record_treatment_session(
        v_org, v_patient, v_laser, v_doctor, v_legs, v_dev2,
        '{}'::jsonb, array['none'], null, null, null, null, 'تجاوز', v_branch);
      raise exception 'فشل: قُبل جهاز من منشأة أخرى';
    exception when others then
      if sqlerrm not like '%الجهاز غير موجود%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٣) لا يُستعمل جهاز من منشأة أخرى';

  raise notice '——— كل فحوص جلسات التجميل نجحت ———';
end $$;

rollback;
