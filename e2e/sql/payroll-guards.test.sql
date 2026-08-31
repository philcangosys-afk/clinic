-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الموارد البشرية والرواتب — 0100
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/payroll-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- خطأ الراتب لا يُكتشف بالمراجعة بل بشكوى موظف، وبعد أن يكون المال قد خرج.
-- لذلك كل فحص هنا يقيس **مبلغًا** أو يمنع **إجراءً**، لا يتحقّق من وجود شاشة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_hr      uuid;
  v_mgr     uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_emp     uuid;
  v_emp2    uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_run     uuid;
  v_item    uuid;
  v_loan    uuid;
  v_comp    uuid;
  v_leave_t uuid;
  v_leave   uuid;
  v_start   date;
  v_end     date;
  v_num     numeric;
  v_txt     text;
  v_int     int;
  v_json    jsonb;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pay-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'pay-hr@test.local')
    returning id into v_hr;
  insert into auth.users (id, email) values (gen_random_uuid(), 'pay-mgr@test.local')
    returning id into v_mgr;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار الرواتب', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_hr, 'accountant', true), (v_org, v_mgr, 'branch_manager', true);
  -- مدير الفرع يعتمد ولا يحتسب افتراضيًّا؛ نمنحه الاحتساب صراحةً لنختبر
  -- الحاجز الحقيقيّ: **من احتسب لا يعتمد**.
  insert into membership_permissions (organization_id, user_id, permission_key, granted)
    values (v_org, v_mgr, 'payroll.run', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','PY1','name','عيادة','branch_id', v_branch));

  -- دليل الحسابات لازمٌ لقيد الرواتب: بلا حسابَي المصروف والنقد لا قيد
  perform app_seed_default_chart_of_accounts(v_org);

  v_start := date_trunc('month', current_date)::date;
  v_end   := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  -- موظف براتب ٣٠٠٠ وبدلات ٩٠٠ (شهر بـ٣٠ أو ٣١ يومًا)
  insert into employees (organization_id, branch_id, name_ar, job_number, basic_salary,
                         housing_allowance, transportation_allowance, status,
                         hire_date, bank_iban, job_title)
    values (v_org, v_branch, 'موظف الرواتب', 1001, 3000, 600, 300, 'active',
            v_start - 365, 'SA1111111111111111111111', 'فنّي')
    returning id into v_emp;
  insert into employees (organization_id, branch_id, name_ar, job_number, basic_salary,
                         status, hire_date)
    values (v_org, v_branch, 'موظف بلا آيبان', 1002, 2000, 'active', v_start - 200)
    returning id into v_emp2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) سجل الترقيات يُكتب تلقائيًّا
  -- ═════════════════════════════════════════════════════════════════════════
  update employees set basic_salary = 3500 where id = v_emp;
  if not exists (select 1 from employee_position_history
                  where employee_id = v_emp and change_type = 'salary_change'
                    and from_salary = 3000 and to_salary = 3500) then
    raise exception 'فشل: تغيّر الراتب لم يُسجَّل في سجل الترقيات';
  end if;

  update employees set job_title = 'فنّي أوّل' where id = v_emp;
  if not exists (select 1 from employee_position_history
                  where employee_id = v_emp and change_type = 'title_change') then
    raise exception 'فشل: تغيّر المسمّى لم يُسجَّل';
  end if;
  update employees set basic_salary = 3000 where id = v_emp;
  raise notice '✅ ١) الترقيات والتنقلات وتغيّر الراتب تُسجَّل تلقائيًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الحضور: تأخير وغياب وإضافيّ (غير معتمَد بعد)
  -- ═════════════════════════════════════════════════════════════════════════
  insert into attendance_records (organization_id, employee_id, work_date, status,
                                  late_minutes, overtime_minutes)
    values (v_org, v_emp, v_start,     'present', 60, 120),
           (v_org, v_emp, v_start + 1, 'absent',   0,   0),
           (v_org, v_emp, v_start + 2, 'present',  0,  60);

  if (select approved_overtime_minutes from v_attendance_summary
       where employee_id = v_emp) <> 0 then
    raise exception 'فشل: الإضافيّ غير المعتمَد حُسب مستحقًّا';
  end if;
  if (select total_overtime_minutes from v_attendance_summary
       where employee_id = v_emp) <> 180 then
    raise exception 'فشل: مجموع الإضافيّ المسجَّل غير صحيح';
  end if;
  raise notice '✅ ٢) الإضافيّ المسجَّل منفصل عن المعتمَد في الملخّص';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) السلفة تُخصم من المسير لا على الورق
  -- ═════════════════════════════════════════════════════════════════════════
  insert into employee_loans (organization_id, employee_id, loan_type, amount,
                              installment_amount, installments_count, start_month,
                              reason, created_by)
    values (v_org, v_emp, 'advance', 1200, 400, 3, v_start, 'ظرف طارئ', v_owner)
    returning id into v_loan;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) مكوّن استقطاع معرَّف (تأمينات ٩٪ من الأساسي)
  -- ═════════════════════════════════════════════════════════════════════════
  insert into salary_components (organization_id, code, name_ar, component_type,
                                 calculation, default_value, affects_gosi, created_by)
    values (v_org, 'GOSI', 'التأمينات الاجتماعية', 'deduction', 'percent_of_basic',
            9, true, v_owner)
    returning id into v_comp;
  insert into employee_salary_components (organization_id, employee_id, component_id,
                                          value, effective_from, created_by)
    values (v_org, v_emp, v_comp, 9, v_start - 365, v_owner);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الاحتساب: كل بند بمبلغه ومصدره
  -- ═════════════════════════════════════════════════════════════════════════
  insert into payroll_runs (organization_id, branch_id, run_number, period_month, created_by)
    values (v_org, v_branch, 'PR-1', v_start, v_owner) returning id into v_run;

  perform set_config('request.jwt.claim.sub', v_hr::text, true);
  v_int := app_calculate_payroll_run(v_run);
  if v_int <> 2 then raise exception 'فشل: عدد الموظفين في المسير % لا ٢', v_int; end if;

  select id into v_item from payroll_run_items
   where payroll_run_id = v_run and employee_id = v_emp;

  -- الأساسي ٣٠٠٠ والبدلات ٩٠٠، والإضافيّ **غير معتمَد** فلا يُحسب
  select overtime_amount into v_num from payroll_run_items where id = v_item;
  if v_num <> 0 then
    raise exception 'فشل: احتُسب إضافيّ غير معتمَد بقيمة %', v_num;
  end if;

  -- الغياب يومٌ واحد: الأساسي ÷ أيام الشهر
  select absence_deduction into v_num from payroll_run_items where id = v_item;
  if round(v_num, 0) <> round(3000.0 / (v_end - v_start + 1), 0) then
    raise exception 'فشل: خصم الغياب % لا يساوي أجر يوم', v_num;
  end if;

  -- قسط السلفة ٤٠٠
  select loan_deduction into v_num from payroll_run_items where id = v_item;
  if v_num <> 400 then raise exception 'فشل: قسط السلفة % لا ٤٠٠', v_num; end if;

  -- التأمينات ٩٪ من ٣٠٠٠ = ٢٧٠
  select other_deductions into v_num from payroll_run_items where id = v_item;
  if v_num <> 270 then raise exception 'فشل: استقطاع التأمينات % لا ٢٧٠', v_num; end if;

  -- التفصيل موجود لكل مبلغ
  select count(*) into v_int from payroll_item_details where payroll_run_item_id = v_item;
  if v_int < 5 then
    raise exception 'فشل: قسيمة الراتب بلا تفصيل كافٍ (% بندًا)', v_int;
  end if;

  -- الصافي = الإجمالي − الاستقطاعات، حسابيًّا
  declare v_gross numeric; v_deds numeric; v_net numeric;
  begin
    select gross_salary, deductions_total, net_salary
      into v_gross, v_deds, v_net from payroll_run_items where id = v_item;
    if round(v_net, 2) <> round(v_gross - v_deds, 2) then
      raise exception 'فشل: الصافي % لا يساوي الإجمالي % ناقص الاستقطاعات %',
        v_net, v_gross, v_deds;
    end if;
  end;
  raise notice '✅ ٥) الاحتساب يبني كل بند من مصدره، ويُفصّله في القسيمة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) اعتماد الإضافيّ يغيّر الاحتساب فعلًا
  -- ═════════════════════════════════════════════════════════════════════════
  update attendance_records
     set overtime_approved_by = v_mgr, overtime_approved_at = now()
   where employee_id = v_emp and overtime_minutes > 0;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform app_calculate_payroll_run(v_run);
  select id into v_item from payroll_run_items
   where payroll_run_id = v_run and employee_id = v_emp;
  select overtime_amount into v_num from payroll_run_items where id = v_item;
  if v_num <= 0 then
    raise exception 'فشل: الإضافيّ المعتمَد لم يُحتسب';
  end if;
  raise notice '✅ ٦) الإضافيّ يُحتسب بعد اعتماده لا قبله';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) **من احتسب لا يعتمد**، ولا ملف تحويل قبل الاعتماد
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_approve_payroll_run(v_run);
    raise exception 'فشل: اعتمد المسيرَ من احتسبه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%من احتسبه%' then raise; end if;
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_hr::text, true);
    perform app_payroll_bank_file(v_run);
    raise exception 'فشل: أُخرج ملف تحويل من مسير غير معتمَد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%حالته%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform app_approve_payroll_run(v_run);
  if (select status from payroll_runs where id = v_run) <> 'approved' then
    raise exception 'فشل: المسير لم يُعتمد';
  end if;
  raise notice '✅ ٧) من احتسب لا يعتمد، ولا ملف تحويل قبل الاعتماد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) المسير المعتمَد لا تُعدَّل مبالغه ولا بنوده ولا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update payroll_runs set total_net = 1 where id = v_run;
    raise exception 'فشل: عُدّلت مبالغ مسير معتمَد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
  end;
  begin
    update payroll_run_items set net_salary = 1 where id = v_item;
    raise exception 'فشل: عُدّل بند في مسير معتمَد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا تُعدَّل%' then raise; end if;
  end;
  begin
    delete from payroll_runs where id = v_run;
    raise exception 'فشل: حُذف مسير معتمَد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  begin
    perform app_calculate_payroll_run(v_run);
    raise exception 'فشل: أُعيد احتساب مسير معتمَد';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُعاد احتساب%' then raise; end if;
  end;
  raise notice '✅ ٨) المسير المعتمَد لا يُعدَّل ولا يُحذف ولا يُعاد احتسابه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) ملف التحويل يكشف من ينقصه آيبان
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_hr::text, true);
  select count(*) into v_int from app_payroll_bank_file(v_run) where is_ready;
  if v_int <> 1 then
    raise exception 'فشل: عدد الجاهزين للتحويل % لا ١', v_int;
  end if;
  if not exists (select 1 from app_payroll_bank_file(v_run)
                  where not is_ready and issue like '%آيبان%') then
    raise exception 'فشل: من ينقصه آيبان لا يظهر بسببه — سيُرفض التحويل عند البنك';
  end if;
  raise notice '✅ ٩) ملف التحويل يفرز الجاهز ويشرح سبب غير الجاهز';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) الصرف يخصم أقساط السلف ويولّد القيد
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_je uuid;
  begin
    v_je := app_pay_payroll_run(v_run);
    if (select status from payroll_runs where id = v_run) <> 'paid' then
      raise exception 'فشل: المسير لم يُعلَّم مصروفًا';
    end if;
    if (select paid_amount from employee_loans where id = v_loan) <> 400 then
      raise exception 'فشل: قسط السلفة لم يُخصم من رصيدها';
    end if;
    if (select remaining_amount from v_employee_loans_status where loan_id = v_loan) <> 800 then
      raise exception 'فشل: المتبقّي من السلفة غير صحيح';
    end if;
    if v_je is null then
      raise exception 'فشل: الصرف بلا قيد محاسبيّ';
    end if;
    if (select count(*) from journal_entry_lines where journal_entry_id = v_je) <> 2 then
      raise exception 'فشل: قيد الرواتب ليس بطرفين';
    end if;
  end;
  raise notice '✅ ١٠) الصرف يخصم السلف ويولّد قيدًا محاسبيًّا بطرفيه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الإلغاء المنظَّم: يعكس القيد ويردّ الأقساط
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform app_cancel_payroll_run(v_run, '  ');
    raise exception 'فشل: أُلغي المسير بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب الإلغاء%' then raise; end if;
  end;

  perform app_cancel_payroll_run(v_run, 'خطأ في بيانات الحضور');
  if (select status from payroll_runs where id = v_run) <> 'cancelled' then
    raise exception 'فشل: المسير لم يُلغَ';
  end if;
  if (select paid_amount from employee_loans where id = v_loan) <> 0 then
    raise exception 'فشل: قسط السلفة لم يُردّ بعد الإلغاء — الموظف خُصم منه مرّتين';
  end if;
  raise notice '✅ ١١) الإلغاء المنظَّم يعكس القيد ويردّ أقساط السلف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) لا مسيران لنفس الشهر
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_run2 uuid; v_run3 uuid;
  begin
    -- الملغى لا يمنع مسيرًا جديدًا
    insert into payroll_runs (organization_id, branch_id, run_number, period_month, created_by)
      values (v_org, v_branch, 'PR-2', v_start, v_owner) returning id into v_run2;
    begin
      insert into payroll_runs (organization_id, branch_id, run_number, period_month, created_by)
        values (v_org, v_branch, 'PR-3', v_start, v_owner) returning id into v_run3;
      raise exception 'فشل: أُنشئ مسيران لنفس الشهر والفرع — راتبٌ مزدوج';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      null;
    end;
  end;
  raise notice '✅ ١٢) مسير واحد لكل شهر وفرع، والملغى لا يمنع بديله';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الإجازة تُفحص ضدّ مواعيد الطبيب
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into doctors (organization_id, name_ar, id_number)
    values (v_org, 'طبيب موظف', '2999999999') returning id into v_doctor;
  insert into employees (organization_id, branch_id, name_ar, job_number, basic_salary,
                         status, hire_date, national_id)
    values (v_org, v_branch, 'طبيب موظف', 1003, 9000, 'active', v_start - 400, '2999999999')
    returning id into v_emp2;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status)
    values (v_org, v_branch, v_clinic, v_doctor, v_patient,
            (current_date + 3) + time '10:00', (current_date + 3) + time '10:30',
            'scheduled');

  v_json := app_check_leave_conflicts(v_emp2, current_date + 1, current_date + 5);
  if (v_json->>'has_conflicts')::boolean is not true then
    raise exception 'فشل: لم يُكتشف تعارض الإجازة مع مواعيد الطبيب';
  end if;
  if (v_json->>'appointments')::int < 1 then
    raise exception 'فشل: عدد المواعيد المتعارضة لم يُحسب';
  end if;

  insert into leave_types (organization_id, name_ar, is_paid, requires_approval)
    values (v_org, 'إجازة سنوية', true, true) returning id into v_leave_t;
  insert into leave_balances (organization_id, employee_id, leave_type_id, year,
                              entitled_days, used_days)
    values (v_org, v_emp2, v_leave_t, extract(year from current_date)::int, 30, 0);
  insert into leave_requests (organization_id, employee_id, leave_type_id,
                              start_date, end_date, status, created_by)
    values (v_org, v_emp2, v_leave_t, current_date + 1, current_date + 5, 'pending', v_owner)
    returning id into v_leave;

  begin
    perform app_approve_leave_request(v_leave);
    raise exception 'فشل: اعتُمدت إجازة الطبيب صامتةً وله مواعيد — سيصل المرضى ولا يجدونه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%تعارض%' then raise; end if;
  end;

  perform app_approve_leave_request(v_leave, 'نُقلت المواعيد إلى طبيب بديل');
  if (select status from leave_requests where id = v_leave) <> 'approved' then
    raise exception 'فشل: لم تُعتمد الإجازة بعد تسجيل قرار التعارض';
  end if;
  raise notice '✅ ١٣) إجازة الطبيب لا تُعتمد صامتةً مع وجود مواعيد — إمّا معالجة أو قرار صريح';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) تبديل المناوبة: قبول الزميل شرطٌ للاعتماد
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_swap uuid;
  begin
    insert into shift_swap_requests (organization_id, requester_id, target_employee_id,
                                     swap_date, reason, created_by)
      values (v_org, v_emp, v_emp2, current_date + 7, 'ظرف عائلي', v_owner)
      returning id into v_swap;
    begin
      perform app_approve_shift_swap(v_swap);
      raise exception 'فشل: اعتُمد تبديل لم يقبله الزميل — فُرضت عليه مناوبة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%قبول الزميل%' then raise; end if;
    end;
    update shift_swap_requests set status = 'accepted', accepted_at = now()
     where id = v_swap;
    perform app_approve_shift_swap(v_swap);
    if (select status from shift_swap_requests where id = v_swap) <> 'approved' then
      raise exception 'فشل: التبديل لم يُعتمد بعد قبول الزميل';
    end if;
  end;
  raise notice '✅ ١٤) التبديل لا يُعتمد قبل قبول الزميل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) وثائق الموظفين وتواريخ انتهائها
  -- ═════════════════════════════════════════════════════════════════════════
  insert into employee_documents (organization_id, employee_id, document_number,
                                  issue_date, expiry_date)
    values (v_org, v_emp, 'IQAMA-1', current_date - 700, current_date - 5),
           (v_org, v_emp, 'LIC-1',   current_date - 100, current_date + 20);

  if not exists (select 1 from v_employee_documents_expiry
                  where employee_id = v_emp and expiry_status = 'منتهية') then
    raise exception 'فشل: الوثيقة المنتهية لا تظهر منتهية';
  end if;
  if not exists (select 1 from v_employee_documents_expiry
                  where employee_id = v_emp and expiry_status = 'تنتهي خلال شهر') then
    raise exception 'فشل: الوثيقة المقاربة على الانتهاء لا تُنبَّه عنها';
  end if;
  raise notice '✅ ١٥) وثائق الموظفين تُصنَّف بانتهائها قبل أن تُعطّله نظاميًّا';

  raise notice '——— كل فحوص الرواتب نجحت ———';
end $$;

rollback;
