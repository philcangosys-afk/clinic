# دوالّ قاعدة ZainCare (421)

> **مُولَّد آليًّا — لا يُحرَّر يدويًّا:** `python scripts/schema-doc.py`

عمود «عُرِّفت في» يسرد كل ترقية أعادت تعريف الدالّة، فآخِرُها هو النسخة السارية.
الدوالّ التي أُسقطت بـ`drop function` غير مذكورة هنا.

### app_account_id_by_code(2)

عُرِّفت في: `0027`

```sql
app_account_id_by_code(
  p_organization_id uuid,
  p_code text
) returns uuid
```

### app_acknowledge_critical_result(3)

عُرِّفت في: `0105`

```sql
app_acknowledge_critical_result(
  p_id uuid,
  p_read_back text,
  p_action text
) returns void
```

### app_active_insurance_contract(3)

عُرِّفت في: `0089`

```sql
app_active_insurance_contract(
  p_organization_id uuid,
  p_company_id uuid,
  p_as_of date default current_date
) returns insurance_contracts
```

### app_active_preauthorization(3)

عُرِّفت في: `0089`، `0093`

```sql
app_active_preauthorization(
  p_patient_id uuid,
  p_item_id uuid,
  p_as_of date default current_date
) returns insurance_preauthorizations
```

### app_add_walk_in(6)

عُرِّفت في: `0050`

```sql
app_add_walk_in(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid default null,
  p_priority text default 'normal',
  p_note text default null
) returns uuid
```

### app_adjust_stock(3)

عُرِّفت في: `0088`

```sql
app_adjust_stock(
  p_lot_id uuid,
  p_qty numeric,
  p_reason text
) returns void
```

### app_adverse_event_keys(0)

عُرِّفت في: `0142`

```sql
app_adverse_event_keys(
) returns text[]
```

### app_after_organization_created(0)

عُرِّفت في: `0001`، `0009`

```sql
app_after_organization_created(
) returns trigger
```

### app_allocate_purchase_expense(1)

عُرِّفت في: `0097`

```sql
app_allocate_purchase_expense(
  p_expense_id uuid
) returns integer
```

### app_analytics_summary(3)

عُرِّفت في: `0111`

```sql
app_analytics_summary(
  p_org uuid,
  p_from date,
  p_to date
) returns table ( metric_key text, metric_name text, current_value numeric, previous_value numeric, change_percent numeric, higher_is_better boolean )
```

### app_apply_dental_lab_voucher(0)

عُرِّفت في: `0007`

```sql
app_apply_dental_lab_voucher(
) returns trigger
```

### app_apply_dispensing_item(0)

عُرِّفت في: `0015`

```sql
app_apply_dispensing_item(
) returns trigger
```

### app_apply_inventory_movement(0)

عُرِّفت في: `0003`، `0088`

```sql
app_apply_inventory_movement(
) returns trigger
```

### app_apply_invoice_discount(3)

عُرِّفت في: `0091`

```sql
app_apply_invoice_discount(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text
) returns void
```

### app_apply_leave_approval(0)

عُرِّفت في: `0020`

```sql
app_apply_leave_approval(
) returns trigger
```

### app_apply_retention_policy(1)

عُرِّفت في: `0095`

```sql
app_apply_retention_policy(
  p_policy_id uuid
) returns integer
```

### app_apply_sms_credit_transaction(0)

عُرِّفت في: `0009`

```sql
app_apply_sms_credit_transaction(
) returns trigger
```

### app_apply_voucher_allocation(0)

عُرِّفت في: `0003`

```sql
app_apply_voucher_allocation(
) returns trigger
```

### app_apply_wallet_transaction(0)

عُرِّفت في: `0003`

```sql
app_apply_wallet_transaction(
) returns trigger
```

### app_appointment_service_guard(0)

عُرِّفت في: `0074`

```sql
app_appointment_service_guard(
) returns trigger
```

### app_approve_appointment_request(6)

عُرِّفت في: `0104`

```sql
app_approve_appointment_request(
  p_request_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_note text default null
) returns uuid
```

### app_approve_cash_shift(2)

عُرِّفت في: `0091`

```sql
app_approve_cash_shift(
  p_shift_id uuid,
  p_note text default null
) returns void
```

### app_approve_leave_request(2)

عُرِّفت في: `0100`، `0145`

```sql
app_approve_leave_request(
  p_request_id uuid,
  p_conflict_note text default null
) returns void
```

### app_approve_payroll_run(1)

عُرِّفت في: `0100`

```sql
app_approve_payroll_run(
  p_run_id uuid
) returns void
```

### app_approve_purchase_request(3)

عُرِّفت في: `0097`

```sql
app_approve_purchase_request(
  p_request_id uuid,
  p_note text default null,
  p_lines jsonb default null
) returns void
```

### app_approve_shift_swap(1)

عُرِّفت في: `0100`

```sql
app_approve_shift_swap(
  p_swap_id uuid
) returns void
```

### app_approve_stock_count(1)

عُرِّفت في: `0098`

```sql
app_approve_stock_count(
  p_count_id uuid
) returns void
```

### app_approve_stock_transfer(2)

عُرِّفت في: `0098`

```sql
app_approve_stock_transfer(
  p_transfer_id uuid,
  p_note text default null
) returns void
```

### app_archive_document(3)

عُرِّفت في: `0102`

```sql
app_archive_document(
  p_kind text,
  p_document_id uuid,
  p_reason text
) returns void
```

### app_archive_item(2)

عُرِّفت في: `0071`

```sql
app_archive_item(
  p_item_id uuid,
  p_reason text
) returns void
```

### app_audit_log_auto(0)

عُرِّفت في: `0025`، `0043`، `0048`، `0095`

```sql
app_audit_log_auto(
) returns trigger
```

### app_auto_consume_package(0)

عُرِّفت في: `0096`

```sql
app_auto_consume_package(
) returns trigger
```

### app_auto_create_insurance_claim_form(0)

عُرِّفت في: `0005`

```sql
app_auto_create_insurance_claim_form(
) returns trigger
```

### app_block_access_log_change(0)

عُرِّفت في: `0095`

```sql
app_block_access_log_change(
) returns trigger
```

### app_block_asset_delete(0)

عُرِّفت في: `0101`

```sql
app_block_asset_delete(
) returns trigger
```

### app_block_critical_delete(0)

عُرِّفت في: `0105`

```sql
app_block_critical_delete(
) returns trigger
```

### app_block_document_delete(0)

عُرِّفت في: `0102`

```sql
app_block_document_delete(
) returns trigger
```

### app_block_issued_invoice_delete(0)

عُرِّفت في: `0092`

```sql
app_block_issued_invoice_delete(
) returns trigger
```

### app_block_posted_count_delete(0)

عُرِّفت في: `0098`

```sql
app_block_posted_count_delete(
) returns trigger
```

### app_block_posted_document_delete(0)

عُرِّفت في: `0097`

```sql
app_block_posted_document_delete(
) returns trigger
```

### app_block_posted_entry_delete(0)

عُرِّفت في: `0099`

```sql
app_block_posted_entry_delete(
) returns trigger
```

### app_block_quality_delete(0)

عُرِّفت في: `0106`

```sql
app_block_quality_delete(
) returns trigger
```

### app_block_signature_update(0)

عُرِّفت في: `0102`

```sql
app_block_signature_update(
) returns trigger
```

### app_block_stock_delete(0)

عُرِّفت في: `0088`

```sql
app_block_stock_delete(
) returns trigger
```

### app_block_voucher_delete(0)

عُرِّفت في: `0091`

```sql
app_block_voucher_delete(
) returns trigger
```

### app_book_resource(8)

عُرِّفت في: `0084`

```sql
app_book_resource(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_type text default 'radiology',
  p_appointment_id uuid default null,
  p_radiology_order_id uuid default null,
  p_patient_id uuid default null,
  p_note text default null
) returns uuid
```

### app_calc_attendance_status(0)

عُرِّفت في: `0019`

```sql
app_calc_attendance_status(
) returns trigger
```

### app_calculate_payroll_run(1)

عُرِّفت في: `0100`

```sql
app_calculate_payroll_run(
  p_run_id uuid
) returns integer
```

### app_can_access_branch(2)

عُرِّفت في: `0062`، `0071`

```sql
app_can_access_branch(
  target_org_id uuid,
  p_branch_id uuid
) returns boolean
```

### app_cancel_dispensing(2)

عُرِّفت في: `0088`

```sql
app_cancel_dispensing(
  p_record_id uuid,
  p_reason text
) returns void
```

### app_cancel_patient_package(3)

عُرِّفت في: `0096`

```sql
app_cancel_patient_package(
  p_patient_package_id uuid,
  p_reason text,
  p_refund boolean default false
) returns jsonb
```

### app_cancel_payroll_run(2)

عُرِّفت في: `0100`

```sql
app_cancel_payroll_run(
  p_run_id uuid,
  p_reason text
) returns void
```

### app_cancel_pending_messages_on_appointment_change(0)

عُرِّفت في: `0054`

```sql
app_cancel_pending_messages_on_appointment_change(
) returns trigger
```

### app_cancel_tooth_procedure(2)

عُرِّفت في: `0141`

```sql
app_cancel_tooth_procedure(
  p_procedure_id uuid,
  p_reason text default null
) returns void
```

### app_cancel_vital_request(2)

عُرِّفت في: `0139`

```sql
app_cancel_vital_request(
  p_request_id uuid,
  p_reason text default null
) returns void
```

### app_cash_shift_expected(1)

عُرِّفت في: `0091`

```sql
app_cash_shift_expected(
  p_shift_id uuid
) returns numeric
```

### app_check_contact_block(4)

عُرِّفت في: `0063`

```sql
app_check_contact_block(
  p_organization_id uuid,
  p_patient_id uuid,
  p_mobile_number text,
  p_action text
) returns boolean
```

### app_check_doctor_availability(3)

عُرِّفت في: `0064`، `0082`، `0131`، `0135`

```sql
app_check_doctor_availability(
  p_doctor_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns text
```

### app_check_insurance_eligibility(4)

عُرِّفت في: `0093`

```sql
app_check_insurance_eligibility(
  p_membership_id uuid,
  p_item_id uuid default null,
  p_visit_id uuid default null,
  p_amount numeric default null
) returns uuid
```

