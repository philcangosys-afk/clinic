-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ بيانات وهمية للتحقّق من القواعد ثم يتراجع عنها (begin … rollback) ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات 0145: نماذج الفحص، والإجازة في الحضور، والصرف الفرديّ، والدواء
-- المصروف غير المفوتَر.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/exam-leave-payroll.test.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_emp     uuid;
  v_sys_tpl uuid;
  v_new_tpl uuid;
  v_before  jsonb;
  v_after   jsonb;
  v_sec     uuid;
  v_shift   uuid;
  v_leave   uuid;
  v_ltype   uuid;
  v_run     uuid;
  v_item    uuid;
  v_drug    uuid;
  v_presc   uuid;
  v_pitem   uuid;
  v_disp    uuid;
  v_wh      uuid;
  v_num     numeric;
  v_int     int;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ex-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار 0145', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الرئيسي', 'EX-1') returning id into v_branch;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9601, 'د. النموذج') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض 0145', '1000000145') returning id into v_patient;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) نسخ قالب نظاميّ للتخصيص: يُنشئ أقسامًا وحقولًا فعلية
  --    القوالب النظامية بلا منشأة، وجدولا البناء محميّان بالعضوية — فلا سبيل
  --    إلى تخصيص قالبٍ إلّا بنسخه إلى المنشأة.
  -- ═════════════════════════════════════════════════════════════════════════
  select id into v_sys_tpl from clinic_exam_templates
   where organization_id is null and jsonb_array_length(schema_definition -> 'sections') > 0
   limit 1;
  if v_sys_tpl is null then
    raise exception 'فشل التهيئة: لا قالب نظاميّ في القاعدة';
  end if;

  v_new_tpl := app_clone_exam_template(v_sys_tpl, v_org, 'نموذج المنشأة');
  select count(*) into v_int from exam_template_sections where template_id = v_new_tpl;
  if v_int = 0 then
    raise exception 'فشل: النسخة بلا أقسام — تبويب البناء سيبقى فارغًا';
  end if;
  select count(*) into v_int from exam_template_fields where template_id = v_new_tpl;
  if v_int = 0 then
    raise exception 'فشل: النسخة بلا حقول';
  end if;
  raise notice '✅ ١) نسخ القالب للتخصيص يبني أقسامه وحقوله (% حقلًا)', v_int;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الشكل المُعاد بناؤه يحمل نوع القسم وتسميات الحقول
  -- ═════════════════════════════════════════════════════════════════════════
  select schema_definition into v_after from clinic_exam_templates where id = v_new_tpl;
  if not exists (
    select 1 from jsonb_array_elements(v_after -> 'sections') s
     where s ->> 'type' = 'group'
       and jsonb_typeof(s -> 'fields') = 'array'
       and jsonb_array_length(s -> 'fields') > 0
       and jsonb_typeof((s -> 'fields') -> 0) = 'object'
       and ((s -> 'fields') -> 0) ->> 'label_ar' is not null
  ) then
    raise exception 'فشل: حقول المجموعة بلا تسميات في الشكل المُعاد بناؤه';
  end if;
  -- والأقسام غير المجموعة (نصّ/تشخيص) تبقى بنوعها لا تُحوَّل مجموعات
  if exists (select 1 from jsonb_array_elements(v_after -> 'sections') s
              where s ->> 'key' = 'main_complaint' and s ->> 'type' <> 'text') then
    raise exception 'فشل: قسم نصّي تحوّل إلى مجموعة';
  end if;
  raise notice '✅ ٢) الشكل المُعاد بناؤه يحفظ نوع القسم وتسمية الحقل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) إعادة البناء بلا أقسام لا تمحو التعريف القائم
  --    كان أوّل قسم يُضاف — أو حذف آخر قسم — يستبدل النموذج كلّه بقائمة فارغة.
  -- ═════════════════════════════════════════════════════════════════════════
  insert into clinic_exam_templates (organization_id, specialty_code, name_ar, canvas_type,
                                     schema_definition)
  values (v_org, 'general', 'قالب بلا أقسام', 'none',
          '{"sections":[{"key":"c","label_ar":"الشكوى","type":"text"}]}'::jsonb)
  returning id into v_new_tpl;
  select schema_definition into v_before from clinic_exam_templates where id = v_new_tpl;
  perform app_rebuild_exam_schema(v_new_tpl);
  select schema_definition into v_after from clinic_exam_templates where id = v_new_tpl;
  if v_after is distinct from v_before then
    raise exception 'فشل: إعادة البناء بلا أقسام محت التعريف القائم';
  end if;
  raise notice '✅ ٣) إعادة البناء بلا أقسام لا تمحو النموذج';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الإجازة المعتمدة تُثبَّت في سجلّ الحضور
  -- ═════════════════════════════════════════════════════════════════════════
  insert into employees (organization_id, branch_id, name_ar, job_number)
    values (v_org, v_branch, 'موظف الإجازة', 'EX-EMP') returning id into v_emp;
  insert into leave_types (organization_id, name_ar, annual_entitlement_days)
    values (v_org, 'سنوية', 30) returning id into v_ltype;
  -- رصيد السنة شرطٌ يفرضه حارس الطلب في القاعدة.
  insert into leave_balances (organization_id, employee_id, leave_type_id, year,
                              entitled_days, used_days)
    values (v_org, v_emp, v_ltype, extract(year from current_date)::int, 30, 0);
  insert into leave_requests (organization_id, employee_id, leave_type_id,
                              start_date, end_date, days_count, status, reason)
    values (v_org, v_emp, v_ltype, current_date, current_date + 2, 3, 'pending', 'اختبار')
    returning id into v_leave;

  perform app_approve_leave_request(v_leave, null);

  select count(*) into v_int from attendance_records
   where employee_id = v_emp and status = 'on_leave'
     and work_date between current_date and current_date + 2;
  if v_int <> 3 then
    raise exception 'فشل: أيام الإجازة في سجلّ الحضور % لا 3', v_int;
  end if;
  -- ولا تُلمس أيام سُجِّل فيها حضور فعليّ
  select status into v_txt from attendance_records
   where employee_id = v_emp and work_date = current_date;
  if v_txt <> 'on_leave' then
    raise exception 'فشل: حالة يوم الإجازة % لا on_leave', v_txt;
  end if;
  raise notice '✅ ٤) الإجازة المعتمدة تصل سجلّ الحضور بحالتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الصرف الفرديّ: بالصافي، ومرّة واحدة، وبعد الاعتماد
  -- ═════════════════════════════════════════════════════════════════════════
  insert into payroll_runs (organization_id, branch_id, period_month, status, created_by)
    values (v_org, v_branch, date_trunc('month', current_date)::date, 'draft', v_owner)
    returning id into v_run;
  insert into payroll_run_items (organization_id, payroll_run_id, employee_id,
                                 basic_salary, gross_salary, deductions_total, net_salary)
    values (v_org, v_run, v_emp, 5000, 5000, 800, 4200) returning id into v_item;

  begin
    perform app_pay_payroll_item(v_item, null);
    raise exception 'فشل: صُرف بندٌ في مسيّر غير معتمَد';
  exception when others then
    if sqlerrm not like '%يلزم اعتماد المسيّر%' then raise; end if;
  end;

  update payroll_runs set status = 'approved' where id = v_run;
  perform app_pay_payroll_item(v_item, null);

  select amount into v_num from financial_vouchers
   where id = (select paid_voucher_id from payroll_run_items where id = v_item);
  if v_num <> 4200 then
    raise exception 'فشل: صُرف % لا 4200 (الصافي بعد الاستقطاعات)', v_num;
  end if;

  begin
    perform app_pay_payroll_item(v_item, null);
    raise exception 'فشل: صُرف الراتب مرّتين';
  exception when others then
    if sqlerrm not like '%مصروف سلفًا%' then raise; end if;
  end;
  raise notice '✅ ٥) الصرف الفرديّ بالصافي ومرّة واحدة وبعد الاعتماد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الدواء المصروف يظهر للفوترة بالكمّية المصروفة — ولو بلا زيارة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, 'EX-DRUG', 'دواء الاختبار', 'drug', 25) returning id into v_drug;
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'صيدلية', 'EX-WH') returning id into v_wh;
  insert into prescriptions (organization_id, patient_id, doctor_id, status, is_billed)
    values (v_org, v_patient, v_doctor, 'dispensed', false) returning id into v_presc;
  insert into prescription_items (organization_id, prescription_id, drug_item_id,
                                  quantity_prescribed)
    values (v_org, v_presc, v_drug, 20) returning id into v_pitem;
  insert into dispensing_records (organization_id, prescription_id, patient_id,
                                  warehouse_id, status)
    values (v_org, v_presc, v_patient, v_wh, 'completed') returning id into v_disp;
  insert into dispensing_items (organization_id, dispensing_record_id, prescription_item_id,
                               drug_item_id, quantity_dispensed, unit_price)
    values (v_org, v_disp, v_pitem, v_drug, 8, 25);

  select qty, unit_price into v_num, v_int
    from v_unbilled_dispensed_prescriptions where prescription_id = v_presc;
  if v_num <> 8 then
    raise exception 'فشل: الكمّية المعروضة للفوترة % لا 8 (المصروف لا الموصوف)', v_num;
  end if;
  raise notice '✅ ٦) الدواء المصروف يظهر للفوترة بكمّيته المصروفة ولو بلا زيارة';

  -- وبعد الفوترة يخرج من القائمة
  update prescriptions set is_billed = true where id = v_presc;
  select count(*) into v_int from v_unbilled_dispensed_prescriptions where prescription_id = v_presc;
  if v_int <> 0 then
    raise exception 'فشل: الوصفة المفوترة ما زالت معروضة للفوترة';
  end if;
  raise notice '✅ ٧) الوصفة المفوترة تخرج من قائمة غير المفوتر';

  raise notice '——— كل فحوص 0145 نجحت ———';
end $$;

rollback;
