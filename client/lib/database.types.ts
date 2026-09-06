/**
 * أنواع TypeScript مطابقة لمخطط قاعدة البيانات الفعلي بعد تنفيذ جميع ملفات
 * الترحيل (0001 إلى 0010) في supabase/migrations. هذا الملف هو "طبقة الاتصال"
 * التي تُستخدم في كل استعلامات Supabase بدل كتابة الحقول يدويًا في كل شاشة.
 *
 * ملاحظة: هذه الأنواع كُتبت يدويًا استنادًا إلى ملفات الترحيل (وليست مولّدة
 * تلقائيًا بواسطة `supabase gen types`، لأن هذه الجلسة لا تملك اتصالًا مباشرًا
 * بمشروع Supabase الفعلي للمستخدم). بعد ربط المشروع الحقيقي، يمكن استبدال هذا
 * الملف بالأمر: `supabase gen types typescript --project-id <id> > database.types.ts`
 * دون تغيير أي كود يستدعيه، لأن كل الأسماء هنا مطابقة حرفيًا لأسماء الجداول
 * والأعمدة في ملفات الترحيل.
 */

export type UUID = string;

// ---------------------------------------------------------------------------
// 0001 — النواة: المؤسسات / الفروع / العيادات / المستودعات / العضويات
// ---------------------------------------------------------------------------
export interface OrganizationRow {
  id: UUID;
  name: string;
  organization_type: "medical_center";
  created_by: UUID;
  legacy_full_access: boolean;
  tax_number: string | null;
  currency: "SAR" | "AED" | "QAR" | "KWD" | "BHD" | "OMR";
  default_vat_rate: number;
  created_at: string;
  updated_at: string;
}

export interface BranchRow {
  id: UUID;
  organization_id: UUID;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  is_main: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehouseRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  code: string;
  name: string;
  note: string | null;
  zatca_company_id: UUID | null;
  is_disabled: boolean;
  created_at: string;
}

export interface ClinicRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  parent_clinic_id: UUID | null;
  name: string;
  code: string;
  clinic_type: string | null;
  supplier_warehouse_id: UUID | null;
  consumable_warehouse_id: UUID | null;
  zatca_company_id: UUID | null;
  is_disabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface LookupCategoryRow {
  id: UUID;
  organization_id: UUID | null;
  key: string;
  name_ar: string;
  name_en: string | null;
}

export interface LookupValueRow {
  id: UUID;
  category_id: UUID;
  name_ar: string;
  name_en: string | null;
  code: string | null;
  parent_value_id: UUID | null;
  sort_order: number;
  extra: Record<string, unknown> | null;
  is_disabled: boolean;
}

