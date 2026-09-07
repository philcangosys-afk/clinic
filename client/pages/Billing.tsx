import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Receipt, WalletCards, Undo2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import NewInvoiceDialog, {
  type BillingAppointmentContext,
} from "@/components/billing/NewInvoiceDialog";
import BusinessDayPanel from "@/components/billing/BusinessDayPanel";
import type { SalesInvoiceStatus, SalesInvoiceWithPatient } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { printHtml, type PaperSize } from "@/lib/document-merge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/lib/permissions";
import TaxSettingsTab, {
  EInvoicePanel,
  VatReturnPanel,
  TaxInvoicePreview,
} from "@/components/billing/TaxSettingsTab";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  draft: "مسوّدة",
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة بالكامل",
  partially_refunded: "مستردّة جزئيًا",
  refunded: "مستردّة بالكامل",
  void: "ملغاة",
};
const STATUS_BADGE: Record<SalesInvoiceStatus, string> = {
  unpaid: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-slate-100 text-slate-500",
  draft: "bg-amber-100 text-amber-800",
  partially_refunded: "bg-orange-100 text-orange-800",
  refunded: "bg-rose-100 text-rose-700",
};

function useInvoices(organizationId: string | undefined, status: string, quotesOnly: boolean) {
  return useQuery({
    queryKey: ["invoices-list", organizationId, status, quotesOnly],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, document_number, document_type, appointment_id, created_at, status, is_temporary, invoice_type, subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, paid_amount, remaining_amount, insurance_share_amount, patient_share_amount, insurance_company_name, external_customer_name, zatca_invoice_number, zatca_qr, is_insurance_invoice, created_by, nationality_value_id, patient:patients!sales_invoices_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!sales_invoices_doctor_tenant_fk(name_ar), nationality:lookup_values!sales_invoices_nationality_value_id_fkey(name_ar)",
        )
        // التصفية بالمؤسسة إلزامية: سياسة RLS تسمح بكل مؤسسة **ينتمي إليها**
        // المستخدم، لا بالمؤسسة النشطة وحدها — فبدونها كانت قائمة عضو في
        // منشأتين تخلط فواتيرهما ويجمع الرأس إجماليَّ الاثنتين معًا.
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (status !== "all") query = query.eq("status", status);
      query = query.eq("is_temporary", quotesOnly);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SalesInvoiceWithPatient[];
    },
  });
}

/**
 * اسم الموظف مُصدِر الفاتورة يأتي من `v_organization_members_directory`
 * (0026): `sales_invoices.created_by` معرّف مستخدم، والعميل لا يقرأ
 * `auth.users` مباشرة.
 */
function useMemberNames(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["member-names", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return new Map(
        ((data ?? []) as { user_id: string; display_name: string }[]).map((row) => [
          row.user_id,
          row.display_name,
        ]),
      );
    },
  });
}


/**
 * طباعة الفاتورة (لقطة 20). لم يكن هناك أي مسار طباعة للفواتير رغم أن
 * `print_settings.invoice_paper_size` موجود منذ 0010 — أي أن الإعداد كان
 * يُحفَظ ولا يقرؤه شيء.
 *
 * البنود تُجلب عند الضغط لا مع القائمة: تحميل بنود 50 فاتورة مقدّمًا لأجل
 * فاتورة واحدة قد تُطبع هدرٌ لكل مستخدم في كل فتح للشاشة.
 */
async function printInvoice(
  invoice: SalesInvoiceWithPatient,
  organizationName: string,
  taxNumber: string | null,
  paper: PaperSize,
  footerNote: string | null,
) {
  const { data: items, error } = await supabase
    .from("sales_invoice_items")
    .select("description, price, qty, discount_amount, vat_amount, net_amount")
    .eq("invoice_id", invoice.id);
  if (error) throw error;

  const esc = (value: unknown) =>
    String(value ?? "").replace(/[&<>"]/g, (ch) =>
      ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
    );
  const money = (value: unknown) => Number(value ?? 0).toFixed(2);

  const rows = (items ?? [])
    .map(
      (line) =>
        `<tr><td>${esc(line.description)}</td><td>${line.qty}</td><td>${money(line.price)}</td>` +
        `<td>${money(line.discount_amount)}</td><td>${money(line.net_amount)}</td></tr>`,
    )
    .join("");

  printHtml(
    `فاتورة ${invoice.invoice_number}`,
    `<h2>${esc(organizationName)}</h2>
     ${taxNumber ? `<p>الرقم الضريبي: ${esc(taxNumber)}</p>` : ""}
     <p>
       ${invoice.invoice_type === "return" ? "فاتورة مرتجع" : "فاتورة مبيعات"} رقم
       <strong>${invoice.invoice_number}</strong><br />
       التاريخ: ${formatDateTime(invoice.created_at)}<br />
       العميل: ${esc(invoice.patient?.name_ar ?? invoice.external_customer_name ?? "—")}
       ${invoice.patient?.file_number ? ` · ملف ${invoice.patient.file_number}` : ""}
       ${invoice.doctor?.name_ar ? `<br />الطبيب: ${esc(invoice.doctor.name_ar)}` : ""}
       ${invoice.zatca_invoice_number ? `<br />زاتكا: ${esc(invoice.zatca_invoice_number)}` : ""}
     </p>
     <table border="1" cellpadding="4">
       <thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الصافي</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p>
       الإجمالي قبل الضريبة: ${money(invoice.subtotal_amount)}<br />
       الخصم: ${money(invoice.discount_amount)}<br />
       ${Number(invoice.exemption_amount ?? 0) > 0 ? `الإعفاء: ${money(invoice.exemption_amount)}<br />` : ""}
       الضريبة: ${money(invoice.vat_amount)}<br />
       <strong>الصافي: ${money(invoice.net_amount)}</strong><br />
       ${
         /**
          * حصّتا التأمين والمريض تُحسَبان في القاعدة (0052) وتُخزَّنان في
          * `insurance_share_amount` و`patient_share_amount` — ولم تكن تُقرآن
          * في أي مكان. فالمريض المؤمَّن يستلم إيصالًا يقول «الصافي 500
          * والمتبقي 500» بينما لا يخصّه منها إلا حصته. رقم يخيف المريض بلا
          * سبب، ويجعل تحصيل الاستقبال خاطئًا.
          */
         invoice.is_insurance_invoice
           ? `حصة شركة التأمين${invoice.insurance_company_name ? ` (${esc(invoice.insurance_company_name)})` : ""}: ${money(invoice.insurance_share_amount ?? 0)}<br />
              <strong>حصة المريض: ${money(invoice.patient_share_amount ?? invoice.net_amount)}</strong><br />`
           : ""
       }
       المدفوع: ${money(invoice.paid_amount)}<br />
       المتبقي: ${money(invoice.remaining_amount)}
     </p>
     ${
       /**
        * حمولة رمز QR لزاتكا (TLV ثم Base64) تُولَّد في القاعدة (0058) وتُخزَّن
        * في `sales_invoices.zatca_qr` — وكان العمود فارغًا في كل فاتورة صدرت
        * من النظام.
        *
        * تُطبع هنا **نصًّا** لا صورةً: توليد صورة QR يحتاج مكتبة، وإضافتها
        * تتطلب تحديث `pnpm-lock.yaml` — وبناء Netlify يعمل بقفل مجمَّد فيفشل
        * إن اختلّ. الحمولة نفسها هي المطلوب نظاميًا، والصورة تمثيلٌ لها؛
        * فطباعتها نصًّا إفصاح صحيح ريثما تُضاف المكتبة، لا بديل نهائي عنها.
        */
       invoice.zatca_qr
         ? `<p style="font-size:9px;word-break:break-all;direction:ltr;text-align:left">
              <span style="direction:rtl;display:block">حمولة رمز QR (زاتكا):</span>${esc(invoice.zatca_qr)}
            </p>`
         : ""
     }
     ${footerNote ? `<p>${esc(footerNote)}</p>` : ""}`,
    paper,
  );
}

/** إعدادات الطباعة للمؤسسة — مقاس الورق وتذييل الفاتورة (0010). */
function usePrintSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["print-settings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("print_settings")
        .select("invoice_paper_size, footer_note")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { invoice_paper_size: PaperSize; footer_note: string | null } | null;
    },
  });
}


