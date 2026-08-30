-- ---------------------------------------------------------------------------
-- اختبارات الأقسام والعيادات — 0080
-- ---------------------------------------------------------------------------
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا مهما نجح أو فشل.
--
-- التشغيل:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/structure-guards.test.sql
--
-- أحد عشر فحصًا: الشجرة ترفض الدورة، والقسم لا يكون أبًا لنفسه، والعيادة لا
-- تُربط بفرع منشأة أخرى، والتحديث الجزئي لا يمحو الحقول، واللون يُتحقّق منه،
-- والتعطيل يُلزم بسبب ويعدّ المواعيد القادمة ويرفض بلا تأكيد، والقسم لا
-- يُعطَّل وله عيادة نشطة، ومن لا يملك الصلاحية لا يكتب.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_org2    uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_branch  uuid;
  v_branch2 uuid;
  v_dept    uuid;
  v_child   uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_json    jsonb;
  v_txt     text;
  v_int     int;
begin
  -- ── تهيئة
  insert into auth.users (id, email) values (gen_random_uuid(), 'struct-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'struct-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الهيكل', 'clinic', v_owner) returning id into v_org;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة أخرى', 'clinic', v_owner) returning id into v_org2;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);
  insert into branches (organization_id, name, code) values (v_org, 'فرع أ', 'ST-A')
    returning id into v_branch;
  insert into branches (organization_id, name, code) values (v_org2, 'فرع غريب', 'ST-F')
    returning id into v_branch2;

  -- ── 1) إنشاء قسم وقسم فرعي
  v_dept := app_save_department(v_org, null,
    '{"name_ar":"قسم الاختبار","code":"ST-D","department_type":"clinical"}'::jsonb);
  v_child := app_save_department(v_org, null,
    jsonb_build_object('name_ar','قسم فرعي','code','ST-D2','parent_department_id', v_dept));

  if (select parent_department_id from departments where id = v_child) <> v_dept then
    raise exception 'فشل: القسم الفرعي لم يرتبط بأبيه';
  end if;
  raise notice '✅ شجرة الأقسام';

  -- ── 2) الدورة مرفوضة
  begin
    perform app_save_department(v_org, v_dept,
      jsonb_build_object('parent_department_id', v_child));
    raise exception 'فشل: قُبلت دورة في الشجرة';
  exception when others then
    if sqlerrm not like '%دورة%' then raise; end if;
    raise notice '✅ الدورة في الشجرة مرفوضة';
  end;

  -- ── 3) القسم لا يكون أبًا لنفسه
  begin
    perform app_save_department(v_org, v_dept, jsonb_build_object('parent_department_id', v_dept));
    raise exception 'فشل: قُبل قسم أبٌ لنفسه';
  exception when others then
    if sqlerrm not like '%أبًا لنفسه%' and sqlerrm not like '%دورة%' then raise; end if;
    raise notice '✅ القسم لا يكون أبًا لنفسه';
  end;

  -- ── 4) عيادة بفرع من منشأة أخرى مرفوضة
  begin
    perform app_save_clinic(v_org, null, jsonb_build_object(
      'name','عيادة غريبة','code','ST-CX','branch_id', v_branch2));
    raise exception 'فشل: قُبل فرع من منشأة أخرى';
  exception when others then
    if sqlerrm not like '%لا ينتمي لهذه المنشأة%' then raise; end if;
    raise notice '✅ الفرع الغريب مرفوض';
  end;

  -- ── 5) إنشاء عيادة كاملة
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
    'name','عيادة الاختبار','code','ST-C1',
    'branch_id', v_branch, 'department_id', v_dept,
    'default_visit_duration','25','color','#123ABC','capacity','3'));

  select default_visit_duration into v_int from clinics where id = v_clinic;
  if v_int <> 25 then raise exception 'فشل: المدة لم تُحفظ (%)', v_int; end if;
  raise notice '✅ إنشاء العيادة';

  -- ── 6) التحديث الجزئي لا يمحو ما لم يُمرَّر
  --
  -- هذا العيب وقعتُ فيه فعلًا: مفتاحٌ غائب عن الحمولة كان يساوي null،
  -- فتحديثُ الاسم وحده يمحو الفرع والقسم والمدة.
  perform app_save_clinic(v_org, v_clinic, '{"name":"عيادة الاختبار المعدَّلة"}'::jsonb);
  select default_visit_duration into v_int from clinics where id = v_clinic;
  if v_int is distinct from 25 then
    raise exception 'فشل: التحديث الجزئي محا المدة';
  end if;
  if (select branch_id from clinics where id = v_clinic) is distinct from v_branch then
    raise exception 'فشل: التحديث الجزئي محا الفرع';
  end if;
  if (select department_id from clinics where id = v_clinic) is distinct from v_dept then
    raise exception 'فشل: التحديث الجزئي محا القسم';
  end if;
  raise notice '✅ التحديث الجزئي يحافظ على الحقول';

  -- ── 7) لون غير صالح مرفوض برسالة عربية
  begin
    perform app_save_clinic(v_org, v_clinic, '{"color":"أزرق"}'::jsonb);
    raise exception 'فشل: قُبل لون غير صالح';
  exception when others then
    if sqlerrm not like '%#RRGGBB%' then raise; end if;
    raise notice '✅ اللون يُتحقّق منه';
  end;

  -- ── 8) التعطيل بلا سبب مرفوض
  begin
    perform app_disable_clinic(v_clinic, '   ');
    raise exception 'فشل: قُبل تعطيل بلا سبب';
  exception when others then
    if sqlerrm not like '%سبب التعطيل مطلوب%' then raise; end if;
    raise notice '✅ التعطيل يُلزم بسبب';
  end;

  -- ── 9) التعطيل مع موعد قادم مرفوض بلا تأكيد
  insert into patients (organization_id, name_ar) values (v_org, 'مريض الهيكل')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar, clinic_id) values (v_org, 'طبيب الهيكل', v_clinic)
    returning id into v_doctor;
  insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                            scheduled_start, scheduled_end, status)
  values (v_org, v_patient, v_doctor, v_clinic,
          now() + interval '6 days', now() + interval '6 days 25 min', 'scheduled');

  if app_clinic_future_appointments(v_clinic) <> 1 then
    raise exception 'فشل: عدّاد المواعيد القادمة خاطئ';
  end if;

  begin
    perform app_disable_clinic(v_clinic, 'إغلاق');
    raise exception 'فشل: قُبل التعطيل مع موعد قادم بلا تأكيد';
  exception when others then
    if sqlerrm not like '%موعدًا قادمًا%' then raise; end if;
    raise notice '✅ التعطيل مع موعد قادم يحتاج تأكيدًا';
  end;

  v_json := app_disable_clinic(v_clinic, 'إغلاق مؤقت', true);
  if not (select is_disabled from clinics where id = v_clinic) then
    raise exception 'فشل: التعطيل المؤكَّد لم يسرِ';
  end if;
  if (v_json ->> 'future_appointments')::int <> 1 then
    raise exception 'فشل: الدالة لم تُعِد عدد المواعيد';
  end if;
  raise notice '✅ التعطيل المؤكَّد يسري ويُعيد العدد';

  -- ── 10) القسم لا يُعطَّل وله عيادة نشطة
  perform app_enable_clinic(v_clinic);
  begin
    update departments set is_active = false where id = v_dept;
    raise exception 'فشل: عُطِّل قسم له عيادة نشطة';
  exception when others then
    if sqlerrm not like '%عيادة نشطة%' then raise; end if;
    raise notice '✅ القسم لا يُعطَّل وله عيادة نشطة';
  end;

  -- ── 11) من لا يملك الصلاحية لا يكتب
  perform set_config('request.jwt.claim.sub', v_recep::text, true);

  if (select count(*) from departments where organization_id = v_org) < 2 then
    raise exception 'فشل: موظف الاستقبال لا يرى الأقسام';
  end if;

  begin
    perform app_save_department(v_org, null, '{"name_ar":"تسلل"}'::jsonb);
    raise exception 'فشل: موظف الاستقبال أنشأ قسمًا';
  exception when others then
    if sqlerrm not like '%صلاحيتك%' then raise; end if;
    raise notice '✅ موظف الاستقبال يقرأ ولا يكتب';
  end;

  begin
    perform app_disable_clinic(v_clinic, 'محاولة');
    raise exception 'فشل: موظف الاستقبال عطّل عيادة';
  exception when others then
    if sqlerrm not like '%صلاحيتك%' then raise; end if;
    raise notice '✅ التعطيل يحتاج صلاحية';
  end;

  raise notice '——— كل فحوص الهيكل نجحت ———';
end $$;

rollback;
