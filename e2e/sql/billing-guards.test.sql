-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الفوترة والمدفوعات — 0091
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/billing-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- كل فحص يقابل خللًا كان قائمًا فعلًا: الدفع بلا حدّ، والفاتورة الملغاة التي
-- تعود حيّة، والمصدر الذي يُفوتَر مرّتين، والمناوبة التي تُغلق بلا جرد.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_acc     uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_consult uuid;
  v_lab     uuid;
  v_visit   uuid;
  v_inv     uuid;
  v_inv2    uuid;
  v_reg     uuid;
  v_shift   uuid;
  v_cash    uuid;
  v_bank    uuid;
  v_v1      uuid;
  v_v2      uuid;
  v_num     numeric;
  v_txt     text;
  v_json    jsonb;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'bl-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'bl-recep@test.local')
    returning id into v_recep;
  insert into auth.users (id, email) values (gen_random_uuid(), 'bl-acc@test.local')
    returning id into v_acc;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار الفوترة', 'clinic', v_owner, 15) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true), (v_org, v_acc, 'accountant', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','C1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب') returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض الفوترة')
    returning id into v_patient;

  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'CONS', 'كشف', 300, 'consultation') returning id into v_consult;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, is_vat_exempt)
    values (v_org, 'service', 'LAB1', 'تحليل معفى', 100, 'laboratory', true) returning id into v_lab;

  select lv.id into v_cash from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';
  select lv.id into v_bank from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'bank_transfer' limit 1;

  insert into cash_registers (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'صندوق الاستقبال', 'CR1') returning id into v_reg;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) طرق الدفع لها أكواد ولا تكرار فيها
  -- ═════════════════════════════════════════════════════════════════════════
  if v_cash is null then
    raise exception 'فشل: لا طريقة دفع نقدية بالكود cash';
  end if;
  select count(*) into v_int from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';
  if v_int <> 1 then
    raise exception 'فشل: % طريقة نقدية — الدرج ينقسم بينها', v_int;
  end if;
  raise notice '✅ ١) طرق الدفع مكوَّدة، والنقد واحد لا اثنان';

  -- ── زيارة بخدمتين
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
    returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_consult, 1, 300, 'performed'),
           (v_org, v_visit, v_lab, 1, 100, 'performed');

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الفاتورة من الزيارة: تجمع، وتسعّر، وتحسب الضريبة بندًا بندًا
  -- ═════════════════════════════════════════════════════════════════════════
  v_inv := app_create_invoice_from_visit(v_visit, false);

  select count(*) into v_int from sales_invoice_items where invoice_id = v_inv;
  if v_int <> 2 then raise exception 'فشل: الفاتورة تحمل % بندًا لا اثنين', v_int; end if;

  -- الكشف خاضع ١٥٪، والتحليل معفى
  select vat_amount into v_num from sales_invoice_items
   where invoice_id = v_inv and item_id = v_consult;
  if v_num <> 45 then raise exception 'فشل: ضريبة الكشف % لا ٤٥', v_num; end if;

  select vat_amount, vat_category into v_num, v_txt from sales_invoice_items
   where invoice_id = v_inv and item_id = v_lab;
  if v_num <> 0 or v_txt <> 'exempt' then
    raise exception 'فشل: البند المعفى حُسبت عليه ضريبة (% / %)', v_num, v_txt;
  end if;

  select net_amount into v_num from sales_invoices where id = v_inv;
  if v_num <> 445 then raise exception 'فشل: إجمالي الفاتورة % لا ٤٤٥', v_num; end if;

  if (select status from sales_invoices where id = v_inv) <> 'draft' then
    raise exception 'فشل: الفاتورة لم تُنشأ مسوّدة';
  end if;
  raise notice '✅ ٢) الفاتورة تُجمع من الزيارة، والضريبة تُحسب لكل بند على حدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) اللقطة التاريخية: تغيير الكتالوج لا يغيّر الفاتورة
  -- ═════════════════════════════════════════════════════════════════════════
  update items set name_ar = 'كشف باطنة معدَّل' where id = v_consult;
  select item_name_snapshot into v_txt from sales_invoice_items
   where invoice_id = v_inv and item_id = v_consult;
  if v_txt <> 'كشف' then
    raise exception 'فشل: اسم البند تغيّر بتغيّر الكتالوج (%)', v_txt;
  end if;
  raise notice '✅ ٣) اسم الخدمة وسعرها مجمَّدان على البند وقت البيع';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) المصدر لا يُفوتَر مرّتين
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_create_invoice_from_visit(v_visit, false);
    raise exception 'فشل: أُنشئت فاتورة ثانية للخدمات نفسها';
  exception when others then
    if sqlerrm not like '%غير مفوترة%' then raise; end if;
    raise notice '✅ ٤) الخدمة المفوترة لا تدخل فاتورة ثانية';
  end;

  -- ولا بإدراج مباشر
  begin
    insert into sales_invoice_items (invoice_id, item_id, price, qty, net_amount,
                                     source_type, source_id)
    select v_inv, v_consult, 300, 1, 300, 'visit_service', s.id
      from patient_visit_services s where s.visit_id = v_visit and s.item_id = v_consult;
    raise exception 'فشل: أُدرج بند لمصدر مفوتَر';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    raise notice '✅ ٥) الإدراج المباشر لمصدر مفوتَر مرفوض في المحرّك';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الخصم بسبب وصلاحية، وعلى المسوّدة وحدها
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_apply_invoice_discount(v_inv, 50, '  ');
    raise exception 'فشل: مُنح خصم بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;
  perform app_apply_invoice_discount(v_inv, 45, 'عرض ترحيبي');
  select net_amount into v_num from sales_invoices where id = v_inv;
  if v_num <> 400 then raise exception 'فشل: الخصم لم يسرِ (%)', v_num; end if;
  raise notice '✅ ٦) الخصم يحتاج سببًا، ويُسجَّل بمانحه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) لا تحصيل على مسوّدة، والإصدار يحتاج بنودًا
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_receive_invoice_payment(v_inv, 100, v_cash, v_reg);
    raise exception 'فشل: حُصّل على مسوّدة';
  exception when others then
    if sqlerrm not like '%مسوّدة%' then raise; end if;
  end;

  insert into sales_invoices (organization_id, patient_id, invoice_type, status, net_amount)
    values (v_org, v_patient, 'sale', 'draft', 0) returning id into v_inv2;
  begin
    perform app_set_invoice_status(v_inv2, 'unpaid');
    raise exception 'فشل: صدرت فاتورة بلا بنود';
  exception when others then
    if sqlerrm not like '%بلا بنود%' then raise; end if;
    raise notice '✅ ٧) لا تحصيل على مسوّدة، ولا إصدار لفاتورة فارغة';
  end;

  perform app_set_invoice_status(v_inv, 'unpaid');
  if (select issued_at from sales_invoices where id = v_inv) is null then
    raise exception 'فشل: وقت الإصدار لم يُختم';
  end if;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الفاتورة الصادرة لا تُعدَّل
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update sales_invoices set net_amount = 10 where id = v_inv;
    raise exception 'فشل: عُدِّل مبلغ فاتورة صادرة';
  exception when others then
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
  end;
  begin
    update sales_invoice_items set price = 1 where invoice_id = v_inv;
    raise exception 'فشل: عُدِّل بند فاتورة صادرة';
  exception when others then
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
    raise notice '✅ ٨) الفاتورة الصادرة وبنودها لا تُعدَّل';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) النقد يحتاج مناوبة مفتوحة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_receive_invoice_payment(v_inv, 100, v_cash, v_reg);
    raise exception 'فشل: قُبض نقدًا بلا مناوبة مفتوحة';
  exception when others then
    if sqlerrm not like '%مناوبة مفتوحة%' then raise; end if;
    raise notice '✅ ٩) لا قبض نقديّ بلا مناوبة صندوق مفتوحة';
  end;

  v_shift := app_open_cash_shift(v_reg, 500, 'مناوبة الصباح');

  -- ولا مناوبتان
  begin
    perform app_open_cash_shift(v_reg, 0);
    raise exception 'فشل: فُتحت مناوبتان على صندوق واحد';
  exception when others then
    if sqlerrm not like '%مناوبة مفتوحة بالفعل%' then raise; end if;
    raise notice '✅ ١٠) مناوبة مفتوحة واحدة لكل صندوق';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الدفع الجزئي ثم المتبقّي، وحالتان تتغيّران
  -- ═════════════════════════════════════════════════════════════════════════
  v_v1 := app_receive_invoice_payment(v_inv, 150, v_cash, v_reg, null, 'دفعة أولى');
  if (select status from sales_invoices where id = v_inv) <> 'partial' then
    raise exception 'فشل: الفاتورة لم تُعلَّم مسدَّدة جزئيًا';
  end if;
  if (select remaining_amount from sales_invoices where id = v_inv) <> 250 then
    raise exception 'فشل: المتبقّي % لا ٢٥٠',
      (select remaining_amount from sales_invoices where id = v_inv);
  end if;

  -- دفع مختلط: الباقي بتحويل بنكي
  v_v2 := app_receive_invoice_payment(v_inv, 250, v_bank, null, 'TRF-99');
  if (select status from sales_invoices where id = v_inv) <> 'paid' then
    raise exception 'فشل: الفاتورة لم تُعلَّم مدفوعة بعد سداد كامل';
  end if;
  select count(*) into v_int from voucher_invoice_allocations where sales_invoice_id = v_inv;
  if v_int <> 2 then raise exception 'فشل: عدد السندات % لا اثنان', v_int; end if;
  raise notice '✅ ١١) دفع جزئي ثم مختلط بسندين، والحالة تتبع المبلغ';

  -- خدمات الفاتورة صارت مدفوعة
  select count(*) into v_int from patient_visit_services
   where visit_id = v_visit and status = 'paid';
  if v_int <> 2 then
    raise exception 'فشل: % خدمة فقط انتقلت إلى مدفوعة', v_int;
  end if;
  raise notice '✅ ١٢) سداد الفاتورة ينقل خدمات الزيارة إلى «مدفوعة»';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) لا دفع فوق المستحق
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_receive_invoice_payment(v_inv, 1, v_bank);
    raise exception 'فشل: قُبض مبلغ فوق المستحق';
  exception when others then
    if sqlerrm not like '%يتجاوز المتبقّي%' then raise; end if;
  end;

  -- ولا بإدراج توزيع مباشر
  begin
    insert into voucher_invoice_allocations (voucher_id, sales_invoice_id, amount)
      values (v_v1, v_inv, 9999);
    raise exception 'فشل: أُدرج توزيع يتجاوز قيمة الفاتورة';
  exception when others then
    if sqlerrm not like '%يتجاوز المستحق%' then raise; end if;
    raise notice '✅ ١٣) لا دفعة تتجاوز المستحق — لا من الدالة ولا بإدراج مباشر';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الرصيد المتوقّع يعدّ النقد وحده
  -- ═════════════════════════════════════════════════════════════════════════
  v_num := app_cash_shift_expected(v_shift);
  if v_num <> 650 then
    raise exception 'فشل: الرصيد المتوقّع % لا ٦٥٠ (٥٠٠ افتتاحي + ١٥٠ نقدًا)', v_num;
  end if;
  raise notice '✅ ١٤) الرصيد المتوقّع يحسب النقد فقط — التحويل البنكي لا يدخل الدرج';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) الاسترداد: لا يتجاوز المحصَّل، ويحتاج سببًا
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_refund_invoice_payment(v_inv, 100, '');
    raise exception 'فشل: استُردّ بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;
  begin
    perform app_refund_invoice_payment(v_inv, 9999, 'محاولة');
    raise exception 'فشل: استُردّ أكثر من المحصَّل';
  exception when others then
    if sqlerrm not like '%يتجاوز القابل للاسترداد%' then raise; end if;
    raise notice '✅ ١٥) لا استرداد بلا سبب، ولا بأكثر من المحصَّل';
  end;

  perform app_refund_invoice_payment(v_inv, 100, 'خدمة لم تُنفَّذ', v_reg);
  if (select status from sales_invoices where id = v_inv) <> 'partially_refunded' then
    raise exception 'فشل: الفاتورة لم تُعلَّم مستردّة جزئيًا (%)',
      (select status from sales_invoices where id = v_inv);
  end if;
  if (select refunded_amount from sales_invoices where id = v_inv) <> 100 then
    raise exception 'فشل: مبلغ الاسترداد لم يُسجَّل';
  end if;
  raise notice '✅ ١٦) الاسترداد يُسجَّل بسنده ويغيّر حالة الفاتورة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 17) السند لا يُحذف، والإلغاء يُعيد الحساب
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from financial_vouchers where id = v_v2;
    raise exception 'فشل: حُذف سند مالي';
  exception when others then
    if sqlerrm not like '%لا تُحذف%' then raise; end if;
    raise notice '✅ ١٧) السندات المالية لا تُحذف';
  end;

  -- المقبوض ٤٠٠ (١٥٠ نقدًا + ٢٥٠ تحويلًا)، استُردّ منه ١٠٠، ثم أُلغي سند
  -- التحويل. فالصافي = ١٥٠ − ١٠٠ = ٥٠.
  perform app_void_financial_voucher(v_v2, 'تحويل لم يصل');
  if (select paid_amount from sales_invoices where id = v_inv) <> 50 then
    raise exception 'فشل: إلغاء السند لم يُعِد الحساب (%)',
      (select paid_amount from sales_invoices where id = v_inv);
  end if;
  if (select remaining_amount from sales_invoices where id = v_inv) <> 350 then
    raise exception 'فشل: المتبقّي بعد الإلغاء % لا ٣٥٠',
      (select remaining_amount from sales_invoices where id = v_inv);
  end if;
  raise notice '✅ ١٨) إلغاء السند يُعيد حساب الفاتورة وصافي المحصَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 19) الفاتورة الملغاة لا تعود حيّة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_inv3 uuid; v_v3 uuid; v_s3 uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                                visit_date, status)
      values (v_org, v_patient, v_doctor, v_branch, current_date, 'in_progress')
      returning id into v_s3;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_s3, v_consult, 1, 200, 'performed');
    v_inv3 := app_create_invoice_from_visit(v_s3, false);
    perform app_set_invoice_status(v_inv3, 'unpaid');
    v_v3 := app_receive_invoice_payment(v_inv3, 50, v_cash, v_reg);

    -- لا إلغاء وعليها محصَّل
    begin
      perform app_set_invoice_status(v_inv3, 'void', 'خطأ');
      raise exception 'فشل: أُلغيت فاتورة عليها مبلغ محصَّل';
    exception when others then
      if sqlerrm not like '%محصَّل%' then raise; end if;
    end;

    perform app_refund_invoice_payment(v_inv3, 50, 'إلغاء الفاتورة', v_reg);
    perform app_void_financial_voucher(v_v3, 'إلغاء');
    perform app_set_invoice_status(v_inv3, 'void', 'أُنشئت بالخطأ');

    -- الآن: إعادة الحساب لا تُحييها
    perform app_recalc_invoice_paid_amount(v_inv3);
    if (select status from sales_invoices where id = v_inv3) <> 'void' then
      raise exception 'فشل: إعادة الحساب أحيت فاتورة ملغاة (%)',
        (select status from sales_invoices where id = v_inv3);
    end if;

    -- وخدمتها عادت قابلة للفوترة
    if (select status from patient_visit_services where visit_id = v_s3) <> 'performed' then
      raise exception 'فشل: خدمة الفاتورة الملغاة بقيت «مفوترة» فلا تُفوتَر أبدًا';
    end if;
  end;
  raise notice '✅ ١٩) الفاتورة الملغاة لا تعود حيّة، وخدمتها تعود قابلة للفوترة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 20) إغلاق المناوبة: جرد إلزاميّ، وفرق بسببه
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_close_cash_shift(v_shift, null);
    raise exception 'فشل: أُغلقت مناوبة بلا جرد';
  exception when others then
    if sqlerrm not like '%المجرود مطلوب%' then raise; end if;
  end;

  v_num := app_cash_shift_expected(v_shift);
  begin
    perform app_close_cash_shift(v_shift, v_num - 20);
    raise exception 'فشل: أُغلقت مناوبة بفرق بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ ٢٠) الإغلاق يحتاج جردًا، والفرق يحتاج سببًا';
  end;

  v_json := app_close_cash_shift(v_shift, v_num - 20, 'عجز — قيد المراجعة');
  if (v_json->>'variance')::numeric <> -20 then
    raise exception 'فشل: الفرق % لا −٢٠', v_json->>'variance';
  end if;

  -- والسند في مناوبة مغلقة لا يُلغى
  begin
    perform app_void_financial_voucher(v_v1, 'محاولة');
    raise exception 'فشل: أُلغي سند في مناوبة مغلقة';
  exception when others then
    if sqlerrm not like '%مناوبة مغلقة%' then raise; end if;
    raise notice '✅ ٢١) سند المناوبة المغلقة لا يُلغى — التصحيح بسند عكسي';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 22) من أغلق لا يعتمد
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_approve_cash_shift(v_shift);
    raise exception 'فشل: اعتمد المناوبةَ من أغلقها';
  exception when others then
    if sqlerrm not like '%لا يعتمدها%' then raise; end if;
    raise notice '✅ ٢٢) من أغلق المناوبة لا يعتمدها — فصل التنفيذ عن المراجعة';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 23) المناظير
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_invoice_register where id = v_inv and lines_count = 2) then
    raise exception 'فشل: سجل الفواتير لا يعرض الفاتورة ببنودها';
  end if;
  select balance_due into v_num from v_patient_balance where patient_id = v_patient;
  if v_num is null then raise exception 'فشل: ذمّة المريض لا تُحسب'; end if;
  if not exists (select 1 from v_cash_shift_summary
                  where id = v_shift and total_receipts > 0) then
    raise exception 'فشل: ملخّص المناوبة لا يعرض مقبوضاتها';
  end if;
  raise notice '✅ ٢٣) سجل الفواتير وذمّة المريض وملخّص المناوبة تعمل';

  raise notice '——— كل فحوص منطق الفوترة نجحت ———';
