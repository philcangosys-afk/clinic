import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, RefreshCcw, Table2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { printHtml } from "@/lib/document-merge";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * مركز التقارير — مشغّل واحد لكل تقارير المرحلة 14.
 *
 * **لماذا سجلّ تقارير بدل شاشة لكل تقرير**
 *
 * خمسة عشر تقريرًا مكتوبةً يدويًّا تعني خمسة عشر مرشّح تاريخ، وخمسة عشر
 * تصديرًا، وخمسة عشر مكانًا يُنسى فيه فحصُ الصلاحية. هنا التقرير **وصفٌ**
 * (منظور + أعمدة + مرشّحات + صلاحية)، والمشغّل واحد؛ فما يُصلَح في المرشّح
 * يُصلَح في كل التقارير دفعةً واحدة.
 *
 * كل المناظير `security_invoker = on`، فما يظهر هنا هو ما يراه المستخدم في
 * قاعدة البيانات — الشاشة لا تُوسّع صلاحيته.
 */

type ColumnType = "text" | "money" | "number" | "date" | "datetime" | "bool";

type ReportColumn = {
  key: string;
  label: string;
  type?: ColumnType;
  /** يُجمع في سطر الإجمالي أسفل الجدول */
  total?: boolean;
};

type FilterKey = "branch" | "doctor" | "clinic" | "company" | "status";

type ReportDef = {
  key: string;
  title: string;
  description: string;
  view: string;
  category: "financial" | "insurance" | "operational";
  permission: "reports.financial" | "reports.insurance" | "reports.operational";
  columns: ReportColumn[];
  filters: FilterKey[];
  /** عمود الحالة إن اختلف اسمه */
  statusColumn?: string;
  /** ترتيب افتراضي تنازلي على report_date */
  orderBy?: string;
};

