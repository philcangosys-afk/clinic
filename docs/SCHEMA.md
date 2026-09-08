# مرجع مخطط قاعدة ZainCare

> **مُولَّد آليًّا — لا يُحرَّر يدويًّا.** أعِد توليده بعد كل ترقية جديدة:
> `python scripts/schema-doc.py`

## كيف قُرئ

قُرئت 147 ملفّ ترقية بترتيبها الرقميّ — `supabase/migrations/0001–0012` ثم
`migrations/0013…0149` — وحوكي أثرها تراكميًّا: كل `create table` تُنشئ،
وكل `alter table` تعدّل، وكل `drop` تحذف. فما تراه هنا هو المخطط **بعد آخر
ترقية**، لا كما كان يوم إنشائه. ودخل المولّد إلى أجسام `do $$ … $$` لأنّ
معظم قيود المفاتيح تُضاف داخلها بحارس `if not exists`.

## الأرقام

| | من الترقيات (هنا) | من فحص الإنتاج (`docs/deep-gap-probe.sql`) |
| --- | ---: | ---: |
| جداول | 232 | 232 |
| دوالّ | 421 | 420 |
| منظورات | 175 | 175 |
| مفاتيح ربط | 1047 | 1076 |
| فهارس | 383 | — |

**الجداول والمنظورات تطابق الإنتاج عددًا بعد `0149`** التي تبنّت ستّة كائنات
كانت تعمل في الإنتاج ولا يُنشئها أيّ ملفّ. الفرق الباقي في المفاتيح يعود إلى
قيود تُنشأ داخل نصوص `execute` لا يقرأها التحليل الساكن.
**المرجع في تعارضٍ هو القاعدة الحيّة، لا هذا الملفّ.**

لا يستعمل المشروع أنواع `enum` إطلاقًا (0 نوعًا): القيم المحصورة تُفرض بـ
`text ... check (col in (...))`، فتُقرأ من عمود القيد في جدول العمود أدناه.

## الجداول (232)

`appointment_reminder_jobs`  `appointment_requests`  `appointment_waitlist`  `appointments`

`asset_calibrations`  `asset_depreciation_lines`  `asset_depreciation_runs`  `asset_disposals`

`asset_transfers`  `assets`  `attendance_records`  `audit_log`

`bank_reconciliation_lines`  `bank_reconciliations`  `blocked_external_contacts`  `body_diagram_annotations`

`branch_working_hours`  `branches`  `business_days`  `candidate_interviews`

`candidates`  `canned_texts`  `cash_register_shifts`  `cash_registers`

`cbahi_forms`  `chart_of_accounts`  `clinic_exam_templates`  `clinics`

`consultation_fee_rules`  `consultation_fee_settings`  `cost_centers`  `critical_result_notifications`

`custom_reports`  `data_retention_policies`  `dental_chart_entries`  `dental_lab_items`

`dental_lab_order_items`  `dental_lab_orders`  `departments`  `discount_limits`

`dispensing_items`  `dispensing_records`  `distributors`  `doctor_branches`

`doctor_clinics`  `doctor_schedules`  `doctor_services`  `doctor_working_hours`

`doctors`  `document_number_sequences`  `document_signatures`  `document_templates`

`drug_details`  `einvoice_documents`  `employee_contracts`  `employee_documents`

`employee_loans`  `employee_position_history`  `employee_salary_components`  `employee_shift_assignments`

`employees`  `entity_documents`  `exam_field_options`  `exam_template_fields`

`exam_template_sections`  `external_clients`  `facility_licenses`  `feature_catalog`

`financial_vouchers`  `fiscal_periods`  `fiscal_years`  `generated_documents`

`gl_posting_rules`  `goods_receipt_items`  `goods_receipts`  `health_conditions`

`icd10_codes`  `insurance_claim_batch_items`  `insurance_claim_batches`  `insurance_claim_form_items`

`insurance_claim_forms`  `insurance_companies`  `insurance_contracts`  `insurance_coverage_rules`

`insurance_eligibility_checks`  `insurance_form_field_requirements`  `insurance_networks`  `insurance_policies`

`insurance_preauthorizations`  `insurance_settings`  `insurance_settlement_claims`  `insurance_settlements`

`integration_settings`  `internal_conversation_participants`  `internal_conversations`  `internal_messages`

`internal_messaging_settings`  `inventory_lots`  `inventory_movements`  `inventory_reservations`

`item_branches`  `item_claim_codes`  `item_resources`  `item_stock_settings`

`items`  `job_postings`  `journal_entries`  `journal_entry_lines`

`lab_order_items`  `lab_orders`  `lab_reference_ranges`  `lab_result_amendments`

`lab_result_attachments`  `lab_test_categories`  `lab_test_components`  `lab_tests`

`leave_balances`  `leave_requests`  `leave_types`  `lookup_categories`

`lookup_values`  `maintenance_order_parts`  `maintenance_orders`  `maintenance_plans`

`maintenance_requests`  `medical_record_access_log`  `membership_permissions`  `message_log`

`message_templates`  `notification_preferences`  `notification_rules`  `notifications`

`nphies_messages`  `occupational_exam_results`  `offer_items`  `offers`

`organization_discount_settings`  `organization_features`  `organization_holidays`  `organization_locale_settings`

`organization_memberships`  `organization_policies`  `organization_vat_settings`  `organizations`

`package_items`  `packages`  `patient_change_requests`  `patient_consents`

`patient_contacts`  `patient_documents`  `patient_health_conditions`  `patient_insurance_memberships`

`patient_medical_history`  `patient_notes`  `patient_package_usages`  `patient_packages`

`patient_portal_accounts`  `patient_tooth_status`  `patient_visit_diagnoses`  `patient_visit_services`

`patient_visits`  `patient_vital_signs`  `patient_wallet_transactions`  `patient_wallets`

`patients`  `payroll_item_details`  `payroll_run_items`  `payroll_runs`

`performance_review_criteria`  `performance_review_cycles`  `performance_review_scores`  `performance_reviews`

`permission_catalog`  `prescription_items`  `prescriptions`  `price_list_items`

`price_lists`  `print_settings`  `procedure_codes`  `public_booking_rate_limits`

`public_booking_settings`  `purchase_approval_rules`  `purchase_expenses`  `purchase_invoice_items`

`purchase_invoices`  `purchase_order_items`  `purchase_orders`  `purchase_request_items`

`purchase_requests`  `purchase_return_items`  `purchase_returns`  `quality_incidents`

`quality_indicators`  `quality_measurements`  `queue_display_screens`  `quick_invoice_group_items`

`quick_invoice_groups`  `radiology_exam_categories`  `radiology_exams`  `radiology_images`

`radiology_order_items`  `radiology_orders`  `reception_settings`  `resource_bookings`

`resources`  `role_default_permissions`  `salary_components`  `sales_invoice_items`

`sales_invoices`  `shift_swap_requests`  `shift_templates`  `sms_credit_balance`

`sms_credit_transactions`  `staff_requests`  `stock_count_items`  `stock_counts`

`stock_transfer_items`  `stock_transfers`  `tooth_procedures`  `tooth_shade_guides`

`tooth_shades`  `training_enrollments`  `training_programs`  `treatment_agreement_items`

`treatment_agreements`  `treatment_sessions`  `vital_sign_requests`  `voucher_invoice_allocations`

`waiting_room_tickers`  `warehouse_locations`  `warehouses`  `zatca_companies`

### appointment_reminder_jobs

أُنشئ في `0050`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `appointment_id` | `uuid` | ✔ |  | `appointments(id)` |
| `reminder_type` | `text` | ✔ | `'24h'` |  |
| `due_at` | `timestamptz` | ✔ |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `attempts` | `integer` | ✔ | `0` |  |
| `last_error` | `text` |  |  |  |
| `processed_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (appointment_id, reminder_type)` — *(0050)*

**فهارس:**

- `idx_appointment_reminder_jobs_due` على (`status, due_at`) — *(0050)*
- `idx_reminder_jobs_org` على (`organization_id`) — *(0051)*

### appointment_requests

أُنشئ في `0104`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `preferred_date` | `date` |  |  |  |
| `preferred_period` | `text` |  |  |  |
| `reason` | `text` |  |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `decided_by` | `uuid` |  |  | `auth.users(id)` |
| `decided_at` | `timestamptz` |  |  |  |
| `decision_note` | `text` |  |  |  |
| `source` | `text` | ✔ | `'portal'` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_appointment_requests_pending` على (`organization_id, status, preferred_date`) — *(0104)*

### appointment_waitlist

أُنشئ في `0002` · عُدِّل في: `0050`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `registration_note` | `text` |  |  |  |
| `status` | `text` | ✔ | `'waiting'` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `desired_date` | `date` |  |  |  |
| `priority` | `text` | ✔ | `'normal'` |  |
| `contacted_at` | `timestamptz` |  |  |  |
| `booked_at` | `timestamptz` |  |  |  |

**قيود:**

- `constraint appointment_waitlist_priority_check check (priority in ('normal', 'urgent', 'emergency', 'elderly', 'accessibility'))` — *(0050)*
- `constraint waitlist_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id) not valid` — *(0050)*
- `constraint waitlist_doctor_tenant_fk foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid` — *(0050)*

**فهارس:**

- `idx_waitlist_booked_appointment` — فريد على (`appointment_id`) — *(0050)*
- `idx_waitlist_org_doctor` على (`organization_id, doctor_id`) — *(0051)*
- `idx_waitlist_org_patient` على (`organization_id, patient_id`) — *(0051)*

### appointments

أُنشئ في `0002` · عُدِّل في: `0050`، `0062`، `0074`، `0077`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `scheduled_start` | `timestamptz` | ✔ |  |  |
| `scheduled_end` | `timestamptz` | ✔ |  |  |
| `status` | `text` | ✔ | `'scheduled'` |  |
| `checked_in_1_at` | `timestamptz` |  |  |  |
| `checked_in_2_at` | `timestamptz` |  |  |  |
| `called_at` | `timestamptz` |  |  |  |
| `entered_at` | `timestamptz` |  |  |  |
| `left_at` | `timestamptz` |  |  |  |
| `visit_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `source_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `note` | `text` |  |  |  |
| `sms_reminder_sent` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `priority` | `text` | ✔ | `'normal'` |  |
| `queue_number` | `integer` |  |  |  |
| `cancellation_reason` | `text` |  |  |  |
| `no_show_reason` | `text` |  |  |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |

**قيود:**

- `constraint appointments_priority_check check (priority in ('normal', 'urgent', 'emergency', 'elderly', 'accessibility'))` — *(0050)*
- `constraint appointments_status_check check (status in ( 'new','scheduled','confirmed','unconfirmed','arrived','checked_in','called', 'in_progress','completed','no_show','cancelled_by_patient','cancelled_by_staff', 'walk_in','waiting' ))` — *(0050)*
- `constraint appointments_organization_id_id_key unique (organization_id, id)` — *(0050)*
- `constraint appointments_doctor_tenant_fk foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid` — *(0050)*
- `constraint appointments_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id) not valid` — *(0050)*
- `constraint appointments_clinic_tenant_fk foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid` — *(0050)*
- `constraint appointments_item_tenant_fk foreign key (organization_id, item_id) references items (organization_id, id) not valid` — *(0077)*

**فهارس:**

- `idx_appointments_branch` على (`organization_id, branch_id`) — *(0062)*
- `idx_appointments_branch_fk` على (`branch_id`) — *(0124)*
- `idx_appointments_clinic_fk` على (`clinic_id`) — *(0124)*
- `idx_appointments_doctor_time` على (`doctor_id, scheduled_start`) — *(0002)*
- `idx_appointments_item` على (`item_id`) — *(0074)*
- `idx_appointments_org_clinic` على (`organization_id, clinic_id`) — *(0051)*
- `idx_appointments_org_doctor` على (`organization_id, doctor_id`) — *(0051)*
- `idx_appointments_org_item_fk` على (`organization_id, item_id`) — *(0124)*
- `idx_appointments_org_patient` على (`organization_id, patient_id`) — *(0051)*
- `idx_appointments_org_status` على (`organization_id, status`) — *(0002)*
- `idx_appointments_patient` على (`patient_id, scheduled_start desc`) — *(0002)*
- `idx_appointments_queue` على (`organization_id, scheduled_start, priority, queue_number`) — *(0050)*

### asset_calibrations

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `calibration_date` | `date` | ✔ |  |  |
| `next_due_date` | `date` |  |  |  |
| `performed_by_vendor` | `text` |  |  |  |
| `certificate_number` | `text` |  |  |  |
| `result` | `text` | ✔ | `'passed'` |  |
| `measured_deviation` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_asset_calibrations` على (`organization_id, asset_id, calibration_date desc`) — *(0101)*

### asset_depreciation_lines

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `run_id` | `uuid` | ✔ |  | `asset_depreciation_runs(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `amount` | `numeric(14,2)` | ✔ |  |  |
| `accumulated_after` | `numeric(14,2)` | ✔ |  |  |
| `net_book_value` | `numeric(14,2)` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_depreciation_lines_asset` على (`organization_id, asset_id`) — *(0101)*

