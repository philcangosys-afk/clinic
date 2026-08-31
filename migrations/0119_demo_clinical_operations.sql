begin;

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

commit;
