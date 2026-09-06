-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ بيانات وهمية للتحقّق من القواعد ثم يتراجع عنها (begin … rollback) ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات 0144: صدق التقارير، والأعمدة التي تعلنها الواجهة، ومُرشِّح العيادة.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/report-truth.test.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_clinic  uuid;
  v_clinic2 uuid;
  v_patient uuid;
  v_item    uuid;
  v_offer   uuid;
  v_emp     uuid;
  v_lab     uuid;
  v_labtest uuid;
  v_num     numeric;
  v_int     int;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rep-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار التقارير', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الرئيسي', 'RT-1') returning id into v_branch;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9501, 'د. التقارير') returning id into v_doctor;
  insert into clinics (organization_id, name, code)
    values (v_org, 'عيادة أ', 'RTC-A') returning id into v_clinic;
  insert into clinics (organization_id, name, code)
    values (v_org, 'عيادة ب', 'RTC-B') returning id into v_clinic2;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض التقارير', '1000000144') returning id into v_patient;
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, 'RT-ITEM', 'خدمة', 'service', 400) returning id into v_item;
  insert into offers (organization_id, title, discount_percent)
    values (v_org, 'عرض المساء', 10) returning id into v_offer;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) عرض السعر ليس ذمّة ولا فاتورة متأخّرة
  -- ═════════════════════════════════════════════════════════════════════════
  -- `remaining_amount` عمود محسوب في القاعدة، فلا يُكتب هنا.
  insert into sales_invoices (organization_id, patient_id, doctor_id, clinic_id,
                              subtotal_amount, net_amount, paid_amount,
                              status, is_temporary, issued_at)
    values (v_org, v_patient, v_doctor, v_clinic, 9000, 9000, 0,
            'unpaid', true, now() - interval '90 days');
  insert into sales_invoices (organization_id, patient_id, doctor_id, clinic_id,
                              applied_offer_id, offer_percent, subtotal_amount,
                              discount_amount, net_amount,
                              paid_amount, status, issued_at)
    values (v_org, v_patient, v_doctor, v_clinic, v_offer, 10, 1000,
            300, 700, 0, 'unpaid', now() - interval '90 days');

  select balance_due, open_invoices into v_num, v_int
    from v_patient_balance where patient_id = v_patient;
  if v_num <> 700 then
    raise exception 'فشل: ذمّة المريض % لا 700 (عرض السعر محسوب ذمّة)', v_num;
  end if;
  if v_int <> 1 then
    raise exception 'فشل: فواتير مفتوحة % لا واحدة', v_int;
  end if;
  raise notice '✅ ١) عرض السعر ليس ذمّة على المريض';

  select count(*) into v_int
    from v_invoice_register
   where organization_id = v_org and is_overdue;
  if v_int <> 1 then
    raise exception 'فشل: المتأخرات % فاتورة لا واحدة (عرض السعر يُعدّ متأخّرًا)', v_int;
  end if;
  raise notice '✅ ٢) عرض السعر ليس فاتورة متأخّرة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) حصيلة العرض = خصم العرض وحده، لا خصم الفاتورة كلّه
  --    الفاتورة: 1000 أساس، خصمها الكلّي 300، ونسبة العرض 10٪ ⇒ 100 لا 300.
  -- ═════════════════════════════════════════════════════════════════════════
  select total_discount_amount into v_num from v_offers_totals where offer_id = v_offer;
  if v_num <> 100 then
    raise exception 'فشل: حصيلة العرض % لا 100 (تجمع خصم الفاتورة كلّه)', v_num;
  end if;
  raise notice '✅ ٣) حصيلة العرض هي خصم العرض وحده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) طلب المختبر يبقى ظاهرًا بعد اعتماد نتيجته حتى يُسلَّم
  -- ═════════════════════════════════════════════════════════════════════════
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, 'RT-LAB', 'فحص', 'lab_service', 80) returning id into v_labtest;
  insert into lab_tests (organization_id, name_ar, billing_item_id)
    values (v_org, 'صورة دم', v_labtest) returning id into v_lab;
  insert into lab_orders (organization_id, patient_id, ordering_doctor_id, status)
    values (v_org, v_patient, v_doctor, 'verified');
  select count(*) into v_int from v_lab_pending_orders where organization_id = v_org;
  if v_int <> 1 then
    raise exception 'فشل: الطلب المعتمَد اختفى قبل تسليمه';
  end if;
  update lab_orders set status = 'delivered' where organization_id = v_org;
  select count(*) into v_int from v_lab_pending_orders where organization_id = v_org;
  if v_int <> 0 then
    raise exception 'فشل: الطلب المسلَّم ما زال في الطابور';
  end if;
  raise notice '✅ ٤) طلب المختبر يبقى حتى التسليم ثم يخرج';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الأعمدة التي تعلنها الواجهة موجودة فعلًا
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from information_schema.columns
   where table_name = 'v_radiology_unreported_orders'
     and column_name in ('exams_count','findings_written_count','urgent_findings_count','completed_at');
  if v_int <> 4 then
    raise exception 'فشل: عدّادات طلب الأشعة ناقصة (% من 4)', v_int;
  end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'v_patient_vitals' and column_name in ('patient_name','file_number');
  if v_int <> 2 then
    raise exception 'فشل: قائمة المؤشّرات بلا اسم المريض';
  end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'v_today_attendance' and column_name in ('overtime_minutes','overtime_approved_by');
  if v_int <> 2 then
    raise exception 'فشل: حضور اليوم بلا دقائق الإضافي';
  end if;
  raise notice '✅ ٥) الأعمدة المعلَنة في الواجهة موجودة في القاعدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) مُرشِّح العيادة يعمل فعلًا في تقارير الاستقبال
  -- ═════════════════════════════════════════════════════════════════════════
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status)
    values (v_org, v_branch, v_clinic, v_doctor, v_patient,
            now(), now() + interval '30 minutes', 'no_show');
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status)
    values (v_org, v_branch, v_clinic, v_doctor, v_patient,
            now(), now() + interval '30 minutes', 'no_show');
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status)
    values (v_org, v_branch, v_clinic2, v_doctor, v_patient,
            now(), now() + interval '30 minutes', 'completed');

  select total into v_int
    from app_report_no_show(v_org, current_date - 1, current_date + 1, null, null, v_clinic);
  if v_int <> 2 then
    raise exception 'فشل: تقرير عدم الحضور لعيادة أ أعطى % موعدًا لا 2', v_int;
  end if;
  select total into v_int
    from app_report_no_show(v_org, current_date - 1, current_date + 1, null, null, v_clinic2);
  if v_int <> 1 then
    raise exception 'فشل: مُرشِّح العيادة لا يعمل في تقرير عدم الحضور';
  end if;

  select count(*) into v_int
    from app_report_booking_sources(v_org, current_date - 1, current_date + 1, null, null, v_clinic2);
  if v_int <> 1 then
    raise exception 'فشل: مُرشِّح العيادة لا يعمل في تقرير مصادر الحجز';
  end if;

  select no_show_count into v_int
    from app_report_repeat_no_show(v_org, current_date - 1, current_date + 1, 2, null, null, v_clinic);
  if v_int <> 2 then
    raise exception 'فشل: تقرير تكرار عدم الحضور لا يحترم مُرشِّح العيادة';
  end if;
  select count(*) into v_int
    from app_report_repeat_no_show(v_org, current_date - 1, current_date + 1, 2, null, null, v_clinic2);
  if v_int <> 0 then
    raise exception 'فشل: تكرار عدم الحضور يعرض عيادة بلا تخلّف';
  end if;
  raise notice '✅ ٦) مُرشِّح العيادة يعمل في تقارير الاستقبال الأربعة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) إجمالي دفعة المطالبات يُحسب في القاعدة
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_company uuid;
    v_batch   uuid;
    v_inv     uuid;
  begin
    insert into insurance_companies (organization_id, name_ar)
      values (v_org, 'شركة الاختبار') returning id into v_company;
    insert into insurance_claim_batches (organization_id, company_id,
                                         period_start, period_end, total_amount)
      values (v_org, v_company, current_date - 30, current_date, 0)
      returning id into v_batch;
    insert into sales_invoices (organization_id, patient_id, net_amount, status, is_insurance_invoice)
      values (v_org, v_patient, 500, 'unpaid', true) returning id into v_inv;

    insert into insurance_claim_batch_items (batch_id, sales_invoice_id, amount)
      values (v_batch, v_inv, 500);
    select total_amount into v_num from insurance_claim_batches where id = v_batch;
    if v_num <> 500 then
      raise exception 'فشل: إجمالي الدفعة % لا 500 بعد إضافة بند', v_num;
    end if;

    delete from insurance_claim_batch_items where batch_id = v_batch;
    select total_amount into v_num from insurance_claim_batches where id = v_batch;
    if v_num <> 0 then
      raise exception 'فشل: إجمالي الدفعة % لا صفر بعد حذف بنودها', v_num;
    end if;
  end;
  raise notice '✅ ٧) إجمالي دفعة المطالبات يتبع بنودها في القاعدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) سند الصرف الملغى لا يُحتسب مدفوعًا لمعمل الأسنان
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_dlab  uuid;
    v_order uuid;
  begin
    -- معامل الأسنان جهاتٌ في جدول الموردين (`distributors`) لا جدول مستقلّ.
    insert into distributors (organization_id, name_ar)
      values (v_org, 'معمل الاختبار') returning id into v_dlab;
    insert into dental_lab_orders (organization_id, distributor_id, patient_id, doctor_id, total_amount)
      values (v_org, v_dlab, v_patient, v_doctor, 600) returning id into v_order;
    insert into financial_vouchers (organization_id, voucher_type, amount, dental_lab_order_id,
                                    voucher_date, description)
      values (v_org, 'expense', 600, v_order, current_date, 'سداد');
    select paid_amount into v_num from dental_lab_orders where id = v_order;
    if v_num <> 600 then
      raise exception 'فشل: المدفوع % لا 600 بعد السند', v_num;
    end if;

    update financial_vouchers set is_void = true, void_reason = 'اختبار'
     where dental_lab_order_id = v_order;
    perform app_recalc_dental_lab_order_paid(v_order);
    select paid_amount into v_num from dental_lab_orders where id = v_order;
    if v_num <> 0 then
      raise exception 'فشل: المدفوع % لا صفر بعد إلغاء السند', v_num;
    end if;
  end;
  raise notice '✅ ٨) إلغاء سند الصرف يُنقص المدفوع للمعمل';

  raise notice '——— كل فحوص 0144 نجحت ———';
end $$;

rollback;