### app_check_integration_health(2)

عُرِّفت في: `0110`

```sql
app_check_integration_health(
  p_org uuid,
  p_minutes integer default 60
) returns integer
```

### app_check_leave_conflicts(3)

عُرِّفت في: `0100`

```sql
app_check_leave_conflicts(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
) returns jsonb
```

### app_check_package_eligibility(4)

عُرِّفت في: `0096`

```sql
app_check_package_eligibility(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id uuid default null,
  p_doctor_id uuid default null
) returns jsonb
```

### app_check_service_eligibility(4)

عُرِّفت في: `0074`، `0089`، `0130`

```sql
app_check_service_eligibility(
  p_item_id uuid,
  p_patient_id uuid,
  p_branch_id uuid default null,
  p_stage text default 'execution'
) returns jsonb
```

### app_check_tooth_shape(3)

عُرِّفت في: `0141`

```sql
app_check_tooth_shape(
  p_tooth text,
  p_type text,
  p_surfaces text[]
) returns void
```

### app_claim_package_coverage(6)

عُرِّفت في: `0096`

```sql
app_claim_package_coverage(
  p_patient_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_visit_id uuid default null,
  p_service_id uuid default null,
  p_doctor_id uuid default null
) returns uuid
```

### app_claim_pending_messages(1)

عُرِّفت في: `0054`

```sql
app_claim_pending_messages(
  p_limit integer default 50
) returns table ( id bigint, organization_id uuid, channel text, recipient text, message_text text, attempts integer )
```

### app_claim_status_allowed(2)

عُرِّفت في: `0089`، `0093`

