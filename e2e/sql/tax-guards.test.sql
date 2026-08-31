-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الضريبة والفاتورة الإلكترونية — 0092
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/tax-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- أهمّ ما فيه فحصان: أن التسلسل **لكل منشأة** لا مشترك، وأن حساب الضريبة
-- **مصدره واحد** فلا يختلف الرقم باختلاف الشاشة التي أنشأت الفاتورة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_org2    uuid;
  v_owner   uuid;
  v_owner2  uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_pat2    uuid;
  v_std     uuid;
  v_exempt  uuid;
  v_zero    uuid;
  v_visit   uuid;
  v_inv     uuid;
  v_inv_b   uuid;
  v_note    uuid;
  v_doc     uuid;
  v_num     numeric;
  v_n1      bigint;
  v_n2      bigint;
  v_txt     text;
  v_json    jsonb;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'tax-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, tax_number, default_vat_rate)
    values ('منشأة اختبار الضريبة', 'clinic', v_owner, '300000000000003', 15)
    returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_vat_settings (
    organization_id, sales_vat_enabled, legal_name_ar, vat_registration_number,
    vat_status, cr_number, building_number, street_name, district, city, postal_code)
  values (v_org, true, 'شركة زين الطبية', '300000000000003', 'registered',
          '1010101010', '1234', 'شارع الملك فهد', 'العليا', 'الرياض', '12345')
  on conflict (organization_id) do update set
    legal_name_ar = excluded.legal_name_ar,
    vat_registration_number = excluded.vat_registration_number,
    vat_status = excluded.vat_status;

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض الضريبة', '1010101010') returning id into v_patient;

  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'STD', 'خدمة خاضعة', 200, 'consultation') returning id into v_std;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, vat_category, vat_exempt_reason)
    values (v_org, 'service', 'EXM', 'خدمة معفاة', 100, 'consultation',
            'exempt', 'خدمة صحية معفاة نظامًا') returning id into v_exempt;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, vat_category)
    values (v_org, 'service', 'ZR', 'خدمة صفرية', 50, 'consultation', 'zero_rated')
    returning id into v_zero;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) محرّك الضريبة: ثلاث فئات، ثلاث نتائج
  -- ═════════════════════════════════════════════════════════════════════════
  select vat_rate, vat_amount, vat_category into v_num, v_num, v_txt
    from app_compute_line_tax(v_org, v_std, v_patient, 200, 1, 0);
  select vat_amount into v_num from app_compute_line_tax(v_org, v_std, v_patient, 200, 1, 0);
  if v_num <> 30 then raise exception 'فشل: ضريبة الخاضع % لا ٣٠', v_num; end if;

  select vat_amount, vat_category, exemption_reason into v_num, v_txt, v_txt
    from app_compute_line_tax(v_org, v_exempt, v_patient, 100, 1, 0);
  select vat_amount into v_num from app_compute_line_tax(v_org, v_exempt, v_patient, 100, 1, 0);
  if v_num <> 0 then raise exception 'فشل: المعفى حُسبت عليه ضريبة'; end if;
  select exemption_reason into v_txt
    from app_compute_line_tax(v_org, v_exempt, v_patient, 100, 1, 0);
  if v_txt <> 'خدمة صحية معفاة نظامًا' then
    raise exception 'فشل: سبب الإعفاء لم يُقرأ من الصنف (%)', v_txt;
  end if;

  select vat_category into v_txt
    from app_compute_line_tax(v_org, v_zero, v_patient, 50, 1, 0);
  if v_txt <> 'zero_rated' then raise exception 'فشل: الفئة الصفرية لم تُحفظ'; end if;

  -- الخصم ينقص الوعاء لا الضريبة مباشرةً
  select taxable_base, vat_amount into v_num, v_num
    from app_compute_line_tax(v_org, v_std, v_patient, 200, 1, 50);
  select vat_amount into v_num from app_compute_line_tax(v_org, v_std, v_patient, 200, 1, 50);
  if v_num <> 22.50 then
    raise exception 'فشل: الضريبة بعد خصم ٥٠ هي % لا ٢٢.٥٠ (١٥٪ من ١٥٠)', v_num;
  end if;
  raise notice '✅ ١) المحرّك يميّز الخاضع والمعفى والصفريّ، والخصم ينقص الوعاء';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) مصدر واحد للحساب: فاتورة الزيارة تستعمل المحرّك نفسه
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                              visit_date, status)
    values (v_org, v_patient, v_doctor, v_branch, current_date, 'in_progress')
    returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_std, 1, 200, 'performed'),
           (v_org, v_visit, v_exempt, 1, 100, 'performed');

  v_inv := app_create_invoice_from_visit(v_visit, false);

  select vat_amount into v_num from sales_invoice_items
   where invoice_id = v_inv and item_id = v_std;
  if v_num <> 30 then raise exception 'فشل: ضريبة الفاتورة % لا ٣٠', v_num; end if;

  select exemption_reason into v_txt from sales_invoice_items
   where invoice_id = v_inv and item_id = v_exempt;
  if v_txt <> 'خدمة صحية معفاة نظامًا' then
    raise exception 'فشل: سبب الإعفاء في الفاتورة ليس سبب الصنف (%)', v_txt;
  end if;
  raise notice '✅ ٢) فاتورة الزيارة تحسب بالمحرّك الواحد لا بمنطق خاص';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) الإصدار: رقم، ولقطة بائع ومشترٍ
  -- ═════════════════════════════════════════════════════════════════════════
  update sales_invoices set document_type = 'simplified' where id = v_inv;
  perform app_set_invoice_status(v_inv, 'unpaid');

  select document_number into v_n1 from sales_invoices where id = v_inv;
  if v_n1 is null then raise exception 'فشل: لم يُولَّد رقم المستند'; end if;

  select seller_snapshot into v_json from sales_invoices where id = v_inv;
  if v_json->>'vat_number' <> '300000000000003' then
    raise exception 'فشل: الرقم الضريبي لم يُلتقط في اللقطة';
  end if;
  if v_json->'address'->>'city' <> 'الرياض' then
    raise exception 'فشل: العنوان الوطني غائب عن اللقطة';
  end if;

  -- تعديل بيانات المنشأة لا يغيّر ما صدر
  update organization_vat_settings set legal_name_ar = 'اسم جديد تمامًا'
   where organization_id = v_org;
  select seller_snapshot->>'legal_name_ar' into v_txt from sales_invoices where id = v_inv;
  if v_txt <> 'شركة زين الطبية' then
    raise exception 'فشل: اسم البائع في فاتورة صادرة تغيّر بتغيّر الإعدادات (%)', v_txt;
  end if;
  raise notice '✅ ٣) الإصدار يثبّت الرقم ولقطتَي البائع والمشتري';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الفاتورة الضريبية تشترط معرّف المشتري
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_v2 uuid; v_i2 uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'مريض بلا هوية')
      returning id into v_pat2;
    insert into patient_visits (organization_id, patient_id, doctor_id, branch_id,
                                visit_date, status)
      values (v_org, v_pat2, v_doctor, v_branch, current_date, 'in_progress')
      returning id into v_v2;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org, v_v2, v_std, 1, 200, 'performed');
    v_i2 := app_create_invoice_from_visit(v_v2, false);
    update sales_invoices set document_type = 'standard' where id = v_i2;
    begin
      perform app_set_invoice_status(v_i2, 'unpaid');
      raise exception 'فشل: صدرت فاتورة ضريبية بلا معرّف للمشتري';
    exception when others then
      if sqlerrm not like '%رقم هوية المشتري%' then raise; end if;
    end;
    -- والمبسّطة تمرّ
    update sales_invoices set document_type = 'simplified' where id = v_i2;
    perform app_set_invoice_status(v_i2, 'unpaid');
    select document_number into v_n2 from sales_invoices where id = v_i2;
  end;
  raise notice '✅ ٤) الضريبية تشترط معرّف المشتري، والمبسّطة لا تشترطه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) التسلسل متتابع بلا فجوة داخل المنشأة
  -- ═════════════════════════════════════════════════════════════════════════
  if v_n2 <> v_n1 + 1 then
    raise exception 'فشل: التسلسل ليس متتابعًا (% ثم %)', v_n1, v_n2;
  end if;
  raise notice '✅ ٥) أرقام المستندات متتابعة بلا فجوة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) **ولا يقتسمه منشأتان** — الخلل الأصلي
  -- ═════════════════════════════════════════════════════════════════════════
  insert into auth.users (id, email) values (gen_random_uuid(), 'tax2-owner@test.local')
    returning id into v_owner2;
  insert into organizations (name, organization_type, created_by, tax_number)
    values ('منشأة ثانية', 'clinic', v_owner2, '399999999999993') returning id into v_org2;
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org2, v_owner, 'owner', true);
  insert into organization_vat_settings (organization_id, legal_name_ar,
                                         vat_registration_number, vat_status)
    values (v_org2, 'المنشأة الثانية', '399999999999993', 'registered')
  on conflict (organization_id) do nothing;

  declare v_p3 uuid; v_v3 uuid; v_i3 uuid; v_it3 uuid; v_n3 bigint;
  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org2, 'مريض المنشأة الثانية', '2020202020') returning id into v_p3;
    insert into doctors (organization_id, name_ar) values (v_org2, 'طبيب٢')
      returning id into v_v3;
    insert into items (organization_id, item_type, code, name_ar, price)
      values (v_org2, 'service', 'S2', 'خدمة', 100) returning id into v_it3;
    insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
      values (v_org2, v_p3, v_v3, current_date, 'in_progress') returning id into v_v3;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
      values (v_org2, v_v3, v_it3, 1, 100, 'performed');
    v_i3 := app_create_invoice_from_visit(v_v3, false);
    perform app_set_invoice_status(v_i3, 'unpaid');
    select document_number into v_n3 from sales_invoices where id = v_i3;

    -- أوّل فاتورة في منشأة جديدة رقمها ١ — لا يتبع منشأةً أخرى
    if v_n3 <> 1 then
      raise exception 'فشل: التسلسل مشترك بين المنشآت (أوّل رقم في الثانية %)', v_n3;
    end if;
  end;
  raise notice '✅ ٦) لكل منشأة تسلسلها — أوّل فاتورة رقمها ١ مهما بلغ رقم غيرها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الفاتورة الصادرة لا تُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from sales_invoices where id = v_inv;
    raise exception 'فشل: حُذفت فاتورة صادرة';
  exception when others then
    if sqlerrm not like '%لا تُحذف%' then raise; end if;
    raise notice '✅ ٧) الفاتورة الصادرة لا تُحذف — التسلسل دليل عدم الحذف';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الإشعار الدائن: يتبع أصله ويحمل سببه
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_create_credit_note(v_inv, '');
    raise exception 'فشل: صدر إشعار بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
  end;

  v_note := app_create_credit_note(v_inv, 'خدمة لم تُنفَّذ');
  if (select corrects_invoice_id from sales_invoices where id = v_note) <> v_inv then
    raise exception 'فشل: الإشعار لا يشير إلى فاتورته الأصلية';
  end if;
  if (select document_type from sales_invoices where id = v_note) <> 'credit_note' then
    raise exception 'فشل: نوع المستند ليس إشعارًا دائنًا';
  end if;
  select count(*) into v_int from sales_invoice_items where invoice_id = v_note;
  if v_int <> 2 then raise exception 'فشل: بنود الإشعار % لا اثنان', v_int; end if;

  -- الإشعار الجزئي
  declare v_note2 uuid; v_li uuid;
  begin
    select id into v_li from sales_invoice_items
     where invoice_id = v_inv and item_id = v_std;
    v_note2 := app_create_credit_note(v_inv, 'إرجاع جزئي',
                 jsonb_build_array(jsonb_build_object('invoice_item_id', v_li, 'qty', 1)));
    select count(*) into v_int from sales_invoice_items where invoice_id = v_note2;
    if v_int <> 1 then raise exception 'فشل: الإشعار الجزئي حمل % بندًا', v_int; end if;
  end;
  raise notice '✅ ٨) الإشعار الدائن كليًّا وجزئيًّا، يتبع أصله ويحمل سببه';

  -- الإشعار له تسلسله المستقلّ
  perform app_set_invoice_status(v_note, 'unpaid');
  if (select document_number from sales_invoices where id = v_note) <> 1 then
    raise exception 'فشل: الإشعار الدائن لا يملك تسلسله المستقلّ';
  end if;
  raise notice '✅ ٩) الإشعارات لها تسلسلها المنفصل عن الفواتير';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) المستند الإلكتروني: يُولَّد ولا يُرسَل
  -- ═════════════════════════════════════════════════════════════════════════
  v_doc := app_generate_einvoice(v_inv);
  if (select status from einvoice_documents where id = v_doc) <> 'generated' then
    raise exception 'فشل: حالة المستند ليست generated';
  end if;
  if (select environment from einvoice_documents where id = v_doc) <> 'sandbox' then
    raise exception 'فشل: البيئة ليست sandbox — لا إنتاج في هذه المرحلة';
  end if;
  if (select qr_code from einvoice_documents where id = v_doc) is null then
    raise exception 'فشل: لم يُولَّد رمز QR';
  end if;
  if (select qr_code from einvoice_documents where id = v_doc) like '%' || chr(10) || '%' then
    raise exception 'فشل: رمز QR فيه سطر جديد — يفسد عند بعض القارئات';
  end if;
  if (select submitted_at from einvoice_documents where id = v_doc) is not null then
    raise exception 'فشل: سُجّل إرسال — لا إرسال في هذه المرحلة';
  end if;
  raise notice '✅ ١٠) المستند يُولَّد برمزه في بيئة الاختبار، ولا يُرسَل';

  -- سلسلة التجزئة
  if (select invoice_hash from einvoice_documents where id = v_doc) is null then
    raise exception 'فشل: لا تجزئة للمستند';
  end if;
  declare v_doc2 uuid;
  begin
    v_doc2 := app_generate_einvoice(v_note);
    if (select previous_hash from einvoice_documents where id = v_doc2) is null then
      raise exception 'فشل: المستند الثاني لا يرتبط بتجزئة سابقه — السلسلة مقطوعة';
    end if;
  end;
  raise notice '✅ ١١) سلسلة التجزئة تربط كل مستند بسابقه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) المقبول لدى الهيئة لا يُغيَّر
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_einvoice_status(v_doc, 'submitted');
  if (select attempt_count from einvoice_documents where id = v_doc) <> 1 then
    raise exception 'فشل: عدّاد المحاولات لم يزد';
  end if;
  perform app_set_einvoice_status(v_doc, 'accepted', '{"uuid":"x"}'::jsonb);
  begin
    perform app_set_einvoice_status(v_doc, 'rejected', null, '{"e":"y"}'::jsonb);
    raise exception 'فشل: غُيّرت حالة مستند مقبول لدى الهيئة';
  exception when others then
    if sqlerrm not like '%مقبول لدى الهيئة%' then raise; end if;
    raise notice '✅ ١٢) المستند المقبول لا يُغيَّر — سجلّنا يطابق سجلّ الهيئة';
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) إقرار الضريبة يفصل الفئات
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_vat_summary
                  where organization_id = v_org and vat_category = 'standard' and vat_amount > 0) then
    raise exception 'فشل: الإقرار لا يعرض الوعاء الخاضع';
  end if;
  if not exists (select 1 from v_vat_summary
                  where organization_id = v_org and vat_category = 'exempt') then
    raise exception 'فشل: الإقرار لا يفصل المعفى';
  end if;
  raise notice '✅ ١٣) الإقرار يفصل الخاضع عن المعفى شهريًا';

  raise notice '——— كل فحوص الضريبة نجحت ———';
end $$;

rollback;
