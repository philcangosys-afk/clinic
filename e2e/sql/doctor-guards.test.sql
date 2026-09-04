-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الأطباء والجداول — 0081 و0082
-- ---------------------------------------------------------------------------
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/doctor-guards.test.sql
--
-- أربعة عشر فحصًا: الطبيب في عيادتين، الرئيسية واحدة، فرع العيادة يُشتقّ
-- ويُتحقّق منه، الجدول الأسبوعي يمنع التداخل، الفتحات تُولَّد ويُحسب
-- المحجوز، الاستثناء يحجب ويستبدل، الحجز خارج الدوام مرفوض، الحجز في عيادة
-- غير مرتبطة مرفوض، سلسلة فرع←عيادة←طبيب←خدمة، تخصيص الخدمات يقصر القائمة،
-- والترخيص المنتهي تحذير لا منع.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_branch  uuid;
  v_branch2 uuid;
  v_clinic  uuid;
  v_clinic2 uuid;
  v_clinic3 uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_item    uuid;
  v_item2   uuid;
  v_sunday  date;
  v_msg     text;
  v_int     int;
  v_txt     text;
  v_warn    text[];
begin
  -- ── تهيئة
  insert into auth.users (id, email) values (gen_random_uuid(), 'doc-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'doc-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الأطباء', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);
  insert into branches (organization_id, name, code) values (v_org, 'فرع أ', 'DR-A')
    returning id into v_branch;
  insert into branches (organization_id, name, code) values (v_org, 'فرع ب', 'DR-B')
    returning id into v_branch2;
  insert into clinics (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'عيادة ١', 'DR-C1') returning id into v_clinic;
  insert into clinics (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'عيادة ٢', 'DR-C2') returning id into v_clinic2;
  insert into clinics (organization_id, branch_id, name, code)
    values (v_org, v_branch2, 'عيادة ٣', 'DR-C3') returning id into v_clinic3;
  insert into doctors (organization_id, name_ar, is_enabled)
    values (v_org, 'د. الاختبار', true) returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض الأطباء')
    returning id into v_patient;

  -- أقرب أحد قادم (isodow = 7)
  v_sunday := current_date + ((7 - extract(isodow from current_date)::int) % 7);
  if v_sunday <= current_date then v_sunday := v_sunday + 7; end if;

  -- ── 1) الطبيب في عيادتين
  insert into doctor_clinics (organization_id, doctor_id, clinic_id, is_primary)
    values (v_org, v_doctor, v_clinic, true), (v_org, v_doctor, v_clinic2, false);
  if (select count(*) from doctor_clinics where doctor_id = v_doctor) <> 2 then
    raise exception 'فشل: الطبيب لم يُربط بعيادتين';
  end if;
  raise notice '✅ الطبيب في أكثر من عيادة';

  -- ── 2) رئيسية واحدة فقط
  begin
    update doctor_clinics set is_primary = true where doctor_id = v_doctor and clinic_id = v_clinic2;
    raise exception 'فشل: قُبلت عيادتان رئيسيتان';
  exception when unique_violation then
    raise notice '✅ العيادة الرئيسية واحدة';
  end;

  -- ── 3) فرع العيادة يُشتقّ تلقائيًا
  if (select branch_id from doctor_clinics where doctor_id = v_doctor and clinic_id = v_clinic)
     is distinct from v_branch then
    raise exception 'فشل: فرع الارتباط لم يُشتقّ من العيادة';
  end if;
  raise notice '✅ فرع الارتباط يُشتقّ من العيادة';

  -- ── 4) فرع مخالف لفرع العيادة مرفوض
  begin
    insert into doctor_clinics (organization_id, doctor_id, clinic_id, branch_id)
      values (v_org, v_doctor, v_clinic3, v_branch);
    raise exception 'فشل: قُبل فرع يخالف فرع العيادة';
  exception when others then
    if sqlerrm not like '%فرعًا آخر%' then raise; end if;
    raise notice '✅ الفرع المخالف لفرع العيادة مرفوض';
  end;

  -- ── 5) الجدول الأسبوعي
  insert into doctor_schedules (organization_id, doctor_id, clinic_id, day_of_week,
                                start_time, end_time, slot_duration_minutes, capacity, effective_from)
    values (v_org, v_doctor, v_clinic, 7, '08:00', '12:00', 20, 1, current_date - 30);
  raise notice '✅ الجدول الأسبوعي';

  -- ── 6) تداخل في نفس اليوم مرفوض
  begin
    insert into doctor_schedules (organization_id, doctor_id, clinic_id, day_of_week,
                                  start_time, end_time, effective_from)
      values (v_org, v_doctor, v_clinic, 7, '11:00', '14:00', current_date - 30);
    raise exception 'فشل: قُبلت فترة متداخلة';
  exception when others then
    if sqlerrm not like '%تتداخل%' then raise; end if;
    raise notice '✅ تداخل فترات الدوام مرفوض';
  end;

  -- ── 7) الفتحات تُولَّد
  select count(*) into v_int from app_doctor_available_slots(v_doctor, v_sunday);
  if v_int <> 12 then
    raise exception 'فشل: توقّعنا ١٢ فتحة (٤ ساعات ÷ ٢٠ دقيقة) فجاء %', v_int;
  end if;
  raise notice '✅ توليد الفتحات';

  -- ── 8) داخل الدوام مقبول وخارجه مرفوض
  if app_check_doctor_availability(v_doctor,
       (v_sunday + time '09:00')::timestamptz, (v_sunday + time '09:20')::timestamptz) is not null then
    raise exception 'فشل: رُفض وقت داخل الدوام';
  end if;
  v_msg := app_check_doctor_availability(v_doctor,
             (v_sunday + time '14:00')::timestamptz, (v_sunday + time '14:20')::timestamptz);
  if v_msg is null then
    raise exception 'فشل: قُبل وقت خارج الدوام';
  end if;
  raise notice '✅ الدوام يُحترم (%)', v_msg;

  -- ── 9) الموعد يشغل فتحته
  insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                            scheduled_start, scheduled_end, status)
  values (v_org, v_patient, v_doctor, v_clinic,
          (v_sunday + time '09:00')::timestamptz, (v_sunday + time '09:20')::timestamptz, 'scheduled');

  select booked into v_int from app_doctor_available_slots(v_doctor, v_sunday)
   where slot_start = (v_sunday + time '09:00')::timestamptz;
  if v_int <> 1 then
    raise exception 'فشل: الفتحة المحجوزة عدّادها % لا ١', v_int;
  end if;
  raise notice '✅ الفتحة المحجوزة تظهر مشغولة';

  -- ── 10) الاستثناء يحجب
  insert into doctor_working_hours (doctor_id, organization_id, starts_at, ends_at,
                                    exception_type, reason)
  values (v_doctor, v_org, (v_sunday + time '10:00')::timestamptz,
          (v_sunday + time '11:00')::timestamptz, 'training', 'دورة');

  select block_reason into v_txt from app_doctor_available_slots(v_doctor, v_sunday)
   where slot_start = (v_sunday + time '10:20')::timestamptz;
  if v_txt is distinct from 'تدريب' then
    raise exception 'فشل: الفتحة لم تُحجب بالتدريب (%)', v_txt;
  end if;

  v_msg := app_check_doctor_availability(v_doctor,
             (v_sunday + time '10:20')::timestamptz, (v_sunday + time '10:40')::timestamptz);
  if v_msg is null or v_msg not like '%تدريب%' then
    raise exception 'فشل: التوفّر لم يمنع وقت التدريب (%)', v_msg;
  end if;
  raise notice '✅ الاستثناء يحجب الوقت';

  -- ── 11) الحجز في عيادة غير مرتبطة مرفوض
  begin
    insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                              scheduled_start, scheduled_end, status)
    values (v_org, v_patient, v_doctor, v_clinic3,
            now() + interval '40 days', now() + interval '40 days 20 min', 'scheduled');
    raise exception 'فشل: قُبل حجز في عيادة غير مرتبطة';
  exception when others then
    if sqlerrm not like '%غير مرتبط بهذه العيادة%' then raise; end if;
    raise notice '✅ الحجز في عيادة غير مرتبطة مرفوض';
  end;

  -- ── 12) سلسلة فرع ← عيادة ← طبيب
  select count(*) into v_int from app_clinics_for_branch(v_org, v_branch);
  if v_int <> 2 then
    raise exception 'فشل: عيادات الفرع % لا ٢', v_int;
  end if;
  select count(*) into v_int from app_doctors_for_clinic(v_org, v_clinic);
  if v_int <> 1 then
    raise exception 'فشل: أطباء العيادة % لا ١', v_int;
  end if;
  select count(*) into v_int from app_doctors_for_clinic(v_org, v_clinic3);
  if v_int <> 0 then
    raise exception 'فشل: ظهر طبيب في عيادة لا يعمل فيها';
  end if;
  raise notice '✅ سلسلة فرع ← عيادة ← طبيب';

  -- ── 13) تخصيص الخدمات يقصر القائمة
  insert into items (organization_id, item_type, code, name_ar, price, duration_minutes, default_clinic_id)
    values (v_org, 'service', 'DR-S1', 'كشف', 300, 30, v_clinic) returning id into v_item;
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'DR-S2', 'خدمة ثانية', 100) returning id into v_item2;

  select count(*) into v_int from app_services_for_doctor(v_org, v_doctor, v_clinic, v_branch);
  if v_int < 1 then
    raise exception 'فشل: طبيب بلا خدمات محدَّدة لم تظهر له خدمات العيادة';
  end if;

  insert into doctor_services (organization_id, doctor_id, item_id, duration_minutes)
    values (v_org, v_doctor, v_item, 45);

  select count(*) into v_int from app_services_for_doctor(v_org, v_doctor, v_clinic, v_branch);
  if v_int <> 1 then
    raise exception 'فشل: بعد التخصيص توقّعنا خدمة واحدة فجاء %', v_int;
  end if;
  select duration_minutes into v_int from app_services_for_doctor(v_org, v_doctor, v_clinic, v_branch);
  if v_int <> 45 then
    raise exception 'فشل: مدة الطبيب لم تتقدّم على مدة الخدمة (%)', v_int;
  end if;
  raise notice '✅ خدمات الطبيب تقصر القائمة وتتقدّم مدتها';

  -- ── 14) الترخيص المنتهي تحذير لا منع
  update doctors set license_expiry_date = current_date - 5 where id = v_doctor;
  v_warn := app_doctor_booking_warnings(v_doctor);
  if cardinality(v_warn) = 0 then
    raise exception 'فشل: لم يُنبَّه على ترخيص منتهٍ';
  end if;
  if app_check_doctor_availability(v_doctor,
       (v_sunday + time '08:20')::timestamptz, (v_sunday + time '08:40')::timestamptz) is not null then
    raise exception 'فشل: الترخيص المنتهي منع الحجز — المطلوب تحذير لا منع';
  end if;
  raise notice '✅ الترخيص المنتهي يُنبِّه ولا يمنع';

  raise notice '——— كل فحوص منطق الأطباء نجحت ———';