```sql
app_claim_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_clear_member_permission(3)

عُرِّفت في: `0108`

```sql
app_clear_member_permission(
  p_org uuid,
  p_user_id uuid,
  p_permission text
) returns void
```

### app_clinic_future_appointments(1)

عُرِّفت في: `0080`

```sql
app_clinic_future_appointments(
  p_clinic_id uuid
) returns integer
```

### app_clinics_for_branch(2)

عُرِّفت في: `0081`

```sql
app_clinics_for_branch(
  p_organization_id uuid,
  p_branch_id uuid default null
) returns table (id uuid, name text, department_name text, default_visit_duration int)
```

### app_clone_exam_template(2)

عُرِّفت في: `0085`

```sql
app_clone_exam_template(
  p_template_id uuid,
  p_name_ar text default null
) returns uuid
```

### app_clone_exam_template(3)

عُرِّفت في: `0145`

```sql
app_clone_exam_template(
  p_template_id uuid,
  p_organization_id uuid,
  p_name text default null
) returns uuid
```

### app_close_business_day(3)

عُرِّفت في: `0147`

```sql
app_close_business_day(
  p_organization_id uuid,
  p_branch_id uuid default null,
  p_note text default null
) returns uuid
```

### app_close_cash_shift(3)

عُرِّفت في: `0091`

```sql
app_close_cash_shift(
  p_shift_id uuid,
  p_counted_balance numeric,
  p_variance_reason text default null
) returns jsonb
```

### app_close_fiscal_period(2)

عُرِّفت في: `0099`

```sql
app_close_fiscal_period(
  p_period_id uuid,
  p_lock boolean default false
) returns void
```

### app_close_quality_incident(4)

عُرِّفت في: `0106`

```sql
app_close_quality_incident(
  p_id uuid,
  p_root_cause text,
  p_corrective text,
  p_preventive text default null
) returns void
```

### app_complete_bank_reconciliation(1)

عُرِّفت في: `0099`

```sql
app_complete_bank_reconciliation(
  p_reconciliation_id uuid
) returns numeric
```

### app_complete_maintenance_order(7)

عُرِّفت في: `0101`

```sql
app_complete_maintenance_order(
  p_order_id uuid,
  p_findings text,
  p_actions text,
  p_return_to_service boolean default true,
  p_labor_cost numeric default null,
  p_downtime_hours numeric default null,
  p_vendor_distributor_id uuid default null
) returns void
```

### app_complete_tooth_procedure(4)

عُرِّفت في: `0141`، `0143`

```sql
app_complete_tooth_procedure(
  p_procedure_id uuid,
  p_note text default null,
  p_visit_id uuid default null,
  p_bill boolean default true
) returns uuid
```

### app_compute_line_tax(6)

عُرِّفت في: `0092`

```sql
app_compute_line_tax(
  p_organization_id uuid,
  p_item_id uuid,
  p_patient_id uuid,
  p_unit_price numeric,
  p_qty numeric default 1,
  p_discount numeric default 0
) returns table ( vat_category text, vat_rate numeric, taxable_base numeric, vat_amount numeric, line_total numeric, exemption_reason text )
```

### app_compute_quality_metric(7)

عُرِّفت في: `0106`

```sql
app_compute_quality_metric(
  p_org uuid,
  p_key text,
  p_from date,
  p_to date,
  out numerator numeric,
  out denominator numeric,
  out value numeric
) returns ?
```

### app_consume_package_item(5)

عُرِّفت في: `0075`

```sql
app_consume_package_item(
  p_patient_package_id uuid,
  p_package_item_id uuid,
  p_quantity numeric default 1,
  p_appointment_id uuid default null,
  p_note text default null
) returns jsonb
```

### app_consume_preauth_on_invoice(0)

عُرِّفت في: `0090`

```sql
app_consume_preauth_on_invoice(
) returns trigger
```

### app_consume_sms_credit_on_sent(0)

عُرِّفت في: `0009`

```sql
app_consume_sms_credit_on_sent(
) returns trigger
```

### app_convert_waitlist_to_appointment(7)

عُرِّفت في: `0050`

```sql
app_convert_waitlist_to_appointment(
  p_waitlist_id uuid,
  p_doctor_id uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_clinic_id uuid default null,
  p_visit_type_value_id uuid default null,
  p_note text default null
) returns uuid
```

### app_country_defaults(1)

عُرِّفت في: `0109`

```sql
app_country_defaults(
  p_country text
) returns table (currency_code text, vat_rate numeric, phone_prefix text, id_length int)
```

### app_create_claim_from_visit(3)

عُرِّفت في: `0093`

```sql
app_create_claim_from_visit(
  p_visit_id uuid,
  p_invoice_id uuid default null,
  p_form_type text default 'ucaf'
) returns uuid
```

### app_create_credit_note(4)

عُرِّفت في: `0092`

```sql
app_create_credit_note(
  p_invoice_id uuid,
  p_reason text,
  p_lines jsonb default null,
  p_note_type text default 'credit_note'
) returns uuid
```

### app_create_employee_on_hire(0)

عُرِّفت في: `0022`

```sql
app_create_employee_on_hire(
) returns trigger
```

### app_create_invoice_from_visit(4)

عُرِّفت في: `0091`

```sql
app_create_invoice_from_visit(
  p_visit_id uuid,
  p_use_insurance boolean default true,
  p_membership_id uuid default null,
  p_note text default null
) returns uuid
```

### app_create_lab_order(9)

عُرِّفت في: `0138`

```sql
app_create_lab_order(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_test_ids uuid[],
  p_priority text default 'routine',
  p_notes text default null,
  p_visit_id uuid default null,
  p_branch_id uuid default null,
  p_clinic_id uuid default null
) returns uuid
```

### app_create_manual_journal_entry(6)

عُرِّفت في: `0099`

```sql
app_create_manual_journal_entry(
  p_organization_id uuid,
  p_entry_date date,
  p_description text,
  p_reason text,
  p_lines jsonb,
  p_branch_id uuid default null
) returns uuid
```

### app_create_medical_center(1)

عُرِّفت في: `0121`

```sql
app_create_medical_center(
  p_name text
) returns uuid
```

### app_create_purchase_invoice_from_receipt(4)

عُرِّفت في: `0097`

```sql
app_create_purchase_invoice_from_receipt(
  p_receipt_id uuid,
  p_invoice_number text,
  p_invoice_date date default null,
  p_note text default null
) returns uuid
```

### app_create_purchase_order(4)

عُرِّفت في: `0097`

```sql
app_create_purchase_order(
  p_request_id uuid,
  p_distributor_id uuid,
  p_expected_date date default null,
  p_note text default null
) returns uuid
```

### app_create_radiology_order(10)

عُرِّفت في: `0138`

```sql
app_create_radiology_order(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_exam_ids uuid[],
  p_priority text default 'routine',
  p_clinical_indication text default null,
  p_notes text default null,
  p_visit_id uuid default null,
  p_branch_id uuid default null,
  p_clinic_id uuid default null
) returns uuid
```

### app_create_sales_invoice(22)

عُرِّفت في: `0147`

```sql
app_create_sales_invoice(
  p_organization_id uuid,
  p_items jsonb,
  p_patient_id uuid DEFAULT NULL::uuid,
  p_external_customer_name text DEFAULT NULL::text,
  p_appointment_id uuid DEFAULT NULL::uuid,
  p_visit_id uuid DEFAULT NULL::uuid,
  p_doctor_id uuid DEFAULT NULL::uuid,
  p_clinic_id uuid DEFAULT NULL::uuid,
  p_warehouse_id uuid DEFAULT NULL::uuid,
  p_invoice_type text DEFAULT 'sale'::text,
  p_original_invoice_id uuid DEFAULT NULL::uuid,
  p_is_insurance boolean DEFAULT false,
  p_insurance jsonb DEFAULT '{}'::jsonb,
  p_paid_amount numeric DEFAULT 0,
  p_is_temporary boolean DEFAULT false,
  p_is_b2b boolean DEFAULT false,
  p_id_number text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text,
  p_lab_order_ids uuid[] DEFAULT NULL::uuid[],
  p_radiology_order_ids uuid[] DEFAULT NULL::uuid[],
  p_prescription_ids uuid[] DEFAULT NULL::uuid[],
  p_payments jsonb DEFAULT '[]'::jsonb
) returns uuid
```

### app_create_staff_request(9)

عُرِّفت في: `0138`

```sql
app_create_staff_request(
  p_organization_id uuid,
  p_request_type text,
  p_patient_id uuid default null,
  p_doctor_id uuid default null,
  p_body text default null,
  p_amount numeric default null,
  p_priority text default 'routine',
  p_visit_id uuid default null,
  p_branch_id uuid default null
) returns uuid
```

### app_decide_patient_change_request(3)

عُرِّفت في: `0104`

```sql
app_decide_patient_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
```

### app_dental_procedure_kinds(0)

عُرِّفت في: `0141`

```sql
app_dental_procedure_kinds(
) returns text[]
```

### app_derive_branch_from_clinic(0)

عُرِّفت في: `0062`، `0071`

```sql
app_derive_branch_from_clinic(
) returns trigger
```

### app_derive_dental_kind(1)

عُرِّفت في: `0141`

```sql
app_derive_dental_kind(
  p_name text
) returns text
```

### app_disable_clinic(3)

عُرِّفت في: `0080`

```sql
app_disable_clinic(
  p_clinic_id uuid,
  p_reason text,
  p_force boolean default false
) returns jsonb
```

### app_discount_within_limits(3)

عُرِّفت في: `0004`

```sql
app_discount_within_limits(
  p_organization_id uuid,
  p_user_id uuid,
  p_percent numeric
) returns boolean
```

### app_dismiss_notification(1)

عُرِّفت في: `0103`

```sql
app_dismiss_notification(
  p_id uuid
) returns void
```

### app_dispense_prescription(4)

عُرِّفت في: `0088`

```sql
app_dispense_prescription(
  p_prescription_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_notes text default null
) returns uuid
```

### app_dispose_asset(5)

عُرِّفت في: `0101`

```sql
app_dispose_asset(
  p_asset_id uuid,
  p_method text,
  p_reason text,
  p_sale_amount numeric default null,
  p_buyer text default null
) returns uuid
```

### app_dispose_lot(3)

عُرِّفت في: `0098`

```sql
app_dispose_lot(
  p_lot_id uuid,
  p_qty numeric,
  p_reason text
) returns void
```

### app_doctor_available_slots(4)

عُرِّفت في: `0082`، `0135`

```sql
app_doctor_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null,
  p_duration int default null
) returns table ( slot_start timestamptz, slot_end timestamptz, clinic_id uuid, capacity int, booked int, is_free boolean, block_reason text )
```

### app_doctor_booking_warnings(1)

عُرِّفت في: `0082`

```sql
app_doctor_booking_warnings(
  p_doctor_id uuid
) returns text[]
```

### app_doctor_request_followup(8)

عُرِّفت في: `0138`

```sql
app_doctor_request_followup(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_preferred_date date,
  p_reason text default null,
  p_preferred_period text default 'any',
  p_clinic_id uuid default null,
  p_branch_id uuid default null
) returns uuid
```

### app_doctor_working_ranges(3)

عُرِّفت في: `0082`، `0135`

```sql
app_doctor_working_ranges(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null
) returns table ( starts_at timestamptz, ends_at timestamptz, clinic_id uuid, slot_duration_minutes int, capacity int, source text )
```

### app_doctors_for_clinic(2)

عُرِّفت في: `0081`

```sql
app_doctors_for_clinic(
  p_organization_id uuid,
  p_clinic_id uuid
) returns table ( id uuid, name_ar text, specialty text, default_duration int, license_expired boolean, is_primary boolean )
```

### app_employee_days_employed(1)

عُرِّفت في: `0008`

```sql
app_employee_days_employed(
  p_employee_id uuid
) returns int
```

### app_enable_all_organization_features(0)

عُرِّفت في: `0117`

```sql
app_enable_all_organization_features(
) returns trigger
```

### app_enable_clinic(1)

عُرِّفت في: `0080`

```sql
app_enable_clinic(
  p_clinic_id uuid
) returns void
```

### app_enforce_booking_block(0)

عُرِّفت في: `0063`، `0066`

```sql
app_enforce_booking_block(
) returns trigger
```

### app_enforce_department_disable(0)

عُرِّفت في: `0080`

```sql
app_enforce_department_disable(
) returns trigger
```

### app_enforce_department_tree(0)

عُرِّفت في: `0080`

```sql
app_enforce_department_tree(
) returns trigger
```

### app_enforce_doctor_availability(0)

عُرِّفت في: `0064`

```sql
app_enforce_doctor_availability(
) returns trigger
```

### app_enforce_doctor_clinic_branch(0)

عُرِّفت في: `0081`

```sql
app_enforce_doctor_clinic_branch(
) returns trigger
```

### app_enforce_doctor_clinic_link(0)

عُرِّفت في: `0082`

```sql
app_enforce_doctor_clinic_link(
) returns trigger
```

### app_enforce_exam_field_scope(0)

عُرِّفت في: `0085`

```sql
app_enforce_exam_field_scope(
) returns trigger
```

### app_enforce_merged_patient(0)

عُرِّفت في: `0066`

```sql
app_enforce_merged_patient(
) returns trigger
```

### app_enforce_messaging_block(0)

عُرِّفت في: `0063`

```sql
app_enforce_messaging_block(
) returns trigger
```

### app_enforce_schedule_overlap(0)

عُرِّفت في: `0081`

```sql
app_enforce_schedule_overlap(
) returns trigger
```

### app_enforce_visit_branch_access(0)

عُرِّفت في: `0073`

```sql
app_enforce_visit_branch_access(
) returns trigger
```

### app_ensure_asset_accounts(1)

عُرِّفت في: `0101`

```sql
app_ensure_asset_accounts(
  p_org uuid
) returns void
```

### app_ensure_business_day(2)

عُرِّفت في: `0147`

```sql
app_ensure_business_day(
  p_organization_id uuid,
  p_branch_id uuid default null
) returns uuid
```

### app_enter_lab_result(4)

عُرِّفت في: `0083`

```sql
app_enter_lab_result(
  p_item_id uuid,
  p_value text,
  p_numeric numeric default null,
  p_reason text default null
) returns jsonb
```

### app_escalate_critical_results(2)

عُرِّفت في: `0105`، `0107`

```sql
app_escalate_critical_results(
  p_org uuid,
  p_minutes integer default null
) returns integer
```

### app_fefo_lots(4)

عُرِّفت في: `0088`

```sql
app_fefo_lots(
  p_organization_id uuid,
  p_warehouse_id uuid,
  p_item_id uuid,
  p_qty numeric
) returns table (lot_id uuid, take numeric, expiry_date date, unit_cost numeric, selling_price numeric)
```

### app_fill_attendance_shift(0)

عُرِّفت في: `0143`

```sql
app_fill_attendance_shift(
) returns trigger
```

### app_fill_child_org(0)

عُرِّفت في: `0088`

```sql
app_fill_child_org(
) returns trigger
```

### app_fill_claim_item_code(0)

عُرِّفت في: `0073`، `0076`

```sql
app_fill_claim_item_code(
) returns trigger
```

### app_fill_dental_kind(0)

عُرِّفت في: `0141`

```sql
app_fill_dental_kind(
) returns trigger
```

### app_fill_invoice_item_context(0)

عُرِّفت في: `0091`

```sql
app_fill_invoice_item_context(
) returns trigger
```

### app_fill_lot_from_purchase(0)

عُرِّفت في: `0088`

```sql
app_fill_lot_from_purchase(
) returns trigger
```

### app_find_duplicate_patients(7)

عُرِّفت في: `0066`

```sql
app_find_duplicate_patients(
  p_organization_id uuid,
  p_id_number text default null,
  p_passport_number text default null,
  p_mobile_number text default null,
  p_name_ar text default null,
  p_birth_date date default null,
  p_exclude_id uuid default null
) returns table ( patient_id uuid, name_ar text, file_number text, mobile_number text, id_number text, birth_date date, match_reason text, match_score integer )
```

### app_find_or_note_direct_conversation(3)

عُرِّفت في: `0059`

```sql
app_find_or_note_direct_conversation(
  p_organization_id uuid,
  p_user_a uuid,
  p_user_b uuid
) returns uuid
```

### app_freeze_patient_package(2)

عُرِّفت في: `0096`

```sql
app_freeze_patient_package(
  p_patient_package_id uuid,
  p_reason text
) returns void
```

### app_generate_einvoice(1)

عُرِّفت في: `0092`

```sql
app_generate_einvoice(
  p_invoice_id uuid
) returns uuid
```

### app_generate_expiry_notifications(2)

عُرِّفت في: `0103`، `0107`

```sql
app_generate_expiry_notifications(
  p_org uuid,
  p_days integer default null
) returns integer
```

### app_get_patient_timeline(4)

عُرِّفت في: `0067`

```sql
app_get_patient_timeline(
  p_patient_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_event_types text[] default null
) returns table ( event_id text, event_type text, occurred_at timestamptz, title text, summary text, status text, module text, entity_id uuid, appointment_id uuid, visit_id uuid, invoice_id uuid, created_by uuid, metadata jsonb )
```

### app_guard_allocation_amount(0)

عُرِّفت في: `0091`

```sql
app_guard_allocation_amount(
) returns trigger
```

### app_guard_appointment_working_hours(0)

عُرِّفت في: `0107`

```sql
app_guard_appointment_working_hours(
) returns trigger
```

### app_guard_approved_payroll(0)

عُرِّفت في: `0100`، `0145`

```sql
app_guard_approved_payroll(
) returns trigger
```

### app_guard_clinic_type(0)

عُرِّفت في: `0140`

```sql
app_guard_clinic_type(
) returns trigger
```

### app_guard_closed_shift(0)

عُرِّفت في: `0091`

```sql
app_guard_closed_shift(
) returns trigger
```

### app_guard_contract_status(0)

عُرِّفت في: `0089`

```sql
app_guard_contract_status(
) returns trigger
```

### app_guard_definer_grants(0)

عُرِّفت في: `0095`، `0123`

```sql
app_guard_definer_grants(
) returns event_trigger
```

### app_guard_dispensing_item(0)

عُرِّفت في: `0088`

```sql
app_guard_dispensing_item(
) returns trigger
```

### app_guard_doctor_subspecialty(0)

عُرِّفت في: `0140`

```sql
app_guard_doctor_subspecialty(
) returns trigger
```

### app_guard_fiscal_period(0)

عُرِّفت في: `0099`

```sql
app_guard_fiscal_period(
) returns trigger
```

### app_guard_integration_secret(0)

عُرِّفت في: `0110`

```sql
app_guard_integration_secret(
) returns trigger
```

### app_guard_issued_invoice(0)

عُرِّفت في: `0091`

```sql
app_guard_issued_invoice(
) returns trigger
```

### app_guard_issued_invoice_lines(0)

عُرِّفت في: `0091`

```sql
app_guard_issued_invoice_lines(
) returns trigger
```

### app_guard_last_owner(0)

عُرِّفت في: `0108`

```sql
app_guard_last_owner(
) returns trigger
```

### app_guard_lot_location(0)

عُرِّفت في: `0098`

```sql
app_guard_lot_location(
) returns trigger
```

### app_guard_out_of_service_resource(0)

عُرِّفت في: `0101`

```sql
app_guard_out_of_service_resource(
) returns trigger
```

### app_guard_patient_contact_format(0)

عُرِّفت في: `0147`

```sql
app_guard_patient_contact_format(
) returns trigger
```

### app_guard_patient_id_number_unique(0)

عُرِّفت في: `0146`

```sql
app_guard_patient_id_number_unique(
) returns trigger
```

### app_guard_patient_identity(0)

عُرِّفت في: `0109`

```sql
app_guard_patient_identity(
) returns trigger
```

### app_guard_prescription_status(0)

عُرِّفت في: `0088`

```sql
app_guard_prescription_status(
) returns trigger
```

### app_guard_quarantined_lot(0)

عُرِّفت في: `0098`

```sql
app_guard_quarantined_lot(
) returns trigger
```

### app_guard_radiology_item_performed(0)

عُرِّفت في: `0143`

```sql
app_guard_radiology_item_performed(
) returns trigger
```

### app_guard_retention_action(0)

عُرِّفت في: `0095`

```sql
app_guard_retention_action(
) returns trigger
```

### app_guard_self_privilege(0)

عُرِّفت في: `0108`

```sql
app_guard_self_privilege(
) returns trigger
```

### app_guard_service_consent(0)

عُرِّفت في: `0102`

```sql
app_guard_service_consent(
) returns trigger
```

### app_guard_session_row(0)

عُرِّفت في: `0142`

```sql
app_guard_session_row(
) returns trigger
```

### app_guard_signed_visit(0)

عُرِّفت في: `0087`، `0090`

```sql
app_guard_signed_visit(
) returns trigger
```

### app_guard_submitted_claim(0)

عُرِّفت في: `0089`

```sql
app_guard_submitted_claim(
) returns trigger
```

### app_guard_tooth_procedure_row(0)

عُرِّفت في: `0141`

```sql
app_guard_tooth_procedure_row(
) returns trigger
```

### app_guard_tooth_status_row(0)

عُرِّفت في: `0141`

```sql
app_guard_tooth_status_row(
) returns trigger
```

### app_guard_used_template_field(0)

عُرِّفت في: `0085`

```sql
app_guard_used_template_field(
) returns trigger
```

### app_has_patient_consent(2)

عُرِّفت في: `0095`

```sql
app_has_patient_consent(
  p_patient_id uuid,
  p_consent_type text
) returns boolean
```

### app_has_permission(2)

عُرِّفت في: `0062`

```sql
app_has_permission(
  target_org_id uuid,
  p_permission_key text
) returns boolean
```

### app_has_role(2)

عُرِّفت في: `0050`

```sql
app_has_role(
  target_org_id uuid,
  allowed_roles text[]
) returns boolean
```

### app_init_visit_status_from_appointment(0)

عُرِّفت في: `0090`

```sql
app_init_visit_status_from_appointment(
) returns trigger
```

### app_insurance_coverage(4)

عُرِّفت في: `0089`

```sql
app_insurance_coverage(
  p_membership_id uuid,
  p_item_id uuid,
  p_amount numeric default null,
  p_as_of date default current_date
) returns jsonb
```

### app_invoice_kpis(3)

عُرِّفت في: `0010`، `0143`

```sql
app_invoice_kpis(
  p_organization_id uuid,
  p_date_from date,
  p_date_to date
) returns table ( gross_amount numeric, discount_amount numeric, discount_rate_percent numeric, net_amount numeric, paid_amount numeric, collection_rate_percent numeric )
```

### app_invoice_status_allowed(2)

عُرِّفت في: `0091`

```sql
app_invoice_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_is_consultation_renewal_due(3)

