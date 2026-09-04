-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات بوابة المريض — 0104
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/portal-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS**: الربط يدويّ من موظف بعد التحقّق من الهوية.
--
-- هذه أخطر واجهة في النظام: مستخدمٌ من خارج المنشأة يقرأ سجلًّا طبيًّا.
-- الفحوص تحاول تحديدًا: رؤية ملف مريضٍ آخر، ورؤية نتيجة لم تُعتمد، والكتابة
-- في تقويم المواعيد، وتعديل بيانات الهوية ذاتيًّا — وتتوقّع المنع في كلٍّ منها.
--
-- ملاحظة تقنية: RLS لا تنطبق على مالك الجداول، فاختبارات المنع تُنفَّذ
-- بـ `set local role authenticated` خارج كتلة DO.
-- ---------------------------------------------------------------------------

begin;

-- صلاحيات دور authenticated في قاعدة الاختبار
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_pu      uuid;   -- مستخدم بوابة المريض
  v_pu2     uuid;   -- مستخدم بوابة مريض آخر
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_p1      uuid;
  v_p2      uuid;
  v_acct    uuid;
  v_appt    uuid;
  v_lab     uuid;
  v_test    uuid;
  v_req     uuid;
  v_int     integer;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pt-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'patient1@test.local')
    returning id into v_pu;
  insert into auth.users (id, email) values (gen_random_uuid(), 'patient2@test.local')
    returning id into v_pu2;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار البوابة', 'medical_center', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','PT1','name','عيادة الباطنة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'د. سعيد')
    returning id into v_doctor;
  insert into patients (organization_id, name_ar, phone_1)
    values (v_org, 'مريض البوابة', '0500000001') returning id into v_p1;
  insert into patients (organization_id, name_ar, phone_1)
    values (v_org, 'مريض آخر', '0500000002') returning id into v_p2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الربط: لا يُنشأ حساب من النظام، ولا يُربط موظف كمريض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_link_patient_portal_account(v_p1, 'ghost@test.local');
    raise exception 'فشل: رُبط بريد بلا حساب مسجَّل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%يسجّل المريض بنفسه%' then raise; end if;
  end;

  begin
    perform app_link_patient_portal_account(v_p1, 'pt-owner@test.local');
    raise exception 'فشل: رُبط حساب موظف كحساب مريض';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%موظف في المنشأة%' then raise; end if;
  end;

  v_acct := app_link_patient_portal_account(v_p1, 'patient1@test.local');
  perform app_link_patient_portal_account(v_p2, 'patient2@test.local');
  if v_acct is null then raise exception 'فشل: لم يُربط الحساب'; end if;
  raise notice '✅ ١) الربط يدويّ بعد تحقّق، ولا يُنشئ حسابًا ولا يربط موظفًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) هوية الجلسة: كل مستخدم يُعرَف بمريضه هو
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  if app_portal_patient_id(v_org) <> v_p1 then
    raise exception 'فشل: هوية البوابة لا تطابق المريض المربوط';
  end if;
  if app_is_portal_patient(v_org, v_p2) then
    raise exception 'فشل: مستخدم البوابة يُعدّ صاحب ملف مريض آخر';
  end if;
  raise notice '✅ ٢) هوية البوابة مربوطة بملف واحد لا غير';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) طلب الموعد: لا حجز مباشر، وحدّ للطلبات المفتوحة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                           current_date - 5, 'any', 'ألم');
    raise exception 'فشل: قُبل طلب موعد في تاريخ ماضٍ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%تاريخ ماضٍ%' then raise; end if;
  end;

  v_req := app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                          current_date + 3, 'morning', 'متابعة');
  perform app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                         current_date + 4, 'any', 'متابعة 2');
  perform app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                         current_date + 5, 'any', 'متابعة 3');
  begin
    perform app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                           current_date + 6, 'any', 'متابعة 4');
    raise exception 'فشل: لا حدّ لعدد الطلبات المفتوحة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%3 طلبات%' then raise; end if;
  end;

  -- الطلب لم يُنشئ موعدًا في التقويم
  if exists (select 1 from appointments where patient_id = v_p1) then
    raise exception 'فشل: طلب المريض أنشأ موعدًا مباشرة في التقويم';
  end if;
  raise notice '✅ ٣) الطلب لا يحجز موعدًا، ولا يُقبل في الماضي، ومحدود العدد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) المراجعة: الرفض بسبب، والاعتماد ينشئ الموعد مرّة واحدة
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform app_reject_appointment_request(v_req, '   ');
    raise exception 'فشل: رُفض طلب بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب الرفض مطلوب%' then raise; end if;
  end;

  v_appt := app_approve_appointment_request(
              v_req, (current_date + 3)::timestamptz + interval '10 hours',
              (current_date + 3)::timestamptz + interval '10 hours 30 minutes',
              v_doctor, v_clinic, 'تم الحجز');
  if v_appt is null then raise exception 'فشل: الاعتماد لم يُنشئ موعدًا'; end if;
  if (select status from appointment_requests where id = v_req) <> 'approved' then
    raise exception 'فشل: حالة الطلب لم تتغيّر بعد الاعتماد';
  end if;
  begin
    perform app_approve_appointment_request(
      v_req, (current_date + 4)::timestamptz, (current_date + 4)::timestamptz + interval '1 hour');
    raise exception 'فشل: اعتُمد الطلب مرّتين فأنشأ موعدين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُراجع مرّتين%' then raise; end if;
  end;
  raise notice '✅ ٤) المراجعة تُنشئ الموعد مرّة واحدة، والرفض يحتاج سببًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الإلغاء من البوابة: موعده هو، وفي المستقبل، وبسبب
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_pu2::text, true);
  begin
    perform app_portal_cancel_appointment(v_appt, 'لا أريده');
    raise exception 'فشل: ألغى مريضٌ موعد مريضٍ آخر';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%ليس لك%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  begin
    perform app_portal_cancel_appointment(v_appt, '  ');
    raise exception 'فشل: أُلغي موعد بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب الإلغاء مطلوب%' then raise; end if;
  end;

  perform app_portal_cancel_appointment(v_appt, 'ظرف طارئ');
  if (select status from appointments where id = v_appt) <> 'cancelled_by_patient' then
    raise exception 'فشل: لم يُلغَ الموعد';
  end if;
  raise notice '✅ ٥) الإلغاء لصاحب الموعد وحده، بسبب، وقبل موعده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) طلب تعديل البيانات يُراجع ولا يُطبَّق ذاتيًّا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_chg uuid;
  begin
    v_chg := app_portal_request_change(v_org, 'phone_1', '0555555555');
    if (select phone_1 from patients where id = v_p1) = '0555555555' then
      raise exception 'فشل: طُبّق التعديل قبل المراجعة';
    end if;

    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    perform app_decide_patient_change_request(v_chg, true, null);
    if (select phone_1 from patients where id = v_p1) <> '0555555555' then
      raise exception 'فشل: لم يُطبَّق التعديل بعد الاعتماد';
    end if;
    begin
      perform app_decide_patient_change_request(v_chg, true, null);
      raise exception 'فشل: رُوجع الطلب مرّتين';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا يُراجع مرّتين%' then raise; end if;
    end;
  end;
  raise notice '✅ ٦) تعديل بيانات المريض يمرّ بمراجعة موظف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) تجهيز نتيجة مختبر غير معتمدة (للفحص التالي خارج الكتلة)
  -- ═════════════════════════════════════════════════════════════════════════
  v_test := app_save_lab_test(v_org, null, jsonb_build_object(
              'name_ar','صورة دم','code','CBC','specimen_type','blood','price','120'));
  insert into lab_orders (organization_id, branch_id, patient_id, ordering_doctor_id,
                          status, ordered_at)
    values (v_org, v_branch, v_p1, v_doctor, 'in_progress', now())
    returning id into v_lab;
  insert into lab_order_items (organization_id, lab_order_id, lab_test_id, result_value,
                               entered_at)
    values (v_org, v_lab, v_test, '12.5', now());

  -- المعرّفات تُمرَّر عبر إعدادات الجلسة: كتلة RLS التالية تعمل بدور
  -- `authenticated` الذي لا يقرأ من مخطّط auth ولا يرى جدول المرضى كاملًا.
  perform set_config('test.org', v_org::text, true);
  perform set_config('test.p1',  v_p1::text,  true);
  perform set_config('test.p2',  v_p2::text,  true);
  perform set_config('test.pu',  v_pu::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.lab', v_lab::text, true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ٧) بيانات الاختبار جاهزة: نتيجة قيد التنفيذ لم تُعتمد بعد';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- الفحوص التي تحتاج RLS فعليًّا: تُنفَّذ بدور authenticated
-- ═══════════════════════════════════════════════════════════════════════════
set local role authenticated;

do $$
declare
  v_pu   uuid;
  v_p1   uuid;
  v_p2   uuid;
  v_org  uuid;
  v_lab  uuid;
  v_seen integer;
begin
  v_pu  := current_setting('test.pu')::uuid;
  v_org := current_setting('test.org')::uuid;
  v_p1  := current_setting('test.p1')::uuid;
  v_p2  := current_setting('test.p2')::uuid;
  perform set_config('request.jwt.claim.sub', v_pu::text, true);

  -- 8) ملفّه يظهر، وملف غيره لا
  select count(*) into v_seen from patients where id = v_p1;
  if v_seen <> 1 then raise exception 'فشل: المريض لا يرى ملفه (%)', v_seen; end if;
  select count(*) into v_seen from patients where id = v_p2;
  if v_seen <> 0 then raise exception 'فشل: المريض يرى ملف مريضٍ آخر'; end if;
  raise notice '✅ ٨) المريض يرى ملفه وحده';

  -- 9) **النتيجة غير المعتمدة لا تُعرض**
  select count(*) into v_seen from lab_orders where patient_id = v_p1;
  if v_seen <> 0 then
    raise exception 'فشل: ظهرت نتيجة مختبر لم تُعتمد بعد (%)', v_seen;
  end if;
  select count(*) into v_seen from v_portal_results;
  if v_seen <> 0 then
    raise exception 'فشل: منظور النتائج يعرض ما لم يُعتمد';
  end if;
  raise notice '✅ ٩) النتيجة قيد التنفيذ محجوبة عن المريض';

  -- 10) **المريض لا يكتب في التقويم ولا في ملفه**
  begin
    insert into appointments (organization_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status)
      values (v_org, null, null, v_p1, now() + interval '1 day',
              now() + interval '1 day 30 minutes', 'scheduled');
    raise exception 'فشل: حجز المريض موعدًا مباشرة في التقويم';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  begin
    update patients set name_ar = 'اسم جديد' where id = v_p1;
    if found then
      raise exception 'فشل: عدّل المريض اسمه في ملفه';
    end if;
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  if (select name_ar from patients where id = v_p1) <> 'مريض البوابة' then
    raise exception 'فشل: تغيّر اسم المريض من البوابة';
  end if;
  raise notice '✅ ١٠) المريض لا يكتب في التقويم ولا يعدّل هويته';

  -- 11) لا يرى قوائم النظام الداخلية
  select count(*) into v_seen from items;
  if v_seen > 0 then
    raise exception 'فشل: المريض يرى كتالوج الخدمات الداخلي';
  end if;
  select count(*) into v_seen from employees;
  if v_seen > 0 then
    raise exception 'فشل: المريض يرى بيانات الموظفين';
  end if;
  select count(*) into v_seen from audit_log;
  if v_seen > 0 then
    raise exception 'فشل: المريض يرى سجل التدقيق';
  end if;
  raise notice '✅ ١١) المريض لا يرى الكتالوج ولا الموظفين ولا سجل التدقيق';
