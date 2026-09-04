-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الصيدلية والمخزون — 0088
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/pharmacy-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- كل فحص هنا يقابل خللًا كان قائمًا فعلًا قبل 0088، لا فرضية: الرصيد السالب،
-- والدواء المنتهي، وغياب FEFO، وغياب الحجز، والإلغاء الذي لا يُرجع، والصرف
-- المجّاني، والصلاحية المفتوحة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid;
  v_owner    uuid;
  v_pharm    uuid;
  v_recep    uuid;
  v_branch   uuid;
  v_wh       uuid;
  v_wh_off   uuid;
  v_patient  uuid;
  v_doctor   uuid;
  v_drug     uuid;
  v_ctrl     uuid;
  v_lot_near uuid;
  v_lot_far  uuid;
  v_lot_exp  uuid;
  v_lot_ctrl uuid;
  v_pr       uuid;
  v_pi       uuid;
  v_pi_ctrl  uuid;
  v_rec      uuid;
  v_num      numeric;
  v_txt      text;
  v_json     jsonb;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph-pharmacist@test.local')
    returning id into v_pharm;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الصيدلية', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_pharm, 'pharmacist', true), (v_org, v_recep, 'receptionist', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into warehouses (organization_id, branch_id, code, name)
    values (v_org, v_branch, 'WH1', 'مستودع الصيدلية') returning id into v_wh;
  insert into warehouses (organization_id, branch_id, code, name, is_disabled)
    values (v_org, v_branch, 'WH2', 'مستودع معطَّل', true) returning id into v_wh_off;

  insert into patients (organization_id, name_ar) values (v_org, 'مريض الصيدلية')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب الصيدلية')
    returning id into v_doctor;

  -- ── دواء عادي ودواء خاضع للرقابة، عبر الدالة لا بإدراج يدوي
  v_drug := app_save_drug(v_org, null, jsonb_build_object(
    'code','DRG-1','name_ar','باراسيتامول ٥٠٠','generic_name','Paracetamol',
    'dosage_form','tablet','price', 10, 'reorder_level', 50));
  v_ctrl := app_save_drug(v_org, null, jsonb_build_object(
    'code','DRG-2','name_ar','مورفين','controlled_drug_class','narcotic','price', 40));

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) التصنيف الرقابي يرفع علَم المخدّر تلقائيًا
  -- ═════════════════════════════════════════════════════════════════════════
  if not (select is_controlled_substance from drug_details where item_id = v_ctrl) then
    raise exception 'فشل: دواء مصنَّف رقابيًا ولم يُعلَّم مخدّرًا';
  end if;
  raise notice '✅ التصنيف الرقابي يرفع علَم المخدّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الحفظ الجزئي لا يمحو ما لم يُرسَل
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_save_drug(v_org, v_drug, jsonb_build_object('name_ar','باراسيتامول ٥٠٠ مج'));
  select generic_name into v_txt from drug_details where item_id = v_drug;
  if v_txt is distinct from 'Paracetamol' then
    raise exception 'فشل: التحديث الجزئي محا الاسم العلمي (%)', v_txt;
  end if;
  if (select reorder_level from items where id = v_drug) <> 50 then
    raise exception 'فشل: التحديث الجزئي محا حدّ إعادة الطلب';
  end if;
  if not (select track_inventory and track_expiry from items where id = v_drug) then
    raise exception 'فشل: الدواء غير متتبَّع مخزونًا وصلاحية';
  end if;
  raise notice '✅ الحفظ الجزئي للدواء لا يمحو الحقول غير المرسَلة';

  -- ── دفعات: قريبة الانتهاء، بعيدة، ومنتهية
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              qty_remaining, qty_received, unit_cost, selling_price, expiry_date)
    values (v_org, v_wh, v_drug, 'L-NEAR', 10, 10, 4, 12, current_date + 30)
    returning id into v_lot_near;
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              qty_remaining, qty_received, unit_cost, selling_price, expiry_date)
    values (v_org, v_wh, v_drug, 'L-FAR', 100, 100, 4, 12, current_date + 400)
    returning id into v_lot_far;
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              qty_remaining, qty_received, unit_cost, expiry_date)
    values (v_org, v_wh, v_drug, 'L-EXP', 50, 50, 4, current_date - 1)
    returning id into v_lot_exp;
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              qty_remaining, qty_received, unit_cost, selling_price)
    values (v_org, v_wh, v_ctrl, 'L-CTRL', 20, 20, 30, 60)
    returning id into v_lot_ctrl;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2.5) الدفعة ترث مورّدها وسعر بيعها من فاتورة الشراء
  --
  -- الرابط والحقل موجودان منذ 0003 وكانا معطَّلين: كل دفعة تُسعَّر بسعر الصنف
  -- العام مهما اختلف مورّدها.
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_dist uuid; v_pinv uuid; v_pline uuid; v_lot_p uuid;
  begin
    insert into distributors (organization_id, name_ar) values (v_org, 'مورّد الاختبار')
      returning id into v_dist;
    insert into purchase_invoices (organization_id, warehouse_id, distributor_id, invoice_number, invoice_date)
      values (v_org, v_wh, v_dist, 'PI-1', current_date) returning id into v_pinv;
    insert into purchase_invoice_items (purchase_invoice_id, item_id, purchase_price, sale_price, qty)
      values (v_pinv, v_drug, 5, 17, 20) returning id into v_pline;

    insert into inventory_lots (organization_id, warehouse_id, item_id, purchase_invoice_item_id,
                                lot_number, qty_remaining, qty_received, unit_cost)
      values (v_org, v_wh, v_drug, v_pline, 'L-PUR', 20, 20, 5) returning id into v_lot_p;

    if (select distributor_id from inventory_lots where id = v_lot_p) is distinct from v_dist then
      raise exception 'فشل: الدفعة لم ترث مورّدها من فاتورة الشراء';
    end if;
    if (select selling_price from inventory_lots where id = v_lot_p) <> 17 then
      raise exception 'فشل: الدفعة لم ترث سعر بيعها من سطر الشراء';
    end if;
    -- ولا تدخل الفحوص التالية: تُخرَج من الحساب بتصفير رصيدها
    update inventory_lots set status = 'quarantined' where id = v_lot_p;
  end;
  raise notice '✅ الدفعة ترث مورّدها وسعر بيعها من فاتورة الشراء';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) المخزون لا يصير سالبًا
  --
  -- قبل 0088 كان هذا الإدراج يمرّ ويترك −40 في القاعدة.
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty)
      values (v_org, v_wh, v_drug, v_lot_near, 'consumption_out', 50);
    raise exception 'فشل: خرجت كمية أكبر من رصيد الدفعة — رصيد سالب';
  exception when others then
    if sqlerrm not like '%الرصيد لا يكفي%' then raise; end if;
    raise notice '✅ الخروج فوق الرصيد مرفوض — لا رصيد سالب';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الدفعة المنتهية لا تخرج
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty)
      values (v_org, v_wh, v_drug, v_lot_exp, 'consumption_out', 1);
    raise exception 'فشل: صُرف دواء منتهي الصلاحية';
  exception when others then
    if sqlerrm not like '%منتهية الصلاحية%' then raise; end if;
    raise notice '✅ الدفعة المنتهية لا تُصرَف';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الحركة تُقيَّد على مستودع الدفعة نفسه
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty)
      values (v_org, v_wh_off, v_drug, v_lot_far, 'consumption_out', 1);
    raise exception 'فشل: قُيّدت الحركة على مستودع لم تخرج منه الدفعة';
  exception when others then
    if sqlerrm not like '%مستودع آخر%' then raise; end if;
    raise notice '✅ الحركة تُقيَّد على مستودع الدفعة نفسه';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) المنظور لا يعرض المنتهية
  -- ═════════════════════════════════════════════════════════════════════════
  if exists (select 1 from v_available_drug_lots where lot_id = v_lot_exp) then
    raise exception 'فشل: دفعة منتهية معروضة كمتاحة للصرف';
  end if;
  raise notice '✅ منظور الدفعات المتاحة يستبعد المنتهية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) FEFO: التوزيع يبدأ بالأقرب انتهاءً
  -- ═════════════════════════════════════════════════════════════════════════
  select lot_id into v_txt from app_fefo_lots(v_org, v_wh, v_drug, 5) limit 1;
  if v_txt::uuid <> v_lot_near then
    raise exception 'فشل: FEFO لم يبدأ بالدفعة الأقرب انتهاءً';
  end if;

  -- طلب ١٥ يستهلك ١٠ من القريبة و٥ من البعيدة، ولا يلمس المنتهية
  select count(*), sum(take) into v_num, v_num from app_fefo_lots(v_org, v_wh, v_drug, 15);
  select sum(take) into v_num from app_fefo_lots(v_org, v_wh, v_drug, 15);
  if v_num <> 15 then
    raise exception 'فشل: التوزيع لم يغطِّ الكمية (%)', v_num;
  end if;
  if exists (select 1 from app_fefo_lots(v_org, v_wh, v_drug, 15) where lot_id = v_lot_exp) then
    raise exception 'فشل: FEFO أدخل دفعة منتهية في التوزيع';
  end if;
  raise notice '✅ FEFO يبدأ بالأقرب انتهاءً ويتجاوز المنتهية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الكمية المطلوبة فوق المتاح تُرفض بصراحة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform * from app_fefo_lots(v_org, v_wh, v_drug, 1000);
    raise exception 'فشل: وُزّعت كمية أكبر من كل المتاح';
  exception when others then
    if sqlerrm not like '%لا يكفي%' then raise; end if;
    raise notice '✅ الكمية فوق المتاح تُرفض برسالة تذكر النقص';
  end;

  -- ── وصفة
  insert into prescriptions (organization_id, patient_id, doctor_id, branch_id, status, created_by)
    values (v_org, v_patient, v_doctor, v_branch, 'issued', v_owner) returning id into v_pr;
  insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
    values (v_pr, v_drug, 12) returning id into v_pi;
  insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
    values (v_pr, v_ctrl, 2) returning id into v_pi_ctrl;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) `organization_id` يُملأ تلقائيًا لسطور الوصفة
  -- ═════════════════════════════════════════════════════════════════════════
  if (select organization_id from prescription_items where id = v_pi) <> v_org then
    raise exception 'فشل: سطر الوصفة بلا منشأة';
  end if;
  raise notice '✅ سطر الوصفة يرث منشأته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) الحجز ينقص المتاح ولا ينقص الرصيد
  -- ═════════════════════════════════════════════════════════════════════════
  v_json := app_reserve_prescription(v_pr, v_wh);

  if (select qty_remaining from inventory_lots where id = v_lot_near) <> 10 then
    raise exception 'فشل: الحجز أنقص الرصيد الفعلي — الحجز ليس صرفًا';
  end if;
  if (select reserved_quantity from inventory_lots where id = v_lot_near) <> 10 then
    raise exception 'فشل: الحجز لم يُسجَّل على الدفعة القريبة';
  end if;
  select qty_available into v_num from v_available_drug_lots where lot_id = v_lot_near;
  if v_num is not null then
    raise exception 'فشل: دفعة محجوزة بالكامل ما زالت تظهر متاحة';
  end if;
  if (select status from prescriptions where id = v_pr) <> 'sent_to_pharmacy' then
    raise exception 'فشل: الوصفة لم تنتقل إلى طابور الصيدلية';
  end if;
  raise notice '✅ الحجز ينقص المتاح ويترك الرصيد ويُدخل الوصفة الطابور';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) وصفة ثانية لا ترى المحجوز
  -- ═════════════════════════════════════════════════════════════════════════
  select sum(take) into v_num from app_fefo_lots(v_org, v_wh, v_drug, 88);
  -- المتاح كله = ١١٠ − (١٠+٢ محجوزة) = ٩٨، فطلب ٨٨ يمرّ، وأوّل دفعة فيه
  -- ليست القريبة لأنها محجوزة بالكامل.
  if exists (select 1 from app_fefo_lots(v_org, v_wh, v_drug, 88) where lot_id = v_lot_near) then
    raise exception 'فشل: التوزيع استعمل دفعة محجوزة بالكامل';
  end if;
  raise notice '✅ التوزيع يتجاوز المحجوز — لا تُحجز الكمية نفسها مرّتين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) الصرف فوق الموصوف مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_dispense_prescription(v_pr, v_wh,
      jsonb_build_array(jsonb_build_object('prescription_item_id', v_pi, 'qty', 99)));
    raise exception 'فشل: صُرفت كمية أكبر من الموصوف';
  exception when others then
    if sqlerrm not like '%تتجاوز المتبقّي من الوصفة%' then raise; end if;
    raise notice '✅ الصرف فوق الموصوف مرفوض';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) المستودع المعطَّل مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_dispense_prescription(v_pr, v_wh_off,
      jsonb_build_array(jsonb_build_object('prescription_item_id', v_pi, 'qty', 1)));
    raise exception 'فشل: صُرف من مستودع معطَّل';
  exception when others then
    if sqlerrm not like '%معطَّل%' then raise; end if;
    raise notice '✅ المستودع المعطَّل لا يُصرَف منه';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الصرف الجزئي: FEFO، وسعر حقيقي، وحالة الوصفة
  -- ═════════════════════════════════════════════════════════════════════════
  v_rec := app_dispense_prescription(v_pr, v_wh,
    jsonb_build_array(jsonb_build_object('prescription_item_id', v_pi, 'qty', 12)));

  -- ١٢ = ١٠ من القريبة + ٢ من البعيدة
  select count(*) into v_num from dispensing_items where dispensing_record_id = v_rec;
  if v_num <> 2 then
    raise exception 'فشل: الصرف لم يُقسَّم على دفعتين (%)', v_num;
  end if;
  if (select qty_remaining from inventory_lots where id = v_lot_near) <> 0 then
    raise exception 'فشل: الدفعة القريبة لم تُستهلك أوّلًا';
  end if;
  if (select qty_remaining from inventory_lots where id = v_lot_far) <> 98 then
    raise exception 'فشل: رصيد الدفعة البعيدة خاطئ';
  end if;

  select min(unit_price) into v_num from dispensing_items where dispensing_record_id = v_rec;
  if v_num <> 12 then
    raise exception 'فشل: سعر الصرف % وليس سعر البيع المسجَّل على الدفعة', v_num;
  end if;

  if (select dispensed_quantity from prescription_items where id = v_pi) <> 12 then
    raise exception 'فشل: المصروف لم يُسجَّل على سطر الوصفة';
  end if;
  if (select status from prescriptions where id = v_pr) <> 'partially_dispensed' then
    raise exception 'فشل: الوصفة لم تُعلَّم صرفًا جزئيًا (%)',
      (select status from prescriptions where id = v_pr);
  end if;
  raise notice '✅ الصرف يوزّع FEFO ويسعّر من الدفعة ويحدّث حالة الوصفة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) الحجز المستهلَك لا يبقى حاجزًا
  -- ═════════════════════════════════════════════════════════════════════════
  if exists (select 1 from inventory_reservations
              where prescription_item_id = v_pi and status = 'active') then
    raise exception 'فشل: بقي حجز نشط بعد الصرف — كمية محجوزة إلى الأبد';
  end if;
  if (select reserved_quantity from inventory_lots where id = v_lot_near) <> 0 then
    raise exception 'فشل: المحجوز لم يُفكّ عن الدفعة بعد الصرف';
  end if;
  raise notice '✅ الصرف يستهلك الحجز ويفكّه عن الدفعة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 16) سطر الصرف لا يُعدَّل
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update dispensing_items set quantity_dispensed = 1 where dispensing_record_id = v_rec;
    raise exception 'فشل: عُدِّل سطر صرف بعد تنفيذه';
  exception when others then
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
    raise notice '✅ سطر الصرف لا يُعدَّل بعد تنفيذه';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 17) حركة المخزون لا تُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from inventory_movements where lot_id = v_lot_far;
    raise exception 'فشل: حُذفت حركة مخزون';
  exception when others then
    if sqlerrm not like '%لا تُحذف%' then raise; end if;
    raise notice '✅ حركات المخزون لا تُحذف';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 18) الإلغاء يُرجع المخزون بحركة عكسية وينقص المصروف
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_cancel_dispensing(v_rec, 'صُرف للمريض الخطأ');

  if (select qty_remaining from inventory_lots where id = v_lot_near) <> 10 then
    raise exception 'فشل: الإلغاء لم يُرجع رصيد الدفعة القريبة (%)',
      (select qty_remaining from inventory_lots where id = v_lot_near);
  end if;
  if (select qty_remaining from inventory_lots where id = v_lot_far) <> 100 then
    raise exception 'فشل: الإلغاء لم يُرجع رصيد الدفعة البعيدة';
  end if;
  if (select dispensed_quantity from prescription_items where id = v_pi) <> 0 then
    raise exception 'فشل: المصروف بقي على سطر الوصفة بعد الإلغاء';
  end if;
  if not exists (select 1 from inventory_movements
                  where lot_id = v_lot_near and movement_type = 'return_in') then
    raise exception 'فشل: الإرجاع لم يُسجَّل كحركة — أثرٌ ممحوّ';
  end if;
  if (select status from dispensing_records where id = v_rec) <> 'cancelled' then
    raise exception 'فشل: سجل الصرف لم يُعلَّم ملغى';
  end if;
  raise notice '✅ الإلغاء يُرجع المخزون بحركة عكسية ويُبقي الأثر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 19) الإلغاء يحتاج سببًا
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_cancel_dispensing(v_rec, '  ');
    raise exception 'فشل: أُلغي صرف بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ إلغاء الصرف يحتاج سببًا مكتوبًا';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 20) الدواء المؤرشف لا يُصرَف
  -- ═════════════════════════════════════════════════════════════════════════
  update items set is_archived = true, archived_at = now() where id = v_drug;
  begin
    perform app_dispense_prescription(v_pr, v_wh,
      jsonb_build_array(jsonb_build_object('prescription_item_id', v_pi, 'qty', 1)));
    raise exception 'فشل: صُرف دواء مؤرشف';
  exception when others then
    if sqlerrm not like '%مؤرشف أو معطَّل%' then raise; end if;
    raise notice '✅ الدواء المؤرشف لا يُصرَف';
  end;
  update items set is_archived = false, archived_at = null where id = v_drug;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 21) التسوية لا تنزل دون المحجوز، وتُسجَّل حركةً وتدقيقًا
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_release_prescription_reservations(v_pr, 'إعادة ترتيب');
  perform app_reserve_prescription(v_pr, v_wh);

  begin
    perform app_adjust_stock(v_lot_near, -10, 'جرد');
    raise exception 'فشل: أُنقص الرصيد دون الكمية المحجوزة';
  exception when others then
    if sqlerrm not like '%دون الكمية المحجوزة%' then raise; end if;
    raise notice '✅ التسوية لا تنزل دون المحجوز';
  end;

  perform app_release_prescription_reservations(v_pr, 'اختبار التسوية');
  perform app_adjust_stock(v_lot_near, -3, 'تلف في الرفّ');
  if (select qty_remaining from inventory_lots where id = v_lot_near) <> 7 then
    raise exception 'فشل: التسوية لم تسرِ';
  end if;
  if not exists (select 1 from audit_log where entity_id = v_lot_near and module = 'inventory') then
    raise exception 'فشل: التسوية لم تُسجَّل في التدقيق';
  end if;
  raise notice '✅ التسوية تسري وتُسجَّل حركةً وتدقيقًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 22) الحركة المباشرة لا تأكل المحجوز
  --
  -- شاشة المخزون تكتب حركات صرف ومناقلة بإدراج مباشر، لا عبر دوال الصيدلية.
  -- لو اكتفى المنع بدالّة التسوية لبقي الباب مفتوحًا من هناك.
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_reserve_prescription(v_pr, v_wh);
  begin
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty)
      values (v_org, v_wh, v_drug, v_lot_near, 'transfer_out',
              (select qty_remaining from inventory_lots where id = v_lot_near));
    raise exception 'فشل: حركة مباشرة أكلت كمية محجوزة لوصفة';
  exception when others then
    if sqlerrm not like '%محجوز%' then raise; end if;
    raise notice '✅ الحركة المباشرة لا تأكل المحجوز';
  end;
  perform app_release_prescription_reservations(v_pr, 'نهاية الفحص');

  -- ═════════════════════════════════════════════════════════════════════════
  -- 23) تنبيهات المخزون
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_stock_alerts
                  where lot_id = v_lot_exp and alert_type = 'expired') then
    raise exception 'فشل: دفعة منتهية بها رصيد لا تظهر في التنبيهات';
  end if;
  if not exists (select 1 from v_stock_alerts
                  where lot_id = v_lot_near and alert_type = 'expiring_soon') then
    raise exception 'فشل: دفعة تنتهي خلال ٩٠ يومًا لا تظهر في التنبيهات';
  end if;
  raise notice '✅ تنبيهات المخزون تكشف المنتهي والقريب انتهاؤه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 24) طابور الصيدلية يكشف الرقابيّ
  -- ═════════════════════════════════════════════════════════════════════════
  if not (select has_controlled from v_pharmacy_queue where prescription_id = v_pr) then
    raise exception 'فشل: وصفة فيها مخدّر ولا يظهر ذلك في الطابور';
  end if;
  raise notice '✅ طابور الصيدلية يكشف الوصفات ذات الأدوية الرقابية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 25) إلغاء الوصفة يفكّ حجوزها
  --
  -- بلا هذا يبقى دواءُ مريضٍ أُلغيت وصفته محجوزًا إلى الأبد، فينفد المتاح على
  -- غيره ولا شيء في الشاشة يفسّر لماذا.
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_reserve_prescription(v_pr, v_wh);
  if not exists (select 1 from inventory_reservations
                  where prescription_id = v_pr and status = 'active') then
    raise exception 'فشل: لم يُسجَّل حجز قبل فحص الإلغاء';
  end if;

  -- الإلغاء يحتاج سببًا
  begin
    perform app_set_prescription_status(v_pr, 'cancelled', null);
    raise exception 'فشل: أُلغيت وصفة بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;

  -- ولا يُقبل والصرف قائم: سجل الصرف الوحيد أُلغي في الفحص ١٨، فالطريق سالك
  perform app_set_prescription_status(v_pr, 'cancelled', 'المريض لم يستلم');

  if (select cancel_reason from prescriptions where id = v_pr) is null then
    raise exception 'فشل: سبب إلغاء الوصفة لم يُحفظ';
  end if;

  -- القفز من الملغاة مرفوض — الإلغاء نهائي
  begin
    update prescriptions set status = 'issued' where id = v_pr;
    raise exception 'فشل: أُعيدت وصفة ملغاة إلى الحياة';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال بالوصفة%' then raise; end if;
  end;

  if exists (select 1 from inventory_reservations
              where prescription_id = v_pr and status = 'active') then
    raise exception 'فشل: بقي حجز نشط بعد إلغاء الوصفة — كمية محبوسة إلى الأبد';
  end if;
  if (select reserved_quantity from inventory_lots where id = v_lot_near) <> 0 then
    raise exception 'فشل: المحجوز لم يُفكّ عن الدفعة بعد إلغاء الوصفة';
  end if;
  raise notice '✅ إلغاء الوصفة يحتاج سببًا، ويفكّ حجوزها، وهو نهائي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 26) شارة الصيدلية لا تسقط عند وصول العمل
  --
  -- المنظور الذي يغذّي عدّاد الشارة كان يُرشِّح الحالتين القديمتين فقط، فوصفةٌ
  -- أُرسلت إلى الصيدلية كانت تختفي من العدّاد لحظة إرسالها.
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_pr2 uuid;
  begin
    insert into prescriptions (organization_id, patient_id, doctor_id, status)
      values (v_org, v_patient, v_doctor, 'issued') returning id into v_pr2;
    insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
      values (v_pr2, v_drug, 1);
    perform app_reserve_prescription(v_pr2, v_wh);
    if (select status from prescriptions where id = v_pr2) <> 'sent_to_pharmacy' then
      raise exception 'فشل: الوصفة لم تنتقل إلى الصيدلية';
    end if;
    if not exists (select 1 from v_prescriptions_pending_dispensing
                    where prescription_id = v_pr2) then
      raise exception 'فشل: وصفة في الصيدلية اختفت من عدّاد الشارة';
    end if;
  end;
  raise notice '✅ عدّاد شارة الصيدلية يشمل ما أُرسل إلى الصيدلية';

  raise notice '——— كل فحوص منطق الصيدلية نجحت ———';