عُرِّفت في: `0004`

```sql
app_is_consultation_renewal_due(
  p_patient_id uuid,
  p_specialty_value_id uuid,
  p_renewal_days int default 30
) returns boolean
```

### app_is_conversation_participant(1)

عُرِّفت في: `0059`

```sql
app_is_conversation_participant(
  p_conversation_id uuid
) returns boolean
```

### app_is_member(1)

عُرِّفت في: `0001`

```sql
app_is_member(
  target_org_id uuid
) returns boolean
```

### app_is_org_admin(1)

عُرِّفت في: `0001`

```sql
app_is_org_admin(
  target_org_id uuid
) returns boolean
```

### app_is_portal_patient(2)

عُرِّفت في: `0104`

```sql
app_is_portal_patient(
  p_org uuid,
  p_patient_id uuid
) returns boolean
```

### app_is_public_booking_endpoint(1)

عُرِّفت في: `0136`

```sql
app_is_public_booking_endpoint(
  p_proname text
) returns boolean
```

### app_is_valid_tooth(2)

عُرِّفت في: `0141`

```sql
app_is_valid_tooth(
  p_tooth text,
  p_type text default 'permanent'
) returns boolean
```

### app_is_working_time(3)

عُرِّفت في: `0107`

```sql
app_is_working_time(
  p_org uuid,
  p_branch uuid,
  p_at timestamptz
) returns boolean
```

### app_issue_maintenance_part(3)

عُرِّفت في: `0101`

```sql
app_issue_maintenance_part(
  p_order_id uuid,
  p_lot_id uuid,
  p_qty numeric
) returns uuid
```

### app_item_available_in_branch(2)

عُرِّفت في: `0071`

```sql
app_item_available_in_branch(
  p_item_id uuid,
  p_branch_id uuid
) returns boolean
```

### app_item_claim_code(2)

عُرِّفت في: `0073`

```sql
app_item_claim_code(
  p_item_id uuid,
  p_insurance_company_id uuid default null
) returns table (code text, code_system text, description text)
```

### app_lab_order_auto_complete(0)

عُرِّفت في: `0013`، `0083`

```sql
app_lab_order_auto_complete(
) returns trigger
```

### app_lab_reference_for_patient(3)

عُرِّفت في: `0083`

```sql
app_lab_reference_for_patient(
  p_lab_test_id uuid,
  p_patient_id uuid,
  p_component_id uuid default null
) returns table (low_value numeric, high_value numeric, critical_low numeric, critical_high numeric, text_reference text, unit text)
```

### app_lab_result_flag_abnormal(0)

عُرِّفت في: `0013`

```sql
app_lab_result_flag_abnormal(
) returns trigger
```

### app_lab_status_allowed(2)

عُرِّفت في: `0083`

