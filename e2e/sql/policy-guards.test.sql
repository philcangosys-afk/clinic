-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات سياسات المنشأة وأوقات العمل — 0107
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/policy-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- الفكرة التي تحرسها هذه الفحوص: **الإعداد الذي لا يُغيّر سلوكًا ليس إعدادًا**.
-- لكل سياسة هنا فحصٌ يغيّر قيمتها ثم يتحقّق أن سلوك النظام تغيّر فعلًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_pu      uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_int     integer;
  v_num     numeric;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'po-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'po-patient@test.local')
    returning id into v_pu;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار السياسات', 'medical_center', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','PO1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب')
    returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) المنشأة بلا صفّ سياسات تسلك سلوك النظام السابق تمامًا
  -- ═════════════════════════════════════════════════════════════════════════
  if (app_org_policy(v_org)).critical_ack_minutes <> 30 then
    raise exception 'فشل: الافتراض تغيّر عن سلوك النظام السابق';
  end if;
  if (app_org_policy(v_org)).enforce_working_hours then
    raise exception 'فشل: فرض أوقات العمل مفعَّل افتراضًا — يوقف حجوزات منشأة قائمة';
  end if;
  if (select is_customized from v_organization_policies where organization_id = v_org) then
    raise exception 'فشل: منشأة بلا صفّ سياسات ظهرت كأنها مخصّصة';
  end if;
  raise notice '✅ ١) الافتراضات تطابق سلوك النظام السابق، والفرض معطَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) التعديل يحتاج صلاحية
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_stranger uuid; v_org2 uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'po-other@test.local')
      returning id into v_stranger;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'medical_center', v_stranger) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_stranger::text, true);
    begin
      perform app_save_org_policies(v_org, jsonb_build_object('critical_ack_minutes', 120));
      raise exception 'فشل: عدّل غريبٌ سياسات منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%policies.manage%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ٢) تعديل السياسات محميّ بصلاحيته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **مهلة القيم الحرجة تُقرأ فعلًا**: تغييرها يغيّر التصعيد
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_test uuid; v_order uuid; v_item uuid; v_esc integer;
  begin
    v_test := app_save_lab_test(v_org, null, jsonb_build_object(
                'name_ar','بوتاسيوم','code','K','specimen_type','blood','price','60'));
    insert into lab_orders (organization_id, branch_id, patient_id, ordering_doctor_id,
                            status, ordered_at)
      values (v_org, v_branch, v_patient, v_doctor, 'in_progress', now())
      returning id into v_order;
    insert into lab_order_items (organization_id, lab_order_id, lab_test_id,
                                 result_value, is_critical, entered_at)
      values (v_org, v_order, v_test, '7.7', true, now())
      returning id into v_item;

    update critical_result_notifications
       set detected_at = now() - interval '20 minutes'
     where source_item_id = v_item;

    -- المهلة الافتراضية 30 دقيقة: 20 دقيقة لا تُصعَّد
    v_esc := app_escalate_critical_results(v_org);
    if v_esc <> 0 then
      raise exception 'فشل: صُعّد قبل انقضاء المهلة الافتراضية';
    end if;

    -- تُخفَّض السياسة إلى 15 دقيقة ⇒ يُصعَّد فورًا بلا تمرير أيّ وسيط
    perform app_save_org_policies(v_org, jsonb_build_object('critical_ack_minutes', 15));
    v_esc := app_escalate_critical_results(v_org);
    if v_esc <> 1 then
      raise exception 'فشل: تغيير السياسة لم يغيّر سلوك التصعيد (%)', v_esc;
    end if;
  end;
  raise notice '✅ ٣) مهلة الإقرار سياسةٌ تُقرأ: تغييرها غيّر التصعيد فعلًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) **حدّ طلبات البوابة يُقرأ فعلًا**
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_link_patient_portal_account(v_patient, 'po-patient@test.local');
  perform app_save_org_policies(v_org, jsonb_build_object('portal_open_requests_limit', 1));

  perform set_config('request.jwt.claim.sub', v_pu::text, true);
  perform app_portal_request_appointment(v_org, v_clinic, v_doctor, current_date + 2);
  begin
    perform app_portal_request_appointment(v_org, v_clinic, v_doctor, current_date + 3);
    raise exception 'فشل: تجاوز الطلبُ الحدَّ المضبوط في السياسة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%1 طلبات%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ٤) حدّ طلبات البوابة سياسةٌ تُقرأ لا رقمٌ ثابت';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) **مهلة الإلغاء تُقرأ فعلًا**
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_appt uuid;
  begin
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              now() + interval '3 hours', now() + interval '3 hours 30 minutes',
              'scheduled', v_owner)
      returning id into v_appt;

    -- الافتراض صفر: الإلغاء ممكن حتى لحظة الموعد
    perform app_save_org_policies(v_org, jsonb_build_object('portal_cancel_cutoff_hours', 6));
    perform set_config('request.jwt.claim.sub', v_pu::text, true);
    begin
      perform app_portal_cancel_appointment(v_appt, 'ظرف');
      raise exception 'فشل: أُلغي موعد داخل مهلة الإقفال';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%أقلّ من 6 ساعة%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    perform app_save_org_policies(v_org, jsonb_build_object('portal_cancel_cutoff_hours', 1));
    perform set_config('request.jwt.claim.sub', v_pu::text, true);
    perform app_portal_cancel_appointment(v_appt, 'ظرف');
    if (select status from appointments where id = v_appt) <> 'cancelled_by_patient' then
      raise exception 'فشل: لم يُلغَ الموعد بعد توسيع المهلة';
    end if;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ٥) مهلة الإلغاء من البوابة سياسةٌ تُقرأ صعودًا ونزولًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) أوقات العمل: **لا قيد قبل التفعيل**
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_a2 uuid;
  begin
    insert into branch_working_hours (organization_id, branch_id, weekday, opens_at, closes_at)
    select v_org, v_branch, d, '08:00', '16:00' from generate_series(0, 6) d;

    -- الفرض ما زال معطَّلًا ⇒ الحجز في الثالثة فجرًا يمرّ
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              (current_date + 1)::timestamptz + interval '3 hours',
              (current_date + 1)::timestamptz + interval '3 hours 30 minutes',
              'scheduled', v_owner)
      returning id into v_a2;
    if v_a2 is null then
      raise exception 'فشل: مُنع الحجز رغم أن الفرض معطَّل';
    end if;
    delete from appointments where id = v_a2;
  end;
  raise notice '✅ ٦) جدول ساعات موجود بلا تفعيل لا يمنع شيئًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) بعد التفعيل: خارج الدوام يُمنع، وداخله يمرّ
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_save_org_policies(v_org, jsonb_build_object('enforce_working_hours', true));
  declare v_a3 uuid;
  begin
    begin
      insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                                scheduled_start, scheduled_end, status, created_by)
        values (v_org, v_branch, v_clinic, v_doctor, v_patient,
                (current_date + 1)::timestamptz + interval '3 hours',
                (current_date + 1)::timestamptz + interval '3 hours 30 minutes',
                'scheduled', v_owner);
      raise exception 'فشل: قُبل حجز خارج أوقات عمل الفرع';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%خارج أوقات عمل%' then raise; end if;
    end;

    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              (current_date + 1)::timestamptz + interval '10 hours',
              (current_date + 1)::timestamptz + interval '10 hours 30 minutes',
              'scheduled', v_owner)
      returning id into v_a3;
    if v_a3 is null then
      raise exception 'فشل: مُنع حجز داخل أوقات العمل';
    end if;
    delete from appointments where id = v_a3;
  end;
  raise notice '✅ ٧) بعد التفعيل: خارج الدوام يُمنع وداخله يمرّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) العطلة تمنع الحجز حتى داخل ساعات العمل
  -- ═════════════════════════════════════════════════════════════════════════
  insert into organization_holidays (organization_id, branch_id, holiday_date, name_ar)
    values (v_org, null, (current_date + 1)::date, 'عيد وطني');
  begin
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              (current_date + 1)::timestamptz + interval '10 hours',
              (current_date + 1)::timestamptz + interval '10 hours 30 minutes',
              'scheduled', v_owner);
    raise exception 'فشل: قُبل حجز في يوم عطلة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%عطلة%' then raise; end if;
  end;
  if app_is_working_time(v_org, v_branch,
       (current_date + 1)::timestamptz + interval '10 hours') then
    raise exception 'فشل: يوم العطلة يُحتسب وقت عمل';
  end if;
  raise notice '✅ ٨) العطلة تمنع الحجز ولو كان داخل ساعات العمل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) الإلغاء وعدم الحضور لا يُمنعان بحارس الدوام
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_a4 uuid;
  begin
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              (current_date + 2)::timestamptz + interval '3 hours',
              (current_date + 2)::timestamptz + interval '3 hours 30 minutes',
              'cancelled_by_staff', v_owner)
      returning id into v_a4;
    if v_a4 is null then
      raise exception 'فشل: مُنع تسجيل موعد ملغى خارج الدوام';
    end if;
  end;
  raise notice '✅ ٩) حارس الدوام لا يعترض الملغى ولا عدم الحضور';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) القيم خارج النطاق مرفوضة من القاعدة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_save_org_policies(v_org, jsonb_build_object('critical_ack_minutes', 2));
    raise exception 'فشل: قُبلت مهلة إقرار دقيقتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  begin
    perform app_save_org_policies(v_org, jsonb_build_object('document_expiry_notice_days', 0));
    raise exception 'فشل: قُبلت مهلة تنبيه صفر يوم';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ١٠) القيم غير المعقولة مرفوضة من القاعدة لا من الشاشة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) التعديل الجزئي لا يمسّ بقية السياسات
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_save_org_policies(v_org, jsonb_build_object('visit_open_alert_days', 5));
  if (app_org_policy(v_org)).critical_ack_minutes <> 15 then
    raise exception 'فشل: تعديل سياسةٍ أعاد غيرها إلى الافتراض';
  end if;
  if not (app_org_policy(v_org)).enforce_working_hours then
    raise exception 'فشل: تعديل سياسةٍ ألغى تفعيل أوقات العمل';
  end if;
  raise notice '✅ ١١) التعديل الجزئي يحفظ بقية السياسات كما هي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) التعديل يدخل سجل التدقيق، والمنشأة تظهر مخصّصة
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from audit_log
                  where organization_id = v_org
                    and entity_title = 'تعديل سياسات المنشأة') then
    raise exception 'فشل: تعديل السياسات لم يدخل سجل التدقيق';
  end if;
  if not (select is_customized from v_organization_policies where organization_id = v_org) then
    raise exception 'فشل: المنشأة المعدَّلة سياساتها ما زالت تظهر على الافتراضات';
  end if;
  raise notice '✅ ١٢) التعديل موثَّق في التدقيق والمنظور يميّز المخصّص';

  raise notice '——— كل فحوص السياسات نجحت ———';
end $$;

rollback;