export default function Billing() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const [searchParams] = useSearchParams();
  // تقويم المنشأة يُحترَم هنا كما في باقي الشاشات: كان الجدول يطبع بالتقويم
  // الذي يختاره المتصفّح للعربية (هجريًّا في كروم) بلا نظرٍ إلى الإعداد.
  const { calendarDisplay } = useLocaleSettings();
  const appointmentId = searchParams.get("appointmentId");
  const memberNames = useMemberNames(organization?.id);
  const printSettings = usePrintSettings(organization?.id);
  const [statusFilter, setStatusFilter] = useState("all");
  const [quotesOnly, setQuotesOnly] = useState(false);
  const [showShifts, setShowShifts] = useState(false);
  const [showTax, setShowTax] = useState(false);
  /** تبويب اليومية المالية — إغلاق يوم العمل وجرد ما جرى فيه. */
  const [showDay, setShowDay] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<SalesInvoiceWithPatient | null>(null);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const { can } = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<SalesInvoiceWithPatient | null>(null);
  const [returnTarget, setReturnTarget] = useState<SalesInvoiceWithPatient | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageBilling = legacyMode || ["owner", "organization_admin", "accountant", "receptionist"].includes(membership?.role_key ?? "");
  const invoices = useInvoices(organization?.id, statusFilter, quotesOnly);
  const appointment = useQuery({
    queryKey: ["billing-appointment", organization?.id, appointmentId],
    enabled: Boolean(organization?.id && appointmentId),
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments")
        .select("id, patient_id, doctor_id, clinic_id, patient:patients!appointments_patient_tenant_fk(id, name_ar, insurance_company_name, insurance_policy_number, insurance_policy_category, insurance_membership_number)")
        .eq("id", appointmentId).eq("organization_id", organization?.id).maybeSingle();
      if (error) throw error;
      return data as BillingAppointmentContext | null;
    },
  });

  const invoiceContext = appointment.data ?? null;

  useEffect(() => {
    if (invoiceContext && canManageBilling) setCreateOpen(true);
  }, [invoiceContext, canManageBilling]);

  const convertToInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .update({ is_temporary: false })
        .eq("id", invoiceId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "تم تحويل عرض السعر إلى فاتورة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحويل",
        description: errorMessage(error),
      }),
  });

  const billingFail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error),
    });

  /**
   * الإصدار والإلغاء يمرّان بـ`app_set_invoice_status` (0091) لا بتحديث مباشر:
   * الدالة تفرض قواعد الانتقال، وتُلزم بسبب للإلغاء، وترفض إلغاء فاتورة عليها
   * مبلغ محصَّل لم يُستردّ، وتُعيد خدمات الزيارة إلى «منفَّذة» فتُفوتَر ثانيةً.
   */
  const issueInvoice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_set_invoice_status", {
        p_invoice_id: id,
        p_status: "unpaid",
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "صدرت الفاتورة" });
    },
    onError: billingFail("تعذر الإصدار"),
  });

  const voidInvoice = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_set_invoice_status", {
        p_invoice_id: id,
        p_status: "void",
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "أُلغيت الفاتورة وعادت خدماتها قابلة للفوترة" });
    },
    onError: billingFail("تعذر الإلغاء"),
  });

  /**
   * الإشعار الدائن — تصحيح الفاتورة الصادرة.
   *
   * الفاتورة الصادرة لا تُعدَّل ولا تُحذف (0092): تصحيحها يكون بإشعارٍ يتبعها
   * ويحمل سببه، فيبقى الأصل شاهدًا والتصحيح ظاهرًا. وهذا ما تشترطه المراجعة
   * الضريبية: لا مستند يختفي.
   */
  const creditNote = useMutation({
    mutationFn: async ({ id, reason, type }: { id: string; reason: string; type: string }) => {
      const { error } = await supabase.rpc("app_create_credit_note", {
        p_invoice_id: id,
        p_reason: reason,
        p_lines: null,
        p_note_type: type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({
        title: "صدر الإشعار كمسوّدة",
        description: "راجع بنوده ثم أصدره",
      });
    },
    onError: billingFail("تعذر إصدار الإشعار"),
  });

  const applyDiscount = useMutation({
    mutationFn: async () => {
      if (!discountTarget) throw new Error("لا فاتورة");
      if (!discountReason.trim()) throw new Error("اكتب سبب الخصم");
      const { error } = await supabase.rpc("app_apply_invoice_discount", {
        p_invoice_id: discountTarget.id,
        p_amount: Number(discountAmount) || 0,
        p_reason: discountReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "طُبّق الخصم" });
      setDiscountTarget(null);
      setDiscountAmount("");
      setDiscountReason("");
    },
    onError: billingFail("تعذر الخصم"),
  });

  const totals = useMemo(() => {
    const rows = invoices.data ?? [];
    return {
      net: rows.reduce((sum, row) => sum + Number(row.net_amount), 0),
      remaining: rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0),
    };
  }, [invoices.data]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الفوترة والمدفوعات</h1>
          <p className="text-sm text-muted-foreground">
            إجمالي {quotesOnly ? "عروض الأسعار" : "الفواتير"}: {formatAmount(totals.net)} ر.س · متبقي: {formatAmount(totals.remaining)} ر.س
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button
              size="sm"
              variant={!quotesOnly && !showShifts && !showTax && !showDay ? "default" : "ghost"}
              onClick={() => { setQuotesOnly(false); setShowShifts(false); setShowTax(false); setShowDay(false); }}
            >
              الفواتير
            </Button>
            <Button
              size="sm"
              variant={quotesOnly && !showShifts && !showTax && !showDay ? "default" : "ghost"}
              onClick={() => { setQuotesOnly(true); setShowShifts(false); setShowTax(false); setShowDay(false); }}
            >
              عروض الأسعار
            </Button>
            {/* اليومية قبل الصناديق: الإغلاق اليوميّ عمل مسائيّ متكرّر،
                والمناوبات إعداد يُفتح أقلّ. */}
            <Button
              size="sm"
              variant={showDay ? "default" : "ghost"}
              onClick={() => { setShowDay(true); setShowShifts(false); setShowTax(false); }}
            >
              اليومية
            </Button>
            <Button
              size="sm"
              variant={showShifts ? "default" : "ghost"}
              onClick={() => { setShowShifts(true); setShowTax(false); setShowDay(false); }}
            >
              الصناديق
            </Button>
            <Button
              size="sm"
              variant={showTax ? "default" : "ghost"}
              onClick={() => { setShowTax(true); setShowShifts(false); setShowDay(false); }}
            >
              الضريبة والفوترة الإلكترونية
            </Button>
          </div>
          {!quotesOnly && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="draft">مسوّدة</SelectItem>
                <SelectItem value="unpaid">غير مدفوعة</SelectItem>
                <SelectItem value="partial">مدفوعة جزئيًا</SelectItem>
                <SelectItem value="paid">مدفوعة بالكامل</SelectItem>
                <SelectItem value="partially_refunded">مستردّة جزئيًا</SelectItem>
                <SelectItem value="refunded">مستردّة بالكامل</SelectItem>
                <SelectItem value="void">ملغاة</SelectItem>
              </SelectContent>
            </Select>
          )}
          {canManageBilling && <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {quotesOnly ? "عرض سعر جديد" : "فاتورة جديدة"}
          </Button>}
        </div>
      </div>

      {!quotesOnly && !showShifts && !showTax && !showDay && <InvoiceKpiBar organizationId={organization?.id} />}
      {!quotesOnly && !showShifts && !showTax && !showDay && <ReceivablesBar organizationId={organization?.id} />}
      {!quotesOnly && !showShifts && !showTax && !showDay && canManageBilling && (
        <UnbilledDispensedPanel organizationId={organization?.id} />
      )}

      {showDay && <BusinessDayPanel />}
      {showShifts && <CashShiftsPanel organizationId={organization?.id} />}
      {showTax && (
        <div className="flex flex-col gap-4">
          <TaxSettingsTab />
          <VatReturnPanel />
          <EInvoicePanel />
        </div>
      )}

      {!showShifts && !showTax && !showDay && <Card>
        <CardHeader>
          <CardTitle>{quotesOnly ? "عروض الأسعار" : "الفواتير"}</CardTitle>
          <CardDescription>آخر 50 {quotesOnly ? "عرض سعر" : "فاتورة"}</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!invoices.isLoading && (
            <Table>
              <TableHeader>
                {/**
                  * الجدول كان ثمانية عشر عمودًا في شاشة واحدة، فتُسحق الأعمدة
                  * ويلتفّ اسم المريض على ثلاثة أسطر ويتقطّع الصف — وهو ما جعل
                  * شاشة الفواتير تبدو «غير منسّقة ومقطّعة».
                  *
                  * المعالجة: عنوان لا يلتفّ (`whitespace-nowrap`)، وأعمدة
                  * الأرقام مصطفّة إلى اليسار بأرقام لاتينية ثابتة العرض،
                  * والأعمدة التفصيلية (الجنسية، الموظف، الإعفاء، دون ضريبة)
                  * تظهر على الشاشات العريضة وحدها بدل أن تسحق العمود المهم.
                  */}
                <TableRow>
                  <TableHead className="whitespace-nowrap">#الفاتورة</TableHead>
                  <TableHead className="whitespace-nowrap">النوع</TableHead>
                  <TableHead className="min-w-[10rem]">العميل</TableHead>
                  <TableHead className="whitespace-nowrap">#الملف</TableHead>
                  <TableHead className="hidden whitespace-nowrap lg:table-cell">الطبيب</TableHead>
                  <TableHead className="whitespace-nowrap">التاريخ</TableHead>
                  <TableHead className="hidden whitespace-nowrap xl:table-cell">الجنسية</TableHead>
                  <TableHead className="hidden whitespace-nowrap xl:table-cell">الموظف</TableHead>
                  <TableHead className="hidden whitespace-nowrap text-end lg:table-cell">دون ضريبة</TableHead>
                  <TableHead className="whitespace-nowrap text-end">الخصم</TableHead>
                  <TableHead className="hidden whitespace-nowrap text-end xl:table-cell">الإعفاء</TableHead>
                  <TableHead className="whitespace-nowrap text-end">الضريبة</TableHead>
                  <TableHead className="whitespace-nowrap text-end">الصافي</TableHead>
                  <TableHead className="whitespace-nowrap text-end">المدفوع</TableHead>
                  <TableHead className="whitespace-nowrap text-end">المتبقي</TableHead>
                  <TableHead className="whitespace-nowrap">الحالة</TableHead>
                  <TableHead className="whitespace-nowrap">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      #{invoice.invoice_number}
                      {invoice.zatca_invoice_number && (
                        <span className="block text-[10px] text-muted-foreground">
                          زاتكا: {invoice.zatca_invoice_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs">
                          {invoice.invoice_type === "return" ? "مرتجع" : "بيع"}
                        </span>
                        {invoice.is_insurance_invoice && (
                          <Badge variant="secondary" className="w-fit px-1.5 text-[10px]">
                            تأمين
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[10rem] font-medium">
                      {invoice.patient?.name_ar ?? invoice.external_customer_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-xs">
                      {invoice.patient?.file_number ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {invoice.doctor?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatDate(invoice.created_at, calendarDisplay)}
                      <span className="block">{formatTime(invoice.created_at)}</span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                      {invoice.nationality?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                      {invoice.created_by ? memberNames.data?.get(invoice.created_by) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-end tabular-nums lg:table-cell">
                      {formatAmount(invoice.subtotal_amount ?? 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end tabular-nums text-amber-700">
                      {formatAmount(invoice.discount_amount ?? 0)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-end tabular-nums text-muted-foreground xl:table-cell">
                      {formatAmount(invoice.exemption_amount ?? 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end tabular-nums">
                      {formatAmount(invoice.vat_amount ?? 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end font-semibold tabular-nums">
                      {formatAmount(invoice.net_amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end tabular-nums text-emerald-700">
                      {formatAmount(invoice.paid_amount ?? 0)}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-end tabular-nums ${
                        Number(invoice.remaining_amount) > 0 ? "font-semibold text-rose-600" : "text-muted-foreground"
                      }`}
                    >
                      {formatAmount(invoice.remaining_amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {invoice.is_temporary ? (
                        <Badge className="bg-indigo-100 text-indigo-700">عرض سعر</Badge>
                      ) : (
                        <Badge className={STATUS_BADGE[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
                      )}
                    </TableCell>
                    {/* الإجراءات في صندوق يلتفّ داخل الخلية لا خلية تُمدّد
                        الصف: `flex` على `td` كان يُخرج الأزرار عن شبكة الجدول
                        فتصطفّ في عمود واحد طويل ويرتفع الصف بلا داعٍ. */}
                    <TableCell>
                      <div className="flex max-w-[16rem] flex-wrap items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="طباعة"
                        onClick={() =>
                          printInvoice(
                            invoice,
                            organization?.name ?? "",
                            organization?.tax_number ?? null,
                            printSettings.data?.invoice_paper_size ?? "a4",
                            printSettings.data?.footer_note ?? null,
                          ).catch((error: unknown) =>
                            toast({
                              variant: "destructive",
                              title: "تعذر تجهيز الفاتورة للطباعة",
                              description: errorMessage(error),
                            }),
                          )
                        }
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      {invoice.is_temporary ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={convertToInvoice.isPending}
                          onClick={() => convertToInvoice.mutate(invoice.id)}
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          تحويل لفاتورة
                        </Button>
                      ) : (
                        invoice.status !== "paid" &&
                        invoice.status !== "void" && (
                          <Button size="sm" variant="outline" onClick={() => setPaymentTarget(invoice)}>
                            <WalletCards className="h-3.5 w-3.5" />
                            تسجيل دفعة
                          </Button>
                        )
                      )}
                      {/* المرتجع لا يُرتجع، وعرض السعر لم يُبَع أصلًا */}
                      {!invoice.is_temporary &&
                        invoice.invoice_type !== "return" &&
                        invoice.status !== "void" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="إنشاء مرتجع"
                            onClick={() => setReturnTarget(invoice)}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      {/* المسوّدة: خصم ثم إصدار. الصادرة: إلغاء بسبب. */}
                      {/*
                        الإشعار الدائن/المدين مسوّدة كذلك، وكان زرّ الخصم يظهر عليه:
                        فتُخصَم قيمة إشعارٍ صادرٍ لتصحيح فاتورة بلا مقابل في بنوده،
                        ويصبح إجماليه مخالفًا لمجموع سطوره. الاستثناء هنا نفس
                        استثناء زرّ «إشعار دائن» أدناه.
                      */}
                      {invoice.status === "draft" &&
                        !["credit_note", "debit_note"].includes(
                          (invoice as any).document_type ?? "",
                        ) &&
                        can("billing.discount") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="خصم"
                            onClick={() => setDiscountTarget(invoice)}
                          >
                            خصم
                          </Button>
                        )}
                      {invoice.status === "draft" && can("billing.issue") && (
                        <Button
                          size="sm"
                          variant="outline"
                          title="إصدار الفاتورة"
                          onClick={() => issueInvoice.mutate(invoice.id)}
                        >
                          إصدار
                        </Button>
                      )}
                      {["unpaid", "partial", "paid", "partially_refunded"].includes(invoice.status) &&
                        !["credit_note", "debit_note"].includes(
                          (invoice as any).document_type ?? "",
                        ) &&
                        can("billing.refund") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="إشعار دائن"
                            onClick={() => {
                              const reason = window.prompt("سبب الإشعار الدائن؟");
                              if (reason && reason.trim())
                                creditNote.mutate({
                                  id: invoice.id,
                                  reason: reason.trim(),
                                  type: "credit_note",
                                });
                            }}
                          >
                            إشعار دائن
                          </Button>
                        )}
                      {["unpaid", "partial", "refunded"].includes(invoice.status) &&
                        can("billing.void") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="إلغاء الفاتورة"
                            onClick={() => {
                              const reason = window.prompt("سبب إلغاء الفاتورة؟");
                              if (reason && reason.trim())
                                voidInvoice.mutate({ id: invoice.id, reason: reason.trim() });
                            }}
                          >
                            إلغاء
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(invoices.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={17} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فواتير مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>}

      <Dialog open={Boolean(discountTarget)} onOpenChange={(next) => !next && setDiscountTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>خصم على الفاتورة #{discountTarget?.invoice_number}</DialogTitle>
            <DialogDescription>
              الإجمالي قبل الخصم {formatAmount(discountTarget?.subtotal_amount ?? 0)} ر.س.
              الخصم يُمنح على المسوّدة قبل الإصدار، ويُسجَّل بسببه ومانحه.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>مبلغ الخصم *</Label>
              <Input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>سبب الخصم *</Label>
              <Textarea rows={2} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!discountAmount || !discountReason.trim() || applyDiscount.isPending}
              onClick={() => applyDiscount.mutate()}
            >
              تطبيق الخصم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organization?.id}
        vatRate={organization?.default_vat_rate ?? 15}
        isQuote={quotesOnly}
        appointment={invoiceContext}
      />
      <RecordPaymentDialog invoice={paymentTarget} onOpenChange={() => setPaymentTarget(null)} organizationId={organization?.id} />
      <ReturnInvoiceDialog
        invoice={returnTarget}
        onOpenChange={() => setReturnTarget(null)}
        organizationId={organization?.id}
      />
    </div>
  );
}


/**
 * إنشاء فاتورة مرتجع من فاتورة مبيعات قائمة (لقطة 25).
 *
 * سبب وجودها: عمود `sales_invoices.invoice_type` موجود منذ 0003 بقيمتَي
 * `sale` و`return`، وشاشة الفواتير **تعرضه** ومنشئ التقارير يصفّي به، وقيد
 * المحاسبة في 0027 يعرف كيف يعكس جانبَي المدين والدائن للمرتجع — لكن التدقيق
 * الشامل أثبت أن السلسلة `invoice_type:` **لا ترد ولا مرة واحدة** في المشروع
 * كله. أي أن الحقل لم يكن يُكتب إطلاقًا: لا زر مرتجع، وكشف المرتجعات فارغ
 * دائمًا، ولا سبيل لإلغاء فاتورة مدفوعة محاسبيًا.
 *
 * **المبالغ موجبة لا سالبة.** قيد 0027 يميّز المرتجع بـ `invoice_type` ويعكس
 * الجانبين بنفسه؛ إدخال مبالغ سالبة كان سيعكسها مرتين فيصبح المرتجع زيادةً في
 * الإيراد. والمنظورات في 0010 تصفّي `invoice_type = 'sale'` فلا تتلوث
 * تقارير المبيعات بالمرتجعات أصلًا.
 *
 * `original_invoice_id` (موجود في الجدول ولم يكن يُكتب) هو ما يربط المرتجع
 * بأصله — وبه يُحتسب المرتجَع سابقًا فيُمنع إرجاع أكثر مما بيع.
 */
function ReturnInvoiceDialog({
  invoice,
  onOpenChange,
  organizationId,
}: {
  invoice: SalesInvoiceWithPatient | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // `created_by` لم تعد تُكتب من هنا: الدالّة تضعها من `auth.uid()` داخل
  // المعاملة، فلا يمكن للمتصفح أن ينسب المرتجع إلى مستخدم آخر.
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const lines = useQuery({
    queryKey: ["return-source-lines", invoice?.id],
    enabled: Boolean(invoice?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "id, item_id, description, price, qty, discount_percent, discount_amount, vat_rate, vat_amount, exemption_amount, vat_category, net_amount, doctor_id",
        )
        .eq("invoice_id", invoice!.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        item_id: string | null;
        description: string | null;
        price: number;
        qty: number;
        discount_percent: number;
        discount_amount: number;
        vat_rate: number;
        vat_amount: number;
        exemption_amount: number;
        vat_category: string;
        net_amount: number;
        doctor_id: string | null;
      }[];
    },
  });

  /**
   * ما أُرجع سابقًا من هذه الفاتورة. بدونه يمكن إرجاع نفس البند مرارًا حتى
   * يتجاوز المرتجع قيمة البيع — وهو خطأ لا تكشفه القاعدة ولا تصححه.
   */
  const priorReturns = useQuery({
    queryKey: ["prior-returns", invoice?.id],
    enabled: Boolean(invoice?.id),
    queryFn: async () => {
      const { data: returnInvoices, error } = await supabase
        .from("sales_invoices")
        .select("id")
        .eq("original_invoice_id", invoice!.id)
        .eq("invoice_type", "return");
      if (error) throw error;
      const ids = (returnInvoices ?? []).map((row) => (row as { id: string }).id);
      if (ids.length === 0) return new Map<string, number>();

      const { data: returnedLines, error: linesError } = await supabase
        .from("sales_invoice_items")
        .select("description, item_id, qty")
        .in("invoice_id", ids);
      if (linesError) throw linesError;

      // المطابقة بالصنف إن وُجد وإلا بالوصف: بند المرتجع لا يحمل مرجعًا لسطر
      // الأصل (لا عمود لذلك في الجدول)، فهذا أدق ربط متاح بلا هجرة.
      const map = new Map<string, number>();
      for (const row of (returnedLines ?? []) as { description: string | null; item_id: string | null; qty: number }[]) {
        const key = row.item_id ?? `desc:${row.description ?? ""}`;
        map.set(key, (map.get(key) ?? 0) + (Number(row.qty) || 0));
      }
      return map;
    },
  });

  const lineKey = (line: { item_id: string | null; description: string | null }) =>
    line.item_id ?? `desc:${line.description ?? ""}`;

  /**
   * توزيع ما أُرجع سابقًا على أسطر الأصل بالترتيب، لا طرحه من كل سطر.
   *
   * بند المرتجع لا يحمل مرجعًا لسطر الأصل (لا عمود لذلك في الجدول)، فالمطابقة
   * بالصنف/الوصف. الخطأ الذي كان: طرح **الإجمالي المرتجع** من **كل** سطر
   * مطابق. فاتورة فيها الصنف نفسه على سطرين بكمية 1 لكل منهما، أُرجع منها
   * واحد → كلا السطرين يحسبان `1 - 1 = 0` ويظهران "أُرجع بالكامل"، فتتعذّر
   * إعادة الوحدة الثانية إلى الأبد. الصواب استهلاك الرصيد المرتجع سطرًا سطرًا.
   */
  const returnableByLineId = (() => {
    // النوع صريح: `priorReturns.data ?? []` يُنتج `never[]` حين تكون البيانات
    // غير محمَّلة، فيستنتج TypeScript `Map<{}, {}>` ويصبح `pool` من نوع `{}` —
    // فيفشل `Math.min` و`pool - consumed` بخطأَي ترجمة (TS2345 و TS2362).
    const remainingReturned = new Map<string, number>(priorReturns.data ?? []);
    const result = new Map<string, number>();
    for (const line of lines.data ?? []) {
      const key = lineKey(line);
      const pool = remainingReturned.get(key) ?? 0;
      const consumed = Math.min(pool, Number(line.qty) || 0);
      remainingReturned.set(key, pool - consumed);
      result.set(line.id, Math.max((Number(line.qty) || 0) - consumed, 0));
    }
    return result;
  })();

  const returnableQty = (line: { id: string }) => returnableByLineId.get(line.id) ?? 0;

  /**
   * مبالغ سطر المرتجع تُحتسب **بنسبة الكمية المرتجعة من كمية الأصل** لا
   * بإعادة حساب السعر والخصم من جديد: الخصم قد يكون مبلغًا مقطوعًا على السطر
   * لا نسبة، وإعادة الحساب كانت ستُرجع للمريض مبلغًا يخالف ما دفعه فعلًا.
   */
  const computed = (lines.data ?? []).map((line) => {
    const maxQty = returnableQty(line);
    const raw = Number(qtyByLine[line.id] ?? 0);
    const qty = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), maxQty) : 0;
    const ratio = Number(line.qty) > 0 ? qty / Number(line.qty) : 0;
    return {
      ...line,
      maxQty,
      returnQty: qty,
      returnSubtotal: Number(line.price) * qty,
      returnDiscount: Number(line.discount_amount ?? 0) * ratio,
      returnVat: Number(line.vat_amount ?? 0) * ratio,
      returnNet: Number(line.net_amount ?? 0) * ratio,
    };
  });

  const round2 = (value: number) => Math.round(value * 100) / 100;

  const selected = computed.filter((line) => line.returnQty > 0);
  /**
   * الرأس = مجموع الأسطر **بعد تقريب كل سطر**، لا تقريب مجموع القيم الخام.
   *
   * الأسطر تُحفظ مقرَّبة إلى هللتين، فتقريب المجموع الخام يُنتج رأسًا يخالف
   * مجموع أسطره بهللة أو اثنتين متى وقعت النسب على أنصاف هللات — وفاتورة
   * مطبوعة لا يساوي إجماليها مجموع بنودها تُرفض في المراجعة.
   */
  const totals = selected.reduce(
    (acc, line) => ({
      subtotal: acc.subtotal + round2(line.returnSubtotal),
      discount: acc.discount + round2(line.returnDiscount),
      vat: acc.vat + round2(line.returnVat),
      net: acc.net + round2(line.returnNet),
    }),
    { subtotal: 0, discount: 0, vat: 0, net: 0 },
  );

  const createReturn = useMutation({
    mutationFn: async () => {
      if (!invoice || !organizationId) throw new Error("لا توجد فاتورة مصدر");
      if (selected.length === 0) throw new Error("حدّد كمية مرتجعة لبند واحد على الأقل");

      /**
       * المرتجع يمرّ بـ`app_create_sales_invoice` لا بإدراجَين مباشرَين.
       *
       * **لماذا كان الإدراجان خطأً قاتلًا**: `insert` على `sales_invoices` ثم
       * `insert` على `sales_invoice_items` **ليسا معاملة واحدة**. فشل الثاني
       * (انقطاع شبكة، رفض RLS) كان يترك **رأس مرتجع بكامل المبالغ وبلا أي
       * بند** — وقد أطلق المحفِّز `trg_post_sales_invoice_to_gl` قيد يومية
       * يخصم من الإيراد مبلغًا لا بنود تحته. ولأن الرأس كان يُدرَج بـ
       * `issued_at = NULL` لم يُطلَق `trg_stamp_invoice_on_issue`، فبقي
       * المرتجع بلا رقم مستند نظاميّ ولا لقطة بائع/مشتر، ولم يظهر في قائمة
       * «فواتير صادرة بلا مستند إلكتروني» (تشترط `issued_at is not null`) فلا
       * مستند زاتكا له أبدًا. والدالّة تفعل كل ذلك في معاملة واحدة: تُدرج
       * الرأس والبنود، وتُعيد حساب كل المبالغ من البنود المُدرَجة فعلًا، ثم
       * تضع `issued_at`/`issued_by` فيُختَم الرقم واللقطات — والتدقيق يُسجَّل
       * بمحفِّز `trg_audit_sales_invoices` على الرأس المُدرَج.
       *
       * وفكّ الارتباط يجري في القاعدة أيضًا: `trg_pvs_status_on_return_invoice`
       * يُعيد خدمات زيارة الفاتورة الأصلية إلى `refunded`، والدالّة **لا**
       * تختم طلبات المختبر/الأشعة/الوصفات على المرتجع (`p_invoice_type = 'sale'`
       * وحدها تختم) فلا يُربط طلب بمرتجع بدل فاتورته الأصلية.
       *
       * `visit_service_id` لا يُمرَّر مع بنود المرتجع: `uq_invoice_item_visit_service`
       * فريد على مستوى الجدول كلّه، فتمريره كان سيرفض المرتجع بتضارب مفتاح.
       */
      const { data: newInvoiceId, error } = await supabase.rpc("app_create_sales_invoice", {
        p_organization_id: organizationId,
        p_items: selected.map((line) => {
          /**
           * تُمرَّر **نسبة** الخصم لا مبلغه: الدالّة تحسب خصم السطر من
           * `discount_percent` وتتجاهل أي مبلغ يرسله العميل. وتمرير
           * `discount_percent` المخزَّن كما هو كان خطأً متى كان الخصم مبلغًا
           * مقطوعًا على السطر (أو موزَّعًا من خصم الرأس) لا نسبةً — فيُردّ
           * للمريض غير ما دفعه. النسبة الفعلية من سطر الأصل تُنتج في القاعدة
           * نفس الخصم بنسبة الكمية المرتجعة.
           */
          const originalBase = Number(line.price) * Number(line.qty);
          const effectiveDiscountPercent =
            originalBase > 0
              ? Math.min(
                  Math.max((Number(line.discount_amount ?? 0) / originalBase) * 100, 0),
                  100,
                )
              : 0;
          return {
            item_id: line.item_id,
            description: line.description,
            qty: line.returnQty,
            price: line.price,
            discount_percent: effectiveDiscountPercent,
            // إعفاء السطر يُنقل من الأصل لا من علم الصنف الحالي: الصنف قد
            // عُلِّم معفى (أو أُزيل إعفاؤه) بعد البيع، فالاعتماد على كتالوج
            // اليوم كان سيُرجع ضريبة لم تُحصَّل أو يُسقط ضريبة حُصِّلت.
            is_vat_exempt:
              line.vat_category === "exempt" ||
              line.vat_category === "zero_rated" ||
              Number(line.exemption_amount ?? 0) > 0,
            doctor_id: line.doctor_id,
          };
        }),
        p_patient_id: invoice.patient?.id ?? null,
        p_external_customer_name: invoice.patient ? null : invoice.external_customer_name,
        p_invoice_type: "return",
        p_original_invoice_id: invoice.id,
        // المرتجع يُنشأ مسدَّدًا: المبلغ رُدّ للمريض عند الإرجاع. تركه
        // "غير مدفوع" كان سيُظهره كذمّة مدينة على المريض — عكس الحقيقة.
        // والدالّة تحصر المدفوع في صافي المرتجع الذي حسبته هي، فلا يمكن
        // للمتصفح أن يُسجّل ردًّا أكبر من قيمة البنود.
        p_paid_amount: round2(totals.net),
        p_note: note.trim() || `مرتجع للفاتورة #${invoice.invoice_number}`,
      });
      if (error) throw error;
      if (!newInvoiceId) throw new Error("لم يُنشأ المرتجع — أعد المحاولة");
      return newInvoiceId as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      queryClient.invalidateQueries({ queryKey: ["prior-returns"] });
      // المرتجع يغيّر الإيراد والذمم: بلا تبطيلهما تبقى المؤشرات وأعلى الذمم
      // على أرقام ما قبل الإرجاع فيُطالَب المريض بما رُدّ إليه.
      queryClient.invalidateQueries({ queryKey: ["invoice-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["patient-balances"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-register-overdue"] });
      toast({ title: "تم إنشاء فاتورة المرتجع" });
      setQtyByLine({});
      setNote("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء المرتجع",
        description: errorMessage(error),
      }),
  });

  const busy = lines.isLoading || priorReturns.isLoading;

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={() => onOpenChange()}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>مرتجع للفاتورة #{invoice?.invoice_number}</DialogTitle>
        </DialogHeader>

        {busy && <Skeleton className="h-40 w-full" />}

        {!busy && (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              حدّد الكمية المرتجعة من كل بند. المبالغ المعروضة هنا **معاينة قبل الحفظ** تُحتسب
              بنسبة الكمية من الأصل؛ والمبالغ المحفوظة تُحسب في القاعدة من البنود المُدرَجة ونسبة
              الضريبة المخزَّنة، فيُردّ للمريض ما دفعه فعلًا بعد الخصم لا سعر القائمة.
            </p>
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              المرتجع مستند محاسبي فقط. النقد المُعاد للمريض يُسجَّل سندَ صرفٍ من زرّ «استرداد» في
              نافذة تحصيل الفاتورة الأصلية — بدونه يُغلق الصندوق بعجزٍ بقيمة ما رُدّ، لأن المتوقَّع
              يُحسب من سندات الصرف لا من فواتير المرتجع.
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>البند</TableHead>
                  <TableHead className="w-24">المباع</TableHead>
                  <TableHead className="w-28">القابل للإرجاع</TableHead>
                  <TableHead className="w-28">المرتجع</TableHead>
                  <TableHead className="w-28">الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computed.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="text-sm">{line.description ?? "—"}</TableCell>
                    <TableCell className="tabular-nums text-sm">{line.qty}</TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {line.maxQty === 0 ? (
                        <Badge variant="secondary">أُرجع بالكامل</Badge>
                      ) : (
                        line.maxQty
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        type="number"
                        min={0}
                        max={line.maxQty}
                        disabled={line.maxQty === 0}
                        value={qtyByLine[line.id] ?? ""}
                        onChange={(e) =>
                          setQtyByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {line.returnNet.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-1.5">
              <Label>سبب الإرجاع</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
            </div>

            <div className="flex flex-wrap justify-end gap-4 rounded-lg border p-3 text-sm tabular-nums">
              <span>الإجمالي: {totals.subtotal.toFixed(2)}</span>
              <span className="text-amber-700">الخصم: {totals.discount.toFixed(2)}</span>
              <span>الضريبة: {totals.vat.toFixed(2)}</span>
              <span className="font-bold">الصافي المرتجع: {totals.net.toFixed(2)}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange()}>
            إلغاء
          </Button>
          <Button
            disabled={createReturn.isPending || selected.length === 0}
            onClick={() => createReturn.mutate()}
          >
            {createReturn.isPending ? "جارٍ الإنشاء..." : "إنشاء المرتجع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// تسجيل الدفعة
//
// كان المسار طلبين: إدراج `financial_vouchers` ثم إدراج
// `voucher_invoice_allocations`. فشل الثاني يترك سندًا معلّقًا لا يخصم من
// فاتورة — مالٌ في السجل لا يُنسب إلى شيء. ولم يكن ثمّة سقف: توزيع ٥٠٠٠ على
// فاتورة بـ٣٠٠ يمرّ ويترك المتبقّي سالبًا.
//
// الآن نداء واحد `app_receive_invoice_payment` يفعل الاثنين معًا، ويرفض
// التجاوز، ويشترط مناوبة صندوق مفتوحة للنقد.
// ---------------------------------------------------------------------------
type PaymentMethodRow = {
  id: string;
  code: string | null;
  name_ar: string;
  affects_drawer: boolean;
};

function usePaymentMethods() {
  return useQuery({
    queryKey: ["payment-methods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, code, name_ar, extra, category:lookup_categories!inner(key)")
        .eq("lookup_categories.key", "payment_methods")
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        code: r.code,
        name_ar: r.name_ar,
        affects_drawer: Boolean(r.extra?.affects_drawer),
      })) as PaymentMethodRow[];
    },
  });
}

function useCashRegisters(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["cash-registers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name, branch_id, requires_shift")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        branch_id: string | null;
        requires_shift: boolean;
      }[];
    },
  });
}

function useOpenShift(registerId: string) {
  return useQuery({
    queryKey: ["open-shift", registerId],
    enabled: Boolean(registerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_register_shifts")
        .select("id, shift_number, opened_at, opening_balance")
        .eq("cash_register_id", registerId)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; shift_number: number; opening_balance: number } | null;
    },
  });
}

function useInvoicePayments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-payments", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voucher_invoice_allocations")
        .select(
          "id, amount, voucher:financial_vouchers(id, voucher_number, voucher_type, voucher_date, is_void, void_reason, description, refund_of_voucher_id, method:lookup_values!financial_vouchers_payment_method_value_id_fkey(name_ar))",
        )
        .eq("sales_invoice_id", invoiceId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function RecordPaymentDialog({
  invoice,
  onOpenChange,
  organizationId,
}: {
  invoice: SalesInvoiceWithPatient | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const methods = usePaymentMethods();
  const registers = useCashRegisters(organizationId);
  const payments = useInvoicePayments(invoice?.id);

  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [reference, setReference] = useState("");
  const [refundMode, setRefundMode] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const shift = useOpenShift(registerId);
  const method = (methods.data ?? []).find((m) => m.id === methodId);
  const needsDrawer = Boolean(method?.affects_drawer);
  const register = (registers.data ?? []).find((r) => r.id === registerId);
  const shiftMissing = needsDrawer && register?.requires_shift && !shift.data;

  const remaining = Number(invoice?.remaining_amount ?? 0);
  const paid = Number(invoice?.paid_amount ?? 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-payments", invoice?.id] });
    queryClient.invalidateQueries({ queryKey: ["open-shift", registerId] });
    queryClient.invalidateQueries({ queryKey: ["cash-shifts", organizationId] });
  };

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error),
    });

  const reset = () => {
    setAmount("");
    setReference("");
    setRefundReason("");
    setRefundMode(false);
  };

  const receive = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة");
      if (!methodId) throw new Error("اختر طريقة الدفع");
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      const { error } = await supabase.rpc("app_receive_invoice_payment", {
        p_invoice_id: invoice.id,
        p_amount: value,
        p_payment_method_value_id: methodId,
        p_cash_register_id: needsDrawer ? registerId || null : registerId || null,
        p_reference: reference.trim() || null,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "سُجّلت الدفعة" });
      reset();
    },
    onError: fail("تعذر تسجيل الدفعة"),
  });

  const refund = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة");
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      if (!refundReason.trim()) throw new Error("اكتب سبب الاسترداد");
      const { error } = await supabase.rpc("app_refund_invoice_payment", {
        p_invoice_id: invoice.id,
        p_amount: value,
        p_reason: refundReason.trim(),
        p_cash_register_id: registerId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "سُجّل الاسترداد" });
      reset();
    },
    onError: fail("تعذر الاسترداد"),
  });

  const voidVoucher = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_void_financial_voucher", {
        p_voucher_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُلغي السند وأُعيد حساب الفاتورة" });
    },
    onError: fail("تعذر إلغاء السند"),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{refundMode ? "استرداد" : "تسجيل دفعة"}</DialogTitle>
          <DialogDescription>
            فاتورة #{invoice?.invoice_number} — الإجمالي{" "}
            {formatAmount(invoice?.net_amount ?? 0)} · المحصَّل{" "}
            {formatAmount(paid)} · المتبقّي {formatAmount(remaining)} ر.س
          </DialogDescription>
        </DialogHeader>

        {can("billing.refund") && paid > 0 && (
          <div className="flex rounded-lg border p-0.5">
            <Button
              size="sm"
              className="flex-1"
              variant={!refundMode ? "default" : "ghost"}
              onClick={() => setRefundMode(false)}
            >
              تحصيل
            </Button>
            <Button
              size="sm"
              className="flex-1"
              variant={refundMode ? "destructive" : "ghost"}
              onClick={() => setRefundMode(true)}
            >
              استرداد
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ *</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAmount(String(refundMode ? paid : remaining))}
              >
                الكل
              </Button>
            </div>
          </div>
          {!refundMode && (
            <div className="flex flex-col gap-1.5">
              <Label>طريقة الدفع *</Label>
              <Select value={methodId} onValueChange={setMethodId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الطريقة" />
                </SelectTrigger>
                <SelectContent>
                  {(methods.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name_ar}
                      {m.affects_drawer ? " (نقد)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(needsDrawer || refundMode) && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>الصندوق {needsDrawer ? "*" : ""}</Label>
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الصندوق" />
                </SelectTrigger>
                <SelectContent>
                  {(registers.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {shiftMissing && (
                <p className="text-xs text-destructive">
                  لا مناوبة مفتوحة على هذا الصندوق — افتح مناوبة من تبويب الصناديق قبل القبض
                  النقدي.
                </p>
              )}
              {needsDrawer && shift.data && (
                <p className="text-xs text-emerald-700">
                  مناوبة #{shift.data.shift_number} مفتوحة برصيد افتتاحي{" "}
                  {formatAmount(shift.data.opening_balance)} ر.س
                </p>
              )}
            </div>
          )}
          {!refundMode && !needsDrawer && methodId && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>مرجع العملية</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="رقم الحوالة أو العملية"
                dir="ltr"
              />
            </div>
          )}
          {refundMode && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>سبب الاسترداد *</Label>
              <Textarea
                rows={2}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          )}
        </div>

        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          الدفع المختلط: سجّل كل وسيلة دفعةً مستقلّة — نقدًا ثم مدى مثلًا — والفاتورة تجمعها.
        </p>

        <TaxInvoicePreview invoiceId={invoice?.id ?? null} />

        {(payments.data ?? []).length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">سندات هذه الفاتورة</h4>
              {(payments.data ?? []).map((a) => {
                const v = Array.isArray(a.voucher) ? a.voucher[0] : a.voucher;
                if (!v) return null;
                const isRefund = Boolean(v.refund_of_voucher_id);
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className={isRefund ? "text-rose-700" : "text-emerald-700"}>
                        {isRefund ? "استرداد" : "قبض"} #{v.voucher_number} —{" "}
                        {formatAmount(a.amount)} ر.س
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(v.voucher_date)}
                        {v.method?.name_ar ? ` · ${v.method.name_ar}` : ""}
                        {v.is_void ? ` · ملغى: ${v.void_reason ?? ""}` : ""}
                      </span>
                    </div>
                    {!v.is_void && can("billing.void") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const reason = window.prompt("سبب إلغاء السند؟");
                          if (reason && reason.trim())
                            voidVoucher.mutate({ id: v.id, reason: reason.trim() });
                        }}
                      >
                        إلغاء السند
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          {refundMode ? (
            <Button
              variant="destructive"
              disabled={!amount || !refundReason.trim() || refund.isPending}
              onClick={() => refund.mutate()}
            >
              {refund.isPending ? "جارٍ الاسترداد..." : "تنفيذ الاسترداد"}
            </Button>
          ) : (
            <Button
              disabled={!amount || !methodId || shiftMissing || receive.isPending}
              onClick={() => receive.mutate()}
            >
              {receive.isPending ? "جارٍ الحفظ..." : "تسجيل الدفعة"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الصناديق والمناوبات
//
// `cash_registers` موجودة منذ 0001 بلا فتح ولا إغلاق ولا جرد: صناديق لا يُعرف
// من قبض فيها ولا كم في الدرج. المناوبة هي ما يجعل النقد قابلًا للمساءلة.
// ---------------------------------------------------------------------------
type ShiftRow = {
  id: string;
  cash_register_id: string;
  register_name: string;
  branch_name: string | null;
  shift_number: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  total_receipts: number;
  total_expenses: number;
  voucher_count: number;
  expected_balance: number | null;
  counted_balance: number | null;
  variance_amount: number | null;
  variance_reason: string | null;
  closed_by: string | null;
};

function CashShiftsPanel({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const registers = useCashRegisters(organizationId);
  const [openTarget, setOpenTarget] = useState<string>("");
  const [opening, setOpening] = useState("0");
  const [closeTarget, setCloseTarget] = useState<ShiftRow | null>(null);
  const [counted, setCounted] = useState("");
  const [varianceReason, setVarianceReason] = useState("");

  const shifts = useQuery({
    queryKey: ["cash-shifts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_cash_shift_summary")
        .select("*")
        .eq("organization_id", organizationId)
        .order("opened_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const expected = useQuery({
    queryKey: ["shift-expected", closeTarget?.id],
    enabled: Boolean(closeTarget?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_cash_shift_expected", {
        p_shift_id: closeTarget?.id,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cash-shifts", organizationId] });
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error),
    });

  const openShift = useMutation({
    mutationFn: async () => {
      if (!openTarget) throw new Error("اختر الصندوق");
      const { error } = await supabase.rpc("app_open_cash_shift", {
        p_cash_register_id: openTarget,
        p_opening_balance: Number(opening) || 0,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "فُتحت المناوبة" });
      setOpenTarget("");
      setOpening("0");
    },
    onError: fail("تعذر فتح المناوبة"),
  });

  const closeShift = useMutation({
    mutationFn: async () => {
      if (!closeTarget) throw new Error("لا مناوبة");
      if (counted === "") throw new Error("أدخل الرصيد الفعليّ المجرود");
      const { error } = await supabase.rpc("app_close_cash_shift", {
        p_shift_id: closeTarget.id,
        p_counted_balance: Number(counted),
        p_variance_reason: varianceReason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُغلقت المناوبة" });
      setCloseTarget(null);
      setCounted("");
      setVarianceReason("");
    },
    onError: fail("تعذر إغلاق المناوبة"),
  });

  const approveShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_cash_shift", {
        p_shift_id: id,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "اعتُمدت المناوبة" });
    },
    onError: fail("تعذر الاعتماد"),
  });

  const liveVariance =
    counted === "" || expected.data == null ? null : Number(counted) - expected.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>الصناديق والمناوبات</CardTitle>
        <CardDescription>
          لا قبض نقديّ بلا مناوبة مفتوحة — والإغلاق يحتاج جردًا فعليًا، والفرق يحتاج سببًا
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {can("cashier.open") && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>الصندوق</Label>
              <Select value={openTarget} onValueChange={setOpenTarget}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="اختر الصندوق" />
                </SelectTrigger>
                <SelectContent>
                  {(registers.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الرصيد الافتتاحي</Label>
              <Input
                type="number"
                min={0}
                className="w-32"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </div>
            <Button disabled={!openTarget || openShift.isPending} onClick={() => openShift.mutate()}>
              فتح مناوبة
            </Button>
          </div>
        )}

        {shifts.isLoading && <Skeleton className="h-40 w-full" />}
        {!shifts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الصندوق</TableHead>
                <TableHead>المناوبة</TableHead>
                <TableHead>افتتاحي</TableHead>
                <TableHead>مقبوضات</TableHead>
                <TableHead>متوقّع / مجرود</TableHead>
                <TableHead>الفرق</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(shifts.data ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.register_name}
                    {s.branch_name && (
                      <span className="block text-xs text-muted-foreground">{s.branch_name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    #{s.shift_number}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(s.opened_at)}
                    </span>
                  </TableCell>
                  <TableCell>{formatAmount(s.opening_balance)}</TableCell>
                  <TableCell>
                    {formatAmount(s.total_receipts)}
                    <span className="block text-xs text-muted-foreground">
                      {s.voucher_count} سند
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.expected_balance != null
                      ? `${formatAmount(s.expected_balance)} / ${formatAmount(
                          s.counted_balance ?? 0,
                        )}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {s.variance_amount != null ? (
                      <Badge variant={Number(s.variance_amount) === 0 ? "success" : "destructive"}>
                        {formatAmount(s.variance_amount)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                    {s.variance_reason && (
                      <span className="block text-xs text-muted-foreground">
                        {s.variance_reason}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === "open"
                          ? "default"
                          : s.status === "approved"
                            ? "success"
                            : "secondary"
                      }
                    >
                      {s.status === "open"
                        ? "مفتوحة"
                        : s.status === "closed"
                          ? "مغلقة"
                          : "معتمَدة"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {s.status === "open" && can("cashier.close") && (
                      <Button size="sm" variant="outline" onClick={() => setCloseTarget(s)}>
                        إغلاق
                      </Button>
                    )}
                    {s.status === "closed" && can("cashier.approve") && (
                      <Button size="sm" variant="ghost" onClick={() => approveShift.mutate(s.id)}>
                        اعتماد
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(shifts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    لا مناوبات بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={Boolean(closeTarget)} onOpenChange={(next) => !next && setCloseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إغلاق المناوبة #{closeTarget?.shift_number}</DialogTitle>
            <DialogDescription>
              عُدّ ما في الدرج فعلًا وأدخله. الرصيد المتوقّع يُحسب من النقد وحده — التحويل
              البنكي ومدى لا يدخلان الدرج.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-muted p-3 text-sm">
              الرصيد المتوقّع:{" "}
              <span className="font-semibold">
                {expected.data != null ? formatAmount(expected.data) : "…"} ر.س
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الرصيد الفعليّ المجرود *</Label>
              <Input
                type="number"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                autoFocus
              />
            </div>
            {liveVariance != null && liveVariance !== 0 && (
              <>
                <p
                  className={`text-sm font-medium ${
                    liveVariance < 0 ? "text-destructive" : "text-amber-700"
                  }`}
                >
                  فرق: {formatAmount(liveVariance)} ر.س
                  {liveVariance < 0 ? " (عجز)" : " (زيادة)"}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>سبب الفرق *</Label>
                  <Textarea
                    rows={2}
                    value={varianceReason}
                    onChange={(e) => setVarianceReason(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={
                counted === "" ||
                (liveVariance != null && liveVariance !== 0 && !varianceReason.trim()) ||
                closeShift.isPending
              }
              onClick={() => closeShift.mutate()}
            >
              {closeShift.isPending ? "جارٍ الإغلاق..." : "إغلاق المناوبة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// مؤشرات الخصم والتحصيل (لقطة 47) — نسبة الخصم الفعلية ونسبة التحصيل
// ---------------------------------------------------------------------------

/**
 * الدالة `app_invoice_kpis` موجودة في قاعدة البيانات منذ 0010 وتحسب النسبتين
 * بدقة، لكن لم تكن تُستدعى من أي مكان — كانت الشاشة تعرض الإجمالي والمتبقي
 * الخام فقط. الحساب يبقى في قاعدة البيانات لأنه يشمل كل فواتير المدة لا
 * الخمسين المعروضة في الجدول.
 */
type InvoiceKpis = {
  gross_amount: number;
  discount_amount: number;
  discount_rate_percent: number;
  net_amount: number;
  paid_amount: number;
  collection_rate_percent: number;
};

const KPI_RANGES = [
  { value: "30", label: "آخر 30 يومًا" },
  { value: "90", label: "آخر 90 يومًا" },
  { value: "365", label: "آخر سنة" },
];

function InvoiceKpiBar({ organizationId }: { organizationId: string | undefined }) {
  const [range, setRange] = useState("30");

  const kpis = useQuery({
    queryKey: ["invoice-kpis", organizationId, range],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - Number(range));
      const { data, error } = await supabase.rpc("app_invoice_kpis", {
        p_organization_id: organizationId,
        p_date_from: from.toISOString().slice(0, 10),
        p_date_to: to.toISOString().slice(0, 10),
      });
      if (error) throw error;
      // الدالة تُرجع صفًا واحدًا
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as InvoiceKpis | null;
    },
  });

  const data = kpis.data;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">مؤشرات الأداء</CardTitle>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KPI_RANGES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {kpis.isLoading && <Skeleton className="h-16 w-full" />}
        {!kpis.isLoading && data && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">إجمالي قبل الخصم</p>
              <p className="text-lg font-bold tabular-nums">{Number(data.gross_amount).toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">الخصومات</p>
              <p className="text-lg font-bold tabular-nums">{Number(data.discount_amount).toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">نسبة الخصم</p>
              <p className="text-lg font-bold tabular-nums text-amber-600">
                {Number(data.discount_rate_percent).toFixed(2)}%
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">نسبة التحصيل</p>
              <p
                className={
                  Number(data.collection_rate_percent) >= 80
                    ? "text-lg font-bold tabular-nums text-emerald-700"
                    : "text-lg font-bold tabular-nums text-destructive"
                }
              >
                {Number(data.collection_rate_percent).toFixed(2)}%
              </p>
            </div>
          </div>
        )}
        {!kpis.isLoading && !data && (
          <p className="py-4 text-center text-sm text-muted-foreground">لا توجد فواتير في هذه المدة.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الذمم: ما لم يُحصَّل بعد
//
// كان الجواب عن «كم لنا عند المرضى؟» يتطلّب فتح كل فاتورة على حدة. المنظوران
// `v_invoice_register` و`v_patient_balance` (0091) يحسبانه في القاعدة على كل
// الفواتير لا على الخمسين المعروضة.
// ---------------------------------------------------------------------------
function ReceivablesBar({ organizationId }: { organizationId: string | undefined }) {
  /**
   * المتأخرات تُقرأ من `v_report_outstanding` لا من `v_invoice_register`.
   *
   * `v_invoice_register.is_overdue` تُحسب من الحالة والتاريخ **بلا استثناء
   * `is_temporary`**، وعرض السعر يُحفَظ بحالة `unpaid` — فكان عرض سعر لمريض
   * مستفسر يظهر بعد ثلاثين يومًا في «فواتير تجاوزت ٣٠ يومًا بلا سداد» ويُطالَب
   * به. والمنظور لا يُخرج `is_temporary` أصلًا فلا يمكن ترشيحه من الواجهة،
   * بينما `v_report_outstanding` تستثني المؤقّت في القاعدة نفسها
   * (`coalesce(is_temporary,false) = false`) مع نفس شرطَي الحالة والمتبقّي.
   */
  const overdue = useQuery({
    queryKey: ["invoice-register-overdue", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_report_outstanding")
        .select("invoice_id, invoice_number, patient_name, net_amount, remaining_amount, days_outstanding")
        .eq("organization_id", organizationId)
        .gt("days_outstanding", 30)
        .order("days_outstanding", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * تنبيه: `v_patient_balance.balance_due` يجمع الحالات `unpaid`/`partial`
   * **بلا استثناء `is_temporary`**، فعرض السعر يظهر ذمّةً على المريض. المنظور
   * مجموعٌ في القاعدة ولا يُخرج `is_temporary`، فلا يمكن ترشيحه من الواجهة ولا
   * إعادة جمعه هنا (المبلغ الذي تحسبه القاعدة لا يُعاد حسابه في المتصفّح) —
   * الإصلاح في تعريف المنظور نفسه.
   */
  const debtors = useQuery({
    queryKey: ["patient-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_balance")
        .select("patient_id, patient_name, file_number, balance_due, open_invoices")
        .eq("organization_id", organizationId)
        .gt("balance_due", 0)
        .order("balance_due", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const overdueTotal = (overdue.data ?? []).reduce(
    (s, r) => s + Number(r.remaining_amount ?? 0),
    0,
  );
  const debtorsTotal = (debtors.data ?? []).reduce((s, r) => s + Number(r.balance_due ?? 0), 0);

  if (overdue.isLoading || debtors.isLoading) return <Skeleton className="h-20 w-full" />;
  if ((overdue.data ?? []).length === 0 && (debtors.data ?? []).length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>فواتير تجاوزت ٣٠ يومًا بلا سداد</CardDescription>
          <CardTitle className="text-xl">
            {(overdue.data ?? []).length} فاتورة · {formatAmount(overdueTotal)} ر.س
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {(overdue.data ?? []).slice(0, 3).map((r) => (
              <span key={r.invoice_id}>
                #{r.invoice_number} — {r.patient_name} —{" "}
                {formatAmount(r.remaining_amount)} ر.س ({r.days_outstanding} يومًا)
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>أعلى الذمم على المرضى</CardDescription>
          <CardTitle className="text-xl">{formatAmount(debtorsTotal)} ر.س</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {(debtors.data ?? []).slice(0, 3).map((r) => (
              <span key={r.patient_id}>
                {r.patient_name}
                {r.file_number ? ` (${r.file_number})` : ""} —{" "}
                {formatAmount(r.balance_due)} ر.س · {r.open_invoices} فاتورة
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// أدوية مصروفة غير مفوترة
//
// **الخلل الذي يعالجه هذا القسم**: الصيدليّ يُصدر وصفة من شاشة الصيدلية ثم
// يصرفها، فينقص المخزون ويخرج الدواء إلى المريض — ولا يظهر في الفوترة إطلاقًا.
// السبب أن وصفة الصيدلية تُنشأ **بلا زيارة**، وكلا مسارَي الفوترة كان يشترط
// الزيارة: `v_visit_orders_unbilled` تنتهي بـ`visit_id is not null`، و
// `app_create_invoice_from_visit` تجمع المصروف من وصفات زيارة واحدة. فكان
// الدواء المصروف لمريض جاء إلى الصيدلية مباشرةً إيرادًا نُفِّذ ولا يُحصَّل، ولا
// حلقة له إلا زرّ «تمت الفوترة» في شاشة الصيدلية — وهو علم منطقي لا فاتورة.
//
// المنظور `v_unbilled_dispensed_prescriptions` (0145) هو المصدر: صفٌّ لكل صنف
// **صُرف ولم يُفوتَر** بالكمّية **المصروفة** لا الموصوفة، وبسعر الدفعة الفعليّ
// (`dispensing_items.unit_price`) لا بسعر الصنف — ولو كانت الوصفة بلا زيارة.
// ---------------------------------------------------------------------------
type UnbilledDispensedRow = {
  prescription_id: string;
  patient_id: string;
  patient_name: string | null;
  file_number: string | null;
  visit_id: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  dispensed_at: string | null;
  prescription_item_id: string | null;
  item_id: string | null;
  item_name: string | null;
  qty: number;
  unit_price: number;
  is_vat_exempt: boolean;
};

function UnbilledDispensedPanel({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rows = useQuery({
    queryKey: ["billing-unbilled-dispensed", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_unbilled_dispensed_prescriptions")
        .select(
          "prescription_id, patient_id, patient_name, file_number, visit_id, doctor_id, doctor_name, dispensed_at, prescription_item_id, item_id, item_name, qty, unit_price, is_vat_exempt",
        )
        .eq("organization_id", organizationId)
        .order("dispensed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as UnbilledDispensedRow[];
    },
  });

  /**
   * التجميع **بالمريض** لا بالوصفة: المريض الذي صُرفت له ثلاث وصفات في يوم
   * واحد يُفوتَر مرة واحدة، فلا يستلم ثلاث فواتير ولا يُحصَّل ثلاث مرات.
   */
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        patientId: string;
        patientName: string;
        fileNumber: string | null;
        rows: UnbilledDispensedRow[];
      }
    >();
    for (const row of rows.data ?? []) {
      if (!map.has(row.patient_id)) {
        map.set(row.patient_id, {
          patientId: row.patient_id,
          patientName: row.patient_name ?? "—",
          fileNumber: row.file_number,
          rows: [],
        });
      }
      map.get(row.patient_id)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [rows.data]);

  const createInvoice = useMutation({
    mutationFn: async (group: { patientId: string; rows: UnbilledDispensedRow[] }) => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (group.rows.length === 0) throw new Error("لا بنود مصروفة لهذا المريض");

      const prescriptionIds = Array.from(new Set(group.rows.map((row) => row.prescription_id)));
      const doctorIds = Array.from(
        new Set(group.rows.map((row) => row.doctor_id).filter((id): id is string => Boolean(id))),
      );
      /**
       * الزيارة تُمرَّر فقط إن كانت **واحدة لكل الوصفات المُجمَّعة**: حارس
       * الدالّة يرفض وصفة زيارتها تخالف `p_visit_id` (وأي وصفة صيدلية مباشرة
       * زيارتها `NULL`)، فتمرير زيارة إحدى الوصفات كان سيُلغي المعاملة كلها
       * برسالة «الوصفات لا تخصّ هذه الزيارة».
       */
      const visitIds = Array.from(new Set(group.rows.map((row) => row.visit_id)));
      const singleVisitId = visitIds.length === 1 && visitIds[0] ? visitIds[0] : null;

      /**
       * الإنشاء عبر `app_create_sales_invoice` في نداء واحد: الدالّة تُدرج
       * الرأس والبنود، وتحسب الخصم والضريبة والصافي في القاعدة، وتختم
       * `prescriptions.is_billed` **داخل نفس المعاملة** بحارس تزامن
       * (`is_billed = false`) — فإن فوترها محاسب آخر بين لحظة العرض ولحظة
       * الحفظ أُلغيت المعاملة كلها بدل أن يُفوتَر الدواء مرتين.
       */
      const { data: newInvoiceId, error } = await supabase.rpc("app_create_sales_invoice", {
        p_organization_id: organizationId,
        p_items: group.rows.map((row) => ({
          item_id: row.item_id,
          description: row.item_name,
          // الكمية المصروفة والسعر يأتيان من المنظور كما هما — لا تسعير في
          // الواجهة: سعر الدفعة الفعليّ هو ما خرج من المخزون.
          qty: Number(row.qty) || 0,
          price: Number(row.unit_price) || 0,
          is_vat_exempt: Boolean(row.is_vat_exempt),
          doctor_id: row.doctor_id,
        })),
        p_patient_id: group.patientId,
        p_visit_id: singleVisitId,
        p_doctor_id: doctorIds.length === 1 ? doctorIds[0] : null,
        p_invoice_type: "sale",
        p_note: `فوترة أدوية مصروفة — ${prescriptionIds.length} وصفة`,
        p_prescription_ids: prescriptionIds,
      });
      if (error) throw error;
      if (!newInvoiceId) throw new Error("لم تُنشأ الفاتورة — أعد المحاولة");
      return newInvoiceId as string;
    },
    onSuccess: () => {
      // الوصفة خُتمت `is_billed = true` فخرجت من المنظور: بلا هذا التبطيل تبقى
      // معروضة هنا فيحاول المستخدم فوترتها ثانيةً وترفضه القاعدة.
      queryClient.invalidateQueries({ queryKey: ["billing-unbilled-dispensed"] });
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["patient-balances"] });
      // حالة الفوترة معروضة للصيدليّ في شاشة الصيدلية — تُحدَّث معها.
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-queue"] });
      toast({ title: "صدرت فاتورة الأدوية المصروفة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إصدار فاتورة الأدوية",
        description: errorMessage(error),
      }),
  });

  if (rows.isLoading) return <Skeleton className="h-24 w-full" />;
  if (rows.isError)
    return (
      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">أدوية مصروفة غير مفوترة</CardTitle>
          <CardDescription className="text-destructive">
            تعذّر تحميل القائمة:{" "}
            {errorMessage(rows.error)}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  if (groups.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">أدوية مصروفة غير مفوترة</CardTitle>
        <CardDescription>
          دواء خرج من المخزون ولم تُصدَر له فاتورة — بالكمّية المصروفة وبسعر دفعتها، مجمَّعًا
          بالمريض. الضريبة والصافي تُحسبان في القاعدة عند الإصدار.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المريض</TableHead>
              <TableHead>#الملف</TableHead>
              <TableHead>الأدوية المصروفة</TableHead>
              <TableHead>الوصفات</TableHead>
              <TableHead>قيمة المصروف قبل الضريبة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const prescriptionCount = new Set(group.rows.map((row) => row.prescription_id)).size;
              const gross = group.rows.reduce(
                (sum, row) => sum + (Number(row.qty) || 0) * (Number(row.unit_price) || 0),
                0,
              );
              const busy = createInvoice.isPending && createInvoice.variables?.patientId === group.patientId;
              return (
                <TableRow key={group.patientId}>
                  <TableCell className="font-medium">{group.patientName}</TableCell>
                  <TableCell className="font-mono text-xs">{group.fileNumber ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {group.rows
                      .map((row) => `${row.item_name ?? "دواء"} × ${Number(row.qty) || 0}`)
                      .join("، ")}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">{prescriptionCount}</TableCell>
                  <TableCell className="tabular-nums text-sm">{gross.toFixed(2)}</TableCell>
                  <TableCell className="text-left">
                    <Button size="sm" disabled={createInvoice.isPending} onClick={() => createInvoice.mutate(group)}>
                      {busy ? "جارٍ الإصدار..." : "إصدار فاتورة"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