```sql
app_lab_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_launch_readiness(1)

عُرِّفت في: `0112`

```sql
app_launch_readiness(
  p_org uuid
) returns table ( check_key text, severity text, title text, detail text, item_count integer, is_ok boolean )
```

### app_legacy_exam_field_label(1)

عُرِّفت في: `0145`

```sql
app_legacy_exam_field_label(
  p_key text
) returns text
```

### app_lift_contact_block(2)

عُرِّفت في: `0063`

```sql
app_lift_contact_block(
  p_block_id uuid,
  p_reason text
) returns void
```

### app_link_patient_portal_account(2)

عُرِّفت في: `0104`

```sql
app_link_patient_portal_account(
  p_patient_id uuid,
  p_email text
) returns uuid
```

### app_locale(1)

عُرِّفت في: `0109`

```sql
app_locale(
  p_org uuid
) returns organization_locale_settings
```

### app_log_employee_change(0)

عُرِّفت في: `0100`

```sql
app_log_employee_change(
) returns trigger
```

### app_log_record_access(6)

عُرِّفت في: `0125`

```sql
app_log_record_access(
  p_patient_id uuid,
  p_access_type text default 'view',
  p_context text default null,
  p_reason text default null,
  p_visit_id uuid default null,
  p_device_name text default null
) returns uuid
```

### app_mark_all_notifications_read(1)

عُرِّفت في: `0103`، `0120`

```sql
app_mark_all_notifications_read(
  p_org uuid
) returns integer
```

### app_mark_integration_attempt(4)

عُرِّفت في: `0110`

```sql
app_mark_integration_attempt(
  p_kind text,
  p_id uuid,
  p_success boolean,
  p_error text default null
) returns void
```

### app_mark_leave_attendance(1)

عُرِّفت في: `0145`

```sql
app_mark_leave_attendance(
  p_request_id uuid
) returns int
```

### app_mark_message_failed(3)

عُرِّفت في: `0054`

```sql
app_mark_message_failed(
  p_message_id bigint,
  p_error text,
  p_permanent boolean default false
) returns void
```

### app_mark_message_sent(2)

عُرِّفت في: `0054`

```sql
app_mark_message_sent(
  p_message_id bigint,
  p_provider_message_id text default null
) returns void
```

### app_mark_notification_read(1)

عُرِّفت في: `0103`

```sql
app_mark_notification_read(
  p_id uuid
) returns void
```

### app_mark_previous_contract_renewed(0)

عُرِّفت في: `0021`

```sql
app_mark_previous_contract_renewed(
) returns trigger
```

### app_mask_text(2)

عُرِّفت في: `0095`

```sql
app_mask_text(
  p_value text,
  p_keep integer default 4
) returns text
```

### app_measure_quality_indicator(5)

عُرِّفت في: `0106`

```sql
app_measure_quality_indicator(
  p_indicator_id uuid,
  p_from date,
  p_to date,
  p_manual_value numeric default null,
  p_note text default null
) returns uuid
```

### app_merge_patients(3)

عُرِّفت في: `0066`

```sql
app_merge_patients(
  p_primary_patient_id uuid,
  p_duplicate_patient_id uuid,
  p_reason text
) returns jsonb
```

### app_next_document_number(3)

عُرِّفت في: `0092`

```sql
app_next_document_number(
  p_organization_id uuid,
  p_document_kind text,
  p_branch_id uuid default null
) returns bigint
```

### app_next_short_item_code(1)

عُرِّفت في: `0146`

```sql
app_next_short_item_code(
  p_organization_id uuid
) returns text
```

### app_normalize_mobile(1)

عُرِّفت في: `0063`

```sql
app_normalize_mobile(
  p_mobile text
) returns text
```

### app_normalize_phone(2)

عُرِّفت في: `0109`

```sql
app_normalize_phone(
  p_country text,
  p_phone text
) returns text
```

### app_notify(12)

عُرِّفت في: `0103`

```sql
app_notify(
  p_org uuid,
  p_user_id uuid,
  p_event_key text,
  p_title text,
  p_dedupe_key text,
  p_body text default null,
  p_category text default 'operational',
  p_severity text default 'info',
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action_path text default null,
  p_branch_id uuid default null
) returns uuid
```

### app_notify_asset_event(0)

عُرِّفت في: `0103`

```sql
app_notify_asset_event(
) returns trigger
```

### app_notify_asset_status(0)

عُرِّفت في: `0103`

```sql
app_notify_asset_status(
) returns trigger
```

### app_notify_claim_rejected(0)

عُرِّفت في: `0103`

```sql
app_notify_claim_rejected(
) returns trigger
```

### app_notify_consent_override(0)

عُرِّفت في: `0103`

```sql
app_notify_consent_override(
) returns trigger
```

### app_notify_event(9)

عُرِّفت في: `0103`

```sql
app_notify_event(
  p_org uuid,
  p_event_key text,
  p_title text,
  p_dedupe_key text,
  p_body text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action_path text default null,
  p_branch_id uuid default null
) returns integer
```

### app_notify_payroll_pending(0)

عُرِّفت في: `0103`

```sql
app_notify_payroll_pending(
) returns trigger
```

### app_notify_stock_reorder(0)

عُرِّفت في: `0103`

```sql
app_notify_stock_reorder(
) returns trigger
```

### app_open_cash_shift(3)

عُرِّفت في: `0091`

```sql
app_open_cash_shift(
  p_cash_register_id uuid,
  p_opening_balance numeric default 0,
  p_note text default null
) returns uuid
```

### app_org_policy(1)

عُرِّفت في: `0107`

```sql
app_org_policy(
  p_org uuid
) returns organization_policies
```

### app_package_unused_value(1)

عُرِّفت في: `0096`

```sql
app_package_unused_value(
  p_patient_package_id uuid
) returns numeric
```

### app_patient_by_id_number(3)

عُرِّفت في: `0146`

```sql
app_patient_by_id_number(
  p_organization_id uuid,
  p_id_number text,
  p_exclude_patient_id uuid default null
) returns table (patient_id uuid, name_ar text, file_number bigint, is_merged boolean)
```

### app_patient_last_consultation_date(2)

عُرِّفت في: `0004`

```sql
app_patient_last_consultation_date(
  p_patient_id uuid,
  p_specialty_value_id uuid default null
) returns date
```

### app_patient_timeline_visit_status(1)

عُرِّفت في: `0090`

```sql
app_patient_timeline_visit_status(
  p_visit_id uuid
) returns text
```

### app_pay_payroll_item(2)

عُرِّفت في: `0145`

```sql
app_pay_payroll_item(
  p_item_id uuid,
  p_note text default null
) returns uuid
```

### app_pay_payroll_run(1)

عُرِّفت في: `0100`

```sql
app_pay_payroll_run(
  p_run_id uuid
) returns uuid
```

### app_pay_supplier_invoice(6)

عُرِّفت في: `0097`

```sql
app_pay_supplier_invoice(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method_value_id uuid,
  p_cash_register_id uuid default null,
  p_reference text default null,
  p_note text default null
) returns uuid
```

### app_payroll_bank_file(1)

عُرِّفت في: `0100`

```sql
app_payroll_bank_file(
  p_run_id uuid
) returns table ( employee_name text, job_number text, bank_iban text, net_salary numeric, is_ready boolean, issue text )
```

### app_period_for_date(2)

عُرِّفت في: `0099`

```sql
app_period_for_date(
  p_organization_id uuid,
  p_date date
) returns fiscal_periods
```

### app_pick_message_template(4)

عُرِّفت في: `0069`

```sql
app_pick_message_template(
  p_organization_id uuid,
  p_event_key text,
  p_channel text,
  p_language text default 'ar'
) returns text
```

### app_plan_tooth_procedures(6)

عُرِّفت في: `0141`

```sql
app_plan_tooth_procedures(
  p_organization_id uuid,
  p_patient_id uuid,
  p_procedures jsonb,
  p_doctor_id uuid default null,
  p_visit_id uuid default null,
  p_branch_id uuid default null
) returns integer
```

### app_portal_cancel_appointment(2)

عُرِّفت في: `0104`، `0107`

```sql
app_portal_cancel_appointment(
  p_appointment_id uuid,
  p_reason text
) returns void
```

### app_portal_patient_id(1)

عُرِّفت في: `0104`

```sql
app_portal_patient_id(
  p_org uuid
) returns uuid
```

### app_portal_request_appointment(6)

عُرِّفت في: `0104`، `0107`

```sql
app_portal_request_appointment(
  p_org uuid,
  p_clinic_id uuid default null,
  p_doctor_id uuid default null,
  p_date date default null,
  p_period text default 'any',
  p_reason text default null
) returns uuid
```

### app_portal_request_change(3)

عُرِّفت في: `0104`

```sql
app_portal_request_change(
  p_org uuid,
  p_field text,
  p_value text
) returns uuid
```

### app_portal_touch(1)

عُرِّفت في: `0104`

```sql
app_portal_touch(
  p_org uuid
) returns void
```

### app_post_asset_depreciation(2)

عُرِّفت في: `0101`

```sql
app_post_asset_depreciation(
  p_org uuid,
  p_month date default date_trunc('month', current_date)::date
) returns uuid
```

### app_post_goods_receipt(1)

عُرِّفت في: `0097`

```sql
app_post_goods_receipt(
  p_receipt_id uuid
) returns integer
```

### app_post_journal_entry(1)

عُرِّفت في: `0099`

```sql
app_post_journal_entry(
  p_entry_id uuid
) returns void
```

### app_post_purchase_invoice_to_gl(0)

عُرِّفت في: `0027`

```sql
app_post_purchase_invoice_to_gl(
) returns trigger
```

### app_post_purchase_return(1)

عُرِّفت في: `0097`

```sql
app_post_purchase_return(
  p_return_id uuid
) returns integer
```

### app_post_sales_invoice_to_gl(0)

عُرِّفت في: `0027`

```sql
app_post_sales_invoice_to_gl(
) returns trigger
```

### app_post_stock_count(1)

عُرِّفت في: `0098`

```sql
app_post_stock_count(
  p_count_id uuid
) returns integer
```

### app_post_voucher_to_gl(0)

عُرِّفت في: `0027`

```sql
app_post_voucher_to_gl(
) returns trigger
```

### app_preauth_status_allowed(2)

عُرِّفت في: `0093`

```sql
app_preauth_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_prescription_status_allowed(2)

عُرِّفت في: `0088`

```sql
app_prescription_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_prevent_appointment_overlap(0)

عُرِّفت في: `0050`

```sql
app_prevent_appointment_overlap(
) returns trigger
```

### app_prevent_posted_entry_line_changes(0)

عُرِّفت في: `0017`

```sql
app_prevent_posted_entry_line_changes(
) returns trigger
```

### app_process_due_appointment_reminders(1)

عُرِّفت في: `0050`، `0054`، `0069`

```sql
app_process_due_appointment_reminders(
  p_limit integer default 100
) returns integer
```

### app_public_booking_catalog(1)

عُرِّفت في: `0128`، `0129`، `0132`

```sql
app_public_booking_catalog(
  p_slug text
) returns jsonb
```

### app_public_create_booking(13)

عُرِّفت في: `0134`

```sql
app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_email text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_item_id uuid,
  p_scheduled_start timestamptz,
  p_payment_method text,
  p_note text default null,
  p_consent boolean default false,
  p_website text default null
) returns jsonb
```

### app_public_doctor_slots(6)

عُرِّفت في: `0135`

```sql
app_public_doctor_slots(
  p_slug text,
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_item_id uuid,
  p_from date default current_date,
  p_days int default 30
) returns jsonb
```

### app_pvs_status_on_claim(0)

عُرِّفت في: `0073`

```sql
app_pvs_status_on_claim(
) returns trigger
```

### app_pvs_status_on_invoice_item(0)

عُرِّفت في: `0073`

```sql
app_pvs_status_on_invoice_item(
) returns trigger
```

### app_pvs_status_on_invoice_status(0)

عُرِّفت في: `0073`

```sql
app_pvs_status_on_invoice_status(
) returns trigger
```

### app_pvs_status_on_return_invoice(0)

عُرِّفت في: `0073`

```sql
app_pvs_status_on_return_invoice(
) returns trigger
```

### app_quarantine_lot(3)

عُرِّفت في: `0098`

```sql
app_quarantine_lot(
  p_lot_id uuid,
  p_reason text,
  p_location_id uuid default null
) returns void
```

### app_queue_appointment_reminder(0)

عُرِّفت في: `0009`

```sql
app_queue_appointment_reminder(
) returns trigger
```

### app_queue_nphies_message(6)

عُرِّفت في: `0093`

```sql
app_queue_nphies_message(
  p_organization_id uuid,
  p_message_type text,
  p_payload jsonb,
  p_claim_form_id uuid default null,
  p_preauth_id uuid default null,
  p_eligibility_id uuid default null
) returns uuid
```

### app_queue_rank(1)

عُرِّفت في: `0065`

```sql
app_queue_rank(
  p_priority text
) returns integer
```

### app_radiology_deliver_images(8)

عُرِّفت في: `0138`

```sql
app_radiology_deliver_images(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_exam_id uuid,
  p_images jsonb,
  p_order_id uuid default null,
  p_note text default null,
  p_branch_id uuid default null
) returns uuid
```

### app_radiology_order_auto_complete(0)

عُرِّفت في: `0014`، `0138`

```sql
app_radiology_order_auto_complete(
) returns trigger
```

### app_radiology_status_allowed(2)

عُرِّفت في: `0084`

```sql
app_radiology_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_raise_critical_result(0)

عُرِّفت في: `0105`

```sql
app_raise_critical_result(
) returns trigger
```

### app_rebuild_exam_schema(1)

عُرِّفت في: `0085`، `0145`

```sql
app_rebuild_exam_schema(
  p_template_id uuid
) returns jsonb
```