end $$;

-- ---------------------------------------------------------------------------
-- الصلاحيات — خارج كتلة DO لأن RLS **لا تسري على المالك**
-- ---------------------------------------------------------------------------
do $$
declare
  v_org   uuid;
  v_owner uuid;
  v_pharm uuid;
  v_recep uuid;
  v_wh    uuid;
  v_drug  uuid;
  v_ctrl  uuid;
  v_pat   uuid;
  v_pr    uuid;
  v_pi    uuid;
  v_pic   uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph2-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph2-pharm@test.local')
    returning id into v_pharm;
  insert into auth.users (id, email) values (gen_random_uuid(), 'ph2-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة صلاحيات الصيدلية', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_pharm, 'pharmacist', true), (v_org, v_recep, 'receptionist', true);

  insert into warehouses (organization_id, code, name) values (v_org, 'W', 'مستودع')
    returning id into v_wh;
  v_drug := app_save_drug(v_org, null, jsonb_build_object('code','D','name_ar','دواء','price',10));
  v_ctrl := app_save_drug(v_org, null, jsonb_build_object(
    'code','C','name_ar','مخدّر','controlled_drug_class','narcotic','price',10));
  insert into inventory_lots (organization_id, warehouse_id, item_id, qty_remaining, qty_received, selling_price)
    values (v_org, v_wh, v_drug, 50, 50, 10), (v_org, v_wh, v_ctrl, 50, 50, 10);

  insert into patients (organization_id, name_ar) values (v_org, 'مريض') returning id into v_pat;
  insert into prescriptions (organization_id, patient_id, status)
    values (v_org, v_pat, 'issued') returning id into v_pr;
  insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
    values (v_pr, v_drug, 5) returning id into v_pi;
  insert into prescription_items (prescription_id, drug_item_id, quantity_prescribed)
    values (v_pr, v_ctrl, 5) returning id into v_pic;

  perform set_config('app.test_org',   v_org::text,   false);
  perform set_config('app.test_owner', v_owner::text, false);
  perform set_config('app.test_pharm', v_pharm::text, false);
  perform set_config('app.test_recep', v_recep::text, false);
  perform set_config('app.test_pr',    v_pr::text,    false);
  perform set_config('app.test_pi',    v_pi::text,    false);
  perform set_config('app.test_pic',   v_pic::text,   false);
  perform set_config('app.test_wh',    v_wh::text,    false);
  perform set_config('app.test_lot',
    (select id::text from inventory_lots where organization_id = v_org limit 1), false);
