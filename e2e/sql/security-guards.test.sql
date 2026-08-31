-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الأمان والتدقيق وحماية البيانات — 0095
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/security-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- الثغرة الأمنية لا تُعلن عن نفسها في الاستخدام اليومي؛ النظام يعمل تمامًا
-- وهي مفتوحة. لذلك كل فحص هنا يحاول **الاختراق فعلًا** ويتوقّع الرفض، بدل
-- أن يتحقّق من وجود سياسة مكتوبة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid;
  v_owner    uuid;
  v_branch   uuid;
  v_patient  uuid;
  v_doctor   uuid;
  v_clinic   uuid;
  v_visit    uuid;
  v_consent  uuid;
  v_consent2 uuid;
  v_access   uuid;
  v_policy   uuid;
  v_int      int;
  v_txt      text;
  v_json     jsonb;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'sec-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار الأمان', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','SC1','name','عيادة الأمان','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب الأمان')
    returning id into v_doctor;
  insert into patients (organization_id, branch_id, name_ar, id_number, phone_1, email_1,
                        birth_date)
    values (v_org, v_branch, 'مريض الخصوصية', '1234567890', '0500000000',
            'p@test.local', date '1990-05-20')
    returning id into v_patient;
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
    returning id into v_visit;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) لا دالّة SECURITY DEFINER مفتوحة أمام anon
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');
  if v_int > 0 then
    raise exception 'فشل: % دالّة SECURITY DEFINER قابلة للاستدعاء من anon — تتخطّى RLS بلا مستخدم', v_int;
  end if;
  raise notice '✅ ١) لا دالّة تتخطّى RLS مفتوحة أمام زائر غير مسجَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) كل دالّة SECURITY DEFINER بمسار بحث مثبَّت
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), string_agg(p.proname, ', ') into v_int, v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%';
  if v_int > 0 then
    raise exception 'فشل: % دالّة بلا search_path مثبَّت: %', v_int, left(v_txt, 300);
  end if;
  raise notice '✅ ٢) كل دالّة أمنية بمسار بحث مثبَّت — لا اختطاف للمسار';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) كل جدول عليه RLS، وكل منظور بـ security_invoker
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), string_agg(c.relname, ', ') into v_int, v_txt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_int > 0 then
    raise exception 'فشل: % جدول بلا RLS: %', v_int, left(v_txt, 300);
  end if;

  select count(*), string_agg(c.relname, ', ') into v_int, v_txt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_%'
     and coalesce(c.reloptions::text, '') not like '%security_invoker=on%';
  if v_int > 0 then
    raise exception 'فشل: % منظور بلا security_invoker: %', v_int, left(v_txt, 300);
  end if;
  raise notice '✅ ٣) كل جدول محميّ بـ RLS، وكل منظور يقرأ بصلاحية المستخدم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) سجل التدقيق يحفظ القيم قبل وبعد، والفرع، والوقت، والمستخدم
  -- ═════════════════════════════════════════════════════════════════════════
  update patients set name_ar = 'مريض الخصوصية معدَّل' where id = v_patient;

  select details, branch_id into v_json, v_txt
    from audit_log
   where entity_id = v_patient and action_type = 'update'
   order by occurred_at desc limit 1;

  if v_json is null then
    raise exception 'فشل: التعديل لم يُسجَّل في التدقيق';
  end if;
  if v_json->'name_ar'->>'old' is null or v_json->'name_ar'->>'new' is null then
    raise exception 'فشل: التدقيق لا يحفظ القيمة قبل وبعد — %', v_json;
  end if;
  if v_json->'name_ar'->>'old' = v_json->'name_ar'->>'new' then
    raise exception 'فشل: القيمة قبل وبعد متطابقتان';
  end if;
  if v_txt is null then
    raise exception 'فشل: سجل التدقيق بلا فرع — لا يمكن عزل مراجعة الفرع';
  end if;
  if (select organization_id from audit_log where entity_id = v_patient
       order by occurred_at desc limit 1) is distinct from v_org then
    raise exception 'فشل: سجل التدقيق بلا منشأة';
  end if;
  raise notice '✅ ٤) التدقيق يحفظ القيم قبل وبعد والفرع والمنشأة والوقت';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) سجل الوصول للملف الطبي: يُكتب، ولا يُعدَّل، ولا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  v_access := app_log_record_access(v_patient, 'view', 'ملف المريض', null, v_visit);
  if v_access is null then
    raise exception 'فشل: الاطّلاع لم يُسجَّل';
  end if;
  if (select user_id from medical_record_access_log where id = v_access) is distinct from v_owner then
    raise exception 'فشل: سجل الاطّلاع بلا صاحبه';
  end if;
  if (select branch_id from medical_record_access_log where id = v_access) is distinct from v_branch then
    raise exception 'فشل: سجل الاطّلاع بلا فرع الزيارة';
  end if;

  begin
    update medical_record_access_log set access_type = 'print' where id = v_access;
    raise exception 'فشل: عُدّل سجل الوصول — سجلٌّ يمكن تعديله ليس سجلًّا';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُعدَّل%' then raise; end if;
  end;
  begin
    delete from medical_record_access_log where id = v_access;
    raise exception 'فشل: حُذف سجل الوصول';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُعدَّل%' then raise; end if;
  end;
  raise notice '✅ ٥) الاطّلاع يُسجَّل، والسجل لا يُعدَّل ولا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الموافقات: غرضٌ إلزاميّ، ونسخةٌ متصاعدة، وواحدة سارية لكل غرض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_record_patient_consent(v_patient, 'data_processing', '   ');
    raise exception 'فشل: قُبلت موافقة بلا غرض';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%الغرض%' then raise; end if;
  end;

  v_consent := app_record_patient_consent(
    v_patient, 'data_processing', 'معالجة البيانات لأغراض العلاج والفوترة');
  if (select version from patient_consents where id = v_consent) <> 1 then
    raise exception 'فشل: نسخة الموافقة الأولى ليست ١';
  end if;

  -- موافقة ثانية لنفس الغرض: الأولى تُستبدَل ولا تُحذف
  v_consent2 := app_record_patient_consent(
    v_patient, 'data_processing', 'صيغة محدَّثة من الغرض نفسه');
  if (select status from patient_consents where id = v_consent) <> 'superseded' then
    raise exception 'فشل: الموافقة السابقة لم تُستبدَل';
  end if;
  if not exists (select 1 from patient_consents where id = v_consent) then
    raise exception 'فشل: حُذفت الموافقة السابقة — الشاهد ضاع';
  end if;
  if (select version from patient_consents where id = v_consent2) <> 2 then
    raise exception 'فشل: النسخة لم تتصاعد';
  end if;
  select count(*) into v_int from patient_consents
   where patient_id = v_patient and consent_type = 'data_processing' and status = 'granted';
  if v_int <> 1 then
    raise exception 'فشل: % موافقة سارية لغرض واحد — لا يُعرف المعمول به', v_int;
  end if;
  raise notice '✅ ٦) الموافقة بغرضها ونسختها، وواحدةٌ سارية لكل غرض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) السحب: بسببٍ إلزاميّ، ويُبطل السريان، ويُسجَّل
  -- ═════════════════════════════════════════════════════════════════════════
  if not app_has_patient_consent(v_patient, 'data_processing') then
    raise exception 'فشل: الموافقة السارية لا تُقرأ سارية';
  end if;
  begin
    perform app_withdraw_patient_consent(v_consent2, '  ');
    raise exception 'فشل: سُحبت موافقة بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب%' then raise; end if;
  end;
  perform app_withdraw_patient_consent(v_consent2, 'طلب المريض');
  if app_has_patient_consent(v_patient, 'data_processing') then
    raise exception 'فشل: الموافقة المسحوبة ما زالت سارية';
  end if;
  if not exists (select 1 from audit_log
                  where entity_id = v_consent2 and module = 'privacy'
                    and reason = 'طلب المريض') then
    raise exception 'فشل: السحب لم يُسجَّل بسببه في التدقيق';
  end if;
  raise notice '✅ ٧) السحب بسببه، يُبطل السريان، ويُترك أثره في التدقيق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الموافقة المنتهية ليست سارية ولو لم تُسحب
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_expired uuid;
  begin
    v_expired := app_record_patient_consent(
      v_patient, 'marketing', 'تسويق', now() - interval '1 day');
    if app_has_patient_consent(v_patient, 'marketing') then
      raise exception 'فشل: موافقة منتهية تُقرأ سارية — أخطر من غيابها';
    end if;
  end;
  raise notice '✅ ٨) الموافقة المنتهية غير سارية ولو بقيت مسجَّلة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) سياسات الاحتفاظ: لا حذف نهائيّ، ولا سياسة بلا سند نظاميّ
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into data_retention_policies (organization_id, entity_key, retention_months,
                                         action_on_expiry, legal_basis)
    values (v_org, 'patient_records', 120, 'archive', '  ');
    raise exception 'فشل: قُبلت سياسة بلا سند نظاميّ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%السند النظامي%' then raise; end if;
  end;

  insert into data_retention_policies (organization_id, entity_key, retention_months,
                                       action_on_expiry, legal_basis)
  values (v_org, 'patient_records', 120, 'archive',
          'نظام مزاولة المهن الصحية — الاحتفاظ بالملف عشر سنوات')
  returning id into v_policy;

  -- قائمة الإجراءات لا تحتمل حذفًا أصلًا
  begin
    update data_retention_policies set action_on_expiry = 'delete' where id = v_policy;
    raise exception 'فشل: قُبل إجراء حذف نهائيّ لسياسة احتفاظ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    -- يرفضه إمّا قيد القائمة وإمّا الحارس الصريح — كلاهما مقبول
    null;
  end;

  -- سياسة سارية واحدة لكل نوع بيانات
  begin
    insert into data_retention_policies (organization_id, entity_key, retention_months,
                                         action_on_expiry, legal_basis)
    values (v_org, 'patient_records', 60, 'anonymize', 'سند آخر');
    raise exception 'فشل: سياستان ساريتان لنفس نوع البيانات';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ٩) الاحتفاظ بسند نظاميّ، بلا حذف نهائيّ، وسياسة واحدة لكل نوع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- ٩-ب) حساب أثر السياسة يُحصي ولا يعدّل صفًّا واحدًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_visits_before int;
    v_visits_after  int;
    v_affected      int;
  begin
    select count(*) into v_visits_before from patient_visits where organization_id = v_org;

    -- سياسة بمدّة صفرية عمليًّا: نُقصّرها لشهر واحد ونُقدّم تاريخ الزيارة
    update data_retention_policies set retention_months = 1 where id = v_policy;
    update patient_visits set created_at = now() - interval '2 years'
     where id = v_visit;

    v_affected := app_apply_retention_policy(v_policy);
    if v_affected < 1 then
      raise exception 'فشل: حساب الأثر لم يعدّ الزيارة المتجاوزة للمدّة';
    end if;

    select count(*) into v_visits_after from patient_visits where organization_id = v_org;
    if v_visits_after <> v_visits_before then
      raise exception 'فشل: حساب الأثر حذف بيانات — المطلوب إحصاء لا تعديل (% ← %)',
        v_visits_before, v_visits_after;
    end if;

    if (select last_run_at from data_retention_policies where id = v_policy) is null then
      raise exception 'فشل: وقت آخر مراجعة لم يُختم';
    end if;
    if not exists (select 1 from audit_log
                    where entity_id = v_policy and module = 'privacy') then
      raise exception 'فشل: المراجعة لم تُسجَّل في التدقيق';
    end if;
  end;
  raise notice '✅ ٩-ب) حساب أثر الاحتفاظ يُحصي ويُوثَّق، ولا يحذف صفًّا واحدًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) مستشار الأمان لا يرفع أي نتيجة حرجة
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*), string_agg(distinct finding_type, ', ') into v_int, v_txt
    from v_security_advisor where severity = 'خطر';
  if v_int > 0 then
    raise exception 'فشل: مستشار الأمان يرفع % نتيجة حرجة: %', v_int, v_txt;
  end if;
  raise notice '✅ ١٠) مستشار الأمان بلا نتائج حرجة';

  raise notice '——— كل فحوص الأمان (المالك) نجحت ———';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- الإخفاء حسب الدور يُختبر بدور `authenticated`: RLS ودوال الصلاحيات