### app_recalc_agreement_invoiced(0)

عُرِّفت في: `0003`

```sql
app_recalc_agreement_invoiced(
) returns trigger
```

### app_recalc_agreement_invoiced_amount(1)

عُرِّفت في: `0003`

```sql
app_recalc_agreement_invoiced_amount(
  target_agreement_id uuid
) returns void
```

### app_recalc_claim_batch_total(0)

عُرِّفت في: `0144`

```sql
app_recalc_claim_batch_total(
) returns trigger
```

### app_recalc_dental_lab_order_paid(1)

عُرِّفت في: `0007`، `0144`

```sql
app_recalc_dental_lab_order_paid(
  target_order uuid
) returns void
```

### app_recalc_invoice_paid_amount(1)

عُرِّفت في: `0003`، `0091`

```sql
app_recalc_invoice_paid_amount(
  target_invoice uuid
) returns void
```

### app_recalc_prescription_status(0)

عُرِّفت في: `0015`

```sql
app_recalc_prescription_status(
) returns trigger
```

### app_recalc_review_overall_score(0)

عُرِّفت في: `0023`

```sql
app_recalc_review_overall_score(
) returns trigger
```

### app_receive_invoice_payment(6)

عُرِّفت في: `0091`

```sql
app_receive_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method_value_id uuid,
  p_cash_register_id uuid default null,
  p_reference text default null,
  p_note text default null
) returns uuid
```

### app_receive_stock_transfer(2)

عُرِّفت في: `0098`

```sql
app_receive_stock_transfer(
  p_transfer_id uuid,
  p_lines jsonb default null
) returns integer
```

### app_reception_transition(3)

عُرِّفت في: `0050`، `0055`، `0065`

```sql
app_reception_transition(
  p_appointment_id uuid,
  p_action text,
  p_reason text default null
) returns table (appointment_id uuid, appointment_status text, visit_id uuid)
```

### app_record_calibration(7)

عُرِّفت في: `0101`

```sql
app_record_calibration(
  p_asset_id uuid,
  p_date date,
  p_result text,
  p_certificate text default null,
  p_vendor text default null,
  p_note text default null,
  p_deviation text default null
) returns uuid
```

### app_record_claim_item_response(5)

عُرِّفت في: `0093`

```sql
app_record_claim_item_response(
  p_item_id uuid,
  p_status text,
  p_approved numeric default null,
  p_code text default null,
  p_reason text default null
) returns void
```

### app_record_critical_phone_call(2)

عُرِّفت في: `0105`

```sql
app_record_critical_phone_call(
  p_id uuid,
  p_called text
) returns void
```

### app_record_nphies_response(5)

عُرِّفت في: `0093`

```sql
app_record_nphies_response(
  p_message_id uuid,
  p_status text,
  p_response jsonb default null,
  p_errors jsonb default null,
  p_response_id text default null
) returns void
```

### app_record_patient_consent(6)

عُرِّفت في: `0095`

```sql
app_record_patient_consent(
  p_patient_id uuid,
  p_consent_type text,
  p_purpose text,
  p_expires_at timestamptz default null,
  p_document_id uuid default null,
  p_note text default null
) returns uuid
```

### app_record_stock_count_line(3)

عُرِّفت في: `0098`

```sql
app_record_stock_count_line(
  p_count_item_id uuid,
  p_counted_qty numeric,
  p_reason text default null
) returns void
```

### app_record_treatment_session(14)

عُرِّفت في: `0142`

```sql
app_record_treatment_session(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_doctor_id uuid default null,
  p_body_area_value_id uuid default null,
  p_device_resource_id uuid default null,
  p_parameters jsonb default '{}'::jsonb,
  p_adverse_events text[] default '{}',
  p_adverse_note text default null,
  p_note text default null,
  p_agreement_item_id uuid default null,
  p_package_id uuid default null,
  p_override_reason text default null,
  p_branch_id uuid default null
) returns uuid
```

### app_record_vital_signs(7)

عُرِّفت في: `0139`

```sql
app_record_vital_signs(
  p_organization_id uuid,
  p_patient_id uuid,
  p_values jsonb,
  p_request_id uuid default null,
  p_visit_id uuid default null,
  p_doctor_id uuid default null,
  p_branch_id uuid default null
) returns uuid
```

### app_refund_invoice_payment(4)

عُرِّفت في: `0091`

```sql
app_refund_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text,
  p_cash_register_id uuid default null
) returns uuid
```

### app_register_entity_document(13)

عُرِّفت في: `0102`

```sql
app_register_entity_document(
  p_org uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_storage_path text,
  p_file_name text default null,
  p_category text default null,
  p_branch_id uuid default null,
  p_issue_date date default null,
  p_expires_at date default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_note text default null
) returns uuid
```

### app_register_patient_document(14)

عُرِّفت في: `0102`

```sql
app_register_patient_document(
  p_patient_id uuid,
  p_storage_path text,
  p_file_name text,
  p_category text default 'document',
  p_visit_id uuid default null,
  p_item_id uuid default null,
  p_is_consent boolean default false,
  p_expires_at date default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_template_id uuid default null,
  p_generated_document_id uuid default null,
  p_doc_type_value_id uuid default null,
  p_note text default null
) returns uuid
```

### app_reject_appointment_request(2)

عُرِّفت في: `0104`

```sql
app_reject_appointment_request(
  p_request_id uuid,
  p_reason text
) returns void
```

### app_reject_purchase_request(2)

عُرِّفت في: `0097`

```sql
app_reject_purchase_request(
  p_request_id uuid,
  p_reason text
) returns void
```

### app_reject_stock_transfer(2)

عُرِّفت في: `0098`

```sql
app_reject_stock_transfer(
  p_transfer_id uuid,
  p_reason text
) returns void
```

### app_release_on_prescription_cancel(0)

عُرِّفت في: `0088`

```sql
app_release_on_prescription_cancel(
) returns trigger
```

### app_release_prescription_reservations(2)

عُرِّفت في: `0088`

```sql
app_release_prescription_reservations(
  p_prescription_id uuid,
  p_reason text default null
) returns integer
```

### app_render_document_template(5)

عُرِّفت في: `0102`

```sql
app_render_document_template(
  p_template_id uuid,
  p_patient_id uuid default null,
  p_employee_id uuid default null,
  p_visit_id uuid default null,
  p_extra jsonb default '{}'::jsonb
) returns uuid
```

### app_renew_patient_package(2)

عُرِّفت في: `0096`

```sql
app_renew_patient_package(
  p_patient_package_id uuid,
  p_note text default null
) returns jsonb
```

### app_renumber_service_codes(1)

عُرِّفت في: `0146`

```sql
app_renumber_service_codes(
  p_organization_id uuid
) returns integer
```

### app_reopen_fiscal_period(2)

عُرِّفت في: `0099`

```sql
app_reopen_fiscal_period(
  p_period_id uuid,
  p_reason text
) returns void
```

### app_report_appointments(9)

عُرِّفت في: `0068`

```sql
app_report_appointments(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_visit_type_id uuid default null,
  p_source_id uuid default null,
  p_insurance text default null
) returns table ( total bigint, confirmed bigint, unconfirmed bigint, cancelled bigint, no_show bigint, completed bigint, walk_in bigint )
```

### app_report_asset_fault(4)

عُرِّفت في: `0101`

```sql
app_report_asset_fault(
  p_asset_id uuid,
  p_description text,
  p_severity text default 'normal',
  p_out_of_service boolean default false
) returns uuid
```

### app_report_booking_sources(6)

عُرِّفت في: `0144`

```sql
app_report_booking_sources(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
) returns table ( source_id uuid, source_name text, total bigint, completed bigint, no_show bigint, share_pct numeric )
```

### app_report_no_show(6)

عُرِّفت في: `0144`

```sql
app_report_no_show(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
) returns table ( doctor_id uuid, doctor_name text, total bigint, no_show_count bigint, cancelled_count bigint, no_show_pct numeric, avg_invoice numeric, estimated_loss numeric )
```

### app_report_occupancy(6)

عُرِّفت في: `0144`

```sql
app_report_occupancy(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
) returns table ( doctor_id uuid, doctor_name text, available_hours numeric, booked_hours numeric, utilization_pct numeric, idle_hours numeric )
```

### app_report_quality_incident(10)

عُرِّفت في: `0106`

```sql
app_report_quality_incident(
  p_org uuid,
  p_category text,
  p_severity text,
  p_description text,
  p_branch_id uuid default null,
  p_patient_id uuid default null,
  p_occurred_at timestamptz default now(),
  p_location text default null,
  p_immediate text default null,
  p_anonymous boolean default false
) returns uuid
```

### app_report_repeat_no_show(7)

عُرِّفت في: `0144`

```sql
app_report_repeat_no_show(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_min_count integer default 2,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
) returns table ( patient_id uuid, patient_name text, file_number text, mobile_number text, no_show_count bigint, last_no_show timestamp with time zone )
```

### app_report_waiting(6)

عُرِّفت في: `0068`

```sql
app_report_waiting(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null
) returns table ( doctor_id uuid, doctor_name text, clinic_name text, patients_count bigint, avg_wait_to_call numeric, max_wait_to_call numeric, avg_wait_to_start numeric, avg_in_clinic numeric )
```

### app_request_device_name(0)

عُرِّفت في: `0043`، `0044`

```sql
app_request_device_name(
) returns text
```

### app_request_vital_signs(9)

عُرِّفت في: `0139`

```sql
app_request_vital_signs(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid default null,
  p_request_kind text default 'general',
  p_measures text[] default null,
  p_priority text default 'routine',
  p_note text default null,
  p_visit_id uuid default null,
  p_branch_id uuid default null
) returns uuid
```

### app_requeue_integration_message(3)

عُرِّفت في: `0110`

```sql
app_requeue_integration_message(
  p_kind text,
  p_id uuid,
  p_reason text
) returns void
```

### app_required_approval_role(3)

عُرِّفت في: `0097`

```sql
app_required_approval_role(
  p_organization_id uuid,
  p_amount numeric,
  p_branch_id uuid default null
) returns text
```

### app_reschedule_appointment(6)

عُرِّفت في: `0064`، `0071`

```sql
app_reschedule_appointment(
  p_appointment_id uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_reason text default null
) returns jsonb
```

### app_resend_message(1)

