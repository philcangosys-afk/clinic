-- ==========================================================================
-- ZainCare — الجزء 4 — بيانات تجريبية وعلامة تجارية (اختياري تمامًا)
-- ==========================================================================
-- ⚠️ هذا الملف **يُدخل بيانات وهمية** في قاعدتك: مرضى وأطباء وموظفون
--    ومواعيد بأسماء وأرقام هوية مخترعة. أنت اشترطت «عدم وضع بيانات
--    وهمية» — فلا تشغّله على قاعدة ستستقبل مرضى حقيقيين.
--
-- يعمل فقط إن وُجدت منشأة اسمها بالضبط «مجمع زين الطبي»؛ وإلّا
-- تخطّت 0118 بصمت و**توقّفت 0132 بخطأ**.
--
-- يُشغَّل بعد الجزء 3 إن اخترت تشغيله أصلًا.
-- ==========================================================================



-- ==========================================================================
-- [1/4]  0118_zaincare_demo_data.sql
--          بيانات تجريبية: أقسام وعيادات وأطباء وموظفون ومرضى
-- ==========================================================================


insert into public.feature_catalog (
  feature_key,
  name_ar,
  name_en,
  category_key,
  description_ar,
  is_core,
  display_order
)
values (
  'integrations',
  'التكاملات',
  'Integrations',
  'administration',
  'إعدادات تكامل المركز مع الأنظمة الخارجية',
  false,
  390
)
on conflict (feature_key) do nothing;

insert into public.organization_features (organization_id, feature_key, enabled)
select organization.id, 'integrations', true
from public.organizations organization
on conflict (organization_id, feature_key)
do update set enabled = true;

do $seed$
declare
  v_org uuid;
  v_branch uuid;
  v_owner uuid;
  v_family_department uuid;
  v_dental_department uuid;
  v_lab_department uuid;
  v_radiology_department uuid;
  v_pharmacy_department uuid;
  v_admin_department uuid;
  v_family_clinic uuid;
  v_dental_clinic uuid;
  v_lab_clinic uuid;
  v_radiology_clinic uuid;
  v_pharmacy_clinic uuid;
  v_family_doctor uuid;
  v_dental_doctor uuid;
  v_diagnostics_doctor uuid;
  v_patient_one uuid;
  v_patient_two uuid;
  v_patient_three uuid;
  v_base_price_list uuid;
  v_fiscal_year uuid;
  v_register uuid;
  v_revenue_account uuid;