// ---------------------------------------------------------------------------
// 0002 — الأطباء / المرضى / المواعيد
// ---------------------------------------------------------------------------
export interface DoctorRow {
  id: UUID;
  organization_id: UUID;
  user_id: UUID | null;
  file_number: number;
  clinic_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  job_title: string | null;
  specialty_value_id: UUID | null;
  address: string | null;
  id_number: string | null;
  gender: "male" | "female" | null;
  nationality_value_id: UUID | null;
  mobile_number: string | null;
  email: string | null;
  birth_date: string | null;
  is_enabled: boolean;
  disabled_from_booking: boolean;
  receive_appointment_confirmation_sms: boolean;
  consultation_fee_renewal_days: number | null;
  free_reviews_count: number | null;
  default_appointment_duration_minutes: number | null;
  patient_waiting_minutes: number | null;
  invoice_source_value_id: UUID | null;
  specialty_authority: string | null;
  specialty_authority_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  file_number: number;
  file_date: string;
  name_ar: string;
  name_en: string | null;
  birth_date: string | null;
  gender: "male" | "female" | null;
  nationality_value_id: UUID | null;
  profession_value_id: UUID | null;
  marital_status: string | null;
  city_value_id: UUID | null;
  address: string | null;
  district: string | null;
  street: string | null;
  building_number: string | null;
  postal_code: string | null;
  id_type: string | null;
  id_number: string | null;
  mobile_number: string | null;
  emergency_number: string | null;
  phone_1: string | null;
  phone_2: string | null;
  work_entity_value_id: UUID | null;
  tax_number: string | null;
  is_tax_registered: boolean;
  customer_type_value_id: UUID | null;
  source_value_id: UUID | null;
  source_details: string | null;
  treating_doctor_id: UUID | null;
  participating_doctor_ids: UUID[];
  children_count: number | null;
  educational_qualification_value_id: UUID | null;
  email_1: string | null;
  email_2: string | null;
  father_whatsapp: string | null;
  facebook: string | null;
  website: string | null;
  default_discount_percent: number;
  general_note: string | null;
  insurance_company_name: string | null;
  insurance_policy_number: string | null;
  insurance_policy_category: string | null;
  insurance_membership_number: string | null;
  insurance_relation: string | null;
  insurance_membership_expiry: string | null;
  file_type_value_id: UUID | null;
  passport_number: string | null;
  father_id_number: string | null;
  mother_id_number: string | null;
  blood_type: string | null;
  other_id_type: string | null;
  other_id_number: string | null;
  guarantor_name: string | null;
  guarantor_number: string | null;
  guarantor_details: string | null;
  nearest_person_name: string | null;
  nearest_person_number: string | null;
  gln_number: string | null;
  local_order_weight_kg: number | null;
  block_invoices: boolean;
  block_invoices_reason: string | null;
  block_appointments: boolean;
  block_appointments_reason: string | null;
  block_sms: boolean;
  block_sms_reason: string | null;
  block_file: boolean;
  block_file_reason: string | null;
  e_signature_enabled: boolean;
  electronic_signature_url: string | null;
  is_newborn: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface HealthConditionRow {
  id: UUID;
  organization_id: UUID | null;
  name_ar: string;
  name_en: string;
  sort_order: number;
}

export interface PatientHealthConditionRow {
  patient_id: UUID;
  condition_id: UUID;
  is_checked: boolean;
  note: string | null;
}

export interface PatientNoteRow {
  id: UUID;
  patient_id: UUID;
  title: string | null;
  body: string;
  created_by: UUID | null;
  created_at: string;
  is_disabled: boolean;
}

export type AppointmentStatus =
  | "new"
  | "scheduled"
  | "confirmed"
  | "unconfirmed"
  | "arrived"
  | "checked_in"
  | "called"
  | "in_progress"
  | "completed"
  | "no_show"
  | "cancelled_by_patient"
  | "cancelled_by_staff"
  | "walk_in"
  | "waiting";

export interface AppointmentRow {
  id: UUID;
  organization_id: UUID;
  clinic_id: UUID | null;
  doctor_id: UUID;
  patient_id: UUID;
  scheduled_start: string;
  scheduled_end: string;
  status: AppointmentStatus;
  priority: "normal" | "urgent" | "emergency" | "elderly" | "accessibility";
  queue_number: number | null;
  cancellation_reason: string | null;
  no_show_reason: string | null;
  checked_in_1_at: string | null;
  checked_in_2_at: string | null;
  called_at: string | null;
  entered_at: string | null;
  left_at: string | null;
  visit_type_value_id: UUID | null;
  source_value_id: UUID | null;
  note: string | null;
  sms_reminder_sent: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 0003 — الأصناف / الفواتير / سندات الصرف والقبض
// ---------------------------------------------------------------------------
export interface ItemRow {
  id: UUID;
  organization_id: UUID;
  category_value_id: UUID | null;
  item_type: "service" | "product" | "drug" | "lab_service";
  code: string;
  barcode: string | null;
  name_ar: string;
  name_en: string | null;
  unit: string | null;
  price: number;
  cost_price: number | null;
  is_vat_exempt: boolean;
  track_inventory: boolean;
  is_disabled: boolean;
  created_at: string;
  updated_at: string;
}

export type SalesInvoiceStatus =
  | "draft"
  | "unpaid"
  | "partial"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "void";

export interface SalesInvoiceRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  clinic_id: UUID | null;
  doctor_id: UUID | null;
  warehouse_id: UUID | null;
  patient_id: UUID | null;
  appointment_id: UUID | null;
  external_customer_name: string | null;
  external_customer_mobile: string | null;
  invoice_number: number;
  zatca_invoice_number: string | null;
  /** حمولة رمز QR بترميز TLV ثم Base64 — تُولَّد في القاعدة (0058). */
  zatca_qr: string | null;
  invoice_type: "sale" | "return";
  nationality_value_id: UUID | null;
  source_value_id: UUID | null;
  is_temporary: boolean;
  is_b2b: boolean;
  status: SalesInvoiceStatus;
  is_insurance_invoice: boolean;
  /** بيانات التأمين كما سُجِّلت وقت الإصدار — لقطة لا مرجعًا حيًّا لملف المريض. */
  insurance_company_name: string | null;
  insurance_policy_number: string | null;
  insurance_class_number: string | null;
  insurance_membership_number: string | null;
  insurance_copay_percent: number | null;
  insurance_max_amount: number | null;
  insurance_approval_number: string | null;
  subtotal_amount: number;
  discount_percent: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  /**
   * حصّتا التأمين والمريض (0052). تُحسبان في القاعدة عند إصدار الفاتورة ولا
   * تُرسلان من العميل — وكانتا غائبتين عن هذا النوع، فلا تُقرآن في أي شاشة.
   */
  insurance_share_amount: number;
  patient_share_amount: number;
  paid_amount: number;
  remaining_amount: number;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface SalesInvoiceItemRow {
  id: UUID;
  invoice_id: UUID;
  item_id: UUID | null;
  doctor_id: UUID | null;
  description: string | null;
  line_type: "normal" | "follow_up" | "agreement";
  price: number;
  qty: number;
  discount_percent: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  created_at: string;
}

export type VoucherType =
  | "receipt"
  | "expense"
  | "salary"
  | "bank_deposit"
  | "bank_withdrawal"
  | "bank_transfer";

export interface FinancialVoucherRow {
  id: UUID;
  organization_id: UUID;
  voucher_number: number;
  voucher_type: VoucherType;
  voucher_date: string;
  amount: number;
  payment_method_value_id: UUID | null;
  cash_register_id: UUID | null;
  bank_transfer_ref: string | null;
  transfer_to_account_value_id: UUID | null;
  related_sales_invoice_id: UUID | null;
  patient_id: UUID | null;
  distributor_id: UUID | null;
  employee_ref_id: UUID | null;
  employee_name: string | null;
  expense_category_value_id: UUID | null;
  expense_source_document: string | null;
  expense_source_number: string | null;
  payee_name: string | null;
  description: string | null;
  vat_rate: number | null;
  vat_amount: number | null;
  requires_vat: boolean;
  supplier_tax_number: string | null;
  clinic_id: UUID | null;
  doctor_id: UUID | null;
  dental_lab_order_id: UUID | null;
  created_by: UUID | null;
  created_at: string;
}

export interface CashRegisterRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  name: string;
  is_doctor_custody: boolean;
  assigned_doctor_id: UUID | null;
  is_disabled: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 0005 — التأمين الطبي: شركات / بوليصات / عضويات / مطالبات UCAF-DCAF-OCAF
// ---------------------------------------------------------------------------
export interface InsuranceCompanyRow {
  id: UUID;
  organization_id: UUID;
  parent_company_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  is_disabled: boolean;
  created_at: string;
}

export interface InsurancePolicyRow {
  id: UUID;
  organization_id: UUID;
  company_id: UUID;
  policy_name: string;
  policy_number: string | null;
  policy_class: string | null;
  default_copay_percent: number;
  default_max_amount: number | null;
  is_disabled: boolean;
}

export interface PatientInsuranceMembershipRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  policy_id: UUID;
  membership_number: string;
  relation: "self" | "spouse" | "child" | "other";
  expiry_date: string | null;
  eligibility_status: "eligible" | "not_eligible" | "unknown" | "expired";
  is_active: boolean;
  created_at: string;
}

export type InsuranceClaimFormType = "ucaf" | "dcaf" | "ocaf";
export type InsuranceClaimStatus = "draft" | "submitted" | "approved" | "rejected";

export interface InsuranceClaimFormRow {
  id: UUID;
  organization_id: UUID;
  form_type: InsuranceClaimFormType;
  patient_id: UUID;
  doctor_id: UUID | null;
  clinic_id: UUID | null;
  membership_id: UUID | null;
  sales_invoice_id: UUID | null;
  status: InsuranceClaimStatus;
  form_data: Record<string, unknown>;
  auto_created: boolean;
  created_at: string;
  updated_at: string;
}

export type PreauthorizationStatus = "pending" | "approved" | "rejected" | "expired";

export interface InsurancePreauthorizationRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  membership_id: UUID | null;
  doctor_id: UUID | null;
  clinic_id: UUID | null;
  service_description: string | null;
  requested_amount: number | null;
  status: PreauthorizationStatus;
  approval_number: string | null;
  requested_at: string;
  responded_at: string | null;
  note: string | null;
}

