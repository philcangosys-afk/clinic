# فحص الدورات غير المكتملة

> **مُولَّد آليًّا:** `python scripts/completeness-audit.py` — أعِد تشغيله بعد كل جولة.
> يقرأ `docs/schema.json` ويمسح `client/` و`migrations/`.

السؤال: هل لكل قدرة في القاعدة نظيرها في الواجهة، والعكس؟ العيب المتكرّر في
هذا المشروع ليس خطأ برمجيًّا بل **دورة نصف مبنيّة**.

## الأرقام

| | |
| --- | ---: |
| جداول في المخطط | 234 |
| جداول لا يمسّها العميل إطلاقًا | 50 |
| جداول تُقرأ ولا مسار كتابة لها ولا بذرة | 3 |
| جداول تُقرأ وتملؤها بذرة فقط | 3 |
| جداول يُكتب إليها ولا تُقرأ | 0 |
| دوالّ لا يستدعيها أحد | 15 من 434 |
| منظورات لا يقرؤها العميل | 36 من 184 |
| نداءات العميل إلى جداول غير موجودة | 0 |
| نداءات العميل إلى دوالّ غير موجودة | 0 |

## 🟠 جداول تُقرأ ولا مسار كتابة لها ولا بذرة

الشاشة تعرضها وتبقى **فارغة أبدًا**: لا العميل يكتب إليها، ولا دالّة في
القاعدة، ولا بذرة تملؤها في أيّ ترقية.

| الجدول | يقرؤه |
| --- | --- |
| `procedure_codes` | `client/pages/ReferenceData.tsx` |
| `tooth_shade_guides` | `client/pages/DentalLab.tsx` |
| `tooth_shades` | `client/pages/DentalLab.tsx` |

### تُقرأ ولا تُكتب لكن تملؤها بذرة (مقصود)

بيانات مرجعية تُزرع بالترقيات ولا تُدار من الواجهة. إدارتها من النظام بند
مفتوح لا خلل.

| الجدول | يقرؤه | تُزرع في |
| --- | --- | --- |
| `feature_catalog` | `client/pages/SystemControl.tsx` | 0001، 0101، 0102، 0103، 0104، 0105 … |
| `icd10_codes` | `client/components/medical/VisitCanvasDetail.tsx`، `client/components/shared/IcdPicker.tsx`، `client/pages/ReferenceData.tsx` | 0047 |
| `permission_catalog` | `client/pages/Users.tsx` | 0062، 0071، 0080، 0081، 0083، 0084 … |

## 🟡 جداول يُكتب إليها ولا تُقرأ

بيانات تُجمَع ولا يراها أحد: لا قراءة مباشرة من العميل، ولا عبر منظور يقرؤه،
ولا من داخل القاعدة نفسها (دالّة أو منظور).

لا شيء.

## ⚪ جداول لا يمسّها العميل إطلاقًا (50)

عمود «تكتبه دالّة» يعني أنّ للجدول مسار كتابة في القاعدة (سجلّ تدقيق، أثر
مُحفِّز) فغيابه عن الواجهة قد يكون مقصودًا. أمّا ما لا دالّة تكتبه ولا بذرة
تملؤه فهو جدول ميّت تمامًا.

