-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المشتريات والموردين — 0097
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/purchasing-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- يتبع التسلسل المطلوب:
--   طلب شراء → موافقة → أمر شراء → استلام مخزني → فاتورة مورد
--   → استحقاق ماليّ → دفع المورد
-- ويهاجم كل موضع خسارة: الاعتماد الذاتي، والشراء بلا اعتماد، والاستلام
-- الزائد، والفوترة قبل الترحيل، والدفع فوق المستحقّ.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_mgr     uuid;
  v_branch  uuid;
  v_wh      uuid;
  v_dist    uuid;
  v_item_a  uuid;
  v_item_b  uuid;
  v_req     uuid;
  v_ri_a    uuid;
  v_ri_b    uuid;
  v_po      uuid;
  v_poi_a   uuid;
  v_poi_b   uuid;
  v_gr      uuid;
  v_gri     uuid;
  v_inv     uuid;
  v_ret     uuid;
  v_exp     uuid;
  v_cash    uuid;
  v_lot     uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pur-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'pur-mgr@test.local')
    returning id into v_mgr;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار المشتريات', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_mgr, 'branch_manager', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'المستودع الرئيسي', 'WH1') returning id into v_wh;

  insert into distributors (organization_id, name_ar, tax_number, payment_terms_days,
                            bank_iban, credit_limit)
    values (v_org, 'مورد الأدوية', '300000000000003', 30, 'SA0000000000000000000000', 50000)
    returning id into v_dist;

  insert into items (organization_id, item_type, code, name_ar, price, track_inventory,
                     track_expiry)
    values (v_org, 'product', 'PU-A', 'دواء أ', 50, true, true) returning id into v_item_a;
  insert into items (organization_id, item_type, code, name_ar, price, track_inventory,
                     track_expiry)
    values (v_org, 'product', 'PU-B', 'مستهلك ب', 20, true, false) returning id into v_item_b;

  select lv.id into v_cash from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الطلب لا يُقدَّم فارغًا، ويُحسب تقديره من بنوده
  -- ═════════════════════════════════════════════════════════════════════════
  insert into purchase_requests (organization_id, branch_id, warehouse_id,
                                 request_number, justification, requested_by, created_by)
    values (v_org, v_branch, v_wh, 'PR-1', 'نفاد المخزون', v_mgr, v_mgr)
    returning id into v_req;

  begin
    perform app_submit_purchase_request(v_req);
    raise exception 'فشل: قُدّم طلب بلا بنود';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بلا بنود%' then raise; end if;
  end;

  insert into purchase_request_items (organization_id, purchase_request_id, item_id,
                                      qty_requested, estimated_price)
    values (v_org, v_req, v_item_a, 100, 40) returning id into v_ri_a;
  insert into purchase_request_items (organization_id, purchase_request_id, item_id,
                                      qty_requested, estimated_price)
    values (v_org, v_req, v_item_b, 50, 10) returning id into v_ri_b;

  perform app_submit_purchase_request(v_req);
  select status, estimated_total into v_txt, v_num from purchase_requests where id = v_req;
  if v_txt <> 'submitted' then raise exception 'فشل: الطلب لم يُقدَّم'; end if;
  if v_num <> 4500 then    -- 100×40 + 50×10
    raise exception 'فشل: القيمة التقديرية % لا ٤٥٠٠', v_num;
  end if;
  raise notice '✅ ١) الطلب لا يُقدَّم فارغًا، وقيمته تُحسب من بنوده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) **مقدّم الطلب لا يعتمده** — فصلُهما هو كلّ قيمة الدورة
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  begin
    perform app_approve_purchase_request(v_req, 'موافق');
    raise exception 'فشل: اعتمد مقدّمُ الطلب طلبَه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مقدّمُه%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ٢) مقدّم الطلب لا يعتمده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) دورة الموافقة حسب القيمة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into purchase_approval_rules (organization_id, min_amount, max_amount,
                                       required_role_key, approval_level)
    values (v_org, 0, 1000, 'accountant', 1),
           (v_org, 1000.01, null, 'branch_manager', 2);

  if app_required_approval_role(v_org, 500, v_branch) <> 'accountant' then
    raise exception 'فشل: شريحة القيمة الصغيرة لا تُعيد الدور الصحيح';
  end if;
  if app_required_approval_role(v_org, 4500, v_branch) <> 'branch_manager' then
    raise exception 'فشل: شريحة القيمة الكبيرة لا تُعيد الدور الصحيح';
  end if;
  raise notice '✅ ٣) دور الاعتماد يُشتقّ من قيمة الطلب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الاعتماد الجزئي: يُعتمد أقلّ ممّا طُلب
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_approve_purchase_request(
    v_req, 'اعتماد بكمّية أقلّ',
    jsonb_build_array(jsonb_build_object('request_item_id', v_ri_a, 'qty_approved', 60)));

  if (select status from purchase_requests where id = v_req) <> 'partially_approved' then
    raise exception 'فشل: الاعتماد الجزئي لم يُعلَّم';
  end if;
  if (select qty_approved from purchase_request_items where id = v_ri_a) <> 60 then
    raise exception 'فشل: الكمّية المعتمدة لم تُحفظ';
  end if;
  -- ما لم يُذكر يُعتمد كاملًا
  if (select qty_approved from purchase_request_items where id = v_ri_b) <> 50 then
    raise exception 'فشل: البند غير المذكور لم يُعتمد كاملًا';
  end if;
  raise notice '✅ ٤) الاعتماد الجزئي يُسجَّل، وغير المذكور يُعتمد كاملًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) أمر الشراء من طلبٍ معتمَد فقط، وبالكمّيات المعتمَدة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_req2 uuid;
  begin
    insert into purchase_requests (organization_id, branch_id, warehouse_id,
                                   request_number, requested_by, created_by)
      values (v_org, v_branch, v_wh, 'PR-2', v_mgr, v_mgr) returning id into v_req2;
    insert into purchase_request_items (organization_id, purchase_request_id, item_id,
                                        qty_requested, estimated_price)
      values (v_org, v_req2, v_item_a, 10, 40);
    begin
      perform app_create_purchase_order(v_req2, v_dist);
      raise exception 'فشل: صدر أمر شراء من طلب غير معتمَد — الدورة زينة تُتخطّى';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%اعتماده أوّلًا%' then raise; end if;
    end;
  end;

  v_po := app_create_purchase_order(v_req, v_dist, current_date + 7, 'أمر اختبار');
  select id into v_poi_a from purchase_order_items
   where purchase_order_id = v_po and item_id = v_item_a;
  select id into v_poi_b from purchase_order_items
   where purchase_order_id = v_po and item_id = v_item_b;

  if (select qty_ordered from purchase_order_items where id = v_poi_a) <> 60 then
    raise exception 'فشل: الأمر أخذ الكمّية المطلوبة لا المعتمَدة';
  end if;
  -- 60×40 + 50×10 = 2900، والضريبة ١٥٪ = 435
  select subtotal_amount, vat_amount into v_num, v_int from purchase_orders where id = v_po;
  if v_num <> 2900 then raise exception 'فشل: إجمالي الأمر % لا ٢٩٠٠', v_num; end if;
  if v_int <> 435 then raise exception 'فشل: ضريبة الأمر % لا ٤٣٥', v_int; end if;
  if (select status from purchase_requests where id = v_req) <> 'ordered' then
    raise exception 'فشل: الطلب لم يُعلَّم مأمورًا';
  end if;
  raise notice '✅ ٥) الأمر من طلبٍ معتمَد فقط، وبالكمّيات المعتمَدة وضريبتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الاستلام الجزئي يُدخل المخزون ويُحدِّث الأمر
  -- ═════════════════════════════════════════════════════════════════════════
  insert into goods_receipts (organization_id, branch_id, warehouse_id, purchase_order_id,
                              distributor_id, receipt_number, received_by, created_by)
    values (v_org, v_branch, v_wh, v_po, v_dist, 'GR-1', v_owner, v_owner)
    returning id into v_gr;

  -- صنفٌ يُتتبَّع بالصلاحية بلا تاريخ: مرفوض
  insert into goods_receipt_items (organization_id, goods_receipt_id,
                                   purchase_order_item_id, item_id, qty_received, unit_cost)
    values (v_org, v_gr, v_poi_a, v_item_a, 40, 40) returning id into v_gri;
  begin
    perform app_post_goods_receipt(v_gr);
    raise exception 'فشل: دخل صنفٌ يُتتبَّع بالصلاحية بلا تاريخ انتهاء';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%تاريخ انتهاء%' then raise; end if;
  end;

  update goods_receipt_items
     set expiry_date = current_date + 365, lot_number = 'LOT-A1', free_qty = 5
   where id = v_gri;

  v_int := app_post_goods_receipt(v_gr);
  if v_int <> 1 then raise exception 'فشل: عدد البنود المرحَّلة % لا ١', v_int; end if;
  if (select status from goods_receipts where id = v_gr) <> 'posted' then
    raise exception 'فشل: الاستلام لم يُرحَّل';
  end if;

  select lot_id into v_lot from goods_receipt_items where id = v_gri;
  if v_lot is null then raise exception 'فشل: لم تُنشأ تشغيلة'; end if;
  if (select qty_remaining from inventory_lots where id = v_lot) <> 45 then
    raise exception 'فشل: رصيد التشغيلة لا يشمل المجّانيّ';
  end if;
  -- المجّانيّ يخفض تكلفة الوحدة: 40×40 ÷ 45 = 35.5556
  select unit_cost into v_num from inventory_lots where id = v_lot;
  if round(v_num, 2) <> 35.56 then
    raise exception 'فشل: تكلفة الوحدة % لم تُخفَّض بالمجّانيّ', v_num;
  end if;
  if (select qty_received from purchase_order_items where id = v_poi_a) <> 40 then
    raise exception 'فشل: المستلَم لم يُسجَّل على بند الأمر';
  end if;
  if (select status from purchase_orders where id = v_po) <> 'partially_received' then
    raise exception 'فشل: حالة الأمر ليست استلامًا جزئيًّا';
  end if;
  raise notice '✅ ٦) الاستلام الجزئي يُنشئ التشغيلة، والمجّانيّ يخفض تكلفة الوحدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) **الاستلام الزائد** مرفوض بلا صلاحية، ومطلوبٌ له سبب
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_gr2 uuid; v_gri2 uuid; v_recv uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'pur-recv@test.local')
      returning id into v_recv;
    insert into organization_memberships (organization_id, user_id, role_key, is_active)
      values (v_org, v_recv, 'pharmacist', true);

    insert into goods_receipts (organization_id, branch_id, warehouse_id,
                                purchase_order_id, distributor_id, receipt_number,
                                received_by, created_by)
      values (v_org, v_branch, v_wh, v_po, v_dist, 'GR-2', v_recv, v_recv)
      returning id into v_gr2;
    -- المتبقّي من الأمر ٢٠، والمستلَم ٥٠
    insert into goods_receipt_items (organization_id, goods_receipt_id,
                                     purchase_order_item_id, item_id, qty_received,
                                     unit_cost, lot_number, expiry_date)
      values (v_org, v_gr2, v_poi_a, v_item_a, 50, 40, 'LOT-A2', current_date + 200)
      returning id into v_gri2;

    -- الصيدليّ يملك الاستلام ولا يملك الاستلام الزائد
    perform set_config('request.jwt.claim.sub', v_recv::text, true);
    begin
      perform app_post_goods_receipt(v_gr2);
      raise exception 'فشل: قُبل استلام زائد بلا صلاحية';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%over_receive%' then raise; end if;
    end;

    -- المالك يملكها، لكن بلا سبب مرفوض
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    begin
      perform app_post_goods_receipt(v_gr2);
      raise exception 'فشل: قُبل استلام زائد بلا سبب';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%بلا سبب%' then raise; end if;
    end;

    update goods_receipt_items
       set over_receipt_reason = 'المورد شحن كرتونًا كاملًا', over_receipt_approved_by = v_owner
     where id = v_gri2;
    perform app_post_goods_receipt(v_gr2);
    if (select qty_received from purchase_order_items where id = v_poi_a) <> 90 then
      raise exception 'فشل: الاستلام الزائد لم يُسجَّل';
    end if;
  end;
  raise notice '✅ ٧) الاستلام الزائد يحتاج صلاحيةً مستقلّة وسببًا مسجَّلًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) لا فوترة لبضاعة لم تُرحَّل، ولا فاتورتان لاستلام واحد
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_gr3 uuid;
  begin
    insert into goods_receipts (organization_id, branch_id, warehouse_id, distributor_id,
                                receipt_number, created_by)
      values (v_org, v_branch, v_wh, v_dist, 'GR-3', v_owner) returning id into v_gr3;
    insert into goods_receipt_items (organization_id, goods_receipt_id, item_id,
                                     qty_received, unit_cost)
      values (v_org, v_gr3, v_item_b, 10, 10);
    begin
      perform app_create_purchase_invoice_from_receipt(v_gr3, 'INV-X');
      raise exception 'فشل: فُوتِرت بضاعة لم تُرحَّل إلى المخزون';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لم تُرحَّل%' then raise; end if;
    end;
  end;

  v_inv := app_create_purchase_invoice_from_receipt(v_gr, 'INV-1001', current_date);
  if v_inv is null then raise exception 'فشل: لم تُنشأ فاتورة المورد'; end if;

  begin
    perform app_create_purchase_invoice_from_receipt(v_gr, 'INV-1002');
    raise exception 'فشل: فُوتِر الاستلام مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مفوتَر سلفًا%' then raise; end if;
  end;

  -- تاريخ الاستحقاق من مهلة المورد لا بالتقدير
  if (select due_date from purchase_invoices where id = v_inv)
     <> current_date + 30 then
    raise exception 'فشل: تاريخ الاستحقاق لم يُشتقّ من مهلة المورد';
  end if;
  -- 40×40 = 1600 + ضريبة 240
  select subtotal_amount, vat_amount into v_num, v_int
    from purchase_invoices where id = v_inv;
  if v_num <> 1600 or v_int <> 240 then
    raise exception 'فشل: مبالغ الفاتورة (% / %) لا (١٦٠٠ / ٢٤٠)', v_num, v_int;
  end if;
  raise notice '✅ ٨) الفوترة بعد الترحيل فقط، ومرّةً واحدة، بمهلة المورد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) مصروف الشحن يرفع التكلفة الواصلة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_cost_before numeric; v_cost_after numeric;
  begin
    select unit_cost into v_cost_before from inventory_lots where id = v_lot;
    insert into purchase_expenses (organization_id, purchase_invoice_id, goods_receipt_id,
                                   expense_type, amount, allocation_method,
                                   distributor_id, created_by)
      values (v_org, v_inv, v_gr, 'shipping', 450, 'by_qty', v_dist, v_owner)
      returning id into v_exp;

    v_int := app_allocate_purchase_expense(v_exp);
    if v_int < 1 then raise exception 'فشل: المصروف لم يُوزَّع على تشغيلة'; end if;

    select unit_cost into v_cost_after from inventory_lots where id = v_lot;
    if v_cost_after <= v_cost_before then
      raise exception 'فشل: الشحن لم يرفع التكلفة الواصلة (% ← %) — الهامش سيبدو أكبر ممّا هو',
        v_cost_before, v_cost_after;
    end if;

    begin
      perform app_allocate_purchase_expense(v_exp);
      raise exception 'فشل: وُزّع المصروف مرّتين';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%موزَّع سلفًا%' then raise; end if;
    end;

    if (select expenses_amount from purchase_invoices where id = v_inv) <> 450 then
      raise exception 'فشل: المصروف لم يُسجَّل على الفاتورة';
    end if;
  end;
  raise notice '✅ ٩) الشحن يُوزَّع مرّةً واحدة ويرفع تكلفة التشغيلة الواصلة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) المرتجع يخرج من المخزون ولا يتجاوز رصيد التشغيلة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_rem_before numeric; v_rem_after numeric;
  begin
    insert into purchase_returns (organization_id, branch_id, warehouse_id, distributor_id,
                                  purchase_invoice_id, goods_receipt_id, return_number,
                                  reason, created_by)
      values (v_org, v_branch, v_wh, v_dist, v_inv, v_gr, 'PRT-1',
              'تلف أثناء الشحن', v_owner) returning id into v_ret;

    insert into purchase_return_items (organization_id, purchase_return_id, item_id,
                                       lot_id, qty_returned, unit_cost, receipt_item_id)
      values (v_org, v_ret, v_item_a, v_lot, 9999, 40, v_gri);
    begin
      perform app_post_purchase_return(v_ret);
      raise exception 'فشل: رُدّ أكثر ممّا في التشغيلة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%يتجاوز رصيد التشغيلة%' then raise; end if;
    end;

    update purchase_return_items set qty_returned = 5 where purchase_return_id = v_ret;
    select qty_remaining into v_rem_before from inventory_lots where id = v_lot;
    perform app_post_purchase_return(v_ret);
    select qty_remaining into v_rem_after from inventory_lots where id = v_lot;

    if v_rem_after <> v_rem_before - 5 then
      raise exception 'فشل: المرتجع لم يخرج من المخزون (% ← %)', v_rem_before, v_rem_after;
    end if;
    if (select status from purchase_returns where id = v_ret) <> 'posted' then
      raise exception 'فشل: المرتجع لم يُرحَّل';
    end if;
    begin
      perform app_post_purchase_return(v_ret);
      raise exception 'فشل: رُحّل المرتجع مرّتين';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا يُرحَّل مرّتين%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٠) المرتجع يخرج من التشغيلة نفسها، ولا يتجاوزها، ولا يُرحَّل مرّتين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الدفع: لا فوق المستحقّ، والحالة تُشتقّ من المدفوع
  -- ═════════════════════════════════════════════════════════════════════════
  select net_amount into v_num from purchase_invoices where id = v_inv;
  begin
    perform app_pay_supplier_invoice(v_inv, v_num + 100, v_cash);
    raise exception 'فشل: دُفع فوق المستحقّ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%يتجاوز المستحقّ%' then raise; end if;
  end;

  perform app_pay_supplier_invoice(v_inv, 500, v_cash, null, 'REF-1', 'دفعة أولى');
  if (select status from purchase_invoices where id = v_inv) <> 'partial' then
    raise exception 'فشل: الحالة بعد الدفع الجزئي ليست partial';
  end if;
  perform app_pay_supplier_invoice(v_inv, v_num - 500, v_cash);
  if (select status from purchase_invoices where id = v_inv) <> 'paid' then
    raise exception 'فشل: الحالة بعد السداد الكامل ليست paid';
  end if;
  raise notice '✅ ١١) الدفع لا يتجاوز المستحقّ، والحالة تُشتقّ منه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) كشف حساب المورد ورصيده
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_supplier_ledger
                  where distributor_id = v_dist and entry_kind = 'invoice') then
    raise exception 'فشل: الفاتورة لا تظهر في كشف حساب المورد';
  end if;
  if not exists (select 1 from v_supplier_ledger
                  where distributor_id = v_dist and entry_kind = 'payment') then
    raise exception 'فشل: الدفعات لا تظهر في كشف الحساب';
  end if;
  if not exists (select 1 from v_supplier_ledger
                  where distributor_id = v_dist and entry_kind = 'return') then
    raise exception 'فشل: المرتجع لا يظهر في كشف الحساب';
  end if;

  select balance_due into v_num from v_supplier_balances where distributor_id = v_dist;
  if v_num is null then raise exception 'فشل: رصيد المورد لا يُحسب'; end if;
  raise notice '✅ ١٢) كشف الحساب يجمع الفواتير والمدفوعات والمرتجعات، والرصيد يُحسب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) ما طُلب ولم يصل، ونسبة الاستلام
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_pending_receipts
                  where purchase_order_id = v_po and item_id = v_item_b
                    and qty_pending = 50) then
    raise exception 'فشل: الصنف الذي لم يصل لا يظهر في المعلّقات';
  end if;
  select received_percent into v_num from v_purchase_pipeline where purchase_order_id = v_po;
  if v_num is null or v_num <= 0 then
    raise exception 'فشل: نسبة الاستلام لا تُحسب في مسار الشراء';
  end if;
  raise notice '✅ ١٣) المعلّقات ونسبة الاستلام تُعرضان من مصدر واحد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) المستند المرحَّل لا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from goods_receipts where id = v_gr;
    raise exception 'فشل: حُذف مستند استلام مرحَّل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  begin
    delete from purchase_returns where id = v_ret;
    raise exception 'فشل: حُذف مرتجع مرحَّل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  raise notice '✅ ١٤) المستندات المرحَّلة لا تُحذف — تُلغى بسبب';

  raise notice '——— كل فحوص المشتريات نجحت ———';
end $$;

rollback;