-- لا تُطبَّق على مالك القاعدة.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_patient uuid;
begin
  select id into v_owner from auth.users where email = 'sec-owner@test.local';
  select id into v_org from organizations where name = 'منشأة اختبار الأمان';
  select id into v_patient from patients where organization_id = v_org limit 1;

  insert into auth.users (id, email) values (gen_random_uuid(), 'sec-recep@test.local')
    returning id into v_recep;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);

  perform set_config('request.jwt.claim.sub', v_recep::text, true);
end $$;

set local role authenticated;

do $$
declare
  v_id  text;
  v_dob date;
  v_age int;
begin
  -- الاستقبال يملك `patients.view_identity` افتراضيًّا: يرى الهوية
  select id_number, birth_date, age_years into v_id, v_dob, v_age
    from v_patient_directory limit 1;
  if v_id is null then
    raise exception 'فشل: الاستقبال لا يرى شيئًا من دليل المرضى';
  end if;
  if v_id like '%•%' then
    raise exception 'فشل: أُخفيت الهوية عمّن يملك صلاحيتها';
  end if;
  raise notice '✅ ١١) صاحب صلاحية الهوية يراها كاملةً';
end $$;

reset role;

-- نزع صلاحية الهوية عن الاستقبال، ثم إعادة القراءة بدوره
do $$
declare v_org uuid; v_recep uuid; v_owner uuid;
begin
  select id into v_owner from auth.users where email = 'sec-owner@test.local';
  select id into v_recep from auth.users where email = 'sec-recep@test.local';
  select id into v_org  from organizations where name = 'منشأة اختبار الأمان';
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  delete from role_default_permissions
   where role_key = 'receptionist' and permission_key = 'patients.view_identity';
  delete from membership_permissions
   where organization_id = v_org and user_id = v_recep
     and permission_key = 'patients.view_identity';

  perform set_config('request.jwt.claim.sub', v_recep::text, true);
