-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- الرحلة المترابطة الكاملة وجاهزية الإطلاق — 0112 (المرحلة 32)
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/launch-journey.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- بقية الملفات تختبر كل مرحلة وحدها. هذا الملف يختبر **الوصلات بينها**:
-- طلب موعد من بوابة المريض ← اعتماد الاستقبال ← زيارة ← موافقة موقَّعة ←
-- إجراء ← قيمة حرجة وإقرارها ← فاتورة ← بلاغ سلامة ← وانعكاس ذلك كلّه في
-- التحليلات وفي جاهزية الإطلاق.
--
-- الخطأ الذي يمسكه هذا الملف وحده: مرحلةٌ تعمل وحدها وتكسر ما قبلها.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_docu    uuid;
  v_pu      uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_item    uuid;
  v_req     uuid;
  v_appt    uuid;
  v_visit   uuid;
  v_svc     uuid;
  v_consent uuid;
  v_test    uuid;
  v_lab     uuid;
  v_labitem uuid;
  v_crit    uuid;
  v_inv     uuid;
  v_int     integer;
  v_num     numeric;
  v_txt     text;
begin
  -- ═════════════════════════════════════════════════════════════════════════
  -- التهيئة: منشأة كاملة كما تُنشأ في الواقع
  -- ═════════════════════════════════════════════════════════════════════════
  insert into auth.users (id, email) values (gen_random_uuid(), 'lj-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'lj-doctor@test.local')
    returning id into v_docu;
  insert into auth.users (id, email) values (gen_random_uuid(), 'lj-patient@test.local')
    returning id into v_pu;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة الرحلة الكاملة', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_docu, 'doctor', true);
  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','LJ1','name','عيادة الباطنة','branch_id', v_branch));
  insert into doctors (organization_id, user_id, name_ar, clinic_id)
    values (v_org, v_docu, 'د. منى', v_clinic) returning id into v_doctor;
  insert into patients (organization_id, name_ar, phone_1)
    values (v_org, 'مريض الرحلة', '0500000000') returning id into v_patient;
  insert into items (organization_id, item_type, code, name_ar, price, requires_consent,
                     consent_note_ar)
    values (v_org, 'service', 'LJ-PROC', 'إجراء يحتاج موافقة', 800, true, 'إقرار الإجراء')
    returning id into v_item;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) **الجاهزية تكشف النقص قبل أن يبدأ العمل**
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from app_launch_readiness(v_org)
   where severity = 'blocker' and not is_ok;
  if v_int = 0 then
    raise exception 'فشل: منشأة بلا قائمة أسعار أساسية ظهرت جاهزة تمامًا';
  end if;
  if not exists (select 1 from app_launch_readiness(v_org)
                  where check_key = 'base_price_list' and not is_ok) then
    raise exception 'فشل: غياب قائمة الأسعار الأساسية لم يُرصد';
  end if;
  raise notice '✅ ١) الجاهزية ترصد نقص الأساسيات قبل بدء العمل';

  -- تُستكمل الأساسيات
  insert into price_lists (organization_id, name, list_kind, is_active, effective_from)
    values (v_org, 'القائمة الأساسية', 'base', true, current_date - 30);
  perform app_seed_default_chart_of_accounts(v_org);

  if exists (select 1 from app_launch_readiness(v_org)
              where check_key = 'base_price_list' and not is_ok) then
    raise exception 'فشل: الجاهزية ما زالت ترصد نقصًا بعد استكماله';
  end if;
  raise notice '✅ ٢) الجاهزية تُحسب لحظيًّا: استكمال النقص يُطفئ الإنذار فورًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) المريض يطلب موعدًا من بوابته — ولا يحجز بنفسه
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_link_patient_portal_account(v_patient, 'lj-patient@test.local');
  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  v_req := app_portal_request_appointment(v_org, v_clinic, v_doctor,
                                          current_date + 1, 'morning', 'ألم مستمر');
  if exists (select 1 from appointments where patient_id = v_patient) then
    raise exception 'فشل: طلب البوابة حجز موعدًا مباشرة';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_appt := app_approve_appointment_request(
              v_req, (current_date + 1)::timestamptz + interval '9 hours',
              (current_date + 1)::timestamptz + interval '9 hours 30 minutes',
              v_doctor, v_clinic, null);
  if v_appt is null then raise exception 'فشل: الاعتماد لم يُنشئ موعدًا'; end if;
  raise notice '✅ ٣) طلب البوابة يمرّ بالاستقبال ثم يصير موعدًا في التقويم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الزيارة تُفتح ويُضاف الإجراء — ولا يُنفَّذ بلا موافقة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, appointment_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, v_appt, now(), 'in_progress')
    returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                      unit_price, status, created_by)
    values (v_org, v_visit, v_item, 1, 800, 'ordered', v_owner) returning id into v_svc;

  begin
    update patient_visit_services set status = 'performed' where id = v_svc;
    raise exception 'فشل: نُفّذ إجراء يحتاج موافقة بلا موافقة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بلا موافقة موقَّعة%' then raise; end if;
  end;
  raise notice '✅ ٤) حارس الموافقة (المرحلة 22) يعمل داخل رحلة زيارة حقيقية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الموافقة تُرفع وتُوقَّع فيمرّ الإجراء
  -- ═════════════════════════════════════════════════════════════════════════
  v_consent := app_register_patient_document(
                 v_patient, 'org/docs/lj-consent.pdf', 'موافقة.pdf', 'document',
                 v_visit, v_item, true);
  perform app_sign_document('patient_document', v_consent, 'patient', 'مريض الرحلة',
                            'on_screen', 'org/sig/lj.png');
  update patient_visit_services set status = 'performed' where id = v_svc;
  if (select status from patient_visit_services where id = v_svc) <> 'performed' then
    raise exception 'فشل: الإجراء لم يُنفَّذ رغم الموافقة الموقَّعة';
  end if;
  raise notice '✅ ٥) الموافقة الموقَّعة تفتح الإجراء — الوصل بين 22 و«الزيارة» سليم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) قيمة حرجة تصل الطبيب، ولا تُغلق إلا بإقراره
  -- ═════════════════════════════════════════════════════════════════════════
  v_test := app_save_lab_test(v_org, null, jsonb_build_object(
              'name_ar','بوتاسيوم','code','LJK','specimen_type','blood','price','60'));
  insert into lab_orders (organization_id, branch_id, patient_id, ordering_doctor_id,
                          visit_id, status, ordered_at)
    values (v_org, v_branch, v_patient, v_doctor, v_visit, 'in_progress', now())
    returning id into v_lab;
  insert into lab_order_items (organization_id, lab_order_id, lab_test_id,
                               result_value, is_critical, entered_at)
    values (v_org, v_lab, v_test, '7.8', true, now()) returning id into v_labitem;

  select id into v_crit from critical_result_notifications where source_item_id = v_labitem;
  if v_crit is null then
    raise exception 'فشل: القيمة الحرجة لم تُنشئ بلاغًا داخل الرحلة';
  end if;
  if not exists (select 1 from notifications
                  where organization_id = v_org and user_id = v_docu
                    and event_key = 'critical_result') then
    raise exception 'فشل: طبيب الزيارة لم يُنبَّه بالقيمة الحرجة';
  end if;

  -- والجاهزية ترصدها فورًا كمانع
  if not exists (select 1 from app_launch_readiness(v_org)
                  where check_key = 'critical_open' and not is_ok and severity = 'blocker') then
    raise exception 'فشل: القيمة الحرجة المعلّقة لا تظهر مانعًا في الجاهزية';
  end if;

  perform set_config('request.jwt.claim.sub', v_docu::text, true);
  perform app_acknowledge_critical_result(v_crit, 'بوتاسيوم سبعة فاصلة ثمانية',
                                          'أوقفت الدواء وطلبت تخطيطًا');
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if exists (select 1 from app_launch_readiness(v_org)
              where check_key = 'critical_open' and not is_ok) then
    raise exception 'فشل: الإقرار لم يُطفئ مانع الجاهزية';
  end if;
  raise notice '✅ ٦) القيمة الحرجة: بلاغ ← تنبيه الطبيب ← مانع جاهزية ← إقرار يُطفئه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الفوترة تُنشأ من الزيارة والخدمة المنفَّذة تدخلها
  -- ═════════════════════════════════════════════════════════════════════════
  v_inv := app_create_invoice_from_visit(v_visit);
  if v_inv is null then raise exception 'فشل: لم تُنشأ فاتورة من الزيارة'; end if;
  select count(*) into v_int from sales_invoice_items where invoice_id = v_inv;
  if v_int = 0 then
    raise exception 'فشل: الفاتورة بلا سطور رغم وجود خدمة منفَّذة';
  end if;
  select net_amount into v_num from sales_invoices where id = v_inv;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: صافي الفاتورة % — السعر لم يُلتقط', v_num;
  end if;
  raise notice '✅ ٧) الفوترة من الزيارة تلتقط الخدمة المنفَّذة بسعرها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) بلاغ سلامة يُرفع ويُغلق بسببٍ جذريّ
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_inc uuid;
  begin
    v_inc := app_report_quality_incident(
               v_org, 'medication', 'major', 'تأخّر إبلاغ قيمة حرجة',
               v_branch, v_patient, now() - interval '1 hour');
    if not exists (select 1 from app_launch_readiness(v_org)
                    where check_key = 'severe_incidents' and not is_ok) then
      raise exception 'فشل: البلاغ الجسيم المفتوح لا يظهر في الجاهزية';
    end if;
    perform app_close_quality_incident(
      v_inc, 'لم يكن أحد مسؤولًا عن المتابعة', 'تعيين مناوب للقيم الحرجة',
      'تفعيل التصعيد بعد 15 دقيقة');
    if exists (select 1 from app_launch_readiness(v_org)
                where check_key = 'severe_incidents' and not is_ok) then
      raise exception 'فشل: إغلاق البلاغ لم ينعكس على الجاهزية';
    end if;
  end;
  raise notice '✅ ٨) بلاغ السلامة يُرفع ويُغلق بسبب جذريّ وينعكس على الجاهزية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) **الرحلة كلها تظهر في التحليلات**
  -- ═════════════════════════════════════════════════════════════════════════
  select sum(visits_total) into v_int from v_analytics_daily
   where organization_id = v_org and report_date = current_date;
  if coalesce(v_int, 0) < 1 then
    raise exception 'فشل: الزيارة لا تظهر في السلسلة اليومية';
  end if;
  select sum(revenue) into v_num from v_analytics_daily
   where organization_id = v_org and report_date = current_date;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: إيراد الفاتورة لا يظهر في التحليلات';
  end if;
  if not exists (select 1 from v_analytics_top_services
                  where organization_id = v_org and item_id = v_item) then
    raise exception 'فشل: الخدمة المنفَّذة غائبة عن أكثر الخدمات';
  end if;
  raise notice '✅ ٩) الزيارة والإيراد والخدمة تظهر جميعها في التحليلات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) **رحلة المريض تجمع الأحداث** — الوصل مع الشاشة القديمة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_events int;
  begin
    -- الدالّة تُرجع جدولًا لا jsonb: تُعدّ صفوفه
    select count(*) into v_events from app_get_patient_timeline(v_patient);
    if coalesce(v_events, 0) = 0 then
      raise exception 'فشل: رحلة المريض فارغة رغم زيارة وفاتورة وفحص';
    end if;
    if not exists (select 1 from app_get_patient_timeline(v_patient)
                    where visit_id = v_visit) then
      raise exception 'فشل: زيارة اليوم غائبة عن رحلة المريض';
    end if;
  end;
  raise notice '✅ ١٠) رحلة المريض تعرض أحداث الزيارة الجديدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- تمرير المعرّفات للكتلة التالية: فحص البوابة يحتاج دور `authenticated`
  -- الحقيقيّ، لأن RLS لا تنطبق على مالك الجداول.
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('lj.org',     v_org::text,     true);
  perform set_config('lj.owner',   v_owner::text,   true);
  perform set_config('lj.patient_user', v_pu::text, true);
  perform set_config('lj.lab',     v_lab::text,     true);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11) المريض يرى في بوابته نتيجته **بعد الاعتماد فقط**، وفاتورته