const REPORTS: ReportDef[] = [
  // ── مالية ────────────────────────────────────────────────────────────────
  {
    key: "revenue",
    title: "الإيرادات",
    description: "بحبّة بند الفاتورة — تُجمع حسب الفرع أو الطبيب أو العيادة أو الخدمة",
    view: "v_report_revenue",
    category: "financial",
    permission: "reports.financial",
    filters: ["branch", "doctor", "clinic", "status"],
    statusColumn: "invoice_status",
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "invoice_number", label: "الفاتورة" },
      { key: "branch_name", label: "الفرع" },
      { key: "clinic_name", label: "العيادة" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "item_name", label: "الخدمة" },
      { key: "category_name", label: "التصنيف" },
      { key: "patient_name", label: "المريض" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "qty", label: "الكمّية", type: "number", total: true },
      { key: "gross_amount", label: "الإجمالي", type: "money", total: true },
      { key: "discount_amount", label: "الخصم", type: "money", total: true },
      { key: "vat_amount", label: "الضريبة", type: "money", total: true },
      { key: "net_amount", label: "الصافي", type: "money", total: true },
      { key: "patient_share", label: "حصّة المريض", type: "money", total: true },
      { key: "insurer_share", label: "حصّة الشركة", type: "money", total: true },
    ],
  },
  {
    key: "receipts",
    title: "المقبوضات حسب طريقة الدفع",
    description: "السندات والمرتجعات موقَّعةً ليصحّ الجمع",
    view: "v_report_receipts",
    category: "financial",
    permission: "reports.financial",
    filters: ["branch", "doctor"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "voucher_number", label: "السند" },
      { key: "branch_name", label: "الفرع" },
      { key: "payment_method_name", label: "طريقة الدفع" },
      { key: "register_name", label: "الصندوق" },
      { key: "patient_name", label: "المريض" },
      { key: "invoice_number", label: "الفاتورة" },
      { key: "amount", label: "المبلغ", type: "money", total: true },
      { key: "signed_amount", label: "المبلغ الموقَّع", type: "money", total: true },
      { key: "is_refund", label: "مرتجع", type: "bool" },
    ],
  },
  {
    key: "outstanding",
    title: "الفواتير غير المسدَّدة وذمم المرضى",
    description: "أعمار الدين محسوبةً من تاريخ الإصدار — المسوّدة ليست دينًا",
    view: "v_report_outstanding",
    category: "financial",
    permission: "reports.financial",
    filters: ["branch", "doctor", "status"],
    columns: [
      { key: "report_date", label: "تاريخ الإصدار", type: "date" },
      { key: "invoice_number", label: "الفاتورة" },
      { key: "branch_name", label: "الفرع" },
      { key: "patient_name", label: "المريض" },
      { key: "file_number", label: "رقم الملف" },
      { key: "patient_phone", label: "الجوال" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "net_amount", label: "الصافي", type: "money", total: true },
      { key: "paid_amount", label: "المسدَّد", type: "money", total: true },
      { key: "remaining_amount", label: "المتبقّي", type: "money", total: true },
      { key: "days_outstanding", label: "الأيام", type: "number" },
      { key: "ageing_bucket", label: "شريحة العمر" },
    ],
  },
  {
    key: "discounts",
    title: "الخصومات والاستردادات والإلغاءات",
    description: "بسببها ومَن أقرّها — خصمٌ بلا سبب ولا مُقرٍّ يظهر فارغًا هنا",
    view: "v_report_discounts_refunds",
    category: "financial",
    permission: "reports.financial",
    filters: ["branch", "doctor"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "entry_kind", label: "النوع" },
      { key: "reference_number", label: "المرجع" },
      { key: "branch_name", label: "الفرع" },
      { key: "patient_name", label: "المريض" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "amount", label: "المبلغ", type: "money", total: true },
      { key: "percent_value", label: "النسبة", type: "number" },
      { key: "reason", label: "السبب" },
      { key: "acted_by_email", label: "مَن أقرّه" },
    ],
  },
  {
    key: "notes",
    title: "الإشعارات الدائنة والمدينة",
    description: "مرتبطةً بالفاتورة التي تصحّحها وسببها",
    view: "v_report_credit_debit_notes",
    category: "financial",
    permission: "reports.financial",
    filters: ["branch"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "document_number", label: "رقم المستند" },
      { key: "note_type", label: "نوع الإشعار" },
      { key: "branch_name", label: "الفرع" },
      { key: "patient_name", label: "المريض" },
      { key: "corrects_document_number", label: "يصحّح المستند" },
      { key: "note_reason", label: "السبب" },
      { key: "subtotal_amount", label: "قبل الضريبة", type: "money", total: true },
      { key: "vat_amount", label: "الضريبة", type: "money", total: true },
      { key: "net_amount", label: "الصافي", type: "money", total: true },
    ],
  },
  // ── تأمينية ──────────────────────────────────────────────────────────────
  {
    key: "claims",
    title: "المطالبات حسب الحالة",
    description: "مدّة المعالجة تُقاس من الإرسال لا من الإنشاء",
    view: "v_report_claims",
    category: "insurance",
    permission: "reports.insurance",
    filters: ["branch", "doctor", "clinic", "company", "status"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "status", label: "الحالة" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "branch_name", label: "الفرع" },
      { key: "patient_name", label: "المريض" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "claimed_amount", label: "المطالَب", type: "money", total: true },
      { key: "approved_amount", label: "المعتمَد", type: "money", total: true },
      { key: "rejected_amount", label: "المرفوض", type: "money", total: true },
      { key: "settled_amount", label: "المسدَّد", type: "money", total: true },
      { key: "unsettled_amount", label: "لم يُحصَّل", type: "money", total: true },
      { key: "days_to_response", label: "أيام حتى الردّ", type: "number" },
      { key: "days_awaiting_response", label: "أيام انتظار", type: "number" },
      { key: "resubmission_count", label: "إعادات التقديم", type: "number" },
    ],
  },
  {
    key: "rejections",
    title: "الرفض حسب الشركة والسبب والخدمة",
    description: "بحبّة البند — لتُعالَج الأسباب المتكرّرة لا لتُعدّ المطالبات",
    view: "v_report_claim_rejections",
    category: "insurance",
    permission: "reports.insurance",
    filters: ["branch", "doctor", "company"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "rejection_code", label: "كود الرفض" },
      { key: "rejection_reason", label: "السبب" },
      { key: "item_name", label: "الخدمة" },
      { key: "service_code", label: "كود الخدمة" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "patient_name", label: "المريض" },
      { key: "claimed_amount", label: "المطالَب", type: "money", total: true },
      { key: "approved_amount", label: "المعتمَد", type: "money", total: true },
      { key: "rejected_amount", label: "المرفوض", type: "money", total: true },
    ],
  },
  {
    key: "preauth_expiring",
    title: "الموافقات المقاربة على الانتهاء",
    description: "معتمَدة ولم تُستهلك — تنتهي بلا فوترة فتضيع",
    view: "v_report_preauth_expiring",
    category: "insurance",
    permission: "reports.insurance",
    filters: ["branch", "doctor", "company", "status"],
    columns: [
      { key: "report_date", label: "تنتهي في", type: "date" },
      { key: "days_remaining", label: "الأيام المتبقّية", type: "number" },
      { key: "status", label: "الحالة" },
      { key: "approval_number", label: "رقم الموافقة" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "patient_name", label: "المريض" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "item_name", label: "الخدمة" },
      { key: "approved_amount", label: "المعتمَد", type: "money", total: true },
    ],
  },
  {
    key: "settlement_variance",
    title: "فرق حصّة التأمين المتوقَّعة والفعلية",
    description: "عرضٌ للمراجعة فقط — لا يُحوَّل الفرق إلى المريض من هنا",
    view: "v_report_settlement_variance",
    category: "insurance",
    permission: "reports.insurance",
    filters: ["branch", "company", "status"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "insurance_company_name", label: "شركة التأمين" },
      { key: "invoice_number", label: "الفاتورة" },
      { key: "patient_name", label: "المريض" },
      { key: "expected_insurer_share", label: "المتوقَّع", type: "money", total: true },
      { key: "approved_amount", label: "المعتمَد", type: "money", total: true },
      { key: "approval_variance", label: "فرق الاعتماد", type: "money", total: true },
      { key: "settled_amount", label: "المسدَّد", type: "money", total: true },
      { key: "settlement_variance", label: "فرق التسوية", type: "money", total: true },
      { key: "status", label: "الحالة" },
    ],
  },
  // ── تشغيلية ──────────────────────────────────────────────────────────────
  {
    key: "appointments",
    title: "المواعيد والوصول وعدم الحضور",
    description: "الانتظار يُقاس من الموعد أو الوصول أيّهما أحدث",
    view: "v_report_appointments",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor", "clinic", "status"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "status", label: "الحالة" },
      { key: "branch_name", label: "الفرع" },
      { key: "clinic_name", label: "العيادة" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "patient_name", label: "المريض" },
      { key: "did_arrive", label: "وصل", type: "bool" },
      { key: "is_no_show", label: "لم يحضر", type: "bool" },
      { key: "no_show_reason", label: "سبب عدم الحضور" },
      { key: "wait_minutes", label: "الانتظار (د)", type: "number" },
      { key: "consultation_minutes", label: "الكشف (د)", type: "number" },
      { key: "visit_minutes", label: "الزيارة (د)", type: "number" },
    ],
  },
  {
    key: "productivity",
    title: "إنتاجية الأطباء",
    description: "الإيراد منسوب لبنود الطبيب نفسه لا لإيراد الفاتورة كاملةً",
    view: "v_report_doctor_productivity",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "branch_name", label: "الفرع" },
      { key: "visit_count", label: "الزيارات", type: "number", total: true },
      { key: "completed_visits", label: "المكتملة", type: "number", total: true },
      { key: "avg_visit_minutes", label: "متوسّط الزيارة (د)", type: "number" },
      { key: "service_qty", label: "الخدمات", type: "number", total: true },
      { key: "net_revenue", label: "الإيراد", type: "money", total: true },
      { key: "patient_share", label: "حصّة المريض", type: "money", total: true },
      { key: "insurer_share", label: "حصّة الشركة", type: "money", total: true },
    ],
  },
  {
    key: "orders",
    title: "الخدمات والمختبر والأشعة",
    description: "الطلبات كلّها في تدفّق واحد بمدّة الإنجاز",
    view: "v_report_orders",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor", "clinic", "status"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "order_kind", label: "النوع" },
      { key: "status", label: "الحالة" },
      { key: "priority", label: "الأولوية" },
      { key: "branch_name", label: "الفرع" },
      { key: "clinic_name", label: "العيادة" },
      { key: "doctor_name", label: "الطبيب الطالب" },
      { key: "patient_name", label: "المريض" },
      { key: "turnaround_hours", label: "مدّة الإنجاز (س)", type: "number" },
    ],
  },
  {
    key: "dispensing",
    title: "صرف الأدوية",
    description: "الدواء والتشغيلة وتاريخ صلاحيتها والكمّية والقيمة",
    view: "v_report_dispensing",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor", "status"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "status", label: "الحالة" },
      { key: "branch_name", label: "الفرع" },
      { key: "warehouse_name", label: "المستودع" },
      { key: "item_name", label: "الدواء" },
      { key: "lot_number", label: "التشغيلة" },
      { key: "expiry_date", label: "الصلاحية", type: "date" },
      { key: "patient_name", label: "المريض" },
      { key: "doctor_name", label: "الطبيب الواصف" },
      { key: "qty", label: "الكمّية", type: "number", total: true },
      { key: "value_amount", label: "القيمة", type: "money", total: true },
    ],
  },
  {
    key: "stock",
    title: "حركة المخزون",
    description: "بنوعها وتشغيلتها وقيمتها ومرجعها",
    view: "v_report_stock_movements",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "movement_type", label: "نوع الحركة" },
      { key: "branch_name", label: "الفرع" },
      { key: "warehouse_name", label: "المستودع" },
      { key: "item_name", label: "الصنف" },
      { key: "lot_number", label: "التشغيلة" },
      { key: "expiry_date", label: "الصلاحية", type: "date" },
      { key: "qty", label: "الكمّية", type: "number", total: true },
      { key: "unit_price", label: "سعر الوحدة", type: "money" },
      { key: "total_amount", label: "القيمة", type: "money", total: true },
      { key: "note", label: "ملاحظة" },
    ],
  },
  {
    key: "funnel",
    title: "رحلة المريض من الموعد حتى التحصيل",
    description: "الفجوة بين مرحلتين متجاورتين هي موضع التسرّب",
    view: "v_report_patient_funnel",
    category: "operational",
    permission: "reports.operational",
    filters: ["branch", "doctor", "clinic"],
    columns: [
      { key: "report_date", label: "التاريخ", type: "date" },
      { key: "branch_name", label: "الفرع" },
      { key: "clinic_name", label: "العيادة" },
      { key: "doctor_name", label: "الطبيب" },
      { key: "patient_name", label: "المريض" },
      { key: "appointment_status", label: "الموعد" },
      { key: "reached_reception", label: "استُقبل", type: "bool" },
      { key: "reached_visit", label: "زيارة", type: "bool" },
      { key: "visit_signed", label: "وُقّعت", type: "bool" },
      { key: "reached_invoice", label: "فاتورة", type: "bool" },
      { key: "reached_payment", label: "سُدّد جزئيًا", type: "bool" },
      { key: "fully_collected", label: "حُصّل كاملًا", type: "bool" },
      { key: "net_amount", label: "الصافي", type: "money", total: true },
      { key: "remaining_amount", label: "المتبقّي", type: "money", total: true },
    ],
  },
];