end $$;

-- موظف الاستقبال لا يصرف
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.test_recep'), true);

do $$
begin
  begin
    perform app_dispense_prescription(
      current_setting('app.test_pr')::uuid,
      current_setting('app.test_wh')::uuid,
      jsonb_build_array(jsonb_build_object(
        'prescription_item_id', current_setting('app.test_pi')::uuid, 'qty', 1)));
    raise exception 'فشل: موظف الاستقبال صرف دواءً';
  exception when others then
    if sqlerrm not like '%pharmacy.dispense%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا يصرف';
  end;

  begin
    perform app_adjust_stock(current_setting('app.test_lot')::uuid, 5, 'محاولة');
    raise exception 'فشل: موظف الاستقبال سوّى المخزون';
  exception when others then
    if sqlerrm not like '%inventory.adjust%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا يسوّي المخزون';
  end;

  -- ولا يرى المخزون أصلًا: `inventory.view` ليست من صلاحياته
  if exists (select 1 from inventory_lots
              where organization_id = current_setting('app.test_org')::uuid) then
    raise exception 'فشل: موظف الاستقبال يقرأ دفعات المخزون';
  end if;
  raise notice '✅ موظف الاستقبال لا يقرأ المخزون';
end $$;

reset role;

-- الصيدليّ يصرف العادي والرقابي؛ ثم نُسقط صلاحية الرقابة عنه فيُمنع
select set_config('request.jwt.claim.sub', current_setting('app.test_pharm'), true);
set local role authenticated;