end $$;

-- ---------------------------------------------------------------------------
-- فحص الصلاحيات — خارج الكتلة عمدًا
--
-- الكتلة أعلاه تعمل بدور المالك (superuser عادةً)، **وRLS لا تسري على
-- المالك**. فحصُ الصلاحيات داخلها ينجح دائمًا ولا يقيس شيئًا — وهذا ما
-- كشفه تشغيلُ أول نسخة من هذا الملف: «موظف الاستقبال عدّل جدول الطبيب».
-- الفحص الحقيقي يحتاج `set local role authenticated`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org    uuid;
  v_doctor uuid;
  v_recep  uuid;
begin
  select id into v_org from organizations where name = 'منشأة اختبار الأطباء';
  select id into v_doctor from doctors where organization_id = v_org limit 1;
  select user_id into v_recep from organization_memberships
   where organization_id = v_org and role_key = 'receptionist' limit 1;
  perform set_config('e2e.org', v_org::text, true);
  perform set_config('e2e.doctor', v_doctor::text, true);
  perform set_config('e2e.recep', v_recep::text, true);
end $$;

set local role authenticated;

do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('e2e.recep'), true);

  begin
    insert into doctor_schedules (organization_id, doctor_id, day_of_week,
                                  start_time, end_time, effective_from)
      values (current_setting('e2e.org')::uuid, current_setting('e2e.doctor')::uuid,
              3, '08:00', '10:00', current_date);
    raise exception 'فشل: موظف الاستقبال عدّل جدول الطبيب';
  exception when insufficient_privilege then
    raise notice '✅ جدول الطبيب محميّ بالصلاحية';
  when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
    raise notice '✅ جدول الطبيب محميّ بالصلاحية';
  end;

  begin
    update doctors set name_ar = 'مخترَق' where id = current_setting('e2e.doctor')::uuid;
    if found then
      raise exception 'فشل: موظف الاستقبال عدّل بيانات الطبيب';
    end if;
    raise notice '✅ بيانات الطبيب محميّة بالصلاحية';
  end;

  -- ويقرأ كالمعتاد
  if (select count(*) from doctors where organization_id = current_setting('e2e.org')::uuid) < 1 then
    raise exception 'فشل: موظف الاستقبال لا يرى الأطباء';
  end if;
  raise notice '✅ موظف الاستقبال يقرأ الأطباء';

  raise notice '——— كل فحوص الأطباء نجحت ———';
end $$;

reset role;

rollback;