export type InsuranceClaimBatchStatus = "draft" | "submitted" | "accepted" | "rejected" | "partially_paid";

export interface InsuranceClaimBatchRow {
  id: UUID;
  organization_id: UUID;
  company_id: UUID;
  batch_number: number;
  period_start: string | null;
  period_end: string | null;
  total_amount: number;
  status: InsuranceClaimBatchStatus;
  submitted_at: string | null;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
}

export type InsuranceClaimBatchItemStatus = "pending" | "accepted" | "rejected";

export interface InsuranceClaimBatchItemRow {
  id: UUID;
  batch_id: UUID;
  sales_invoice_id: UUID;
  amount: number;
  status: InsuranceClaimBatchItemStatus;
}

// ---------------------------------------------------------------------------
// إعدادات التشغيل (المرحلة 3.7) — كل الجداول أدناه "singleton" بمفتاح organization_id
// باستثناء discount_limits (قائمة حدود متعددة الصفوف)
// ---------------------------------------------------------------------------
export interface PrintSettingsRow {
  organization_id: UUID;
  invoice_paper_size: "a4" | "thermal_80mm";
  receipt_paper_size: "a4" | "thermal_80mm";
  report_paper_size: "a4" | "thermal_80mm";
  show_logo: boolean;
  footer_note: string | null;
  updated_at: string;
}

export interface OrganizationVatSettingsRow {
  organization_id: UUID;
  sales_vat_enabled: boolean;
  purchase_vat_enabled: boolean;
  purchase_vat_editable: boolean;
  dental_lab_vat_enabled: boolean;
  dental_lab_vat_editable: boolean;
  misc_expenses_vat_enabled: boolean;
  misc_expenses_require_supplier_tax_number: boolean;
  misc_expenses_require_purchase_invoice_number: boolean;
  print_price_with_vat: boolean;
  block_invoice_without_nationality_or_id: boolean;
  vat_exemption_disabled_for_customer_types: boolean;
  vat_exemption_disabled_for_items: boolean;
  vat_exempt_nationality_value_ids: UUID[];
  updated_at: string;
}

export interface OrganizationDiscountSettingsRow {
  organization_id: UUID;
  general_discount_percent: number;
  updated_at: string;
}

export interface DiscountLimitRow {
  id: UUID;
  organization_id: UUID;
  applies_to_role: string | null;
  applies_to_user_id: UUID | null;
  min_percent: number;
  max_percent: number;
  created_at: string;
}

export const ORG_ROLE_KEYS = [
  "owner",
  "organization_admin",
  "branch_manager",
  "doctor",
  "nurse",
  "receptionist",
  "pharmacist",
  "lab_technician",
  "radiology_technician",
  "accountant",
  "hr_manager",
  "employee",
] as const;
export type OrgRoleKey = (typeof ORG_ROLE_KEYS)[number];

export interface ConsultationFeeSettingsRow {
  organization_id: UUID;
  renewal_alert_enabled: boolean;
  updated_at: string;
}

export interface InsuranceSettingsRow {
  organization_id: UUID;
  vat_responsibility: "patient" | "insurance_company" | "by_item_category";
  default_ucaf_template: string;
  default_dcaf_template: string;
  prevent_duplicate_policy_name: boolean;
  prevent_duplicate_services_in_claim_line: boolean;
  notify_treating_doctor_on_changes: boolean;
  notify_form_owner_on_changes: boolean;
  disable_patient_max_copay_field: boolean;
  auto_create_forms_on_consultation_invoice: boolean;
  exclude_offer_discount_invoices_from_auto_create: boolean;
  allow_doctor_edit_radiology_data: boolean;
  updated_at: string;
}

export interface InternalMessagingSettingsRow {
  organization_id: UUID;
  internal_chat_enabled: boolean;
  poll_interval_seconds: number;
  online_timeout_seconds: number;
  view_permission_scope: "all" | "own";
  delete_permission_scope: "all" | "own";
  notifications_enabled: boolean;
  notify_by_role: boolean;
  updated_at: string;
}

export interface SmsCreditBalanceRow {
  organization_id: UUID;
  balance: number;
  low_balance_alert_threshold: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// المختبر (0013) — المرحلة 4.1، أول موديول من المجموعة الطبية الجديدة كليًا
// ---------------------------------------------------------------------------
export interface LabTestCategoryRow {
  id: UUID;
  organization_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  sort_order: number;
}

export type LabSpecimenType = "blood" | "urine" | "stool" | "swab" | "sputum" | "tissue" | "other";

export interface LabTestRow {
  id: UUID;
  organization_id: UUID;
  category_id: UUID | null;
  billing_item_id: UUID | null;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  specimen_type: LabSpecimenType;
  unit: string | null;
  normal_range_text: string | null;
  normal_range_min: number | null;
  normal_range_max: number | null;
  turnaround_hours: number | null;
  is_active: boolean;
  created_at: string;
}

export type LabOrderStatus =
  | "ordered"
  | "specimen_collected"
  | "in_progress"
  | "completed"
  | "verified"
  | "cancelled";
export type LabOrderPriority = "routine" | "urgent" | "stat";

export interface LabOrderRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  ordering_doctor_id: UUID | null;
  visit_id: UUID | null;
  clinic_id: UUID | null;
  sales_invoice_id: UUID | null;
  status: LabOrderStatus;
  priority: LabOrderPriority;
  ordered_at: string;
  specimen_collected_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  verified_by: UUID | null;
  notes: string | null;
  created_at: string;
}

export interface LabOrderItemRow {
  id: UUID;
  lab_order_id: UUID;
  lab_test_id: UUID;
  result_value: string | null;
  result_numeric: number | null;
  is_abnormal: boolean | null;
  is_critical: boolean;
  unit_override: string | null;
  note: string | null;
  created_at: string;
}

export interface LabPendingOrderView {
  lab_order_id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  patient_name: string;
  ordering_doctor_id: UUID | null;
  doctor_name: string | null;
  status: LabOrderStatus;
  priority: LabOrderPriority;
  ordered_at: string;
  tests_count: number;
  abnormal_count: number;
  critical_count: number;
}

// ---------------------------------------------------------------------------
// الأشعة والتصوير الطبي (0014) — المرحلة 4.2
// ---------------------------------------------------------------------------
export interface RadiologyExamCategoryRow {
  id: UUID;
  organization_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  sort_order: number;
}