### asset_depreciation_runs

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `period_month` | `date` | ✔ |  |  |
| `asset_count` | `integer` | ✔ | `0` |  |
| `total_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `journal_entry_id` | `uuid` |  |  | `journal_entries(id)` |
| `posted_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_depreciation_run_month` — فريد على (`organization_id, period_month`) — *(0101)*

### asset_disposals

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `disposal_date` | `date` | ✔ | `current_date` |  |
| `disposal_method` | `text` | ✔ |  |  |
| `sale_amount` | `numeric(14,2)` |  |  |  |
| `book_value` | `numeric(14,2)` |  |  |  |
| `gain_loss` | `numeric(14,2)` |  |  |  |
| `buyer_name` | `text` |  |  |  |
| `reason` | `text` | ✔ |  |  |
| `certificate_path` | `text` |  |  |  |
| `journal_entry_id` | `uuid` |  |  | `journal_entries(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

### asset_transfers

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `from_branch_id` | `uuid` |  |  | `branches(id)` |
| `to_branch_id` | `uuid` |  |  | `branches(id)` |
| `from_clinic_id` | `uuid` |  |  | `clinics(id)` |
| `to_clinic_id` | `uuid` |  |  | `clinics(id)` |
| `from_room` | `text` |  |  |  |
| `to_room` | `text` |  |  |  |
| `transferred_at` | `timestamptz` | ✔ | `now()` |  |
| `reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_asset_transfers` على (`organization_id, asset_id, transferred_at desc`) — *(0101)*

### assets

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `department_id` | `uuid` |  |  |  |
| `room_number` | `text` |  |  |  |
| `asset_number` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `asset_category` | `text` | ✔ | `'medical_device'` |  |
| `is_medical` | `boolean` | ✔ | `true` |  |
| `manufacturer` | `text` |  |  |  |
| `model` | `text` |  |  |  |
| `serial_number` | `text` |  |  |  |
| `barcode` | `text` |  |  |  |
| `resource_id` | `uuid` |  |  | `resources(id)` |
| `distributor_id` | `uuid` |  |  | `distributors(id)` |
| `purchase_invoice_id` | `uuid` |  |  | `purchase_invoices(id)` |
| `purchase_date` | `date` |  |  |  |
| `purchase_cost` | `numeric(14,2)` |  |  |  |
| `warranty_end_date` | `date` |  |  |  |
| `service_contract_end` | `date` |  |  |  |
| `useful_life_years` | `integer` |  |  |  |
| `salvage_value` | `numeric(14,2)` | ✔ | `0` |  |
| `accumulated_depreciation` | `numeric(14,2)` | ✔ | `0` |  |
| `status` | `text` | ✔ | `'in_service'` |  |
| `status_reason` | `text` |  |  |  |
| `requires_calibration` | `boolean` | ✔ | `false` |  |
| `calibration_interval_days` | `integer` |  |  |  |
| `last_calibration_date` | `date` |  |  |  |
| `next_calibration_date` | `date` |  |  |  |
| `note` | `text` |  |  |  |
| `disposed_at` | `timestamptz` |  |  |  |
| `disposed_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_assets_status` على (`organization_id, branch_id, status`) — *(0101)*
- `uq_asset_barcode` — فريد على (`organization_id, barcode`) — *(0101)*
- `uq_asset_number` — فريد على (`organization_id, asset_number`) — *(0101)*
- `uq_asset_resource` — فريد على (`resource_id`) — *(0101)*
- `uq_asset_serial` — فريد على (`organization_id, serial_number`) — *(0101)*

### attendance_records

أُنشئ في `0019` · عُدِّل في: `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `work_date` | `date` | ✔ |  |  |
| `shift_template_id` | `uuid` |  |  | `shift_templates(id)` |
| `check_in_at` | `timestamptz` |  |  |  |
| `check_out_at` | `timestamptz` |  |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `late_minutes` | `integer` | ✔ | `0` |  |
| `early_leave_minutes` | `integer` | ✔ | `0` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `overtime_minutes` | `integer` | ✔ | `0` |  |
| `overtime_approved_by` | `uuid` |  |  | `auth.users(id)` |
| `overtime_approved_at` | `timestamptz` |  |  |  |
| `absence_reason` | `text` |  |  |  |

**قيود:**

- `unique (employee_id, work_date)` — *(0019)*

**فهارس:**

- `idx_attendance_employee` على (`employee_id, work_date desc`) — *(0019)*
- `idx_attendance_org_date` على (`organization_id, work_date desc`) — *(0019)*

### audit_log

أُنشئ في `0001` · عُدِّل في: `0095`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `occurred_at` | `timestamptz` | ✔ | `now()` |  |
| `user_id` | `uuid` |  |  | `auth.users(id)` |
| `device_name` | `text` |  |  |  |
| `action_type` | `text` | ✔ |  |  |
| `module` | `text` | ✔ |  |  |
| `entity_id` | `uuid` |  |  |  |
| `entity_title` | `text` |  |  |  |
| `details` | `text` |  |  |  |
| `reason` | `text` |  |  |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |

**فهارس:**

- `idx_audit_log_branch` على (`organization_id, branch_id, occurred_at desc`) — *(0095)*
- `idx_audit_log_org_date` على (`organization_id, occurred_at desc`) — *(0001)*

### bank_reconciliation_lines

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `bank_reconciliation_id` | `uuid` | ✔ |  | `bank_reconciliations(id)` |
| `journal_entry_line_id` | `uuid` |  |  | `journal_entry_lines(id)` |
| `voucher_id` | `uuid` |  |  | `financial_vouchers(id)` |
| `amount` | `numeric(14,2)` | ✔ |  |  |
| `is_cleared` | `boolean` | ✔ | `false` |  |
| `cleared_date` | `date` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### bank_reconciliations

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `account_id` | `uuid` | ✔ |  | `chart_of_accounts(id)` |
| `statement_date` | `date` | ✔ |  |  |
| `statement_balance` | `numeric(14,2)` | ✔ |  |  |
| `book_balance` | `numeric(14,2)` | ✔ | `0` |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `note` | `text` |  |  |  |
| `completed_at` | `timestamptz` |  |  |  |
| `completed_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

### blocked_external_contacts

أُنشئ في `0002` · عُدِّل في: `0063`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `full_name` | `text` |  |  |  |
| `mobile_number` | `text` |  |  |  |
| `phone_number` | `text` |  |  |  |
| `id_number` | `text` |  |  |  |
| `reason` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `block_type` | `text` | ✔ | `'all'` |  |
| `starts_at` | `timestamptz` | ✔ | `now()` |  |
| `ends_at` | `timestamptz` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `notes` | `text` |  |  |  |
| `lifted_by` | `uuid` |  |  | `auth.users(id)` |
| `lifted_at` | `timestamptz` |  |  |  |
| `lift_reason` | `text` |  |  |  |

**قيود:**

- `constraint blocked_contacts_type_check check (block_type in ('booking', 'messaging', 'all'))` — *(0063)*
- `constraint blocked_contacts_target_check check (patient_id is not null or nullif(btrim(mobile_number), '') is not null)` — *(0063)*
- `constraint blocked_contacts_period_check check (ends_at is null or ends_at > starts_at)` — *(0063)*
- `constraint blocked_contacts_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id)` — *(0063)*

**فهارس:**

- `idx_blocked_contacts_active` على (`organization_id, is_active`) — *(0063)*
- `idx_blocked_contacts_patient` على (`patient_id`) — *(0063)*

### body_diagram_annotations

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `visit_id` | `uuid` | ✔ |  | `patient_visits(id)` |
| `diagram_view` | `text` | ✔ |  |  |
| `annotation_data` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_body_diagram_visit` على (`visit_id`) — *(0006)*
- `uq_body_diagram_visit_view` — فريد على (`visit_id, diagram_view`) — *(0056)*

### branch_working_hours

أُنشئ في `0107`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` | ✔ |  | `branches(id)` |
| `weekday` | `integer` | ✔ |  |  |
| `opens_at` | `time` | ✔ |  |  |
| `closes_at` | `time` | ✔ |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint branch_hours_order check (closes_at > opens_at)` — *(0107)*

**فهارس:**

- `idx_branch_hours` على (`organization_id, branch_id, weekday`) — *(0107)*

### branches

أُنشئ في `0001` · عُدِّل في: `0092`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name` | `text` | ✔ |  |  |
| `code` | `text` |  |  |  |
| `address` | `text` |  |  |  |
| `city` | `text` |  |  |  |
| `is_main` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `building_number` | `text` |  |  |  |
| `street_name` | `text` |  |  |  |
| `district` | `text` |  |  |  |
| `postal_code` | `text` |  |  |  |
| `additional_number` | `text` |  |  |  |
| `cr_number` | `text` |  |  |  |
| `phone` | `text` |  |  |  |

**قيود:**

- `unique (organization_id, code)` — *(0001)*

### business_days

أُنشئ في `0147`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `day_number` | `bigint` | ✔ |  |  |
| `business_date` | `date` | ✔ | `current_date` |  |
| `opened_at` | `timestamptz` | ✔ | `now()` |  |
| `opened_by` | `uuid` |  |  | `auth.users(id)` |
| `closed_at` | `timestamptz` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `business_days_one_open_per_branch` — فريد على (`organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`) — *(0147)*
- `idx_business_days_org_date` على (`organization_id, business_date desc`) — *(0147)*

### candidate_interviews

أُنشئ في `0022`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `candidate_id` | `uuid` | ✔ |  | `candidates(id)` |
| `stage` | `text` | ✔ | `'phone_screen'` |  |
| `scheduled_at` | `timestamptz` |  |  |  |
| `interviewer_name` | `text` |  |  |  |
| `outcome` | `text` | ✔ | `'pending'` |  |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_candidate_interviews_candidate` على (`candidate_id, scheduled_at`) — *(0022)*

### candidates

أُنشئ في `0022`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `job_posting_id` | `uuid` |  |  | `job_postings(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `mobile` | `text` |  |  |  |
| `email` | `text` |  |  |  |
| `cv_storage_path` | `text` |  |  |  |
| `source` | `text` |  |  |  |
| `status` | `text` | ✔ | `'applied'` |  |
| `rejection_reason` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_candidates_job_posting` على (`job_posting_id`) — *(0022)*
- `idx_candidates_org_status` على (`organization_id, status`) — *(0022)*

### canned_texts

أُنشئ في `0009`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `location_key` | `text` | ✔ |  |  |
| `text_ar` | `text` | ✔ |  |  |
| `text_en` | `text` |  |  |  |
| `sort_order` | `int` | ✔ | `0` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_canned_texts_location` على (`organization_id, location_key`) — *(0009)*

### cash_register_shifts

أُنشئ في `0091`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `cash_register_id` | `uuid` | ✔ |  | `cash_registers(id)` |
| `shift_number` | `bigint` |  |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `opened_at` | `timestamptz` | ✔ | `now()` |  |
| `opened_by` | `uuid` | ✔ |  | `auth.users(id)` |
| `opening_balance` | `numeric` | ✔ | `0` |  |
| `closed_at` | `timestamptz` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `counted_balance` | `numeric` |  |  |  |
| `expected_balance` | `numeric` |  |  |  |
| `variance_amount` | `numeric` |  |  |  |
| `variance_reason` | `text` |  |  |  |
| `approved_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint shifts_register_tenant_fk foreign key (organization_id, cash_register_id) references cash_registers(organization_id, id) not valid` — *(0091)*

**فهارس:**

- `idx_shifts_lookup` على (`organization_id, cash_register_id, opened_at desc`) — *(0091)*
- `uq_one_open_shift_per_register` — فريد على (`cash_register_id`) — *(0091)*

### cash_registers

أُنشئ في `0003` · عُدِّل في: `0091`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `name` | `text` | ✔ |  |  |
| `is_doctor_custody` | `boolean` | ✔ | `false` |  |
| `assigned_doctor_id` | `uuid` |  |  | `doctors(id)` |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `code` | `text` |  |  |  |
| `requires_shift` | `boolean` | ✔ | `true` |  |
| `allow_negative` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint cash_registers_org_id_key unique (organization_id, id)` — *(0091)*

### cbahi_forms

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `form_type` | `text` | ✔ |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `form_data` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_cbahi_forms_patient` على (`patient_id`) — *(0006)*

### chart_of_accounts

أُنشئ في `0017`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `parent_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `code` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `account_type` | `text` | ✔ |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, code)` — *(0017)*

**فهارس:**

- `idx_chart_of_accounts_org` على (`organization_id`) — *(0017)*
- `idx_chart_of_accounts_parent` على (`parent_account_id`) — *(0017)*

### clinic_exam_templates

أُنشئ في `0006` · عُدِّل في: `0085`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `specialty_code` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `canvas_type` | `text` | ✔ | `'none'` |  |
| `schema_definition` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `version` | `integer` | ✔ | `1` |  |
| `parent_template_id` | `uuid` |  |  | `clinic_exam_templates(id)` |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `description_ar` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (organization_id, specialty_code)` — *(0006)*
- `constraint exam_templates_version_check check (version >= 1)` — *(0085)*
- `constraint exam_templates_clinic_tenant_fk foreign key (organization_id, clinic_id) references clinics (organization_id, id) not valid` — *(0085)*

**فهارس:**

- `idx_exam_templates_org` على (`organization_id`) — *(0006)*
- `idx_exam_templates_specialty` على (`organization_id, specialty_value_id`) — *(0085)*
- `uq_exam_template_active_specialty` — فريد على (`organization_id, specialty_code`) — *(0085)*

### clinics

أُنشئ في `0001` · عُدِّل في: `0050`، `0080`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `parent_clinic_id` | `uuid` |  |  | `clinics(id)` |
| `name` | `text` | ✔ |  |  |
| `code` | `text` | ✔ |  |  |
| `clinic_type` | `text` |  |  |  |
| `supplier_warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `consumable_warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `zatca_company_id` | `uuid` |  |  | `zatca_companies(id)` |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `department_id` | `uuid` |  |  | `departments(id)` |
| `name_en` | `text` |  |  |  |
| `specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `phone_extension` | `text` |  |  |  |
| `floor` | `text` |  |  |  |
| `room_number` | `text` |  |  |  |
| `default_visit_duration` | `integer` |  |  |  |
| `allows_walk_in` | `boolean` | ✔ | `true` |  |
| `allows_online_booking` | `boolean` | ✔ | `false` |  |
| `capacity` | `integer` |  |  |  |
| `color` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (organization_id, code)` — *(0001)*
- `constraint clinics_organization_id_id_key unique (organization_id, id)` — *(0050)*
- `constraint clinics_duration_check check (default_visit_duration is null or (default_visit_duration between 5 and 480))` — *(0080)*
- `constraint clinics_capacity_check check (capacity is null or capacity > 0)` — *(0080)*
- `constraint clinics_color_check check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')` — *(0080)*
- `constraint clinics_department_tenant_fk foreign key (organization_id, department_id) references departments (organization_id, id) not valid` — *(0080)*
- `constraint clinics_branch_tenant_fk foreign key (organization_id, branch_id) references branches (organization_id, id) not valid` — *(0080)*

**فهارس:**

- `idx_clinics_branch` على (`organization_id, branch_id`) — *(0080)*
- `idx_clinics_department` على (`department_id`) — *(0080)*

### consultation_fee_rules

أُنشئ في `0004`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `is_insurance_specific` | `boolean` | ✔ | `false` |  |
| `insurance_company_name` | `text` |  |  |  |
| `consultation_item_id` | `uuid` |  |  | `items(id)` |
| `follow_up_item_id` | `uuid` |  |  | `items(id)` |
| `renewal_days` | `int` | ✔ | `30` |  |
| `free_reviews_count` | `int` | ✔ | `0` |  |
| `doctor_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_consultation_rules_org` على (`organization_id`) — *(0004)*

### consultation_fee_settings

أُنشئ في `0004`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `renewal_alert_enabled` | `boolean` | ✔ | `true` |  |
| `exempt_specialty_value_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### cost_centers

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `code` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `center_type` | `text` | ✔ | `'department'` |  |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `parent_center_id` | `uuid` |  |  | `cost_centers(id)` |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_cost_center_code` — فريد على (`organization_id, code`) — *(0099)*

### critical_result_notifications

أُنشئ في `0105`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `source_kind` | `text` | ✔ |  |  |
| `source_order_id` | `uuid` | ✔ |  |  |
| `source_item_id` | `uuid` | ✔ |  |  |
| `test_name` | `text` |  |  |  |
| `result_value` | `text` |  |  |  |
| `ordering_doctor_id` | `uuid` |  |  | `doctors(id)` |
| `detected_at` | `timestamptz` | ✔ | `now()` |  |
| `phoned_at` | `timestamptz` |  |  |  |
| `phoned_by` | `uuid` |  |  | `auth.users(id)` |
| `phoned_to` | `text` |  |  |  |
| `acknowledged_at` | `timestamptz` |  |  |  |
| `acknowledged_by` | `uuid` |  |  | `auth.users(id)` |
| `read_back_text` | `text` |  |  |  |
| `action_taken` | `text` |  |  |  |
| `escalation_level` | `integer` | ✔ | `0` |  |
| `escalated_at` | `timestamptz` |  |  |  |
| `closed_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_critical_open` على (`organization_id, acknowledged_at, detected_at`) — *(0105)*
- `uq_critical_source` — فريد على (`source_kind, source_item_id`) — *(0105)*

### custom_reports

أُنشئ في `0149`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  |  |
| `name` | `text` | ✔ |  |  |
| `source_key` | `text` | ✔ |  |  |
| `selected_fields` | `text[]` | ✔ | `'{}'::text[]` |  |
| `filters` | `jsonb` | ✔ | `'[]'::jsonb` |  |
| `group_by_field` | `text` |  |  |  |
| `aggregation` | `text` |  |  |  |
| `aggregation_field` | `text` |  |  |  |
| `created_by` | `uuid` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint custom_reports_pkey primary key (id)` — *(0149)*
- `constraint custom_reports_aggregation_check check (aggregation = any (array['count'::text, 'sum'::text]))` — *(0149)*
- `constraint custom_reports_created_by_fkey foreign key (created_by) references auth.users(id)` — *(0149)*
- `constraint custom_reports_organization_id_fkey foreign key (organization_id) references organizations(id) on delete cascade` — *(0149)*

**فهارس:**

- `idx_custom_reports_org` على (`organization_id`) — *(0149)*

### data_retention_policies

أُنشئ في `0095`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `entity_key` | `text` | ✔ |  |  |
| `retention_months` | `integer` | ✔ |  |  |
| `action_on_expiry` | `text` | ✔ | `'archive'` |  |
| `legal_basis` | `text` | ✔ |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `last_run_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `uq_retention_entity` — فريد على (`organization_id, entity_key`) — *(0095)*

### dental_chart_entries

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `visit_id` | `uuid` | ✔ |  | `patient_visits(id)` |
| `tooth_numbers` | `text[]` | ✔ | `'{}'` |  |
| `tooth_type` | `text` | ✔ | `'permanent'` |  |
| `main_complaint` | `text` |  |  |  |
| `procedure_done` | `text` |  |  |  |
| `diagnosis_icd10_id` | `uuid` |  |  | `icd10_codes(id)` |
| `complications` | `text` |  |  |  |
| `anesthesia` | `text` |  |  |  |
| `prophylactic_antibiotics` | `text` |  |  |  |
| `patient_family_education` | `text` |  |  |  |
| `is_xray` | `boolean` | ✔ | `false` |  |
| `ortho_upper` | `boolean` | ✔ | `false` |  |
| `ortho_lower` | `boolean` | ✔ | `false` |  |
| `full_arch` | `boolean` | ✔ | `false` |  |
| `next_visit_plan` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_dental_chart_teeth` على (`tooth_numbers`) — *(0006)*
- `idx_dental_chart_visit` على (`visit_id`) — *(0006)*
- `uq_dental_chart_entries_visit` — فريد على (`visit_id`) — *(0056)*

### dental_lab_items

أُنشئ في `0007`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `distributor_id` | `uuid` | ✔ |  | `distributors(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `price` | `numeric(12,2)` | ✔ | `0` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_dental_lab_items_distributor` على (`distributor_id`) — *(0007)*

### dental_lab_order_items

أُنشئ في `0007`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `order_id` | `uuid` | ✔ |  | `dental_lab_orders(id)` |
| `dental_lab_item_id` | `uuid` |  |  | `dental_lab_items(id)` |
| `description` | `text` |  |  |  |
| `tooth_numbers` | `text[]` | ✔ | `'{}'` |  |
| `shade_id` | `uuid` |  |  | `tooth_shades(id)` |
| `price` | `numeric(12,2)` | ✔ | `0` |  |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `discount_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `vat_rate` | `numeric(5,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_dental_lab_order_items_order` على (`order_id`) — *(0007)*
- `idx_dental_lab_order_items_teeth` على (`tooth_numbers`) — *(0007)*

### dental_lab_orders

أُنشئ في `0007`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `distributor_id` | `uuid` | ✔ |  | `distributors(id)` |
| `order_number` | `bigserial` |  |  |  |
| `order_date` | `date` | ✔ | `current_date` |  |
| `delivery_date` | `date` |  |  |  |
| `lab_invoice_number` | `text` |  |  |  |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `shade_guide_id` | `uuid` |  |  | `tooth_shade_guides(id)` |
| `shade_id` | `uuid` |  |  | `tooth_shades(id)` |
| `total_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `paid_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `remaining_amount` | `numeric(12,2)` |  |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `received_date` | `date` |  |  |  |
| `received_by` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, order_number)` — *(0007)*

**فهارس:**

- `idx_dental_lab_orders_org` على (`organization_id, order_date desc`) — *(0007)*
- `idx_dental_lab_orders_patient` على (`patient_id`) — *(0007)*

### departments

أُنشئ في `0080`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `description_ar` | `text` |  |  |  |
| `description_en` | `text` |  |  |  |
| `department_type` | `text` | ✔ | `'clinical'` |  |
| `parent_department_id` | `uuid` |  |  | `departments(id)` |
| `manager_user_id` | `uuid` |  |  | `auth.users(id)` |
| `is_clinical` | `boolean` | ✔ | `true` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint departments_type_check check ( department_type in ('clinical','laboratory','radiology','pharmacy','administrative','support') )` — *(0080)*
- `constraint departments_org_id_key unique (organization_id, id)` — *(0080)*
- `constraint departments_parent_tenant_fk foreign key (organization_id, parent_department_id) references departments (organization_id, id) not valid` — *(0080)*

**فهارس:**

- `idx_departments_org` على (`organization_id, is_active`) — *(0080)*
- `idx_departments_parent` على (`parent_department_id`) — *(0080)*
- `uq_departments_org_code` — فريد على (`organization_id, code`) — *(0080)*

### discount_limits

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `applies_to_role` | `text` |  |  |  |
| `applies_to_user_id` | `uuid` |  |  | `auth.users(id)` |
| `min_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `max_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### dispensing_items

أُنشئ في `0015` · عُدِّل في: `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `dispensing_record_id` | `uuid` | ✔ |  | `dispensing_records(id)` |
| `prescription_item_id` | `uuid` |  |  | `prescription_items(id)` |
| `drug_item_id` | `uuid` | ✔ |  | `items(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `quantity_dispensed` | `numeric(12,2)` | ✔ |  |  |
| `unit_price` | `numeric(12,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |

**قيود:**

- `constraint dispensing_items_lot_tenant_fk foreign key (organization_id, lot_id) references inventory_lots(organization_id, id) not valid` — *(0088)*

**فهارس:**

- `idx_dispensing_items_record` على (`dispensing_record_id`) — *(0015)*

### dispensing_records

أُنشئ في `0015`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `prescription_id` | `uuid` |  |  | `prescriptions(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `pharmacist_id` | `uuid` |  |  | `auth.users(id)` |
| `sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `status` | `text` | ✔ | `'completed'` |  |
| `dispensed_at` | `timestamptz` | ✔ | `now()` |  |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_dispensing_records_org` على (`organization_id`) — *(0015)*
- `idx_dispensing_records_prescription` على (`prescription_id`) — *(0015)*

### distributors

أُنشئ في `0003` · عُدِّل في: `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `parent_distributor_id` | `uuid` |  |  | `distributors(id)` |
| `distributor_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `is_dental_lab` | `boolean` | ✔ | `false` |  |
| `file_number` | `bigserial` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `sales_rep_name` | `text` |  |  |  |
| `sales_rep_mobile` | `text` |  |  |  |
| `lab_technician_name` | `text` |  |  |  |
| `lab_technician_mobile` | `text` |  |  |  |
| `nationality_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `profession_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `id_number` | `text` |  |  |  |
| `tax_number` | `text` |  |  |  |
| `gln_number` | `text` |  |  |  |
| `phone_1` | `text` |  |  |  |
| `phone_2` | `text` |  |  |  |
| `mobile_1` | `text` |  |  |  |
| `mobile_2` | `text` |  |  |  |
| `email_1` | `text` |  |  |  |
| `email_2` | `text` |  |  |  |
| `fax` | `text` |  |  |  |
| `city_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `address` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `legal_name` | `text` |  |  |  |
| `commercial_register` | `text` |  |  |  |
| `bank_name` | `text` |  |  |  |
| `bank_iban` | `text` |  |  |  |
| `bank_account_name` | `text` |  |  |  |
| `payment_terms_days` | `integer` | ✔ | `0` |  |
| `credit_limit` | `numeric(14,2)` |  |  |  |
| `allowed_branch_ids` | `uuid[]` |  |  |  |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (organization_id, file_number)` — *(0003)*

**فهارس:**

- `idx_distributors_org` على (`organization_id`) — *(0003)*

### doctor_branches

أُنشئ في `0081`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `branch_id` | `uuid` | ✔ |  | `branches(id)` |
| `is_primary` | `boolean` | ✔ | `false` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_doctor_branches` — فريد على (`doctor_id, branch_id`) — *(0081)*
- `uq_doctor_primary_branch` — فريد على (`doctor_id`) — *(0081)*

### doctor_clinics

أُنشئ في `0081`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `clinic_id` | `uuid` | ✔ |  | `clinics(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `is_primary` | `boolean` | ✔ | `false` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_doctor_clinics_clinic` على (`clinic_id`) — *(0081)*
- `uq_doctor_clinics` — فريد على (`doctor_id, clinic_id`) — *(0081)*
- `uq_doctor_primary_clinic` — فريد على (`doctor_id`) — *(0081)*

### doctor_schedules

أُنشئ في `0081` · عُدِّل في: `0135`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `day_of_week` | `smallint` | ✔ |  |  |
| `start_time` | `time` | ✔ |  |  |
| `end_time` | `time` | ✔ |  |  |
| `slot_duration_minutes` | `integer` | ✔ | `15` |  |
| `capacity` | `integer` | ✔ | `1` |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `recurrence_type` | `text` | ✔ | `'weekly'` |  |
| `pattern_anchor_date` | `date` |  |  |  |

**قيود:**

- `constraint doctor_schedules_dow_check check (day_of_week between 1 and 7)` — *(0081)*
- `constraint doctor_schedules_time_check check (end_time > start_time)` — *(0081)*
- `constraint doctor_schedules_slot_check check (slot_duration_minutes between 5 and 480)` — *(0081)*
- `constraint doctor_schedules_cap_check check (capacity > 0)` — *(0081)*
- `constraint doctor_schedules_range_check check (effective_to is null or effective_to >= effective_from)` — *(0081)*
- `constraint doctor_schedules_recurrence_check check ( recurrence_type in ('weekly', 'alternate_days') and (recurrence_type = 'weekly' or pattern_anchor_date is not null) )` — *(0135)*

**فهارس:**

- `idx_doctor_schedules_doctor` على (`doctor_id, day_of_week`) — *(0081)*

### doctor_services

أُنشئ في `0081`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `duration_minutes` | `integer` |  |  |  |
| `price_override` | `numeric(12,2)` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint doctor_services_duration_check check (duration_minutes is null or duration_minutes between 5 and 1440)` — *(0081)*
- `constraint doctor_services_price_check check (price_override is null or price_override >= 0)` — *(0081)*

**فهارس:**

- `idx_doctor_services_item` على (`item_id`) — *(0081)*
- `uq_doctor_services` — فريد على (`doctor_id, item_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`) — *(0081)*

### doctor_working_hours

أُنشئ في `0002` · عُدِّل في: `0081`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `doctor_id` | `uuid` | ✔ |  | `doctors(id)` |
| `starts_at` | `timestamptz` | ✔ |  |  |
| `ends_at` | `timestamptz` | ✔ |  |  |
| `note` | `text` |  |  |  |
| `is_blocked` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `exception_type` | `text` |  |  |  |
| `reason` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint dwh_exception_type_check check (exception_type is null or exception_type in ('leave','vacation','training','blocked_time','emergency','custom_hours'))` — *(0081)*

**فهارس:**

- `idx_doctor_hours_doctor` على (`doctor_id, starts_at`) — *(0002)*

### doctors

أُنشئ في `0002` · عُدِّل في: `0050`، `0081`، `0140`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `user_id` | `uuid` |  |  | `auth.users(id)` |
| `file_number` | `bigserial` |  |  |  |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `job_title` | `text` |  |  |  |
| `specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `medical_record_sections` | `jsonb` | ✔ | `'[]'::jsonb` |  |
| `address` | `text` |  |  |  |
| `id_number` | `text` |  |  |  |
| `gender` | `text` |  |  |  |
| `nationality_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `mobile_number` | `text` |  |  |  |
| `email` | `text` |  |  |  |
| `birth_date` | `date` |  |  |  |
| `is_enabled` | `boolean` | ✔ | `true` |  |
| `disabled_from_booking` | `boolean` | ✔ | `false` |  |
| `receive_appointment_confirmation_sms` | `boolean` | ✔ | `true` |  |
| `hide_patient_messages` | `boolean` | ✔ | `false` |  |
| `force_session_selection` | `boolean` | ✔ | `false` |  |
| `allowed_booking_user_ids` | `uuid[]` |  |  |  |
| `consultation_fee_renewal_days` | `int` |  |  |  |
| `free_reviews_count` | `int` |  |  |  |
| `consultation_fee_service_codes` | `jsonb` | ✔ | `'[]'::jsonb` |  |
| `default_appointment_duration_minutes` | `int` |  |  |  |
| `patient_waiting_minutes` | `int` |  |  |  |
| `invoice_source_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `insurance_extra_fields` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `specialty_authority` | `text` |  |  |  |
| `specialty_authority_number` | `text` |  |  |  |
| `use_default_signature` | `boolean` | ✔ | `true` |  |
| `signature_url` | `text` |  |  |  |
| `use_default_stamp` | `boolean` | ✔ | `true` |  |
| `stamp_url` | `text` |  |  |  |
| `order_stamp_url` | `text` |  |  |  |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `employee_id` | `uuid` |  |  | `employees(id)` |
| `subspecialty` | `text` |  |  |  |
| `identity_type` | `text` |  |  |  |
| `license_number` | `text` |  |  |  |
| `license_authority` | `text` |  |  |  |
| `license_expiry_date` | `date` |  |  |  |
| `classification_expiry_date` | `date` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `subspecialty_value_id` | `uuid` |  |  | `lookup_values(id)` |

**قيود:**

- `unique (organization_id, file_number)` — *(0002)*
- `constraint doctors_organization_id_id_key unique (organization_id, id)` — *(0050)*
- `constraint doctors_identity_type_check check (identity_type is null or identity_type in ('national_id','iqama','passport','gcc_id','border_number'))` — *(0081)*

**فهارس:**

- `idx_doctors_org` على (`organization_id`) — *(0002)*
- `idx_doctors_subspecialty` على (`organization_id, subspecialty_value_id`) — *(0140)*

### document_number_sequences

أُنشئ في `0092`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `document_kind` | `text` | ✔ |  |  |
| `prefix` | `text` |  |  |  |
| `current_value` | `bigint` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_doc_sequence` — فريد على (`organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind`) — *(0092)*

### document_signatures

أُنشئ في `0102`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `document_kind` | `text` | ✔ |  |  |
| `document_id` | `uuid` | ✔ |  |  |
| `signer_role` | `text` | ✔ |  |  |
| `signer_name` | `text` | ✔ |  |  |
| `signer_id_number` | `text` |  |  |  |
| `relation_to_patient` | `text` |  |  |  |
| `signer_user_id` | `uuid` |  |  | `auth.users(id)` |
| `signature_method` | `text` | ✔ | `'on_screen'` |  |
| `signature_path` | `text` |  |  |  |
| `signed_at` | `timestamptz` | ✔ | `now()` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_signatures_document` على (`organization_id, document_kind, document_id`) — *(0102)*
- `uq_signature_role_once` — فريد على (`document_kind, document_id, signer_role`) — *(0102)*

### document_templates

أُنشئ في `0149`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  |  |
| `category_value_id` | `uuid` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `applies_to` | `text` | ✔ | `'generic'::text` |  |
| `body_html` | `text` | ✔ | `''::text` |  |
| `note` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `system_key` | `text` |  |  |  |

**قيود:**

- `constraint document_templates_pkey primary key (id)` — *(0149)*
- `constraint document_templates_applies_to_check check (applies_to = any (array['patient'::text, 'employee'::text, 'generic'::text]))` — *(0149)*
- `constraint document_templates_category_value_id_fkey foreign key (category_value_id) references lookup_values(id)` — *(0149)*
- `constraint document_templates_created_by_fkey foreign key (created_by) references auth.users(id)` — *(0149)*
- `constraint document_templates_organization_id_fkey foreign key (organization_id) references organizations(id) on delete cascade` — *(0149)*

**فهارس:**

- `idx_document_templates_org` على (`organization_id`) — *(0149)*
- `uq_document_templates_system_key` — فريد على (`system_key`) — *(0149)*

### drug_details

أُنشئ في `0015` · عُدِّل في: `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `item_id` 🔑 | `uuid` | ✔ |  | `items(id)` |
| `generic_name` | `text` |  |  |  |
| `dosage_form` | `text` | ✔ | `'tablet'` |  |
| `strength_text` | `text` |  |  |  |
| `is_controlled_substance` | `boolean` | ✔ | `false` |  |
| `requires_prescription` | `boolean` | ✔ | `true` |  |
| `default_dosage_instructions` | `text` |  |  |  |
| `brand_name` | `text` |  |  |  |
| `manufacturer` | `text` |  |  |  |
| `registration_number` | `text` |  |  |  |
| `atc_code` | `text` |  |  |  |
| `controlled_drug_class` | `text` |  |  |  |
| `default_route` | `text` |  |  |  |
| `pack_size` | `numeric` |  |  |  |
| `storage_conditions` | `text` |  |  |  |
| `notes` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint drug_details_controlled_class_check check ( controlled_drug_class is null or controlled_drug_class in ('narcotic','psychotropic','precursor','controlled_other') )` — *(0088)*
- `constraint drug_details_default_route_check check ( default_route is null or default_route in ('oral','topical','injection','inhalation','rectal','ophthalmic','otic','nasal','other') )` — *(0088)*

### einvoice_documents

أُنشئ في `0092` · عُدِّل في: `0110`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `sales_invoice_id` | `uuid` | ✔ |  | `sales_invoices(id)` |
| `document_type` | `text` | ✔ |  |  |
| `environment` | `text` | ✔ | `'sandbox'` |  |
| `status` | `text` | ✔ | `'not_required'` |  |
| `invoice_hash` | `text` |  |  |  |
| `previous_hash` | `text` |  |  |  |
| `uuid_value` | `uuid` |  | `gen_random_uuid()` |  |
| `qr_code` | `text` |  |  |  |
| `xml_payload` | `text` |  |  |  |
| `request_payload` | `jsonb` |  |  |  |
| `response_payload` | `jsonb` |  |  |  |
| `validation_errors` | `jsonb` |  |  |  |
| `warnings` | `jsonb` |  |  |  |
| `attempt_count` | `integer` | ✔ | `0` |  |
| `last_attempt_at` | `timestamptz` |  |  |  |
| `submitted_at` | `timestamptz` |  |  |  |
| `responded_at` | `timestamptz` |  |  |  |
| `cleared_at` | `timestamptz` |  |  |  |
| `reported_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `next_attempt_at` | `timestamptz` |  |  |  |
| `max_attempts` | `integer` | ✔ | `6` |  |
| `failed_permanently` | `boolean` | ✔ | `false` |  |
| `last_error` | `text` |  |  |  |
| `dead_lettered_at` | `timestamptz` |  |  |  |

**فهارس:**

- `idx_einvoice_due` على (`organization_id, next_attempt_at`) — *(0110)*
- `idx_einvoice_status` على (`organization_id, status, created_at desc`) — *(0092)*
- `uq_einvoice_per_invoice` — فريد على (`sales_invoice_id`) — *(0092)*

### employee_contracts

أُنشئ في `0021` · عُدِّل في: `0144`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `previous_contract_id` | `uuid` |  |  | `employee_contracts(id)` |
| `contract_number` | `text` |  |  |  |
| `contract_type` | `text` | ✔ | `'permanent'` |  |
| `start_date` | `date` | ✔ |  |  |
| `end_date` | `date` |  |  |  |
| `basic_salary` | `numeric(12,2)` | ✔ | `0` |  |
| `status` | `text` | ✔ | `'active'` |  |
| `storage_path` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `termination_reason` | `text` |  |  |  |

**قيود:**

- `check (contract_type = 'permanent' or end_date is not null)` — *(0021)*
- `check (end_date is null or end_date >= start_date)` — *(0021)*

**فهارس:**

- `idx_employee_contracts_employee` على (`employee_id, start_date desc`) — *(0021)*
- `idx_employee_contracts_expiry` على (`organization_id, end_date`) — *(0021)*
- `idx_employee_contracts_org` على (`organization_id`) — *(0021)*
- `uq_employee_contracts_one_active` — فريد على (`employee_id`) — *(0021)*

### employee_documents

أُنشئ في `0008` · عُدِّل في: `0102`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `document_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `document_number` | `text` |  |  |  |
| `issue_date` | `date` |  |  |  |
| `expiry_date` | `date` |  |  |  |
| `storage_path` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `uploaded_by` | `uuid` |  |  | `auth.users(id)` |
| `mime_type` | `text` |  |  |  |
| `file_size_bytes` | `bigint` |  |  |  |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `archive_reason` | `text` |  |  |  |

**فهارس:**

- `idx_employee_documents_employee` على (`employee_id`) — *(0008)*
- `idx_employee_documents_expiry` على (`organization_id, expiry_date`) — *(0008)*

### employee_loans

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `loan_type` | `text` | ✔ | `'advance'` |  |
| `amount` | `numeric(14,2)` | ✔ |  |  |
| `installment_amount` | `numeric(14,2)` | ✔ |  |  |
| `installments_count` | `integer` | ✔ |  |  |
| `paid_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `start_month` | `date` | ✔ |  |  |
| `status` | `text` | ✔ | `'active'` |  |
| `reason` | `text` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_employee_loans` على (`organization_id, employee_id, status`) — *(0100)*

### employee_position_history

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `change_type` | `text` | ✔ |  |  |
| `effective_date` | `date` | ✔ |  |  |
| `from_branch_id` | `uuid` |  |  | `branches(id)` |
| `to_branch_id` | `uuid` |  |  | `branches(id)` |
| `from_job_title` | `text` |  |  |  |
| `to_job_title` | `text` |  |  |  |
| `from_salary` | `numeric(14,2)` |  |  |  |
| `to_salary` | `numeric(14,2)` |  |  |  |
| `reason` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_position_history_emp` على (`organization_id, employee_id, effective_date desc`) — *(0100)*

### employee_salary_components

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `component_id` | `uuid` | ✔ |  | `salary_components(id)` |
| `value` | `numeric(14,4)` | ✔ | `0` |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_emp_components` على (`employee_id, effective_from`) — *(0100)*

### employee_shift_assignments

أُنشئ في `0019`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `shift_template_id` | `uuid` | ✔ |  | `shift_templates(id)` |
| `weekdays` | `smallint[]` | ✔ | `'{0,1,2,3,4,5,6}'` |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `check (effective_to is null or effective_to >= effective_from)` — *(0019)*

**فهارس:**

- `idx_shift_assignments_employee` على (`employee_id, effective_from desc`) — *(0019)*
- `idx_shift_assignments_org` على (`organization_id`) — *(0019)*

### employees

أُنشئ في `0008` · عُدِّل في: `0022`، `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `user_id` | `uuid` |  |  | `auth.users(id)` |
| `file_number` | `bigserial` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `mobile_1` | `text` |  |  |  |
| `phone_1` | `text` |  |  |  |
| `source_country_phone_code` | `text` |  |  |  |
| `profession_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `status` | `text` | ✔ | `'active'` |  |
| `basic_salary` | `numeric(12,2)` | ✔ | `0` |  |
| `housing_allowance` | `numeric(12,2)` | ✔ | `0` |  |
| `transportation_allowance` | `numeric(12,2)` | ✔ | `0` |  |
| `other_allowances` | `numeric(12,2)` | ✔ | `0` |  |
| `total_salary` | `numeric(12,2)` |  |  |  |
| `job_number` | `text` |  |  |  |
| `birth_date` | `date` |  |  |  |
| `hire_date` | `date` |  |  |  |
| `termination_date` | `date` |  |  |  |
| `national_id` | `text` |  |  |  |
| `nationality_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `source_candidate_id` | `uuid` |  |  | `candidates(id)` |
| `bank_name` | `text` |  |  |  |
| `bank_iban` | `text` |  |  |  |
| `bank_account_name` | `text` |  |  |  |
| `department_id` | `uuid` |  |  |  |
| `job_title` | `text` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (organization_id, file_number)` — *(0008)*

**فهارس:**

- `idx_employees_org` على (`organization_id`) — *(0008)*
- `idx_employees_source_candidate` على (`source_candidate_id`) — *(0022)*

### entity_documents

أُنشئ في `0102` · عُدِّل في: `0142`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `entity_type` | `text` | ✔ |  |  |
| `entity_id` | `uuid` | ✔ |  |  |
| `category` | `text` |  |  |  |
| `title` | `text` | ✔ |  |  |
| `storage_path` | `text` | ✔ |  |  |
| `file_name` | `text` |  |  |  |
| `mime_type` | `text` |  |  |  |
| `file_size_bytes` | `bigint` |  |  |  |
| `issue_date` | `date` |  |  |  |
| `expires_at` | `date` |  |  |  |
| `note` | `text` |  |  |  |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `archive_reason` | `text` |  |  |  |
| `uploaded_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint entity_documents_entity_type_check check (entity_type = any(array['asset','asset_calibration','maintenance_order', 'distributor','purchase_invoice','purchase_order', 'insurance_company','organization','branch', 'treatment_session','other']))` — *(0142)*

**فهارس:**

- `idx_entity_documents_entity` على (`organization_id, entity_type, entity_id, is_archived`) — *(0102)*

### exam_field_options

أُنشئ في `0085`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `field_id` | `uuid` | ✔ |  | `exam_template_fields(id)` |
| `value` | `text` | ✔ |  |  |
| `label_ar` | `text` | ✔ |  |  |
| `label_en` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `is_active` | `boolean` | ✔ | `true` |  |

**فهارس:**

- `uq_exam_field_options` — فريد على (`field_id, value`) — *(0085)*

### exam_template_fields

أُنشئ في `0085`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `template_id` | `uuid` | ✔ |  | `clinic_exam_templates(id)` |
| `section_id` | `uuid` | ✔ |  | `exam_template_sections(id)` |
| `key` | `text` | ✔ |  |  |
| `label_ar` | `text` | ✔ |  |  |
| `label_en` | `text` |  |  |  |
| `field_type` | `text` | ✔ |  |  |
| `unit` | `text` |  |  |  |
| `placeholder_ar` | `text` |  |  |  |
| `help_ar` | `text` |  |  |  |
| `is_required` | `boolean` | ✔ | `false` |  |
| `min_value` | `numeric(14,4)` |  |  |  |
| `max_value` | `numeric(14,4)` |  |  |  |
| `decimal_places` | `smallint` |  |  |  |
| `default_value` | `text` |  |  |  |
| `visible_when_field_id` | `uuid` |  |  | `exam_template_fields(id)` |
| `visible_when_value` | `text` |  |  |  |
| `lookup_category_key` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint exam_fields_type_check check (field_type in ( 'text','textarea','number','date','time','select','multi_select', 'checkbox','radio','yes_no','measurement','clinical_code','body_map','file' ))` — *(0085)*
- `constraint exam_fields_range_check check (min_value is null or max_value is null or min_value <= max_value)` — *(0085)*
- `constraint exam_fields_conditional_check check ( (visible_when_field_id is null and visible_when_value is null) or (visible_when_field_id is not null and visible_when_value is not null) )` — *(0085)*

**فهارس:**

- `idx_exam_fields_section` على (`section_id`) — *(0085)*
- `uq_exam_fields` — فريد على (`template_id, key`) — *(0085)*

### exam_template_sections

أُنشئ في `0085` · عُدِّل في: `0145`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `template_id` | `uuid` | ✔ |  | `clinic_exam_templates(id)` |
| `key` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `description_ar` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `is_collapsible` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `section_type` | `text` | ✔ | `'group'` |  |

**قيود:**

- `constraint exam_template_sections_type_check check (section_type in ('group', 'text', 'textarea', 'diagnosis'))` — *(0145)*

**فهارس:**

- `uq_exam_sections` — فريد على (`template_id, key`) — *(0085)*

### external_clients

أُنشئ في `0149`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  |  |
| `name` | `text` | ✔ |  |  |
| `mobile_1` | `text` |  |  |  |
| `mobile_2` | `text` |  |  |  |
| `phone_1` | `text` |  |  |  |
| `phone_2` | `text` |  |  |  |
| `registered_at` | `timestamptz` | ✔ | `now()` |  |
| `note` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint external_clients_pkey primary key (id)` — *(0149)*
- `constraint external_clients_organization_id_id_key unique (organization_id, id)` — *(0149)*
- `constraint external_clients_created_by_fkey foreign key (created_by) references auth.users(id)` — *(0149)*
- `constraint external_clients_organization_id_fkey foreign key (organization_id) references organizations(id) on delete cascade` — *(0149)*

**فهارس:**

- `idx_external_clients_org` على (`organization_id`) — *(0149)*
- `uq_external_clients_org_id` — فريد على (`organization_id, id`) — *(0149)*

### facility_licenses

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `authority_name` | `text` | ✔ |  |  |
| `license_number` | `text` | ✔ |  |  |
| `start_date` | `date` |  |  |  |
| `end_date` | `date` | ✔ |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### feature_catalog

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `feature_key` 🔑 | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` | ✔ |  |  |
| `category_key` | `text` | ✔ |  |  |
| `description_ar` | `text` |  |  |  |
| `is_core` | `boolean` | ✔ | `false` |  |
| `display_order` | `int` | ✔ | `0` |  |

### financial_vouchers

أُنشئ في `0003` · عُدِّل في: `0007`، `0008`، `0091`، `0147`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `voucher_number` | `bigserial` |  |  |  |
| `voucher_type` | `text` | ✔ |  |  |
| `voucher_date` | `date` | ✔ | `current_date` |  |
| `amount` | `numeric(12,2)` | ✔ | `0` |  |
| `payment_method_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `cash_register_id` | `uuid` |  |  | `cash_registers(id)` |
| `bank_transfer_ref` | `text` |  |  |  |
| `transfer_to_account_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `related_sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `distributor_id` | `uuid` |  |  | `distributors(id)` |
| `employee_name` | `text` |  |  |  |
| `employee_ref_id` | `uuid` |  |  |  |
| `expense_category_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `expense_source_document` | `text` |  |  |  |
| `expense_source_number` | `text` |  |  |  |
| `payee_name` | `text` |  |  |  |
| `description` | `text` |  |  |  |
| `vat_rate` | `numeric(5,2)` |  |  |  |
| `vat_amount` | `numeric(12,2)` |  |  |  |
| `requires_vat` | `boolean` | ✔ | `false` |  |
| `supplier_tax_number` | `text` |  |  |  |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `dental_lab_order_id` | `uuid` |  |  | `dental_lab_orders(id)` |
| `cash_shift_id` | `uuid` |  |  | `cash_register_shifts(id)` |
| `is_void` | `boolean` | ✔ | `false` |  |
| `voided_at` | `timestamptz` |  |  |  |
| `voided_by` | `uuid` |  |  | `auth.users(id)` |
| `void_reason` | `text` |  |  |  |
| `refund_of_voucher_id` | `uuid` |  |  | `financial_vouchers(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `business_day_id` | `uuid` |  |  | `business_days(id)` |

**قيود:**

- `unique (organization_id, voucher_number)` — *(0003)*
- `constraint financial_vouchers_employee_fk foreign key (employee_ref_id) references employees(id) on delete set null` — *(0008)*
- `constraint chk_salary_requires_employee check (voucher_type <> 'salary' or employee_ref_id is not null)` — *(0008)*

**فهارس:**

- `idx_financial_vouchers_business_day` على (`business_day_id`) — *(0147)*
- `idx_vouchers_dental_lab_order` على (`dental_lab_order_id`) — *(0007)*
- `idx_vouchers_org_date` على (`organization_id, voucher_date desc`) — *(0003)*
- `idx_vouchers_shift` على (`cash_shift_id`) — *(0091)*
- `idx_vouchers_type` على (`organization_id, voucher_type`) — *(0003)*

### fiscal_periods

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `fiscal_year_id` | `uuid` | ✔ |  | `fiscal_years(id)` |
| `period_number` | `integer` | ✔ |  |  |
| `name` | `text` |  |  |  |
| `start_date` | `date` | ✔ |  |  |
| `end_date` | `date` | ✔ |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `closed_at` | `timestamptz` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `reopened_at` | `timestamptz` |  |  |  |
| `reopened_by` | `uuid` |  |  | `auth.users(id)` |
| `reopen_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint fiscal_periods_range_check check (end_date >= start_date)` — *(0099)*

**فهارس:**

- `idx_fiscal_periods_dates` على (`organization_id, start_date, end_date`) — *(0099)*
- `uq_fiscal_period` — فريد على (`fiscal_year_id, period_number`) — *(0099)*

### fiscal_years

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name` | `text` | ✔ |  |  |
| `start_date` | `date` | ✔ |  |  |
| `end_date` | `date` | ✔ |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `closed_at` | `timestamptz` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint fiscal_years_range_check check (end_date > start_date)` — *(0099)*
- `constraint fiscal_years_no_overlap exclude using gist ( organization_id with =, daterange(start_date, end_date, '[]') with && )` — *(0099)*

**فهارس:**

- `idx_fiscal_years_org` على (`organization_id, start_date`) — *(0099)*

### generated_documents

أُنشئ في `0149`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  |  |
| `template_id` | `uuid` |  |  |  |
| `template_name_snapshot` | `text` | ✔ |  |  |
| `patient_id` | `uuid` |  |  |  |
| `employee_id` | `uuid` |  |  |  |
| `title` | `text` | ✔ |  |  |
| `body_html` | `text` | ✔ |  |  |
| `extra_fields` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `created_by` | `uuid` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint generated_documents_pkey primary key (id)` — *(0149)*
- `constraint generated_documents_created_by_fkey foreign key (created_by) references auth.users(id)` — *(0149)*
- `constraint generated_documents_employee_id_fkey foreign key (employee_id) references employees(id) on delete set null` — *(0149)*
- `constraint generated_documents_organization_id_fkey foreign key (organization_id) references organizations(id) on delete cascade` — *(0149)*
- `constraint generated_documents_patient_id_fkey foreign key (patient_id) references patients(id) on delete set null` — *(0149)*
- `constraint generated_documents_template_id_fkey foreign key (template_id) references document_templates(id) on delete set null` — *(0149)*

**فهارس:**

- `idx_generated_documents_employee` على (`employee_id`) — *(0149)*
- `idx_generated_documents_org` على (`organization_id`) — *(0149)*
- `idx_generated_documents_patient` على (`patient_id`) — *(0149)*

### gl_posting_rules

أُنشئ في `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `rule_key` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `source_event` | `text` | ✔ |  |  |
| `debit_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `credit_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `amount_expression` | `text` | ✔ | `'net_amount'` |  |
| `condition_note` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `uq_gl_rule_key` — فريد على (`organization_id, rule_key`) — *(0099)*

### goods_receipt_items

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `goods_receipt_id` | `uuid` | ✔ |  | `goods_receipts(id)` |
| `purchase_order_item_id` | `uuid` |  |  | `purchase_order_items(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty_received` | `numeric(14,3)` | ✔ |  |  |
| `free_qty` | `numeric(14,3)` | ✔ | `0` |  |
| `unit_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `lot_number` | `text` |  |  |  |
| `expiry_date` | `date` |  |  |  |
| `source_barcode` | `text` |  |  |  |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `over_receipt_approved_by` | `uuid` |  |  | `auth.users(id)` |
| `over_receipt_reason` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_gri_receipt` على (`goods_receipt_id`) — *(0097)*

### goods_receipts

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `purchase_order_id` | `uuid` |  |  | `purchase_orders(id)` |
| `distributor_id` | `uuid` | ✔ |  | `distributors(id)` |
| `receipt_number` | `text` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `received_at` | `timestamptz` | ✔ | `now()` |  |
| `received_by` | `uuid` |  |  | `auth.users(id)` |
| `delivery_note_ref` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `posted_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_gr_org` على (`organization_id, status, received_at desc`) — *(0097)*

### health_conditions

أُنشئ في `0002`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` | ✔ |  |  |
| `sort_order` | `int` | ✔ | `0` |  |

### icd10_codes

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `code` | `text` | ✔ |  |  |
| `diagnosis_group` | `text` |  |  |  |
| `name_en` | `text` | ✔ |  |  |
| `name_ar` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |

**فهارس:**

- `idx_icd10_code` على (`code`) — *(0086)*
- `idx_icd10_group` على (`diagnosis_group`) — *(0006)*
- `idx_icd10_name_ar` على (`name_ar`) — *(0086)*

### insurance_claim_batch_items

أُنشئ في `0005`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `batch_id` | `uuid` | ✔ |  | `insurance_claim_batches(id)` |
| `sales_invoice_id` | `uuid` | ✔ |  | `sales_invoices(id)` |
| `amount` | `numeric(12,2)` | ✔ | `0` |  |
| `status` | `text` | ✔ | `'pending'` |  |

**قيود:**

- `unique (batch_id, sales_invoice_id)` — *(0005)*

**فهارس:**

- `idx_claim_batch_items_batch` على (`batch_id`) — *(0005)*

### insurance_claim_batches

أُنشئ في `0005` · عُدِّل في: `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `company_id` | `uuid` | ✔ |  | `insurance_companies(id)` |
| `batch_number` | `bigserial` |  |  |  |
| `period_start` | `date` |  |  |  |
| `period_end` | `date` |  |  |  |
| `total_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `submitted_at` | `timestamptz` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `approved_amount` | `numeric` |  |  |  |
| `rejected_amount` | `numeric` |  |  |  |
| `paid_amount` | `numeric` |  |  |  |
| `paid_at` | `timestamptz` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `responded_at` | `timestamptz` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (organization_id, batch_number)` — *(0005)*

### insurance_claim_form_items

أُنشئ في `0005` · عُدِّل في: `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `form_id` | `uuid` | ✔ |  | `insurance_claim_forms(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `service_code` | `text` |  |  |  |
| `description` | `text` |  |  |  |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `amount` | `numeric(12,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `visit_service_id` | `uuid` |  |  | `patient_visit_services(id)` |
| `invoice_item_id` | `uuid` |  |  | `sales_invoice_items(id)` |
| `icd10_code_id` | `uuid` |  |  |  |
| `claimed_amount` | `numeric` |  |  |  |
| `approved_amount` | `numeric` |  |  |  |
| `rejected_amount` | `numeric` |  |  |  |
| `rejection_code` | `text` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `preauthorization_id` | `uuid` |  |  | `insurance_preauthorizations(id)` |
| `status` | `text` | ✔ | `'claimed'` |  |

**قيود:**

- `unique (form_id, item_id)` — *(0005)*
- `constraint claim_item_status_check check ( status in ('claimed','approved','partially_approved','rejected','resubmitted') )` — *(0093)*

**فهارس:**

- `idx_claim_items_form` على (`form_id`) — *(0093)*

### insurance_claim_forms

أُنشئ في `0005` · عُدِّل في: `0089`، `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `form_type` | `text` | ✔ |  |  |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `membership_id` | `uuid` |  |  | `patient_insurance_memberships(id)` |
| `sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `status` | `text` | ✔ | `'draft'` |  |
| `form_data` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `auto_created` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `batch_id` | `uuid` |  |  | `insurance_claim_batches(id)` |
| `membership_snapshot` | `jsonb` |  |  |  |
| `claimed_amount` | `numeric` |  |  |  |
| `approved_amount` | `numeric` |  |  |  |
| `rejected_amount` | `numeric` |  |  |  |
| `rejection_code` | `text` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `resubmission_of_id` | `uuid` |  |  | `insurance_claim_forms(id)` |
| `resubmission_count` | `integer` | ✔ | `0` |  |
| `submitted_at` | `timestamptz` |  |  |  |
| `responded_at` | `timestamptz` |  |  |  |
| `paid_at` | `timestamptz` |  |  |  |
| `nphies_request_id` | `text` |  |  |  |
| `nphies_status` | `text` |  |  |  |
| `nphies_last_sync_at` | `timestamptz` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `eligibility_check_id` | `uuid` |  |  | `insurance_eligibility_checks(id)` |
| `diagnoses` | `jsonb` |  |  |  |
| `validation_errors` | `jsonb` |  |  |  |
| `settled_amount` | `numeric` | ✔ | `0` |  |
| `version_number` | `integer` | ✔ | `1` |  |

**قيود:**

- `constraint insurance_claim_forms_org_id_key unique (organization_id, id)` — *(0089)*
- `constraint insurance_claim_forms_status_check check ( status in ('draft','validation_failed','ready','submitted','acknowledged','in_review', 'approved','partially_approved','rejected','resubmitted','settled','paid','cancelled') )` — *(0093)*

**فهارس:**

- `idx_claim_forms_org_type` على (`organization_id, form_type, status`) — *(0005)*
- `idx_claim_forms_patient` على (`patient_id, created_at desc`) — *(0005)*
- `idx_insurance_claim_forms_patient_created` على (`patient_id, created_at desc`) — *(0018)*

### insurance_companies

أُنشئ في `0005` · عُدِّل في: `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `parent_company_id` | `uuid` |  |  | `insurance_companies(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `tax_number` | `text` |  |  |  |
| `phone` | `text` |  |  |  |
| `email` | `text` |  |  |  |
| `address` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `code` | `text` |  |  |  |
| `nphies_payer_id` | `text` |  |  |  |
| `nphies_enabled` | `boolean` | ✔ | `false` |  |
| `claim_email` | `text` |  |  |  |
| `payment_terms_days` | `integer` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint insurance_companies_org_id_key unique (organization_id, id)` — *(0089)*

**فهارس:**

- `idx_insurance_companies_org` على (`organization_id`) — *(0005)*

### insurance_contracts

أُنشئ في `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `company_id` | `uuid` | ✔ |  | `insurance_companies(id)` |
| `network_id` | `uuid` |  |  | `insurance_networks(id)` |
| `contract_number` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `price_list_id` | `uuid` |  |  | `price_lists(id)` |
| `discount_percent` | `numeric` | ✔ | `0` |  |
| `default_copay_percent` | `numeric` |  |  |  |
| `payment_terms_days` | `integer` |  |  |  |
| `claim_submission_days` | `integer` |  |  |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `status` | `text` | ✔ | `'active'` |  |
| `termination_reason` | `text` |  |  |  |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint insurance_contracts_dates_check check (effective_to is null or effective_to >= effective_from)` — *(0089)*
- `constraint insurance_contracts_org_id_key unique (organization_id, id)` — *(0089)*
- `constraint insurance_contracts_company_tenant_fk foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid` — *(0089)*
- `constraint insurance_contracts_price_list_tenant_fk foreign key (organization_id, price_list_id) references price_lists(organization_id, id) not valid` — *(0089)*
- `constraint insurance_contracts_no_overlap exclude using gist ( organization_id with =, company_id with =, daterange(effective_from, effective_to, '[]') with && ) where (status = 'active')` — *(0089)*

**فهارس:**

- `idx_contracts_active` على (`organization_id, company_id, effective_from desc`) — *(0089)*

### insurance_coverage_rules

أُنشئ في `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `policy_id` | `uuid` |  |  | `insurance_policies(id)` |
| `scope` | `text` | ✔ |  |  |
| `item_id` | `uuid` |  |  | `items(id)` |
| `category_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `medical_service_type` | `text` |  |  |  |
| `coverage` | `text` | ✔ | `'covered'` |  |
| `copay_percent` | `numeric` |  |  |  |
| `max_amount_per_service` | `numeric` |  |  |  |
| `max_count_per_year` | `integer` |  |  |  |
| `waiting_period_days` | `integer` |  |  |  |
| `note_ar` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint coverage_scope_key_check check ( (scope = 'item' and item_id is not null) or (scope = 'category' and category_value_id is not null) or (scope = 'service_type' and medical_service_type is not null) or (scope = 'all') )` — *(0089)*
- `constraint coverage_owner_check check (contract_id is not null or policy_id is not null)` — *(0089)*

**فهارس:**

- `idx_coverage_contract` على (`organization_id, contract_id`) — *(0089)*
- `idx_coverage_policy` على (`organization_id, policy_id`) — *(0089)*

### insurance_eligibility_checks

أُنشئ في `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `membership_id` | `uuid` |  |  | `patient_insurance_memberships(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `checked_at` | `timestamptz` | ✔ | `now()` |  |
| `checked_by` | `uuid` |  |  | `auth.users(id)` |
| `source` | `text` | ✔ | `'internal'` |  |
| `is_eligible` | `boolean` | ✔ |  |  |
| `coverage_result` | `jsonb` | ✔ |  |  |
| `copay_percent` | `numeric` |  |  |  |
| `patient_share` | `numeric` |  |  |  |
| `insurer_share` | `numeric` |  |  |  |
| `annual_remaining` | `numeric` |  |  |  |
| `requires_preauth` | `boolean` | ✔ | `false` |  |
| `blocks` | `jsonb` |  |  |  |
| `warnings` | `jsonb` |  |  |  |
| `reference_number` | `text` |  |  |  |
| `valid_until` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_eligibility_lookup` على (`organization_id, patient_id, checked_at desc`) — *(0093)*
- `idx_eligibility_visit` على (`visit_id`) — *(0093)*

### insurance_form_field_requirements

أُنشئ في `0005`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `form_type` | `text` | ✔ |  |  |
| `field_key` | `text` | ✔ |  |  |
| `field_type` | `text` | ✔ | `'text'` |  |
| `is_required` | `boolean` | ✔ | `false` |  |

**قيود:**

- `unique (organization_id, form_type, field_key)` — *(0005)*

### insurance_networks

أُنشئ في `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `company_id` | `uuid` | ✔ |  | `insurance_companies(id)` |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `description_ar` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint insurance_networks_org_id_key unique (organization_id, id)` — *(0089)*
- `constraint insurance_networks_company_tenant_fk foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid` — *(0089)*

### insurance_policies

أُنشئ في `0005` · عُدِّل في: `0089`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `company_id` | `uuid` | ✔ |  | `insurance_companies(id)` |
| `policy_name` | `text` | ✔ |  |  |
| `policy_number` | `text` |  |  |  |
| `policy_class` | `text` |  |  |  |
| `default_copay_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `default_max_amount` | `numeric(12,2)` |  |  |  |
| `default_consultation_limit` | `numeric(12,2)` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `network_id` | `uuid` |  |  | `insurance_networks(id)` |
| `class_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `effective_from` | `date` |  |  |  |
| `effective_to` | `date` |  |  |  |
| `annual_limit` | `numeric` |  |  |  |
| `deductible_amount` | `numeric` |  |  |  |
| `notes` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `unique (company_id, policy_name, policy_class)` — *(0005)*
- `constraint insurance_policies_org_id_key unique (organization_id, id)` — *(0089)*

**فهارس:**

- `idx_insurance_policies_company` على (`company_id`) — *(0005)*

### insurance_preauthorizations

أُنشئ في `0005` · عُدِّل في: `0089`، `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `membership_id` | `uuid` |  |  | `patient_insurance_memberships(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `service_description` | `text` |  |  |  |
| `requested_amount` | `numeric(12,2)` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `approval_number` | `text` |  |  |  |
| `requested_at` | `timestamptz` | ✔ | `now()` |  |
| `responded_at` | `timestamptz` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `qty` | `numeric` | ✔ | `1` |  |
| `approved_amount` | `numeric` |  |  |  |
| `valid_from` | `date` |  |  |  |
| `valid_to` | `date` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `consumed_at` | `timestamptz` |  |  |  |
| `consumed_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `reference_number` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `diagnoses` | `jsonb` |  |  |  |
| `justification` | `text` |  |  |  |
| `attachments` | `jsonb` |  |  |  |
| `approved_qty` | `numeric` |  |  |  |
| `submitted_at` | `timestamptz` |  |  |  |
| `submitted_by` | `uuid` |  |  | `auth.users(id)` |
| `payer_reference` | `text` |  |  |  |
| `eligibility_check_id` | `uuid` |  |  | `insurance_eligibility_checks(id)` |

**قيود:**

- `constraint insurance_preauthorizations_org_id_key unique (organization_id, id)` — *(0089)*
- `constraint preauth_item_tenant_fk foreign key (organization_id, item_id) references items(organization_id, id) not valid` — *(0089)*
- `constraint preauth_dates_check check (valid_to is null or valid_from is null or valid_to >= valid_from) not valid` — *(0089)*
- `constraint insurance_preauthorizations_status_check check ( status in ('draft','ready','pending','submitted','in_review','approved', 'partially_approved','rejected','expired','cancelled') )` — *(0093)*

**فهارس:**

- `idx_preauth_lookup` على (`organization_id, patient_id, item_id, status`) — *(0089)*
- `idx_preauth_org_status` على (`organization_id, status`) — *(0005)*

### insurance_settings

أُنشئ في `0005`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `vat_responsibility` | `text` | ✔ | `'patient'` |  |
| `default_ucaf_template` | `text` | ✔ | `'UCAF-2'` |  |
| `default_dcaf_template` | `text` | ✔ | `'DCAF-2'` |  |
| `prevent_duplicate_policy_name` | `boolean` | ✔ | `true` |  |
| `prevent_duplicate_services_in_claim_line` | `boolean` | ✔ | `true` |  |
| `notify_treating_doctor_on_changes` | `boolean` | ✔ | `true` |  |
| `notify_form_owner_on_changes` | `boolean` | ✔ | `true` |  |
| `notify_specific_user_ids_on_doctor_edits` | `uuid[]` | ✔ | `'{}'` |  |
| `notify_roles_on_doctor_edits` | `text[]` | ✔ | `'{}'` |  |
| `disable_patient_max_copay_field` | `boolean` | ✔ | `false` |  |
| `auto_create_forms_on_consultation_invoice` | `boolean` | ✔ | `true` |  |
| `exclude_offer_discount_invoices_from_auto_create` | `boolean` | ✔ | `true` |  |
| `allow_doctor_edit_radiology_data` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### insurance_settlement_claims

أُنشئ في `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `settlement_id` | `uuid` | ✔ |  | `insurance_settlements(id)` |
| `claim_form_id` | `uuid` | ✔ |  | `insurance_claim_forms(id)` |
| `claimed_amount` | `numeric` | ✔ | `0` |  |
| `approved_amount` | `numeric` | ✔ | `0` |  |
| `paid_amount` | `numeric` | ✔ | `0` |  |
| `variance_amount` | `numeric` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_settlement_claim` — فريد على (`settlement_id, claim_form_id`) — *(0093)*

### insurance_settlements

أُنشئ في `0093`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `company_id` | `uuid` | ✔ |  | `insurance_companies(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `settlement_number` | `bigint` |  |  |  |
| `settlement_date` | `date` | ✔ | `current_date` |  |
| `reference_number` | `text` |  |  |  |
| `total_claimed` | `numeric` | ✔ | `0` |  |
| `total_approved` | `numeric` | ✔ | `0` |  |
| `total_rejected` | `numeric` | ✔ | `0` |  |
| `total_paid` | `numeric` | ✔ | `0` |  |
| `payment_voucher_id` | `uuid` |  |  | `financial_vouchers(id)` |
| `status` | `text` | ✔ | `'draft'` |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### integration_settings

أُنشئ في `0110`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `integration_key` | `text` | ✔ |  |  |
| `environment` | `text` | ✔ | `'sandbox'` |  |
| `base_url` | `text` | ✔ |  |  |
| `secret_ref` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `false` |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint integration_url_https check (base_url ~* '^https://')` — *(0110)*

**فهارس:**

- `uq_integration_key_env` — فريد على (`organization_id, integration_key, environment`) — *(0110)*

### internal_conversation_participants

أُنشئ في `0026`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `conversation_id` | `uuid` | ✔ |  | `internal_conversations(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `joined_at` | `timestamptz` | ✔ | `now()` |  |
| `last_read_at` | `timestamptz` |  |  |  |

**قيود:**

- `primary key (conversation_id, user_id)` — *(0026)*

**فهارس:**

- `idx_internal_participants_user` على (`user_id`) — *(0026)*

### internal_conversations

أُنشئ في `0026`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `is_group` | `boolean` | ✔ | `false` |  |
| `name_ar` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `last_message_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_internal_conversations_org` على (`organization_id, last_message_at desc`) — *(0026)*

### internal_messages

أُنشئ في `0026`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `conversation_id` | `uuid` | ✔ |  | `internal_conversations(id)` |
| `sender_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `body` | `text` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `deleted_at` | `timestamptz` |  |  |  |

**فهارس:**

- `idx_internal_messages_conversation` على (`conversation_id, created_at desc`) — *(0026)*

### internal_messaging_settings

أُنشئ في `0009`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `internal_chat_enabled` | `boolean` | ✔ | `true` |  |
| `poll_interval_seconds` | `int` | ✔ | `15` |  |
| `online_timeout_seconds` | `int` | ✔ | `60` |  |
| `view_permission_scope` | `text` | ✔ | `'own'` |  |
| `delete_permission_scope` | `text` | ✔ | `'own'` |  |
| `notifications_enabled` | `boolean` | ✔ | `true` |  |
| `notify_by_role` | `boolean` | ✔ | `true` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### inventory_lots

أُنشئ في `0003` · عُدِّل في: `0088`، `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `purchase_invoice_item_id` | `uuid` |  |  | `purchase_invoice_items(id)` |
| `lot_number` | `text` |  |  |  |
| `unit_cost` | `numeric(12,2)` | ✔ | `0` |  |
| `qty_received` | `numeric(12,2)` | ✔ | `0` |  |
| `qty_remaining` | `numeric(12,2)` | ✔ | `0` |  |
| `expiry_date` | `date` |  |  |  |
| `received_at` | `timestamptz` | ✔ | `now()` |  |
| `reserved_quantity` | `numeric` | ✔ | `0` |  |
| `selling_price` | `numeric` |  |  |  |
| `distributor_id` | `uuid` |  |  | `distributors(id)` |
| `status` | `text` | ✔ | `'available'` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `location_id` | `uuid` |  |  | `warehouse_locations(id)` |

**قيود:**

- `constraint inventory_lots_status_check check (status in ('available','quarantined','recalled','expired'))` — *(0088)*
- `constraint inventory_lots_qty_nonneg check (qty_remaining >= 0) not valid` — *(0088)*
- `constraint inventory_lots_reserved_check check (reserved_quantity >= 0 and reserved_quantity <= qty_remaining) not valid` — *(0088)*
- `constraint inventory_lots_org_id_key unique (organization_id, id)` — *(0088)*
- `constraint inventory_lots_warehouse_tenant_fk foreign key (organization_id, warehouse_id) references warehouses(organization_id, id) not valid` — *(0088)*
- `constraint inventory_lots_item_tenant_fk foreign key (organization_id, item_id) references items(organization_id, id) not valid` — *(0088)*

**فهارس:**

- `idx_inventory_lots_expiry` على (`organization_id, expiry_date`) — *(0003)*
- `idx_inventory_lots_item_wh` على (`item_id, warehouse_id`) — *(0003)*
- `idx_lots_fefo` على (`organization_id, warehouse_id, item_id, expiry_date nulls last`) — *(0088)*

### inventory_movements

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `movement_type` | `text` | ✔ |  |  |
| `qty` | `numeric(12,2)` | ✔ |  |  |
| `unit_price` | `numeric(12,2)` | ✔ | `0` |  |
| `total_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `related_purchase_invoice_id` | `uuid` |  |  | `purchase_invoices(id)` |
| `related_sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `related_stock_transfer_id` | `uuid` |  |  | `stock_transfers(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_inventory_movements_doctor` على (`doctor_id`) — *(0003)*
- `idx_inventory_movements_item` على (`item_id, warehouse_id, created_at desc`) — *(0003)*
- `idx_inventory_movements_org` على (`organization_id, created_at desc`) — *(0003)*

### inventory_reservations

أُنشئ في `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `lot_id` | `uuid` | ✔ |  | `inventory_lots(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `prescription_id` | `uuid` |  |  | `prescriptions(id)` |
| `prescription_item_id` | `uuid` |  |  | `prescription_items(id)` |
| `qty` | `numeric` | ✔ |  |  |
| `status` | `text` | ✔ | `'active'` |  |
| `released_reason` | `text` |  |  |  |
| `released_at` | `timestamptz` |  |  |  |
| `released_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_reservations_active` على (`organization_id, lot_id`) — *(0088)*
- `idx_reservations_prescription` على (`prescription_id`) — *(0088)*

### item_branches

أُنشئ في `0071`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `branch_id` | `uuid` | ✔ |  | `branches(id)` |

**قيود:**

- `primary key (item_id, branch_id)` — *(0071)*

**فهارس:**

- `idx_item_branches_branch` على (`branch_id`) — *(0071)*
- `idx_item_branches_org_branch` على (`organization_id, branch_id`) — *(0078)*
- `idx_item_branches_org_item` على (`organization_id, item_id`) — *(0078)*

### item_claim_codes

أُنشئ في `0073`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `insurance_company_id` | `uuid` |  |  | `insurance_companies(id)` |
| `code_system` | `text` | ✔ | `'local'` |  |
| `code` | `text` | ✔ |  |  |
| `description` | `text` |  |  |  |
| `is_primary` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint item_claim_codes_system_check check ( code_system in ('cpt','hcpcs','icd10','icd10am','snomed','loinc','local','other') )` — *(0073)*

**فهارس:**

- `idx_item_claim_codes_item` على (`item_id`) — *(0073)*
- `idx_item_claim_codes_org_company` على (`organization_id, insurance_company_id`) — *(0078)*
- `idx_item_claim_codes_org_item` على (`organization_id, item_id`) — *(0078)*
- `uq_item_claim_codes_primary_company` — فريد على (`item_id, insurance_company_id`) — *(0073)*
- `uq_item_claim_codes_primary_generic` — فريد على (`item_id`) — *(0073)*

### item_resources

أُنشئ في `0073`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `resource_id` | `uuid` | ✔ |  | `resources(id)` |
| `is_required` | `boolean` | ✔ | `true` |  |
| `quantity` | `numeric` | ✔ | `1` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint item_resources_quantity_check check (quantity > 0)` — *(0073)*

**فهارس:**

- `idx_item_resources_org_item` على (`organization_id, item_id`) — *(0078)*
- `idx_item_resources_org_resource` على (`organization_id, resource_id`) — *(0078)*
- `idx_item_resources_resource` على (`resource_id`) — *(0073)*
- `uq_item_resources` — فريد على (`item_id, resource_id`) — *(0073)*

### item_stock_settings

أُنشئ في `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `min_qty` | `numeric(14,3)` | ✔ | `0` |  |
| `max_qty` | `numeric(14,3)` |  |  |  |
| `reorder_level` | `numeric(14,3)` | ✔ | `0` |  |
| `reorder_qty` | `numeric(14,3)` |  |  |  |
| `lead_time_days` | `integer` |  |  |  |
| `preferred_distributor_id` | `uuid` |  |  | `distributors(id)` |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint item_stock_settings_range_check check (max_qty is null or max_qty >= min_qty)` — *(0098)*

**فهارس:**

- `uq_item_stock_settings` — فريد على (`warehouse_id, item_id`) — *(0098)*

### items

أُنشئ في `0003` · عُدِّل في: `0053`، `0071`، `0073`، `0077`، `0083`، `0088`، `0092`، `0141`، `0142`، `0146`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `category_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `item_type` | `text` | ✔ | `'service'` |  |
| `code` | `text` | ✔ |  |  |
| `barcode` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `unit` | `text` |  |  |  |
| `price` | `numeric(12,2)` | ✔ | `0` |  |
| `cost_price` | `numeric(12,2)` |  |  |  |
| `vat_rate_override` | `numeric(5,2)` |  |  |  |
| `is_vat_exempt` | `boolean` | ✔ | `false` |  |
| `print_price_with_vat` | `boolean` | ✔ | `false` |  |
| `track_inventory` | `boolean` | ✔ | `false` |  |
| `track_expiry` | `boolean` | ✔ | `false` |  |
| `reorder_level` | `numeric(12,2)` |  |  |  |
| `default_discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `description_ar` | `text` |  |  |  |
| `description_en` | `text` |  |  |  |
| `medical_service_type` | `text` |  |  |  |
| `default_clinic_id` | `uuid` |  |  | `clinics(id)` |
| `duration_minutes` | `integer` |  |  |  |
| `provider_role` | `text` |  |  |  |
| `requires_appointment` | `boolean` | ✔ | `false` |  |
| `revenue_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `cogs_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `archive_reason` | `text` |  |  |  |
| `requires_fasting` | `boolean` | ✔ | `false` |  |
| `fasting_hours` | `integer` |  |  |  |
| `preparation_ar` | `text` |  |  |  |
| `preparation_en` | `text` |  |  |  |
| `contraindications_ar` | `text` |  |  |  |
| `min_age_years` | `integer` |  |  |  |
| `max_age_years` | `integer` |  |  |  |
| `gender_restriction` | `text` | ✔ | `'any'` |  |
| `requires_consent` | `boolean` | ✔ | `false` |  |
| `consent_note_ar` | `text` |  |  |  |
| `requires_preauthorization` | `boolean` | ✔ | `false` |  |
| `requires_referral` | `boolean` | ✔ | `false` |  |
| `preauthorization_note` | `text` |  |  |  |
| `vat_category` | `text` | ✔ | `'standard'` |  |
| `vat_exempt_reason` | `text` |  |  |  |
| `dental_procedure_kind` | `text` |  |  |  |
| `default_sessions_count` | `int` |  |  |  |
| `session_interval_days` | `int` |  |  |  |
| `min_interval_days` | `int` |  |  |  |
| `legacy_code` | `text` |  |  |  |

**قيود:**

- `unique (organization_id, code)` — *(0003)*
- `constraint items_organization_id_id_key unique (organization_id, id)` — *(0053)*
- `constraint items_provider_role_check check ( provider_role is null or provider_role in ('doctor','nurse','technician','pharmacist','any') )` — *(0071)*
- `constraint items_duration_check check ( duration_minutes is null or duration_minutes between 1 and 1440 )` — *(0071)*
- `constraint items_gender_restriction_check check (gender_restriction in ('any','male','female'))` — *(0073)*
- `constraint items_age_range_check check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years)` — *(0073)*
- `constraint items_fasting_hours_check check (fasting_hours is null or (fasting_hours > 0 and fasting_hours <= 72))` — *(0073)*
- `constraint items_medical_service_type_check check ( medical_service_type is null or medical_service_type in ( 'consultation','follow_up','procedure','surgery','laboratory','radiology', 'dental','physiotherapy','vaccination','nursing','dressing','injection', 'screening','home_visit','other' ) )` — *(0083)*
- `constraint items_reorder_level_check check (reorder_level is null or reorder_level >= 0) not valid` — *(0088)*
- `constraint items_vat_category_check check ( vat_category in ('standard','zero_rated','exempt','out_of_scope') )` — *(0092)*
- `constraint items_dental_kind_check check (dental_procedure_kind is null or dental_procedure_kind = any(app_dental_procedure_kinds()))` — *(0141)*
- `constraint items_session_protocol_check check ((default_sessions_count is null or default_sessions_count between 1 and 100) and (session_interval_days is null or session_interval_days between 1 and 365) and (min_interval_days is null or min_interval_days between 1 and 365) and (min_interval_days is null or session_interval_days is null or min_interval_days <= session_interval_days))` — *(0142)*

**فهارس:**

- `idx_items_active` على (`organization_id, item_type`) — *(0071)*
- `idx_items_barcode` على (`organization_id, barcode`) — *(0003)*
- `idx_items_name` على (`to_tsvector('simple', coalesce(name_ar,'') || ' ' || coalesce(name_en,''))`) — *(0003)*
- `idx_items_org` على (`organization_id`) — *(0003)*
- `idx_items_org_cogs_account` على (`organization_id, cogs_account_id`) — *(0078)*
- `idx_items_org_default_clinic` على (`organization_id, default_clinic_id`) — *(0078)*
- `idx_items_org_revenue_account` على (`organization_id, revenue_account_id`) — *(0078)*
- `idx_items_service_type` على (`organization_id, medical_service_type`) — *(0071)*

### job_postings

أُنشئ في `0022`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `title_ar` | `text` | ✔ |  |  |
| `title_en` | `text` |  |  |  |
| `description` | `text` |  |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_job_postings_org` على (`organization_id, status`) — *(0022)*

### journal_entries

أُنشئ في `0017` · عُدِّل في: `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `entry_number` | `bigint` |  |  |  |
| `entry_date` | `date` | ✔ | `current_date` |  |
| `description` | `text` |  |  |  |
| `reference_type` | `text` | ✔ | `'manual'` |  |
| `reference_id` | `uuid` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `posted_at` | `timestamptz` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `fiscal_period_id` | `uuid` |  |  | `fiscal_periods(id)` |
| `posting_rule_id` | `uuid` |  |  |  |
| `reversal_of_id` | `uuid` |  |  | `journal_entries(id)` |
| `reversed_by_id` | `uuid` |  |  | `journal_entries(id)` |
| `is_manual` | `boolean` | ✔ | `false` |  |
| `manual_reason` | `text` |  |  |  |
| `void_reason` | `text` |  |  |  |
| `posted_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_je_period` على (`organization_id, entry_date, status`) — *(0099)*
- `idx_journal_entries_org` على (`organization_id, entry_date desc`) — *(0017)*
- `idx_journal_entries_reference` على (`reference_type, reference_id`) — *(0017)*

### journal_entry_lines

أُنشئ في `0017` · عُدِّل في: `0099`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `journal_entry_id` | `uuid` | ✔ |  | `journal_entries(id)` |
| `account_id` | `uuid` | ✔ |  | `chart_of_accounts(id)` |
| `debit` | `numeric(14,2)` | ✔ | `0` |  |
| `credit` | `numeric(14,2)` | ✔ | `0` |  |
| `description` | `text` |  |  |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `cost_center_id` | `uuid` |  |  | `cost_centers(id)` |
| `line_number` | `integer` |  |  |  |

**قيود:**

- `check (debit = 0 or credit = 0)` — *(0017)*

**فهارس:**

- `idx_jel_account` على (`account_id`) — *(0099)*
- `idx_jel_cost_center` على (`cost_center_id`) — *(0099)*
- `idx_journal_entry_lines_account` على (`account_id`) — *(0017)*
- `idx_journal_entry_lines_entry` على (`journal_entry_id`) — *(0017)*

### lab_order_items

أُنشئ في `0013` · عُدِّل في: `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `lab_order_id` | `uuid` | ✔ |  | `lab_orders(id)` |
| `lab_test_id` | `uuid` | ✔ |  | `lab_tests(id)` |
| `result_value` | `text` |  |  |  |
| `result_numeric` | `numeric` |  |  |  |
| `is_abnormal` | `boolean` |  |  |  |
| `is_critical` | `boolean` | ✔ | `false` |  |
| `unit_override` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `component_id` | `uuid` |  |  | `lab_test_components(id)` |
| `reference_low` | `numeric(14,4)` |  |  |  |
| `reference_high` | `numeric(14,4)` |  |  |  |
| `reference_text` | `text` |  |  |  |
| `entered_by` | `uuid` |  |  | `auth.users(id)` |
| `entered_at` | `timestamptz` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_lab_order_items_order` على (`lab_order_id`) — *(0013)*
- `idx_lab_order_items_test_fk` على (`lab_test_id`) — *(0124)*

### lab_orders

أُنشئ في `0013` · عُدِّل في: `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `ordering_doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `status` | `text` | ✔ | `'ordered'` |  |
| `priority` | `text` | ✔ | `'routine'` |  |
| `ordered_at` | `timestamptz` | ✔ | `now()` |  |
| `specimen_collected_at` | `timestamptz` |  |  |  |
| `completed_at` | `timestamptz` |  |  |  |
| `verified_at` | `timestamptz` |  |  |  |
| `verified_by` | `uuid` |  |  | `auth.users(id)` |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `received_at` | `timestamptz` |  |  |  |
| `collected_by` | `uuid` |  |  | `auth.users(id)` |
| `received_by` | `uuid` |  |  | `auth.users(id)` |
| `resulted_at` | `timestamptz` |  |  |  |
| `resulted_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `delivered_at` | `timestamptz` |  |  |  |
| `delivered_by` | `uuid` |  |  | `auth.users(id)` |
| `rejection_reason` | `text` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `external_lab_name` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint lab_orders_status_check check ( status in ('draft','ordered','specimen_collected','received','in_progress', 'resulted','verified','approved','delivered', 'rejected','cancelled','recollection_required') )` — *(0083)*

**فهارس:**

- `idx_lab_orders_branch_fk` على (`branch_id`) — *(0124)*
- `idx_lab_orders_clinic_fk` على (`clinic_id`) — *(0124)*
- `idx_lab_orders_doctor_fk` على (`ordering_doctor_id`) — *(0124)*
- `idx_lab_orders_invoice_fk` على (`sales_invoice_id`) — *(0124)*
- `idx_lab_orders_org` على (`organization_id`) — *(0013)*
- `idx_lab_orders_patient` على (`patient_id`) — *(0013)*
- `idx_lab_orders_status` على (`organization_id, status`) — *(0013)*
- `idx_lab_orders_visit` على (`visit_id`) — *(0056)*

### lab_reference_ranges

أُنشئ في `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `lab_test_id` | `uuid` | ✔ |  | `lab_tests(id)` |
| `component_id` | `uuid` |  |  | `lab_test_components(id)` |
| `gender` | `text` | ✔ | `'any'` |  |
| `min_age_days` | `integer` |  |  |  |
| `max_age_days` | `integer` |  |  |  |
| `pregnancy_status` | `text` | ✔ | `'any'` |  |
| `unit` | `text` |  |  |  |
| `low_value` | `numeric(14,4)` |  |  |  |
| `high_value` | `numeric(14,4)` |  |  |  |
| `critical_low` | `numeric(14,4)` |  |  |  |
| `critical_high` | `numeric(14,4)` |  |  |  |
| `text_reference` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint lab_ranges_gender_check check (gender in ('any','male','female'))` — *(0083)*
- `constraint lab_ranges_pregnancy_check check (pregnancy_status in ('any','pregnant','not_pregnant'))` — *(0083)*
- `constraint lab_ranges_age_check check (min_age_days is null or max_age_days is null or min_age_days <= max_age_days)` — *(0083)*
- `constraint lab_ranges_value_check check (low_value is null or high_value is null or low_value <= high_value)` — *(0083)*
- `constraint lab_ranges_content_check check (low_value is not null or high_value is not null or text_reference is not null)` — *(0083)*

**فهارس:**

- `idx_lab_ranges_test` على (`lab_test_id`) — *(0083)*

### lab_result_amendments

أُنشئ في `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `lab_order_item_id` | `uuid` | ✔ |  | `lab_order_items(id)` |
| `previous_value` | `text` |  |  |  |
| `previous_numeric` | `numeric(14,4)` |  |  |  |
| `new_value` | `text` |  |  |  |
| `new_numeric` | `numeric(14,4)` |  |  |  |
| `reason` | `text` | ✔ |  |  |
| `amended_by` | `uuid` |  |  | `auth.users(id)` |
| `amended_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_lab_amendments_item` على (`lab_order_item_id`) — *(0083)*

### lab_result_attachments

أُنشئ في `0013`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `lab_order_id` | `uuid` | ✔ |  | `lab_orders(id)` |
| `file_url` | `text` | ✔ |  |  |
| `file_name` | `text` |  |  |  |
| `uploaded_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### lab_test_categories

أُنشئ في `0013`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `sort_order` | `int` | ✔ | `0` |  |

### lab_test_components

أُنشئ في `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `lab_test_id` | `uuid` | ✔ |  | `lab_tests(id)` |
| `component_code` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `unit` | `text` |  |  |  |
| `data_type` | `text` | ✔ | `'numeric'` |  |
| `decimal_places` | `smallint` | ✔ | `2` |  |
| `loinc_code` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint lab_components_type_check check ( data_type in ('numeric','text','select','boolean','titer') )` — *(0083)*
- `constraint lab_components_decimals_check check (decimal_places between 0 and 6)` — *(0083)*

**فهارس:**

- `idx_lab_components_test` على (`lab_test_id`) — *(0083)*
- `uq_lab_components` — فريد على (`lab_test_id, component_code`) — *(0083)*

### lab_tests

أُنشئ في `0013` · عُدِّل في: `0083`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `category_id` | `uuid` |  |  | `lab_test_categories(id)` |
| `billing_item_id` | `uuid` | ✔ |  | `items(id)` |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `specimen_type` | `text` | ✔ | `'blood'` |  |
| `unit` | `text` |  |  |  |
| `normal_range_text` | `text` |  |  |  |
| `normal_range_min` | `numeric` |  |  |  |
| `normal_range_max` | `numeric` |  |  |  |
| `turnaround_hours` | `int` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `specimen_container` | `text` |  |  |  |
| `specimen_volume_ml` | `numeric(6,2)` |  |  |  |
| `collection_instructions_ar` | `text` |  |  |  |
| `collection_instructions_en` | `text` |  |  |  |
| `external_lab_allowed` | `boolean` | ✔ | `false` |  |
| `requires_approval` | `boolean` | ✔ | `false` |  |
| `is_panel` | `boolean` | ✔ | `false` |  |
| `department_id` | `uuid` |  |  | `departments(id)` |
| `loinc_code` | `text` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint lab_tests_volume_check check (specimen_volume_ml is null or specimen_volume_ml > 0)` — *(0083)*
- `constraint lab_tests_item_tenant_fk foreign key (organization_id, billing_item_id) references items (organization_id, id) not valid` — *(0083)*

**فهارس:**

- `idx_lab_tests_billing_item_fk` على (`billing_item_id`) — *(0124)*
- `idx_lab_tests_category_fk` على (`category_id`) — *(0124)*
- `idx_lab_tests_org` على (`organization_id`) — *(0013)*

### leave_balances

أُنشئ في `0020`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `leave_type_id` | `uuid` | ✔ |  | `leave_types(id)` |
| `year` | `integer` | ✔ |  |  |
| `entitled_days` | `numeric(6,2)` | ✔ | `0` |  |
| `used_days` | `numeric(6,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (employee_id, leave_type_id, year)` — *(0020)*

**فهارس:**

- `idx_leave_balances_employee` على (`employee_id, year`) — *(0020)*

### leave_requests

أُنشئ في `0020`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `leave_type_id` | `uuid` | ✔ |  | `leave_types(id)` |
| `start_date` | `date` | ✔ |  |  |
| `end_date` | `date` | ✔ |  |  |
| `days_count` | `numeric(6,2)` | ✔ | `0` |  |
| `reason` | `text` |  |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `check (end_date >= start_date)` — *(0020)*

**فهارس:**

- `idx_leave_requests_employee` على (`employee_id, start_date desc`) — *(0020)*
- `idx_leave_requests_org_status` على (`organization_id, status`) — *(0020)*

### leave_types

أُنشئ في `0020`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `annual_entitlement_days` | `numeric(6,2)` | ✔ | `0` |  |
| `is_paid` | `boolean` | ✔ | `true` |  |
| `requires_approval` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_leave_types_org` على (`organization_id`) — *(0020)*

### lookup_categories

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `key` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` | ✔ |  |  |

**قيود:**

- `unique (organization_id, key)` — *(0001)*

**فهارس:**

- `idx_lookup_categories_global_key` — فريد على (`key`) — *(0003)*

### lookup_values

أُنشئ في `0001` · عُدِّل في: `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `category_id` | `uuid` | ✔ |  | `lookup_categories(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `code` | `text` |  |  |  |
| `parent_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `extra` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `sort_order` | `int` | ✔ | `0` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint uq_lookup_values_category_name unique (category_id, name_ar)` — *(0003)*

### maintenance_order_parts

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `maintenance_order_id` | `uuid` | ✔ |  | `maintenance_orders(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `part_name` | `text` |  |  |  |
| `qty` | `numeric(14,3)` | ✔ |  |  |
| `unit_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `total_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `issued_from_stock` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### maintenance_orders

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `maintenance_plan_id` | `uuid` |  |  | `maintenance_plans(id)` |
| `maintenance_request_id` | `uuid` |  |  | `maintenance_requests(id)` |
| `order_number` | `text` |  |  |  |
| `order_type` | `text` | ✔ | `'corrective'` |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `scheduled_date` | `date` |  |  |  |
| `started_at` | `timestamptz` |  |  |  |
| `completed_at` | `timestamptz` |  |  |  |
| `performed_by` | `uuid` |  |  | `auth.users(id)` |
| `vendor_distributor_id` | `uuid` |  |  | `distributors(id)` |
| `labor_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `parts_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `total_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `downtime_hours` | `numeric(10,2)` |  |  |  |
| `findings` | `text` |  |  |  |
| `actions_taken` | `text` |  |  |  |
| `next_due_date` | `date` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_maint_orders_asset` على (`organization_id, asset_id, status`) — *(0101)*

### maintenance_plans

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `frequency_days` | `integer` | ✔ |  |  |
| `last_done_date` | `date` |  |  |  |
| `next_due_date` | `date` |  |  |  |
| `checklist` | `jsonb` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### maintenance_requests

أُنشئ في `0101`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `asset_id` | `uuid` | ✔ |  | `assets(id)` |
| `request_number` | `text` |  |  |  |
| `fault_description` | `text` | ✔ |  |  |
| `severity` | `text` | ✔ | `'normal'` |  |
| `status` | `text` | ✔ | `'open'` |  |
| `reported_by` | `uuid` |  |  | `auth.users(id)` |
| `reported_at` | `timestamptz` | ✔ | `now()` |  |
| `takes_out_of_service` | `boolean` | ✔ | `false` |  |
| `resolved_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_maint_requests_asset` على (`organization_id, asset_id, status`) — *(0101)*

### medical_record_access_log

أُنشئ في `0095` · عُدِّل في: `0125`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `user_id` | `uuid` |  |  | `auth.users(id)` |
| `access_type` | `text` | ✔ | `'view'` |  |
| `context` | `text` |  |  |  |
| `reason` | `text` |  |  |  |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `document_id` | `uuid` |  |  |  |
| `occurred_at` | `timestamptz` | ✔ | `now()` |  |
| `device_name` | `text` |  |  |  |

**فهارس:**

- `idx_medical_access_branch_fk` على (`branch_id`) — *(0124)*
- `idx_medical_access_patient_fk` على (`patient_id`) — *(0124)*
- `idx_medical_access_user_fk` على (`user_id`) — *(0124)*
- `idx_medical_access_visit_fk` على (`visit_id`) — *(0124)*
- `idx_mral_patient` على (`organization_id, patient_id, occurred_at desc`) — *(0095)*
- `idx_mral_user` على (`organization_id, user_id, occurred_at desc`) — *(0095)*

### membership_permissions

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `permission_key` | `text` | ✔ |  |  |
| `granted` | `boolean` | ✔ | `true` |  |

**قيود:**

- `primary key (organization_id, user_id, permission_key)` — *(0001)*
- `foreign key (organization_id, user_id) references organization_memberships(organization_id, user_id) on delete cascade` — *(0001)*

### message_log

أُنشئ في `0009` · عُدِّل في: `0050`، `0054`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `recipient_user_id` | `uuid` |  |  | `auth.users(id)` |
| `external_recipient` | `text` |  |  |  |
| `channel` | `text` | ✔ | `'sms'` |  |
| `event_key` | `text` |  |  |  |
| `message_text` | `text` | ✔ |  |  |
| `status` | `text` | ✔ | `'queued'` |  |
| `provider_message_id` | `text` |  |  |  |
| `sent_at` | `timestamptz` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `attempts` | `integer` | ✔ | `0` |  |
| `last_error` | `text` |  |  |  |
| `next_attempt_at` | `timestamptz` |  |  |  |
| `failed_at` | `timestamptz` |  |  |  |
| `reminder_job_id` | `uuid` |  |  | `appointment_reminder_jobs(id)` |

**قيود:**

- `constraint message_log_status_check check ( status in ('pending','queued','processing','sent','delivered','failed','cancelled') )` — *(0054)*

**فهارس:**

- `idx_message_log_appointment` على (`appointment_id`) — *(0051)*
- `idx_message_log_dispatchable` على (`next_attempt_at, created_at`) — *(0054)*
- `idx_message_log_org_date` على (`organization_id, created_at desc`) — *(0009)*
- `idx_message_log_patient` على (`patient_id`) — *(0009)*
- `idx_message_log_reminder_job` على (`reminder_job_id`) — *(0054)*

### message_templates

أُنشئ في `0009` · عُدِّل في: `0069`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `event_key` | `text` | ✔ |  |  |
| `channel` | `text` | ✔ | `'sms'` |  |
| `template_text` | `text` | ✔ |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `language` | `text` | ✔ | `'ar'` |  |

**قيود:**

- `unique (organization_id, event_key, channel)` — *(0009)*
- `constraint message_templates_language_check check (language in ('ar', 'en'))` — *(0069)*

**فهارس:**

- `uq_message_templates_org_event_channel_lang` — فريد على (`organization_id, event_key, channel, language`) — *(0069)*

### notification_preferences

أُنشئ في `0103`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `category` | `text` | ✔ |  |  |
| `is_muted` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `primary key (organization_id, user_id, category)` — *(0103)*

### notification_rules

أُنشئ في `0103`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `event_key` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `category` | `text` | ✔ | `'operational'` |  |
| `severity` | `text` | ✔ | `'info'` |  |
| `target_permission` | `text` |  |  |  |
| `target_role_key` | `text` |  |  |  |
| `channel` | `text` | ✔ | `'internal'` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_notification_rule_event` — فريد على (`organization_id, event_key`) — *(0103)*

### notifications

أُنشئ في `0103`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `event_key` | `text` | ✔ |  |  |
| `category` | `text` | ✔ | `'operational'` |  |
| `severity` | `text` | ✔ | `'info'` |  |
| `title` | `text` | ✔ |  |  |
| `body` | `text` |  |  |  |
| `entity_type` | `text` |  |  |  |
| `entity_id` | `uuid` |  |  |  |
| `action_path` | `text` |  |  |  |
| `dedupe_key` | `text` | ✔ |  |  |
| `read_at` | `timestamptz` |  |  |  |
| `dismissed_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_notifications_branch_fk` على (`branch_id`) — *(0124)*
- `idx_notifications_inbox` على (`organization_id, user_id, read_at, created_at desc`) — *(0103)*
- `idx_notifications_user_fk` على (`user_id`) — *(0124)*
- `uq_notification_dedupe` — فريد على (`organization_id, user_id, dedupe_key`) — *(0103)*

### nphies_messages

أُنشئ في `0093` · عُدِّل في: `0110`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `message_type` | `text` | ✔ |  |  |
| `direction` | `text` | ✔ | `'outbound'` |  |
| `environment` | `text` | ✔ | `'sandbox'` |  |
| `status` | `text` | ✔ | `'queued'` |  |
| `request_id` | `text` |  |  |  |
| `response_id` | `text` |  |  |  |
| `correlation_id` | `uuid` |  |  |  |
| `eligibility_check_id` | `uuid` |  |  | `insurance_eligibility_checks(id)` |
| `preauthorization_id` | `uuid` |  |  | `insurance_preauthorizations(id)` |
| `claim_form_id` | `uuid` |  |  | `insurance_claim_forms(id)` |
| `request_payload` | `jsonb` |  |  |  |
| `response_payload` | `jsonb` |  |  |  |
| `errors` | `jsonb` |  |  |  |
| `attempt_count` | `integer` | ✔ | `0` |  |
| `last_attempt_at` | `timestamptz` |  |  |  |
| `sent_at` | `timestamptz` |  |  |  |
| `responded_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `next_attempt_at` | `timestamptz` |  |  |  |
| `max_attempts` | `integer` | ✔ | `6` |  |
| `failed_permanently` | `boolean` | ✔ | `false` |  |
| `last_error` | `text` |  |  |  |
| `dead_lettered_at` | `timestamptz` |  |  |  |

**فهارس:**

- `idx_nphies_claim` على (`claim_form_id`) — *(0093)*
- `idx_nphies_due` على (`organization_id, next_attempt_at`) — *(0110)*
- `idx_nphies_pending` على (`organization_id, status, created_at`) — *(0093)*
- `uq_nphies_live_message` — فريد على (`message_type, coalesce(claim_form_id, preauthorization_id, eligibility_check_id)`) — *(0093)*

### occupational_exam_results

أُنشئ في `0149`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  |  |
| `patient_id` | `uuid` | ✔ |  |  |
| `visit_id` | `uuid` | ✔ |  |  |
| `exam_purpose` | `text` | ✔ | `'periodic'::text` |  |
| `fitness_status` | `text` | ✔ | `'pending'::text` |  |
| `employer_value_id` | `uuid` |  |  |  |
| `restrictions_note` | `text` |  |  |  |
| `certificate_number` | `text` |  |  |  |
| `exam_date` | `date` | ✔ | `current_date` |  |
| `next_exam_due_date` | `date` |  |  |  |
| `created_by` | `uuid` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint occupational_exam_results_pkey primary key (id)` — *(0149)*
- `constraint occupational_exam_results_visit_id_key unique (visit_id)` — *(0149)*
- `constraint occupational_exam_results_exam_purpose_check check (exam_purpose = any (array['pre_employment'::text, 'periodic'::text, 'return_to_work'::text, 'exit'::text]))` — *(0149)*
- `constraint occupational_exam_results_fitness_status_check check (fitness_status = any (array['fit'::text, 'fit_with_restrictions'::text, 'unfit'::text, 'pending'::text]))` — *(0149)*
- `constraint occupational_exam_results_created_by_fkey foreign key (created_by) references auth.users(id)` — *(0149)*
- `constraint occupational_exam_results_employer_value_id_fkey foreign key (employer_value_id) references lookup_values(id)` — *(0149)*
- `constraint occupational_exam_results_organization_id_fkey foreign key (organization_id) references organizations(id) on delete cascade` — *(0149)*
- `constraint occupational_exam_results_patient_id_fkey foreign key (patient_id) references patients(id) on delete cascade` — *(0149)*
- `constraint occupational_exam_results_visit_id_fkey foreign key (visit_id) references patient_visits(id) on delete cascade` — *(0149)*

**فهارس:**

- `idx_occupational_exam_due` على (`organization_id, next_exam_due_date`) — *(0149)*
- `idx_occupational_exam_employer` على (`organization_id, employer_value_id`) — *(0149)*
- `idx_occupational_exam_org_date` على (`organization_id, exam_date desc`) — *(0149)*

### offer_items

أُنشئ في `0004`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `offer_id` | `uuid` | ✔ |  | `offers(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `category_value_id` | `uuid` |  |  | `lookup_values(id)` |

**قيود:**

- `check (item_id is not null or category_value_id is not null)` — *(0004)*

**فهارس:**

- `idx_offer_items_offer` على (`offer_id`) — *(0004)*

### offers

أُنشئ في `0004`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `offer_number` | `bigserial` |  |  |  |
| `classification` | `text` |  |  |  |
| `title` | `text` | ✔ |  |  |
| `description` | `text` |  |  |  |
| `offer_scope` | `text` | ✔ | `'date_range'` |  |
| `start_date` | `date` |  |  |  |
| `end_date` | `date` |  |  |  |
| `start_time` | `time` |  |  |  |
| `end_time` | `time` |  |  |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `applies_to_all_items` | `boolean` | ✔ | `true` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, offer_number)` — *(0004)*

**فهارس:**

- `idx_offers_org_active` على (`organization_id, is_disabled`) — *(0004)*

### organization_discount_settings

أُنشئ في `0004`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `general_discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### organization_features

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `feature_key` | `text` | ✔ |  | `feature_catalog(feature_key)` |
| `enabled` | `boolean` | ✔ | `true` |  |

**قيود:**

- `primary key (organization_id, feature_key)` — *(0001)*

### organization_holidays

أُنشئ في `0107`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `holiday_date` | `date` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `uq_holiday_day` — فريد على (`organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), holiday_date`) — *(0107)*

### organization_locale_settings

أُنشئ في `0109`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `country_code` | `text` | ✔ | `'SA'` |  |
| `currency_code` | `text` | ✔ | `'SAR'` |  |
| `data_language` | `text` | ✔ | `'ar'` |  |
| `calendar_display` | `text` | ✔ | `'gregorian'` |  |
| `enforce_id_validation` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

### organization_memberships

أُنشئ في `0001` · عُدِّل في: `0042`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `role_key` | `text` | ✔ |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `display_language` | `text` | ✔ | `'ar'` |  |
| `mobile_number` | `text` |  |  |  |
| `note` | `text` |  |  |  |

**قيود:**

- `primary key (organization_id, user_id)` — *(0001)*

### organization_policies

أُنشئ في `0107`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `critical_ack_minutes` | `integer` | ✔ | `30` |  |
| `portal_open_requests_limit` | `integer` | ✔ | `3` |  |
| `portal_cancel_cutoff_hours` | `integer` | ✔ | `0` |  |
| `document_expiry_notice_days` | `integer` | ✔ | `60` |  |
| `visit_open_alert_days` | `integer` | ✔ | `2` |  |
| `enforce_working_hours` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

### organization_vat_settings

أُنشئ في `0003` · عُدِّل في: `0092`، `0147`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `sales_vat_enabled` | `boolean` | ✔ | `true` |  |
| `purchase_vat_enabled` | `boolean` | ✔ | `true` |  |
| `purchase_vat_editable` | `boolean` | ✔ | `false` |  |
| `dental_lab_vat_enabled` | `boolean` | ✔ | `true` |  |
| `dental_lab_vat_editable` | `boolean` | ✔ | `false` |  |
| `misc_expenses_vat_enabled` | `boolean` | ✔ | `false` |  |
| `misc_expenses_require_supplier_tax_number` | `boolean` | ✔ | `false` |  |
| `misc_expenses_require_purchase_invoice_number` | `boolean` | ✔ | `false` |  |
| `print_price_with_vat` | `boolean` | ✔ | `true` |  |
| `block_invoice_without_nationality_or_id` | `boolean` | ✔ | `false` |  |
| `vat_exempt_nationality_value_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `vat_exemption_disabled_for_customer_types` | `boolean` | ✔ | `false` |  |
| `vat_exemption_disabled_for_items` | `boolean` | ✔ | `false` |  |
| `vat_declaration_viewer_user_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `legal_name_ar` | `text` |  |  |  |
| `legal_name_en` | `text` |  |  |  |
| `cr_number` | `text` |  |  |  |
| `vat_registration_number` | `text` |  |  |  |
| `vat_registration_date` | `date` |  |  |  |
| `vat_status` | `text` | ✔ | `'not_registered'` |  |
| `default_vat_rate` | `numeric` | ✔ | `15` |  |
| `building_number` | `text` |  |  |  |
| `street_name` | `text` |  |  |  |
| `district` | `text` |  |  |  |
| `city` | `text` |  |  |  |
| `postal_code` | `text` |  |  |  |
| `additional_number` | `text` |  |  |  |
| `country_code` | `text` | ✔ | `'SA'` |  |
| `default_document_type` | `text` | ✔ | `'simplified'` |  |
| `numbering_scope` | `text` | ✔ | `'organization'` |  |
| `invoice_number_prefix` | `text` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `vat_exempt_requires_id` | `boolean` | ✔ | `true` |  |

**قيود:**

- `constraint ovs_vat_status_check check (vat_status in ('not_registered','registered','exempt'))` — *(0092)*
- `constraint ovs_numbering_scope_check check (numbering_scope in ('organization','branch'))` — *(0092)*
- `constraint ovs_doc_type_check check (default_document_type in ('standard','simplified'))` — *(0092)*

### organizations

أُنشئ في `0001` · عُدِّل في: `0117`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `name` | `text` | ✔ |  |  |
| `organization_type` | `text` | ✔ |  |  |
| `created_by` | `uuid` | ✔ |  | `auth.users(id)` |
| `legacy_full_access` | `boolean` | ✔ | `false` |  |
| `tax_number` | `text` |  |  |  |
| `currency` | `text` | ✔ | `'SAR'` |  |
| `default_vat_rate` | `numeric(5,2)` | ✔ | `15.00` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint organizations_medical_center_only_check check (organization_type = 'medical_center')` — *(0117)*

### package_items

أُنشئ في `0016` · عُدِّل في: `0096`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `package_id` | `uuid` | ✔ |  | `packages(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `quantity_included` | `numeric(12,2)` | ✔ | `1` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `max_per_visit` | `numeric(10,2)` |  |  |  |
| `min_days_between_uses` | `integer` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |

**قيود:**

- `unique (package_id, item_id)` — *(0016)*

### packages

أُنشئ في `0016` · عُدِّل في: `0096`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `price` | `numeric(12,2)` | ✔ | `0` |  |
| `validity_days` | `int` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `subscription_type` | `text` | ✔ | `'one_time'` |  |
| `list_price` | `numeric(14,2)` |  |  |  |
| `min_age_years` | `integer` |  |  |  |
| `max_age_years` | `integer` |  |  |  |
| `gender_restriction` | `text` |  |  |  |
| `allowed_doctor_ids` | `uuid[]` |  |  |  |
| `allowed_specialty_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `is_transferable` | `boolean` | ✔ | `false` |  |
| `is_refundable` | `boolean` | ✔ | `true` |  |
| `refund_policy` | `text` |  |  |  |
| `max_renewals` | `integer` |  |  |  |
| `description_ar` | `text` |  |  |  |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint packages_subscription_type_check check (subscription_type in ('one_time','monthly','quarterly','annual'))` — *(0096)*
- `constraint packages_gender_check check (gender_restriction is null or gender_restriction in ('male','female'))` — *(0096)*
- `constraint packages_age_range_check check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years)` — *(0096)*

**فهارس:**

- `idx_packages_org` على (`organization_id`) — *(0016)*

### patient_change_requests

أُنشئ في `0104`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `field_key` | `text` | ✔ |  |  |
| `current_value` | `text` |  |  |  |
| `requested_value` | `text` | ✔ |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `decided_by` | `uuid` |  |  | `auth.users(id)` |
| `decided_at` | `timestamptz` |  |  |  |
| `decision_note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### patient_consents

أُنشئ في `0095`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `consent_type` | `text` | ✔ |  |  |
| `purpose` | `text` | ✔ |  |  |
| `status` | `text` | ✔ | `'granted'` |  |
| `version` | `integer` | ✔ | `1` |  |
| `granted_at` | `timestamptz` | ✔ | `now()` |  |
| `granted_by` | `uuid` |  |  | `auth.users(id)` |
| `expires_at` | `timestamptz` |  |  |  |
| `withdrawn_at` | `timestamptz` |  |  |  |
| `withdrawn_by` | `uuid` |  |  | `auth.users(id)` |
| `withdrawal_reason` | `text` |  |  |  |
| `document_id` | `uuid` |  |  | `patient_documents(id)` |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_consents_patient` على (`organization_id, patient_id, consent_type`) — *(0095)*
- `uq_active_consent` — فريد على (`patient_id, consent_type`) — *(0095)*

### patient_contacts

أُنشئ في `0066`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `full_name` | `text` | ✔ |  |  |
| `relation` | `text` |  |  |  |
| `mobile_number` | `text` |  |  |  |
| `is_emergency_contact` | `boolean` | ✔ | `false` |  |
| `authorized_to_receive` | `boolean` | ✔ | `false` |  |
| `companion_type` | `text` | ✔ | `'temporary'` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint patient_contacts_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id)` — *(0066)*

**فهارس:**

- `idx_patient_contacts_org` على (`organization_id`) — *(0066)*
- `idx_patient_contacts_patient` على (`patient_id`) — *(0066)*

### patient_documents

أُنشئ في `0006` · عُدِّل في: `0066`، `0091`، `0102`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `category` | `text` | ✔ | `'document'` |  |
| `doc_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `storage_path` | `text` | ✔ |  |  |
| `file_name` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `uploaded_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `expires_at` | `date` |  |  |  |
| `is_consent` | `boolean` | ✔ | `false` |  |
| `signed_at` | `timestamptz` |  |  |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `template_id` | `uuid` |  |  | `document_templates(id)` |
| `generated_document_id` | `uuid` |  |  | `generated_documents(id)` |
| `document_number` | `bigint` |  |  |  |
| `mime_type` | `text` |  |  |  |
| `file_size_bytes` | `bigint` |  |  |  |
| `signed_by` | `uuid` |  |  | `auth.users(id)` |
| `is_archived` | `boolean` | ✔ | `false` |  |
| `archived_at` | `timestamptz` |  |  |  |
| `archived_by` | `uuid` |  |  | `auth.users(id)` |
| `archive_reason` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_patient_documents_expiry` على (`organization_id, expires_at`) — *(0091)*
- `idx_patient_documents_item` على (`organization_id, item_id`) — *(0102)*
- `idx_patient_documents_patient` على (`organization_id, patient_id, is_archived`) — *(0102)*
- `idx_patient_documents_patient_created` على (`patient_id, created_at desc`) — *(0018)*

### patient_health_conditions

أُنشئ في `0002`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `condition_id` | `uuid` | ✔ |  | `health_conditions(id)` |
| `is_checked` | `boolean` | ✔ | `true` |  |
| `note` | `text` |  |  |  |

**قيود:**

- `primary key (patient_id, condition_id)` — *(0002)*

### patient_insurance_memberships

أُنشئ في `0005`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `policy_id` | `uuid` | ✔ |  | `insurance_policies(id)` |
| `membership_number` | `text` | ✔ |  |  |
| `relation` | `text` | ✔ | `'self'` |  |
| `copay_percent_override` | `numeric(5,2)` |  |  |  |
| `max_amount_override` | `numeric(12,2)` |  |  |  |
| `expiry_date` | `date` |  |  |  |
| `eligibility_status` | `text` | ✔ | `'unknown'` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (patient_id, policy_id, membership_number)` — *(0005)*

**فهارس:**

- `idx_patient_memberships_patient` على (`patient_id`) — *(0005)*

### patient_medical_history

أُنشئ في `0002`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `patient_id` 🔑 | `uuid` | ✔ |  | `patients(id)` |
| `personal_history` | `text` |  |  |  |
| `treatment_history` | `text` |  |  |  |
| `family_history` | `text` |  |  |  |
| `drug_allergy` | `text` |  |  |  |
| `special_habits` | `text` |  |  |  |
| `health_status_notes` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### patient_notes

أُنشئ في `0002`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `title` | `text` |  |  |  |
| `body` | `text` | ✔ |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |

**فهارس:**

- `idx_patient_notes_patient_created` على (`patient_id, created_at desc`) — *(0018)*

### patient_package_usages

أُنشئ في `0016` · عُدِّل في: `0096`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `patient_package_id` | `uuid` | ✔ |  | `patient_packages(id)` |
| `package_item_id` | `uuid` | ✔ |  | `package_items(id)` |
| `quantity_used` | `numeric(12,2)` | ✔ | `1` |  |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `used_at` | `timestamptz` | ✔ | `now()` |  |
| `used_by` | `uuid` |  |  | `auth.users(id)` |
| `note` | `text` |  |  |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `visit_service_id` | `uuid` |  |  | `patient_visit_services(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `is_reversed` | `boolean` | ✔ | `false` |  |
| `reversed_at` | `timestamptz` |  |  |  |
| `reversed_by` | `uuid` |  |  | `auth.users(id)` |
| `reversal_reason` | `text` |  |  |  |

**فهارس:**

- `idx_patient_package_usages_subscription` على (`patient_package_id`) — *(0016)*
- `uq_usage_per_visit_service` — فريد على (`visit_service_id`) — *(0096)*

### patient_packages

أُنشئ في `0016` · عُدِّل في: `0096`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `package_id` | `uuid` | ✔ |  | `packages(id)` |
| `sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `purchased_at` | `timestamptz` | ✔ | `now()` |  |
| `expires_at` | `timestamptz` |  |  |  |
| `status` | `text` | ✔ | `'active'` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `price_paid` | `numeric(14,2)` |  |  |  |
| `frozen_at` | `timestamptz` |  |  |  |
| `frozen_days` | `integer` | ✔ | `0` |  |
| `freeze_reason` | `text` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancelled_by` | `uuid` |  |  | `auth.users(id)` |
| `cancel_reason` | `text` |  |  |  |
| `refunded_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `refund_note_id` | `uuid` |  |  | `sales_invoices(id)` |
| `renewed_from_id` | `uuid` |  |  | `patient_packages(id)` |
| `renewal_count` | `integer` | ✔ | `0` |  |
| `transferred_from_patient_id` | `uuid` |  |  | `patients(id)` |
| `transferred_at` | `timestamptz` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint patient_packages_status_check check (status in ('active','frozen','expired','consumed','cancelled','refunded'))` — *(0096)*

**فهارس:**

- `idx_patient_packages_active` على (`organization_id, patient_id, status`) — *(0096)*
- `idx_patient_packages_org` على (`organization_id`) — *(0016)*
- `idx_patient_packages_patient` على (`patient_id`) — *(0016)*

### patient_portal_accounts

أُنشئ في `0104`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `user_id` | `uuid` | ✔ |  | `auth.users(id)` |
| `status` | `text` | ✔ | `'active'` |  |
| `linked_by` | `uuid` |  |  | `auth.users(id)` |
| `linked_at` | `timestamptz` | ✔ | `now()` |  |
| `revoked_at` | `timestamptz` |  |  |  |
| `revoked_by` | `uuid` |  |  | `auth.users(id)` |
| `revoke_reason` | `text` |  |  |  |
| `last_seen_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_portal_account_patient` — فريد على (`organization_id, patient_id`) — *(0104)*
- `uq_portal_account_user` — فريد على (`organization_id, user_id`) — *(0104)*

### patient_tooth_status

أُنشئ في `0141`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `tooth_number` | `text` | ✔ |  |  |
| `tooth_type` | `text` | ✔ | `'permanent'` |  |
| `condition` | `text` | ✔ | `'sound'` |  |
| `surfaces` | `text[]` | ✔ | `'{}'` |  |
| `note` | `text` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_tooth_status_org` على (`organization_id, patient_id`) — *(0141)*
- `uq_tooth_status_per_patient` — فريد على (`patient_id, tooth_number`) — *(0141)*

### patient_visit_diagnoses

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `visit_id` | `uuid` | ✔ |  | `patient_visits(id)` |
| `icd10_code_id` | `uuid` | ✔ |  | `icd10_codes(id)` |
| `note` | `text` |  |  |  |

**قيود:**

- `primary key (visit_id, icd10_code_id)` — *(0006)*

### patient_visit_services

أُنشئ في `0053` · عُدِّل في: `0073`، `0077`، `0096`، `0102`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `visit_id` | `uuid` | ✔ |  | `patient_visits(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `unit_price` | `numeric(14,2)` |  |  |  |
| `note` | `text` |  |  |  |
| `performed_by` | `uuid` |  |  | `doctors(id)` |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `status` | `text` | ✔ | `'performed'` |  |
| `status_changed_at` | `timestamptz` | ✔ | `now()` |  |
| `status_changed_by` | `uuid` |  |  | `auth.users(id)` |
| `status_note` | `text` |  |  |  |
| `package_usage_id` | `uuid` |  |  | `patient_package_usages(id)` |
| `consent_override_reason` | `text` |  |  |  |
| `consent_overridden_by` | `uuid` |  |  | `auth.users(id)` |
| `consent_overridden_at` | `timestamptz` |  |  |  |

**قيود:**

- `constraint visit_services_visit_tenant_fk foreign key (organization_id, visit_id) references patient_visits(organization_id, id)` — *(0053)*
- `constraint visit_services_item_tenant_fk foreign key (organization_id, item_id) references items(organization_id, id)` — *(0053)*
- `constraint patient_visit_services_organization_id_id_key unique (organization_id, id)` — *(0053)*
- `constraint patient_visit_services_status_check check (status in ('draft','ordered','performed','invoiced','paid','claimed','cancelled','refunded'))` — *(0073)*
- `constraint pvs_visit_tenant_fk foreign key (organization_id, visit_id) references patient_visits (organization_id, id) not valid` — *(0077)*

**فهارس:**

- `idx_pvs_status` على (`organization_id, status`) — *(0073)*
- `idx_visit_services_org` على (`organization_id, created_at desc`) — *(0053)*
- `idx_visit_services_visit` على (`visit_id`) — *(0053)*

### patient_visits

أُنشئ في `0006` · عُدِّل في: `0050`، `0052`، `0056`، `0062`، `0085`، `0087`، `0090`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `template_id` | `uuid` |  |  | `clinic_exam_templates(id)` |
| `canvas_type` | `text` | ✔ | `'none'` |  |
| `visit_date` | `timestamptz` | ✔ | `now()` |  |
| `main_complaint` | `text` |  |  |  |
| `exam_data` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `notes` | `text` |  |  |  |
| `next_visit_plan` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `next_visit_date` | `date` |  |  |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `exam_schema_snapshot` | `jsonb` |  |  |  |
| `template_version` | `integer` |  |  |  |
| `status` | `text` | ✔ | `'planned'` |  |
| `started_at` | `timestamptz` |  |  |  |
| `ended_at` | `timestamptz` |  |  |  |
| `signed_at` | `timestamptz` |  |  |  |
| `signed_by` | `uuid` |  |  | `auth.users(id)` |
| `closed_at` | `timestamptz` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `reopened_at` | `timestamptz` |  |  |  |
| `reopened_by` | `uuid` |  |  | `auth.users(id)` |
| `reopen_reason` | `text` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint patient_visits_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id) not valid` — *(0050)*
- `constraint patient_visits_doctor_tenant_fk foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid` — *(0050)*
- `constraint patient_visits_clinic_tenant_fk foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid` — *(0050)*
- `constraint patient_visits_appointment_tenant_fk foreign key (organization_id, appointment_id) references appointments(organization_id, id) not valid` — *(0050)*
- `constraint patient_visits_organization_id_id_key unique (organization_id, id)` — *(0052)*
- `constraint patient_visits_status_check check ( status in ('planned','waiting','in_progress','completed','signed','closed','cancelled') )` — *(0087)*

**فهارس:**

- `idx_patient_visits_branch` على (`organization_id, branch_id`) — *(0062)*
- `idx_patient_visits_next_visit_date` على (`organization_id, next_visit_date`) — *(0056)*
- `idx_patient_visits_one_per_appointment` — فريد على (`appointment_id`) — *(0050)*
- `idx_patient_visits_org` على (`organization_id, visit_date desc`) — *(0006)*
- `idx_patient_visits_org_appointment` على (`organization_id, appointment_id`) — *(0051)*
- `idx_patient_visits_patient` على (`patient_id, visit_date desc`) — *(0006)*
- `idx_patient_visits_patient_date` على (`patient_id, visit_date desc`) — *(0018)*
- `idx_visits_status` على (`organization_id, status, visit_date desc`) — *(0087)*

### patient_vital_signs

أُنشئ في `0006`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `recorded_at` | `timestamptz` | ✔ | `now()` |  |
| `heart_rate` | `numeric(5,1)` |  |  |  |
| `blood_pressure_systolic` | `numeric(5,1)` |  |  |  |
| `blood_pressure_diastolic` | `numeric(5,1)` |  |  |  |
| `temperature_celsius` | `numeric(4,1)` |  |  |  |
| `glucose_level` | `numeric(6,1)` |  |  |  |
| `height_cm` | `numeric(5,1)` |  |  |  |
| `weight_kg` | `numeric(5,1)` |  |  |  |
| `bmi` | `numeric(5,2)` | ✔ |  |  |
| `respiratory_rate` | `numeric(5,1)` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_vitals_patient_date` على (`patient_id, recorded_at desc`) — *(0006)*
- `uq_patient_vital_signs_visit` — فريد على (`visit_id`) — *(0056)*

### patient_wallet_transactions

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `transaction_type` | `text` | ✔ |  |  |
| `amount` | `numeric(12,2)` | ✔ |  |  |
| `related_voucher_id` | `uuid` |  |  | `financial_vouchers(id)` |
| `related_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_wallet_tx_patient` على (`patient_id, created_at desc`) — *(0003)*

### patient_wallets

أُنشئ في `0001` · عُدِّل في: `0002`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `patient_id` 🔑 | `uuid` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `balance` | `numeric(12,2)` | ✔ | `0` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint patient_wallets_patient_fk foreign key (patient_id) references patients(id) on delete cascade` — *(0002)*

### patients

أُنشئ في `0002` · عُدِّل في: `0050`، `0066`، `0069`، `0146`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `file_number` | `bigserial` |  |  |  |
| `file_date` | `timestamptz` | ✔ | `now()` |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `birth_date` | `date` |  |  |  |
| `gender` | `text` |  |  |  |
| `nationality_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `profession_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `marital_status` | `text` |  |  |  |
| `city_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `address` | `text` |  |  |  |
| `district` | `text` |  |  |  |
| `street` | `text` |  |  |  |
| `building_number` | `text` |  |  |  |
| `postal_code` | `text` |  |  |  |
| `id_type` | `text` |  |  |  |
| `id_number` | `text` |  |  |  |
| `mobile_number` | `text` |  |  |  |
| `emergency_number` | `text` |  |  |  |
| `phone_1` | `text` |  |  |  |
| `phone_2` | `text` |  |  |  |
| `work_entity_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `tax_number` | `text` |  |  |  |
| `is_tax_registered` | `boolean` | ✔ | `false` |  |
| `customer_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `source_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `source_details` | `text` |  |  |  |
| `treating_doctor_id` | `uuid` |  |  | `doctors(id)` |
| `participating_doctor_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `children_count` | `int` |  |  |  |
| `educational_qualification_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `email_1` | `text` |  |  |  |
| `email_2` | `text` |  |  |  |
| `father_whatsapp` | `text` |  |  |  |
| `facebook` | `text` |  |  |  |
| `website` | `text` |  |  |  |
| `default_discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `general_note` | `text` |  |  |  |
| `insurance_company_name` | `text` |  |  |  |
| `insurance_policy_number` | `text` |  |  |  |
| `insurance_policy_category` | `text` |  |  |  |
| `insurance_membership_number` | `text` |  |  |  |
| `insurance_relation` | `text` |  |  |  |
| `insurance_membership_expiry` | `date` |  |  |  |
| `file_type_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `passport_number` | `text` |  |  |  |
| `father_id_number` | `text` |  |  |  |
| `mother_id_number` | `text` |  |  |  |
| `blood_type` | `text` |  |  |  |
| `other_id_type` | `text` |  |  |  |
| `other_id_number` | `text` |  |  |  |
| `guarantor_name` | `text` |  |  |  |
| `guarantor_number` | `text` |  |  |  |
| `guarantor_details` | `text` |  |  |  |
| `nearest_person_name` | `text` |  |  |  |
| `nearest_person_number` | `text` |  |  |  |
| `gln_number` | `text` |  |  |  |
| `local_order_weight_kg` | `numeric(6,2)` |  |  |  |
| `block_invoices` | `boolean` | ✔ | `false` |  |
| `block_invoices_reason` | `text` |  |  |  |
| `block_appointments` | `boolean` | ✔ | `false` |  |
| `block_appointments_reason` | `text` |  |  |  |
| `block_sms` | `boolean` | ✔ | `false` |  |
| `block_sms_reason` | `text` |  |  |  |
| `block_file` | `boolean` | ✔ | `false` |  |
| `block_file_reason` | `text` |  |  |  |
| `e_signature_enabled` | `boolean` | ✔ | `false` |  |
| `electronic_signature_url` | `text` |  |  |  |
| `is_newborn` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `merged_into_id` | `uuid` |  |  | `patients(id)` |
| `merged_at` | `timestamptz` |  |  |  |
| `merged_by` | `uuid` |  |  | `auth.users(id)` |
| `merge_reason` | `text` |  |  |  |
| `preferred_language` | `text` | ✔ | `'ar'` |  |
| `birth_date_is_estimated` | `boolean` | ✔ | `false` |  |

**قيود:**

- `unique (organization_id, file_number)` — *(0002)*
- `constraint patients_organization_id_id_key unique (organization_id, id)` — *(0050)*
- `constraint patients_preferred_language_check check (preferred_language in ('ar', 'en'))` — *(0069)*

**فهارس:**

- `idx_patients_branch_fk` على (`branch_id`) — *(0124)*
- `idx_patients_merged` على (`merged_into_id`) — *(0146)*
- `idx_patients_mobile` على (`mobile_number`) — *(0002)*
- `idx_patients_name` على (`to_tsvector('simple', coalesce(name_ar,'') || ' ' || coalesce(name_en,''))`) — *(0002)*
- `idx_patients_org` على (`organization_id`) — *(0002)*
- `patients_org_id_number_uniq` — فريد على (`organization_id, btrim(id_number)`) — *(0146)*

### payroll_item_details

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `payroll_run_item_id` | `uuid` | ✔ |  | `payroll_run_items(id)` |
| `component_id` | `uuid` |  |  | `salary_components(id)` |
| `detail_kind` | `text` | ✔ |  |  |
| `label` | `text` | ✔ |  |  |
| `amount` | `numeric(14,2)` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_payroll_details_item` على (`payroll_run_item_id`) — *(0100)*

### payroll_run_items

أُنشئ في `0100` · عُدِّل في: `0145`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `payroll_run_id` | `uuid` | ✔ |  | `payroll_runs(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `basic_salary` | `numeric(14,2)` | ✔ | `0` |  |
| `allowances_total` | `numeric(14,2)` | ✔ | `0` |  |
| `overtime_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `gross_salary` | `numeric(14,2)` | ✔ | `0` |  |
| `absence_deduction` | `numeric(14,2)` | ✔ | `0` |  |
| `late_deduction` | `numeric(14,2)` | ✔ | `0` |  |
| `loan_deduction` | `numeric(14,2)` | ✔ | `0` |  |
| `other_deductions` | `numeric(14,2)` | ✔ | `0` |  |
| `deductions_total` | `numeric(14,2)` | ✔ | `0` |  |
| `net_salary` | `numeric(14,2)` | ✔ | `0` |  |
| `worked_days` | `numeric(6,2)` |  |  |  |
| `absent_days` | `numeric(6,2)` |  |  |  |
| `late_minutes` | `integer` | ✔ | `0` |  |
| `overtime_minutes` | `integer` | ✔ | `0` |  |
| `bank_iban` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `paid_voucher_id` | `uuid` |  |  |  |
| `paid_at` | `timestamptz` |  |  |  |

**قيود:**

- `constraint payroll_run_items_paid_voucher_fk foreign key (paid_voucher_id) references financial_vouchers(id) on delete set null` — *(0145)*

**فهارس:**

- `idx_payroll_items_run` على (`payroll_run_id`) — *(0100)*

### payroll_runs

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `run_number` | `text` |  |  |  |
| `period_month` | `date` | ✔ |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `employee_count` | `integer` | ✔ | `0` |  |
| `total_gross` | `numeric(14,2)` | ✔ | `0` |  |
| `total_deductions` | `numeric(14,2)` | ✔ | `0` |  |
| `total_net` | `numeric(14,2)` | ✔ | `0` |  |
| `calculated_at` | `timestamptz` |  |  |  |
| `calculated_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `paid_at` | `timestamptz` |  |  |  |
| `paid_by` | `uuid` |  |  | `auth.users(id)` |
| `journal_entry_id` | `uuid` |  |  | `journal_entries(id)` |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancelled_by` | `uuid` |  |  | `auth.users(id)` |
| `cancel_reason` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_payroll_run_period` — فريد على (`organization_id, period_month, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`) — *(0100)*

### performance_review_criteria

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `weight` | `numeric(5,2)` | ✔ | `1` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_perf_criteria_org` على (`organization_id`) — *(0023)*

### performance_review_cycles

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `period_start` | `date` | ✔ |  |  |
| `period_end` | `date` | ✔ |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `check (period_end >= period_start)` — *(0023)*

**فهارس:**

- `idx_perf_cycles_org` على (`organization_id`) — *(0023)*

### performance_review_scores

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `review_id` | `uuid` | ✔ |  | `performance_reviews(id)` |
| `criterion_id` | `uuid` | ✔ |  | `performance_review_criteria(id)` |
| `score` | `smallint` | ✔ |  |  |
| `note` | `text` |  |  |  |

**قيود:**

- `unique (review_id, criterion_id)` — *(0023)*

**فهارس:**

- `idx_perf_scores_review` على (`review_id`) — *(0023)*

### performance_reviews

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `cycle_id` | `uuid` | ✔ |  | `performance_review_cycles(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `reviewer_user_id` | `uuid` |  |  | `auth.users(id)` |
| `overall_score` | `numeric(5,2)` | ✔ | `0` |  |
| `comments` | `text` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (cycle_id, employee_id)` — *(0023)*

**فهارس:**

- `idx_perf_reviews_cycle` على (`cycle_id`) — *(0023)*
- `idx_perf_reviews_employee` على (`employee_id`) — *(0023)*

### permission_catalog

أُنشئ في `0062`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `permission_key` 🔑 | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `module_key` | `text` | ✔ |  |  |
| `description_ar` | `text` |  |  |  |
| `display_order` | `integer` | ✔ | `0` |  |

### prescription_items

أُنشئ في `0015` · عُدِّل في: `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `prescription_id` | `uuid` | ✔ |  | `prescriptions(id)` |
| `drug_item_id` | `uuid` | ✔ |  | `items(id)` |
| `dosage_instructions` | `text` |  |  |  |
| `frequency` | `text` |  |  |  |
| `duration_days` | `int` |  |  |  |
| `route` | `text` |  | `'oral'` |  |
| `quantity_prescribed` | `numeric(12,2)` | ✔ | `1` |  |
| `dispensed_quantity` | `numeric(12,2)` | ✔ | `0` |  |
| `is_substitutable` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |

**قيود:**

- `constraint prescription_items_drug_tenant_fk foreign key (organization_id, drug_item_id) references items(organization_id, id) not valid` — *(0088)*
- `constraint prescription_items_dispensed_check check (dispensed_quantity >= 0 and dispensed_quantity <= quantity_prescribed) not valid` — *(0088)*

**فهارس:**

- `idx_prescription_items_drug_fk` على (`drug_item_id`) — *(0124)*
- `idx_prescription_items_prescription` على (`prescription_id`) — *(0015)*

### prescriptions

أُنشئ في `0015` · عُدِّل في: `0042`، `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `status` | `text` | ✔ | `'issued'` |  |
| `issued_at` | `timestamptz` | ✔ | `now()` |  |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `insurance_company_name` | `text` |  |  |  |
| `insurance_policy_number` | `text` |  |  |  |
| `is_billed` | `boolean` | ✔ | `false` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `sent_to_pharmacy_at` | `timestamptz` |  |  |  |
| `dispensed_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancelled_by` | `uuid` |  |  | `auth.users(id)` |
| `cancel_reason` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint prescriptions_status_check check ( status in ('draft','issued','sent_to_pharmacy','partially_dispensed','dispensed','cancelled') )` — *(0088)*
- `constraint prescriptions_org_id_key unique (organization_id, id)` — *(0088)*

**فهارس:**

- `idx_prescriptions_branch_fk` على (`branch_id`) — *(0124)*
- `idx_prescriptions_doctor_fk` على (`doctor_id`) — *(0124)*
- `idx_prescriptions_org` على (`organization_id`) — *(0015)*
- `idx_prescriptions_patient` على (`patient_id`) — *(0015)*
- `idx_prescriptions_queue` على (`organization_id, status, issued_at desc`) — *(0088)*
- `idx_prescriptions_status` على (`organization_id, status`) — *(0015)*
- `idx_prescriptions_visit` على (`visit_id`) — *(0056)*
- `idx_prescriptions_warehouse_fk` على (`warehouse_id`) — *(0124)*

### price_list_items

أُنشئ في `0072`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `price_list_id` | `uuid` | ✔ |  | `price_lists(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `price` | `numeric(14,2)` | ✔ |  |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint price_list_items_period_check check ( effective_to is null or effective_to >= effective_from )` — *(0072)*

**فهارس:**

- `idx_price_list_items_item` على (`item_id`) — *(0072)*
- `idx_price_list_items_lookup` على (`price_list_id, item_id, effective_from desc`) — *(0072)*
- `idx_price_list_items_org_item` على (`organization_id, item_id`) — *(0078)*
- `idx_price_list_items_org_list` على (`organization_id, price_list_id`) — *(0078)*
- `uq_price_list_items_open` — فريد على (`price_list_id, item_id`) — *(0072)*

### price_lists

أُنشئ في `0072`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name` | `text` | ✔ |  |  |
| `list_kind` | `text` | ✔ | `'base'` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `insurance_company_id` | `uuid` |  |  | `insurance_companies(id)` |
| `external_client_id` | `uuid` |  |  | `external_clients(id)` |
| `priority` | `integer` | ✔ | `0` |  |
| `effective_from` | `date` | ✔ | `current_date` |  |
| `effective_to` | `date` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint price_lists_kind_check check ( list_kind in ('base', 'branch', 'insurance', 'corporate') )` — *(0072)*
- `constraint price_lists_period_check check ( effective_to is null or effective_to >= effective_from )` — *(0072)*
- `constraint price_lists_scope_check check ( (list_kind = 'base' and branch_id is null and insurance_company_id is null and external_client_id is null) or (list_kind = 'branch' and branch_id is not null and insurance_company_id is null and external_client_id is null) or (list_kind = 'insurance' and insurance_company_id is not null and external_client_id is null) or (list_kind = 'corporate' and external_client_id is not null and insurance_company_id is null) )` — *(0072)*

**فهارس:**

- `idx_price_lists_branch` على (`branch_id`) — *(0072)*
- `idx_price_lists_insurance` على (`insurance_company_id`) — *(0072)*
- `idx_price_lists_org` على (`organization_id, is_active`) — *(0072)*
- `idx_price_lists_org_branch_fk` على (`organization_id, branch_id`) — *(0078)*
- `idx_price_lists_org_client_fk` على (`organization_id, external_client_id`) — *(0078)*
- `idx_price_lists_org_company_fk` على (`organization_id, insurance_company_id`) — *(0078)*

### print_settings

أُنشئ في `0010`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `invoice_paper_size` | `text` | ✔ | `'a4'` |  |
| `receipt_paper_size` | `text` | ✔ | `'thermal_80mm'` |  |
| `report_paper_size` | `text` | ✔ | `'a4'` |  |
| `show_logo` | `boolean` | ✔ | `true` |  |
| `footer_note` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### procedure_codes

أُنشئ في `0086`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `code_system` | `text` | ✔ | `'cpt'` |  |
| `code` | `text` | ✔ |  |  |
| `name_ar` | `text` |  |  |  |
| `name_en` | `text` | ✔ |  |  |
| `category` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint procedure_codes_system_check check ( code_system in ('cpt','hcpcs','icd10pcs','snomed','local','other') )` — *(0086)*

**فهارس:**

- `idx_procedure_codes_search` على (`code`) — *(0086)*
- `uq_procedure_codes` — فريد على (`code_system, code`) — *(0086)*

### public_booking_rate_limits

أُنشئ في `0128`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `booking_key` | `text` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_public_booking_rate_limits_key_time` على (`booking_key, created_at desc`) — *(0128)*

### public_booking_settings

أُنشئ في `0128`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `public_slug` | `text` | ✔ |  |  |
| `site_name` | `text` | ✔ |  |  |
| `branch_id` | `uuid` | ✔ |  | `branches(id)` |
| `hero_title` | `text` | ✔ |  |  |
| `hero_subtitle` | `text` |  |  |  |
| `phone` | `text` |  |  |  |
| `address` | `text` |  |  |  |
| `is_enabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint public_booking_slug_format check (public_slug ~ '^[a-z0-9][a-z0-9-]{2,62}$')` — *(0128)*

**فهارس:**

- `idx_public_booking_settings_branch` على (`branch_id`) — *(0129)*

### purchase_approval_rules

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `min_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `max_amount` | `numeric(14,2)` |  |  |  |
| `required_role_key` | `text` | ✔ |  |  |
| `approval_level` | `integer` | ✔ | `1` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint purchase_approval_rules_range_check check (max_amount is null or max_amount > min_amount)` — *(0097)*

### purchase_expenses

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `purchase_invoice_id` | `uuid` |  |  | `purchase_invoices(id)` |
| `goods_receipt_id` | `uuid` |  |  | `goods_receipts(id)` |
| `expense_type` | `text` | ✔ |  |  |
| `amount` | `numeric(14,2)` | ✔ |  |  |
| `allocation_method` | `text` | ✔ | `'by_value'` |  |
| `distributor_id` | `uuid` |  |  | `distributors(id)` |
| `reference_number` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `is_allocated` | `boolean` | ✔ | `false` |  |
| `allocated_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

### purchase_invoice_items

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `purchase_invoice_id` | `uuid` | ✔ |  | `purchase_invoices(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `source_barcode` | `text` |  |  |  |
| `purchase_price` | `numeric(12,2)` | ✔ | `0` |  |
| `sale_price` | `numeric(12,2)` |  |  |  |
| `update_item_sale_price` | `boolean` | ✔ | `false` |  |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `free_qty` | `numeric(12,2)` | ✔ | `0` |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `line_discount_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `vat_rate` | `numeric(5,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `expiry_date` | `date` |  |  |  |
| `lot_number` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_purchase_invoice_items_invoice` على (`purchase_invoice_id`) — *(0003)*

### purchase_invoices

أُنشئ في `0003` · عُدِّل في: `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `distributor_id` | `uuid` |  |  | `distributors(id)` |
| `invoice_number` | `text` |  |  |  |
| `invoice_date` | `date` | ✔ | `current_date` |  |
| `source_document` | `text` |  |  |  |
| `source_number` | `text` |  |  |  |
| `supplier_tax_number` | `text` |  |  |  |
| `payment_term` | `text` | ✔ | `'cash'` |  |
| `general_discount_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `vat_enabled` | `boolean` | ✔ | `true` |  |
| `subtotal_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `purchase_order_id` | `uuid` |  |  | `purchase_orders(id)` |
| `goods_receipt_id` | `uuid` |  |  | `goods_receipts(id)` |
| `due_date` | `date` |  |  |  |
| `status` | `text` | ✔ | `'unpaid'` |  |
| `paid_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `expenses_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint purchase_invoices_status_check check (status in ('unpaid','partial','paid','cancelled'))` — *(0097)*

**فهارس:**

- `idx_purchase_invoices_org_date` على (`organization_id, invoice_date desc`) — *(0003)*

### purchase_order_items

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `purchase_order_id` | `uuid` | ✔ |  | `purchase_orders(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty_ordered` | `numeric(14,3)` | ✔ |  |  |
| `qty_received` | `numeric(14,3)` | ✔ | `0` |  |
| `qty_returned` | `numeric(14,3)` | ✔ | `0` |  |
| `unit_price` | `numeric(14,2)` | ✔ | `0` |  |
| `discount_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `vat_rate` | `numeric(6,3)` | ✔ | `0` |  |
| `vat_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `request_item_id` | `uuid` |  |  | `purchase_request_items(id)` |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_poi_order` على (`purchase_order_id`) — *(0097)*

### purchase_orders

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `distributor_id` | `uuid` | ✔ |  | `distributors(id)` |
| `purchase_request_id` | `uuid` |  |  | `purchase_requests(id)` |
| `order_number` | `text` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `order_date` | `date` | ✔ | `current_date` |  |
| `expected_date` | `date` |  |  |  |
| `payment_terms_days` | `integer` |  |  |  |
| `subtotal_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `note` | `text` |  |  |  |
| `sent_at` | `timestamptz` |  |  |  |
| `closed_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_po_distributor` على (`organization_id, distributor_id, order_date desc`) — *(0097)*
- `idx_po_org_status` على (`organization_id, status, order_date desc`) — *(0097)*

### purchase_request_items

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `purchase_request_id` | `uuid` | ✔ |  | `purchase_requests(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty_requested` | `numeric(14,3)` | ✔ |  |  |
| `qty_approved` | `numeric(14,3)` |  |  |  |
| `estimated_price` | `numeric(14,2)` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_pri_request` على (`purchase_request_id`) — *(0097)*

### purchase_requests

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `request_number` | `text` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `needed_by` | `date` |  |  |  |
| `justification` | `text` |  |  |  |
| `estimated_total` | `numeric(14,2)` | ✔ | `0` |  |
| `requested_by` | `uuid` |  |  | `auth.users(id)` |
| `submitted_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `approval_note` | `text` |  |  |  |
| `rejected_reason` | `text` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**فهارس:**

- `idx_pr_org_status` على (`organization_id, status, created_at desc`) — *(0097)*

### purchase_return_items

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `purchase_return_id` | `uuid` | ✔ |  | `purchase_returns(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `qty_returned` | `numeric(14,3)` | ✔ |  |  |
| `unit_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `vat_rate` | `numeric(6,3)` | ✔ | `0` |  |
| `vat_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `receipt_item_id` | `uuid` |  |  | `goods_receipt_items(id)` |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### purchase_returns

أُنشئ في `0097`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `distributor_id` | `uuid` | ✔ |  | `distributors(id)` |
| `purchase_invoice_id` | `uuid` |  |  | `purchase_invoices(id)` |
| `goods_receipt_id` | `uuid` |  |  | `goods_receipts(id)` |
| `return_number` | `text` |  |  |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `reason` | `text` | ✔ |  |  |
| `subtotal_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `returned_at` | `timestamptz` | ✔ | `now()` |  |
| `posted_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### quality_incidents

أُنشئ في `0106`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `incident_number` | `bigint` |  |  |  |
| `category` | `text` | ✔ |  |  |
| `severity` | `text` | ✔ | `'minor'` |  |
| `occurred_at` | `timestamptz` | ✔ | `now()` |  |
| `location_note` | `text` |  |  |  |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `is_anonymous` | `boolean` | ✔ | `false` |  |
| `reported_by` | `uuid` |  |  | `auth.users(id)` |
| `reported_at` | `timestamptz` | ✔ | `now()` |  |
| `description` | `text` | ✔ |  |  |
| `immediate_action` | `text` |  |  |  |
| `status` | `text` | ✔ | `'open'` |  |
| `root_cause` | `text` |  |  |  |
| `corrective_action` | `text` |  |  |  |
| `preventive_action` | `text` |  |  |  |
| `closed_by` | `uuid` |  |  | `auth.users(id)` |
| `closed_at` | `timestamptz` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_quality_incidents_open` على (`organization_id, status, occurred_at desc`) — *(0106)*

### quality_indicators

أُنشئ في `0106`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `metric_key` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `domain` | `text` | ✔ | `'clinical'` |  |
| `unit` | `text` | ✔ | `'percent'` |  |
| `higher_is_better` | `boolean` | ✔ | `false` |  |
| `target_value` | `numeric(14,2)` |  |  |  |
| `is_manual` | `boolean` | ✔ | `false` |  |
| `manual_source` | `text` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_quality_indicator_key` — فريد على (`organization_id, metric_key`) — *(0106)*

### quality_measurements

أُنشئ في `0106`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `indicator_id` | `uuid` | ✔ |  | `quality_indicators(id)` |
| `period_start` | `date` | ✔ |  |  |
| `period_end` | `date` | ✔ |  |  |
| `value` | `numeric(14,2)` |  |  |  |
| `numerator` | `numeric(14,2)` |  |  |  |
| `denominator` | `numeric(14,2)` |  |  |  |
| `target_value` | `numeric(14,2)` |  |  |  |
| `is_manual` | `boolean` | ✔ | `false` |  |
| `note` | `text` |  |  |  |
| `measured_at` | `timestamptz` | ✔ | `now()` |  |
| `measured_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint quality_period_order check (period_end >= period_start)` — *(0106)*

**فهارس:**

- `uq_quality_measurement_period` — فريد على (`indicator_id, period_start, period_end`) — *(0106)*

### queue_display_screens

أُنشئ في `0049`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `name` | `text` | ✔ |  |  |
| `clinic_ids` | `uuid[]` | ✔ | `'{}'` |  |
| `show_doctor_name` | `boolean` | ✔ | `true` |  |
| `show_ticker` | `boolean` | ✔ | `true` |  |
| `refresh_seconds` | `integer` | ✔ | `10` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, name)` — *(0049)*

**فهارس:**

- `idx_queue_display_screens_org` على (`organization_id, is_active`) — *(0049)*

### quick_invoice_group_items

أُنشئ في `0042`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `group_id` | `uuid` | ✔ |  | `quick_invoice_groups(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `sort_order` | `int` | ✔ | `0` |  |

**قيود:**

- `unique (group_id, item_id)` — *(0042)*

**فهارس:**

- `idx_quick_invoice_group_items_group` على (`group_id`) — *(0042)*

### quick_invoice_groups

أُنشئ في `0042`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `color` | `text` |  |  |  |
| `sort_order` | `int` | ✔ | `0` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_quick_invoice_groups_org` على (`organization_id`) — *(0042)*

### radiology_exam_categories

أُنشئ في `0014`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `sort_order` | `int` | ✔ | `0` |  |

### radiology_exams

أُنشئ في `0014` · عُدِّل في: `0084`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `category_id` | `uuid` |  |  | `radiology_exam_categories(id)` |
| `billing_item_id` | `uuid` | ✔ |  | `items(id)` |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `modality` | `text` | ✔ | `'xray'` |  |
| `body_part` | `text` |  |  |  |
| `requires_contrast` | `boolean` | ✔ | `false` |  |
| `preparation_instructions` | `text` |  |  |  |
| `estimated_duration_minutes` | `int` |  |  |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `laterality_required` | `boolean` | ✔ | `false` |  |
| `pregnancy_check_required` | `boolean` | ✔ | `false` |  |
| `contrast_type` | `text` |  |  |  |
| `radiation_dose_msv` | `numeric(8,3)` |  |  |  |
| `report_template_id` | `uuid` |  |  |  |
| `department_id` | `uuid` |  |  | `departments(id)` |
| `requires_approval` | `boolean` | ✔ | `false` |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint radiology_exams_item_tenant_fk foreign key (organization_id, billing_item_id) references items (organization_id, id) not valid` — *(0084)*

**فهارس:**

- `idx_radiology_exams_billing_item_fk` على (`billing_item_id`) — *(0124)*
- `idx_radiology_exams_category_fk` على (`category_id`) — *(0124)*
- `idx_radiology_exams_org` على (`organization_id`) — *(0014)*

### radiology_images

أُنشئ في `0014` · عُدِّل في: `0138`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `radiology_order_item_id` | `uuid` | ✔ |  | `radiology_order_items(id)` |
| `file_url` | `text` | ✔ |  |  |
| `file_name` | `text` |  |  |  |
| `uploaded_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `note` | `text` |  |  |  |
| `mime_type` | `text` |  |  |  |
| `size_bytes` | `bigint` |  |  |  |
| `taken_at` | `timestamptz` |  |  |  |

**فهارس:**

- `idx_radiology_images_org` على (`organization_id, created_at desc`) — *(0138)*

### radiology_order_items

أُنشئ في `0014`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `radiology_order_id` | `uuid` | ✔ |  | `radiology_orders(id)` |
| `radiology_exam_id` | `uuid` | ✔ |  | `radiology_exams(id)` |
| `performed_by` | `uuid` |  |  | `auth.users(id)` |
| `performed_at` | `timestamptz` |  |  |  |
| `findings` | `text` |  |  |  |
| `impression` | `text` |  |  |  |
| `is_urgent_finding` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_radiology_order_items_exam_fk` على (`radiology_exam_id`) — *(0124)*
- `idx_radiology_order_items_order` على (`radiology_order_id`) — *(0014)*

### radiology_orders

أُنشئ في `0014` · عُدِّل في: `0084`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `ordering_doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `sales_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `status` | `text` | ✔ | `'ordered'` |  |
| `priority` | `text` | ✔ | `'routine'` |  |
| `clinical_indication` | `text` |  |  |  |
| `scheduled_at` | `timestamptz` |  |  |  |
| `ordered_at` | `timestamptz` | ✔ | `now()` |  |
| `completed_at` | `timestamptz` |  |  |  |
| `reported_at` | `timestamptz` |  |  |  |
| `reported_by` | `uuid` |  |  | `auth.users(id)` |
| `notes` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `resource_id` | `uuid` |  |  | `resources(id)` |
| `booking_id` | `uuid` |  |  | `resource_bookings(id)` |
| `laterality` | `text` |  |  |  |
| `pregnancy_confirmed_not` | `boolean` |  |  |  |
| `pregnancy_checked_by` | `uuid` |  |  | `auth.users(id)` |
| `contrast_used` | `boolean` | ✔ | `false` |  |
| `arrived_at` | `timestamptz` |  |  |  |
| `started_at` | `timestamptz` |  |  |  |
| `images_ready_at` | `timestamptz` |  |  |  |
| `verified_at` | `timestamptz` |  |  |  |
| `verified_by` | `uuid` |  |  | `auth.users(id)` |
| `delivered_at` | `timestamptz` |  |  |  |
| `delivered_by` | `uuid` |  |  | `auth.users(id)` |
| `performed_by` | `uuid` |  |  | `auth.users(id)` |
| `cancel_reason` | `text` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint radiology_orders_laterality_check check (laterality is null or laterality in ('left','right','bilateral','not_applicable'))` — *(0084)*
- `constraint radiology_orders_status_check check ( status in ('draft','ordered','scheduled','arrived','in_progress','images_ready', 'reporting','verified','delivered','rejected','cancelled') )` — *(0084)*

**فهارس:**

- `idx_radiology_orders_branch_fk` على (`branch_id`) — *(0124)*
- `idx_radiology_orders_clinic_fk` على (`clinic_id`) — *(0124)*
- `idx_radiology_orders_doctor_fk` على (`ordering_doctor_id`) — *(0124)*
- `idx_radiology_orders_invoice_fk` على (`sales_invoice_id`) — *(0124)*
- `idx_radiology_orders_org` على (`organization_id`) — *(0014)*
- `idx_radiology_orders_patient` على (`patient_id`) — *(0014)*
- `idx_radiology_orders_status` على (`organization_id, status`) — *(0014)*
- `idx_radiology_orders_visit` على (`visit_id`) — *(0056)*

### reception_settings

أُنشئ في `0065`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `waiting_warning_minutes` | `integer` | ✔ | `20` |  |
| `waiting_critical_minutes` | `integer` | ✔ | `40` |  |
| `print_queue_ticket` | `boolean` | ✔ | `true` |  |
| `ticket_show_qr` | `boolean` | ✔ | `false` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint reception_settings_thresholds_check check (waiting_critical_minutes > waiting_warning_minutes)` — *(0065)*

### resource_bookings

أُنشئ في `0084`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `resource_id` | `uuid` | ✔ |  | `resources(id)` |
| `starts_at` | `timestamptz` | ✔ |  |  |
| `ends_at` | `timestamptz` | ✔ |  |  |
| `booking_type` | `text` | ✔ | `'appointment'` |  |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `radiology_order_id` | `uuid` |  |  | `radiology_orders(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint resource_bookings_time_check check (ends_at > starts_at)` — *(0084)*
- `constraint resource_bookings_type_check check ( booking_type in ('appointment','radiology','procedure','maintenance','blocked') )` — *(0084)*
- `constraint resource_bookings_no_overlap exclude using gist ( resource_id with =, tstzrange(starts_at, ends_at, '[)') with && )` — *(0084)*

**فهارس:**

- `idx_resource_bookings_resource` على (`resource_id, starts_at`) — *(0084)*

### resources

أُنشئ في `0073`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `resource_type` | `text` | ✔ |  |  |
| `code` | `text` |  |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `capacity` | `integer` | ✔ | `1` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint resources_type_check check ( resource_type in ('room','chair','bed','device','equipment','other') )` — *(0073)*
- `constraint resources_capacity_check check (capacity > 0)` — *(0073)*

**فهارس:**

- `idx_resources_org_branch` على (`organization_id, branch_id`) — *(0073)*
- `idx_resources_org_clinic` على (`organization_id, clinic_id`) — *(0078)*
- `uq_resources_org_code` — فريد على (`organization_id, code`) — *(0073)*

### role_default_permissions

أُنشئ في `0062`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `role_key` | `text` | ✔ |  |  |
| `permission_key` | `text` | ✔ |  | `permission_catalog(permission_key)` |

**قيود:**

- `primary key (role_key, permission_key)` — *(0062)*

### salary_components

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `code` | `text` | ✔ |  |  |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `component_type` | `text` | ✔ |  |  |
| `calculation` | `text` | ✔ | `'fixed'` |  |
| `default_value` | `numeric(14,4)` | ✔ | `0` |  |
| `is_taxable` | `boolean` | ✔ | `false` |  |
| `affects_gosi` | `boolean` | ✔ | `false` |  |
| `gl_account_id` | `uuid` |  |  | `chart_of_accounts(id)` |
| `is_active` | `boolean` | ✔ | `true` |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_salary_component_code` — فريد على (`organization_id, code`) — *(0100)*

### sales_invoice_items

أُنشئ في `0003` · عُدِّل في: `0050`، `0053`، `0089`، `0091`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `invoice_id` | `uuid` | ✔ |  | `sales_invoices(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `agreement_item_id` | `uuid` |  |  | `treatment_agreement_items(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `source_barcode` | `text` |  |  |  |
| `description` | `text` |  |  |  |
| `line_type` | `text` | ✔ | `'normal'` |  |
| `price` | `numeric(12,2)` | ✔ | `0` |  |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `discount_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `vat_rate` | `numeric(5,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `exemption_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `visit_service_id` | `uuid` |  |  | `patient_visit_services(id)` |
| `price_source_kind` | `text` |  |  |  |
| `price_source_list_id` | `uuid` |  |  | `price_lists(id)` |
| `contract_id` | `uuid` |  |  | `insurance_contracts(id)` |
| `list_price` | `numeric` |  |  |  |
| `covered_amount` | `numeric` |  |  |  |
| `patient_share` | `numeric` |  |  |  |
| `insurer_share` | `numeric` |  |  |  |
| `preauthorization_id` | `uuid` |  |  | `insurance_preauthorizations(id)` |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `source_type` | `text` |  |  |  |
| `source_id` | `uuid` |  |  |  |
| `item_name_snapshot` | `text` |  |  |  |
| `unit_snapshot` | `text` |  |  |  |
| `vat_category` | `text` | ✔ | `'standard'` |  |
| `exemption_reason` | `text` |  |  |  |
| `taxable_base` | `numeric` |  |  |  |

**قيود:**

- `constraint sii_source_type_check check ( source_type is null or source_type in ('visit_service','lab_order','radiology_order','dispensing','package','manual') )` — *(0091)*
- `constraint sii_vat_category_check check ( vat_category in ('standard','zero_rated','exempt','out_of_scope') )` — *(0091)*
- `constraint sii_exemption_reason_check check ( vat_category in ('standard','out_of_scope') or exemption_reason is not null ) not valid` — *(0091)*

**فهارس:**

- `idx_invoice_items_visit_service` على (`visit_service_id`) — *(0053)*
- `idx_sales_invoice_items_agreement` على (`agreement_item_id`) — *(0003)*
- `idx_sales_invoice_items_invoice` على (`invoice_id`) — *(0003)*
- `idx_sales_invoice_items_item_fk` على (`item_id`) — *(0124)*
- `idx_sales_invoice_items_patient_fk` على (`patient_id`) — *(0124)*
- `idx_sii_visit` على (`visit_id`) — *(0091)*
- `uq_invoice_item_visit_service` — فريد على (`visit_service_id`) — *(0053)*
- `uq_invoice_source_once` — فريد على (`source_type, source_id`) — *(0091)*

### sales_invoices

أُنشئ في `0003` · عُدِّل في: `0010`، `0050`، `0052`، `0091`، `0092`، `0147`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `appointment_id` | `uuid` |  |  | `appointments(id)` |
| `agreement_id` | `uuid` |  |  | `treatment_agreements(id)` |
| `original_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `external_customer_name` | `text` |  |  |  |
| `external_customer_mobile` | `text` |  |  |  |
| `id_number` | `text` |  |  |  |
| `invoice_number` | `bigserial` |  |  |  |
| `invoice_type` | `text` | ✔ | `'sale'` |  |
| `is_temporary` | `boolean` | ✔ | `false` |  |
| `is_b2b` | `boolean` | ✔ | `false` |  |
| `is_favorite` | `boolean` | ✔ | `false` |  |
| `status` | `text` | ✔ | `'unpaid'` |  |
| `zatca_invoice_number` | `text` |  |  |  |
| `zatca_qr` | `text` |  |  |  |
| `nationality_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `source_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `classification_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `is_insurance_invoice` | `boolean` | ✔ | `false` |  |
| `insurance_company_name` | `text` |  |  |  |
| `insurance_policy_number` | `text` |  |  |  |
| `insurance_class_number` | `text` |  |  |  |
| `insurance_membership_number` | `text` |  |  |  |
| `insurance_copay_percent` | `numeric(5,2)` |  |  |  |
| `insurance_max_amount` | `numeric(12,2)` |  |  |  |
| `insurance_consultation_limit` | `numeric(12,2)` |  |  |  |
| `insurance_approval_number` | `text` |  |  |  |
| `insurance_eligibility` | `text` |  |  |  |
| `insurance_auto_calc_copay` | `boolean` | ✔ | `false` |  |
| `subtotal_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `discount_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `offer_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `exemption_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `paid_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `remaining_amount` | `numeric(12,2)` |  |  |  |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `applied_offer_id` | `uuid` |  |  | `offers(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `insurance_share_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `patient_share_amount` | `numeric(14,2)` | ✔ | `0` |  |
| `issued_at` | `timestamptz` |  |  |  |
| `issued_by` | `uuid` |  |  | `auth.users(id)` |
| `voided_at` | `timestamptz` |  |  |  |
| `voided_by` | `uuid` |  |  | `auth.users(id)` |
| `void_reason` | `text` |  |  |  |
| `refunded_amount` | `numeric` | ✔ | `0` |  |
| `discount_reason` | `text` |  |  |  |
| `discount_by` | `uuid` |  |  | `auth.users(id)` |
| `cash_shift_id` | `uuid` |  |  |  |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |
| `document_type` | `text` | ✔ | `'simplified'` |  |
| `note_type` | `text` |  |  |  |
| `note_reason` | `text` |  |  |  |
| `corrects_invoice_id` | `uuid` |  |  | `sales_invoices(id)` |
| `seller_snapshot` | `jsonb` |  |  |  |
| `buyer_snapshot` | `jsonb` |  |  |  |
| `document_number` | `bigint` |  |  |  |
| `document_prefix` | `text` |  |  |  |
| `business_day_id` | `uuid` |  |  | `business_days(id)` |

**قيود:**

- `check (patient_id is not null or external_customer_name is not null)` — *(0003)*
- `constraint sales_invoices_patient_tenant_fk foreign key (organization_id, patient_id) references patients(organization_id, id) not valid` — *(0050)*
- `constraint sales_invoices_doctor_tenant_fk foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid` — *(0050)*
- `constraint sales_invoices_clinic_tenant_fk foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid` — *(0050)*
- `constraint sales_invoices_appointment_tenant_fk foreign key (organization_id, appointment_id) references appointments(organization_id, id) not valid` — *(0050)*
- `constraint sales_invoices_visit_tenant_fk foreign key (organization_id, visit_id) references patient_visits(organization_id, id) not valid` — *(0052)*
- `constraint sales_invoices_status_check check ( status in ('draft','unpaid','partial','paid','partially_refunded','refunded','void') )` — *(0091)*
- `constraint sales_invoices_document_type_check check ( document_type in ('standard','simplified','credit_note','debit_note') )` — *(0092)*
- `constraint sales_invoices_note_link_check check ( document_type not in ('credit_note','debit_note') or (corrects_invoice_id is not null and coalesce(btrim(note_reason), '') <> '') ) not valid` — *(0092)*

**فهارس:**

- `idx_invoices_corrects` على (`corrects_invoice_id`) — *(0092)*
- `idx_sales_invoices_appointment_fk` على (`appointment_id`) — *(0124)*
- `idx_sales_invoices_branch_fk` على (`branch_id`) — *(0124)*
- `idx_sales_invoices_business_day` على (`business_day_id`) — *(0147)*
- `idx_sales_invoices_clinic_fk` على (`clinic_id`) — *(0124)*
- `idx_sales_invoices_offer` على (`applied_offer_id`) — *(0010)*
- `idx_sales_invoices_org_appointment` على (`organization_id, appointment_id`) — *(0051)*
- `idx_sales_invoices_org_date` على (`organization_id, created_at desc`) — *(0003)*
- `idx_sales_invoices_org_visit_fk` على (`organization_id, visit_id`) — *(0124)*
- `idx_sales_invoices_patient` على (`patient_id`) — *(0003)*
- `idx_sales_invoices_status` على (`organization_id, status`) — *(0003)*
- `idx_sales_invoices_visit` على (`visit_id`) — *(0052)*

### shift_swap_requests

أُنشئ في `0100`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `requester_id` | `uuid` | ✔ |  | `employees(id)` |
| `target_employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `swap_date` | `date` | ✔ |  |  |
| `target_date` | `date` |  |  |  |
| `requester_shift_id` | `uuid` |  |  | `shift_templates(id)` |
| `target_shift_id` | `uuid` |  |  | `shift_templates(id)` |
| `status` | `text` | ✔ | `'pending'` |  |
| `reason` | `text` |  |  |  |
| `accepted_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `rejection_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint shift_swap_not_self check (requester_id <> target_employee_id)` — *(0100)*

### shift_templates

أُنشئ في `0019`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `start_time` | `time` | ✔ |  |  |
| `end_time` | `time` | ✔ |  |  |
| `break_minutes` | `integer` | ✔ | `0` |  |
| `grace_minutes` | `integer` | ✔ | `0` |  |
| `is_night_shift` | `boolean` | ✔ | `false` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_shift_templates_org` على (`organization_id`) — *(0019)*

### sms_credit_balance

أُنشئ في `0009`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `organization_id` 🔑 | `uuid` | ✔ |  | `organizations(id)` |
| `balance` | `int` | ✔ | `0` |  |
| `low_balance_alert_threshold` | `int` | ✔ | `50` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

### sms_credit_transactions

أُنشئ في `0009`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `bigint` | ✔ |  |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `transaction_type` | `text` | ✔ |  |  |
| `amount` | `int` | ✔ |  |  |
| `related_message_id` | `bigint` |  |  | `message_log(id)` |
| `note` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_sms_credit_tx_org` على (`organization_id, created_at desc`) — *(0009)*

### staff_requests

أُنشئ في `0138`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `request_type` | `text` | ✔ |  |  |
| `target_role` | `text` | ✔ | `'receptionist'` |  |
| `patient_id` | `uuid` |  |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `body` | `text` |  |  |  |
| `amount` | `numeric` |  |  |  |
| `priority` | `text` | ✔ | `'routine'` |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `requested_by` | `uuid` |  |  | `auth.users(id)` |
| `requested_at` | `timestamptz` | ✔ | `now()` |  |
| `resolved_by` | `uuid` |  |  | `auth.users(id)` |
| `resolved_at` | `timestamptz` |  |  |  |
| `resolution_note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_staff_requests_open` على (`organization_id, status, requested_at desc`) — *(0138)*
- `idx_staff_requests_patient` على (`patient_id, requested_at desc`) — *(0138)*

### stock_count_items

أُنشئ في `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `stock_count_id` | `uuid` | ✔ |  | `stock_counts(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `location_id` | `uuid` |  |  | `warehouse_locations(id)` |
| `system_qty` | `numeric(14,3)` | ✔ | `0` |  |
| `counted_qty` | `numeric(14,3)` |  |  |  |
| `variance_qty` | `numeric(14,3)` |  |  |  |
| `unit_cost` | `numeric(14,2)` | ✔ | `0` |  |
| `variance_reason` | `text` |  |  |  |
| `counted_at` | `timestamptz` |  |  |  |
| `counted_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_stock_count_items_count` على (`stock_count_id`) — *(0098)*

### stock_counts

أُنشئ في `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `count_number` | `text` |  |  |  |
| `count_type` | `text` | ✔ | `'periodic'` |  |
| `status` | `text` | ✔ | `'open'` |  |
| `scope_note` | `text` |  |  |  |
| `started_at` | `timestamptz` | ✔ | `now()` |  |
| `started_by` | `uuid` |  |  | `auth.users(id)` |
| `counted_at` | `timestamptz` |  |  |  |
| `counted_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_at` | `timestamptz` |  |  |  |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `posted_at` | `timestamptz` |  |  |  |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_stock_counts_wh` على (`organization_id, warehouse_id, status`) — *(0098)*
- `uq_one_open_count_per_warehouse` — فريد على (`warehouse_id`) — *(0098)*

### stock_transfer_items

أُنشئ في `0003` · عُدِّل في: `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `transfer_id` | `uuid` | ✔ |  | `stock_transfers(id)` |
| `item_id` | `uuid` | ✔ |  | `items(id)` |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `unit_cost` | `numeric(12,2)` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `organization_id` | `uuid` |  |  | `organizations(id)` |
| `lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `qty_shipped` | `numeric(14,3)` | ✔ | `0` |  |
| `qty_received` | `numeric(14,3)` | ✔ | `0` |  |
| `received_lot_id` | `uuid` |  |  | `inventory_lots(id)` |
| `variance_note` | `text` |  |  |  |

### stock_transfers

أُنشئ في `0003` · عُدِّل في: `0042`، `0044`، `0098`، `0143`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `transfer_type` | `text` | ✔ | `'transfer'` |  |
| `status` | `text` | ✔ | `'draft'` |  |
| `priority` | `text` | ✔ | `'normal'` |  |
| `from_warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `to_warehouse_id` | `uuid` |  |  | `warehouses(id)` |
| `note` | `text` |  |  |  |
| `requested_by` | `uuid` |  |  | `auth.users(id)` |
| `approved_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |
| `transfer_number` | `bigserial` |  |  |  |
| `from_branch_id` | `uuid` |  |  | `branches(id)` |
| `to_branch_id` | `uuid` |  |  | `branches(id)` |
| `reason` | `text` |  |  |  |
| `requested_at` | `timestamptz` | ✔ | `now()` |  |
| `approved_at` | `timestamptz` |  |  |  |
| `rejected_reason` | `text` |  |  |  |
| `shipped_at` | `timestamptz` |  |  |  |
| `shipped_by` | `uuid` |  |  | `auth.users(id)` |
| `received_at` | `timestamptz` |  |  |  |
| `received_by` | `uuid` |  |  | `auth.users(id)` |
| `cancelled_at` | `timestamptz` |  |  |  |
| `cancel_reason` | `text` |  |  |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_by` | `uuid` |  |  | `auth.users(id)` |

**قيود:**

- `constraint stock_transfers_org_number_key unique (organization_id, transfer_number)` — *(0044)*
- `constraint stock_transfers_status_check check (status in ('draft','requested','approved','rejected','shipped', 'received','cancelled'))` — *(0098)*

**فهارس:**

- `idx_transfers_status` على (`organization_id, status, requested_at desc`) — *(0098)*

### tooth_procedures

أُنشئ في `0141`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `tooth_number` | `text` | ✔ |  |  |
| `tooth_type` | `text` | ✔ | `'permanent'` |  |
| `surfaces` | `text[]` | ✔ | `'{}'` |  |
| `item_id` | `uuid` |  |  | `items(id)` |
| `procedure_kind` | `text` |  |  |  |
| `status` | `text` | ✔ | `'planned'` |  |
| `agreement_item_id` | `uuid` |  |  | `treatment_agreement_items(id)` |
| `visit_service_id` | `uuid` |  |  | `patient_visit_services(id)` |
| `diagnosis_icd10_id` | `uuid` |  |  |  |
| `note` | `text` |  |  |  |
| `planned_at` | `timestamptz` | ✔ | `now()` |  |
| `planned_by` | `uuid` |  |  | `auth.users(id)` |
| `performed_at` | `timestamptz` |  |  |  |
| `performed_by` | `uuid` |  |  | `auth.users(id)` |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_tooth_proc_open` على (`organization_id, status, planned_at`) — *(0141)*
- `idx_tooth_proc_patient` على (`patient_id, tooth_number, planned_at desc`) — *(0141)*
- `idx_tooth_proc_visit` على (`visit_id`) — *(0141)*

### tooth_shade_guides

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name` | `text` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, name)` — *(0003)*

### tooth_shades

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `shade_guide_id` | `uuid` | ✔ |  | `tooth_shade_guides(id)` |
| `code` | `text` | ✔ |  |  |
| `sort_order` | `int` | ✔ | `0` |  |

### training_enrollments

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `program_id` | `uuid` | ✔ |  | `training_programs(id)` |
| `employee_id` | `uuid` | ✔ |  | `employees(id)` |
| `status` | `text` | ✔ | `'enrolled'` |  |
| `completed_at` | `timestamptz` |  |  |  |
| `certificate_storage_path` | `text` |  |  |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (program_id, employee_id)` — *(0023)*

**فهارس:**

- `idx_training_enrollments_employee` على (`employee_id`) — *(0023)*
- `idx_training_enrollments_program` على (`program_id`) — *(0023)*

### training_programs

أُنشئ في `0023`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name_ar` | `text` | ✔ |  |  |
| `name_en` | `text` |  |  |  |
| `description` | `text` |  |  |  |
| `hours` | `numeric(6,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_training_programs_org` على (`organization_id`) — *(0023)*

### treatment_agreement_items

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `agreement_id` | `uuid` | ✔ |  | `treatment_agreements(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `description` | `text` |  |  |  |
| `qty` | `numeric(12,2)` | ✔ | `1` |  |
| `unit_price` | `numeric(12,2)` | ✔ | `0` |  |
| `discount_percent` | `numeric(5,2)` | ✔ | `0` |  |
| `net_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

### treatment_agreements

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `agreement_number` | `bigserial` |  |  |  |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `clinic_id` | `uuid` |  |  | `clinics(id)` |
| `agreement_date` | `date` | ✔ | `current_date` |  |
| `vat_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `total_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `invoiced_amount` | `numeric(12,2)` | ✔ | `0` |  |
| `remaining_amount` | `numeric(12,2)` |  |  |  |
| `note` | `text` |  |  |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, agreement_number)` — *(0003)*

### treatment_sessions

أُنشئ في `0003` · عُدِّل في: `0142`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `agreement_id` | `uuid` |  |  | `treatment_agreements(id)` |
| `agreement_item_id` | `uuid` |  |  | `treatment_agreement_items(id)` |
| `sales_invoice_item_id` | `uuid` |  |  | `sales_invoice_items(id)` |
| `session_number` | `int` | ✔ | `1` |  |
| `scheduled_date` | `date` |  |  |  |
| `status` | `text` | ✔ | `'scheduled'` |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `item_id` | `uuid` |  |  | `items(id)` |
| `body_area_value_id` | `uuid` |  |  | `lookup_values(id)` |
| `body_area_note` | `text` |  |  |  |
| `device_resource_id` | `uuid` |  |  | `resources(id)` |
| `parameters` | `jsonb` | ✔ | `'{}'::jsonb` |  |
| `adverse_events` | `text[]` | ✔ | `'{}'` |  |
| `adverse_note` | `text` |  |  |  |
| `performed_at` | `timestamptz` |  |  |  |
| `performed_by` | `uuid` |  |  | `auth.users(id)` |
| `next_due_date` | `date` |  |  |  |
| `interval_override_reason` | `text` |  |  |  |
| `package_id` | `uuid` |  |  | `patient_packages(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_sessions_due` على (`organization_id, next_due_date`) — *(0142)*
- `idx_sessions_patient_item` على (`patient_id, item_id, performed_at desc`) — *(0142)*

### vital_sign_requests

أُنشئ في `0139`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `patient_id` | `uuid` | ✔ |  | `patients(id)` |
| `doctor_id` | `uuid` |  |  | `doctors(id)` |
| `visit_id` | `uuid` |  |  | `patient_visits(id)` |
| `request_kind` | `text` | ✔ | `'general'` |  |
| `measures` | `text[]` | ✔ | `'{}'` |  |
| `priority` | `text` | ✔ | `'routine'` |  |
| `note` | `text` |  |  |  |
| `status` | `text` | ✔ | `'pending'` |  |
| `requested_by` | `uuid` |  |  | `auth.users(id)` |
| `requested_at` | `timestamptz` | ✔ | `now()` |  |
| `recorded_by` | `uuid` |  |  | `auth.users(id)` |
| `recorded_at` | `timestamptz` |  |  |  |
| `vital_sign_id` | `uuid` |  |  | `patient_vital_signs(id)` |
| `cancel_reason` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_vital_requests_doctor` على (`doctor_id, status`) — *(0139)*
- `idx_vital_requests_open` على (`organization_id, status, requested_at`) — *(0139)*
- `idx_vital_requests_patient` على (`patient_id, requested_at desc`) — *(0139)*

### voucher_invoice_allocations

أُنشئ في `0003`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `voucher_id` | `uuid` | ✔ |  | `financial_vouchers(id)` |
| `sales_invoice_id` | `uuid` | ✔ |  | `sales_invoices(id)` |
| `amount` | `numeric(12,2)` | ✔ |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `idx_voucher_allocations_invoice` على (`sales_invoice_id`) — *(0003)*

### waiting_room_tickers

أُنشئ في `0049`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `body` | `text` | ✔ |  |  |
| `starts_on` | `date` |  |  |  |
| `ends_on` | `date` |  |  |  |
| `sort_order` | `integer` | ✔ | `0` |  |
| `is_active` | `boolean` | ✔ | `true` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `constraint waiting_room_tickers_dates_ck check (ends_on is null or starts_on is null or ends_on >= starts_on)` — *(0049)*

**فهارس:**

- `idx_waiting_room_tickers_org` على (`organization_id, is_active, sort_order`) — *(0049)*

### warehouse_locations

أُنشئ في `0098`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `warehouse_id` | `uuid` | ✔ |  | `warehouses(id)` |
| `code` | `text` | ✔ |  |  |
| `name` | `text` |  |  |  |
| `location_type` | `text` | ✔ | `'shelf'` |  |
| `parent_location_id` | `uuid` |  |  | `warehouse_locations(id)` |
| `temperature_controlled` | `boolean` | ✔ | `false` |  |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `note` | `text` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |
| `created_by` | `uuid` |  |  | `auth.users(id)` |
| `updated_at` | `timestamptz` | ✔ | `now()` |  |

**فهارس:**

- `uq_warehouse_location_code` — فريد على (`warehouse_id, code`) — *(0098)*

### warehouses

أُنشئ في `0001` · عُدِّل في: `0088`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `branch_id` | `uuid` |  |  | `branches(id)` |
| `code` | `text` | ✔ |  |  |
| `name` | `text` | ✔ |  |  |
| `note` | `text` |  |  |  |
| `zatca_company_id` | `uuid` |  |  | `zatca_companies(id)` |
| `is_disabled` | `boolean` | ✔ | `false` |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

**قيود:**

- `unique (organization_id, code)` — *(0001)*
- `constraint warehouses_org_id_key unique (organization_id, id)` — *(0088)*

### zatca_companies

أُنشئ في `0001`

| العمود | النوع | إلزامي | افتراضي | يشير إلى |
| --- | --- | :-: | --- | --- |
| `id` 🔑 | `uuid` | ✔ | `gen_random_uuid()` |  |
| `organization_id` | `uuid` | ✔ |  | `organizations(id)` |
| `name` | `text` | ✔ |  |  |
| `vat_number` | `text` | ✔ |  |  |
| `environment` | `text` | ✔ | `'sandbox'` |  |
| `csr_config` | `jsonb` |  |  |  |
| `created_at` | `timestamptz` | ✔ | `now()` |  |

## المنظورات (175)

| المنظور | نوعه | عُرِّف في |
| --- | --- | --- |
| `dental_lab_balances` | منظور | `0007` |
| `expiring_alerts` | منظور | `0103` |
| `v_account_balances` | منظور | `0017` |
| `v_agreements_stats` | منظور | `0010` |
| `v_analytics_daily` | منظور | `0111` |
| `v_analytics_peak_hours` | منظور | `0111` |
| `v_analytics_top_services` | منظور | `0111` |
| `v_appointment_messages` | منظور | `0069` |
| `v_appointment_reminder_status` | منظور | `0069` |
| `v_asset_alerts` | منظور | `0101` |
| `v_asset_depreciation_schedule` | منظور | `0101` |
| `v_asset_register` | منظور | `0101` |
| `v_attendance_summary` | منظور | `0100` |
| `v_audit_log_detail` | منظور | `0037`، `0044`، `0062` |
| `v_available_drug_lots` | منظور | `0088` |
| `v_balance_sheet` | منظور | `0099` |
| `v_blocked_contacts` | منظور | `0063` |
| `v_branch_schedule` | منظور | `0107` |
| `v_business_day_collections` | منظور | `0147` |
| `v_business_day_invoices` | منظور | `0147` |
| `v_business_day_summary` | منظور | `0147` |
| `v_cash_flow` | منظور | `0099` |
| `v_cash_shift_summary` | منظور | `0091` |
| `v_claim_register` | منظور | `0089` |
| `v_claim_settlement` | منظور | `0093` |
| `v_clinic_summary` | منظور | `0080` |
| `v_cost_center_performance` | منظور | `0099` |
| `v_critical_results` | منظور | `0105` |
| `v_daily_revenue` | منظور | `0010`، `0044` |
| `v_daily_revenue_by_source` | منظور | `0010`، `0143` |
| `v_daily_revenue_by_user` | منظور | `0042`، `0044` |
| `v_dental_treatment_plan` | منظور | `0141` |
| `v_department_summary` | منظور | `0080` |
| `v_doctor_inbox` | منظور | `0138` |
| `v_doctor_license_status` | منظور | `0081` |
| `v_doctor_open_visits` | منظور | `0105` |
| `v_doctor_vitals_inbox` | منظور | `0139` |
| `v_doctor_worklist` | منظور | `0105` |
| `v_document_expiry_alerts` | منظور | `0102` |
| `v_document_signatures` | منظور | `0102` |
| `v_documents` | منظور | `0102` |
| `v_drug_catalog` | منظور | `0088` |
| `v_duplicate_patient_id_numbers` | منظور | `0146` |
| `v_duty_conflicts` | منظور | `0108` |
| `v_einvoice_status` | منظور | `0092` |
| `v_employee_contracts_status` | منظور | `0021` |
| `v_employee_documents_expiry` | منظور | `0100` |
| `v_employee_loans_status` | منظور | `0100` |
| `v_employee_training_summary` | منظور | `0023` |
| `v_exam_templates` | منظور | `0085` |
| `v_fiscal_period_status` | منظور | `0099` |
| `v_gl_lines` | منظور | `0099` |
| `v_hr_attendance_monthly` | منظور | `0024` |
| `v_hr_dashboard_summary` | منظور | `0024` |
| `v_hr_latest_performance` | منظور | `0024` |
| `v_income_statement` | منظور | `0099` |
| `v_incomplete_visits` | منظور | `0087` |
| `v_insurance_contracts` | منظور | `0089` |
| `v_insurance_receivables` | منظور | `0093` |
| `v_integration_dead_letters` | منظور | `0110` |
| `v_integration_health` | منظور | `0110` |
| `v_internal_unread_counts` | منظور | `0026`، `0059` |
| `v_inventory_on_hand` | منظور | `0038`، `0044` |
| `v_inventory_warehouse_summary` | منظور | `0038` |
| `v_invoice_profitability` | منظور | `0010`، `0143` |
| `v_invoice_register` | منظور | `0091`، `0144` |
| `v_item_price_history` | منظور | `0072` |
| `v_lab_pending_orders` | منظور | `0013`، `0144` |
| `v_lab_worklist` | منظور | `0083` |
| `v_leave_balances_current_year` | منظور | `0020` |
| `v_locale_settings` | منظور | `0109` |
| `v_maintenance_history` | منظور | `0101` |
| `v_medical_record_access_log_detail` | منظور | `0126` |
| `v_members_overview` | منظور | `0108` |
| `v_membership_limit_usage` | منظور | `0089` |
| `v_my_notifications` | منظور | `0103` |
| `v_my_permissions` | منظور | `0062` |
| `v_notification_summary` | منظور | `0103` |
| `v_nphies_queue` | منظور | `0093` |
| `v_occupational_exam_report` | منظور | `0149` |
| `v_offers_totals` | منظور | `0010`، `0143`، `0144` |
| `v_organization_members_directory` | منظور | `0026` |
| `v_organization_policies` | منظور | `0107` |
| `v_package_catalog` | منظور | `0096` |
| `v_package_usage_log` | منظور | `0096` |
| `v_patient_balance` | منظور | `0091`، `0144` |
| `v_patient_directory` | منظور | `0095` |
| `v_patient_financials` | منظور | `0039` |
| `v_patient_financials_by_doctor` | منظور | `0041` |
| `v_patient_insurance_status` | منظور | `0089` |
| `v_patient_odontogram` | منظور | `0141` |
| `v_patient_package_balances` | منظور | `0096` |
| `v_patient_radiology_images` | منظور | `0138` |
| `v_patient_subscriptions` | منظور | `0096` |
| `v_patient_vitals` | منظور | `0139`، `0144` |
| `v_payroll_items_payable` | منظور | `0145` |
| `v_payroll_register` | منظور | `0100` |
| `v_pending_consents` | منظور | `0102` |
| `v_pending_patient_requests` | منظور | `0104` |
| `v_pending_receipts` | منظور | `0097` |
| `v_pharmacy_queue` | منظور | `0088` |
| `v_portal_appointments` | منظور | `0104` |
| `v_portal_documents` | منظور | `0104` |
| `v_portal_invoices` | منظور | `0104` |
| `v_portal_results` | منظور | `0104` |
| `v_prescriptions_pending_dispensing` | منظور | `0015`، `0088` |
| `v_purchase_pipeline` | منظور | `0097` |
| `v_quality_incidents` | منظور | `0106` |
| `v_quality_scorecard` | منظور | `0106` |
| `v_quality_trend` | منظور | `0106` |
| `v_radiology_console_queue` | منظور | `0138` |
| `v_radiology_unreported_orders` | منظور | `0138`، `0144` |
| `v_radiology_worklist` | منظور | `0084` |
| `v_reception_queue` | منظور | `0065` |
| `v_reception_queue_ordered` | منظور | `0065` |
| `v_reception_requests` | منظور | `0138` |
| `v_recruitment_pipeline` | منظور | `0022` |
| `v_reference_categories` | منظور | `0086` |
| `v_reference_data` | منظور | `0086` |
| `v_reminder_pipeline_health` | منظور | `0060` |
| `v_reorder_suggestions` | منظور | `0098` |
| `v_report_appointments` | منظور | `0094` |
| `v_report_claim_rejections` | منظور | `0094` |
| `v_report_claims` | منظور | `0094` |
| `v_report_credit_debit_notes` | منظور | `0094` |
| `v_report_discounts_refunds` | منظور | `0094` |
| `v_report_dispensing` | منظور | `0094` |
| `v_report_doctor_productivity` | منظور | `0094` |
| `v_report_orders` | منظور | `0094` |
| `v_report_outstanding` | منظور | `0094` |
| `v_report_patient_funnel` | منظور | `0094` |
| `v_report_preauth_expiring` | منظور | `0094` |
| `v_report_receipts` | منظور | `0094` |
| `v_report_revenue` | منظور | `0094` |
| `v_report_settlement_variance` | منظور | `0094` |
| `v_report_stock_movements` | منظور | `0094` |
| `v_resource_schedule` | منظور | `0084` |
| `v_returns_statement_items` | منظور | `0010` |
| `v_returns_statement_receipts` | منظور | `0010` |
| `v_revenue_by_clinic` | منظور | `0010`، `0143` |
| `v_revenue_by_doctor` | منظور | `0010`، `0143` |
| `v_sales_by_item` | منظور | `0010`، `0143` |
| `v_security_advisor` | منظور | `0095`، `0136` |
| `v_service_catalog` | منظور | `0076` |
| `v_service_category_tree` | منظور | `0140` |
| `v_services_by_specialty` | منظور | `0140` |
| `v_session_history` | منظور | `0142` |
| `v_session_photos` | منظور | `0142` |
| `v_sessions_due` | منظور | `0142` |
| `v_specialty_tree` | منظور | `0140` |
| `v_stock_alerts` | منظور | `0088` |
| `v_stock_count_variance` | منظور | `0098` |
| `v_stock_movement_age` | منظور | `0098` |
| `v_stock_on_hand_detailed` | منظور | `0098` |
| `v_stock_valuation` | منظور | `0098` |
| `v_supplier_balances` | منظور | `0097` |
| `v_supplier_ledger` | منظور | `0097` |
| `v_tax_invoice_lines` | منظور | `0092` |
| `v_temporary_invoices_stats` | منظور | `0010` |
| `v_today_attendance` | منظور | `0019`، `0144` |
| `v_tooth_procedure_history` | منظور | `0141` |
| `v_transfer_pipeline` | منظور | `0098` |
| `v_translation_coverage` | منظور | `0109` |
| `v_trial_balance` | منظور | `0017` |
| `v_unbilled_dispensed_prescriptions` | منظور | `0145` |
| `v_unbilled_performed_services` | منظور | `0074`، `0143` |
| `v_user_effective_permissions` | منظور | `0108` |
| `v_vat_statement_sales_invoices` | منظور | `0010`، `0143` |
| `v_vat_statement_vouchers` | منظور | `0010` |
| `v_vat_summary` | منظور | `0092` |
| `v_visit_orders_unbilled` | منظور | `0057`، `0145` |
| `v_visit_register` | منظور | `0087` |
| `v_visit_services_status` | منظور | `0073` |
| `v_visit_services_unbilled` | منظور | `0053` |
| `v_vital_sign_queue` | منظور | `0139` |

## الدوالّ

توقيعات الدوالّ الـ421 في ملفّ مستقلّ: [`SCHEMA-FUNCTIONS.md`](SCHEMA-FUNCTIONS.md).