const CATEGORY_LABELS: Record<ReportDef["category"], string> = {
  financial: "مالية",
  insurance: "تأمينية",
  operational: "تشغيلية",
};

const ROW_LIMIT = 2000;

/**
 * التاريخ **بتوقيت المتصفح** لا بـ UTC.
 *
 * `toISOString().slice(0,10)` يعطي تاريخ UTC: في الرياض (UTC+3) الساعة 1:30
 * فجرًا يُعيد تاريخ الأمس — فيُفتح التقرير على نطاق يُسقط اليوم كلّه بلا إشارة.
 */
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function defaultFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return toDateInputValue(date);
}

/**
 * الأرقام بلغة الواجهة.
 *
 * `toLocaleString("ar-SA")` يُخرج أرقامًا هندية (٢٥٠)، وهي الصحيحة للعرض
 * العربي لكنها **غير صالحة للتصدير**: Excel يقرؤها نصًّا فتنهار كل معادلة
 * في الملف. لذلك التصدير يستخدم `en-US` دائمًا مهما كانت لغة الشاشة.
 */
function formatValue(value: any, type: ColumnType | undefined, locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "money":
      return Number(value).toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case "number":
      return Number(value).toLocaleString(locale, { maximumFractionDigits: 2 });
    case "date":
      return new Date(value).toLocaleDateString(locale);
    case "datetime":
      return new Date(value).toLocaleString(locale);
    case "bool":
      return value ? "نعم" : "لا";
    default:
      return String(value);
  }
}