-- ═══════════════════════════════════════════════════════════════════════════
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

set local role authenticated;

do $$
declare v_int integer;
begin
  perform set_config('request.jwt.claim.sub', current_setting('lj.patient_user'), true);
  select count(*) into v_int from v_portal_results where result_kind = 'lab';
  if v_int <> 0 then
    raise exception 'فشل: نتيجة غير معتمدة ظهرت في بوابة المريض';
  end if;
end $$;

reset role;

do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('lj.owner'), true);
  update lab_orders set status = 'approved' where id = current_setting('lj.lab')::uuid;
end $$;

set local role authenticated;

do $$
declare v_int integer;
begin
  perform set_config('request.jwt.claim.sub', current_setting('lj.patient_user'), true);
  select count(*) into v_int from v_portal_results where result_kind = 'lab';
  if v_int = 0 then
    raise exception 'فشل: النتيجة المعتمدة لا تظهر للمريض';
  end if;
  select count(*) into v_int from v_portal_invoices;
  if v_int = 0 then
    raise exception 'فشل: فاتورة المريض لا تظهر في بوابته';
  end if;
  -- ولا يرى ما ليس له
  select count(*) into v_int from items;
  if v_int > 0 then
    raise exception 'فشل: المريض يرى كتالوج الخدمات الداخلي';
  end if;
  raise notice '✅ ١١) البوابة تعرض المعتمد فقط وفاتورته، ولا تعرض ما ليس له';