عُرِّفت في: `0069`

```sql
app_resend_message(
  p_message_id bigint
) returns void
```

### app_reserve_prescription(2)

عُرِّفت في: `0088`

```sql
app_reserve_prescription(
  p_prescription_id uuid,
  p_warehouse_id uuid
) returns jsonb
```

### app_resolve_discount(4)

عُرِّفت في: `0004`

```sql
app_resolve_discount(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_as_of date default current_date
) returns numeric
```

### app_resolve_item_price(6)

عُرِّفت في: `0072`

```sql
app_resolve_item_price(
  p_organization_id uuid,
  p_item_id uuid,
  p_branch_id uuid default null,
  p_insurance_company_id uuid default null,
  p_external_client_id uuid default null,
  p_as_of date default current_date
) returns table ( price numeric, discount_percent numeric, source_kind text, source_list_id uuid, source_list_name text )
```

### app_resolve_item_price_v2(6)

عُرِّفت في: `0089`

```sql
app_resolve_item_price_v2(
  p_organization_id uuid,
  p_item_id uuid,
  p_branch_id uuid default null,
  p_insurance_company_id uuid default null,
  p_external_client_id uuid default null,
  p_as_of date default current_date
) returns table ( price numeric, discount_percent numeric, source_kind text, source_list_id uuid, source_list_name text, contract_id uuid )
```

### app_resolve_staff_request(3)

عُرِّفت في: `0138`

```sql
app_resolve_staff_request(
  p_request_id uuid,
  p_status text default 'done',
  p_note text default null
) returns void
```

### app_resolve_vat_rate(3)

عُرِّفت في: `0004`

```sql
app_resolve_vat_rate(
  p_organization_id uuid,
  p_item_id uuid,
  p_patient_id uuid default null
) returns table (vat_rate numeric, is_exempt boolean)
```

### app_resource_free_at(3)

عُرِّفت في: `0084`

```sql
app_resource_free_at(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns boolean
```

### app_restore_item(1)

عُرِّفت في: `0071`

```sql
app_restore_item(
  p_item_id uuid
) returns void
```

### app_resubmit_claim_form(2)

عُرِّفت في: `0089`

```sql
app_resubmit_claim_form(
  p_form_id uuid,
  p_note text default null
) returns uuid
```

### app_resume_patient_package(1)

عُرِّفت في: `0096`

```sql
app_resume_patient_package(
  p_patient_package_id uuid
) returns void
```

### app_revenue_by_clinic(3)

عُرِّفت في: `0143`

```sql
app_revenue_by_clinic(
  p_organization_id uuid,
  p_from date,
  p_to date
) returns table ( clinic_id uuid, clinic_name text, invoice_count bigint, net_amount numeric, appointment_count bigint )
```

### app_revenue_by_doctor(3)

عُرِّفت في: `0143`

```sql
app_revenue_by_doctor(
  p_organization_id uuid,
  p_from date,
  p_to date
) returns table ( doctor_id uuid, doctor_name text, invoice_count bigint, net_amount numeric, cash_amount numeric, insurance_amount numeric )
```

### app_reverse_journal_entry(3)

عُرِّفت في: `0099`

```sql
app_reverse_journal_entry(
  p_entry_id uuid,
  p_reason text,
  p_date date default null
) returns uuid
```

### app_reverse_package_usage(2)

عُرِّفت في: `0096`

```sql
app_reverse_package_usage(
  p_usage_id uuid,
  p_reason text
) returns void
```

### app_revoke_patient_portal_access(2)

عُرِّفت في: `0104`

```sql
app_revoke_patient_portal_access(
  p_account_id uuid,
  p_reason text
) returns void
```

### app_sales_invoice_zatca_qr(0)

عُرِّفت في: `0058`

```sql
app_sales_invoice_zatca_qr(
) returns trigger
```

### app_save_clinic(3)

عُرِّفت في: `0080`

```sql
app_save_clinic(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_payload jsonb
) returns uuid
```

### app_save_department(3)

عُرِّفت في: `0080`

```sql
app_save_department(
  p_organization_id uuid,
  p_department_id uuid,
  p_payload jsonb
) returns uuid
```

### app_save_drug(3)

عُرِّفت في: `0088`

```sql
app_save_drug(
  p_organization_id uuid,
  p_item_id uuid,
  p_payload jsonb
) returns uuid
```

### app_save_lab_test(3)

عُرِّفت في: `0083`

```sql
app_save_lab_test(
  p_organization_id uuid,
  p_lab_test_id uuid,
  p_payload jsonb
) returns uuid
```

### app_save_locale_settings(2)

عُرِّفت في: `0109`

```sql
app_save_locale_settings(
  p_org uuid,
  p_changes jsonb
) returns void
```

### app_save_org_policies(2)

عُرِّفت في: `0107`

```sql
app_save_org_policies(
  p_org uuid,
  p_changes jsonb
) returns void
```

### app_save_radiology_exam(3)

عُرِّفت في: `0084`

```sql
app_save_radiology_exam(
  p_organization_id uuid,
  p_exam_id uuid,
  p_payload jsonb
) returns uuid
```

### app_save_service(5)

عُرِّفت في: `0077`

```sql
app_save_service(
  p_organization_id uuid,
  p_item_id uuid,
  p_payload jsonb,
  p_branch_ids uuid[] default null,
  p_resource_ids uuid[] default null
) returns uuid
```

### app_save_visit(25)

عُرِّفت في: `0061`

```sql
app_save_visit(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid default null,
  p_appointment_id uuid default null,
  p_template_id uuid default null,
  p_canvas_type text default 'none',
  p_main_complaint text default null,
  p_exam_data jsonb default '{}'::jsonb,
  p_notes text default null,
  p_next_visit_plan text default null,
  p_next_visit_date date default null,
  p_services jsonb default '[]'::jsonb,
  p_diagnoses uuid[] default null,
  p_vitals jsonb default null,
  p_dental jsonb default null,
  p_body_diagram jsonb default null,
  p_occupational jsonb default null,
  p_lab_test_ids uuid[] default null,
  p_radiology_exam_ids uuid[] default null,
  p_prescription_items jsonb default '[]'::jsonb,
  p_order_priority text default 'routine',
  p_lab_notes text default null,
  p_clinical_indication text default null,
  p_prescription_notes text default null
) returns jsonb
```

### app_schedule_appointment_reminders(0)

عُرِّفت في: `0050`

```sql
app_schedule_appointment_reminders(
) returns trigger
```

### app_schedule_radiology_order(4)

عُرِّفت في: `0084`

```sql
app_schedule_radiology_order(
  p_order_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_duration int default null
) returns uuid
```

### app_seed_asset_depreciation_rule(1)

عُرِّفت في: `0101`

```sql
app_seed_asset_depreciation_rule(
  p_org uuid
) returns uuid
```

### app_seed_default_chart_of_accounts(1)

عُرِّفت في: `0017`

```sql
app_seed_default_chart_of_accounts(
  target_organization_id uuid
) returns void
```

### app_seed_gl_posting_rules(1)

عُرِّفت في: `0099`

```sql
app_seed_gl_posting_rules(
  p_organization_id uuid
) returns integer
```

### app_seed_global_lookup(4)

عُرِّفت في: `0146`

```sql
app_seed_global_lookup(
  p_key text,
  p_name_ar text,
  p_name_en text,
  p_values jsonb
) returns integer
```

### app_seed_integration_rules(1)

عُرِّفت في: `0110`

```sql
app_seed_integration_rules(
  p_org uuid
) returns integer
```

### app_seed_integration_rules_on_org(0)

عُرِّفت في: `0110`

```sql
app_seed_integration_rules_on_org(
) returns trigger
```

### app_seed_notification_rules(1)

عُرِّفت في: `0103`، `0105`، `0106`

```sql
app_seed_notification_rules(
  p_org uuid
) returns integer
```

### app_seed_notification_rules_on_org(0)

عُرِّفت في: `0103`

```sql
app_seed_notification_rules_on_org(
) returns trigger
```

### app_seed_quality_indicators(1)

عُرِّفت في: `0106`

```sql
app_seed_quality_indicators(
  p_org uuid
) returns integer
```

### app_seed_quality_on_org(0)

عُرِّفت في: `0106`

```sql
app_seed_quality_on_org(
) returns trigger
```

### app_seed_radiology_relay_rules(1)

عُرِّفت في: `0138`

```sql
app_seed_radiology_relay_rules(
  p_org uuid
) returns integer
```

### app_seed_session_rules(1)

عُرِّفت في: `0142`

```sql
app_seed_session_rules(
  p_org uuid
) returns integer
```

### app_seed_subspecialties(0)

عُرِّفت في: `0140`

```sql
app_seed_subspecialties(
) returns integer
```

### app_seed_vitals_rules(1)

عُرِّفت في: `0139`

```sql
app_seed_vitals_rules(
  p_org uuid
) returns integer
```

### app_sell_package(6)

عُرِّفت في: `0096`

```sql
app_sell_package(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id uuid default null,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_note text default null
) returns jsonb
```

### app_send_appointment_confirmation(1)

عُرِّفت في: `0069`

```sql
app_send_appointment_confirmation(
  p_appointment_id uuid
) returns bigint
```

### app_service_consent_status(2)

عُرِّفت في: `0102`

```sql
app_service_consent_status(
  p_visit_id uuid,
  p_item_id uuid
) returns text
```

### app_services_for_doctor(4)

عُرِّفت في: `0081`

```sql
app_services_for_doctor(
  p_organization_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid default null,
  p_branch_id uuid default null
) returns table ( id uuid, name_ar text, medical_service_type text, duration_minutes int, price numeric, source text )
```

### app_set_appointment_priority(3)

عُرِّفت في: `0065`

```sql
app_set_appointment_priority(
  p_appointment_id uuid,
  p_priority text,
  p_reason text
) returns void
```

### app_set_asset_status(3)

عُرِّفت في: `0101`

```sql
app_set_asset_status(
  p_asset_id uuid,
  p_status text,
  p_reason text
) returns void
```

### app_set_claim_form_status(5)

عُرِّفت في: `0089`

```sql
app_set_claim_form_status(
  p_form_id uuid,
  p_status text,
  p_reason text default null,
  p_amount numeric default null,
  p_code text default null
) returns void
```

### app_set_einvoice_status(4)