do $$
declare v_rec uuid;
begin
  v_rec := app_dispense_prescription(
    current_setting('app.test_pr')::uuid,
    current_setting('app.test_wh')::uuid,
    jsonb_build_array(jsonb_build_object(
      'prescription_item_id', current_setting('app.test_pic')::uuid, 'qty', 2)));
  if v_rec is null then raise exception 'فشل: الصيدليّ لم يستطع صرف الرقابي'; end if;
  raise notice '✅ الصيدليّ يصرف الدواء الخاضع للرقابة';

  if not exists (select 1 from audit_log
                  where entity_id = v_rec and details like '%خاضعة للرقابة%') then
    raise exception 'فشل: صرف رقابيّ بلا أثر تدقيق مميَّز';
  end if;
  raise notice '✅ صرف الرقابي يُسجَّل في التدقيق باسم الدواء';
end $$;

reset role;

do $$
begin
  -- المنع يضعه مسؤولٌ آخر لا الصيدلانيّ نفسه: القاعدة تمنع تعديل المرء
  -- صلاحياته بنفسه (المرحلة 28).
  perform set_config('request.jwt.claim.sub', current_setting('app.test_owner'), true);
  insert into membership_permissions (organization_id, user_id, permission_key, granted)
    values (current_setting('app.test_org')::uuid, current_setting('app.test_pharm')::uuid,
            'pharmacy.dispense_controlled', false);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.test_pharm'), true);

do $$
begin
  begin
    perform app_dispense_prescription(
      current_setting('app.test_pr')::uuid,
      current_setting('app.test_wh')::uuid,
      jsonb_build_array(jsonb_build_object(
        'prescription_item_id', current_setting('app.test_pic')::uuid, 'qty', 1)));
    raise exception 'فشل: صُرف مخدّر بعد سحب صلاحية الرقابة';
  exception when others then
    if sqlerrm not like '%pharmacy.dispense_controlled%' then raise; end if;
    raise notice '✅ سحب صلاحية الرقابة يمنع صرف المخدّر ولا يمنع غيره';
  end;

  -- والدواء العادي ما زال يُصرَف — المنع مقصور على الرقابي
  if app_dispense_prescription(
       current_setting('app.test_pr')::uuid,
       current_setting('app.test_wh')::uuid,
       jsonb_build_array(jsonb_build_object(
         'prescription_item_id', current_setting('app.test_pi')::uuid, 'qty', 1))) is null then
    raise exception 'فشل: مُنع الدواء العادي أيضًا';
  end if;
  raise notice '✅ المنع مقصور على الرقابي';

  raise notice '——— كل فحوص صلاحيات الصيدلية نجحت ———';
end $$;

reset role;

rollback;