end $$;

reset role;

do $$
declare v_org uuid; v_int integer; v_txt text;
begin
  v_org := current_setting('lj.org')::uuid;
  perform set_config('request.jwt.claim.sub', current_setting('lj.owner'), true);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) **سجل التدقيق يحمل الرحلة كلها**
  -- ═════════════════════════════════════════════════════════════════════════
  select count(distinct entity_title) into v_int from audit_log
   where organization_id = v_org
     and entity_title in ('موافقة مريض','توقيع مستند','إقرار بقيمة حرجة',
                          'إغلاق بلاغ سلامة','ربط حساب بوابة مريض');
  if v_int < 4 then
    raise exception 'فشل: سجل التدقيق لا يحمل خطوات الرحلة (% خطوة)', v_int;
  end if;
  raise notice '✅ ١٢) كل خطوة حسّاسة في الرحلة لها أثر في سجل التدقيق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الجاهزية النهائية: لا مانع متبقٍّ
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from app_launch_readiness(v_org)
   where severity = 'blocker' and not is_ok;
  if v_int <> 0 then
    select string_agg(title, '، ') into v_txt from app_launch_readiness(v_org)
     where severity = 'blocker' and not is_ok;
    raise exception 'فشل: بقيت موانع بعد إكمال الرحلة: %', v_txt;
  end if;
  raise notice '✅ ١٣) بعد إكمال الرحلة لا مانع واحد متبقٍّ';

  raise notice '——— الرحلة المترابطة الكاملة نجحت ———';
end $$;

rollback;
