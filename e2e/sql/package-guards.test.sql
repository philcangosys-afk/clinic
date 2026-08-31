-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الباقات والاشتراكات — 0096
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/package-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- يتبع مسار الاختبار المطلوب حرفيًّا:
--   إنشاء باقة → بيعها → دفع الفاتورة → تنفيذ الخدمة → خصمها من الرصيد
--   → عرض المتبقّي
-- ثم يهاجم كل حافّة: التجاوز، والانتهاء، والتجميد، والفوترة المزدوجة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_branch  uuid;
  v_branch2 uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_doctor2 uuid;
  v_patient uuid;
  v_child   uuid;
  v_male    uuid;
  v_pkg     uuid;
  v_pkg_f   uuid;
  v_item_a  uuid;
  v_item_b  uuid;
  v_pi_a    uuid;
  v_pi_b    uuid;
  v_sale    jsonb;
  v_pp      uuid;
  v_inv     uuid;
  v_visit   uuid;
  v_svc     uuid;
  v_usage   uuid;
  v_cash    uuid;
  v_reg     uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
  v_json    jsonb;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pkg-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار الباقات', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into branches (organization_id, name) values (v_org, 'فرع ثانٍ')
    returning id into v_branch2;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','PC1','name','عيادة الباقات','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب الباقة')
    returning id into v_doctor;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب آخر')
    returning id into v_doctor2;

  insert into patients (organization_id, branch_id, name_ar, gender, birth_date)
    values (v_org, v_branch, 'مريضة الباقة', 'female', current_date - interval '30 years')
    returning id into v_patient;
  insert into patients (organization_id, branch_id, name_ar, gender, birth_date)
    values (v_org, v_branch, 'طفل', 'male', current_date - interval '6 years')
    returning id into v_child;
  insert into patients (organization_id, branch_id, name_ar, gender, birth_date)
    values (v_org, v_branch, 'رجل', 'male', current_date - interval '35 years')
    returning id into v_male;

  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'PKA', 'كشف متابعة', 200, 'consultation')
    returning id into v_item_a;
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'PKB', 'سونار', 400, 'radiology')
    returning id into v_item_b;

  select lv.id into v_cash from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';
  insert into cash_registers (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'صندوق الباقات', 'PCR1') returning id into v_reg;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) إنشاء الباقة: الوفر يُحسب من البنود لا يُكتب يدويًّا
  -- ═════════════════════════════════════════════════════════════════════════
  -- باقة متابعة حمل: ٤ كشوف + سونارَان. سعر القائمة 4×200 + 2×400 = 1600
  insert into packages (organization_id, branch_id, code, name_ar, price, validity_days,
                        subscription_type, gender_restriction, min_age_years,
                        is_transferable, is_refundable, refund_policy, is_active)
  values (v_org, null, 'PREG', 'باقة متابعة حمل', 1200, 180,
          'one_time', 'female', 18, false, true,
          'يُسترَدّ غير المستخدَم بنسبة قيمته من قيمة الباقة', true)
  returning id into v_pkg;

  insert into package_items (package_id, item_id, quantity_included, max_per_visit)
    values (v_pkg, v_item_a, 4, 1) returning id into v_pi_a;
  insert into package_items (package_id, item_id, quantity_included, max_per_visit)
    values (v_pkg, v_item_b, 2, 1) returning id into v_pi_b;

  select list_price, savings into v_num, v_int from v_package_catalog where id = v_pkg;
  if v_num <> 1600 then
    raise exception 'فشل: سعر القائمة المحسوب % لا ١٦٠٠', v_num;
  end if;
  if v_int <> 400 then
    raise exception 'فشل: وفر الباقة % لا ٤٠٠', v_int;
  end if;
  raise notice '✅ ١) الباقة تُنشأ، وسعر القائمة والوفر يُحسبان من بنودها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الأهلية: العمر والجنس والفرع تُفحص قبل البيع لا بعده
  -- ═════════════════════════════════════════════════════════════════════════
  v_json := app_check_package_eligibility(v_pkg, v_male, v_branch, null);
  if (v_json->>'eligible')::boolean then
    raise exception 'فشل: بِيعت باقة نسائية لرجل';
  end if;
  v_json := app_check_package_eligibility(v_pkg, v_child, v_branch, null);
  if (v_json->>'eligible')::boolean then
    raise exception 'فشل: تجاوزت الأهلية شرط العمر';
  end if;
  v_json := app_check_package_eligibility(v_pkg, v_patient, v_branch, null);
  if (v_json->>'eligible')::boolean is not true then
    raise exception 'فشل: المريضة المؤهّلة رُفضت — %', v_json->'blocks';
  end if;

  -- الفرع: باقة فرعٍ لا تُباع في فرع آخر
  insert into packages (organization_id, branch_id, code, name_ar, price, validity_days, is_active)
  values (v_org, v_branch2, 'BR2', 'باقة الفرع الثاني', 100, 30, true) returning id into v_pkg_f;
  if (app_check_package_eligibility(v_pkg_f, v_patient, v_branch, null)->>'eligible')::boolean then
    raise exception 'فشل: بِيعت باقة فرعٍ في فرعٍ آخر';
  end if;
  -- الطبيب والتخصّص: عمودٌ يَعِد بقيدٍ ولا يفرضه أسوأ من غيابه
  declare v_spec uuid; v_pkg_sp uuid; v_svc_sp uuid; v_pp_sp uuid; v_s_sp jsonb;
  begin
    select lv.id into v_spec from lookup_values lv
      join lookup_categories c on c.id = lv.category_id
     where c.key = 'medical_specialties' limit 1;

    update doctors set specialty_value_id = v_spec where id = v_doctor;
    update doctors set specialty_value_id = null    where id = v_doctor2;

    insert into packages (organization_id, code, name_ar, price, validity_days,
                          allowed_doctor_ids, allowed_specialty_value_id, is_active)
      values (v_org, 'SPEC', 'باقة تخصّص', 100, 60,
              array[v_doctor], v_spec, true) returning id into v_pkg_sp;
    insert into package_items (package_id, item_id, quantity_included)
      values (v_pkg_sp, v_item_a, 2);

    if (app_check_package_eligibility(v_pkg_sp, v_patient, v_branch, v_doctor2)
        ->>'eligible')::boolean then
      raise exception 'فشل: قُبلت الباقة لطبيبٍ خارج القائمة والتخصّص';
    end if;
    if (app_check_package_eligibility(v_pkg_sp, v_patient, v_branch, v_doctor)
        ->>'eligible')::boolean is not true then
      raise exception 'فشل: رُفض الطبيب المشمول بالتخصّص والقائمة';
    end if;

    -- والخصم يفحصهما أيضًا: البيع بلا طبيب ثم الاستهلاك عند طبيبٍ آخر
    v_s_sp  := app_sell_package(v_pkg_sp, v_patient, v_branch);
    v_pp_sp := (v_s_sp->>'patient_package_id')::uuid;

    declare v_visit_sp uuid;
    begin
      insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                  branch_id, visit_date, status)
        values (v_org, v_patient, v_doctor2, v_clinic, v_branch, current_date, 'in_progress')
        returning id into v_visit_sp;
      insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                          unit_price, status, performed_by)
        values (v_org, v_visit_sp, v_item_a, 1, 200, 'performed', v_doctor2)
        returning id into v_svc_sp;
      if (select package_usage_id from patient_visit_services where id = v_svc_sp) is not null then
        raise exception 'فشل: خُصم من باقة تخصّصٍ عند طبيبٍ من تخصّص آخر';
      end if;
    end;

    perform app_cancel_patient_package(v_pp_sp, 'تنظيف الاختبار', false);
  end;
  raise notice '✅ ٢) الأهلية تفحص العمر والجنس والفرع والطبيب والتخصّص — بيعًا وخصمًا';

  begin
    perform app_sell_package(v_pkg, v_male, v_branch);
    raise exception 'فشل: أُتمّ بيع لمريض غير مؤهّل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير مؤهّل%' then raise; end if;
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) البيع يُنشئ فاتورة — لا رصيد بلا فاتورة
  -- ═════════════════════════════════════════════════════════════════════════
  v_sale := app_sell_package(v_pkg, v_patient, v_branch, v_doctor, v_clinic);
  v_pp   := (v_sale->>'patient_package_id')::uuid;
  v_inv  := (v_sale->>'invoice_id')::uuid;

  if v_inv is null then raise exception 'فشل: البيع بلا فاتورة'; end if;
  if (select status from sales_invoices where id = v_inv) <> 'draft' then
    raise exception 'فشل: فاتورة الباقة لم تُنشأ مسوّدة';
  end if;
  select net_amount into v_num from sales_invoices where id = v_inv;
  if v_num <> 1380 then    -- 1200 + 15% = 1380
    raise exception 'فشل: صافي فاتورة الباقة % لا ١٣٨٠', v_num;
  end if;
  if (select expires_at from patient_packages where id = v_pp) is null then
    raise exception 'فشل: الاشتراك بلا تاريخ انتهاء رغم مدّة الصلاحية';
  end if;
  if (select price_paid from patient_packages where id = v_pp) <> 1200 then
    raise exception 'فشل: قيمة الاشتراك لم تُثبَّت';
  end if;

  -- باقتان ساريتان من نفس النوع رصيدان متوازيان لا يُعرف من أيّهما يُخصم
  begin
    perform app_sell_package(v_pkg, v_patient, v_branch);
    raise exception 'فشل: بِيعت باقة ثانية والأولى سارية';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%باقة سارية%' then raise; end if;
  end;
  raise notice '✅ ٣) البيع يُنشئ فاتورة بضريبتها، وباقة سارية واحدة لكل نوع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) دفع الفاتورة
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_invoice_status(v_inv, 'unpaid', null);
  perform app_open_cash_shift(v_reg, 0, null);
  perform app_receive_invoice_payment(v_inv, 1380, v_cash, v_reg, null, 'دفع الباقة');
  if (select status from sales_invoices where id = v_inv) <> 'paid' then
    raise exception 'فشل: فاتورة الباقة لم تُسدَّد كاملةً';
  end if;
  raise notice '✅ ٤) الفاتورة تُصدَر وتُسدَّد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) تنفيذ الخدمة يخصم من الرصيد **تلقائيًّا**
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
    returning id into v_visit;

  -- الطلب وحده لا يخصم
  insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                      unit_price, status, performed_by)
    values (v_org, v_visit, v_item_a, 1, 200, 'ordered', v_doctor)
    returning id into v_svc;
  if (select package_usage_id from patient_visit_services where id = v_svc) is not null then
    raise exception 'فشل: خُصم الرصيد على خدمة مطلوبة لم تُنفَّذ بعد';
  end if;

  -- التنفيذ يخصم
  update patient_visit_services set status = 'performed' where id = v_svc;
  select package_usage_id into v_usage from patient_visit_services where id = v_svc;
  if v_usage is null then
    raise exception 'فشل: تنفيذ الخدمة لم يخصم من الباقة — ستُفوتَر على المريضة مرّتين';
  end if;
  if (select quantity_used from patient_package_usages where id = v_usage) <> 1 then
    raise exception 'فشل: الكمّية المخصومة ليست ١';
  end if;
  if (select visit_service_id from patient_package_usages where id = v_usage) <> v_svc then
    raise exception 'فشل: الاستخدام غير مربوط بالخدمة المنفَّذة';
  end if;
  raise notice '✅ ٥) تنفيذ الخدمة يخصم من الباقة تلقائيًّا، والطلب وحده لا يخصم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) المتبقّي يُعرض صحيحًا
  -- ═════════════════════════════════════════════════════════════════════════
  select quantity_remaining into v_num from v_patient_package_balances
   where patient_package_id = v_pp and package_item_id = v_pi_a;
  if v_num <> 3 then
    raise exception 'فشل: المتبقّي من الكشوف % لا ٣', v_num;
  end if;
  select total_remaining into v_num from v_patient_subscriptions
   where patient_package_id = v_pp;
  if v_num <> 5 then    -- 3 كشوف + 2 سونار
    raise exception 'فشل: مجموع المتبقّي % لا ٥', v_num;
  end if;
  raise notice '✅ ٦) المتبقّي يُعرض صحيحًا بالبند وبالمجموع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) **لا فوترة مزدوجة**: الخدمة المغطّاة تُعرض بصفر لا بسعرها
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_inv2 uuid;
  begin
    v_inv2 := app_create_invoice_from_visit(v_visit, false);
    select price, net_amount into v_num, v_int from sales_invoice_items
     where invoice_id = v_inv2 and item_id = v_item_a;
    if v_num is null then
      raise exception 'فشل: الخدمة المغطّاة اختفت من الفاتورة — المريضة لا ترى ما تلقّته';
    end if;
    if v_num <> 0 or v_int <> 0 then
      raise exception 'فشل: الخدمة المدفوعة سلفًا حُمّلت بـ % — فوترة مزدوجة', v_num;
    end if;
    if (select description from sales_invoice_items
         where invoice_id = v_inv2 and item_id = v_item_a) not like '%مشمولة بالباقة%' then
      raise exception 'فشل: البند بصفرٍ بلا بيانٍ للسبب';
    end if;
  end;
  raise notice '✅ ٧) الخدمة المشمولة تُعرض بصفر مع بيان السبب — لا فوترة مزدوجة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) منع التجاوز: الكمّية وحدّ الزيارة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into patient_package_usages (patient_package_id, package_item_id,
                                        quantity_used, used_by)
    values (v_pp, v_pi_a, 99, v_owner);
    raise exception 'فشل: خُصمت كمّية تتجاوز رصيد الباقة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%تتجاوز المتبقي%' then raise; end if;
  end;

  -- حدّ الزيارة الواحدة: كشفان في زيارة واحدة لا يُغطّى ثانيهما
  declare v_svc2 uuid;
  begin
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, performed_by)
      values (v_org, v_visit, v_item_a, 2, 200, 'performed', v_doctor)
      returning id into v_svc2;
    if (select package_usage_id from patient_visit_services where id = v_svc2) is not null then
      raise exception 'فشل: خدمة بكمّية تتجاوز حدّ الزيارة غُطّيت من الباقة';
    end if;
  end;
  raise notice '✅ ٨) لا تجاوز للرصيد ولا لحدّ الزيارة الواحدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) التجميد يوقف الخصم **ويمدّ الصلاحية**
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_exp_before timestamptz; v_exp_after timestamptz; v_svc3 uuid;
  begin
    select expires_at into v_exp_before from patient_packages where id = v_pp;
    perform app_freeze_patient_package(v_pp, 'سفر المريضة');
    if (select status from patient_packages where id = v_pp) <> 'frozen' then
      raise exception 'فشل: الاشتراك لم يُجمَّد';
    end if;

    -- لا خصم من مجمَّدة
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, performed_by)
      values (v_org, v_visit, v_item_b, 1, 400, 'performed', v_doctor)
      returning id into v_svc3;
    if (select package_usage_id from patient_visit_services where id = v_svc3) is not null then
      raise exception 'فشل: خُصم من اشتراك مجمَّد';
    end if;

    -- التجميد يُحسب بأيّامه: نُقدّم وقت التجميد عشرة أيّام
    update patient_packages set frozen_at = now() - interval '10 days' where id = v_pp;
    perform app_resume_patient_package(v_pp);
    select expires_at into v_exp_after from patient_packages where id = v_pp;
    if v_exp_after <= v_exp_before then
      raise exception 'فشل: الصلاحية لم تُمدّ بأيّام التجميد — التجميد صار عقوبة';
    end if;
    if (select frozen_days from patient_packages where id = v_pp) < 9 then
      raise exception 'فشل: أيّام التجميد لم تُحتسب';
    end if;
  end;
  raise notice '✅ ٩) التجميد يمنع الخصم، والاستئناف يمدّ الصلاحية بأيّامه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) الانتهاء يمنع الخصم
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_svc4 uuid;
  begin
    update patient_packages set expires_at = now() - interval '1 day' where id = v_pp;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, performed_by)
      values (v_org, v_visit, v_item_b, 1, 400, 'performed', v_doctor)
      returning id into v_svc4;
    if (select package_usage_id from patient_visit_services where id = v_svc4) is not null then
      raise exception 'فشل: خُصم من باقة منتهية';
    end if;
    -- والحالة الفعلية تقول «منتهية» ولو بقي السطر «سارية»
    if (select effective_status from v_patient_subscriptions
         where patient_package_id = v_pp) <> 'expired' then
      raise exception 'فشل: الباقة المنتهية تظهر سارية';
    end if;
    update patient_packages set expires_at = now() + interval '90 days' where id = v_pp;
  end;
  raise notice '✅ ١٠) الباقة المنتهية لا يُخصم منها وتظهر منتهية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) عكس الاستخدام يردّ الرصيد ولا يمحو الأثر
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_reverse_package_usage(v_usage, 'أُلغيت الخدمة بعد تنفيذها');
  select quantity_remaining into v_num from v_patient_package_balances
   where patient_package_id = v_pp and package_item_id = v_pi_a;
  if v_num <> 4 then
    raise exception 'فشل: الرصيد لم يُردّ بعد العكس (% لا ٤)', v_num;
  end if;
  if not exists (select 1 from patient_package_usages
                  where id = v_usage and is_reversed
                    and reversal_reason is not null) then
    raise exception 'فشل: الاستخدام المعكوس فُقد أثره';
  end if;
  if (select package_usage_id from patient_visit_services where id = v_svc) is not null then
    raise exception 'فشل: الخدمة ما زالت مربوطة باستخدام معكوس';
  end if;
  raise notice '✅ ١١) العكس يردّ الرصيد ويُبقي أثر الخصم والردّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) النقل: ممنوع للباقة غير القابلة، ولغير المؤهّل
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_transfer_patient_package(v_pp, v_male, 'طلب المريضة');
    raise exception 'فشل: نُقلت باقة غير قابلة للنقل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير قابلة للنقل%' then raise; end if;
  end;

  update packages set is_transferable = true where id = v_pkg;
  begin
    perform app_transfer_patient_package(v_pp, v_male, 'طلب المريضة');
    raise exception 'فشل: النقل تجاوز شرط الجنس — صار بابًا خلفيًّا للأهلية';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير مؤهّل%' then raise; end if;
  end;
  raise notice '✅ ١٢) النقل يحترم قابلية الباقة وأهلية المنقول إليه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الاسترداد بقيمة ما لم يُستخدَم — لا بالقسمة على عدد الحصص
  -- ═════════════════════════════════════════════════════════════════════════
  -- استُخدم سونار واحد فقط (الكشف عُكس): المتبقّي 4×200 + 1×400 = 1200
  -- من أصل 1600 ⇒ 1200 × (1200/1600) = 900
  declare v_svc5 uuid; v_res jsonb;
  begin
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, performed_by)
      values (v_org, v_visit, v_item_b, 1, 400, 'performed', v_doctor)
      returning id into v_svc5;
    if (select package_usage_id from patient_visit_services where id = v_svc5) is null then
      raise exception 'فشل: السونار لم يُخصم بعد إعادة السريان';
    end if;

    v_num := app_package_unused_value(v_pp);
    if v_num <> 900 then
      raise exception 'فشل: قيمة غير المستخدَم % لا ٩٠٠ — الحساب ليس بنسبة القيمة', v_num;
    end if;

    v_res := app_cancel_patient_package(v_pp, 'رغبة المريضة', true);
    if (v_res->>'refunded_amount')::numeric <> 900 then
      raise exception 'فشل: المسترَدّ % لا ٩٠٠', v_res->>'refunded_amount';
    end if;
    if (v_res->>'credit_note_id') is null then
      raise exception 'فشل: الاسترداد بلا إشعار دائن — الفاتورة المُصدَرة لا تُعدَّل';
    end if;
    if (select status from patient_packages where id = v_pp) <> 'refunded' then
      raise exception 'فشل: حالة الاشتراك بعد الاسترداد ليست refunded';
    end if;
  end;
  raise notice '✅ ١٣) الاسترداد بنسبة القيمة المتبقّية، بإشعار دائن لا بتعديل الفاتورة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الباقة غير القابلة للاسترداد لا تُسترَدّ
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_pkg2 uuid; v_pp2 uuid; v_s2 jsonb;
  begin
    insert into packages (organization_id, code, name_ar, price, validity_days,
                          is_refundable, refund_policy, is_active)
      values (v_org, 'NOREF', 'باقة غير مستردّة', 500, 90, false,
              'لا استرداد بعد الشراء', true) returning id into v_pkg2;
    insert into package_items (package_id, item_id, quantity_included)
      values (v_pkg2, v_item_a, 3);

    v_s2  := app_sell_package(v_pkg2, v_patient, v_branch);
    v_pp2 := (v_s2->>'patient_package_id')::uuid;
    begin
      perform app_cancel_patient_package(v_pp2, 'ندم', true);
      raise exception 'فشل: استُرِدّت باقة غير قابلة للاسترداد';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%غير قابلة للاسترداد%' then raise; end if;
    end;
    -- لكن الإلغاء بلا استرداد جائز
    perform app_cancel_patient_package(v_pp2, 'ندم', false);
    if (select status from patient_packages where id = v_pp2) <> 'cancelled' then
      raise exception 'فشل: الإلغاء بلا استرداد لم يُنفَّذ';
    end if;
  end;
  raise notice '✅ ١٤) سياسة الاسترداد تُطبَّق، والإلغاء بلا استرداد جائز';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) التجديد يُنشئ اشتراكًا جديدًا بفاتورته ويربطه بالسابق
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_pkg3 uuid; v_pp3 uuid; v_s3 jsonb; v_r3 jsonb;
  begin
    insert into packages (organization_id, code, name_ar, price, validity_days,
                          subscription_type, max_renewals, is_active)
      values (v_org, 'MONTH', 'اشتراك شهري', 300, 30, 'monthly', 1, true)
      returning id into v_pkg3;
    insert into package_items (package_id, item_id, quantity_included)
      values (v_pkg3, v_item_a, 2);

    v_s3 := app_sell_package(v_pkg3, v_patient, v_branch);
    v_r3 := app_renew_patient_package((v_s3->>'patient_package_id')::uuid);
    v_pp3 := (v_r3->>'patient_package_id')::uuid;

    if (v_r3->>'invoice_id') is null then
      raise exception 'فشل: التجديد بلا فاتورة';
    end if;
    if (select renewed_from_id from patient_packages where id = v_pp3)
       is distinct from (v_s3->>'patient_package_id')::uuid then
      raise exception 'فشل: التجديد غير مربوط بالاشتراك السابق';
    end if;
    if (select renewal_count from patient_packages where id = v_pp3) <> 1 then
      raise exception 'فشل: عدّاد التجديد لم يتقدّم';
    end if;
    -- حدّ التجديدات يُحترم
    begin
      perform app_renew_patient_package(v_pp3);
      raise exception 'فشل: تُجُووز حدّ التجديدات';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%حدّ التجديدات%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٥) التجديد يُنشئ اشتراكًا بفاتورته، ويحترم حدّ التجديدات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 16) رحلة المريض تعرض البيع والاستخدام
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from app_get_patient_timeline(v_patient)
                  where event_type = 'package_sold') then
    raise exception 'فشل: شراء الباقة لا يظهر في رحلة المريض';
  end if;
  if not exists (select 1 from app_get_patient_timeline(v_patient)
                  where event_type = 'package_used') then
    raise exception 'فشل: استخدام الباقة لا يظهر في رحلة المريض';
  end if;
  if not exists (select 1 from app_get_patient_timeline(v_patient)
                  where event_type = 'package_used' and status = 'reversed') then
    raise exception 'فشل: العكس لا يظهر في الرحلة — الأثر ناقص';
  end if;
  raise notice '✅ ١٦) البيع والاستخدام والعكس تظهر كلّها في رحلة المريض';

  raise notice '——— كل فحوص الباقات نجحت ———';
end $$;

rollback;
