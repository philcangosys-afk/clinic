-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات العروض والخدمات المجانية وخصم السطر وفاتورة الطبيب — 0167..0170
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/offers-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لماذا هذا الملفّ ولو نجحت اختبارات البناء؟** اختبارات الجولة جرت على
-- جداول مُصغَّرة، وهي تُثبت المنطق ولا تُثبت أنّه يعمل فوق المخطّط الحقيقيّ
-- بقيوده ومُحفِّزاته كلّها. وأربعةُ أعمالٍ من هذه الجولة ترقيعُ نصٍّ لدالّتين
-- قائمتين — والترقيع يُصيب المربط أو يُخطئه، ولا يُعرف أيّهما إلّا فوق النصّ
-- الحقيقيّ المخزَّن في القاعدة.
--
-- وأهمّ ما فيه ثلاثة فحوص:
--   • أنّ حدّي السعر **يُحفظان فعلًا** عبر `app_save_service` — وهو ما كان
--     يُهمَل بصمت حتى القسم السابع من 0167.
--   • أنّ سعر العرض **يُطبَّق في القاعدة** ولو أرسل العميل سعر القائمة.
--   • أنّ الطبيب يُصدر لمريضه ولا يقبض مالًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner    uuid;
  v_docuser  uuid;
  v_org      uuid;
  v_branch   uuid;
  v_doctor   uuid;
  v_doctor2  uuid;
  v_patient  uuid;
  v_other    uuid;
  v_svc      uuid;   -- خدمة بعرض: 200 ← 149
  v_free     uuid;   -- خدمة تُمنَح مجانًا: 300
  v_bound    uuid;   -- خدمة بحدّ أدنى 90: 100
  v_inv      uuid;
  v_num      numeric;
  v_num2     numeric;
  v_txt      text;
  v_bool     boolean;
  v_by       uuid;
  v_ret      uuid;
  v_chk      uuid;