end $$;

-- ---------------------------------------------------------------------------
-- الصلاحيات — خارج كتلة DO لأن RLS لا تسري على المالك
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_owner uuid; v_recep uuid; v_pat uuid; v_doc uuid;
  v_item uuid; v_visit uuid; v_inv uuid; v_reg uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'bl2-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'bl2-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة صلاحيات الفوترة', 'clinic', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);

  insert into patients (organization_id, name_ar) values (v_org, 'مريض') returning id into v_pat;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب') returning id into v_doc;
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'S', 'خدمة', 100) returning id into v_item;
  insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
    values (v_org, v_pat, v_doc, current_date, 'in_progress') returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_item, 1, 100, 'performed');
  v_inv := app_create_invoice_from_visit(v_visit, false);
  perform app_set_invoice_status(v_inv, 'unpaid');
  insert into cash_registers (organization_id, name) values (v_org, 'صندوق')
    returning id into v_reg;

  perform set_config('app.bl_org',   v_org::text,   false);
  perform set_config('app.bl_recep', v_recep::text, false);
  perform set_config('app.bl_inv',   v_inv::text,   false);
  perform set_config('app.bl_reg',   v_reg::text,   false);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.bl_recep'), true);

do $$
begin
  -- الاستقبال يحصّل
  if app_receive_invoice_payment(
       current_setting('app.bl_inv')::uuid, 10,
       (select lv.id from lookup_values lv join lookup_categories c on c.id = lv.category_id
         where c.key = 'payment_methods' and lv.code = 'bank_transfer' limit 1)) is null then
    raise exception 'فشل: موظف الاستقبال لم يستطع التحصيل';
  end if;
  raise notice '✅ موظف الاستقبال يحصّل';

  -- ولا يستردّ
  begin
    perform app_refund_invoice_payment(current_setting('app.bl_inv')::uuid, 5, 'محاولة');
    raise exception 'فشل: موظف الاستقبال نفّذ استردادًا';
  exception when others then
    if sqlerrm not like '%billing.refund%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا يستردّ';
  end;

  -- ولا يمنح خصمًا
  begin
    perform app_apply_invoice_discount(current_setting('app.bl_inv')::uuid, 5, 'محاولة');
    raise exception 'فشل: موظف الاستقبال منح خصمًا';
  exception when others then
    if sqlerrm not like '%billing.discount%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا يمنح خصمًا';
  end;

  -- ولا يلغي فاتورة
  begin
    perform app_set_invoice_status(current_setting('app.bl_inv')::uuid, 'void', 'محاولة');
    raise exception 'فشل: موظف الاستقبال ألغى فاتورة';
  exception when others then
    if sqlerrm not like '%billing.void%' then raise; end if;
    raise notice '✅ موظف الاستقبال لا يلغي الفواتير';
  end;

  raise notice '——— كل فحوص صلاحيات الفوترة نجحت ———';
end $$;

reset role;

rollback;