export type RadiologyModality = "xray" | "ct" | "mri" | "ultrasound" | "mammography" | "fluoroscopy" | "other";

export interface RadiologyExamRow {
  id: UUID;
  organization_id: UUID;
  category_id: UUID | null;
  billing_item_id: UUID | null;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  modality: RadiologyModality;
  body_part: string | null;
  requires_contrast: boolean;
  preparation_instructions: string | null;
  estimated_duration_minutes: number | null;
  is_active: boolean;
  created_at: string;
}

export type RadiologyOrderStatus = "ordered" | "scheduled" | "in_progress" | "completed" | "reported" | "cancelled";
export type RadiologyOrderPriority = "routine" | "urgent" | "stat";

export interface RadiologyOrderRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  ordering_doctor_id: UUID | null;
  visit_id: UUID | null;
  clinic_id: UUID | null;
  sales_invoice_id: UUID | null;
  status: RadiologyOrderStatus;
  priority: RadiologyOrderPriority;
  clinical_indication: string | null;
  scheduled_at: string | null;
  ordered_at: string;
  completed_at: string | null;
  reported_at: string | null;
  reported_by: UUID | null;
  notes: string | null;
  created_at: string;
}

export interface RadiologyOrderItemRow {
  id: UUID;
  radiology_order_id: UUID;
  radiology_exam_id: UUID;
  performed_by: UUID | null;
  performed_at: string | null;
  findings: string | null;
  impression: string | null;
  is_urgent_finding: boolean;
  created_at: string;
}

export interface RadiologyUnreportedOrderView {
  radiology_order_id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  patient_name: string;
  ordering_doctor_id: UUID | null;
  doctor_name: string | null;
  status: RadiologyOrderStatus;
  priority: RadiologyOrderPriority;
  ordered_at: string;
  completed_at: string | null;
  exams_count: number;
  findings_written_count: number;
  urgent_findings_count: number;
}

// ---------------------------------------------------------------------------
// الصيدلية + الوصفات + الصرف (0015) — المرحلة 4.3
// ---------------------------------------------------------------------------
export type DrugDosageForm =
  | "tablet"
  | "capsule"
  | "syrup"
  | "injection"
  | "cream"
  | "ointment"
  | "drops"
  | "inhaler"
  | "suppository"
  | "other";

export interface DrugDetailsRow {
  item_id: UUID;
  generic_name: string | null;
  dosage_form: DrugDosageForm;
  strength_text: string | null;
  is_controlled_substance: boolean;
  requires_prescription: boolean;
  default_dosage_instructions: string | null;
}

export type PrescriptionStatus = "draft" | "issued" | "partially_dispensed" | "dispensed" | "cancelled";

export interface PrescriptionRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  doctor_id: UUID | null;
  visit_id: UUID | null;
  clinic_id: UUID | null;
  status: PrescriptionStatus;
  issued_at: string;
  notes: string | null;
  created_at: string;
}

export type PrescriptionRoute =
  | "oral"
  | "topical"
  | "injection"
  | "inhalation"
  | "rectal"
  | "ophthalmic"
  | "otic"
  | "nasal"
  | "other";

export interface PrescriptionItemRow {
  id: UUID;
  prescription_id: UUID;
  drug_item_id: UUID;
  dosage_instructions: string | null;
  frequency: string | null;
  duration_days: number | null;
  route: PrescriptionRoute;
  quantity_prescribed: number;
  dispensed_quantity: number;
  is_substitutable: boolean;
  created_at: string;
}

export interface DispensingRecordRow {
  id: UUID;
  organization_id: UUID;
  prescription_id: UUID | null;
  patient_id: UUID;
  warehouse_id: UUID;
  pharmacist_id: UUID | null;
  sales_invoice_id: UUID | null;
  status: "completed" | "cancelled";
  dispensed_at: string;
  notes: string | null;
  created_at: string;
}

export interface DispensingItemRow {
  id: UUID;
  dispensing_record_id: UUID;
  prescription_item_id: UUID | null;
  drug_item_id: UUID;
  lot_id: UUID | null;
  quantity_dispensed: number;
  unit_price: number;
  created_at: string;
}

export interface PrescriptionPendingDispensingView {
  prescription_id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  patient_name: string;
  doctor_id: UUID | null;
  doctor_name: string | null;
  status: PrescriptionStatus;
  issued_at: string;
  items_count: number;
  fully_dispensed_items_count: number;
}

export interface AvailableDrugLotView {
  lot_id: UUID;
  organization_id: UUID;
  warehouse_id: UUID;
  item_id: UUID;
  lot_number: string | null;
  qty_remaining: number;
  expiry_date: string | null;
  unit_cost: number;
}

// ---------------------------------------------------------------------------
// الباقات (0016) — المرحلة 4.4، آخر موديول من المجموعة الطبية الجديدة
// ---------------------------------------------------------------------------
export interface PackageRow {
  id: UUID;
  organization_id: UUID;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  price: number;
  validity_days: number | null;
  is_active: boolean;
  created_at: string;
}

export interface PackageItemRow {
  id: UUID;
  package_id: UUID;
  item_id: UUID;
  quantity_included: number;
}

export type PatientPackageStatus = "active" | "cancelled";

export interface PatientPackageRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  package_id: UUID;
  sales_invoice_id: UUID | null;
  purchased_at: string;
  expires_at: string | null;
  status: PatientPackageStatus;
  created_at: string;
}

export interface PatientPackageUsageRow {
  id: UUID;
  patient_package_id: UUID;
  package_item_id: UUID;
  quantity_used: number;
  appointment_id: UUID | null;
  used_at: string;
  used_by: UUID | null;
  note: string | null;
}

export interface PatientPackageBalanceView {
  patient_package_id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  patient_name: string;
  package_id: UUID;
  package_name: string;
  status: PatientPackageStatus;
  purchased_at: string;
  expires_at: string | null;
  is_expired: boolean;
  package_item_id: UUID;
  item_id: UUID;
  item_name: string;
  quantity_included: number;
  quantity_used: number;
  quantity_remaining: number;
}

// ---------------------------------------------------------------------------
// المحاسبة ودليل الحسابات (0017) — المرحلة 5.1، أول موديول من مجموعة الإدارة
// ---------------------------------------------------------------------------
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface ChartOfAccountRow {
  id: UUID;
  organization_id: UUID;
  parent_account_id: UUID | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type: AccountType;
  is_active: boolean;
  created_at: string;
}

export type JournalEntryReferenceType =
  | "manual"
  | "sales_invoice"
  | "purchase_invoice"
  | "financial_voucher"
  | "opening_balance";