end $$;

set local role authenticated;

do $$
declare
  v_id   text;
  v_dob  date;
  v_age  int;
  v_flag boolean;
begin
  select id_number, birth_date, age_years, identity_visible
    into v_id, v_dob, v_age, v_flag
    from v_patient_directory limit 1;

  if v_flag then
    raise exception 'فشل: الصلاحية نُزعت وما زال العلم يقول إنها ظاهرة';
  end if;
  -- **الإخفاء في القاعدة لا في الواجهة**: القيمة الأصلية لا تصل أصلًا
  if v_id is null or v_id not like '%•%' then
    raise exception 'فشل: الهوية وصلت غير مُخفاة لمن لا يملك صلاحيتها (%)', v_id;
  end if;
  if v_dob is not null then
    raise exception 'فشل: تاريخ الميلاد الدقيق وصل لمن لا يملك صلاحية الهوية';
  end if;
  -- العمر ضرورة سريرية ويبقى ظاهرًا
  if v_age is null then
    raise exception 'فشل: العمر أُخفي وهو ضرورة سريرية لا معرّف شخصيّ';
  end if;
  raise notice '✅ ١٢) الإخفاء يقع في القاعدة: القيمة لا تصل، والعمر يبقى';
end $$;

do $$
declare v_org uuid;
begin
  -- المستخدم بلا صلاحية `privacy.consents` لا يسجّل موافقة
  select id into v_org from organizations where name = 'منشأة اختبار الأمان';
  begin
    perform app_record_patient_consent(
      (select id from patients where organization_id = v_org limit 1),
      'research', 'بحث');
    raise exception 'فشل: سُجّلت موافقة بلا صلاحية';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%privacy.consents%' then raise; end if;
  end;
  raise notice '✅ ١٣) الموافقات لا تُسجَّل بلا صلاحيتها';
  raise notice '——— كل فحوص الأمان نجحت ———';
end $$;

reset role;

rollback;
