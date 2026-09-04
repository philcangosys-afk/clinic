-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المخزون المتقدم — 0098
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/inventory-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- يتبع مسار الاختبار المطلوب:
--   شراء واستلام تشغيلة → تحويلها لفرع → حجز كمّية لوصفة → صرف FEFO
--   → مرتجع → جرد وتسوية
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_mgr     uuid;
  v_br1     uuid;
  v_br2     uuid;
  v_wh1     uuid;
  v_wh2     uuid;
  v_loc     uuid;
  v_locq    uuid;
  v_dist    uuid;
  v_drug    uuid;
  v_lot_old uuid;
  v_lot_new uuid;
  v_tr      uuid;
  v_tri     uuid;
  v_count   uuid;
  v_ci      uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'inv-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'inv-mgr@test.local')
    returning id into v_mgr;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار المخزون', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_mgr, 'branch_manager', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الأول')
    returning id into v_br1;
  insert into branches (organization_id, name) values (v_org, 'الفرع الثاني')
    returning id into v_br2;
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_br1, 'مستودع ١', 'IW1') returning id into v_wh1;
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_br2, 'مستودع ٢', 'IW2') returning id into v_wh2;

  insert into distributors (organization_id, name_ar) values (v_org, 'مورد')
    returning id into v_dist;
  insert into items (organization_id, item_type, code, name_ar, price,
                     track_inventory, track_expiry)
    values (v_org, 'product', 'IV-D', 'دواء التتبّع', 100, true, true)
    returning id into v_drug;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) المواقع: الموقع يجب أن يكون في نفس المستودع
  -- ═════════════════════════════════════════════════════════════════════════
  insert into warehouse_locations (organization_id, warehouse_id, code, name, location_type)
    values (v_org, v_wh1, 'A-01', 'الرفّ الأول', 'shelf') returning id into v_loc;
  insert into warehouse_locations (organization_id, warehouse_id, code, location_type)
    values (v_org, v_wh1, 'Q-01', 'quarantine') returning id into v_locq;

  -- تشغيلتان: واحدة تنتهي قريبًا وأخرى بعيدًا — لاختبار FEFO
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              expiry_date, qty_received, qty_remaining, unit_cost,
                              distributor_id, location_id)
    values (v_org, v_wh1, v_drug, 'OLD', current_date + 30, 100, 100, 10, v_dist, v_loc)
    returning id into v_lot_old;
  insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                              expiry_date, qty_received, qty_remaining, unit_cost,
                              distributor_id, location_id)
    values (v_org, v_wh1, v_drug, 'NEW', current_date + 365, 100, 100, 12, v_dist, v_loc)
    returning id into v_lot_new;

  declare v_bad_loc uuid;
  begin
    insert into warehouse_locations (organization_id, warehouse_id, code, location_type)
      values (v_org, v_wh2, 'B-01', 'shelf') returning id into v_bad_loc;
    begin
      update inventory_lots set location_id = v_bad_loc where id = v_lot_old;
      raise exception 'فشل: قُبل موقعٌ من مستودع آخر — الجرد لن يُطابق أبدًا';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا ينتمي%' then raise; end if;
    end;
  end;
  raise notice '✅ ١) الموقع لا يكون إلا داخل مستودع تشغيلته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الرصيد بكل أبعاده يظهر في منظور واحد
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_stock_on_hand_detailed
                  where lot_id = v_lot_old and warehouse_id = v_wh1
                    and branch_id = v_br1 and location_code = 'A-01'
                    and lot_number = 'OLD' and available_qty = 100) then
    raise exception 'فشل: الرصيد لا يظهر بأبعاده (فرع/مستودع/موقع/تشغيلة)';
  end if;
  select stock_value into v_num from v_stock_valuation
   where warehouse_id = v_wh1 and item_id = v_drug;
  if v_num <> 2200 then    -- 100×10 + 100×12
    raise exception 'فشل: قيمة المخزون % لا ٢٢٠٠', v_num;
  end if;
  raise notice '✅ ٢) الرصيد والقيمة يُعرضان بكل الأبعاد من مصدر واحد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) التحويل: لا شحن قبل الاعتماد، ولا يعتمده طالبُه
  -- ═════════════════════════════════════════════════════════════════════════
  insert into stock_transfers (organization_id, from_branch_id, to_branch_id,
                               from_warehouse_id, to_warehouse_id, transfer_number,
                               status, reason, requested_by, created_by)
    values (v_org, v_br1, v_br2, v_wh1, v_wh2, 1001, 'requested',
            'نفاد في الفرع الثاني', v_mgr, v_mgr) returning id into v_tr;
  insert into stock_transfer_items (organization_id, transfer_id, item_id, qty, unit_cost)
    values (v_org, v_tr, v_drug, 30, 10) returning id into v_tri;

  begin
    perform app_ship_stock_transfer(v_tr);
    raise exception 'فشل: شُحن تحويل قبل اعتماده — البضاعة تخرج بلا إذن';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%اعتماده أوّلًا%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  begin
    perform app_approve_stock_transfer(v_tr);
    raise exception 'فشل: اعتمد طالبُ التحويل تحويلَه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%طالبُه%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  perform app_approve_stock_transfer(v_tr, 'موافق');
  if (select status from stock_transfers where id = v_tr) <> 'approved' then
    raise exception 'فشل: التحويل لم يُعتمد';
  end if;
  raise notice '✅ ٣) لا شحن قبل الاعتماد، ولا يعتمد التحويلَ طالبُه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الشحن يخرج بـFEFO ولا يدخل الوجهة قبل الاستلام
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_ship_stock_transfer(v_tr);

  -- الأقرب انتهاءً أوّلًا: تخرج من OLD لا من NEW
  if (select qty_remaining from inventory_lots where id = v_lot_old) <> 70 then
    raise exception 'فشل: الشحن لم يتبع FEFO — التشغيلة القريبة الانتهاء لم تُستهلك';
  end if;
  if (select qty_remaining from inventory_lots where id = v_lot_new) <> 100 then
    raise exception 'فشل: أُخذ من التشغيلة البعيدة الانتهاء';
  end if;

  -- **في الطريق**: خرجت من المصدر ولم تدخل الوجهة
  if exists (select 1 from inventory_lots
              where warehouse_id = v_wh2 and item_id = v_drug and qty_remaining > 0) then
    raise exception 'فشل: البضاعة دخلت الوجهة قبل استلامها — تُحسب مرّتين';
  end if;
  select qty_in_transit into v_num from v_transfer_pipeline where transfer_id = v_tr;
  if v_num <> 30 then
    raise exception 'فشل: الكمّية في الطريق % لا ٣٠', v_num;
  end if;
  raise notice '✅ ٤) الشحن يتبع FEFO، والبضاعة في الطريق خارج رصيد الطرفين';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الاستلام: النقص يحتاج ملاحظة، والزائد مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_receive_stock_transfer(v_tr,
      jsonb_build_array(jsonb_build_object('item_id', v_drug, 'qty_received', 40)));
    raise exception 'فشل: استُلم أكثر من المشحون';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%يتجاوز المشحون%' then raise; end if;
  end;

  begin
    perform app_receive_stock_transfer(v_tr,
      jsonb_build_array(jsonb_build_object('item_id', v_drug, 'qty_received', 25)));
    raise exception 'فشل: قُبل نقصٌ في الاستلام بلا ملاحظة — الفقد يُدفن في الأرقام';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بلا ملاحظة%' then raise; end if;
  end;

  perform app_receive_stock_transfer(v_tr,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_drug, 'qty_received', 28,
      'variance_note', 'علبتان مكسورتان عند الوصول')));

  if (select status from stock_transfers where id = v_tr) <> 'received' then
    raise exception 'فشل: التحويل لم يُعلَّم مستلَمًا';
  end if;
  select qty_remaining into v_num from inventory_lots
   where id = (select received_lot_id from stock_transfer_items where id = v_tri);
  if v_num <> 28 then
    raise exception 'فشل: رصيد الوجهة % لا ٢٨', v_num;
  end if;
  -- رقم التشغيلة وتاريخ الصلاحية ينتقلان
  declare v_exp date;
  begin
    select lot_number, expiry_date into v_txt, v_exp from inventory_lots
     where id = (select received_lot_id from stock_transfer_items where id = v_tri);
    if v_txt <> 'OLD' then
      raise exception 'فشل: رقم التشغيلة لم ينتقل مع البضاعة — التتبّع انقطع';
    end if;
    if v_exp <> current_date + 30 then
      raise exception 'فشل: تاريخ الصلاحية لم ينتقل — FEFO في الوجهة سيكون خاطئًا';
    end if;
  end;
  raise notice '✅ ٥) الاستلام يوثّق النقص، ويحمل رقم التشغيلة وصلاحيتها إلى الوجهة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) التتبّع يعبر الفروع
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from app_trace_lot(v_lot_old);
  if v_int < 2 then
    raise exception 'فشل: التتبّع لا يشمل الخروج والدخول (% خطوة)', v_int;
  end if;
  if not exists (select 1 from app_trace_lot(v_lot_old) where step_kind = 'transfer_in') then
    raise exception 'فشل: التتبّع انقطع عند التحويل — لا يعبر الفروع';
  end if;
  raise notice '✅ ٦) تتبّع التشغيلة يعبر التحويل بين الفروع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الحجز يمنع التحويل: المحجوز مملوكٌ وغير متاح
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_tr2 uuid;
  begin
    update inventory_lots set reserved_quantity = 65 where id = v_lot_old;
    -- المتاح من OLD = 70 − 65 = 5، ومن NEW = 100
    insert into stock_transfers (organization_id, from_branch_id, to_branch_id,
                                 from_warehouse_id, to_warehouse_id, transfer_number,
                                 status, reason, requested_by, created_by)
      values (v_org, v_br1, v_br2, v_wh1, v_wh2, 1002, 'approved',
              'اختبار الحجز', v_mgr, v_owner) returning id into v_tr2;
    insert into stock_transfer_items (organization_id, transfer_id, item_id, qty,
                                      unit_cost, lot_id)
      values (v_org, v_tr2, v_drug, 10, 10, v_lot_old);
    begin
      perform app_ship_stock_transfer(v_tr2);
      raise exception 'فشل: حُوّل مخزون محجوز لوصفة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا يكفي للتحويل%' then raise; end if;
    end;
    update inventory_lots set reserved_quantity = 0 where id = v_lot_old;
  end;
  raise notice '✅ ٧) المحجوز لوصفة لا يُحوَّل ولو بدا في الرصيد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الحجر يمنع الصرف، والإتلاف يخرج بحركة مسجَّلة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_rem numeric;
  begin
    perform app_quarantine_lot(v_lot_new, 'اشتباه في سلسلة التبريد', v_locq);
    if (select status from inventory_lots where id = v_lot_new) <> 'quarantined' then
      raise exception 'فشل: التشغيلة لم تُحجر';
    end if;
    -- الحجر لا يخرجها من الرصيد
    if (select qty_remaining from inventory_lots where id = v_lot_new) <> 100 then
      raise exception 'فشل: الحجر أخرج الكمّية من الرصيد بلا حركة';
    end if;

    begin
      insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                       movement_type, qty, unit_price)
      values (v_org, v_wh1, v_drug, v_lot_new, 'sale_out', 1, 12);
      raise exception 'فشل: صُرفت تشغيلة محجورة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%محجورة%' then raise; end if;
    end;

    select qty_remaining into v_rem from inventory_lots where id = v_lot_new;
    perform app_dispose_lot(v_lot_new, 20, 'انكسار سلسلة التبريد');
    if (select qty_remaining from inventory_lots where id = v_lot_new) <> v_rem - 20 then
      raise exception 'فشل: الإتلاف لم يخرج من الرصيد';
    end if;
    if not exists (select 1 from inventory_movements
                    where lot_id = v_lot_new and movement_type = 'adjustment_out'
                      and note like '%إتلاف%') then
      raise exception 'فشل: الإتلاف بلا حركة مسجَّلة';
    end if;
    begin
      perform app_dispose_lot(v_lot_new, 99999, 'اختبار');
      raise exception 'فشل: أُتلف أكثر من الرصيد';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%تتجاوز رصيد%' then raise; end if;
    end;
    update inventory_lots set status = 'available' where id = v_lot_new;
  end;
  raise notice '✅ ٨) الحجر يمنع الصرف ولا يُخفي الرصيد، والإتلاف يخرج بحركة وسبب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) الجرد: لقطة دفترية، وفرقٌ بلا سبب مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  v_count := app_start_stock_count(v_wh1, 'surprise', 'SC-1');
  select count(*) into v_int from stock_count_items where stock_count_id = v_count;
  if v_int < 2 then raise exception 'فشل: لقطة الجرد لم تشمل التشغيلات'; end if;

  select id into v_ci from stock_count_items
   where stock_count_id = v_count and lot_id = v_lot_old;
  select system_qty into v_num from stock_count_items where id = v_ci;
  if v_num <> 70 then
    raise exception 'فشل: الرصيد الدفتري في اللقطة % لا ٧٠', v_num;
  end if;

  begin
    perform app_record_stock_count_line(v_ci, 65);
    raise exception 'فشل: قُبل فرق جرد بلا سبب — العجز يصير رقمًا مقبولًا';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%يحتاج سببًا%' then raise; end if;
  end;

  perform app_record_stock_count_line(v_ci, 65, 'كسر لم يُسجَّل وقتَه');
  if (select variance_qty from stock_count_items where id = v_ci) <> -5 then
    raise exception 'فشل: الفرق لم يُحسب';
  end if;
  raise notice '✅ ٩) الجرد يُجمّد الرصيد الدفتري، والفرق لا يمرّ بلا سبب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) لا اعتماد لجردٍ ناقص، ولا يعتمده من عدّه، ولا ترحيل قبل الاعتماد
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_approve_stock_count(v_count);
    raise exception 'فشل: اعتُمد جردٌ لم تُعدّ كل بنوده';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    -- إمّا «جرد ناقص» وإمّا «من نفّذه» — كلاهما حاجز صحيح
    if sqlerrm not like '%لم يُعدّ%' and sqlerrm not like '%من نفّذه%' then raise; end if;
  end;

  -- عدّ بقيّة البنود بنفس الرصيد (بلا فروق)
  update stock_count_items
     set counted_qty = system_qty, counted_at = now(), counted_by = v_owner
   where stock_count_id = v_count and counted_qty is null;

  begin
    perform app_post_stock_count(v_count);
    raise exception 'فشل: رُحّلت تسوية جرد قبل اعتمادها';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%اعتماده أوّلًا%' then raise; end if;
  end;

  -- من عدّ لا يعتمد
  update stock_counts set counted_by = v_owner where id = v_count;
  begin
    perform app_approve_stock_count(v_count);
    raise exception 'فشل: اعتمد الجردَ من نفّذه — العجز يُغطّى بقلم مَن سبّبه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%من نفّذه%' then raise; end if;
  end;

  update stock_counts set counted_by = v_mgr where id = v_count;
  perform app_approve_stock_count(v_count);
  raise notice '✅ ١٠) لا اعتماد لجرد ناقص ولا ممّن عدّه، ولا ترحيل قبل الاعتماد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الترحيل يُسوّي بحركة لا بتعديل مباشر
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_before numeric;
  begin
    select qty_remaining into v_before from inventory_lots where id = v_lot_old;
    v_int := app_post_stock_count(v_count);
    if v_int <> 1 then raise exception 'فشل: عدد الفروقات المسوّاة % لا ١', v_int; end if;
    if (select qty_remaining from inventory_lots where id = v_lot_old) <> v_before - 5 then
      raise exception 'فشل: التسوية لم تُصحّح الرصيد';
    end if;
    if not exists (select 1 from inventory_movements
                    where lot_id = v_lot_old and movement_type = 'adjustment_out'
                      and note like '%تسوية جرد%' and note like '%كسر%') then
      raise exception 'فشل: التسوية بلا حركة تحمل سببها';
    end if;
    if (select status from stock_counts where id = v_count) <> 'posted' then
      raise exception 'فشل: الجرد لم يُعلَّم مرحَّلًا';
    end if;
  end;
  raise notice '✅ ١١) التسوية حركةٌ في السجل تحمل سببها، لا تعديلٌ صامت للرصيد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) الفروقات بقيمتها، والجرد المرحَّل لا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  select variance_value into v_num from v_stock_count_variance
   where count_item_id = v_ci;
  if v_num <> -50 then    -- ٥ وحدات × ١٠
    raise exception 'فشل: قيمة الفرق % لا ٥٠−', v_num;
  end if;
  begin
    delete from stock_counts where id = v_count;
    raise exception 'فشل: حُذف جرد مرحَّل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  raise notice '✅ ١٢) الفرق يُقوَّم بالتكلفة، والجرد المرحَّل لا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) حدود المخزون لكل مستودع، والمتاح لا الرصيد
  -- ═════════════════════════════════════════════════════════════════════════
  insert into item_stock_settings (organization_id, warehouse_id, item_id,
                                   min_qty, max_qty, reorder_level, reorder_qty,
                                   preferred_distributor_id)
    values (v_org, v_wh1, v_drug, 50, 200, 80, 100, v_dist);
  insert into item_stock_settings (organization_id, warehouse_id, item_id,
                                   min_qty, max_qty, reorder_level)
    values (v_org, v_wh2, v_drug, 10, 40, 15);

  -- مستودع ١: الرصيد 65 + 80 = 145، فوق حدّ إعادة الطلب 80
  if (select needs_reorder from v_reorder_suggestions
       where warehouse_id = v_wh1 and item_id = v_drug) then
    raise exception 'فشل: اقتُرح طلبٌ لمستودع فوق حدّه';
  end if;
  -- مستودع ٢: الرصيد 28 فوق حدّه 15
  if (select needs_reorder from v_reorder_suggestions
       where warehouse_id = v_wh2 and item_id = v_drug) then
    raise exception 'فشل: اقتُرح طلبٌ لمستودع فوق حدّه (٢)';
  end if;

  -- الحجز يجعل المتاح أقلّ من الحدّ رغم أن الرصيد أعلى.
  -- (الحجز لا يتجاوز رصيد تشغيلته — قيدٌ قائم في 0088.)
  update inventory_lots set reserved_quantity = 60 where id = v_lot_old;
  update inventory_lots set reserved_quantity = 60 where id = v_lot_new;
  if not (select needs_reorder from v_reorder_suggestions
           where warehouse_id = v_wh1 and item_id = v_drug) then
    raise exception 'فشل: المحجوز حُسب متاحًا — صنفٌ رصيده محجوز بالكامل لن يُطلب';
  end if;
  select suggested_qty into v_num from v_reorder_suggestions
   where warehouse_id = v_wh1 and item_id = v_drug;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: الكمّية المقترحة غير محسوبة';
  end if;
  update inventory_lots set reserved_quantity = 0 where id in (v_lot_old, v_lot_new);
  raise notice '✅ ١٣) الحدود لكل مستودع، والاقتراح يُبنى على المتاح لا الرصيد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الراكد يُقاس بآخر خروج لا بآخر حركة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_idle uuid; v_class text;
  begin
    insert into items (organization_id, item_type, code, name_ar, price, track_inventory)
      values (v_org, 'product', 'IV-IDLE', 'صنف راكد', 5, true) returning id into v_idle;
    insert into inventory_lots (organization_id, warehouse_id, item_id, qty_received,
                                qty_remaining, unit_cost)
      values (v_org, v_wh1, v_idle, 10, 10, 5);
    -- استلامٌ حديث بلا صرف: ليس نشاطًا
    insert into inventory_movements (organization_id, warehouse_id, item_id,
                                     movement_type, qty, unit_price)
      values (v_org, v_wh1, v_idle, 'purchase_in', 0.001, 5);

    select movement_class into v_class from v_stock_movement_age
     where warehouse_id = v_wh1 and item_id = v_idle;
    if v_class <> 'راكد تمامًا' then
      raise exception 'فشل: صنفٌ يُستلم ولا يُصرف صُنّف % — الاستلام حُسب نشاطًا', v_class;
    end if;

    select movement_class into v_class from v_stock_movement_age
     where warehouse_id = v_wh1 and item_id = v_drug;
    if v_class <> 'نشط' then
      raise exception 'فشل: صنفٌ خرج اليوم صُنّف %', v_class;
    end if;
  end;
  raise notice '✅ ١٤) الراكد يُقاس بآخر خروج — الاستلام ليس نشاطًا';

  raise notice '——— كل فحوص المخزون المتقدم نجحت ———';
end $$;

rollback;
