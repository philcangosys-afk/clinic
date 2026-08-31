begin;

create index if not exists idx_appointments_branch_fk on public.appointments (branch_id);
create index if not exists idx_appointments_clinic_fk on public.appointments (clinic_id);
create index if not exists idx_appointments_org_item_fk on public.appointments (organization_id, item_id);
create index if not exists idx_patients_branch_fk on public.patients (branch_id);

create index if not exists idx_sales_invoices_branch_fk on public.sales_invoices (branch_id);
create index if not exists idx_sales_invoices_clinic_fk on public.sales_invoices (clinic_id);
create index if not exists idx_sales_invoices_appointment_fk on public.sales_invoices (appointment_id);
create index if not exists idx_sales_invoices_org_visit_fk on public.sales_invoices (organization_id, visit_id);
create index if not exists idx_sales_invoice_items_item_fk on public.sales_invoice_items (item_id);
create index if not exists idx_sales_invoice_items_patient_fk on public.sales_invoice_items (patient_id);

create index if not exists idx_lab_tests_billing_item_fk on public.lab_tests (billing_item_id);
create index if not exists idx_lab_tests_category_fk on public.lab_tests (category_id);
create index if not exists idx_radiology_exams_billing_item_fk on public.radiology_exams (billing_item_id);
create index if not exists idx_radiology_exams_category_fk on public.radiology_exams (category_id);

create index if not exists idx_lab_orders_branch_fk on public.lab_orders (branch_id);
create index if not exists idx_lab_orders_clinic_fk on public.lab_orders (clinic_id);
create index if not exists idx_lab_orders_doctor_fk on public.lab_orders (ordering_doctor_id);
create index if not exists idx_lab_orders_invoice_fk on public.lab_orders (sales_invoice_id);
create index if not exists idx_lab_order_items_test_fk on public.lab_order_items (lab_test_id);

create index if not exists idx_radiology_orders_branch_fk on public.radiology_orders (branch_id);
create index if not exists idx_radiology_orders_clinic_fk on public.radiology_orders (clinic_id);
create index if not exists idx_radiology_orders_doctor_fk on public.radiology_orders (ordering_doctor_id);
create index if not exists idx_radiology_orders_invoice_fk on public.radiology_orders (sales_invoice_id);
create index if not exists idx_radiology_order_items_exam_fk on public.radiology_order_items (radiology_exam_id);

create index if not exists idx_prescriptions_branch_fk on public.prescriptions (branch_id);
create index if not exists idx_prescriptions_doctor_fk on public.prescriptions (doctor_id);
create index if not exists idx_prescriptions_warehouse_fk on public.prescriptions (warehouse_id);
create index if not exists idx_prescription_items_drug_fk on public.prescription_items (drug_item_id);

create index if not exists idx_medical_access_branch_fk on public.medical_record_access_log (branch_id);
create index if not exists idx_medical_access_patient_fk on public.medical_record_access_log (patient_id);
create index if not exists idx_medical_access_user_fk on public.medical_record_access_log (user_id);
create index if not exists idx_medical_access_visit_fk on public.medical_record_access_log (visit_id);
create index if not exists idx_notifications_branch_fk on public.notifications (branch_id);
create index if not exists idx_notifications_user_fk on public.notifications (user_id);

commit;
