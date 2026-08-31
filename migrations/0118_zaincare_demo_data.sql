begin;

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

commit;