begin
  select id into v_org
  from public.organizations
  where name = 'مجمع زين الطبي'
  order by created_at
  limit 1;

  if v_org is null then
    raise notice 'لم تُضف البيانات التجريبية: منشأة مجمع زين الطبي غير موجودة';
    return;
  end if;

  select id into v_branch
  from public.branches
  where organization_id = v_org
  order by created_at
  limit 1;

  if v_branch is null then
    raise exception 'لا يمكن إضافة البيانات التجريبية دون فرع رئيسي';
  end if;

  select user_id into v_owner
  from public.organization_memberships
  where organization_id = v_org
    and role_key = 'owner'
    and is_active
  order by created_at
  limit 1;

  insert into public.departments (
    organization_id, code, name_ar, name_en, department_type, is_clinical, sort_order
  )
  select v_org, seed.code, seed.name_ar, seed.name_en, seed.department_type, seed.is_clinical, seed.sort_order
  from (values
    ('DEMO-OPD', 'قسم العيادات الخارجية', 'Outpatient Department', 'clinical', true, 10),
    ('DEMO-DENT', 'قسم الأسنان', 'Dental Department', 'clinical', true, 20),
    ('DEMO-LAB', 'قسم المختبر', 'Laboratory Department', 'laboratory', true, 30),
    ('DEMO-RAD', 'قسم الأشعة', 'Radiology Department', 'radiology', true, 40),
    ('DEMO-PHARM', 'قسم الصيدلية', 'Pharmacy Department', 'pharmacy', false, 50),
    ('DEMO-ADMIN', 'قسم الموارد البشرية والإدارة', 'HR and Administration', 'administrative', false, 60)
  ) as seed(code, name_ar, name_en, department_type, is_clinical, sort_order)
  where not exists (
    select 1 from public.departments department
    where department.organization_id = v_org and department.code = seed.code
  );

  select id into v_family_department from public.departments where organization_id = v_org and code = 'DEMO-OPD' limit 1;
  select id into v_dental_department from public.departments where organization_id = v_org and code = 'DEMO-DENT' limit 1;
  select id into v_lab_department from public.departments where organization_id = v_org and code = 'DEMO-LAB' limit 1;
  select id into v_radiology_department from public.departments where organization_id = v_org and code = 'DEMO-RAD' limit 1;
  select id into v_pharmacy_department from public.departments where organization_id = v_org and code = 'DEMO-PHARM' limit 1;
  select id into v_admin_department from public.departments where organization_id = v_org and code = 'DEMO-ADMIN' limit 1;

  insert into public.clinics (
    organization_id, branch_id, department_id, code, name, name_en, clinic_type,
    floor, room_number, default_visit_duration, allows_walk_in,
    allows_online_booking, capacity, color, sort_order
  )
  values
    (v_org, v_branch, v_family_department, 'DEMO-FAMILY', 'عيادة طب الأسرة', 'Family Medicine Clinic', 'clinic', 'الأرضي', '101', 30, true, true, 12, '#2A9D8F', 10),
    (v_org, v_branch, v_dental_department, 'DEMO-DENTAL', 'عيادة الأسنان', 'Dental Clinic', 'clinic', 'الأول', '201', 45, true, true, 8, '#457B9D', 20),
    (v_org, v_branch, v_lab_department, 'DEMO-LAB', 'مختبر التحاليل', 'Clinical Laboratory', 'laboratory', 'الأرضي', '105', 20, true, false, 15, '#8E44AD', 30),
    (v_org, v_branch, v_radiology_department, 'DEMO-RAD', 'قسم الأشعة', 'Radiology Unit', 'radiology', 'الأرضي', '110', 30, true, false, 10, '#E76F51', 40),
    (v_org, v_branch, v_pharmacy_department, 'DEMO-PHARM', 'صيدلية المركز', 'Medical Center Pharmacy', 'pharmacy', 'الأرضي', '102', 15, true, false, 20, '#F4A261', 50)
  on conflict (organization_id, code) do update set
    branch_id = excluded.branch_id,
    department_id = excluded.department_id,
    is_disabled = false;

  select id into v_family_clinic from public.clinics where organization_id = v_org and code = 'DEMO-FAMILY';
  select id into v_dental_clinic from public.clinics where organization_id = v_org and code = 'DEMO-DENTAL';
  select id into v_lab_clinic from public.clinics where organization_id = v_org and code = 'DEMO-LAB';
  select id into v_radiology_clinic from public.clinics where organization_id = v_org and code = 'DEMO-RAD';
  select id into v_pharmacy_clinic from public.clinics where organization_id = v_org and code = 'DEMO-PHARM';

  insert into public.resources (
    organization_id, branch_id, clinic_id, resource_type, code, name_ar, name_en, capacity, note
  )
  select v_org, v_branch, seed.clinic_id, seed.resource_type, seed.code,
         seed.name_ar, seed.name_en, seed.capacity, 'بيانات تجريبية'
  from (values
    (v_family_clinic, 'room', 'DEMO-ROOM-FAMILY', 'غرفة طب الأسرة', 'Family Medicine Room', 1),
    (v_dental_clinic, 'chair', 'DEMO-DENTAL-CHAIR', 'كرسي أسنان', 'Dental Chair', 1),
    (v_lab_clinic, 'room', 'DEMO-SAMPLE-ROOM', 'غرفة سحب عينات', 'Sample Collection Room', 2),
    (v_lab_clinic, 'device', 'DEMO-CBC-DEVICE', 'جهاز تحليل CBC', 'CBC Analyzer', 1),
    (v_radiology_clinic, 'device', 'DEMO-XRAY-DEVICE', 'جهاز أشعة سينية', 'X-Ray Machine', 1),
    (v_pharmacy_clinic, 'room', 'DEMO-PHARM-STORE', 'مستودع صيدلية', 'Pharmacy Store', 1)
  ) as seed(clinic_id, resource_type, code, name_ar, name_en, capacity)
  where not exists (
    select 1 from public.resources resource
    where resource.organization_id = v_org and resource.code = seed.code
  );

  insert into public.doctors (
    organization_id, clinic_id, name_ar, name_en, job_title, gender,
    mobile_number, email, default_appointment_duration_minutes,
    patient_waiting_minutes, is_enabled, notes
  )
  select v_org, seed.clinic_id, seed.name_ar, seed.name_en, seed.job_title,
         seed.gender, seed.mobile_number, seed.email, seed.duration, 10, true,
         'طبيب تجريبي لاختبار النظام'
  from (values
    (v_family_clinic, 'د. خالد عبدالعزيز', 'Dr. Khalid Abdulaziz', 'استشاري طب الأسرة', 'male', '0500000101', 'khalid.demo@zaincare.test', 30),
    (v_dental_clinic, 'د. ريم عبدالله', 'Dr. Reem Abdullah', 'طبيبة أسنان', 'female', '0500000102', 'reem.demo@zaincare.test', 45),
    (v_radiology_clinic, 'د. نورة السالم', 'Dr. Noura Al-Salem', 'طبيبة أشعة تشخيصية', 'female', '0500000103', 'noura.demo@zaincare.test', 30)
  ) as seed(clinic_id, name_ar, name_en, job_title, gender, mobile_number, email, duration)
  where not exists (
    select 1 from public.doctors doctor
    where doctor.organization_id = v_org and doctor.email = seed.email
  );

  select id into v_family_doctor from public.doctors where organization_id = v_org and email = 'khalid.demo@zaincare.test';
  select id into v_dental_doctor from public.doctors where organization_id = v_org and email = 'reem.demo@zaincare.test';
  select id into v_diagnostics_doctor from public.doctors where organization_id = v_org and email = 'noura.demo@zaincare.test';

  insert into public.doctor_branches (organization_id, doctor_id, branch_id, is_primary)
  values
    (v_org, v_family_doctor, v_branch, true),
    (v_org, v_dental_doctor, v_branch, true),
    (v_org, v_diagnostics_doctor, v_branch, true)
  on conflict (doctor_id, branch_id) do update set is_active = true;

  insert into public.doctor_clinics (organization_id, doctor_id, clinic_id, branch_id, is_primary)
  values
    (v_org, v_family_doctor, v_family_clinic, v_branch, true),
    (v_org, v_dental_doctor, v_dental_clinic, v_branch, true),
    (v_org, v_diagnostics_doctor, v_radiology_clinic, v_branch, true)
  on conflict (doctor_id, clinic_id) do update set is_active = true;

  insert into public.employees (
    organization_id, branch_id, department_id, name_ar, name_en, mobile_1,
    job_number, job_title, hire_date, basic_salary, housing_allowance,
    transportation_allowance, status, note
  )
  select v_org, v_branch, seed.department_id, seed.name_ar, seed.name_en,
         seed.mobile, seed.job_number, seed.job_title, current_date - 180,
         seed.salary, seed.housing, seed.transport, 'active', 'موظف تجريبي لاختبار النظام'
  from (values
    (v_family_department, 'سارة محمد', 'Sarah Mohammed', '0500000201', 'DEMO-E001', 'موظفة استقبال', 5000::numeric, 1000::numeric, 500::numeric),
    (v_family_department, 'عبدالله حسن', 'Abdullah Hassan', '0500000202', 'DEMO-E002', 'ممرض', 6500::numeric, 1300::numeric, 600::numeric),
    (v_pharmacy_department, 'ليان أحمد', 'Layan Ahmed', '0500000203', 'DEMO-E003', 'صيدلي', 8000::numeric, 1600::numeric, 700::numeric),
    (v_lab_department, 'عمر علي', 'Omar Ali', '0500000204', 'DEMO-E004', 'فني مختبر', 7000::numeric, 1400::numeric, 600::numeric),
    (v_admin_department, 'ماجد سالم', 'Majed Salem', '0500000205', 'DEMO-E005', 'محاسب', 7500::numeric, 1500::numeric, 700::numeric),
    (v_admin_department, 'هدى يوسف', 'Huda Yousef', '0500000206', 'DEMO-E006', 'مسؤولة موارد بشرية', 7500::numeric, 1500::numeric, 700::numeric)
  ) as seed(department_id, name_ar, name_en, mobile, job_number, job_title, salary, housing, transport)
  where not exists (
    select 1 from public.employees employee
    where employee.organization_id = v_org and employee.job_number = seed.job_number
  );

  insert into public.patients (
    organization_id, branch_id, name_ar, name_en, birth_date, gender,
    id_type, id_number, mobile_number, email_1, address, district,
    preferred_language, block_sms, block_sms_reason, general_note
  )
  select v_org, v_branch, seed.name_ar, seed.name_en, seed.birth_date,
         seed.gender, seed.id_type, seed.id_number, seed.mobile, seed.email,
         'الرياض', seed.district, seed.language, true,
         'بيانات تجريبية — يمنع إرسال الرسائل', 'مريض تجريبي لاختبار رحلة المريض'
  from (values
    ('أحمد المطيري', 'Ahmed Al-Mutairi', date '1988-04-12', 'male', 'national_id', '1000000001', '0500000301', 'ahmed.demo@zaincare.test', 'الياسمين', 'ar'),
    ('نوف القحطاني', 'Nouf Al-Qahtani', date '1994-09-25', 'female', 'national_id', '1000000002', '0500000302', 'nouf.demo@zaincare.test', 'الملقا', 'ar'),
    ('يوسف العتيبي', 'Yousef Al-Otaibi', date '2015-02-08', 'male', 'national_id', '1000000003', '0500000303', 'yousef.demo@zaincare.test', 'النرجس', 'ar')
  ) as seed(name_ar, name_en, birth_date, gender, id_type, id_number, mobile, email, district, language)
  where not exists (
    select 1 from public.patients patient
    where patient.organization_id = v_org and patient.id_number = seed.id_number
  );

  select id into v_patient_one from public.patients where organization_id = v_org and id_number = '1000000001';
  select id into v_patient_two from public.patients where organization_id = v_org and id_number = '1000000002';
  select id into v_patient_three from public.patients where organization_id = v_org and id_number = '1000000003';

  insert into public.chart_of_accounts (organization_id, code, name_ar, name_en, account_type)
  values
    (v_org, '1000', 'الأصول', 'Assets', 'asset'),
    (v_org, '1100', 'الصندوق والبنوك', 'Cash and Banks', 'asset'),
    (v_org, '2000', 'الالتزامات', 'Liabilities', 'liability'),
    (v_org, '3000', 'حقوق الملكية', 'Equity', 'equity'),
    (v_org, '4000', 'إيرادات الخدمات الطبية', 'Medical Services Revenue', 'revenue'),
    (v_org, '5000', 'المصروفات التشغيلية', 'Operating Expenses', 'expense')
  on conflict (organization_id, code) do nothing;

  select id into v_revenue_account
  from public.chart_of_accounts
  where organization_id = v_org and code = '4000';

  insert into public.items (
    organization_id, item_type, code, name_ar, name_en, unit, price,
    medical_service_type, default_clinic_id, duration_minutes, provider_role,
    requires_appointment, revenue_account_id, description_ar
  )
  values
    (v_org, 'service', 'DEMO-SVC-FAMILY', 'استشارة طب أسرة', 'Family Medicine Consultation', 'زيارة', 150, 'consultation', v_family_clinic, 30, 'doctor', true, v_revenue_account, 'استشارة طبية تجريبية'),
    (v_org, 'service', 'DEMO-SVC-DENTAL', 'استشارة أسنان', 'Dental Consultation', 'زيارة', 120, 'dental', v_dental_clinic, 30, 'doctor', true, v_revenue_account, 'استشارة أسنان تجريبية'),
    (v_org, 'service', 'DEMO-SVC-CBC', 'تحليل صورة دم كاملة', 'Complete Blood Count', 'تحليل', 80, 'laboratory', v_lab_clinic, 20, 'technician', false, v_revenue_account, 'تحليل CBC تجريبي'),
    (v_org, 'service', 'DEMO-SVC-XRAY', 'أشعة سينية للصدر', 'Chest X-Ray', 'فحص', 200, 'radiology', v_radiology_clinic, 30, 'technician', true, v_revenue_account, 'فحص أشعة تجريبي'),
    (v_org, 'service', 'DEMO-SVC-DISPENSE', 'صرف دواء', 'Medication Dispensing', 'خدمة', 25, 'other', v_pharmacy_clinic, 15, 'pharmacist', false, v_revenue_account, 'خدمة صرف تجريبية'),
    (v_org, 'service', 'DEMO-SVC-CLEANING', 'جلسة تنظيف أسنان', 'Dental Cleaning Session', 'جلسة', 250, 'dental', v_dental_clinic, 45, 'doctor', true, v_revenue_account, 'جلسة تنظيف أسنان تجريبية')
  on conflict (organization_id, code) do update set
    price = excluded.price,
    default_clinic_id = excluded.default_clinic_id,
    revenue_account_id = excluded.revenue_account_id,
    is_disabled = false,
    is_archived = false;

  select id into v_base_price_list
  from public.price_lists
  where organization_id = v_org and list_kind = 'base' and name = 'قائمة الأسعار الأساسية التجريبية'
  limit 1;

  if v_base_price_list is null then
    insert into public.price_lists (
      organization_id, name, list_kind, priority, effective_from, is_active, note
    ) values (
      v_org, 'قائمة الأسعار الأساسية التجريبية', 'base', 100,
      current_date, true, 'قائمة تجريبية لاختبار التسعير والفوترة'
    ) returning id into v_base_price_list;
  end if;

  insert into public.price_list_items (
    organization_id, price_list_id, item_id, price, discount_percent, effective_from
  )
  select v_org, v_base_price_list, item.id, item.price, 0, current_date
  from public.items item
  where item.organization_id = v_org and item.code like 'DEMO-SVC-%'
  on conflict (price_list_id, item_id) where effective_to is null
  do update set price = excluded.price, discount_percent = 0;

  insert into public.organization_vat_settings (
    organization_id, sales_vat_enabled, purchase_vat_enabled,
    print_price_with_vat, legal_name_ar, legal_name_en, vat_status,
    default_vat_rate, city, country_code, default_document_type,
    numbering_scope, invoice_number_prefix
  ) values (
    v_org, true, true, true, 'مجمع زين الطبي', 'Zain Medical Center',
    'not_registered', 15, 'الرياض', 'SA', 'simplified', 'organization', 'ZMC'
  ) on conflict (organization_id) do update set
    sales_vat_enabled = true,
    purchase_vat_enabled = true,
    default_vat_rate = 15,
    country_code = 'SA';

  select id into v_fiscal_year
  from public.fiscal_years
  where organization_id = v_org
    and current_date between start_date and end_date
  limit 1;

  if v_fiscal_year is null then
    insert into public.fiscal_years (
      organization_id, name, start_date, end_date, status
    ) values (
      v_org,
      'السنة المالية ' || extract(year from current_date)::integer,
      date_trunc('year', current_date)::date,
      (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
      'open'
    ) returning id into v_fiscal_year;
  end if;

  insert into public.fiscal_periods (
    organization_id, fiscal_year_id, period_number, name, start_date, end_date, status
  )
  select v_org, v_fiscal_year, 1, 'الفترة السنوية التجريبية',
         year.start_date, year.end_date, 'open'
  from public.fiscal_years year
  where year.id = v_fiscal_year
    and not exists (
      select 1 from public.fiscal_periods period
      where period.fiscal_year_id = v_fiscal_year and period.period_number = 1
    );

  select id into v_register
  from public.cash_registers
  where organization_id = v_org and code = 'DEMO-RECEPTION'
  limit 1;

  if v_register is null then
    insert into public.cash_registers (
      organization_id, branch_id, name, code, requires_shift, allow_negative
    ) values (
      v_org, v_branch, 'صندوق الاستقبال التجريبي', 'DEMO-RECEPTION', true, false
    ) returning id into v_register;
  end if;

  if v_owner is not null and not exists (
    select 1 from public.cash_register_shifts
    where cash_register_id = v_register and status = 'open'
  ) then
    insert into public.cash_register_shifts (
      organization_id, branch_id, cash_register_id, status,
      opened_by, opening_balance, note
    ) values (
      v_org, v_branch, v_register, 'open', v_owner, 500,
      'مناوبة تجريبية لاختبار صندوق الاستقبال'
    );
  end if;

  insert into public.appointments (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, item_id,
    scheduled_start, scheduled_end, status, priority, queue_number,
    sms_reminder_sent, note
  )
  select v_org, v_branch, seed.clinic_id, seed.doctor_id, seed.patient_id,
         item.id, seed.starts_at, seed.ends_at, 'waiting', seed.priority,
         seed.queue_number, false, seed.note
  from (values
    (v_family_clinic, v_family_doctor, v_patient_one, 'DEMO-SVC-FAMILY',
      date_trunc('day', now()) + interval '9 hours', date_trunc('day', now()) + interval '9 hours 30 minutes', 'normal', 1, 'DEMO-APT-001 — موعد تجريبي لطب الأسرة'),
    (v_dental_clinic, v_dental_doctor, v_patient_two, 'DEMO-SVC-CLEANING',
      date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 45 minutes', 'normal', 2, 'DEMO-APT-002 — موعد تجريبي للأسنان'),
    (v_radiology_clinic, v_diagnostics_doctor, v_patient_three, 'DEMO-SVC-XRAY',
      date_trunc('day', now()) + interval '11 hours', date_trunc('day', now()) + interval '11 hours 30 minutes', 'urgent', 3, 'DEMO-APT-003 — موعد تجريبي للأشعة')
  ) as seed(clinic_id, doctor_id, patient_id, item_code, starts_at, ends_at, priority, queue_number, note)
  join public.items item
    on item.organization_id = v_org and item.code = seed.item_code
  where not exists (
    select 1 from public.appointments appointment
    where appointment.organization_id = v_org and appointment.note = seed.note
  );
end
$seed$;


-- ==========================================================================
-- [2/4]  0119_demo_clinical_operations.sql
--          بيانات تجريبية: مواعيد وعمليات سريرية
-- ==========================================================================


do $seed$
declare
  v_org uuid;
  v_branch uuid;
  v_owner uuid;
  v_visit uuid;
  v_patient uuid;
  v_doctor uuid;
  v_lab_department uuid;
  v_radiology_department uuid;
  v_lab_clinic uuid;
  v_radiology_clinic uuid;
  v_pharmacy_clinic uuid;
  v_lab_item uuid;
  v_radiology_item uuid;
  v_drug_item uuid;
  v_lab_category uuid;
  v_lab_test uuid;
  v_component uuid;
  v_lab_order uuid;
  v_radiology_category uuid;
  v_radiology_exam uuid;
  v_radiology_order uuid;
  v_xray_resource uuid;
  v_warehouse uuid;
  v_price_list uuid;
begin
  select id into v_org
  from public.organizations
  where name = 'مجمع زين الطبي'
  order by created_at
  limit 1;

  if v_org is null then
    raise notice 'لم تُضف البيانات الطبية التجريبية: منشأة مجمع زين الطبي غير موجودة';
    return;
  end if;

  select user_id into v_owner
  from public.organization_memberships
  where organization_id = v_org and role_key = 'owner' and is_active
  order by created_at
  limit 1;

  select a.branch_id, a.patient_id, a.doctor_id, pv.id
  into v_branch, v_patient, v_doctor, v_visit
  from public.appointments a
  left join public.patient_visits pv on pv.appointment_id = a.id
  where a.organization_id = v_org and a.note like 'DEMO-APT-001%'
  limit 1;

  select id into v_lab_department from public.departments where organization_id = v_org and code = 'DEMO-LAB';
  select id into v_radiology_department from public.departments where organization_id = v_org and code = 'DEMO-RAD';
  select id into v_lab_clinic from public.clinics where organization_id = v_org and code = 'DEMO-LAB';
  select id into v_radiology_clinic from public.clinics where organization_id = v_org and code = 'DEMO-RAD';
  select id into v_pharmacy_clinic from public.clinics where organization_id = v_org and code = 'DEMO-PHARM';
  select id into v_lab_item from public.items where organization_id = v_org and code = 'DEMO-SVC-CBC';
  select id into v_radiology_item from public.items where organization_id = v_org and code = 'DEMO-SVC-XRAY';
  select id into v_xray_resource from public.resources where organization_id = v_org and code = 'DEMO-XRAY-DEVICE';

  select id into v_lab_category
  from public.lab_test_categories
  where organization_id = v_org and name_ar = 'أمراض الدم'
  limit 1;

  if v_lab_category is null then
    insert into public.lab_test_categories (organization_id, name_ar, name_en, sort_order)
    values (v_org, 'أمراض الدم', 'Hematology', 10)
    returning id into v_lab_category;
  end if;

  select id into v_lab_test
  from public.lab_tests
  where organization_id = v_org and code = 'DEMO-CBC'
  limit 1;

  if v_lab_test is null then
    insert into public.lab_tests (
      organization_id, category_id, billing_item_id, code, name_ar, name_en,
      specimen_type, specimen_container, specimen_volume_ml, turnaround_hours,
      collection_instructions_ar, department_id, loinc_code, is_panel,
      requires_approval, sort_order, created_by
    ) values (
      v_org, v_lab_category, v_lab_item, 'DEMO-CBC', 'صورة دم كاملة',
      'Complete Blood Count', 'blood', 'EDTA بنفسجي', 2, 4,
      'تقليب الأنبوب برفق بعد السحب', v_lab_department, '57021-8', true,
      true, 10, v_owner
    ) returning id into v_lab_test;
  end if;

  insert into public.lab_test_components (
    organization_id, lab_test_id, component_code, name_ar, name_en,
    unit, data_type, decimal_places, loinc_code, sort_order
  ) values
    (v_org, v_lab_test, 'HGB', 'الهيموغلوبين', 'Hemoglobin', 'g/dL', 'numeric', 1, '718-7', 10),
    (v_org, v_lab_test, 'WBC', 'كريات الدم البيضاء', 'White Blood Cells', '10^9/L', 'numeric', 1, '6690-2', 20),
    (v_org, v_lab_test, 'PLT', 'الصفائح الدموية', 'Platelets', '10^9/L', 'numeric', 0, '777-3', 30)
  on conflict (lab_test_id, component_code) do update set
    name_ar = excluded.name_ar,
    unit = excluded.unit,
    is_active = true;

  select id into v_component
  from public.lab_test_components
  where lab_test_id = v_lab_test and component_code = 'HGB';

  if not exists (
    select 1 from public.lab_reference_ranges
    where lab_test_id = v_lab_test and component_id = v_component and gender = 'any'
  ) then
    insert into public.lab_reference_ranges (
      organization_id, lab_test_id, component_id, gender,
      unit, low_value, high_value, critical_low, critical_high,
      note, created_by
    ) values (
      v_org, v_lab_test, v_component, 'any', 'g/dL', 12, 17.5, 7, 20,
      'مدى مرجعي تجريبي للبالغين', v_owner
    );
  end if;

  if v_visit is not null then
    select id into v_lab_order
    from public.lab_orders
    where organization_id = v_org and notes = 'DEMO-LAB-ORDER-001'
    limit 1;

    if v_lab_order is null then
      insert into public.lab_orders (
        organization_id, branch_id, patient_id, ordering_doctor_id,
        visit_id, clinic_id, status, priority, notes
      ) values (
        v_org, v_branch, v_patient, v_doctor, v_visit, v_lab_clinic,
        'ordered', 'routine', 'DEMO-LAB-ORDER-001'
      ) returning id into v_lab_order;

      insert into public.lab_order_items (organization_id, lab_order_id, lab_test_id)
      values (v_org, v_lab_order, v_lab_test);
    end if;
  end if;

  select id into v_radiology_category
  from public.radiology_exam_categories
  where organization_id = v_org and name_ar = 'الأشعة السينية'
  limit 1;

  if v_radiology_category is null then
    insert into public.radiology_exam_categories (organization_id, name_ar, name_en, sort_order)
    values (v_org, 'الأشعة السينية', 'X-Ray', 10)
    returning id into v_radiology_category;
  end if;

  select id into v_radiology_exam
  from public.radiology_exams
  where organization_id = v_org and code = 'DEMO-CXR'
  limit 1;

  if v_radiology_exam is null then
    insert into public.radiology_exams (
      organization_id, category_id, billing_item_id, code, name_ar, name_en,
      modality, body_part, pregnancy_check_required, requires_contrast,
      estimated_duration_minutes, radiation_dose_msv, department_id,
      preparation_instructions, requires_approval, sort_order, created_by
    ) values (
      v_org, v_radiology_category, v_radiology_item, 'DEMO-CXR',
      'أشعة سينية للصدر', 'Chest X-Ray', 'xray', 'chest', true, false,
      15, 0.1, v_radiology_department,
      'إزالة المعادن من منطقة الصدر قبل التصوير', true, 10, v_owner
    ) returning id into v_radiology_exam;
  end if;

  if v_visit is not null then
    select id into v_radiology_order
    from public.radiology_orders
    where organization_id = v_org and notes = 'DEMO-RAD-ORDER-001'
    limit 1;

    if v_radiology_order is null then
      insert into public.radiology_orders (
        organization_id, branch_id, patient_id, ordering_doctor_id,
        visit_id, clinic_id, resource_id, status, priority,
        clinical_indication, pregnancy_confirmed_not, notes
      ) values (
        v_org, v_branch, v_patient, v_doctor, v_visit, v_radiology_clinic,
        v_xray_resource, 'scheduled', 'routine',
        'استبعاد التهاب صدري — طلب تجريبي', true, 'DEMO-RAD-ORDER-001'
      ) returning id into v_radiology_order;

      insert into public.radiology_order_items (radiology_order_id, radiology_exam_id)
      values (v_radiology_order, v_radiology_exam);
    end if;
  end if;

  insert into public.warehouses (
    organization_id, branch_id, code, name, note, is_disabled
  ) values (
    v_org, v_branch, 'DEMO-PHARMACY', 'مستودع صيدلية المركز',
    'مستودع تجريبي للصرف بنظام FEFO', false
  ) on conflict (organization_id, code) do update set
    branch_id = excluded.branch_id,
    is_disabled = false;

  select id into v_warehouse
  from public.warehouses
  where organization_id = v_org and code = 'DEMO-PHARMACY';

  insert into public.items (
    organization_id, item_type, code, name_ar, name_en, unit, price,
    cost_price, track_inventory, track_expiry, reorder_level,
    default_clinic_id, is_vat_exempt, vat_category
  ) values (
    v_org, 'drug', 'DEMO-DRUG-PARA', 'باراسيتامول 500 مجم',
    'Paracetamol 500 mg', 'شريط', 12, 5, true, true, 20,
    v_pharmacy_clinic, false, 'standard'
  ) on conflict (organization_id, code) do update set
    price = excluded.price,
    track_inventory = true,
    track_expiry = true,
    is_disabled = false,
    is_archived = false;

  select id into v_drug_item
  from public.items
  where organization_id = v_org and code = 'DEMO-DRUG-PARA';

  insert into public.drug_details (
    item_id, generic_name, brand_name, dosage_form, strength_text,
    requires_prescription, is_controlled_substance, default_dosage_instructions,
    default_route, pack_size, storage_conditions, notes, updated_by
  ) values (
    v_drug_item, 'Paracetamol', 'ZainCare Demo', 'tablet', '500 mg',
    true, false, 'قرص واحد عند اللزوم بعد الطعام', 'oral', 10,
    'يحفظ تحت 25 درجة مئوية', 'دواء تجريبي غير خاضع للرقابة', v_owner
  ) on conflict (item_id) do update set
    strength_text = excluded.strength_text,
    default_dosage_instructions = excluded.default_dosage_instructions,
    updated_by = excluded.updated_by;

  select id into v_price_list
  from public.price_lists
  where organization_id = v_org and name = 'قائمة الأسعار الأساسية التجريبية'
  limit 1;

  if v_price_list is not null then
    insert into public.price_list_items (
      organization_id, price_list_id, item_id, price, discount_percent, effective_from
    ) values (
      v_org, v_price_list, v_drug_item, 12, 0, current_date
    ) on conflict (price_list_id, item_id) where effective_to is null
    do update set price = excluded.price, discount_percent = 0;
  end if;

  if not exists (
    select 1 from public.inventory_lots
    where organization_id = v_org and warehouse_id = v_warehouse
      and item_id = v_drug_item and lot_number = 'DEMO-PARA-2026-01'
  ) then
    insert into public.inventory_lots (
      organization_id, warehouse_id, item_id, lot_number, unit_cost,
      selling_price, qty_received, qty_remaining, expiry_date,
      status, created_by
    ) values (
      v_org, v_warehouse, v_drug_item, 'DEMO-PARA-2026-01', 5,
      12, 100, 100, current_date + interval '2 years', 'available', v_owner
    );
  end if;

  if v_visit is not null and not exists (
    select 1 from public.prescriptions
    where organization_id = v_org and notes = 'DEMO-RX-001'
  ) then
    insert into public.prescriptions (
      organization_id, branch_id, patient_id, doctor_id, visit_id,
      clinic_id, warehouse_id, status, notes, created_by
    ) values (
      v_org, v_branch, v_patient, v_doctor, v_visit,
      v_pharmacy_clinic, v_warehouse, 'sent_to_pharmacy', 'DEMO-RX-001', v_owner
    );
  end if;

  insert into public.prescription_items (
    organization_id, prescription_id, drug_item_id, dosage_instructions,
    frequency, duration_days, route, quantity_prescribed, is_substitutable
  )
  select v_org, prescription.id, v_drug_item,
         'قرص واحد كل 8 ساعات عند اللزوم بعد الطعام',
         'كل 8 ساعات عند اللزوم', 3, 'oral', 10, true
  from public.prescriptions prescription
  where prescription.organization_id = v_org
    and prescription.notes = 'DEMO-RX-001'
    and not exists (
      select 1 from public.prescription_items line
      where line.prescription_id = prescription.id and line.drug_item_id = v_drug_item
    );
end
$seed$;


-- ==========================================================================
-- [3/4]  0127_demo_insurance_readiness.sql
--          بيانات تجريبية: جاهزية التأمين
-- ==========================================================================


do $$
declare
  v_org uuid;
  v_company uuid;
  v_network uuid;
  v_policy uuid;
  v_contract uuid;
  v_price_list uuid;
begin
  select id into v_org
    from public.organizations
   where name = 'مجمع زين الطبي'
   order by created_at
   limit 1;
  if v_org is null then return; end if;

  select id into v_company
    from public.insurance_companies
   where organization_id = v_org and code = 'DEMO-INS'
   limit 1;
  if v_company is null then
    insert into public.insurance_companies (
      organization_id, code, name_ar, name_en, tax_number, phone,
      email, nphies_payer_id, nphies_enabled, payment_terms_days
    ) values (
      v_org, 'DEMO-INS', 'شركة الأمان للتأمين التجريبية',
      'Demo Aman Insurance', '300000000000003', '0110000000',
      'claims.demo@zaincare.test', 'DEMO-PAYER-001', false, 30
    ) returning id into v_company;
  end if;

  select id into v_network
    from public.insurance_networks
   where organization_id = v_org and company_id = v_company and code = 'DEMO-A'
   limit 1;
  if v_network is null then
    insert into public.insurance_networks (
      organization_id, company_id, code, name_ar, name_en, description_ar
    ) values (
      v_org, v_company, 'DEMO-A', 'شبكة الفئة أ التجريبية',
      'Demo Class A Network', 'شبكة اختبار داخلية — لا ترسل إلى نفيس'
    ) returning id into v_network;
  end if;

  select id into v_policy
    from public.insurance_policies
   where organization_id = v_org and company_id = v_company
     and policy_name = 'بوليصة المركز التجريبية' and policy_class = 'A'
   limit 1;
  if v_policy is null then
    insert into public.insurance_policies (
      organization_id, company_id, network_id, policy_name, policy_number,
      policy_class, default_copay_percent, default_max_amount,
      default_consultation_limit, effective_from, effective_to, annual_limit,
      deductible_amount, notes
    ) values (
      v_org, v_company, v_network, 'بوليصة المركز التجريبية', 'DEMO-POL-001',
      'A', 20, 5000, 500, current_date - 30, current_date + 365,
      50000, 0, 'بيانات اختبار فقط'
    ) returning id into v_policy;
  end if;

  select id into v_price_list
    from public.price_lists
   where organization_id = v_org and list_kind = 'base' and is_active
   order by priority desc, created_at
   limit 1;

  select id into v_contract
    from public.insurance_contracts
   where organization_id = v_org and company_id = v_company
     and contract_number = 'DEMO-CONTRACT-001'
   limit 1;
  if v_contract is null then
    insert into public.insurance_contracts (
      organization_id, company_id, network_id, contract_number, name_ar,
      name_en, price_list_id, discount_percent, default_copay_percent,
      payment_terms_days, claim_submission_days, effective_from, effective_to,
      status, notes
    ) values (
      v_org, v_company, v_network, 'DEMO-CONTRACT-001',
      'عقد التأمين التجريبي', 'Demo Insurance Contract', v_price_list,
      0, 20, 30, 60, current_date - 30, current_date + 365,
      'active', 'عقد اختبار داخلي فقط'
    ) returning id into v_contract;
  end if;

  if not exists (
    select 1 from public.insurance_coverage_rules
     where organization_id = v_org and contract_id = v_contract
       and policy_id = v_policy and scope = 'all' and is_active
  ) then
    insert into public.insurance_coverage_rules (
      organization_id, contract_id, policy_id, scope, coverage,
      copay_percent, max_amount_per_service, waiting_period_days, note_ar
    ) values (
      v_org, v_contract, v_policy, 'all', 'covered', 20, 5000, 0,
      'تغطية شاملة تجريبية'
    );
  end if;

  insert into public.patient_insurance_memberships (
    organization_id, patient_id, policy_id, membership_number, relation,
    expiry_date, eligibility_status, is_active
  )
  select v_org, patient.id, v_policy,
         'DEMO-MEM-' || right(patient.id::text, 8), 'self',
         current_date + 365, 'eligible', true
    from public.patients patient
   where patient.organization_id = v_org
     and (patient.email_1 like '%@zaincare.test' or patient.general_note like '%تجريبي%')
  on conflict (patient_id, policy_id, membership_number) do update set
    expiry_date = excluded.expiry_date,
    eligibility_status = 'eligible',
    is_active = true;

  insert into public.insurance_settings (organization_id)
  values (v_org)
  on conflict (organization_id) do nothing;
end;
$$;


-- ==========================================================================
-- [4/4]  0132_asnan_brand_and_real_doctors.sql
--          علامة «أسنان» وأطباء بأسماء حقيقية
-- ==========================================================================


do $seed$
declare
  v_org uuid;
  v_branch uuid;
  v_dental_department uuid;
  v_dermatology_department uuid;
  v_dental_clinic uuid;
  v_dermatology_clinic uuid;
  v_dermatology_service uuid;
  v_doctor record;
begin
  select id into v_org
    from public.organizations
   where name = 'مجمع زين الطبي'
   order by created_at
   limit 1;

  if v_org is null then
    raise exception 'منشأة مجمع زين الطبي غير موجودة';
  end if;

  select id into v_branch
    from public.branches
   where organization_id = v_org
     and is_main
   order by created_at
   limit 1;

  select id into v_dental_department
    from public.departments
   where organization_id = v_org
     and code = 'DEMO-DENT'
   limit 1;

  insert into public.departments (
    organization_id, code, name_ar, name_en, department_type, is_clinical, sort_order
  )
  select v_org, 'DERM', 'قسم الجلدية', 'Dermatology Department', 'clinical', true, 25
  where not exists (
    select 1 from public.departments
     where organization_id = v_org and code = 'DERM'
  );

  select id into v_dermatology_department
    from public.departments
   where organization_id = v_org
     and code = 'DERM'
   limit 1;

  select id into v_dental_clinic
    from public.clinics
   where organization_id = v_org
     and code = 'DEMO-DENTAL'
   limit 1;

  insert into public.clinics (
    organization_id, branch_id, department_id, code, name, name_en, clinic_type,
    floor, room_number, default_visit_duration, allows_walk_in,
    allows_online_booking, capacity, color, sort_order
  ) values (
    v_org, v_branch, v_dermatology_department, 'DERM', 'عيادة الجلدية',
    'Dermatology Clinic', 'clinic', 'الأول', '205', 30, true, false, 8, '#7C3AED', 25
  )
  on conflict (organization_id, code) do update set
    branch_id = excluded.branch_id,
    department_id = excluded.department_id,
    name = excluded.name,
    name_en = excluded.name_en,
    is_disabled = false;

  select id into v_dermatology_clinic
    from public.clinics
   where organization_id = v_org
     and code = 'DERM'
   limit 1;

  insert into public.items (
    organization_id, item_type, code, name_ar, name_en, unit, price,
    medical_service_type, default_clinic_id, duration_minutes, provider_role,
    requires_appointment, description_ar
  ) values (
    v_org, 'service', 'DERM-CONSULT', 'استشارة جلدية', 'Dermatology Consultation',
    'زيارة', 200, 'consultation', v_dermatology_clinic, 30, 'doctor', true,
    'فحص وتشخيص وعلاج الحالات الجلدية'
  )
  on conflict (organization_id, code) do update set
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    price = excluded.price,
    default_clinic_id = excluded.default_clinic_id,
    duration_minutes = excluded.duration_minutes,
    is_disabled = false,
    is_archived = false
  returning id into v_dermatology_service;

  insert into public.doctors (
    organization_id, clinic_id, name_ar, name_en, job_title, gender,
    default_appointment_duration_minutes, patient_waiting_minutes,
    is_enabled, disabled_from_booking, notes
  )
  select v_org, seed.clinic_id, seed.name_ar, seed.name_en, seed.job_title,
         seed.gender, seed.duration, 10, true, false, 'الفريق الطبي الفعلي للمركز'
    from (values
      (v_dental_clinic, 'أمجد', 'Amjad', 'طبيب أسنان عام', 'male', 30),
      (v_dental_clinic, 'محمد', 'Mohammed', 'تقويم أسنان', 'male', 45),
      (v_dental_clinic, 'نبيلة', 'Nabila', 'طبيبة أسنان عامة', 'female', 30),
      (v_dental_clinic, 'نجاة', 'Najat', 'طبيبة أسنان عامة', 'female', 30),
      (v_dermatology_clinic, 'نوف', 'Nouf', 'طبيبة جلدية', 'female', 30)
    ) as seed(clinic_id, name_ar, name_en, job_title, gender, duration)
   where not exists (
     select 1 from public.doctors d
      where d.organization_id = v_org
        and d.name_ar = seed.name_ar
   );

  update public.doctors d
     set clinic_id = seed.clinic_id,
         name_en = seed.name_en,
         job_title = seed.job_title,
         gender = seed.gender,
         default_appointment_duration_minutes = seed.duration,
         is_enabled = true,
         disabled_from_booking = false,
         notes = 'الفريق الطبي الفعلي للمركز'
    from (values
      (v_dental_clinic, 'أمجد', 'Amjad', 'طبيب أسنان عام', 'male', 30),
      (v_dental_clinic, 'محمد', 'Mohammed', 'تقويم أسنان', 'male', 45),
      (v_dental_clinic, 'نبيلة', 'Nabila', 'طبيبة أسنان عامة', 'female', 30),
      (v_dental_clinic, 'نجاة', 'Najat', 'طبيبة أسنان عامة', 'female', 30),
      (v_dermatology_clinic, 'نوف', 'Nouf', 'طبيبة جلدية', 'female', 30)
    ) as seed(clinic_id, name_ar, name_en, job_title, gender, duration)
   where d.organization_id = v_org
     and d.name_ar = seed.name_ar;

  update public.doctors
     set disabled_from_booking = true
   where organization_id = v_org
     and name_ar = 'د. ريم عبدالله'
     and notes = 'طبيب تجريبي لاختبار النظام';

  for v_doctor in
    select id, clinic_id, default_appointment_duration_minutes
      from public.doctors
     where organization_id = v_org
       and notes = 'الفريق الطبي الفعلي للمركز'
  loop
    insert into public.doctor_branches (organization_id, doctor_id, branch_id, is_primary)
    values (v_org, v_doctor.id, v_branch, true)
    on conflict (doctor_id, branch_id) do update set is_active = true;

    insert into public.doctor_clinics (
      organization_id, doctor_id, clinic_id, branch_id, is_primary
    ) values (
      v_org, v_doctor.id, v_doctor.clinic_id, v_branch, true
    )
    on conflict (doctor_id, clinic_id) do update set is_active = true;

    insert into public.doctor_schedules (
      organization_id, doctor_id, branch_id, clinic_id, day_of_week,
      start_time, end_time, slot_duration_minutes, capacity, effective_from,
      is_active, note
    )
    select v_org, v_doctor.id, v_branch, v_doctor.clinic_id, day_number,
           time '09:00', time '21:00', v_doctor.default_appointment_duration_minutes,
           1, current_date, true, 'دوام المركز المعتاد'
      from generate_series(1, 6) as day_number
     where not exists (
       select 1 from public.doctor_schedules schedule
        where schedule.doctor_id = v_doctor.id
          and schedule.clinic_id = v_doctor.clinic_id
          and schedule.day_of_week = day_number
          and schedule.is_active
     );
  end loop;

  insert into public.doctor_services (
    organization_id, doctor_id, item_id, branch_id, duration_minutes, is_active
  )
  select v_org, d.id, i.id, v_branch,
         coalesce(i.duration_minutes, d.default_appointment_duration_minutes, 30), true
    from public.doctors d
    join public.items i
      on i.organization_id = d.organization_id
     and i.default_clinic_id = d.clinic_id
     and i.item_type = 'service'
     and not i.is_disabled
     and not i.is_archived
   where d.organization_id = v_org
     and d.notes = 'الفريق الطبي الفعلي للمركز'
     and not exists (
       select 1 from public.doctor_services relation
        where relation.doctor_id = d.id
          and relation.item_id = i.id
          and coalesce(relation.branch_id, v_branch) = v_branch
     );
end
$seed$;

create or replace function public.app_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  select jsonb_build_object(
    'site_name', v_setting.site_name,
    'hero_title', v_setting.hero_title,
    'hero_subtitle', v_setting.hero_subtitle,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.clinics c
       where c.organization_id = v_setting.organization_id
         and c.branch_id = v_setting.branch_id
         and c.allows_online_booking
         and not c.is_disabled
         and exists (
           select 1 from public.items i
            where i.organization_id = c.organization_id
              and i.default_clinic_id = c.id
              and i.item_type = 'service'
              and i.medical_service_type = 'dental'
              and not i.is_disabled
              and not i.is_archived
         )
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name_ar,
        'job_title', d.job_title, 'clinic_id', d.clinic_id
      ) order by d.name_ar)
        from public.doctors d
       where d.organization_id = v_setting.organization_id
         and d.is_enabled
         and not d.disabled_from_booking
         and d.notes = 'الفريق الطبي الفعلي للمركز'
         and exists (
           select 1 from public.clinics c
            where c.id = d.clinic_id
              and c.organization_id = d.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
              and exists (
                select 1 from public.items i
                 where i.organization_id = c.organization_id
                   and i.default_clinic_id = c.id
                   and i.item_type = 'service'
                   and i.medical_service_type = 'dental'
                   and not i.is_disabled
                   and not i.is_archived
              )
         )
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name_ar,
        'job_title', d.job_title, 'clinic_id', d.clinic_id
      ) order by d.name_ar)
        from public.doctors d
       where d.organization_id = v_setting.organization_id
         and d.is_enabled
         and d.notes = 'الفريق الطبي الفعلي للمركز'
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name_ar, 'description', i.description_ar,
        'price', i.price, 'duration_minutes', coalesce(i.duration_minutes, 30),
        'clinic_id', i.default_clinic_id
      ) order by i.name_ar)
        from public.items i
       where i.organization_id = v_setting.organization_id
         and i.item_type = 'service'
         and i.medical_service_type = 'dental'
         and not i.is_disabled
         and not i.is_archived
         and exists (
           select 1 from public.clinics c
            where c.id = i.default_clinic_id
              and c.organization_id = i.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
         )
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.app_public_booking_catalog(text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;


-- ==========================================================================
-- نهاية الجزء 4 (تجريبي/علامة) — 4 هجرة
-- ==========================================================================
do $zc_done$
begin
  raise notice '=== اكتمل % بنجاح ===', 'الجزء 4 (تجريبي/علامة)';
end
$zc_done$;