export default function ReportCenter() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { toast } = useToast();

  const visibleReports = useMemo(
    () => REPORTS.filter((r) => can(r.permission)),
    [can],
  );

  const [activeKey, setActiveKey] = useState<string>(visibleReports[0]?.key ?? "");
  const report = visibleReports.find((r) => r.key === activeKey) ?? visibleReports[0];

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toDateInputValue(new Date()));
  const [branch, setBranch] = useState("all");
  const [doctor, setDoctor] = useState("all");
  const [clinic, setClinic] = useState("all");
  const [company, setCompany] = useState("all");
  const [status, setStatus] = useState("all");
  const [useArabicNumerals, setUseArabicNumerals] = useState(true);

  const locale = useArabicNumerals ? "ar-SA" : "en-US";

  // ── قوائم المرشّحات: النشطة وغير المؤرشفة فقط
  const branches = useQuery({
    queryKey: ["rc-branches", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const doctors = useQuery({
    queryKey: ["rc-doctors", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, is_enabled")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
  const clinics = useQuery({
    queryKey: ["rc-clinics", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, is_disabled")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const companies = useQuery({
    queryKey: ["rc-companies", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name_ar, is_disabled")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useQuery({
    queryKey: [
      "report-center", report?.key, organization?.id,
      from, to, branch, doctor, clinic, company, status,
    ],
    enabled: Boolean(organization?.id && report),
    queryFn: async () => {
      let query = supabase
        .from(report!.view)
        .select("*")
        .eq("organization_id", organization!.id)
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date", { ascending: false })
        .limit(ROW_LIMIT);

      if (branch !== "all") query = query.eq("branch_id", branch);
      if (doctor !== "all" && report!.filters.includes("doctor")) {
        query = query.eq("doctor_id", doctor);
      }
      if (clinic !== "all" && report!.filters.includes("clinic")) {
        query = query.eq("clinic_id", clinic);
      }
      if (company !== "all" && report!.filters.includes("company")) {
        query = query.eq("insurance_company_id", company);
      }
      if (status !== "all" && report!.filters.includes("status")) {
        query = query.eq(report!.statusColumn ?? "status", status);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const data = rows.data ?? [];

  // قيم الحالة تُشتقّ من الصفوف نفسها: لا قائمة ثابتة تتقادم مع الهجرات
  const statusOptions = useMemo(() => {
    if (!report?.filters.includes("status")) return [];
    const col = report.statusColumn ?? "status";
    return Array.from(
      new Set(data.map((r) => r[col]).filter((v) => v !== null && v !== undefined)),
    ).sort();
  }, [data, report]);

  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const col of report?.columns ?? []) {
      if (!col.total) continue;
      out[col.key] = data.reduce((sum, r) => sum + Number(r[col.key] ?? 0), 0);
    }
    return out;
  }, [data, report]);

  const exportCsv = () => {
    if (!report || data.length === 0) return;
    const header = report.columns.map((c) => c.label);
    const lines = [header.join(",")];
    for (const row of data) {
      lines.push(
        report.columns
          .map((c) => {
            const raw = row[c.key];
            if (raw === null || raw === undefined) return "";
            // التصدير بأرقام لاتينية دائمًا: الأرقام الهندية تُقرأ نصًّا في Excel
            const value =
              c.type === "money" || c.type === "number" ? String(raw) : String(raw);
            return `"${value.replace(/"/g, '""')}"`;
          })
          .join(","),
      );
    }
    // BOM ليقرأ Excel العربية بترميز صحيح
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.key}-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "صُدّر التقرير", description: `${data.length} صفًّا` });
  };

  const printReport = () => {
    if (!report || data.length === 0) return;
    const esc = (v: any) =>
      String(v ?? "").replace(/[&<>]/g, (ch) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch,
      );
    const head = report.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
    const body = data
      .map(
        (row) =>
          `<tr>${report.columns
            .map((c) => `<td>${esc(formatValue(row[c.key], c.type, locale))}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const footer = report.columns
      .map((c) =>
        c.total
          ? `<td><b>${esc(formatValue(totals[c.key], c.type, locale))}</b></td>`
          : "<td></td>",
      )
      .join("");
    printHtml(
      report.title,
      `<h2 style="margin:0 0 4px">${esc(report.title)}</h2>
       <p style="margin:0 0 12px;font-size:12px;color:#555">
         ${esc(organization?.name ?? "")} · من ${esc(from)} إلى ${esc(to)} · ${data.length} صفًّا
       </p>
       <table style="width:100%;border-collapse:collapse;font-size:11px" border="1">
         <thead><tr>${head}</tr></thead>
         <tbody>${body}</tbody>
         <tfoot><tr>${footer}</tr></tfoot>
       </table>`,
      "a4",
    );
  };

  if (visibleReports.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          لا تملك صلاحية مشاهدة أيّ عائلة تقارير. راجع مدير المنشأة.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Table2 className="h-4 w-4" />
            مركز التقارير
          </CardTitle>
          <CardDescription>
            كل التقارير تقرأ من مصدر واحد للأرقام المالية، وتُطبَّق عليها صلاحيتك وعزل
            المنشأة والفرع تلقائيًا.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(["financial", "insurance", "operational"] as const).map((cat) => {
              const inCat = visibleReports.filter((r) => r.category === cat);
              if (inCat.length === 0) return null;
              return (
                <div key={cat} className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{CATEGORY_LABELS[cat]}</Badge>
                  {inCat.map((r) => (
                    <Button
                      key={r.key}
                      size="sm"
                      variant={r.key === report?.key ? "default" : "ghost"}
                      onClick={() => {
                        setActiveKey(r.key);
                        setStatus("all");
                      }}
                    >
                      {r.title}
                    </Button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>من تاريخ</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى تاريخ</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {report?.filters.includes("branch") && (
              <div className="flex flex-col gap-1.5">
                <Label>الفرع</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفروع</SelectItem>
                    {(branches.data ?? []).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {report?.filters.includes("doctor") && (
              <div className="flex flex-col gap-1.5">
                <Label>الطبيب</Label>
                <Select value={doctor} onValueChange={setDoctor}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأطباء</SelectItem>
                    {(doctors.data ?? []).map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {report?.filters.includes("clinic") && (
              <div className="flex flex-col gap-1.5">
                <Label>العيادة</Label>
                <Select value={clinic} onValueChange={setClinic}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل العيادات</SelectItem>
                    {(clinics.data ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {report?.filters.includes("company") && (
              <div className="flex flex-col gap-1.5">
                <Label>شركة التأمين</Label>
                <Select value={company} onValueChange={setCompany}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الشركات</SelectItem>
                    {(companies.data ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {report?.filters.includes("status") && statusOptions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>الحالة</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    {statusOptions.map((s) => (
                      <SelectItem key={String(s)} value={String(s)}>{String(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => rows.refetch()}>
                <RefreshCcw className="h-3.5 w-3.5" />
                تحديث
              </Button>
              {/* التصدير صلاحية مستقلّة: إخراج البيانات ليس تابعًا لقراءتها */}
              {can("reports.export") && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.length === 0}
                    onClick={exportCsv}
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.length === 0}
                    onClick={printReport}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    طباعة / PDF
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUseArabicNumerals((v) => !v)}
                title="تبديل شكل الأرقام في العرض"
              >
                {useArabicNumerals ? "١٢٣" : "123"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.length} صفًّا
              {data.length >= ROW_LIMIT
                ? ` — بلغ الحدّ الأقصى (${ROW_LIMIT})، ضيّق نطاق التاريخ`
                : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{report?.title}</CardTitle>
          <CardDescription>{report?.description}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.isLoading && <Skeleton className="h-40 w-full" />}
          {rows.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل التقرير:{" "}
              {rows.error instanceof Error ? rows.error.message : "خطأ غير متوقع"}
            </p>
          )}
          {!rows.isLoading && !rows.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  {report?.columns.map((c) => (
                    <TableHead key={c.key} className="whitespace-nowrap">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row, index) => (
                  <TableRow key={row.id ?? row.line_id ?? row.invoice_id ?? index}>
                    {report?.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={
                          c.type === "money" || c.type === "number"
                            ? "whitespace-nowrap font-mono text-xs"
                            : "whitespace-nowrap text-sm"
                        }
                      >
                        {formatValue(row[c.key], c.type, locale)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {data.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={report?.columns.length ?? 1}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      لا بيانات في هذا النطاق.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {data.length > 0 && (
                <TableFooter>
                  <TableRow>
                    {report?.columns.map((c) => (
                      <TableCell key={c.key} className="whitespace-nowrap font-mono text-xs">
                        {c.total ? formatValue(totals[c.key], c.type, locale) : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