| الجدول | تكتبه دالّة | تملؤه بذرة |
| --- | --- | --- |
| `appointment_reminder_jobs` | 0050، 0054، 0069 | — |
| `asset_depreciation_lines` | 0101 | — |
| `asset_disposals` | 0101 | — |
| `asset_transfers` | 0101 | — |
| `bank_reconciliation_lines` | — | — |
| `business_days` | 0147 | — |
| `critical_result_notifications` | 0105، 0107 | — |
| `departments` | 0080، 0118، 0132 | — |
| `document_number_sequences` | 0092 | — |
| `document_signatures` | 0102 | — |
| `einvoice_documents` | 0092، 0110 | — |
| `employee_position_history` | 0100 | — |
| `entity_documents` | 0102 | — |
| `insurance_eligibility_checks` | 0093 | — |
| `insurance_settlement_claims` | 0093 | — |
| `insurance_settlements` | 0093 | — |
| `inventory_reservations` | 0088 | — |
| `lab_reference_ranges` | 0119 | — |
| `lab_result_amendments` | 0083 | — |
| `lab_result_attachments` | — | — |
| `lab_test_components` | 0119 | — |
| `maintenance_order_parts` | 0101 | — |
| `medical_record_access_log` | 0095، 0125 | — |
| `medical_reports` | 0154 | — |
| `notifications` | 0103، 0120 | — |
| `nphies_messages` | 0093، 0110 | — |
| `organization_locale_settings` | 0109 | — |
| `organization_policies` | 0107 | — |
| `patient_package_usages` | 0075، 0096 | — |
| `patient_packages` | 0096 | — |
| `patient_tooth_status` | 0141 | — |
| `patient_visit_services` | 0061، 0073، 0091، 0096، 0141، 0143 | — |
| `payroll_run_items` | 0100، 0145 | — |
| `price_list_items` | 0072، 0118، 0119 | — |
| `public_booking_rate_limits` | 0128، 0133، 0134 | — |
| `public_booking_settings` | — | 0128 |
| `purchase_approval_rules` | — | — |
| `purchase_invoice_items` | 0097 | — |
| `purchase_orders` | 0097 | — |
| `quality_incidents` | 0106 | — |
| `quality_indicators` | 0106 | — |
| `quality_measurements` | 0106 | — |
| `radiology_images` | 0138 | — |
| `reception_settings` | — | — |
| `resource_bookings` | 0084 | — |
| `role_default_permissions` | — | 0062، 0071، 0079، 0080، 0081، 0083 … |
| `staff_requests` | 0138 | — |
| `stock_count_items` | 0098 | — |
| `tooth_procedures` | 0141، 0143، 0154 | — |
| `vital_sign_requests` | 0139 | — |

## ⚪ دوالّ لا يستدعيها أحد (15)

لا `.rpc()` في العميل، ولا استدعاء من دالّة أخرى، ولا مُحفِّز يعلّقها.

| الدالّة | عدد المعاملات |
| --- | --- |
| `app_claim_pending_messages` | 1 |
| `app_discount_within_limits` | 3 |
| `app_employee_days_employed` | 1 |
| `app_is_consultation_renewal_due` | 3 |
| `app_is_conversation_participant` | 1 |
| `app_mark_message_failed` | 3 |
| `app_mark_message_sent` | 2 |
| `app_mask_text` | 2 |
| `app_queue_rank` | 1 |
| `app_resource_free_at` | 3 |
| `app_save_lab_test` | 3 |
| `app_save_radiology_exam` | 3 |
| `app_schedule_radiology_order` | 4 |
| `app_seed_subspecialties` | 0 |
| `app_setup_reminder_schedules` | 5 |

## ⚪ منظورات لا يقرؤها العميل (36)

`v_daily_revenue_by_user`  `v_dental_treatment_plan`  `v_duplicate_patient_id_numbers`  `v_gl_lines`

`v_inventory_warehouse_summary`  `v_lab_worklist`  `v_membership_limit_usage`  `v_patient_financials`

`v_patient_financials_by_doctor`  `v_radiology_worklist`  `v_reception_queue`  `v_reminder_pipeline_health`

`v_report_appointments`  `v_report_claim_rejections`  `v_report_claims`  `v_report_credit_debit_notes`

`v_report_discounts_refunds`  `v_report_dispensing`  `v_report_doctor_productivity`  `v_report_orders`

`v_report_patient_funnel`  `v_report_preauth_expiring`  `v_report_receipts`  `v_report_revenue`

`v_report_settlement_variance`  `v_report_stock_movements`  `v_resource_schedule`  `v_returns_statement_receipts`

`v_revenue_by_clinic`  `v_revenue_by_doctor`  `v_security_advisor`  `v_service_category_tree`

`v_services_by_specialty`  `v_specialty_tree`  `v_stock_valuation`  `v_vat_statement_vouchers`

---

### حدود هذا الفحص

- يكتشف الكتابة بـ`.insert(`/`.upsert(`/`.update(`/`.delete(` بعد `.from("…")`
  في حدود 400 حرف. كتابة موزّعة على دالّة مساعدة قد تفوته.
- **القراءة بالتضمين محسوبة:** `select("*, package_items(...)")` تُعدّ قراءةً
  للجدول المُضمَّن، وإلّا ظهرت عشرات الجداول «تُكتب ولا تُقرأ» زورًا.
- دلاء التخزين (`.storage.from("…")`) مستثناة من عدّ الجداول.
- الأسماء الديناميكية (`.from(variable)`) لا تُلتقَط.
- «دالّة لا يستدعيها أحد» قد تُستدعى من منظور أو من قيد `check` — راجع قبل الحذف.
- المرجع النهائيّ هو القاعدة الحيّة، لا هذا التقرير.
