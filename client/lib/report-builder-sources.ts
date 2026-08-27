/**
 * سجل مصادر البيانات المتاحة لمصمم التقارير المخصص (شاشة "تقاريري"). قائمة
 * محدودة ومتعمَّدة من الجداول/العروض التي تستخدمها شاشات أخرى بالفعل — لا يوجد
 * أي SQL حر هنا، فقط تعريف أعمدة قابلة للاختيار والفلترة لكل مصدر. الاستعلام
 * الفعلي يُبنى عبر supabase-js (select/eq/ilike...) فتبقى حماية RLS لكل جدول
 * فعّالة تلقائيًا دون أي مسار وصول جديد.
 */

export type ReportFieldType = "text" | "number" | "date" | "boolean" | "enum";

export type ReportFieldDef = {
  key: string;
  label: string;
  type: ReportFieldType;
  enumOptions?: { value: string; label: string }[];
};

export type ReportSourceDef = {
  key: string;
  label: string;
  table: string;
  defaultOrderBy?: string;
  fields: ReportFieldDef[];
};

const YES_NO = [
  { value: "true", label: "نعم" },
  { value: "false", label: "لا" },
];

export const REPORT_SOURCES: ReportSourceDef[] = [
  {
    key: "patients",
    label: "المرضى",
    table: "patients",
    defaultOrderBy: "file_number",
    fields: [
      { key: "file_number", label: "رقم الملف", type: "number" },
      { key: "name_ar", label: "الاسم", type: "text" },
      { key: "mobile_number", label: "رقم الجوال", type: "text" },
      { key: "gender", label: "الجنس", type: "enum", enumOptions: [{ value: "male", label: "ذكر" }, { value: "female", label: "أنثى" }] },
      { key: "birth_date", label: "تاريخ الميلاد", type: "date" },
      { key: "id_number", label: "رقم الهوية", type: "text" },
      { key: "is_tax_registered", label: "مسجَّل ضريبيًا", type: "boolean", enumOptions: YES_NO },
      { key: "file_date", label: "تاريخ التسجيل", type: "date" },
    ],
  },
  {
    key: "appointments",
    label: "المواعيد",
    table: "appointments",
    defaultOrderBy: "scheduled_start",
    fields: [
      { key: "scheduled_start", label: "وقت الموعد", type: "date" },
      {
        key: "status",
        label: "الحالة",
        type: "enum",
        enumOptions: [
          { value: "scheduled", label: "محجوز" },
          { value: "confirmed", label: "مؤكَّد" },
          { value: "arrived", label: "حضر" },
          { value: "completed", label: "مكتمل" },
          { value: "no_show", label: "لم يحضر" },
          { value: "cancelled_by_patient", label: "ألغاه المريض" },
          { value: "walk_in", label: "بلا موعد مسبق" },
        ],
      },
      { key: "sms_reminder_sent", label: "أُرسل تذكير SMS", type: "boolean", enumOptions: YES_NO },
      { key: "note", label: "ملاحظة", type: "text" },
      { key: "created_at", label: "تاريخ الإنشاء", type: "date" },
    ],
  },
  {
    key: "sales_invoices",
    label: "فواتير المبيعات",
    table: "sales_invoices",
    defaultOrderBy: "invoice_number",
    fields: [
      { key: "invoice_number", label: "رقم الفاتورة", type: "number" },
      { key: "invoice_type", label: "النوع", type: "enum", enumOptions: [{ value: "sale", label: "بيع" }, { value: "return", label: "مرتجع" }] },
      {
        key: "status",
        label: "حالة السداد",
        type: "enum",
        enumOptions: [
          { value: "unpaid", label: "غير مسدَّدة" },
          { value: "partial", label: "مسدَّدة جزئيًا" },
          { value: "paid", label: "مسدَّدة" },
          { value: "void", label: "ملغاة" },
        ],
      },
      { key: "is_insurance_invoice", label: "فاتورة تأمين", type: "boolean", enumOptions: YES_NO },
      { key: "net_amount", label: "الصافي", type: "number" },
      { key: "paid_amount", label: "المدفوع", type: "number" },
      { key: "remaining_amount", label: "المتبقي", type: "number" },
      { key: "external_customer_name", label: "عميل خارجي (بلا ملف)", type: "text" },
      { key: "created_at", label: "تاريخ الفاتورة", type: "date" },
    ],
  },
  {
    key: "financial_vouchers",
    label: "السندات المالية",
    table: "financial_vouchers",
    defaultOrderBy: "voucher_number",
    fields: [
      { key: "voucher_number", label: "رقم السند", type: "number" },
      {
        key: "voucher_type",
        label: "النوع",
        type: "enum",
        enumOptions: [
          { value: "receipt", label: "قبض" },
          { value: "expense", label: "صرف" },
          { value: "salary", label: "راتب" },
          { value: "bank_deposit", label: "إيداع بنكي" },
          { value: "bank_withdrawal", label: "سحب بنكي" },
          { value: "bank_transfer", label: "تحويل بنكي" },
        ],
      },
      { key: "amount", label: "المبلغ", type: "number" },
      { key: "payee_name", label: "يُصرف لـ", type: "text" },
      { key: "employee_name", label: "الموظف", type: "text" },
      { key: "description", label: "البيان", type: "text" },
      { key: "voucher_date", label: "التاريخ", type: "date" },
    ],
  },
  {
    key: "employees",
    label: "الموظفون",
    table: "employees",
    defaultOrderBy: "file_number",
    fields: [
      { key: "file_number", label: "رقم الملف", type: "number" },
      { key: "name_ar", label: "الاسم", type: "text" },
      { key: "status", label: "الحالة", type: "enum", enumOptions: [{ value: "active", label: "نشط" }, { value: "terminated", label: "منتهي" }] },
      { key: "mobile_1", label: "رقم الجوال", type: "text" },
      { key: "basic_salary", label: "الراتب الأساسي", type: "number" },
      { key: "total_salary", label: "إجمالي الراتب", type: "number" },
      { key: "hire_date", label: "تاريخ التعيين", type: "date" },
      { key: "national_id", label: "رقم الهوية", type: "text" },
    ],
  },
  {
    key: "attendance_records",
    label: "الحضور والانصراف",
    table: "attendance_records",
    defaultOrderBy: "work_date",
    fields: [
      { key: "work_date", label: "التاريخ", type: "date" },
      {
        key: "status",
        label: "الحالة",
        type: "enum",
        enumOptions: [
          { value: "pending", label: "لم يسجّل" },
          { value: "present", label: "حاضر" },
          { value: "late", label: "متأخر" },
          { value: "absent", label: "غائب" },
          { value: "on_leave", label: "في إجازة" },
          { value: "holiday", label: "عطلة" },
        ],
      },
      { key: "late_minutes", label: "دقائق التأخير", type: "number" },
      { key: "early_leave_minutes", label: "دقائق الانصراف المبكر", type: "number" },
      { key: "note", label: "ملاحظة", type: "text" },
    ],
  },
  {
    key: "v_occupational_exam_report",
    label: "الفحوصات المهنية",
    table: "v_occupational_exam_report",
    defaultOrderBy: "exam_date",
    fields: [
      { key: "patient_name", label: "المريض", type: "text" },
      { key: "employer_name", label: "جهة العمل", type: "text" },
      { key: "doctor_name", label: "الطبيب", type: "text" },
      {
        key: "exam_purpose",
        label: "الغرض",
        type: "enum",
        enumOptions: [
          { value: "pre_employment", label: "ما قبل التوظيف" },
          { value: "periodic", label: "دوري" },
          { value: "return_to_work", label: "العودة للعمل" },
          { value: "exit", label: "مغادرة العمل" },
        ],
      },
      {
        key: "fitness_status",
        label: "حالة اللياقة",
        type: "enum",
        enumOptions: [
          { value: "fit", label: "لائق" },
          { value: "fit_with_restrictions", label: "لائق بقيود" },
          { value: "unfit", label: "غير لائق" },
          { value: "pending", label: "قيد المراجعة" },
        ],
      },
      { key: "exam_date", label: "تاريخ الفحص", type: "date" },
      { key: "next_exam_due_date", label: "الفحص القادم", type: "date" },
      { key: "certificate_number", label: "رقم الشهادة", type: "text" },
    ],
  },
  {
    key: "external_clients",
    label: "العملاء الخارجيون",
    table: "external_clients",
    defaultOrderBy: "name",
    fields: [
      { key: "name", label: "الاسم", type: "text" },
      { key: "mobile_1", label: "جوال 1", type: "text" },
      { key: "is_disabled", label: "معطَّل", type: "boolean", enumOptions: YES_NO },
      { key: "registered_at", label: "تاريخ التسجيل", type: "date" },
    ],
  },
];

export function getReportSource(key: string): ReportSourceDef | undefined {
  return REPORT_SOURCES.find((s) => s.key === key);
}

export type FilterOperator = "contains" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty";

export const OPERATORS_BY_TYPE: Record<ReportFieldType, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: "contains", label: "يحتوي" },
    { value: "eq", label: "يساوي" },
    { value: "is_empty", label: "فارغ" },
    { value: "is_not_empty", label: "غير فارغ" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
  ],
  date: [
    { value: "eq", label: "يساوي" },
    { value: "gte", label: "من (وبعده)" },
    { value: "lte", label: "حتى" },
  ],
  boolean: [{ value: "eq", label: "يساوي" }],
  enum: [{ value: "eq", label: "يساوي" }],
};

export type ReportFilter = {
  field: string;
  operator: FilterOperator;
  value: string;
};