begin
  -- ── التهيئة ──────────────────────────────────────────────────────────────
  insert into auth.users (id, email) values (gen_random_uuid(), 'offers-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'offers-doctor@test.local')
    returning id into v_docuser;

  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار العروض', 'medical_center', v_owner, 15)
    returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_owner, 'owner', true)
    on conflict do nothing;
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_docuser, 'doctor', true)
    on conflict do nothing;

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into doctors (organization_id, name_ar, user_id)
    values (v_org, 'د. العروض', v_docuser) returning id into v_doctor;
  insert into doctors (organization_id, name_ar)
    values (v_org, 'د. آخر') returning id into v_doctor2;
  insert into patients (organization_id, name_ar, id_number, treating_doctor_id)
    values (v_org, 'مريض العروض', '1010101011', v_doctor) returning id into v_patient;
  insert into patients (organization_id, name_ar)
    values (v_org, 'مريض طبيبٍ آخر') returning id into v_other;

  -- ══ ١) الحدّان يُحفظان فعلًا عبر `app_save_service` ══════════════════════
  --
  -- العيب الذي أُصلح في القسم السابع من 0167: الدالّة تُسمّي أعمدتها صراحةً
  -- ولم يكن العمودان فيها، فالقيمة تُرسَل وتُهمَل — ومُحفِّز 0159 لا يُفعَّل
  -- قطّ لأنّ `min_price` تبقى NULL أبدًا.
  v_bound := app_save_service(v_org, null, jsonb_build_object(
    'name_ar', 'حشوة الاختبار', 'code', 'OFF-BND', 'item_type', 'service',
    'medical_service_type', 'consultation',
    'price', '100', 'min_price', '90', 'max_price', '130'));

  select min_price, max_price into v_num, v_num2 from items where id = v_bound;
  if v_num is distinct from 90 then
    raise exception 'FAIL ١: الحدّ الأدنى لم يُحفَظ (%) — app_save_service لا تكتبه', v_num;
  end if;
  raise notice 'PASS ١: الحدّان يُحفظان عبر app_save_service (أدنى %)', v_num;

  -- والإذن بالمجانيّ كذلك
  v_free := app_save_service(v_org, null, jsonb_build_object(
    'name_ar', 'جلسة الاختبار', 'code', 'OFF-FREE', 'item_type', 'service',
    'medical_service_type', 'consultation', 'price', '300',
    'allow_complimentary', true, 'complimentary_note', 'الخامسة بعد أربع مدفوعة'));
  select allow_complimentary into v_bool from items where id = v_free;
  if not coalesce(v_bool, false) then
    raise exception 'FAIL ٢: الإذن بالمنح مجانًا لم يُحفَظ';
  end if;
  raise notice 'PASS ٢: الإذن بالمنح مجانًا يُحفَظ';

  v_svc := app_save_service(v_org, null, jsonb_build_object(
    'name_ar', 'تنظيف الاختبار', 'code', 'OFF-SVC', 'item_type', 'service',
    'medical_service_type', 'consultation', 'price', '200'));

  -- ══ ٢) عرضٌ تحت الحدّ الأدنى مرفوض ══════════════════════════════════════
  begin
    insert into item_offers (organization_id, item_id, title, offer_price,
                             list_price_at_creation, start_date, end_date)
    values (v_org, v_bound, 'عرض تحت الحدّ', 50, 100, current_date, current_date + 5);
    raise exception 'FAIL ٣: عرضٌ تحت الحدّ الأدنى قُبل';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%الحدّ الأدنى%' then
      raise exception 'FAIL ٣: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ٣: عرضٌ تحت الحدّ الأدنى مرفوض';
  end;

  -- ══ ٣) عرضان متداخلان مرفوضان ═══════════════════════════════════════════
  insert into item_offers (organization_id, item_id, title, offer_price,
                           list_price_at_creation, show_before_after, start_date, end_date)
  values (v_org, v_svc, 'اليوم الوطني', 149, 200, true, current_date - 1, current_date + 10);

  begin
    insert into item_offers (organization_id, item_id, title, offer_price,
                             list_price_at_creation, start_date, end_date)
    values (v_org, v_svc, 'عرضٌ متداخل', 160, 200, current_date, current_date + 3);
    raise exception 'FAIL ٤: عرضان متداخلان قُبلا';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%يتقاطع%' then
      raise exception 'FAIL ٤: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ٤: عرضان متداخلان مرفوضان';
  end;

  -- ══ ٤) السعر الساري من الدالّة ══════════════════════════════════════════
  select effective_price, offer_title into v_num, v_txt
    from app_item_effective_price(v_org, v_svc, current_date);
  if v_num is distinct from 149 then
    raise exception 'FAIL ٥: السعر الساري % لا 149', v_num;
  end if;
  raise notice 'PASS ٥: السعر الساري من العرض «%» = %', v_txt, v_num;

  -- ══ ٥) العرض يُطبَّق في القاعدة ولو أرسل العميل سعر القائمة ═════════════
  v_inv := app_create_sales_invoice(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_svc, 'qty', 1, 'price', 200)),
    v_patient);

  select price into v_num from sales_invoice_items where invoice_id = v_inv;
  if v_num is distinct from 149 then
    raise exception 'FAIL ٦: العميل أرسل 200 والمحفوظ % — العرض لم يُطبَّق في القاعدة', v_num;
  end if;
  raise notice 'PASS ٦: العرض طُبِّق في القاعدة رغم إرسال سعر القائمة';

  -- ══ ٦) المرتجع يُعيد ما فُوتر لا سعر اليوم ══════════════════════════════
  begin
    v_ret := app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object('item_id', v_svc, 'qty', 1, 'price', 200)),
      v_patient, null, null, null, null, null, null, 'return', v_inv);
    select price into v_num from sales_invoice_items where invoice_id = v_ret;
    if v_num is distinct from 200 then
      raise exception 'FAIL ٧: المرتجع أخذ سعر العرض (%) بدل ما فُوتر', v_num;
    end if;
    raise notice 'PASS ٧: المرتجع يُعيد ما فُوتر لا سعر اليوم';
  end;

  -- ══ ٧) الخصم بمبلغٍ وسببه ومانحه ════════════════════════════════════════
  v_inv := app_create_sales_invoice(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_bound, 'qty', 1, 'price', 100,
      'discount_amount', 10, 'discount_reason', 'قرار المدير')),
    v_patient);

  select discount_amount, discount_reason, discount_granted_by
    into v_num, v_txt, v_by
    from sales_invoice_items where invoice_id = v_inv;
  if v_by is distinct from v_owner then
    raise exception 'FAIL ٨: مانح الخصم لم يُسجَّل تلقائيًّا';
  end if;
  if v_num is distinct from 10 or v_txt is distinct from 'قرار المدير' then
    raise exception 'FAIL ٨: الخصم % وسببه «%»', v_num, v_txt;
  end if;
  raise notice 'PASS ٨: الخصم بمبلغ 10 وسببه ومانحه مسجَّلون';

  -- ══ ٨) خصمٌ بلا سبب مرفوض ═══════════════════════════════════════════════
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_bound, 'qty', 1, 'price', 100, 'discount_amount', 5)),
      v_patient);
    raise exception 'FAIL ٩: خصمٌ بلا سبب قُبل';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%سبب الخصم%' then
      raise exception 'FAIL ٩: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ٩: خصمٌ بلا سبب مرفوض';
  end;

  -- ══ ٩) خصمٌ يهبط تحت الحدّ الأدنى مرفوض ═════════════════════════════════
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_bound, 'qty', 1, 'price', 100,
        'discount_amount', 25, 'discount_reason', 'خصم كبير')),
      v_patient);
    raise exception 'FAIL ١٠: خصمٌ يُنزل الوحدة إلى 75 وحدّها 90 قُبل';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%يُنزل%' then
      raise exception 'FAIL ١٠: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٠: الحدّ الأدنى يُفرض على الصافي بعد الخصم';
  end;

  -- ══ ١٠) النسبة وقيمتها بالريال لا تُحاسَبان مرّتين ══════════════════════
  --
  -- 0160 تكتب `discount_percent` **و**قيمتها في `discount_amount` للسطر
  -- الواحد. وطرحُهما معًا يُنقص ضعف الخصم فيُرفَض سطرٌ مشروع.
  v_inv := app_create_sales_invoice(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_bound, 'qty', 1, 'price', 100,
      'discount_percent', 9, 'discount_reason', 'خصم بنسبة')),
    v_patient);
  select discount_amount into v_num from sales_invoice_items where invoice_id = v_inv;
  if v_num is distinct from 9 then
    raise exception 'FAIL ١١: الخصم المحفوظ % لا 9', v_num;
  end if;
  raise notice 'PASS ١١: نسبةٌ 9%% على 100 مرَّت — لا محاسبة مزدوجة';

  -- ══ ١١) المجانيّ: إباحةٌ وسببٌ وأصفار ═══════════════════════════════════
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_bound, 'qty', 1, 'price', 100,
        'is_complimentary', true, 'complimentary_reason', 'بلا إباحة')),
      v_patient);
    raise exception 'FAIL ١٢: منح خدمة غير مؤشَّرة قُبل';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%مجانًا%' then
      raise exception 'FAIL ١٢: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٢: منح خدمة غير مؤشَّرة مرفوض';
  end;

  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_free, 'qty', 1, 'price', 300, 'is_complimentary', true)),
      v_patient);
    raise exception 'FAIL ١٣: مجانيّ بلا سبب قُبل';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS ١٣: مجانيّ بلا سبب مرفوض';
  end;

  v_inv := app_create_sales_invoice(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_free, 'qty', 1, 'price', 300,
      'is_complimentary', true, 'complimentary_reason', 'الجلسة الخامسة')),
    v_patient);
  select price + net_amount + vat_amount into v_num
    from sales_invoice_items where invoice_id = v_inv;
  if v_num is distinct from 0 then
    raise exception 'FAIL ١٤: السطر المجانيّ ليس بأصفار (مجموع الثلاثة %)', v_num;
  end if;
  select net_amount into v_num from sales_invoices where id = v_inv;
  if v_num is distinct from 0 then
    raise exception 'FAIL ١٤: رأس الفاتورة المجانية %', v_num;
  end if;
  raise notice 'PASS ١٤: المجانيّ بأصفارٍ محسوبةٍ في القاعدة، والرأس بصفر';

  select forgone_value into v_num from v_complimentary_lines
   where invoice_id = v_inv limit 1;
  if v_num is distinct from 300 then
    raise exception 'FAIL ١٥: قيمة التنازل % لا 300 (سعر القائمة)', v_num;
  end if;
  raise notice 'PASS ١٥: قيمة التنازل بسعر القائمة لا بصفر السطر';

  -- ══ ١٢) فاتورة الطبيب ═══════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_docuser::text, true);

  -- (أ) بلا الصلاحية مرفوض
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object('item_id', v_bound, 'qty', 1, 'price', 100)),
      v_patient);
    raise exception 'FAIL ١٦: الطبيب بلا `billing.doctor_invoice` أصدر فاتورة';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%لا تسمح بإصدار الفواتير%' then
      raise exception 'FAIL ١٦: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٦: الطبيب بلا الصلاحية مرفوض';
  end;

  -- تُمنح الصلاحية صراحةً لهذا الطبيب
  insert into membership_permissions (organization_id, user_id, permission_key, granted)
  values (v_org, v_docuser, 'billing.doctor_invoice', true)
  on conflict (organization_id, user_id, permission_key)
    do update set granted = true;

  -- (ب) مريضٌ ليس من مرضاه مرفوض
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object('item_id', v_bound, 'qty', 1, 'price', 100)),
      v_other);
    raise exception 'FAIL ١٧: الطبيب فوَّتر مريضًا ليس من مرضاه';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%ليس من مرضاك%' then
      raise exception 'FAIL ١٧: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٧: مريضٌ ليس من مرضاه مرفوض';
  end;

  -- (ج) باسم طبيبٍ آخر مرفوض
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object('item_id', v_bound, 'qty', 1, 'price', 100)),
      v_patient, null, null, null, v_doctor2);
    raise exception 'FAIL ١٨: الطبيب أصدر باسم طبيبٍ آخر';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%طبيبٍ آخر%' then
      raise exception 'FAIL ١٨: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٨: الإصدار باسم طبيبٍ آخر مرفوض';
  end;

  -- (د) لا يقبض مالًا
  begin
    perform app_create_sales_invoice(
      v_org,
      jsonb_build_array(jsonb_build_object('item_id', v_bound, 'qty', 1, 'price', 100)),
      v_patient, null, null, null, null, null, null, 'sale', null, false,
      '{}'::jsonb, 0, false, false, null, null, null, null, null,
      jsonb_build_array(jsonb_build_object('amount', 50)));
    raise exception 'FAIL ١٩: الطبيب قبض مالًا';
  exception when others then
    if sqlerrm like 'FAIL%' then raise;
    elsif sqlerrm not like '%لا يُحصّلها%' then
      raise exception 'FAIL ١٩: رُفض لسببٍ آخر: %', sqlerrm;
    end if;
    raise notice 'PASS ١٩: التحصيل من الاستقبال لا من غرفة الطبيب';
  end;

  -- (هـ) يُصدر لمريضه بخصمٍ مسبَّب، والاستقبال يراه
  v_inv := app_create_sales_invoice(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_bound, 'qty', 1, 'price', 100,
      'discount_amount', 10, 'discount_reason', 'قرار الطبيب')),
    v_patient);

  select doctor_id into v_chk from sales_invoices where id = v_inv;
  if v_chk is distinct from v_doctor then
    raise exception 'FAIL ٢٠: الفاتورة ليست باسم الطبيب المُصدِر';
  end if;

  select gross_amount, discount_total, discount_reasons
    into v_num, v_num2, v_txt
    from v_doctor_issued_invoices where id = v_inv;
  if v_num is distinct from 100 or v_num2 is distinct from 10
     or v_txt is distinct from 'قرار الطبيب' then
    raise exception 'FAIL ٢٠: منظور الاستقبال: مُعلَن % خصم % سبب «%»', v_num, v_num2, v_txt;
  end if;
  raise notice 'PASS ٢٠: الطبيب أصدر لمريضه، والاستقبال يرى المُعلَن والمخصوم وسببه';

  raise notice '════════ كل اختبارات 0167..0170 نجحت ════════';
end $$;

rollback;