end $$;

reset role;

do $$
declare
  v_org  uuid; v_p1 uuid; v_lab uuid; v_owner uuid; v_pu uuid; v_acct uuid;
  v_seen integer;
begin
  v_org   := current_setting('test.org')::uuid;
  v_owner := current_setting('test.owner')::uuid;
  v_pu    := current_setting('test.pu')::uuid;
  v_p1    := current_setting('test.p1')::uuid;
  v_lab   := current_setting('test.lab')::uuid;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- 12) بعد الاعتماد تظهر النتيجة
  update lab_orders set status = 'approved' where id = v_lab;
  select id into v_acct from patient_portal_accounts
   where organization_id = v_org and patient_id = v_p1;
  perform app_revoke_patient_portal_access(v_acct, 'انتهاء الحاجة');
  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  if app_portal_patient_id(v_org) is not null then
    raise exception 'فشل: الحساب الملغى ما زال يُعرَّف كمريض';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform app_link_patient_portal_account(v_p1, 'patient1@test.local');
  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  if app_portal_patient_id(v_org) <> v_p1 then
    raise exception 'فشل: إعادة الربط لم تُعد الوصول';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ١٢) إلغاء الوصول يقطعه فورًا، وإعادة الربط تُعيده';

  -- 13) الميزة والصلاحيات ومنظور الطلبات المعلّقة
  if not exists (select 1 from feature_catalog where feature_key = 'patient_portal') then
    raise exception 'فشل: ميزة بوابة المريض غير مسجَّلة';
  end if;
  if not exists (select 1 from organization_features
                  where organization_id = v_org and feature_key = 'patient_portal' and enabled) then
    raise exception 'فشل: المنشأة الجديدة بلا ميزة البوابة';
  end if;
  select count(*) into v_seen from v_pending_patient_requests
   where organization_id = v_org;
  if v_seen = 0 then
    raise exception 'فشل: منظور الطلبات المعلّقة فارغ رغم وجود طلبات';
  end if;
  raise notice '✅ ١٣) الميزة مسجَّلة ومنظور الطلبات المعلّقة يعمل';

  raise notice '✅ ١٣) الميزة مسجَّلة ومنظور الطلبات المعلّقة يعمل';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14) الوجه الآخر للفحص 9: بعد الاعتماد **تظهر** النتيجة فعلًا.
--     بلا هذا الفحص قد يكون الحجب ناتجًا عن خطأ في السياسة لا عن الاعتماد.
-- ═══════════════════════════════════════════════════════════════════════════
set local role authenticated;

do $$
declare v_seen integer;
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.pu'), true);
  select count(*) into v_seen from v_portal_results where result_kind = 'lab';
  if v_seen = 0 then
    raise exception 'فشل: النتيجة المعتمدة لا تظهر للمريض — الحجب ليس بسبب الاعتماد';
  end if;
  select count(*) into v_seen from v_portal_appointments;
  if v_seen = 0 then
    raise exception 'فشل: المريض لا يرى مواعيده';
  end if;
  raise notice '✅ ١٤) النتيجة بعد اعتمادها تظهر للمريض، ومواعيده تظهر له';
  raise notice '——— كل فحوص بوابة المريض نجحت ———';
end $$;

reset role;

rollback;
