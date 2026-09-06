-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ بيانات وهمية للتحقّق من القواعد ثم يتراجع عنها (begin … rollback) ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات 0147: صيغة الجوال والهوية، والإعفاء الضريبي بالجنسية والهوية،
-- والدفعات داخل معاملة الفاتورة، واليومية المالية.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/day-close-and-vat.test.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_patient uuid;
  v_foreign uuid;
  v_item    uuid;
  v_nat_sa  uuid;
  v_nat_eg  uuid;
  v_inv     uuid;
  v_inv2    uuid;
  v_day     uuid;
  v_day2    uuid;
  v_cash    uuid;
  v_mada    uuid;
  v_reg     uuid;
  v_num     numeric;
  v_int     int;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'day-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار 0147', 'medical_center', v_owner, 15) returning id into v_org;
  -- مُحفِّز إنشاء المنشأة يُدرج المالك عضوًا؛ الإدراج هنا احتياطًا لا أكثر
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_owner, 'owner', true)
    on conflict (organization_id, user_id) do update set role_key = 'owner', is_active = true;
  insert into branches (organization_id, name, code)
    values (v_org, 'الرئيسي', 'DAY-1') returning id into v_branch;

  select lv.id into v_nat_sa from lookup_values lv
    join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'nationalities' and btrim(lv.name_ar) = 'سعودي' limit 1;
  select lv.id into v_nat_eg from lookup_values lv
    join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'nationalities' and btrim(lv.name_ar) = 'مصري' limit 1;
  if v_nat_sa is null or v_nat_eg is null then
    raise exception 'فشل التهيئة: الجنسيات غير مزروعة (تُنفَّذ 0146 أولًا)';
  end if;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الجوال والهوية عشرة أرقام
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into patients (organization_id, name_ar, mobile_number)
      values (v_org, 'جوال ناقص', '05012345');
    raise exception 'فشل: قُبل جوال بثماني خانات';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%١٠ أرقام%' then raise; end if;
  end;

  begin
    insert into patients (organization_id, name_ar, mobile_number)
      values (v_org, 'جوال زائد', '05012345678');
    raise exception 'فشل: قُبل جوال بإحدى عشرة خانة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%١٠ أرقام%' then raise; end if;
  end;

  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'هوية ناقصة', '123456789');
    raise exception 'فشل: قُبل رقم هوية بتسع خانات';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%١٠ أرقام%' then raise; end if;
  end;

  -- والملفّ بلا رقم يبقى ممكنًا (الطوارئ والرضّع)
  insert into patients (organization_id, name_ar) values (v_org, 'بلا أرقام');
  raise notice '✅ ١) الجوال والهوية عشرة أرقام، والملفّ بلا رقم ممكن';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الإعفاء الضريبي: سعوديّ بهوية معفى، وغير السعوديّ تُحتسب ضريبته
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patients (organization_id, branch_id, name_ar, id_number, mobile_number,
                        nationality_value_id)
    values (v_org, v_branch, 'مواطن سعودي', '1122334455', '0501234567', v_nat_sa)
    returning id into v_patient;
  insert into patients (organization_id, branch_id, name_ar, id_number, mobile_number,
                        nationality_value_id)
    values (v_org, v_branch, 'مقيم مصري', '2233445566', '0507654321', v_nat_eg)
    returning id into v_foreign;

  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, '10', 'كشف', 'service', 200) returning id into v_item;

  -- إعدادات الضريبة: الجنسية السعودية معفاة (كما تزرعها الترقية)
  insert into organization_vat_settings (organization_id, sales_vat_enabled,
                                         vat_exempt_nationality_value_ids)
    values (v_org, true, array[v_nat_sa])
    on conflict (organization_id) do update
      set sales_vat_enabled = true, vat_exempt_nationality_value_ids = array[v_nat_sa];

  v_inv := app_create_sales_invoice(
    p_organization_id => v_org,
    p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 200)),
    p_patient_id => v_patient);

  select vat_amount, exemption_amount, net_amount into v_num, v_int, v_txt
    from sales_invoices where id = v_inv;
  if v_num <> 0 then
    raise exception 'فشل: احتُسبت ضريبة % على مواطن معفى', v_num;
  end if;
  select net_amount into v_num from sales_invoices where id = v_inv;
  if v_num <> 200 then
    raise exception 'فشل: صافي فاتورة المعفى % لا 200', v_num;
  end if;

  v_inv2 := app_create_sales_invoice(
    p_organization_id => v_org,
    p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 200)),
    p_patient_id => v_foreign);
  select vat_amount, net_amount into v_num, v_int from sales_invoices where id = v_inv2;
  if v_num <> 30 then
    raise exception 'فشل: ضريبة غير السعوديّ % لا 30', v_num;
  end if;
  raise notice '✅ ٢) السعوديّ بهوية معفى من الضريبة، وغيره تُحتسب عليه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) الإعفاء يشترط الهوية: جنسية سعودية بلا هوية لا تُعفي
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_no_id uuid;
  begin
    insert into patients (organization_id, name_ar, nationality_value_id)
      values (v_org, 'سعودي بلا هوية', v_nat_sa) returning id into v_no_id;
    v_inv2 := app_create_sales_invoice(
      p_organization_id => v_org,
      p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 200)),
      p_patient_id => v_no_id);
    select vat_amount into v_num from sales_invoices where id = v_inv2;
    if v_num <> 30 then
      raise exception 'فشل: أُعفي مريض بجنسية سعودية بلا هوية (ضريبة %)', v_num;
    end if;
  end;
  raise notice '✅ ٣) الإعفاء يشترط الهوية لا الجنسية وحدها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) منع الفاتورة بلا جنسية/هوية — إعداد كان يُحفظ ولا يقرؤه شيء
  -- ═════════════════════════════════════════════════════════════════════════
  update organization_vat_settings
     set block_invoice_without_nationality_or_id = true where organization_id = v_org;
  declare v_bare uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'بلا جنسية ولا هوية')
      returning id into v_bare;
    begin
      perform app_create_sales_invoice(
        p_organization_id => v_org,
        p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 100)),
        p_patient_id => v_bare);
      raise exception 'فشل: صدرت فاتورة لمريض بلا جنسية ولا هوية والمنع مفعَّل';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%تتطلّب جنسية ورقم هوية%' then raise; end if;
    end;
  end;
  update organization_vat_settings
     set block_invoice_without_nationality_or_id = false where organization_id = v_org;
  raise notice '✅ ٤) منع الفاتورة بلا جنسية/هوية يعمل حين يُفعَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الدفع داخل معاملة الفاتورة يُنشئ سند قبض حقيقيًّا (لا رقمًا فقط)
  -- ═════════════════════════════════════════════════════════════════════════
  select lv.id into v_mada from lookup_values lv
    join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'payment_methods' and lv.code = 'mada' limit 1;
  select lv.id into v_cash from lookup_values lv
    join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'payment_methods' and lv.code = 'cash' limit 1;
  if v_mada is null or v_cash is null then
    raise exception 'فشل التهيئة: طرق الدفع غير مزروعة';
  end if;

  v_inv := app_create_sales_invoice(
    p_organization_id => v_org,
    p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 200)),
    p_patient_id => v_patient,
    p_payments => jsonb_build_array(
      jsonb_build_object('amount', 120, 'payment_method_value_id', v_mada),
      jsonb_build_object('amount', 80,  'payment_method_value_id', v_mada)));

  select count(*), coalesce(sum(amount), 0) into v_int, v_num
    from financial_vouchers where related_sales_invoice_id = v_inv and voucher_type = 'receipt';
  if v_int <> 2 then
    raise exception 'فشل: سندات القبض % لا 2 (الدفع المجزّأ)', v_int;
  end if;
  if v_num <> 200 then
    raise exception 'فشل: مجموع السندات % لا 200', v_num;
  end if;
  select paid_amount, status into v_num, v_txt from sales_invoices where id = v_inv;
  if v_num <> 200 or v_txt <> 'paid' then
    raise exception 'فشل: المدفوع % والحالة % بعد التحصيل الكامل', v_num, v_txt;
  end if;

  -- ولا يقبل ما يتجاوز المتبقّي
  begin
    perform app_create_sales_invoice(
      p_organization_id => v_org,
      p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 100)),
      p_patient_id => v_patient,
      p_payments => jsonb_build_array(
        jsonb_build_object('amount', 500, 'payment_method_value_id', v_mada)));
    raise exception 'فشل: قُبلت دفعة تتجاوز قيمة الفاتورة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%يتجاوز المتبقّي%' then raise; end if;
  end;
  raise notice '✅ ٥) الدفع المجزّأ يُنشئ سندات قبض حقيقية ولا يتجاوز المتبقّي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) اليومية: تُفتح بأوّل فاتورة، وتجمع فواتيرها وسنداتها
  -- ═════════════════════════════════════════════════════════════════════════
  select business_day_id into v_day from sales_invoices where id = v_inv;
  if v_day is null then
    raise exception 'فشل: الفاتورة بلا يومية';
  end if;
  select count(*) into v_int from business_days
   where organization_id = v_org and closed_at is null;
  if v_int <> 1 then
    raise exception 'فشل: عدد اليوميات المفتوحة % لا 1', v_int;
  end if;

  -- سند الفاتورة يُنسب إلى اليومية نفسها
  select count(*) into v_int from financial_vouchers
   where related_sales_invoice_id = v_inv and business_day_id = v_day;
  if v_int <> 2 then
    raise exception 'فشل: سندات خارج اليومية (% داخلها)', v_int;
  end if;

  select invoices_count, net_collected_amount into v_int, v_num
    from v_business_day_summary where business_day_id = v_day;
  if v_num <> 200 then
    raise exception 'فشل: محصَّل اليومية % لا 200', v_num;
  end if;
  raise notice '✅ ٦) اليومية تُفتح تلقائيًّا وتجمع فواتيرها وسنداتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الإغلاق يفتح يومية جديدة لما بعده — في التاريخ نفسه
  -- ═════════════════════════════════════════════════════════════════════════
  -- الفرع هنا `null` عمدًا: الفاتورة لا تحمل فرعًا اليوم، فاليومية على مستوى
  -- المنشأة — وإغلاقها يجب أن يستعمل نفس النطاق الذي وُسِمت به.
  perform app_close_business_day(v_org, null, 'إغلاق ليلي');
  select closed_at is not null into v_txt from business_days where id = v_day;

  v_inv2 := app_create_sales_invoice(
    p_organization_id => v_org,
    p_items => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'price', 50)),
    p_patient_id => v_patient);
  select business_day_id into v_day2 from sales_invoices where id = v_inv2;
  if v_day2 is null or v_day2 = v_day then
    raise exception 'فشل: فاتورة بعد الإغلاق بقيت في اليومية المغلقة';
  end if;
  if (select business_date from business_days where id = v_day2)
     <> (select business_date from business_days where id = v_day) then
    raise exception 'فشل: تغيّر التاريخ — الاختبار يفترض اليوم نفسه';
  end if;

  -- والإغلاق مرّتين مرفوض برسالة مفهومة
  perform app_close_business_day(v_org, null, null);
  begin
    perform app_close_business_day(v_org, null, null);
    raise exception 'فشل: أُغلقت يومية غير مفتوحة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا توجد يومية مفتوحة%' then raise; end if;
  end;
  raise notice '✅ ٧) الإغلاق يفصل ما بعده في يومية جديدة ولو في التاريخ نفسه';

  raise notice '——— كل فحوص 0147 نجحت ———';
end $$;

rollback;