export type JournalEntryStatus = "draft" | "posted" | "void";

export interface JournalEntryRow {
  id: UUID;
  organization_id: UUID;
  entry_number: number;
  entry_date: string;
  description: string | null;
  reference_type: JournalEntryReferenceType;
  reference_id: UUID | null;
  status: JournalEntryStatus;
  posted_at: string | null;
  created_by: UUID | null;
  created_at: string;
}

export interface JournalEntryLineRow {
  id: UUID;
  journal_entry_id: UUID;
  account_id: UUID;
  debit: number;
  credit: number;
  description: string | null;
}

export interface AccountBalanceView {
  account_id: UUID;
  organization_id: UUID;
  code: string;
  name_ar: string;
  account_type: AccountType;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface TrialBalanceView {
  organization_id: UUID;
  grand_total_debit: number;
  grand_total_credit: number;
}

// ---------------------------------------------------------------------------
// المشتريات والموردون + حركات المخزون (0003 — موجودة أصلًا، المرحلة 5.2 تضيف
// فقط الأنواع المستخدَمة في الواجهة الجديدة، بلا أي تعديل على المخطط)
// ---------------------------------------------------------------------------
export interface DistributorRow {
  id: UUID;
  organization_id: UUID;
  parent_distributor_id: UUID | null;
  distributor_type_value_id: UUID | null;
  is_dental_lab: boolean;
  file_number: number;
  name_ar: string;
  name_en: string | null;
  sales_rep_name: string | null;
  sales_rep_mobile: string | null;
  lab_technician_name: string | null;
  lab_technician_mobile: string | null;
  nationality_value_id: UUID | null;
  profession_value_id: UUID | null;
  id_number: string | null;
  tax_number: string | null;
  gln_number: string | null;
  phone_1: string | null;
  phone_2: string | null;
  mobile_1: string | null;
  mobile_2: string | null;
  email_1: string | null;
  email_2: string | null;
  fax: string | null;
  city_value_id: UUID | null;
  address: string | null;
  note: string | null;
  is_disabled: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 0007 — معامل الأسنان (Dental Lab)
// ---------------------------------------------------------------------------
export interface ToothShadeGuideRow {
  id: UUID;
  organization_id: UUID;
  name: string;
  created_at: string;
}

export interface ToothShadeRow {
  id: UUID;
  shade_guide_id: UUID;
  code: string;
  sort_order: number;
}

export interface DentalLabItemRow {
  id: UUID;
  organization_id: UUID;
  distributor_id: UUID;
  name_ar: string;
  name_en: string | null;
  price: number;
  is_disabled: boolean;
  created_at: string;
}

export type DentalLabOrderStatus = "pending" | "in_progress" | "delivered" | "cancelled";

export interface DentalLabOrderRow {
  id: UUID;
  organization_id: UUID;
  distributor_id: UUID;
  order_number: number;
  order_date: string;
  delivery_date: string | null;
  lab_invoice_number: string | null;
  patient_id: UUID | null;
  doctor_id: UUID | null;
  visit_id: UUID | null;
  shade_guide_id: UUID | null;
  shade_id: UUID | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: DentalLabOrderStatus;
  received_date: string | null;
  received_by: string | null;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface DentalLabOrderItemRow {
  id: UUID;
  order_id: UUID;
  dental_lab_item_id: UUID | null;
  description: string | null;
  tooth_numbers: string[];
  shade_id: UUID | null;
  price: number;
  qty: number;
  discount_percent: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  created_at: string;
}

export interface DentalLabBalanceRow {
  distributor_id: UUID;
  organization_id: UUID;
  name_ar: string;
  total_orders: number;
  total_paid: number;
  balance_due: number;
}

export type PurchasePaymentTerm = "cash" | "credit";

export interface PurchaseInvoiceRow {
  id: UUID;
  organization_id: UUID;
  warehouse_id: UUID;
  distributor_id: UUID | null;
  invoice_number: string | null;
  invoice_date: string;
  payment_term: PurchasePaymentTerm;
  general_discount_amount: number;
  vat_enabled: boolean;
  subtotal_amount: number;
  vat_amount: number;
  net_amount: number;
  note: string | null;
  created_at: string;
}

export interface PurchaseInvoiceItemRow {
  id: UUID;
  purchase_invoice_id: UUID;
  item_id: UUID;
  purchase_price: number;
  qty: number;
  free_qty: number;
  discount_percent: number;
  line_discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  expiry_date: string | null;
  lot_number: string | null;
}

export type StockTransferType = "transfer" | "purchase_requisition" | "disbursement";
/**
 * حالات المناقلة كما في قيد `stock_transfers_status_check` بعد 0098. كانت
 * معرَّفة هنا `pending | approved | rejected | completed` — وهي لغة ما قبل
 * 0098 — فبقيت الشاشة تتكلّم لغةً ترفضها القاعدة.
 */
export type StockTransferStatus =
  | "draft"
  | "requested"
  | "approved"
  | "rejected"
  | "shipped"
  | "received"
  | "cancelled";
export type StockTransferPriority = "low" | "normal" | "high" | "urgent";

export interface StockTransferRow {
  id: UUID;
  organization_id: UUID;
  transfer_type: StockTransferType;
  status: StockTransferStatus;
  priority: StockTransferPriority;
  from_warehouse_id: UUID | null;
  to_warehouse_id: UUID | null;
  note: string | null;
  requested_by: UUID | null;
  approved_by: UUID | null;
  created_at: string;
}

export interface StockTransferItemRow {
  id: UUID;
  transfer_id: UUID;
  item_id: UUID;
  qty: number;
  unit_cost: number | null;
}

export interface InventoryLotRow {
  id: UUID;
  organization_id: UUID;
  warehouse_id: UUID;
  item_id: UUID;
  purchase_invoice_item_id: UUID | null;
  lot_number: string | null;
  unit_cost: number;
  qty_received: number;
  qty_remaining: number;
  expiry_date: string | null;
  received_at: string;
}

export type InventoryMovementType =
  | "purchase_in"
  | "sale_out"
  | "return_in"
  | "return_out"
  | "transfer_in"
  | "transfer_out"
  | "adjustment_in"
  | "adjustment_out"
  | "consumption_out";

export interface InventoryMovementRow {
  id: number;
  organization_id: UUID;
  warehouse_id: UUID;
  item_id: UUID;
  lot_id: UUID | null;
  movement_type: InventoryMovementType;
  qty: number;
  unit_price: number;
  total_amount: number;
  related_purchase_invoice_id: UUID | null;
  related_sales_invoice_id: UUID | null;
  related_stock_transfer_id: UUID | null;
  note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// الرسائل والتنبيهات + سجل التدقيق (0001/0009 — موجودة أصلًا، المرحلة 5.3
// تضيف فقط الأنواع المستخدَمة في الواجهة الجديدة، بلا أي تعديل على المخطط)
// ---------------------------------------------------------------------------
export type MessageEventKey =
  | "file_opened"
  | "appointment_reminder"
  | "lab_results_ready"
  | "invoice_notification"
  | "notes_reminder"
  | "document_expiry_alert"
  | "owner_notification"
  | "sms_balance_low";
export type MessageChannel = "sms" | "email" | "internal";

export interface MessageTemplateRow {
  id: UUID;
  organization_id: UUID;
  event_key: MessageEventKey;
  channel: MessageChannel;
  template_text: string;
  is_disabled: boolean;
  updated_at: string;
}

export type CannedTextLocationKey =
  | "dental_board"
  | "medical_reports"
  | "referral_report"
  | "derma_clinic"
  | "appointment_note"
  | "invoice_dosage_field"
  | "invoice_usage_field";

export interface CannedTextRow {
  id: UUID;
  organization_id: UUID;
  location_key: CannedTextLocationKey;
  text_ar: string;
  text_en: string | null;
  sort_order: number;
  is_disabled: boolean;
  created_at: string;
}

export type MessageLogStatus = "queued" | "sent" | "failed" | "delivered";

export interface MessageLogRow {
  id: number;
  organization_id: UUID;
  patient_id: UUID | null;
  recipient_user_id: UUID | null;
  external_recipient: string | null;
  channel: MessageChannel;
  event_key: MessageEventKey | null;
  message_text: string;
  status: MessageLogStatus;
  provider_message_id: string | null;
  sent_at: string | null;
  created_by: UUID | null;
  created_at: string;
}

export type SmsTransactionType = "top_up" | "consumption" | "adjustment";

export interface SmsCreditTransactionRow {
  id: number;
  organization_id: UUID;
  transaction_type: SmsTransactionType;
  amount: number;
  related_message_id: number | null;
  note: string | null;
  created_at: string;
}

export type AuditActionType = "add" | "update" | "delete" | "login" | "logout" | "print" | "export";

export interface AuditLogRow {
  id: number;
  organization_id: UUID;
  occurred_at: string;
  user_id: UUID | null;
  device_name: string | null;
  action_type: AuditActionType;
  module: string;
  entity_id: UUID | null;
  entity_title: string | null;
  details: string | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// رحلة المريض (Patient Journey) — المرحلة 5.4 — 0018_patient_journey.sql
// ---------------------------------------------------------------------------
export type PatientJourneyEventType =
  | "appointment"
  | "note"
  | "visit"
  | "document"
  | "insurance_claim"
  | "package_purchase"
  | "lab_order"
  | "radiology_order"
  | "prescription"
  | "invoice";

export interface PatientJourneyEventRow {
  patient_id: UUID;
  organization_id: UUID;
  event_at: string;
  event_type: PatientJourneyEventType;
  title: string;
  subtitle: string | null;
  status: string | null;
  source_module: string;
  source_id: UUID;
}

// ---------------------------------------------------------------------------
// المناوبات والحضور (Shifts & Attendance) — المرحلة 6.1 — 0019_hr_shifts_attendance.sql
// ---------------------------------------------------------------------------
export interface ShiftTemplateRow {
  id: UUID;
  organization_id: UUID;
  name_ar: string;
  name_en: string | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  is_night_shift: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeeShiftAssignmentRow {
  id: UUID;
  organization_id: UUID;
  employee_id: UUID;
  shift_template_id: UUID;
  weekdays: number[];
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

export type AttendanceStatus = "pending" | "present" | "late" | "absent" | "on_leave" | "holiday";

export interface AttendanceRecordRow {
  id: UUID;
  organization_id: UUID;
  employee_id: UUID;
  work_date: string;
  shift_template_id: UUID | null;
  check_in_at: string | null;
  check_out_at: string | null;
  status: AttendanceStatus;
  late_minutes: number;
  early_leave_minutes: number;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface TodayAttendanceView {
  organization_id: UUID;
  employee_id: UUID;
  employee_name: string;
  attendance_id: UUID | null;
  check_in_at: string | null;
  check_out_at: string | null;
  status: AttendanceStatus;
  late_minutes: number;
  early_leave_minutes: number;
  note: string | null;
}

// ---------------------------------------------------------------------------
// الإجازات (Leave) — المرحلة 6.2 — 0020_hr_leave.sql
// ---------------------------------------------------------------------------
export interface LeaveTypeRow {
  id: UUID;
  organization_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  annual_entitlement_days: number;
  is_paid: boolean;
  requires_approval: boolean;
  created_at: string;
}

export interface LeaveBalanceRow {
  id: UUID;
  organization_id: UUID;
  employee_id: UUID;
  leave_type_id: UUID;
  year: number;
  entitled_days: number;
  used_days: number;
  created_at: string;
  updated_at: string;
}

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequestRow {
  id: UUID;
  organization_id: UUID;
  employee_id: UUID;
  leave_type_id: UUID;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  status: LeaveRequestStatus;
  approved_by: UUID | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalanceCurrentYearView {
  organization_id: UUID;
  employee_id: UUID;
  employee_name: string;
  leave_type_id: UUID;
  leave_type_name: string;
  entitled_days: number;
  used_days: number;
  remaining_days: number;
}

// ---------------------------------------------------------------------------
// العقود والملفات (Contracts) — المرحلة 6.3 — 0021_hr_contracts.sql
// ---------------------------------------------------------------------------
export type ContractType = "permanent" | "fixed_term" | "probation";
export type ContractStatus = "active" | "renewed" | "terminated" | "expired";

export interface EmployeeContractRow {
  id: UUID;
  organization_id: UUID;
  employee_id: UUID;
  previous_contract_id: UUID | null;
  contract_number: string | null;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  basic_salary: number;
  status: ContractStatus;
  storage_path: string | null;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeContractStatusView extends EmployeeContractRow {
  employee_name: string;
  is_overdue_for_renewal: boolean;
  expiring_within_30_days: boolean;
}

// ---------------------------------------------------------------------------
// التوظيف (Recruitment) — المرحلة 6.4 — 0022_hr_recruitment.sql
// ---------------------------------------------------------------------------
export type JobPostingStatus = "open" | "on_hold" | "closed";

export interface JobPostingRow {
  id: UUID;
  organization_id: UUID;
  branch_id: UUID | null;
  title_ar: string;
  title_en: string | null;
  description: string | null;
  status: JobPostingStatus;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export type CandidateStatus = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

export interface CandidateRow {
  id: UUID;
  organization_id: UUID;
  job_posting_id: UUID | null;
  name_ar: string;
  mobile: string | null;
  email: string | null;
  cv_storage_path: string | null;
  source: string | null;
  status: CandidateStatus;
  rejection_reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type InterviewStage = "phone_screen" | "technical" | "final";
export type InterviewOutcome = "pending" | "passed" | "failed";

export interface CandidateInterviewRow {
  id: UUID;
  organization_id: UUID;
  candidate_id: UUID;
  stage: InterviewStage;
  scheduled_at: string | null;
  interviewer_name: string | null;
  outcome: InterviewOutcome;
  notes: string | null;
  created_at: string;
}

export interface RecruitmentPipelineView {
  organization_id: UUID;
  job_posting_id: UUID;
  job_title: string;
  job_status: JobPostingStatus;
  applied_count: number;
  screening_count: number;
  interview_count: number;
  offer_count: number;
  hired_count: number;
  rejected_count: number;
}

// ---------------------------------------------------------------------------
// تقييم الأداء والتدريب — المرحلة 6.5 — 0023_hr_performance_training.sql
// ---------------------------------------------------------------------------
export interface PerformanceReviewCriterionRow {
  id: UUID;
  organization_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  weight: number;
  created_at: string;
}

export interface PerformanceReviewCycleRow {
  id: UUID;
  organization_id: UUID;
  name_ar: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed";
  created_at: string;
}

export interface PerformanceReviewRow {
  id: UUID;
  organization_id: UUID;
  cycle_id: UUID;
  employee_id: UUID;
  reviewer_user_id: UUID | null;
  overall_score: number;
  comments: string | null;
  status: "draft" | "submitted";
  created_at: string;
  updated_at: string;
}

export interface PerformanceReviewScoreRow {
  id: UUID;
  review_id: UUID;
  criterion_id: UUID;
  score: number;
  note: string | null;
}

export interface TrainingProgramRow {
  id: UUID;
  organization_id: UUID;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  hours: number;
  created_at: string;
}

export type TrainingEnrollmentStatus = "enrolled" | "completed" | "cancelled";

export interface TrainingEnrollmentRow {
  id: UUID;
  organization_id: UUID;
  program_id: UUID;
  employee_id: UUID;
  status: TrainingEnrollmentStatus;
  completed_at: string | null;
  certificate_storage_path: string | null;
  note: string | null;
  created_at: string;
}

export interface EmployeeTrainingSummaryView {
  organization_id: UUID;
  employee_id: UUID;
  employee_name: string;
  completed_programs: number;
  in_progress_programs: number;
  total_completed_hours: number;
}

// ---------------------------------------------------------------------------
// تقارير الموارد البشرية — المرحلة 6.6 (الأخيرة) — 0024_hr_reports.sql
// ---------------------------------------------------------------------------
export interface HrAttendanceMonthlyView {
  organization_id: UUID;
  employee_id: UUID;
  employee_name: string;
  month: string;
  present_days: number;
  late_days: number;
  absent_days: number;
  on_leave_days: number;
  total_late_minutes: number;
}

export interface HrLatestPerformanceView {
  organization_id: UUID;
  employee_id: UUID;
  employee_name: string;
  cycle_name: string;
  overall_score: number;
  period_end: string;
}

export interface HrDashboardSummaryView {
  organization_id: UUID;
  active_employees_count: number;
  pending_leave_requests_count: number;
  contracts_expiring_soon_count: number;
  open_candidates_count: number;
  avg_open_cycle_score: number | null;
  training_hours_this_year: number;
}

// ---------------------------------------------------------------------------
// الدردشة الداخلية (Internal Chat) — المرحلة 7.2 — 0026_internal_messages.sql
// ---------------------------------------------------------------------------
export interface InternalConversationRow {
  id: UUID;
  organization_id: UUID;
  is_group: boolean;
  name_ar: string | null;
  created_by: UUID | null;
  created_at: string;
  last_message_at: string;
}

export interface InternalConversationParticipantRow {
  conversation_id: UUID;
  user_id: UUID;
  joined_at: string;
  last_read_at: string | null;
}

export interface InternalMessageRow {
  id: UUID;
  organization_id: UUID;
  conversation_id: UUID;
  sender_id: UUID;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

export interface InternalUnreadCountView {
  user_id: UUID;
  conversation_id: UUID;
  organization_id: UUID;
  unread_count: number;
}

export interface OrganizationMemberDirectoryView {
  organization_id: UUID;
  user_id: UUID;
  role_key: string;
  display_name: string;
}

// ---------------------------------------------------------------------------
// أنواع عرض مركّبة تُستخدم في الشاشات (Joins شائعة)
// ---------------------------------------------------------------------------
export interface PatientWithDoctor extends PatientRow {
  treating_doctor?: Pick<DoctorRow, "id" | "name_ar"> | null;
}

export interface AppointmentWithRelations extends AppointmentRow {
  patient?: Pick<PatientRow, "id" | "name_ar" | "mobile_number" | "file_number"> | null;
  doctor?: Pick<DoctorRow, "id" | "name_ar"> | null;
  clinic?: Pick<ClinicRow, "id" | "name"> | null;
}

export interface SalesInvoiceWithPatient extends SalesInvoiceRow {
  patient?: Pick<PatientRow, "id" | "name_ar" | "file_number"> | null;
  /** يُجلب في قائمة الفواتير لعرض عمود الطبيب المعالج. */
  doctor?: { name_ar: string } | null;
  /** جنسية الفاتورة كما سُجِّلت وقت الإصدار (لا جنسية المريض اليوم). */
  nationality?: { name_ar: string } | null;
}

export interface TreatmentAgreementRow {
  id: UUID;
  organization_id: UUID;
  agreement_number: number;
  patient_id: UUID;
  doctor_id: UUID | null;
  clinic_id: UUID | null;
  agreement_date: string;
  vat_amount: number;
  total_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
  note: string | null;
  is_disabled: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface TreatmentAgreementItemRow {
  id: UUID;
  agreement_id: UUID;
  item_id: UUID | null;
  description: string | null;
  qty: number;
  unit_price: number;
  discount_percent: number;
  net_amount: number;
  created_at: string;
}

export interface TreatmentAgreementWithRelations extends TreatmentAgreementRow {
  patient?: Pick<PatientRow, "id" | "name_ar" | "file_number"> | null;
  doctor?: Pick<DoctorRow, "id" | "name_ar"> | null;
  clinic?: Pick<ClinicRow, "id" | "name"> | null;
}

// ---------------------------------------------------------------------------
// مكتبة قوالب/نماذج المستندات — 0032_document_templates.sql
// ---------------------------------------------------------------------------
export type DocumentTemplateAppliesTo = "patient" | "employee" | "generic";

export interface DocumentTemplateRow {
  id: UUID;
  organization_id: UUID | null;
  system_key: string | null;
  category_value_id: UUID | null;
  name_ar: string;
  name_en: string | null;
  applies_to: DocumentTemplateAppliesTo;
  body_html: string;
  note: string | null;
  is_disabled: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedDocumentRow {
  id: UUID;
  organization_id: UUID;
  template_id: UUID | null;
  template_name_snapshot: string;
  patient_id: UUID | null;
  employee_id: UUID | null;
  title: string;
  body_html: string;
  extra_fields: Record<string, string>;
  created_by: UUID | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// تقارير الفحوصات المهنية — 0033_occupational_health.sql
// ---------------------------------------------------------------------------
export type OccupationalExamPurpose = "pre_employment" | "periodic" | "return_to_work" | "exit";
export type OccupationalFitnessStatus = "fit" | "fit_with_restrictions" | "unfit" | "pending";

export interface OccupationalExamResultRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  visit_id: UUID;
  exam_purpose: OccupationalExamPurpose;
  fitness_status: OccupationalFitnessStatus;
  employer_value_id: UUID | null;
  restrictions_note: string | null;
  certificate_number: string | null;
  exam_date: string;
  next_exam_due_date: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface OccupationalExamReportView {
  id: UUID;
  organization_id: UUID;
  visit_id: UUID;
  patient_id: UUID;
  patient_name: string;
  patient_file_number: number;
  doctor_id: UUID | null;
  doctor_name: string | null;
  exam_purpose: OccupationalExamPurpose;
  fitness_status: OccupationalFitnessStatus;
  employer_value_id: UUID | null;
  employer_name: string | null;
  restrictions_note: string | null;
  certificate_number: string | null;
  exam_date: string;
  next_exam_due_date: string | null;
  patient_id_number: string | null;
  patient_mobile_number: string | null;
}

// ---------------------------------------------------------------------------
// العملاء الخارجيون — 0035_external_clients.sql
// ---------------------------------------------------------------------------
export interface ExternalClientRow {
  id: UUID;
  organization_id: UUID;
  name: string;
  mobile_1: string | null;
  mobile_2: string | null;
  phone_1: string | null;
  phone_2: string | null;
  registered_at: string;
  note: string | null;
  is_disabled: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// مصمم التقارير المخصص — 0036_custom_reports.sql
// ---------------------------------------------------------------------------
export interface CustomReportRow {
  id: UUID;
  organization_id: UUID;
  name: string;
  source_key: string;
  selected_fields: string[];
  filters: { field: string; operator: string; value: string }[];
  group_by_field: string | null;
  aggregation: "count" | "sum" | null;
  aggregation_field: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// سد فجوات تدقيق اللقطات — المرحلة الأولى (جداول جاهزة كانت بلا واجهة)
// 0037_documents_storage_and_audit_view.sql
// ---------------------------------------------------------------------------

/** تراخيص المنشأة — الجدول موجود منذ 0001 وبقي بلا شاشة (لقطة 79). */
export interface FacilityLicenseRow {
  id: UUID;
  organization_id: UUID;
  authority_name: string;
  license_number: string;
  start_date: string | null;
  end_date: string;
  is_disabled: boolean;
  created_at: string;
}

/** شركات زاتكا — تُستخدم لربط المستودعات والعيادات. */
export interface ZatcaCompanyRow {
  id: UUID;
  organization_id: UUID;
  name: string;
  vat_number: string;
  environment: "sandbox" | "simulation" | "production";
  created_at: string;
}

/** محفظة المريض — الجدول موجود منذ 0001 وبقي بلا واجهة (لقطة 131). */
export interface PatientWalletRow {
  patient_id: UUID;
  organization_id: UUID;
  balance: number;
  updated_at: string;
}

export type WalletTransactionType = "top_up" | "deduction" | "refund" | "adjustment";

export interface PatientWalletTransactionRow {
  id: number;
  organization_id: UUID;
  patient_id: UUID;
  transaction_type: WalletTransactionType;
  amount: number;
  related_voucher_id: UUID | null;
  related_invoice_id: UUID | null;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
}

/** مستندات المريض — الجدول موجود منذ 0006 وبقي بلا واجهة (لقطة 41). */
export interface PatientDocumentRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  visit_id: UUID | null;
  category: "image" | "document";
  doc_type_value_id: UUID | null;
  storage_path: string;
  file_name: string | null;
  note: string | null;
  uploaded_by: UUID | null;
  created_at: string;
}

/** قائمة انتظار المواعيد — الجدول موجود منذ 0002 وبقي بلا واجهة (لقطة 102). */
export type WaitlistStatus = "waiting" | "booked" | "cancelled";

export interface AppointmentWaitlistRow {
  id: UUID;
  organization_id: UUID;
  patient_id: UUID;
  doctor_id: UUID | null;
  specialty_value_id: UUID | null;
  registration_note: string | null;
  appointment_id: UUID | null;
  desired_date: string | null;
  priority: "normal" | "urgent" | "emergency" | "elderly" | "accessibility";
  contacted_at: string | null;
  booked_at: string | null;
  status: WaitlistStatus;
  created_by: UUID | null;
  created_at: string;
}

/** سجل التدقيق مع اسم المستخدم — العرض v_audit_log_detail. */
export interface AuditLogDetailView extends AuditLogRow {
  /**
   * هويّة المنفِّذ. الاسم تغيّر في تاريخ الهجرات: 0037 و0044 سمّياه
   * `user_email`، و0062 أعاد تسميته `user_name`. القاعدة تحمل أحدهما لا
   * كليهما، فالحقلان اختياريان هنا و`actorOf` في شاشة التدقيق هي التي تقرأ
   * الموجود. الشاشة لا تنكسر لأجل اسم عمود.
   */
  user_name?: string | null;
  user_email?: string | null;
}
