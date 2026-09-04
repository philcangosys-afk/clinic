-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المطالبات والتسويات وطبقة نفيس — 0093
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/claims-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- المسار المُختبَر هو المسار الحقيقيّ: مريض مؤمَّن ← أهلية محفوظة ← خدمة
-- تحتاج موافقة ← موافقة ← زيارة وتنفيذ ← فاتورة موزَّعة ← مطالبة ← رفض بند ←
-- إعادة تقديم ← قبول ← تسوية.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_company uuid;
  v_policy  uuid;
  v_member  uuid;
  v_contract uuid;
  v_list    uuid;
  v_cons    uuid;
  v_mri     uuid;
  v_visit   uuid;
  v_inv     uuid;
  v_claim   uuid;
  v_claim2  uuid;
  v_elig    uuid;
  v_pa      uuid;
  v_item    uuid;
  v_settle  uuid;
  v_msg     uuid;
  v_icd     uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
  v_json    jsonb;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'cl-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار المطالبات', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع') returning id into v_branch;
  insert into doctors (organization_id, name_ar) values (v_org, 'د. أحمد') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض مؤمَّن', '1122334455') returning id into v_patient;

  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'CONS', 'كشف', 300, 'consultation') returning id into v_cons;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, requires_preauthorization)
    values (v_org, 'service', 'MRI', 'رنين', 2000, 'radiology', true) returning id into v_mri;

  insert into insurance_companies (organization_id, name_ar, nphies_payer_id)
    values (v_org, 'شركة التأمين', 'PAYER-1') returning id into v_company;
  insert into insurance_policies (organization_id, company_id, policy_name, policy_number,
                                  default_copay_percent, annual_limit)
    values (v_org, v_company, 'بوليصة', 'P-1', 20, 50000) returning id into v_policy;
  insert into patient_insurance_memberships (organization_id, patient_id, policy_id,
                                             membership_number, relation, eligibility_status,
                                             expiry_date, is_active)
    values (v_org, v_patient, v_policy, 'M-1', 'self', 'eligible', current_date + 200, true)
    returning id into v_member;

  insert into price_lists (organization_id, name, list_kind, insurance_company_id,
                           effective_from, is_active, priority)
    values (v_org, 'قائمة الشركة', 'insurance', v_company, current_date - 10, true, 5)
    returning id into v_list;
  insert into price_list_items (organization_id, price_list_id, item_id, price, effective_from)
    values (v_org, v_list, v_cons, 250, current_date - 10),
           (v_org, v_list, v_mri, 1800, current_date - 10);
  insert into insurance_contracts (organization_id, company_id, name_ar, price_list_id,
                                   default_copay_percent, effective_from, status, created_by)
    values (v_org, v_company, 'عقد', v_list, 10, current_date - 10, 'active', v_owner)
    returning id into v_contract;

  -- أكواد المطالبات للخدمتين
  insert into item_claim_codes (organization_id, item_id, insurance_company_id,
                                code_system, code, is_primary, created_by)
    values (v_org, v_cons, v_company, 'cpt', '99213', true, v_owner),
           (v_org, v_mri, v_company, 'cpt', '70551', true, v_owner);

  select id into v_icd from icd10_codes limit 1;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الأهلية تُحفَظ بوقتها
  -- ═════════════════════════════════════════════════════════════════════════
  v_elig := app_check_insurance_eligibility(v_member, v_cons, null, 250);
  if v_elig is null then raise exception 'فشل: لم تُحفَظ نتيجة الأهلية'; end if;

  select copay_percent into v_num from insurance_eligibility_checks where id = v_elig;
  if v_num <> 10 then
    raise exception 'فشل: نسبة التحمّل المحفوظة % لا ١٠٪ من العقد', v_num;
  end if;
  if (select checked_at from insurance_eligibility_checks where id = v_elig) is null then
    raise exception 'فشل: وقت التحقّق لم يُختم';
  end if;
  if (select coverage_result from insurance_eligibility_checks where id = v_elig) is null then
    raise exception 'فشل: نتيجة التغطية الكاملة لم تُحفَظ';
  end if;
  raise notice '✅ ١) الأهلية تُحسب وتُحفَظ بوقتها ونتيجتها — دليلٌ عند النزاع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الموافقة المسبقة: دورة كاملة بمبرّر
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                           doctor_id, item_id, service_description,
                                           requested_amount, qty, status, created_by)
    values (v_org, v_patient, v_member, v_doctor, v_mri, 'رنين للركبة',
            1800, 1, 'draft', v_owner) returning id into v_pa;

  begin
    perform app_set_preauth_status(v_pa, 'ready');
    raise exception 'فشل: أُرسلت موافقة بلا مبرّر طبيّ';
  exception when others then
    if sqlerrm not like '%مبرّرًا طبيًّا%' then raise; end if;
  end;

  update insurance_preauthorizations
     set justification = 'ألم مزمن لم يستجب للعلاج التحفّظي ثمانية أسابيع'
   where id = v_pa;
  perform app_set_preauth_status(v_pa, 'ready');
  perform app_set_preauth_status(v_pa, 'submitted');
  perform app_set_preauth_status(v_pa, 'in_review');

  -- القفز مرفوض
  begin
    perform app_set_preauth_status(v_pa, 'ready');
    raise exception 'فشل: رجعت الموافقة من المراجعة إلى جاهزة';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
  end;

  -- الاعتماد الجزئي يحتاج مبلغًا ورقمًا
  begin
    perform app_set_preauth_status(v_pa, 'partially_approved', 'جزئي', null, 'A-1');
    raise exception 'فشل: اعتُمد جزئيًّا بلا مبلغ ولا كمية';
  exception when others then
    if sqlerrm not like '%المبلغ أو الكمية%' then raise; end if;
  end;

  perform app_set_preauth_status(v_pa, 'partially_approved', 'اعتُمد جزء المبلغ',
                                 1500, 'APR-100', current_date + 60, 1);
  if (select approved_amount from insurance_preauthorizations where id = v_pa) <> 1500 then
    raise exception 'فشل: المبلغ المعتمَد لم يُحفَظ';
  end if;
  raise notice '✅ ٢) الموافقة تمرّ بدورتها كاملةً، والجزئية تحمل مبلغها وكمّيتها';

  -- والموافقة الجزئية **سارية** لغرض التنفيذ
  if (app_active_preauthorization(v_patient, v_mri)).id is null then
    raise exception 'فشل: الموافقة الجزئية لا تُعدّ سارية — موافقةٌ على بعضٍ موافقةٌ على ذلك البعض';
  end if;
  raise notice '✅ ٣) الموافقة الجزئية سارية على ما اعتُمد منها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) زيارة وفاتورة موزَّعة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                              visit_date, status)
    values (v_org, v_patient, v_doctor, v_branch, current_date, 'in_progress')
    returning id into v_visit;
  insert into patient_visit_diagnoses (visit_id, icd10_code_id)
    values (v_visit, v_icd);
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_cons, 1, 250, 'performed'),
           (v_org, v_visit, v_mri, 1, 1800, 'performed');

  v_inv := app_create_invoice_from_visit(v_visit, true, v_member);
  perform app_set_invoice_status(v_inv, 'unpaid');

  select insurance_share_amount into v_num from sales_invoices where id = v_inv;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: الفاتورة بلا حصّة تأمين رغم عضوية سارية';
  end if;
  raise notice '✅ ٤) الفاتورة موزَّعة بين المريض والشركة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) المطالبة من الزيارة
  -- ═════════════════════════════════════════════════════════════════════════
  v_claim := app_create_claim_from_visit(v_visit, v_inv);
  select count(*) into v_int from insurance_claim_form_items where form_id = v_claim;
  if v_int <> 2 then raise exception 'فشل: المطالبة تحمل % بندًا لا اثنين', v_int; end if;

  -- الأكواد رُبطت
  if exists (select 1 from insurance_claim_form_items
              where form_id = v_claim and service_code is null) then
    raise exception 'فشل: بند بلا كود مطالبة';
  end if;

  -- التشخيص والأهلية مربوطان
  if (select diagnoses from insurance_claim_forms where id = v_claim) is null then
    raise exception 'فشل: المطالبة بلا تشخيص';
  end if;
  if (select eligibility_check_id from insurance_claim_forms where id = v_claim) is null then
    raise exception 'فشل: المطالبة لا تشير إلى فحص الأهلية';
  end if;

  -- الموافقة مربوطة بالبند الذي يحتاجها
  if (select preauthorization_id from insurance_claim_form_items
       where form_id = v_claim and item_id = v_mri) is null then
    raise exception 'فشل: بند الرنين لا يشير إلى موافقته المسبقة';
  end if;

  -- خدمات الزيارة صارت «مُطالَبًا بها»
  select count(*) into v_int from patient_visit_services
   where visit_id = v_visit and status = 'claimed';
  if v_int <> 2 then raise exception 'فشل: % خدمة فقط عُلّمت مُطالَبًا بها', v_int; end if;
  raise notice '✅ ٥) المطالبة تُبنى من الزيارة بتشخيصها وأكوادها وموافقاتها وأهليتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) لا مطالبة مكرّرة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_create_claim_from_visit(v_visit, v_inv);
    raise exception 'فشل: أُنشئت مطالبة ثانية لنفس الزيارة';
  exception when others then
    if sqlerrm not like '%مطالبة قائمة%' then raise; end if;
    raise notice '✅ ٦) لا مطالبتان لزيارة واحدة';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) اكتشاف الناقص: خدمة بلا كود
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_v2 uuid; v_i2 uuid; v_c2 uuid; v_no_code uuid;
  begin
    insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
      values (v_org, 'service', 'NOCODE', 'خدمة بلا كود', 100, 'procedure')
      returning id into v_no_code;
    insert into price_list_items (organization_id, price_list_id, item_id, price, effective_from)
      values (v_org, v_list, v_no_code, 100, current_date - 10);
    insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                                visit_date, status)
      values (v_org, v_patient, v_doctor, v_branch, current_date, 'in_progress')
      returning id into v_v2;
    insert into patient_visit_diagnoses (visit_id, icd10_code_id) values (v_v2, v_icd);
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_v2, v_no_code, 1, 100, 'performed');
    v_i2 := app_create_invoice_from_visit(v_v2, true, v_member);
    perform app_set_invoice_status(v_i2, 'unpaid');
    v_c2 := app_create_claim_from_visit(v_v2, v_i2);

    if (select status from insurance_claim_forms where id = v_c2) <> 'validation_failed' then
      raise exception 'فشل: مطالبة بخدمة بلا كود لم تُعلَّم ناقصة';
    end if;
    if (select validation_errors from insurance_claim_forms where id = v_c2) is null then
      raise exception 'فشل: أخطاء التحقّق لم تُسجَّل';
    end if;
  end;
  raise notice '✅ ٧) المطالبة الناقصة تُعلَّم قبل الإرسال لا بعد الرفض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الرفض على مستوى **البند**
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_claim_form_status(v_claim, 'ready');
  perform app_set_claim_form_status(v_claim, 'submitted');

  select id into v_item from insurance_claim_form_items
   where form_id = v_claim and item_id = v_cons;

  begin
    perform app_record_claim_item_response(v_item, 'rejected');
    raise exception 'فشل: رُفض بند بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;

  perform app_record_claim_item_response(v_item, 'rejected', null, 'CR-102',
                                         'الخدمة غير مغطّاة بالبوليصة');
  if (select rejected_amount from insurance_claim_form_items where id = v_item) <= 0 then
    raise exception 'فشل: مبلغ رفض البند لم يُسجَّل';
  end if;

  -- البند الآخر يُعتمد جزئيًّا
  select id into v_item from insurance_claim_form_items
   where form_id = v_claim and item_id = v_mri;
  select claimed_amount into v_num from insurance_claim_form_items where id = v_item;

  begin
    perform app_record_claim_item_response(v_item, 'partially_approved', v_num + 100,
                                           null, 'محاولة');
    raise exception 'فشل: اعتُمد أكثر من المطالَب به';
  exception when others then
    if sqlerrm not like '%يتجاوز المطالَب%' then raise; end if;
  end;

  perform app_record_claim_item_response(v_item, 'partially_approved', v_num - 200,
                                         'CR-215', 'تخفيض تعرفة');

  -- حالة المطالبة اشتُقّت من بنودها
  if (select status from insurance_claim_forms where id = v_claim) <> 'partially_approved' then
    raise exception 'فشل: حالة المطالبة لم تُشتقّ من بنودها (%)',
      (select status from insurance_claim_forms where id = v_claim);
  end if;
  if (select approved_amount from insurance_claim_forms where id = v_claim) <> v_num - 200 then
    raise exception 'فشل: مجموع المعتمَد على المطالبة خاطئ';
  end if;
  raise notice '✅ ٨) الردّ على مستوى البند بكوده وسببه، وحالة المطالبة تُشتقّ منه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) إعادة التقديم تُنشئ نسخة
  -- ═════════════════════════════════════════════════════════════════════════
  v_claim2 := app_resubmit_claim_form(v_claim, 'أُرفق تقرير الطبيب وكود مصحَّح');
  if (select resubmission_of_id from insurance_claim_forms where id = v_claim2) <> v_claim then
    raise exception 'فشل: النسخة لا تشير إلى أصلها';
  end if;
  if (select status from insurance_claim_forms where id = v_claim) <> 'resubmitted' then
    raise exception 'فشل: الأصل لم يُوسَم بإعادة التقديم';
  end if;
  raise notice '✅ ٩) إعادة التقديم تُنشئ نسخة وتترك الأصل شاهدًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) التسوية المالية
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_c3 uuid; v_v3 uuid; v_i3 uuid; v_it3 uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                                visit_date, status)
      values (v_org, v_patient, v_doctor, v_branch, current_date, 'in_progress')
      returning id into v_v3;
    insert into patient_visit_diagnoses (visit_id, icd10_code_id) values (v_v3, v_icd);
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_v3, v_cons, 1, 250, 'performed');
    v_i3 := app_create_invoice_from_visit(v_v3, true, v_member);
    perform app_set_invoice_status(v_i3, 'unpaid');
    v_c3 := app_create_claim_from_visit(v_v3, v_i3);
    perform app_set_claim_form_status(v_c3, 'ready');
    perform app_set_claim_form_status(v_c3, 'submitted');

    select id into v_it3 from insurance_claim_form_items where form_id = v_c3 limit 1;
    select claimed_amount into v_num from insurance_claim_form_items where id = v_it3;
    perform app_record_claim_item_response(v_it3, 'approved', v_num);

    if (select status from insurance_claim_forms where id = v_c3) <> 'approved' then
      raise exception 'فشل: المطالبة لم تُعتمد رغم اعتماد كل بنودها';
    end if;

    -- التسوية
    v_settle := app_settle_insurance_claims(v_company, array[v_c3], v_num - 5, 'TRF-77',
                                            'خصم رسوم تحويل');
    if (select total_paid from insurance_settlements where id = v_settle) <> v_num - 5 then
      raise exception 'فشل: مبلغ التسوية لم يُسجَّل';
    end if;
    if (select settled_amount from insurance_claim_forms where id = v_c3) <> v_num - 5 then
      raise exception 'فشل: المسدَّد لم يُنسب إلى المطالبة';
    end if;
    if (select status from insurance_claim_forms where id = v_c3) <> 'settled' then
      raise exception 'فشل: المطالبة لم تُعلَّم مسوّاة';
    end if;
    if (select variance_amount from insurance_settlement_claims
         where settlement_id = v_settle) <> -5 then
      raise exception 'فشل: الفرق بين المعتمَد والمدفوع لم يُحسب';
    end if;
  end;
  raise notice '✅ ١٠) التسوية تُطابق الدفعة بالمطالبات وتُظهر الفرق';

  -- ولا تُسوّى مطالبة غير معتمَدة
  begin
    perform app_settle_insurance_claims(v_company, array[v_claim2], 100);
    raise exception 'فشل: سُوّيت مطالبة مسوّدة';
  exception when others then
    if sqlerrm not like '%المعتمَدة كليًّا أو جزئيًّا%' then raise; end if;
    raise notice '✅ ١١) لا تسوية لمطالبة لم تُعتمد';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) طبقة نفيس: طابور بلا إرسال، ولا تكرار
  -- ═════════════════════════════════════════════════════════════════════════
  -- ١٢-أ) شركة غير مفعَّلة على نفيس أو بلا معرّف دافع: تُرفض قبل الإدراج،
  -- لأن الإدراج يسم المطالبة "مُرسَلة" ثم ترتدّ من البوّابة فتضيع المتابعة.
  begin
    perform app_queue_nphies_message(v_org, 'claim', '{"x":0}'::jsonb, v_claim2);
    raise exception 'فشل: أُدرجت رسالة لشركة غير مفعَّلة على نفيس';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير مفعَّلة على نفيس%' then raise; end if;
  end;

  update insurance_companies set nphies_enabled = true, nphies_payer_id = null
   where id = v_company;
  begin
    perform app_queue_nphies_message(v_org, 'claim', '{"x":0}'::jsonb, v_claim2);
    raise exception 'فشل: أُدرجت رسالة بلا معرّف دافع';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%معرّف الدافع%' then raise; end if;
  end;

  update insurance_companies set nphies_payer_id = 'PAYER-TEST-001' where id = v_company;

  v_msg := app_queue_nphies_message(v_org, 'claim', '{"x":1}'::jsonb, v_claim2);
  -- معرّف الدافع يُحقن في الظرف، والمفاتيح تبقى خارج القاعدة
  if (select request_payload->>'payer_id' from nphies_messages where id = v_msg)
     is distinct from 'PAYER-TEST-001' then
    raise exception 'فشل: معرّف الدافع لم يُحقن في ظرف الرسالة';
  end if;
  -- الأعمدة القديمة على نموذج المطالبة تُكتب، فلا تبقى شاشة المطالبات فارغة
  if (select nphies_status from insurance_claim_forms where id = v_claim2) <> 'queued'
     or (select nphies_request_id from insurance_claim_forms where id = v_claim2) is null
     or (select nphies_last_sync_at from insurance_claim_forms where id = v_claim2) is null then
    raise exception 'فشل: حالة نفيس لم تُكتب على نموذج المطالبة';
  end if;
  if (select status from nphies_messages where id = v_msg) <> 'queued' then
    raise exception 'فشل: الرسالة لم تدخل الطابور';
  end if;
  if (select environment from nphies_messages where id = v_msg) <> 'sandbox' then
    raise exception 'فشل: البيئة ليست sandbox';
  end if;
  if (select sent_at from nphies_messages where id = v_msg) is not null then
    raise exception 'فشل: سُجّل إرسال — لا إرسال في هذه المرحلة';
  end if;

  begin
    perform app_queue_nphies_message(v_org, 'claim', '{"x":2}'::jsonb, v_claim2);
    raise exception 'فشل: أُدرجت رسالة ثانية حيّة لنفس المطالبة — إرسال مزدوج';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    raise notice '✅ ١٢) رسالة حيّة واحدة لكل مرجع — لا إرسال مزدوج';
  end;

  -- الرسالة بلا مرجع مرفوضة
  begin
    perform app_queue_nphies_message(v_org, 'claim', '{}'::jsonb);
    raise exception 'فشل: أُدرجت رسالة بلا مرجع';
  exception when others then
    if sqlerrm not like '%ترتبط بمطالبة%' then raise; end if;
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الاستجابة تُترجَم إلى حالة داخلية
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_claim_form_status(v_claim2, 'ready');
  perform app_record_nphies_response(v_msg, 'sent');
  if (select status from insurance_claim_forms where id = v_claim2) <> 'submitted' then
    raise exception 'فشل: إرسال الرسالة لم ينقل المطالبة إلى مُقدَّمة (%)',
      (select status from insurance_claim_forms where id = v_claim2);
  end if;

  perform app_record_nphies_response(v_msg, 'acknowledged', '{"ok":true}'::jsonb);
  if (select status from insurance_claim_forms where id = v_claim2) <> 'acknowledged' then
    raise exception 'فشل: الإشعار بالاستلام لم يُترجَم';
  end if;
  if (select responded_at from nphies_messages where id = v_msg) is null then
    raise exception 'فشل: وقت الاستجابة لم يُختم';
  end if;
  -- حالة النقل تنعكس على نموذج المطالبة، لا على جدول الرسائل وحده
  if (select nphies_status from insurance_claim_forms where id = v_claim2) <> 'acknowledged' then
    raise exception 'فشل: حالة نفيس على نموذج المطالبة لم تُحدَّث بعد الاستجابة';
  end if;
  raise notice '✅ ١٣) استجابة نفيس تُترجَم إلى حالة داخلية — والطبقتان منفصلتان';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) المناظير
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_claim_settlement
                  where claim_form_id = v_claim and rejected_items > 0
                    and rejection_codes is not null) then
    raise exception 'فشل: سجل التسوية لا يعرض البنود المرفوضة وأكوادها';
  end if;
  select outstanding into v_num from v_insurance_receivables where company_id = v_company;
  if v_num is null then raise exception 'فشل: ذمم الشركة لا تُحسب'; end if;
  if not exists (select 1 from v_nphies_queue where id = v_msg) then
    raise exception 'فشل: طابور نفيس لا يعرض الرسالة';
  end if;
  raise notice '✅ ١٤) سجل التسوية وذمم الشركات وطابور نفيس تعمل';

  raise notice '——— كل فحوص المطالبات نجحت ———';
end $$;

rollback;
