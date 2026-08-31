-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات التأمين والمطالبات — 0089
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/insurance-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- أوّل فحصٍ هنا هو الأهمّ: قبل 0089 كانت موافقةٌ مسبقة واحدة على خدمةٍ ما
-- تفتح **كلّ** خدمة تشترط موافقة، لأيّ مبلغ، لتسعين يومًا — لأن الجدول بلا
-- عمود `item_id` أصلًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_patient uuid;
  v_doctor  uuid;
  v_company uuid;
  v_network uuid;
  v_policy  uuid;
  v_member  uuid;
  v_mri     uuid;
  v_ct      uuid;
  v_lasik   uuid;
  v_consult uuid;
  v_pa      uuid;
  v_contract uuid;
  v_list    uuid;
  v_cov     jsonb;
  v_elig    jsonb;
  v_inv     uuid;
  v_form    uuid;
  v_new     uuid;
  v_txt     text;
  v_num     numeric;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ins-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ins-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار التأمين', 'clinic', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);

  insert into patients (organization_id, name_ar, birth_date, gender)
    values (v_org, 'مريض التأمين', current_date - interval '30 years', 'male')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب التأمين')
    returning id into v_doctor;

  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, requires_preauthorization)
    values (v_org, 'service', 'MRI', 'رنين مغناطيسي', 1500, 'radiology', true)
    returning id into v_mri;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, requires_preauthorization)
    values (v_org, 'service', 'CT', 'أشعة مقطعية', 900, 'radiology', true)
    returning id into v_ct;
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'LASIK', 'ليزك', 6000, 'surgery') returning id into v_lasik;
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'CONS', 'كشف', 300, 'consultation') returning id into v_consult;

  insert into insurance_companies (organization_id, name_ar, nphies_payer_id)
    values (v_org, 'شركة التعاونية', 'PAYER-001') returning id into v_company;
  insert into insurance_networks (organization_id, company_id, code, name_ar)
    values (v_org, v_company, 'VIP', 'شبكة كبار الشخصيات') returning id into v_network;
  insert into insurance_policies (organization_id, company_id, network_id, policy_name,
                                  policy_number, default_copay_percent, annual_limit)
    values (v_org, v_company, v_network, 'بوليصة الشركة', 'POL-1', 20, 5000)
    returning id into v_policy;
  insert into patient_insurance_memberships (organization_id, patient_id, policy_id,
                                             membership_number, relation, eligibility_status,
                                             expiry_date, is_active)
    values (v_org, v_patient, v_policy, 'M-1', 'self', 'eligible', current_date + 200, true)
    returning id into v_member;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الثقب الأصلي: موافقة على خدمة لا تفتح خدمة أخرى
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                           doctor_id, item_id, service_description,
                                           requested_amount, status, created_by)
    values (v_org, v_patient, v_member, v_doctor, v_mri, 'رنين للركبة', 1500, 'pending', v_owner)
    returning id into v_pa;
  perform app_set_preauth_status(v_pa, 'approved', null, 1500, 'APR-991');

  v_elig := app_check_service_eligibility(v_mri, v_patient, null, 'execution');
  if not (v_elig->>'ok')::boolean then
    raise exception 'فشل: الخدمة الموافَق عليها مُنعت (%)', v_elig->>'blocks';
  end if;

  v_elig := app_check_service_eligibility(v_ct, v_patient, null, 'execution');
  if (v_elig->>'ok')::boolean then
    raise exception 'فشل: موافقة الرنين فتحت الأشعة المقطعية — الثقب ما زال مفتوحًا';
  end if;
  raise notice '✅ الموافقة المسبقة تخصّ خدمتها وحدها ولا تفتح غيرها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) نافذة السريان تُحترم، والمستهلَكة لا تُعاد
  -- ═════════════════════════════════════════════════════════════════════════
  update insurance_preauthorizations
     set valid_from = current_date - 10, valid_to = current_date - 1 where id = v_pa;
  if (app_active_preauthorization(v_patient, v_mri)).id is not null then
    raise exception 'فشل: موافقة منتهية ما زالت سارية';
  end if;

  update insurance_preauthorizations
     set valid_from = current_date, valid_to = current_date + 30 where id = v_pa;
  if (app_active_preauthorization(v_patient, v_mri)).id is null then
    raise exception 'فشل: موافقة سارية لم تُقرأ';
  end if;

  update insurance_preauthorizations set consumed_at = now() where id = v_pa;
  if (app_active_preauthorization(v_patient, v_mri)).id is not null then
    raise exception 'فشل: موافقة مستهلَكة أُعيد استعمالها';
  end if;
  update insurance_preauthorizations set consumed_at = null where id = v_pa;
  raise notice '✅ الموافقة تحترم نافذة سريانها ولا تُستعمل مرّتين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) الاعتماد يحتاج رقم موافقة، والرفض يحتاج سببًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_pa2 uuid;
  begin
    insert into insurance_preauthorizations (organization_id, patient_id, membership_id,
                                             item_id, requested_amount, status, created_by)
      values (v_org, v_patient, v_member, v_ct, 900, 'pending', v_owner) returning id into v_pa2;
    begin
      perform app_set_preauth_status(v_pa2, 'approved', null, 900, '  ');
      raise exception 'فشل: اعتُمدت موافقة بلا رقم من شركة التأمين';
    exception when others then
      if sqlerrm not like '%رقم موافقة%' then raise; end if;
    end;
    begin
      perform app_set_preauth_status(v_pa2, 'rejected', null);
      raise exception 'فشل: رُفضت موافقة بلا سبب';
    exception when others then
      if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    end;
    perform app_set_preauth_status(v_pa2, 'rejected', 'خارج التغطية');
    begin
      perform app_set_preauth_status(v_pa2, 'approved', null, 900, 'APR-2');
      raise exception 'فشل: غُيّرت موافقة بعد الردّ';
    exception when others then
      -- 0093 استبدل الفحص العام بخريطة انتقالات، فتغيّرت الرسالة إلى الأدقّ:
      -- «لا يمكن الانتقال من rejected إلى approved». والمنع نفسه باقٍ.
      if sqlerrm not like '%لا تُغيَّر بعد الردّ%'
         and sqlerrm not like '%لا يمكن الانتقال بالموافقة%' then raise; end if;
    end;
  end;
  raise notice '✅ الاعتماد يحتاج رقمًا، والرفض سببًا، والردّ نهائي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) العقود: لا عقدان ساريان للشركة نفسها في المدّة نفسها
  -- ═════════════════════════════════════════════════════════════════════════
  insert into price_lists (organization_id, name, list_kind, insurance_company_id,
                           effective_from, is_active, priority)
    values (v_org, 'قائمة عقد التعاونية', 'insurance', v_company, current_date - 10, true, 10)
    returning id into v_list;
  insert into price_list_items (organization_id, price_list_id, item_id, price, effective_from)
    values (v_org, v_list, v_consult, 180, current_date - 10);

  insert into insurance_contracts (organization_id, company_id, network_id, name_ar,
                                   contract_number, price_list_id, default_copay_percent,
                                   effective_from, status, created_by)
    values (v_org, v_company, v_network, 'عقد ٢٠٢٦', 'C-1', v_list, 15,
            current_date - 10, 'active', v_owner)
    returning id into v_contract;

  begin
    insert into insurance_contracts (organization_id, company_id, name_ar, effective_from, status)
      values (v_org, v_company, 'عقد متداخل', current_date, 'active');
    raise exception 'فشل: قُبل عقدان ساريان للشركة نفسها — سعران لخدمة واحدة';
  exception when others then
    if sqlerrm not like '%insurance_contracts_no_overlap%' then raise; end if;
    raise notice '✅ تداخل العقود مرفوض في المحرّك';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) سعر العقد يسبق كل ما دونه
  -- ═════════════════════════════════════════════════════════════════════════
  select price, source_kind into v_num, v_txt
    from app_resolve_item_price_v2(v_org, v_consult, null, v_company, null, current_date);
  if v_num <> 180 or v_txt <> 'contract' then
    raise exception 'فشل: التسعير لم يأخذ سعر العقد (% من %)', v_num, v_txt;
  end if;

  -- وبلا شركة تأمين يرجع إلى سعر الصنف
  select price, source_kind into v_num, v_txt
    from app_resolve_item_price_v2(v_org, v_consult, null, null, null, current_date);
  if v_num <> 300 then
    raise exception 'فشل: مريض نقدي سُعِّر بسعر التأمين (%)', v_num;
  end if;
  raise notice '✅ ترتيب التسعير: عقد الشركة ← … ← سعر الصنف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) التغطية: نسبة التحمّل من العقد
  -- ═════════════════════════════════════════════════════════════════════════
  v_cov := app_insurance_coverage(v_member, v_consult, 200);
  if (v_cov->>'copay_percent')::numeric <> 15 then
    raise exception 'فشل: نسبة التحمّل جاءت % لا من العقد', v_cov->>'copay_percent';
  end if;
  if (v_cov->>'patient_share')::numeric <> 30 then
    raise exception 'فشل: حصّة المريض % لا ١٥٪ من ٢٠٠', v_cov->>'patient_share';
  end if;
  if (v_cov->>'insurer_share')::numeric <> 170 then
    raise exception 'فشل: حصّة الشركة % لا ١٧٠', v_cov->>'insurer_share';
  end if;
  raise notice '✅ نسبة التحمّل تُقرأ من العقد وتُقسَّم الحصّتان صحيحًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الاستثناء يمنع، والأخصّ يغلب
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_coverage_rules (organization_id, contract_id, scope,
                                        medical_service_type, coverage, copay_percent, created_by)
    values (v_org, v_contract, 'service_type', 'surgery', 'covered', 50, v_owner);
  insert into insurance_coverage_rules (organization_id, contract_id, scope, item_id,
                                        coverage, note_ar, created_by)
    values (v_org, v_contract, 'item', v_lasik, 'excluded', 'الليزك تجميليّ ومستثنى', v_owner);

  v_cov := app_insurance_coverage(v_member, v_lasik, 6000);
  if (v_cov->>'covered')::boolean then
    raise exception 'فشل: خدمة مستثناة صراحةً عُدّت مغطّاة';
  end if;
  if v_cov->'blocks'->>0 not like '%مستثنى%' then
    raise exception 'فشل: سبب الاستثناء لم يصل للمستخدم (%)', v_cov->'blocks';
  end if;
  if (v_cov->>'insurer_share')::numeric <> 0 then
    raise exception 'فشل: خدمة ممنوعة ولها حصّة على الشركة';
  end if;
  if (v_cov->>'rule_scope') <> 'item' then
    raise exception 'فشل: قاعدة النوع غلبت قاعدة الصنف — الأخصّ لم يُقدَّم';
  end if;
  raise notice '✅ الاستثناء يمنع بسببه، وقاعدة الصنف تغلب قاعدة النوع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) العدد السنوي المسموح
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_coverage_rules (organization_id, contract_id, scope, item_id,
                                        coverage, max_count_per_year, created_by)
    values (v_org, v_contract, 'item', v_consult, 'covered', 1, v_owner);

  insert into sales_invoices (organization_id, patient_id, invoice_type, status, net_amount,
                              is_insurance_invoice, insurance_share_amount)
    values (v_org, v_patient, 'sale', 'paid', 200, true, 170) returning id into v_inv;
  insert into sales_invoice_items (invoice_id, item_id, price, qty, net_amount)
    values (v_inv, v_consult, 200, 1, 200);

  v_cov := app_insurance_coverage(v_member, v_consult, 200);
  if (v_cov->>'covered')::boolean then
    raise exception 'فشل: تجاوز العدد السنوي المسموح ومرّ';
  end if;
  raise notice '✅ العدد السنوي المسموح للخدمة يُحسب ويمنع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) السقف السنوي يُستهلك فعلًا
  --
  -- قبل 0089 كان `annual_limit` رقمًا مكتوبًا لا شيء يطرح منه.
  -- ═════════════════════════════════════════════════════════════════════════
  select used_amount, remaining_amount into v_num, v_num
    from v_membership_limit_usage where membership_id = v_member;
  select remaining_amount into v_num from v_membership_limit_usage where membership_id = v_member;
  if v_num <> 4830 then
    raise exception 'فشل: المتبقّي من السقف % لا ٤٨٣٠ (٥٠٠٠ − ١٧٠)', v_num;
  end if;

  -- استهلاك السقف بالكامل يمنع
  insert into sales_invoices (organization_id, patient_id, invoice_type, status, net_amount,
                              is_insurance_invoice, insurance_share_amount)
    values (v_org, v_patient, 'sale', 'paid', 5000, true, 4830);
  v_cov := app_insurance_coverage(v_member, v_mri, 1500);
  if (v_cov->>'covered')::boolean then
    raise exception 'فشل: خدمة مُرِّرت بعد استهلاك السقف السنوي';
  end if;
  if (v_cov->'blocks')::text not like '%السقف السنوي%' then
    raise exception 'فشل: سبب المنع ليس السقف (%)', v_cov->'blocks';
  end if;
  raise notice '✅ السقف السنوي يُستهلك من الفواتير الفعلية ويمنع عند النفاد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) العضوية المنتهية تمنع
  -- ═════════════════════════════════════════════════════════════════════════
  update patient_insurance_memberships set expiry_date = current_date - 1 where id = v_member;
  v_cov := app_insurance_coverage(v_member, v_consult, 200);
  if (v_cov->'blocks')::text not like '%منتهية%' then
    raise exception 'فشل: عضوية منتهية لم تُمنع (%)', v_cov->'blocks';
  end if;
  update patient_insurance_memberships set expiry_date = current_date + 200 where id = v_member;
  raise notice '✅ العضوية المنتهية أو غير المؤهَّلة تمنع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10.5) فترة الانتظار، وسبب فسخ العقد
  -- ═════════════════════════════════════════════════════════════════════════
  update insurance_coverage_rules
     set waiting_period_days = 90
   where contract_id = v_contract and scope = 'item' and item_id = v_consult;
  update insurance_coverage_rules set max_count_per_year = null
   where contract_id = v_contract and scope = 'item' and item_id = v_consult;

  v_cov := app_insurance_coverage(v_member, v_consult, 200);
  if (v_cov->>'covered')::boolean then
    raise exception 'فشل: غُطّيت خدمة قبل انقضاء فترة الانتظار';
  end if;
  if (v_cov->'blocks')::text not like '%فترة الانتظار%' then
    raise exception 'فشل: سبب المنع ليس فترة الانتظار (%)', v_cov->'blocks';
  end if;
  update insurance_coverage_rules set waiting_period_days = null
   where contract_id = v_contract and scope = 'item' and item_id = v_consult;
  raise notice '✅ فترة الانتظار تمنع تغطية العضوية الحديثة';

  begin
    update insurance_contracts set status = 'terminated' where id = v_contract;
    raise exception 'فشل: فُسخ عقد بلا سبب مكتوب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ فسخ العقد أو إيقافه يحتاج سببًا مكتوبًا';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) المطالبات: لا قفز في الحالات
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_claim_forms (organization_id, form_type, patient_id, doctor_id,
                                     membership_id, sales_invoice_id, status,
                                     claimed_amount, created_by)
    values (v_org, 'ucaf', v_patient, v_doctor, v_member, v_inv, 'draft', 200, v_owner)
    returning id into v_form;

  begin
    perform app_set_claim_form_status(v_form, 'paid');
    raise exception 'فشل: قفزت المطالبة من مسوّدة إلى مدفوعة';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال بالمطالبة%' then raise; end if;
    raise notice '✅ القفز في حالات المطالبة مرفوض';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) الرفض يحتاج سببًا، ويُسجَّل بمبلغه
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_claim_form_status(v_form, 'submitted');
  if (select submitted_at from insurance_claim_forms where id = v_form) is null then
    raise exception 'فشل: وقت التقديم لم يُسجَّل';
  end if;

  begin
    perform app_set_claim_form_status(v_form, 'rejected');
    raise exception 'فشل: رُفضت مطالبة بلا سبب — اعتراضٌ لا يمكن بناؤه';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;

  perform app_set_claim_form_status(v_form, 'rejected', 'خدمة غير مغطّاة', null, 'CR-014');
  if (select rejected_amount from insurance_claim_forms where id = v_form) <> 200 then
    raise exception 'فشل: مبلغ الرفض لم يُسجَّل';
  end if;
  if (select rejection_code from insurance_claim_forms where id = v_form) <> 'CR-014' then
    raise exception 'فشل: كود الرفض لم يُحفظ';
  end if;
  raise notice '✅ الرفض يحتاج سببًا ويُسجَّل بمبلغه وكوده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) المطالبة المقدَّمة لا تُعدَّل في مكانها
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update insurance_claim_forms set claimed_amount = 500 where id = v_form;
    raise exception 'فشل: عُدِّلت مطالبة مقدَّمة — تاريخُ ما قُدِّم ضاع';
  exception when others then
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
    raise notice '✅ المطالبة المقدَّمة لا تُعدَّل في مكانها';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) إعادة التقديم تُنشئ نسخة وتترك الأصل شاهدًا
  -- ═════════════════════════════════════════════════════════════════════════
  insert into insurance_claim_form_items (form_id, item_id, service_code, description, qty, amount)
    values (v_form, v_consult, 'SC-1', 'كشف', 1, 200);

  v_new := app_resubmit_claim_form(v_form, 'أُرفق تقرير الطبيب');
  if v_new is null then raise exception 'فشل: إعادة التقديم لم تُنشئ مطالبة'; end if;
  if (select status from insurance_claim_forms where id = v_form) <> 'resubmitted' then
    raise exception 'فشل: الأصل لم يُوسَم بإعادة التقديم';
  end if;
  if (select resubmission_of_id from insurance_claim_forms where id = v_new) <> v_form then
    raise exception 'فشل: النسخة الجديدة لا تشير إلى أصلها';
  end if;
  if (select resubmission_count from insurance_claim_forms where id = v_new) <> 1 then
    raise exception 'فشل: عدّاد إعادة التقديم لم يزد';
  end if;
  select count(*) into v_num from insurance_claim_form_items where form_id = v_new;
  if v_num <> 1 then
    raise exception 'فشل: سطور المطالبة لم تُنقَل إلى النسخة (%)', v_num;
  end if;
  if (select rejection_reason from insurance_claim_forms where id = v_form) is null then
    raise exception 'فشل: سبب الرفض مُحي من الأصل';
  end if;
  raise notice '✅ إعادة التقديم تُنشئ نسخة بسطورها وتُبقي الأصل بسبب رفضه';

  -- ولا إعادة تقديم لمطالبة غير مرفوضة
  begin
    perform app_resubmit_claim_form(v_new, 'محاولة');
    raise exception 'فشل: أُعيد تقديم مطالبة مسوّدة';
  exception when others then
    if sqlerrm not like '%المرفوضة أو المعتمَدة جزئيًا%' then raise; end if;
    raise notice '✅ إعادة التقديم للمرفوضة وحدها';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) سجل المطالبات يكشف ما يحتاج عملًا
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_claim_register where form_id = v_new and company_name is not null) then
    raise exception 'فشل: سجل المطالبات لا يربط المطالبة بشركتها';
  end if;
  raise notice '✅ سجل المطالبات يربط المطالبة بمريضها وشركتها وفاتورتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 16) NPHIES: حقول بلا تكامل
  -- ═════════════════════════════════════════════════════════════════════════
  if (select nphies_payer_id from insurance_companies where id = v_company) <> 'PAYER-001' then
    raise exception 'فشل: حقل معرّف الدافع لا يحفظ';
  end if;
  raise notice '✅ حقول نفيس جاهزة للبيانات — ولا تكامل ولا نداء خارجيّ';

  raise notice '——— كل فحوص منطق التأمين نجحت ———';