عُرِّفت في: `0092`

```sql
app_set_einvoice_status(
  p_document_id uuid,
  p_status text,
  p_response jsonb default null,
  p_errors jsonb default null
) returns void
```

### app_set_invoice_status(3)

عُرِّفت في: `0091`

```sql
app_set_invoice_status(
  p_invoice_id uuid,
  p_status text,
  p_reason text default null
) returns void
```

### app_set_lab_order_status(3)

عُرِّفت في: `0083`

```sql
app_set_lab_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
) returns void
```

### app_set_member_active(4)

عُرِّفت في: `0108`

```sql
app_set_member_active(
  p_org uuid,
  p_user_id uuid,
  p_active boolean,
  p_reason text
) returns void
```

### app_set_member_permission(5)

عُرِّفت في: `0108`

```sql
app_set_member_permission(
  p_org uuid,
  p_user_id uuid,
  p_permission text,
  p_granted boolean,
  p_reason text default null
) returns void
```

### app_set_membership_role(4)

عُرِّفت في: `0108`

```sql
app_set_membership_role(
  p_org uuid,
  p_user_id uuid,
  p_role_key text,
  p_reason text default null
) returns void
```

### app_set_notification_preference(3)

عُرِّفت في: `0103`

```sql
app_set_notification_preference(
  p_org uuid,
  p_category text,
  p_muted boolean
) returns void
```

### app_set_patient_package_expiry(0)

عُرِّفت في: `0016`

```sql
app_set_patient_package_expiry(
) returns trigger
```

### app_set_preauth_status(7)

عُرِّفت في: `0093`

```sql
app_set_preauth_status(
  p_preauth_id uuid,
  p_status text,
  p_reason text default null,
  p_amount numeric default null,
  p_approval_number text default null,
  p_valid_to date default null,
  p_qty numeric default null
) returns void
```

### app_set_prescription_status(3)

عُرِّفت في: `0088`

```sql
app_set_prescription_status(
  p_prescription_id uuid,
  p_status text,
  p_reason text default null
) returns void
```

### app_set_price_list_item(5)

عُرِّفت في: `0072`

```sql
app_set_price_list_item(
  p_price_list_id uuid,
  p_item_id uuid,
  p_price numeric,
  p_effective_from date default current_date,
  p_discount_percent numeric default 0
) returns uuid
```

### app_set_radiology_order_status(3)

عُرِّفت في: `0084`

```sql
app_set_radiology_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
) returns void
```

### app_set_tooth_condition(7)

عُرِّفت في: `0141`

```sql
app_set_tooth_condition(
  p_organization_id uuid,
  p_patient_id uuid,
  p_tooth_number text,
  p_condition text,
  p_tooth_type text default 'permanent',
  p_surfaces text[] default null,
  p_note text default null
) returns uuid
```

### app_set_training_completed_at(0)

عُرِّفت في: `0023`

```sql
app_set_training_completed_at(
) returns trigger
```

### app_set_visit_service_status(3)

عُرِّفت في: `0073`

```sql
app_set_visit_service_status(
  p_visit_service_id uuid,
  p_status text,
  p_note text default null
) returns void
```

### app_set_visit_status(3)

عُرِّفت في: `0087`

```sql
app_set_visit_status(
  p_visit_id uuid,
  p_status text,
  p_reason text default null
) returns void
```

### app_settle_insurance_claims(5)

عُرِّفت في: `0093`

```sql
app_settle_insurance_claims(
  p_company_id uuid,
  p_claims uuid[],
  p_paid_total numeric,
  p_reference text default null,
  p_note text default null
) returns uuid
```

### app_setup_reminder_schedules(5)

عُرِّفت في: `0070`

```sql
app_setup_reminder_schedules(
  p_functions_base_url text,
  p_secret_name text default 'reminders_service_key',
  p_enqueue_cron text default '*/5 * * * *',
  p_dispatch_cron text default '*/1 * * * *',
  p_cron_secret_name text default 'reminders_cron_secret'
) returns text
```

### app_ship_stock_transfer(1)

عُرِّفت في: `0098`

```sql
app_ship_stock_transfer(
  p_transfer_id uuid
) returns integer
```

### app_sign_document(9)

عُرِّفت في: `0102`

```sql
app_sign_document(
  p_kind text,
  p_document_id uuid,
  p_signer_role text,
  p_signer_name text,
  p_method text default 'on_screen',
  p_signature_path text default null,
  p_signer_id_number text default null,
  p_relation text default null,
  p_note text default null
) returns uuid
```

### app_snapshot_exam_template(0)

عُرِّفت في: `0085`

```sql
app_snapshot_exam_template(
) returns trigger
```

### app_stamp_invoice_on_issue(0)

عُرِّفت في: `0092`

```sql
app_stamp_invoice_on_issue(
) returns trigger
```

### app_stamp_voucher_business_day(0)

عُرِّفت في: `0147`

```sql
app_stamp_voucher_business_day(
) returns trigger
```

### app_start_stock_count(5)

عُرِّفت في: `0098`

```sql
app_start_stock_count(
  p_warehouse_id uuid,
  p_count_type text default 'periodic',
  p_number text default null,
  p_item_ids uuid[] default null,
  p_scope_note text default null
) returns uuid
```

### app_submit_purchase_request(1)

عُرِّفت في: `0097`

```sql
app_submit_purchase_request(
  p_request_id uuid
) returns void
```

### app_sync_asset_resource_status(0)

عُرِّفت في: `0101`

```sql
app_sync_asset_resource_status(
) returns trigger
```

### app_sync_controlled_flag(0)

عُرِّفت في: `0088`

```sql
app_sync_controlled_flag(
) returns trigger
```

### app_sync_lot_reservation(0)

عُرِّفت في: `0088`

```sql
app_sync_lot_reservation(
) returns trigger
```

### app_sync_vat_rate_from_organization(0)

عُرِّفت في: `0122`

```sql
app_sync_vat_rate_from_organization(
) returns trigger
```

### app_sync_vat_rate_from_settings(0)

عُرِّفت في: `0122`

```sql
app_sync_vat_rate_from_settings(
) returns trigger
```

### app_sync_visit_with_reception(0)

عُرِّفت في: `0090`

```sql
app_sync_visit_with_reception(
) returns trigger
```

### app_sync_working_hours_flag(0)

عُرِّفت في: `0081`

```sql
app_sync_working_hours_flag(
) returns trigger
```

### app_template_usage_count(1)

عُرِّفت في: `0085`

```sql
app_template_usage_count(
  p_template_id uuid
) returns integer
```

### app_tooth_condition_after(1)

عُرِّفت في: `0141`

```sql
app_tooth_condition_after(
  p_kind text
) returns text
```

### app_tooth_condition_keys(0)

عُرِّفت في: `0141`

```sql
app_tooth_condition_keys(
) returns text[]
```

### app_tooth_surface_keys(0)

عُرِّفت في: `0141`

```sql
app_tooth_surface_keys(
) returns text[]
```

### app_touch_conversation_last_message(0)

عُرِّفت في: `0026`

```sql
app_touch_conversation_last_message(
) returns trigger
```

### app_touch_exam_schema(0)

عُرِّفت في: `0085`

```sql
app_touch_exam_schema(
) returns trigger
```

### app_trace_lot(1)

عُرِّفت في: `0098`

```sql
app_trace_lot(
  p_lot_id uuid
) returns table ( step_order integer, step_kind text, occurred_at timestamptz, warehouse_id uuid, qty numeric, reference text, patient_id uuid, created_by uuid )
```

### app_transfer_asset(5)

عُرِّفت في: `0101`

```sql
app_transfer_asset(
  p_asset_id uuid,
  p_to_branch_id uuid,
  p_to_clinic_id uuid default null,
  p_to_room text default null,
  p_reason text default null
) returns uuid
```

### app_transfer_patient_package(3)

عُرِّفت في: `0096`

```sql
app_transfer_patient_package(
  p_patient_package_id uuid,
  p_to_patient_id uuid,
  p_reason text
) returns void
```

### app_transfer_reception_appointment(4)

عُرِّفت في: `0065`

```sql
app_transfer_reception_appointment(
  p_appointment_id uuid,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_reason text default null
) returns jsonb
```

### app_users_with_permission(2)

عُرِّفت في: `0103`

```sql
app_users_with_permission(
  p_org uuid,
  p_permission text
) returns setof uuid
```

### app_validate_appointment_status_transition(0)

عُرِّفت في: `0050`، `0055`، `0065`

```sql
app_validate_appointment_status_transition(
) returns trigger
```

### app_validate_drug_details_item_type(0)

عُرِّفت في: `0015`

```sql
app_validate_drug_details_item_type(
) returns trigger
```

### app_validate_journal_entry_balance(0)

عُرِّفت في: `0017`

```sql
app_validate_journal_entry_balance(
) returns trigger
```

### app_validate_leave_request(0)

عُرِّفت في: `0020`

```sql
app_validate_leave_request(
) returns trigger
```

### app_validate_national_id(2)

عُرِّفت في: `0109`

```sql
app_validate_national_id(
  p_country text,
  p_id text
) returns boolean
```

### app_validate_package_usage(0)

عُرِّفت في: `0016`، `0075`

```sql
app_validate_package_usage(
) returns trigger
```

### app_visit_service_status_allowed(2)

عُرِّفت في: `0073`

```sql
app_visit_service_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_visit_status_allowed(2)

عُرِّفت في: `0087`

```sql
app_visit_status_allowed(
  p_from text,
  p_to text
) returns boolean
```

### app_vital_general_measures(0)

عُرِّفت في: `0139`

```sql
app_vital_general_measures(
) returns text[]
```

### app_vital_measure_keys(0)

عُرِّفت في: `0139`

```sql
app_vital_measure_keys(
) returns text[]
```

### app_void_financial_voucher(2)

عُرِّفت في: `0091`

```sql
app_void_financial_voucher(
  p_voucher_id uuid,
  p_reason text
) returns void
```

### app_withdraw_patient_consent(2)

عُرِّفت في: `0095`

```sql
app_withdraw_patient_consent(
  p_consent_id uuid,
  p_reason text
) returns void
```

### app_zatca_tlv(2)

عُرِّفت في: `0058`

```sql
app_zatca_tlv(
  p_tag integer,
  p_value text
) returns bytea
```

