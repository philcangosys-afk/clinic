-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات التقارير — 0094
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/reporting-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- التقرير الخاطئ أسوأ من غياب التقرير، لأنه يُتّخذ عليه قرار. لذلك كل فحص
-- هنا يقيس **رقمًا** لا وجودَ صفٍّ: أن مجموع الإيراد يساوي الفاتورة، وأن
-- الانتظار لا يحتسب حضور المريض المبكّر، وأن إيراد الطبيب بنودُه هو لا
-- الفاتورة كاملةً، وأن التقرير لا يتخطّى عزل المنشآت.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid;
  v_org2     uuid;
  v_owner    uuid;
  v_owner2   uuid;
  v_branch   uuid;
  v_clinic   uuid;
  v_doc_a    uuid;
  v_doc_b    uuid;
  v_patient  uuid;
  v_consult  uuid;
  v_labitem  uuid;
  v_visit    uuid;
  v_inv      uuid;
  v_appt     uuid;
  v_reg      uuid;
  v_shift    uuid;
  v_cash     uuid;
  v_num      numeric;
  v_num2     numeric;
  v_txt      text;
  v_int      int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rp-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'rp-owner2@test.local')
    returning id into v_owner2;

  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار التقارير', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','RC1','name','عيادة التقارير','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب أ')
    returning id into v_doc_a;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب ب')
    returning id into v_doc_b;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض التقارير')
    returning id into v_patient;

  insert into items (organization_id, item_type, code, name_ar, price, medical_service_type)
    values (v_org, 'service', 'RCONS', 'كشف', 300, 'consultation') returning id into v_consult;
  insert into items (organization_id, item_type, code, name_ar, price,
                     medical_service_type, is_vat_exempt)
    values (v_org, 'service', 'RLAB', 'تحليل معفى', 100, 'laboratory', true)
    returning id into v_labitem;

  select lv.id into v_cash from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';
  insert into cash_registers (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'صندوق التقارير', 'RCR1') returning id into v_reg;

  -- ── موعد ← وصول ← زيارة ← فاتورة ← تحصيل
  -- المريض حضر قبل موعده بساعة كاملة، ودخل على الطبيب بعد الموعد بعشر دقائق.
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            item_id, scheduled_start, scheduled_end, status,
                            checked_in_1_at, entered_at, left_at)
    values (v_org, v_branch, v_clinic, v_doc_a, v_patient, v_consult,
            current_date + time '10:00', current_date + time '10:30', 'completed',
            current_date + time '09:00',            -- وصل مبكّرًا بساعة
            current_date + time '10:10',            -- دخل بعد الموعد بعشر دقائق
            current_date + time '10:35')
    returning id into v_appt;

  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, appointment_id, visit_date, status,
                              started_at, ended_at)
    values (v_org, v_patient, v_doc_a, v_clinic, v_branch, v_appt, current_date,
            'in_progress', current_date + time '10:10', current_date + time '10:35')
    returning id into v_visit;

  -- خدمتان: الكشف للطبيب أ، والتحليل أدّاه الطبيب ب
  insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                      unit_price, status, performed_by)
    values (v_org, v_visit, v_consult, 1, 300, 'performed', v_doc_a),
           (v_org, v_visit, v_labitem, 1, 100, 'performed', v_doc_b);

  v_inv := app_create_invoice_from_visit(v_visit, false);
  perform app_set_invoice_status(v_inv, 'unpaid', null);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الإيراد يُشتقّ من مصدر واحد: مجموع بنود التقرير = صافي الفاتورة
  -- ═════════════════════════════════════════════════════════════════════════
  select sum(net_amount) into v_num from v_report_revenue where invoice_id = v_inv;
  select net_amount into v_num2 from sales_invoices where id = v_inv;
  if v_num is distinct from v_num2 then
    raise exception 'فشل: مجموع تقرير الإيراد % لا يساوي صافي الفاتورة % — رقمان لشيء واحد',
      v_num, v_num2;
  end if;
  select sum(vat_amount) into v_num from v_report_revenue where invoice_id = v_inv;
  if v_num <> 45 then
    raise exception 'فشل: ضريبة التقرير % لا ٤٥ — التقرير يحسب الضريبة بنفسه بدل مصدر المرحلة ١٢', v_num;
  end if;
  raise notice '✅ ١) الإيراد يُشتقّ من بند الفاتورة، ومجموعه يطابق الفاتورة والضريبة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) التجميع بكل الأبعاد من نفس المنظور — لا منظور لكل بُعد
  -- ═════════════════════════════════════════════════════════════════════════
  if (select count(distinct branch_id) from v_report_revenue where invoice_id = v_inv) <> 1
     or (select count(distinct clinic_id) from v_report_revenue where invoice_id = v_inv) <> 1
     or (select count(distinct item_id) from v_report_revenue where invoice_id = v_inv) <> 2
     or (select count(distinct doctor_id) from v_report_revenue where invoice_id = v_inv) <> 2 then
    raise exception 'فشل: أبعاد التجميع (فرع/عيادة/خدمة/طبيب) غير مكتملة في منظور واحد';
  end if;
  -- الطبيب هنا طبيب البند: التحليل يُنسب لـ«ب» لا لطبيب الفاتورة
  select doctor_id into v_txt from v_report_revenue
   where invoice_id = v_inv and item_id = v_labitem;
  if v_txt::uuid <> v_doc_b then
    raise exception 'فشل: التحليل نُسب لطبيب الفاتورة لا لمن أدّاه';
  end if;
  raise notice '✅ ٢) كل خدمة تُنسب لمن أدّاها — لا يُحمَّل طبيب العيادة عملَ غيره';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) الفاتورة المؤقّتة والملغاة خارج الإيراد
  -- ═════════════════════════════════════════════════════════════════════════
  -- تُلغى فاتورة **ثانية** لا الأصلية: إلغاء الفاتورة لا رجعة فيه (المرحلة 11)
  -- ولا يجوز للاختبار أن يلتفّ على ذلك بتحديث مباشر.
  declare v_inv_void uuid;
  begin
    insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                                patient_id, status, issued_at)
      values (v_org, v_branch, v_clinic, v_doc_a, v_patient, 'unpaid', now())
      returning id into v_inv_void;
    insert into sales_invoice_items (organization_id, invoice_id, branch_id, item_id,
                                     description, qty, price, net_amount, vat_category)
      values (v_org, v_inv_void, v_branch, v_consult, 'كشف', 1, 100, 100, 'standard');

    if not exists (select 1 from v_report_revenue where invoice_id = v_inv_void) then
      raise exception 'فشل: فاتورة حيّة لا تظهر في الإيراد';
    end if;
    perform app_set_invoice_status(v_inv_void, 'void', 'اختبار الاستبعاد');
    if exists (select 1 from v_report_revenue where invoice_id = v_inv_void) then
      raise exception 'فشل: الفاتورة الملغاة ما زالت تُحسب إيرادًا';
    end if;
  end;

  declare v_inv_temp uuid;
  begin
    insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                                patient_id, status, issued_at, is_temporary)
      values (v_org, v_branch, v_clinic, v_doc_a, v_patient, 'unpaid', now(), true)
      returning id into v_inv_temp;
    insert into sales_invoice_items (organization_id, invoice_id, branch_id, item_id,
                                     description, qty, price, net_amount, vat_category)
      values (v_org, v_inv_temp, v_branch, v_consult, 'كشف مؤقّت', 1, 100, 100, 'standard');
    if exists (select 1 from v_report_revenue where invoice_id = v_inv_temp) then
      raise exception 'فشل: الفاتورة المؤقّتة تُحسب إيرادًا';
    end if;
  end;
  raise notice '✅ ٣) الملغاة والمؤقّتة خارج الإيراد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) المقبوضات: مبلغ موقَّع، وطريقة دفع مسمّاة
  -- ═════════════════════════════════════════════════════════════════════════
  v_shift := app_open_cash_shift(v_reg, 0, null);
  perform app_receive_invoice_payment(v_inv, 200, v_cash, v_reg, null, 'دفعة أولى');

  select sum(amount) into v_num from v_report_receipts
   where sales_invoice_id = v_inv;
  if v_num <> 200 then
    raise exception 'فشل: تقرير المقبوضات يعرض % لا ٢٠٠', v_num;
  end if;
  select payment_method_code into v_txt from v_report_receipts
   where sales_invoice_id = v_inv limit 1;
  if v_txt <> 'cash' then
    raise exception 'فشل: طريقة الدفع في التقرير % لا cash', v_txt;
  end if;
  if not exists (select 1 from v_report_receipts
                  where sales_invoice_id = v_inv and affects_drawer) then
    raise exception 'فشل: الدفع النقدي لا يظهر مؤثّرًا في الدرج — الصندوق لن يُطابَق';
  end if;
  raise notice '✅ ٤) المقبوضات حسب طريقة الدفع والصندوق، والنقد يؤثّر في الدرج';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) غير المسدَّد: عمر الدين من الإصدار، والمسوّدة ليست دينًا
  -- ═════════════════════════════════════════════════════════════════════════
  select remaining_amount, ageing_bucket into v_num, v_txt
    from v_report_outstanding where invoice_id = v_inv;
  if v_num <> 245 then
    raise exception 'فشل: المتبقّي في التقرير % لا ٢٤٥', v_num;
  end if;
  if v_txt <> '٠–٣٠' then
    raise exception 'فشل: شريحة العمر % لفاتورة صدرت اليوم', v_txt;
  end if;

  -- فاتورة مسوّدة عمرها شهر: لا تظهر دينًا
  declare v_draft uuid;
  begin
    insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                                patient_id, status, created_at)
      values (v_org, v_branch, v_clinic, v_doc_a, v_patient, 'draft', now() - interval '30 days')
      returning id into v_draft;
    if exists (select 1 from v_report_outstanding where invoice_id = v_draft) then
      raise exception 'فشل: مسوّدة عمرها شهر ظهرت في الذمم';
    end if;
  end;
  raise notice '✅ ٥) الذمم تُحسب من الإصدار، والمسوّدة ليست دينًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الخصومات والاستردادات والإلغاءات بسببها ومَن أقرّها
  -- ═════════════════════════════════════════════════════════════════════════
  -- الخصم يُمنح على مسوّدة قبل الإصدار (المرحلة 11)، فالفاتورة الأصلية صدرت.
  -- نُنشئ مسوّدةً ثانية لنقيس التقرير على مسار الخصم الحقيقيّ.
  declare v_inv_disc uuid;
  begin
    insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                                patient_id, status)
      values (v_org, v_branch, v_clinic, v_doc_a, v_patient, 'draft')
      returning id into v_inv_disc;
    insert into sales_invoice_items (organization_id, invoice_id, branch_id, item_id,
                                     description, qty, price, net_amount, vat_category)
      values (v_org, v_inv_disc, v_branch, v_consult, 'كشف', 1, 200, 200, 'standard');
    update sales_invoices set subtotal_amount = 200, net_amount = 200
     where id = v_inv_disc;

    perform app_apply_invoice_discount(v_inv_disc, 20, 'خصم موظّف');
    select amount, reason, acted_by into v_num, v_txt, v_org2
      from v_report_discounts_refunds
     where entry_kind = 'discount' and reference_id = v_inv_disc;
  end;
  if coalesce(v_num, 0) <= 0 then
    raise exception 'فشل: الخصم لا يظهر في تقرير الخصومات';
  end if;
  if v_txt is null then
    raise exception 'فشل: خصم بلا سبب مسجَّل — هذا هو الباب الذي يخرج منه المال بلا أثر';
  end if;
  if v_org2 is null then
    raise exception 'فشل: خصم بلا مَن أقرّه';
  end if;
  v_org2 := null;

  perform app_refund_invoice_payment(v_inv, 50, 'استرداد اختبار', v_reg);
  if not exists (select 1 from v_report_discounts_refunds
                  where entry_kind = 'refund' and reason is not null) then
    raise exception 'فشل: الاسترداد لا يظهر بسببه';
  end if;
  raise notice '✅ ٦) الخصم والاسترداد والإلغاء بسببها ومَن أقرّها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) وقت الانتظار لا يحتسب حضور المريض المبكّر
  -- ═════════════════════════════════════════════════════════════════════════
  select wait_minutes, consultation_minutes, visit_minutes
    into v_num, v_num2, v_int
    from v_report_appointments where appointment_id = v_appt;
  -- وصل ٩:٠٠، وموعده ١٠:٠٠، ودخل ١٠:١٠ ⇒ الانتظار عشر دقائق لا سبعون
  if v_num is distinct from 10.0 then
    raise exception 'فشل: الانتظار % دقيقة — حضورُ المريض المبكّر حُسب علينا', v_num;
  end if;
  if v_num2 is distinct from 25.0 then
    raise exception 'فشل: مدّة الكشف % لا ٢٥ دقيقة', v_num2;
  end if;
  if not exists (select 1 from v_report_appointments
                  where appointment_id = v_appt and did_arrive and not is_no_show) then
    raise exception 'فشل: الوصول أو عدم الحضور غير محسوبين';
  end if;
  raise notice '✅ ٧) الانتظار يُقاس من الموعد أو الوصول أيّهما أحدث';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) إنتاجية الطبيب: إيراده بنودُه هو
  -- ═════════════════════════════════════════════════════════════════════════
  select net_revenue into v_num from v_report_doctor_productivity
   where doctor_id = v_doc_b and report_date = current_date;
  select sum(net_amount) into v_num2 from v_report_revenue
   where doctor_id = v_doc_b and invoice_id = v_inv;
  if v_num is distinct from v_num2 then
    raise exception 'فشل: إيراد الطبيب ب في الإنتاجية % وفي الإيراد % — نُسبت له الفاتورة كاملةً',
      v_num, v_num2;
  end if;
  select visit_count into v_int from v_report_doctor_productivity
   where doctor_id = v_doc_a and report_date = current_date;
  if coalesce(v_int, 0) <> 1 then
    raise exception 'فشل: عدد زيارات الطبيب أ % لا واحدة', v_int;
  end if;
  raise notice '✅ ٨) إنتاجية الطبيب من بنوده لا من الفاتورة كاملةً';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) الطلبات في تدفّق واحد بمدّة الإنجاز
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_report_orders
                  where order_kind = 'service' and visit_id = v_visit) then
    raise exception 'فشل: خدمات الزيارة لا تظهر في تقرير الطلبات';
  end if;
  if (select count(distinct order_kind) from v_report_orders) = 0 then
    raise exception 'فشل: تقرير الطلبات فارغ من كل الأنواع';
  end if;
  raise notice '✅ ٩) الطلبات (مختبر/أشعة/خدمات) في تدفّق واحد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) قمع الرحلة: كل مرحلة يقابلها عمود، والفجوة تظهر
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (
    select 1 from v_report_patient_funnel
     where appointment_id = v_appt
       and reached_reception and reached_visit and reached_invoice and reached_payment
       and not fully_collected) then
    raise exception 'فشل: القمع لا يعكس الرحلة — موعدٌ وصل واستُقبل وفُوتر وسُدّد جزئيًا';
  end if;
  raise notice '✅ ١٠) قمع الرحلة يعرض كل مرحلة وموضع التسرّب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) كل منظور تقارير يحمل عزلًا ونطاق تاريخ
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_v text; v_bad text[] := '{}';
  begin
    foreach v_v in array array[
      'v_report_revenue','v_report_receipts','v_report_outstanding',
      'v_report_discounts_refunds','v_report_credit_debit_notes',
      'v_report_claims','v_report_claim_rejections','v_report_preauth_expiring',
      'v_report_settlement_variance','v_report_appointments',
      'v_report_doctor_productivity','v_report_orders','v_report_dispensing',
      'v_report_stock_movements','v_report_patient_funnel']
    loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=v_v
                        and column_name='organization_id')
         or not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=v_v
                        and column_name='report_date')
         or not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=v_v
                        and column_name='branch_id') then
        v_bad := v_bad || v_v;
      end if;
    end loop;
    if array_length(v_bad, 1) > 0 then
      raise exception 'فشل: مناظير بلا أعمدة المرشّح الموحّد: %', array_to_string(v_bad, ', ');
    end if;
  end;
  raise notice '✅ ١١) كل تقرير يقبل المرشّح الموحّد: منشأة وفرع ونطاق تاريخ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) صلاحيات التقارير مفصولة، والتصدير ليس تابعًا للقراءة
  -- ═════════════════════════════════════════════════════════════════════════
  if (select count(*) from permission_catalog
       where permission_key in ('reports.financial','reports.insurance',
                                'reports.operational','reports.export')) <> 4 then
    raise exception 'فشل: صلاحيات التقارير الأربع غير مسجَّلة';
  end if;
  if exists (select 1 from role_default_permissions
              where role_key = 'doctor' and permission_key = 'reports.financial') then
    raise exception 'فشل: الطبيب يرى التقارير المالية افتراضيًا';
  end if;
  if exists (select 1 from role_default_permissions
              where role_key = 'receptionist' and permission_key = 'reports.export') then
    raise exception 'فشل: التصدير مُنح افتراضيًا مع القراءة — التصدير إخراجُ بيانات';
  end if;
  raise notice '✅ ١٢) صلاحيات التقارير مفصولة، والتصدير ليس تابعًا للقراءة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) بيانات منشأة أخرى موجودة — لتُختبَر عزلتها بعد الخروج من المالك
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_owner2::text, true);
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة أخرى', 'clinic', v_owner2, 15) returning id into v_org2;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  raise notice '——— كل فحوص التقارير نجحت ———';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14) العزل الفعليّ: RLS لا تُطبَّق على المالك، فيُختبر بدور `authenticated`
--     خارج الكتلة. تقريرٌ بلا security_invoker يسرّب منشآت أخرى.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_stranger uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rp-stranger@test.local')
    returning id into v_stranger;
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
end $$;

set local role authenticated;

do $$
begin
  -- غريبٌ بلا عضوية: لا يرى صفًّا واحدًا في أيّ تقرير
  if exists (select 1 from v_report_revenue) then
    raise exception 'فشل: تقرير الإيراد يسرّب بيانات لمن لا عضوية له';
  end if;
  if exists (select 1 from v_report_claims) then
    raise exception 'فشل: تقرير المطالبات يسرّب بيانات لمن لا عضوية له';
  end if;
  if exists (select 1 from v_report_appointments) then
    raise exception 'فشل: تقرير المواعيد يسرّب بيانات لمن لا عضوية له';
  end if;
  if exists (select 1 from v_report_patient_funnel) then
    raise exception 'فشل: قمع الرحلة يسرّب بيانات لمن لا عضوية له';
  end if;
  raise notice '✅ ١٣) التقرير لا يتخطّى عزل المنشآت — الغريب لا يرى شيئًا';
  raise notice '——— كل فحوص عزل التقارير نجحت ———';
end $$;

reset role;

rollback;