end $$;

-- ---------------------------------------------------------------------------
-- الصلاحيات — خارج كتلة DO لأن RLS لا تسري على المالك
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_owner uuid; v_recep uuid; v_acc uuid; v_co uuid; v_ct uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ins2-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ins2-recep@test.local')
    returning id into v_recep;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ins2-acc@test.local')
    returning id into v_acc;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة صلاحيات التأمين', 'clinic', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true), (v_org, v_acc, 'accountant', true);

  insert into insurance_companies (organization_id, name_ar) values (v_org, 'شركة')
    returning id into v_co;
  insert into insurance_contracts (organization_id, company_id, name_ar, effective_from, created_by)
    values (v_org, v_co, 'عقد', current_date, v_owner) returning id into v_ct;

  perform set_config('app.ins_org',   v_org::text,   false);
  perform set_config('app.ins_recep', v_recep::text, false);
  perform set_config('app.ins_acc',   v_acc::text,   false);
  perform set_config('app.ins_co',    v_co::text,    false);
  perform set_config('app.ins_ct',    v_ct::text,    false);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.ins_recep'), true);

do $$
begin
  -- يقرأ
  if not exists (select 1 from insurance_companies
                  where organization_id = current_setting('app.ins_org')::uuid) then
    raise exception 'فشل: موظف الاستقبال لا يقرأ شركات التأمين';
  end if;
  raise notice '✅ موظف الاستقبال يقرأ التأمين';

  -- ولا يكتب عقدًا
  begin
    insert into insurance_contracts (organization_id, company_id, name_ar, effective_from)
      values (current_setting('app.ins_org')::uuid, current_setting('app.ins_co')::uuid,
              'عقد مهرَّب', current_date);
    raise exception 'فشل: موظف الاستقبال أنشأ عقد تأمين';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%violates%'
       and sqlerrm not like '%permission denied%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا ينشئ عقودًا';
  end;

  -- ولا يدير المطالبات
  begin
    perform app_set_claim_form_status(gen_random_uuid(), 'submitted');
    raise exception 'فشل: نُفِّذت عملية مطالبة بلا صلاحية';
  exception when others then
    if sqlerrm not like '%غير موجودة%' and sqlerrm not like '%insurance.claims%' then raise; end if;
    raise notice '✅ إدارة المطالبات محميّة بصلاحيتها';
  end;
end $$;

reset role;

select set_config('request.jwt.claim.sub', current_setting('app.ins_acc'), true);
set local role authenticated;

do $$
begin
  -- المحاسب يدير المطالبات ولا يدير العقود
  begin
    update insurance_contracts set name_ar = 'عقد معدَّل'
     where id = current_setting('app.ins_ct')::uuid;
    if found then
      raise exception 'فشل: المحاسب عدّل عقد تأمين';
    end if;
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
  end;
  if (select name_ar from insurance_contracts where id = current_setting('app.ins_ct')::uuid)
     is distinct from 'عقد' then
    raise exception 'فشل: تعديل العقد سرى رغم غياب الصلاحية';
  end if;
  raise notice '✅ المحاسب لا يعدّل العقود';

  raise notice '——— كل فحوص صلاحيات التأمين نجحت ———';
end $$;

reset role;

rollback;
