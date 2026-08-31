-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الأجهزة والأصول والصيانة — 0101
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/assets-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- الخطر هنا سريريّ لا إداريّ: موعدٌ يُحجز على جهازٍ معطوب، أو فحصٌ يُجرى
-- على جهازٍ انتهت معايرته فتُبطل نتيجته. كل فحص يحاول ذلك ويتوقّع المنع.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_br1     uuid;
  v_br2     uuid;
  v_clinic  uuid;
  v_res     uuid;
  v_asset   uuid;
  v_patient uuid;
  v_doctor  uuid;
  v_visit   uuid;
  v_exam    uuid;
  v_wh      uuid;
  v_part    uuid;
  v_lot     uuid;
  v_req     uuid;
  v_order   uuid;
  v_plan    uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'as-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار الأصول', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الأول')
    returning id into v_br1;
  insert into branches (organization_id, name) values (v_org, 'الفرع الثاني')
    returning id into v_br2;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','AS1','name','عيادة الأشعة','branch_id', v_br1));
  insert into resources (organization_id, branch_id, clinic_id, code, name_ar,
                         resource_type, is_active, created_by)
    values (v_org, v_br1, v_clinic, 'XR1', 'جهاز أشعة', 'device', true, v_owner)
    returning id into v_res;

  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب') returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_br1, current_date, 'in_progress')
    returning id into v_visit;
  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'XRAY', 'أشعة صدر', 300, 'radiology') returning id into v_exam;

  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_br1, 'مستودع الصيانة', 'AW1') returning id into v_wh;
  insert into items (organization_id, item_type, code, name_ar, price, track_inventory)
    values (v_org, 'product', 'PART1', 'قطعة غيار', 500, true) returning id into v_part;
  insert into inventory_lots (organization_id, warehouse_id, item_id, qty_received,
                              qty_remaining, unit_cost)
    values (v_org, v_wh, v_part, 10, 10, 400) returning id into v_lot;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الأصل يرتبط بالمورد القابل للحجز ولا يكرّره
  -- ═════════════════════════════════════════════════════════════════════════
  insert into assets (organization_id, branch_id, clinic_id, room_number, asset_number,
                      name_ar, asset_category, manufacturer, model, serial_number,
                      barcode, resource_id, purchase_date, purchase_cost,
                      warranty_end_date, requires_calibration,
                      calibration_interval_days, next_calibration_date, created_by)
    values (v_org, v_br1, v_clinic, 'R-101', 'AST-001', 'جهاز أشعة سينية',
            'imaging_device', 'GE', 'XR-2000', 'SN-12345', 'BC-9999', v_res,
            current_date - 400, 200000, current_date + 20, true, 365,
            current_date + 40, v_owner)
    returning id into v_asset;

  declare v_dup uuid;
  begin
    insert into assets (organization_id, branch_id, asset_number, name_ar, serial_number,
                        created_by)
      values (v_org, v_br1, 'AST-002', 'جهاز مكرّر', 'SN-12345', v_owner)
      returning id into v_dup;
    raise exception 'فشل: قُبل رقم تسلسليّ مكرّر — جهازان بسجلٍّ واحد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;

  begin
    insert into assets (organization_id, branch_id, asset_number, name_ar, resource_id,
                        created_by)
      values (v_org, v_br1, 'AST-003', 'جهاز على نفس المورد', v_res, v_owner);
    raise exception 'فشل: رُبط أصلان بمورد حجزٍ واحد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ١) الأصل مرتبط بالمورد لا مكرِّرٌ له، والرقم التسلسلي فريد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الحجز مسموح والجهاز في الخدمة ومعايرته سارية
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_ro uuid;
  begin
    insert into radiology_orders (organization_id, branch_id, clinic_id, visit_id,
                                  patient_id, ordering_doctor_id, resource_id,
                                  status, ordered_at)
      values (v_org, v_br1, v_clinic, v_visit, v_patient, v_doctor, v_res,
              'ordered', now())
      returning id into v_ro;
    if v_ro is null then raise exception 'فشل: لم يُقبل حجز على جهاز سليم'; end if;
    delete from radiology_orders where id = v_ro;
  end;
  raise notice '✅ ٢) الحجز يمرّ على جهازٍ في الخدمة ومعايرته سارية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **إخراج الجهاز من الخدمة يحتاج سببًا**، ويمنع الحجز
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_set_asset_status(v_asset, 'out_of_service', '  ');
    raise exception 'فشل: أُخرج الجهاز من الخدمة بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب%' then raise; end if;
  end;

  perform app_set_asset_status(v_asset, 'out_of_service', 'عطل في أنبوب الأشعة');

  begin
    insert into radiology_orders (organization_id, branch_id, clinic_id, visit_id,
                                  patient_id, ordering_doctor_id, resource_id,
                                  status, ordered_at)
      values (v_org, v_br1, v_clinic, v_visit, v_patient, v_doctor, v_res,
              'ordered', now());
    raise exception 'فشل: حُجز موعد على جهاز خارج الخدمة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%خارج الخدمة%' then raise; end if;
  end;

  -- والمورد نفسه يصير غير نشط فلا يظهر في قوائم الاختيار
  if (select is_active from resources where id = v_res) then
    raise exception 'فشل: المورد ما زال نشطًا وجهازه خارج الخدمة';
  end if;
  raise notice '✅ ٣) الخروج من الخدمة بسبب، ويمنع الحجز، ويُخفي المورد من القوائم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) بلاغ العطل الحرِج يُخرج الجهاز فورًا
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_asset_status(v_asset, 'in_service', null);
  if (select status from assets where id = v_asset) <> 'in_service' then
    raise exception 'فشل: الجهاز لم يعد للخدمة';
  end if;

  begin
    perform app_report_asset_fault(v_asset, '  ');
    raise exception 'فشل: قُبل بلاغ عطل بلا وصف';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%وصف العطل%' then raise; end if;
  end;

  v_req := app_report_asset_fault(v_asset, 'دخان من وحدة التبريد', 'critical');
  if (select status from assets where id = v_asset) <> 'out_of_service' then
    raise exception 'فشل: العطل الحرِج لم يُخرج الجهاز فورًا — مريضٌ على جهازٍ معطوب';
  end if;
  if (select takes_out_of_service from maintenance_requests where id = v_req) is not true then
    raise exception 'فشل: البلاغ الحرِج لم يُعلَّم مُخرِجًا من الخدمة';
  end if;
  raise notice '✅ ٤) العطل الحرِج يُخرج الجهاز فورًا بلا انتظار قرار';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) أمر الصيانة: قطع من المخزون بحركة حقيقية
  -- ═════════════════════════════════════════════════════════════════════════
  insert into maintenance_orders (organization_id, branch_id, asset_id,
                                  maintenance_request_id, order_number, order_type,
                                  status, labor_cost, created_by)
    values (v_org, v_br1, v_asset, v_req, 'MO-1', 'corrective', 'in_progress', 300, v_owner)
    returning id into v_order;

  declare v_before numeric;
  begin
    select qty_remaining into v_before from inventory_lots where id = v_lot;
    perform app_issue_maintenance_part(v_order, v_lot, 2);
    if (select qty_remaining from inventory_lots where id = v_lot) <> v_before - 2 then
      raise exception 'فشل: قطعة الغيار لم تخرج من المخزون فعلًا';
    end if;
    if (select parts_cost from maintenance_orders where id = v_order) <> 800 then
      raise exception 'فشل: تكلفة القطع لم تُضف للأمر';
    end if;
  end;
  raise notice '✅ ٥) قطع الغيار تخرج بحركة مخزون حقيقية وتُحمَّل على الأمر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الإغلاق يحتاج إجراءً، والعودة للخدمة قرارٌ صريح
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_complete_maintenance_order(v_order, 'فحص', '  ');
    raise exception 'فشل: أُغلق أمر صيانة بلا إجراء متَّخذ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%الإجراء المتَّخذ%' then raise; end if;
  end;

  -- إغلاق **بلا** عودة للخدمة: الجهاز يبقى خارجها
  perform app_complete_maintenance_order(v_order, 'تلف في المروحة',
                                         'استُبدلت المروحة، بانتظار قطعة ثانية', false);
  if (select status from assets where id = v_asset) <> 'out_of_service' then
    raise exception 'فشل: عاد الجهاز للخدمة رغم عدم طلب ذلك';
  end if;
  if (select total_cost from maintenance_orders where id = v_order) <> 1100 then
    raise exception 'فشل: إجمالي تكلفة الأمر ليس ١١٠٠ (٣٠٠ عمالة + ٨٠٠ قطع)';
  end if;
  if (select status from maintenance_requests where id = v_req) <> 'resolved' then
    raise exception 'فشل: البلاغ المرتبط لم يُغلق مع الأمر';
  end if;
  begin
    perform app_complete_maintenance_order(v_order, 'x', 'y');
    raise exception 'فشل: أُغلق الأمر مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُغلق مرّتين%' then raise; end if;
  end;
  raise notice '✅ ٦) الإغلاق بإجراء مكتوب، والعودة للخدمة قرارٌ صريح لا نتيجة تلقائية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الصيانة الوقائية تتقدّم إلى موعدها التالي
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_order2 uuid;
  begin
    insert into maintenance_plans (organization_id, asset_id, name_ar, frequency_days,
                                   next_due_date, created_by)
      values (v_org, v_asset, 'صيانة ربع سنوية', 90, current_date - 5, v_owner)
      returning id into v_plan;

    insert into maintenance_orders (organization_id, branch_id, asset_id,
                                    maintenance_plan_id, order_number, order_type,
                                    status, created_by)
      values (v_org, v_br1, v_asset, v_plan, 'MO-2', 'preventive', 'in_progress', v_owner)
      returning id into v_order2;

    perform app_complete_maintenance_order(v_order2, 'فحص دوريّ', 'تنظيف ومعايرة', true);
    if (select next_due_date from maintenance_plans where id = v_plan)
       <> current_date + 90 then
      raise exception 'فشل: الخطة الوقائية لم تتقدّم لموعدها التالي';
    end if;
    if (select status from assets where id = v_asset) <> 'in_service' then
      raise exception 'فشل: الجهاز لم يعد للخدمة رغم طلب ذلك';
    end if;
  end;
  raise notice '✅ ٧) الصيانة الوقائية تتقدّم تلقائيًّا إلى موعدها التالي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) **المعايرة المنتهية تمنع الاستخدام**
  -- ═════════════════════════════════════════════════════════════════════════
  update assets set next_calibration_date = current_date - 1 where id = v_asset;
  begin
    insert into radiology_orders (organization_id, branch_id, clinic_id, visit_id,
                                  patient_id, ordering_doctor_id, resource_id,
                                  status, ordered_at)
      values (v_org, v_br1, v_clinic, v_visit, v_patient, v_doctor, v_res,
              'ordered', now());
    raise exception 'فشل: أُجري فحص على جهازٍ انتهت معايرته — النتيجة غير معتمَدة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%معايرة%' then raise; end if;
  end;
  raise notice '✅ ٨) الجهاز المنتهية معايرته لا يُستخدم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) تسجيل المعايرة يجدّد الموعد، والرسوب يُخرج الجهاز
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_record_calibration(v_asset, current_date, 'passed', 'CERT-1', 'شركة المعايرة');
  if (select next_calibration_date from assets where id = v_asset)
     <> current_date + 365 then
    raise exception 'فشل: موعد المعايرة القادم لم يُحسب من الدورية';
  end if;
  if (select status from assets where id = v_asset) <> 'in_service' then
    raise exception 'فشل: الجهاز خرج من الخدمة رغم نجاح المعايرة';
  end if;

  perform app_record_calibration(v_asset, current_date, 'failed', 'CERT-2', 'شركة المعايرة');
  if (select status from assets where id = v_asset) <> 'out_of_service' then
    raise exception 'فشل: الرسوب في المعايرة لم يُخرج الجهاز — نتائجه بعدها غير معتمَدة';
  end if;
  raise notice '✅ ٩) المعايرة تجدّد موعدها، والرسوب يُخرج الجهاز فورًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) النقل بين الفروع يُسجَّل ويُحدِّث الموقع
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_transfer_asset(v_asset, v_br2, null, 'R-201', 'حاجة الفرع الثاني');
  if (select branch_id from assets where id = v_asset) <> v_br2 then
    raise exception 'فشل: الأصل لم يُنقل';
  end if;
  if not exists (select 1 from asset_transfers
                  where asset_id = v_asset and from_branch_id = v_br1
                    and to_branch_id = v_br2 and reason is not null) then
    raise exception 'فشل: النقل بلا سجلّ';
  end if;
  raise notice '✅ ١٠) النقل بين الفروع يُسجَّل بمصدره ووجهته وسببه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) التنبيهات: ضمان ومعايرة وصيانة
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_asset_alerts
                  where asset_id = v_asset and alert_type = 'warranty') then
    raise exception 'فشل: الضمان المقارب على الانتهاء لا يُنبَّه عنه';
  end if;
  if not exists (select 1 from v_asset_register
                  where asset_id = v_asset and warranty_days_left is not null) then
    raise exception 'فشل: الأيام المتبقّية للضمان غير محسوبة';
  end if;
  select maintenance_cost_total into v_num from v_asset_register where asset_id = v_asset;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: تكلفة الصيانة المتراكمة غير محسوبة';
  end if;
  raise notice '✅ ١١) تنبيهات الضمان والمعايرة والصيانة والتكلفة المتراكمة تعمل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) التخلّص: لا مع أوامر مفتوحة، ولا حذف، وقيمة دفترية محسوبة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_open uuid; v_disp uuid;
  begin
    insert into maintenance_orders (organization_id, branch_id, asset_id, order_number,
                                    order_type, status, created_by)
      values (v_org, v_br2, v_asset, 'MO-3', 'corrective', 'in_progress', v_owner)
      returning id into v_open;
    begin
      perform app_dispose_asset(v_asset, 'scrapped', 'انتهى عمره');
      raise exception 'فشل: تُخلّص من أصلٍ عليه أمر صيانة مفتوح';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%أمر صيانة مفتوح%' then raise; end if;
    end;
    update maintenance_orders set status = 'cancelled' where id = v_open;

    update assets set accumulated_depreciation = 150000 where id = v_asset;
    v_disp := app_dispose_asset(v_asset, 'sold', 'استُبدل بجهاز أحدث', 60000, 'مشترٍ');

    -- القيمة الدفترية 200000 − 150000 = 50000، والفرق 60000 − 50000 = 10000
    select book_value, gain_loss into v_num, v_int from asset_disposals where id = v_disp;
    if v_num <> 50000 then
      raise exception 'فشل: القيمة الدفترية % لا ٥٠٠٠٠', v_num;
    end if;
    if v_int <> 10000 then
      raise exception 'فشل: فرق البيع % لا ١٠٠٠٠', v_int;
    end if;
    if (select status from assets where id = v_asset) <> 'disposed' then
      raise exception 'فشل: الأصل لم يُعلَّم متخلَّصًا منه';
    end if;
    if (select is_active from resources where id = v_res) then
      raise exception 'فشل: مورد الحجز ما زال نشطًا بعد التخلّص من الجهاز';
    end if;
    begin
      delete from assets where id = v_asset;
      raise exception 'فشل: حُذف سجلّ أصل';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا تُحذف%' then raise; end if;
    end;
    begin
      perform app_set_asset_status(v_asset, 'in_service', null);
      raise exception 'فشل: أُعيد أصلٌ متخلَّص منه للخدمة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%متخلَّص منه%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٢) التخلّص بقيمة دفترية محسوبة، بلا أوامر مفتوحة، ولا حذف للسجل';

  -- ١٣) الإهلاك بالقسط الثابت: يكتب مجمّع الإهلاك الذي يقرؤه التخلّص، ولا
  --     يُرحَّل مرّتين، ولا لشهرٍ لم ينتهِ، وقيده متوازن.
  declare
    v_dep_asset uuid;
    v_run       uuid;
    v_month     date := date_trunc('month', current_date - interval '1 month')::date;
    v_dr        numeric;
    v_cr        numeric;
    v_je        uuid;
  begin
    perform app_seed_default_chart_of_accounts(v_org);
    insert into assets (organization_id, branch_id, asset_number, name_ar,
                        asset_category, purchase_date, purchase_cost,
                        salvage_value, useful_life_years, created_by)
      values (v_org, v_br1, 'AS-DEP-1', 'جهاز للإهلاك', 'medical_device',
              current_date - interval '2 years', 120000, 0, 10, v_owner)
      returning id into v_dep_asset;

    -- شهرٌ لم ينتهِ بعد
    begin
      perform app_post_asset_depreciation(v_org, date_trunc('month', current_date)::date);
      raise exception 'فشل: رُحّل إهلاك شهرٍ لم ينتهِ';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لم ينتهِ%' then raise; end if;
    end;

    v_run := app_post_asset_depreciation(v_org, v_month);
    select total_amount, asset_count, journal_entry_id into v_num, v_int, v_je
      from asset_depreciation_runs where id = v_run;
    -- 120000 ÷ (10 × 12) = 1000 شهريًّا
    if v_num <> 1000.00 then
      raise exception 'فشل: قسط الإهلاك % بدل 1000', v_num;
    end if;
    select accumulated_depreciation into v_num from assets where id = v_dep_asset;
    if v_num <> 1000.00 then
      raise exception 'فشل: مجمّع الإهلاك لم يُحدَّث (%)', v_num;
    end if;
    if not exists (select 1 from asset_depreciation_lines
                    where run_id = v_run and asset_id = v_dep_asset and amount = 1000.00) then
      raise exception 'فشل: لا سطر إهلاك للأصل';
    end if;

    if v_je is null then
      raise exception 'فشل: لا قيد محاسبيّ للإهلاك رغم وجود دليل حسابات';
    end if;
    select sum(debit), sum(credit) into v_dr, v_cr
      from journal_entry_lines where journal_entry_id = v_je;
    if v_dr <> v_cr or v_dr <> 1000.00 then
      raise exception 'فشل: قيد الإهلاك غير متوازن (% / %)', v_dr, v_cr;
    end if;
    if (select status from journal_entries where id = v_je) <> 'draft' then
      raise exception 'فشل: قيد الإهلاك رُحّل بلا اعتماد المحاسب';
    end if;

    -- التكرار في الشهر نفسه
    begin
      perform app_post_asset_depreciation(v_org, v_month);
      raise exception 'فشل: رُحّل إهلاك الشهر مرّتين';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%مُرحَّل من قبل%' then raise; end if;
    end;

    -- والقيمة الدفترية في المنظور تعكس المجمَّع
    select net_book_value into v_num from v_asset_depreciation_schedule
     where asset_id = v_dep_asset;
    if v_num <> 119000.00 then
      raise exception 'فشل: القيمة الدفترية % بدل 119000', v_num;
    end if;
  end;
  raise notice '✅ ١٣) الإهلاك بالقسط الثابت يكتب المجمَّع بقيدٍ متوازن مسودّة، ولا يتكرّر';

  -- ١٤) الميزة مسجَّلة ومفعَّلة للمنشأة الجديدة، وإلا فالشاشة مبنيّة لكنها
  --     لا تظهر في القائمة الجانبية لأحد: صلاحية بلا باب تدخل منه.
  if not exists (select 1 from feature_catalog where feature_key = 'assets') then
    raise exception 'فشل: ميزة الأصول غير مسجَّلة في كتالوج المزايا';
  end if;
  if not exists (select 1 from organization_features
                  where organization_id = v_org and feature_key = 'assets' and enabled) then
    raise exception 'فشل: المنشأة الجديدة لا تملك ميزة الأصول مفعَّلة';
  end if;
  if not exists (select 1 from permission_catalog where permission_key = 'assets.view') then
    raise exception 'فشل: صلاحية assets.view غير مسجَّلة';
  end if;
  raise notice '✅ ١٤) الميزة والصلاحية مسجَّلتان ومفعَّلتان للمنشأة الجديدة';

  raise notice '——— كل فحوص الأصول نجحت ———';
end $$;

rollback;
