import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MoreHorizontal, Plus, Printer, Receipt, Send, WalletCards, Undo2 } from "lucide-react";
import ZatcaPendingDialog, { useZatcaPending } from "@/components/billing/ZatcaPendingDialog";
import { useZatcaAutoSettings } from "@/lib/zatca-auto";
import { useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import NewInvoiceDialog, {
  type BillingAppointmentContext,
} from "@/components/billing/NewInvoiceDialog";
import BusinessDayPanel from "@/components/billing/BusinessDayPanel";
import CashRegistersDialog from "@/components/billing/CashRegistersDialog";
import { useCurrentBusinessDate } from "@/lib/business-day";
import {
  RecordPaymentDialog,
  useCashRegisters,
} from "@/components/billing/RecordPaymentDialog";
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
import SendInvoiceDialog from "@/components/billing/SendInvoiceDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadInvoicePdf, loadInvoicePrintData, registerInvoicePrint } from "@/lib/invoice-pdf";
import { printInvoiceReceipt, type InvoicePrintData } from "@/lib/invoice-receipt";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/lib/permissions";
import TaxSettingsTab, {
  VatReturnPanel,
  TaxInvoicePreview,
} from "@/components/billing/TaxSettingsTab";
import TaxInvoicesPanel from "@/components/billing/TaxInvoicesPanel";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_LABELS } from "@/lib/invoice-status";

// التسميات والألوان من مصدر واحد — تُشاركها شاشة الفواتير وملفّ المريض
const STATUS_LABELS = INVOICE_STATUS_LABELS;
const STATUS_BADGE = INVOICE_STATUS_BADGE;

/**
 * فواتير مدّةٍ من أيام العمل (0181): يوم العمل الحالي افتراضًا، و«من — إلى»
 * لما سبقه. كانت القائمة يومًا واحدًا بمنتقٍ واحد، فمراجعة أسبوعٍ سبعُ
 * عمليات بحث. والتاريخ تاريخ **يوم العمل** لا التقويم: فاتورة الواحدة فجرًا
 * تُحسب لليوم الذي قبلها إن كان يوم العمل يمتدّ بعد منتصف الليل.
 */
function useInvoices(
  organizationId: string | undefined,
  status: string,
  quotesOnly: boolean,
  businessFrom: string | null,
  businessTo: string | null,
) {
  return useQuery({
    queryKey: ["invoices-list", organizationId, status, quotesOnly, businessFrom, businessTo],
    enabled: Boolean(organizationId && businessFrom && businessTo),
    queryFn: async () => {
      let query = supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, document_number, document_type, appointment_id, created_at, status, is_temporary, invoice_type, subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, paid_amount, credited_amount, remaining_amount, insurance_share_amount, patient_share_amount, insurance_company_name, external_customer_name, zatca_invoice_number, zatca_qr, is_insurance_invoice, created_by, nationality_value_id, patient:patients!sales_invoices_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!sales_invoices_doctor_tenant_fk(name_ar), nationality:lookup_values!sales_invoices_nationality_value_id_fkey(name_ar), business_day:business_days!inner(business_date)",
        )
        // التصفية بالمؤسسة إلزامية: سياسة RLS تسمح بكل مؤسسة **ينتمي إليها**
        // المستخدم، لا بالمؤسسة النشطة وحدها — فبدونها كانت قائمة عضو في
        // منشأتين تخلط فواتيرهما ويجمع الرأس إجماليَّ الاثنتين معًا.
        .eq("organization_id", organizationId)
        .gte("business_day.business_date", businessFrom)
        .lte("business_day.business_date", businessTo)
        .order("created_at", { ascending: false })
        .limit(500);
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
 * تجميع بيانات الفاتورة المطبوعة.
 *
 * **قراءةٌ واحدة من `v_invoice_print` (0157)** بدل ستّ قراءات في الواجهة:
 * البائع واسمه القانونيّ وعنوانه ورقمه الضريبيّ، والمريض وعمره وجنسيته ورقم
 * هويته وملفّه، والطبيب والعيادة، والشعار وشروط المجمع. كانت الورقة قبلها
 * جدولًا أبيض بلا هوية، و`print_settings.show_logo` يسأل عن شعارٍ لا وجود له
 * في القاعدة أصلًا.
 *
 * البنود وطرق الدفع تُجلبان عند الضغط لا مع القائمة: تحميلها لخمسين فاتورة
 * مقدّمًا لأجل واحدة قد تُطبع هدرٌ في كل فتح للشاشة.
 */

export default function Billing() {
  const { organization, membership, legacyMode, session } = useOrganizationAccess();
  const [searchParams] = useSearchParams();
  // تقويم المنشأة يُحترَم هنا كما في باقي الشاشات: كان الجدول يطبع بالتقويم
  // الذي يختاره المتصفّح للعربية (هجريًّا في كروم) بلا نظرٍ إلى الإعداد.
  const { calendarDisplay } = useLocaleSettings();
  const appointmentId = searchParams.get("appointmentId");
  /**
   * فتح الشاشة على مريضٍ بعينه.
   *
   * «فاتورة جديدة» في قائمة أوامر ملفّ المريض كانت تنتقل إلى هذه الشاشة
   * بمعامل `patientId` **لا تقرؤه الشاشة** — فيصل الموظّف إلى قائمة الفواتير
   * كلّها ويبحث عن المريض الذي كان واقفًا في ملفّه قبل لحظة.
   *
   * و`quote=new` يفتح عرض سعر، و`quote=list` يحصر القائمة بعروض الأسعار.
   */
  const patientIdParam = searchParams.get("patientId");
  const quoteParam = searchParams.get("quote");
  const memberNames = useMemberNames(organization?.id);
  /**
   * اسم من يطبع يظهر في تذييل الإيصال — كما في إيصال العيادات المرجعيّ.
   * ورقةٌ تُسلَّم للمريض يُسأل عنها لاحقًا: «من أصدرها؟» جوابه على الورقة.
   */
  const printedByName = session?.user.id
    ? memberNames.data?.get(session.user.id) ?? null
    : null;
  const [statusFilter, setStatusFilter] = useState("all");
  const [quotesOnly, setQuotesOnly] = useState(quoteParam === "new" || quoteParam === "list");
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
  /** بيانات الفاتورة المجمَّعة — تُستعمل للطباعة وللإرسال معًا. */
  const [sendData, setSendData] = useState<InvoicePrintData | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);
  /** فواتير لم تُبلَّغ ZATCA (0200) — تظهر حين يُحدَّد بدء الإبلاغ. */
  const [zatcaPendingOpen, setZatcaPendingOpen] = useState(false);
  const zatcaSettings = useZatcaAutoSettings(organization?.id);
  const zatcaTracking = Boolean(zatcaSettings.data?.zatca_report_from) && (can("billing.view") || can("billing.issue"));
  const zatcaPending = useZatcaPending(organization?.id, zatcaTracking);
  const zatcaPendingCount = zatcaPending.data?.length ?? 0;
  const zatcaLate = (zatcaPending.data ?? []).some((row) => row.hours_pending >= 20);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageBilling = legacyMode || ["owner", "organization_admin", "accountant", "receptionist"].includes(membership?.role_key ?? "");
  const currentBusinessDate = useCurrentBusinessDate(organization?.id);
  /** مدّة أيام العمل المعروضة: يوم العمل الحالي افتراضًا، و«من — إلى» للسابق. */
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const [pickedTo, setPickedTo] = useState<string | null>(null);
  const listFrom = pickedFrom ?? currentBusinessDate.data ?? null;
  const listTo = pickedTo ?? currentBusinessDate.data ?? null;
  const rangeIsToday =
    listFrom === currentBusinessDate.data && listTo === currentBusinessDate.data;
  const rangeInvalid = Boolean(listFrom && listTo && listTo < listFrom);
  const invoices = useInvoices(
    organization?.id,
    statusFilter,
    quotesOnly,
    rangeInvalid ? null : listFrom,
    rangeInvalid ? null : listTo,
  );
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

  /**
   * سياق المريض حين لا يكون هناك موعد. نفس شكل سياق الموعد بـ`id: null`،
   * فالنافذة تقبل الاثنين بلا فرع ثانٍ فيها.
   */
  const patientContext = useQuery({
    queryKey: ["billing-patient", organization?.id, patientIdParam],
    enabled: Boolean(organization?.id && patientIdParam && !appointmentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select(
          "id, name_ar, treating_doctor_id, insurance_company_name, insurance_policy_number, " +
            "insurance_policy_category, insurance_membership_number",
        )
        .eq("id", patientIdParam)
        // RLS يسمح بكل مؤسّسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organization?.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      return {
        id: null,
        patient_id: row.id,
        doctor_id: row.treating_doctor_id ?? null,
        clinic_id: null,
        patient: {
          id: row.id,
          name_ar: row.name_ar,
          insurance_company_name: row.insurance_company_name,
          insurance_policy_number: row.insurance_policy_number,
          insurance_policy_category: row.insurance_policy_category,
          insurance_membership_number: row.insurance_membership_number,
        },
      } as BillingAppointmentContext;
    },
  });

  const invoiceContext = appointment.data ?? patientContext.data ?? null;

  useEffect(() => {
    // `quote=list` يحصر القائمة ولا يفتح نافذة: من طلب رؤية عروض الأسعار لا
    // يريد نافذة إنشاءٍ تُغطّيها فور وصوله.
    if (quoteParam === "list") return;
    if (invoiceContext && canManageBilling) setCreateOpen(true);
  }, [invoiceContext, canManageBilling, quoteParam]);

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
    // المرتجع والإشعار الدائن يُنقصان الصافي ولا يُحسبان متبقّيًا على المريض (0205)
    const isReturn = (row: { invoice_type?: string | null }) => row.invoice_type === "return";
    return {
      net: rows.reduce((sum, row) => sum + (isReturn(row) ? -1 : 1) * Number(row.net_amount), 0),
      remaining: rows.reduce((sum, row) => sum + (isReturn(row) ? 0 : Number(row.remaining_amount)), 0),
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
          {zatcaTracking && (
            <Button
              variant="outline"
              className={zatcaLate ? "border-rose-400 text-rose-700" : undefined}
              onClick={() => setZatcaPendingOpen(true)}
              title="فواتير صادرة لم تقبلها ZATCA بعد"
            >
              <Send className="h-4 w-4" />
              لم تُبلَّغ ZATCA
              <Badge variant={zatcaPendingCount > 0 ? (zatcaLate ? "destructive" : "secondary") : "outline"} className="ms-1 font-mono">
                {zatcaPendingCount}
              </Badge>
            </Button>
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
          {/* الفواتير الضريبية بوعائها وضريبتها ومجموعها (05/10/2026) */}
          <TaxInvoicesPanel />
          <TaxSettingsTab />
          <VatReturnPanel />
          {/* «الفواتير الإلكترونية» (0092) كانت محاكاةً محليّة قبل الربط الفعليّ مع
              ZATCA ولا تُرسل شيئًا — أُزيلت من الشاشة؛ حالة الإبلاغ الحقيقية في
              زرّ «لم تُبلَّغ ZATCA» وفي كل فاتورة. */}
        </div>
      )}

      {!showShifts && !showTax && !showDay && <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>{quotesOnly ? "عروض الأسعار" : "الفواتير"}</CardTitle>
              <CardDescription>
                {rangeIsToday
                  ? `يوم العمل الحالي (${listFrom ?? "…"}) — الأيام السابقة من «من — إلى»`
                  : listFrom === listTo
                    ? `يوم العمل ${listFrom ?? ""}`
                    : `أيام العمل من ${listFrom ?? ""} إلى ${listTo ?? ""}`}
                {(invoices.data ?? []).length === 500 && " — تُعرض أحدث 500 فاتورة، ضيّق المدّة لرؤية ما قبلها"}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">من</Label>
                <Input
                  type="date"
                  className="w-40"
                  value={listFrom ?? ""}
                  max={listTo ?? undefined}
                  onChange={(event) => setPickedFrom(event.target.value || null)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">إلى</Label>
                <Input
                  type="date"
                  className="w-40"
                  value={listTo ?? ""}
                  min={listFrom ?? undefined}
                  onChange={(event) => setPickedTo(event.target.value || null)}
                />
              </div>
              {!rangeIsToday && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPickedFrom(null);
                    setPickedTo(null);
                  }}
                >
                  اليوم
                </Button>
              )}
            </div>
            {rangeInvalid && (
              <p className="w-full text-xs text-destructive">تاريخ «إلى» قبل تاريخ «من».</p>
            )}
          </div>
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
                      {/* ما سوّاه إشعارٌ دائن داخلٌ في المدفوع وليس نقدًا (0206) */}
                      {Number((invoice as { credited_amount?: number }).credited_amount ?? 0) > 0 && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          منها بإشعار دائن {formatAmount((invoice as { credited_amount?: number }).credited_amount ?? 0)}
                        </span>
                      )}
                    </TableCell>
                    {/* المرتجع والإشعار الدائن ليسا ذمّةً على المريض: لا «متبقٍّ» لهما (0205) */}
                    <TableCell
                      className={`whitespace-nowrap text-end tabular-nums ${
                        invoice.invoice_type !== "return" && Number(invoice.remaining_amount) > 0
                          ? "font-semibold text-rose-600"
                          : "text-muted-foreground"
                      }`}
                    >
                      {invoice.invoice_type === "return" ? "—" : formatAmount(invoice.remaining_amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {invoice.is_temporary ? (
                        <Badge className="bg-indigo-100 text-indigo-700">عرض سعر</Badge>
                      ) : (
                        <Badge className={STATUS_BADGE[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
                      )}
                    </TableCell>
                    {/* الإجراءات في سطرٍ واحد: التحميل والطباعة والإرسال ظاهرة، ثمّ
                        إجراءٌ رئيسيّ واحد بحسب حال الفاتورة، والباقي في «⋯».
                        كانت كلّها أزرارًا تلتفّ داخل الخلية فيرتفع كلّ صفٍّ إلى
                        ثلاثة أسطر أو أربعة، وجدولٌ من عشرين فاتورة يملأ صفحات. */}
                    <TableCell className="py-1.5">
                      <div className="flex items-center gap-0.5 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="تحميل PDF"
                        disabled={busyInvoiceId === invoice.id}
                        onClick={() => {
                          setBusyInvoiceId(invoice.id);
                          loadInvoicePrintData(invoice.id, printedByName)
                            .then((data) => downloadInvoicePdf(data))
                            .catch((error: unknown) =>
                              toast({
                                variant: "destructive",
                                title: "تعذر تجهيز ملفّ الفاتورة",
                                description: errorMessage(error),
                              }),
                            )
                            .finally(() => setBusyInvoiceId(null));
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="طباعة"
                        disabled={busyInvoiceId === invoice.id}
                        onClick={() => {
                          setBusyInvoiceId(invoice.id);
                          loadInvoicePrintData(invoice.id, printedByName)
                            // الطباعة من هذه الشاشة كانت لا تُسجَّل، فعدّاد
                            // «Printed Count» لا يتحرّك مهما طُبعت الفاتورة منها.
                            .then(async (data) => {
                              const stamp = await registerInvoicePrint(invoice.id);
                              printInvoiceReceipt({
                                ...data,
                                printCount: stamp?.print_count ?? data.printCount ?? 1,
                              });
                            })
                            .catch((error: unknown) =>
                              toast({
                                variant: "destructive",
                                title: "تعذر تجهيز الفاتورة للطباعة",
                                description: errorMessage(error),
                              }),
                            )
                            .finally(() => setBusyInvoiceId(null));
                        }}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      {/* الإرسال للمريض: واتساب أو بريد، بنصٍّ معبَّأ من بيانات
                          الفاتورة نفسها. لا تكامل ولا مفاتيح — الرابط يُفتح في
                          متصفّح الموظّف والإرسال من حسابه هو. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="إرسال للمريض"
                        disabled={busyInvoiceId === invoice.id}
                        onClick={() => {
                          setBusyInvoiceId(invoice.id);
                          loadInvoicePrintData(invoice.id, printedByName)
                            .then((data) => {
                              setSendData(data);
                              setSendOpen(true);
                            })
                            .catch((error: unknown) =>
                              toast({
                                variant: "destructive",
                                title: "تعذر تجهيز الفاتورة للإرسال",
                                description: errorMessage(error),
                              }),
                            )
                            .finally(() => setBusyInvoiceId(null));
                        }}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      {(() => {
                        const docType = (invoice as any).document_type ?? "";
                        const isNote = ["credit_note", "debit_note"].includes(docType);
                        // لا تحصيل على مرتجع أو إشعار دائن: ما يُردّ للمريض «استرداد» على فاتورته الأصلية
                        const canPay =
                          !invoice.is_temporary &&
                          invoice.invoice_type !== "return" &&
                          invoice.status !== "paid" &&
                          invoice.status !== "void";
                        const canIssue = invoice.status === "draft" && can("billing.issue");
                        const canReturn =
                          !invoice.is_temporary && invoice.invoice_type !== "return" && invoice.status !== "void";
                        const canDiscount = invoice.status === "draft" && !isNote && can("billing.discount");
                        const canCredit =
                          ["unpaid", "partial", "paid", "partially_refunded"].includes(invoice.status) &&
                          !isNote &&
                          can("billing.refund");
                        // المسوّدة تُلغى ولا تُحذف — ومنها الإشعار المكرَّر (0205)
                        const canVoid =
                          ["draft", "unpaid", "partial", "refunded"].includes(invoice.status) && can("billing.void");
                        // الإجراء الرئيسيّ: عرض السعر يُحوَّل، والمسوّدة تُصدَر، والصادرة تُحصَّل
                        const primary: "convert" | "issue" | "pay" | null = invoice.is_temporary
                          ? "convert"
                          : canIssue
                            ? "issue"
                            : canPay
                              ? "pay"
                              : null;
                        const menuPay = canPay && primary !== "pay";
                        const hasMenu = menuPay || canReturn || canDiscount || canCredit || canVoid;
                        return (
                          <>
                            {primary === "convert" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={convertToInvoice.isPending}
                                onClick={() => convertToInvoice.mutate(invoice.id)}
                              >
                                <Receipt className="h-3.5 w-3.5" />
                                تحويل لفاتورة
                              </Button>
                            )}
                            {primary === "issue" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => issueInvoice.mutate(invoice.id)}
                              >
                                إصدار
                              </Button>
                            )}
                            {primary === "pay" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => setPaymentTarget(invoice)}
                              >
                                <WalletCards className="h-3.5 w-3.5" />
                                تسجيل دفعة
                              </Button>
                            )}
                            {hasMenu && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" title="إجراءات أخرى">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  {menuPay && (
                                    <DropdownMenuItem onSelect={() => setPaymentTarget(invoice)}>
                                      <WalletCards className="h-4 w-4" />
                                      تسجيل دفعة
                                    </DropdownMenuItem>
                                  )}
                                  {canDiscount && (
                                    <DropdownMenuItem onSelect={() => setDiscountTarget(invoice)}>
                                      خصم
                                    </DropdownMenuItem>
                                  )}
                                  {canReturn && (
                                    <DropdownMenuItem onSelect={() => setReturnTarget(invoice)}>
                                      <Undo2 className="h-4 w-4" />
                                      إنشاء مرتجع
                                    </DropdownMenuItem>
                                  )}
                                  {canCredit && (
                                    <DropdownMenuItem
                                      onSelect={() => {
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
                                    </DropdownMenuItem>
                                  )}
                                  {canVoid && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => {
                                          const reason = window.prompt("سبب إلغاء الفاتورة؟");
                                          if (reason && reason.trim())
                                            voidInvoice.mutate({ id: invoice.id, reason: reason.trim() });
                                        }}
                                      >
                                        {invoice.status === "draft" ? "إلغاء المسوّدة" : "إلغاء الفاتورة"}
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </>
                        );
                      })()}
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
              خصمٌ على مستوى الفاتورة يُضاف إلى خصومات البنود، وتُحسب الضريبة بعده، ويُبلَّغ ZATCA كما هو. يُمنح
              على المسوّدة قبل الإصدار ويُسجَّل بسببه ومانحه؛ والصفر يلغيه. لا يُمنح على فاتورة تأمين.
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
      <ZatcaPendingDialog
        organizationId={organization?.id}
        open={zatcaPendingOpen}
        onOpenChange={setZatcaPendingOpen}
      />
      <SendInvoiceDialog
        data={sendData}
        open={sendOpen}
        onOpenChange={(next) => {
          setSendOpen(next);
          if (!next) setSendData(null);
        }}
        onPrint={() => {
          if (sendData) printInvoiceReceipt(sendData);
        }}
      />
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
      // فواتير المرتجع القديمة (قبل 0205) وحدها؛ الإشعارات الدائنة تُحسب بأسطرها أدناه
      const { data: returnInvoices, error } = await supabase
        .from("sales_invoices")
        .select("id")
        .eq("original_invoice_id", invoice!.id)
        .eq("invoice_type", "return")
        .neq("status", "void")
        .not("document_type", "in", "(credit_note,debit_note)");
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

  /**
   * ما في الإشعارات الدائنة غير الملغاة (مسوّدةً أو صادرة) من كلّ بند — بإشارة
   * البند إلى أصله (`corrects_item_id`، 0205). القاعدة تحسب الشيء نفسه وترفض
   * الزائد؛ وهنا يظهر الباقي قبل المحاولة.
   */
  const credited = useQuery({
    queryKey: ["credited-lines", invoice?.id],
    enabled: Boolean(invoice?.id),
    queryFn: async () => {
      const { data: notes, error } = await supabase
        .from("sales_invoices")
        .select("id")
        .eq("corrects_invoice_id", invoice!.id)
        .eq("document_type", "credit_note")
        .neq("status", "void");
      if (error) throw error;
      const ids = (notes ?? []).map((row) => (row as { id: string }).id);
      const map = new Map<string, number>();
      if (ids.length === 0) return map;
      const { data: noteLines, error: linesError } = await supabase
        .from("sales_invoice_items")
        .select("corrects_item_id, qty")
        .in("invoice_id", ids);
      if (linesError) throw linesError;
      for (const row of (noteLines ?? []) as { corrects_item_id: string | null; qty: number }[]) {
        if (!row.corrects_item_id) continue;
        map.set(row.corrects_item_id, (map.get(row.corrects_item_id) ?? 0) + (Number(row.qty) || 0));
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
      const inNotes = credited.data?.get(line.id) ?? 0;
      result.set(line.id, Math.max((Number(line.qty) || 0) - consumed - inNotes, 0));
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
      /**
       * المرتجع إشعارٌ دائن (0205) — `app_create_credit_note` ببنوده وكميّاتها.
       *
       * كان يمرّ بـ`app_create_sales_invoice` بنوع «return»، فيصدر فاتورةً
       * مستقلّة بنوع مستندٍ «مبسّطة» لا «إشعار دائن»: تُبلَّغ ZATCA فاتورةَ بيعٍ
       * جديدة (تزيد الإيراد بدل أن تُنقصه)، ولا ترتبط بأصلها ارتباط الإشعار.
       * والإشعار يحسب الخصم بنسبة الكمية من البند الأصليّ نفسه، ويرفض إرجاع
       * ما أُرجع قبلُ في إشعارٍ آخر — مسوّدةً كان أو صادرًا.
       */
      if (!note.trim()) throw new Error("اكتب سبب الإرجاع — الإشعار الدائن لا يصدر بلا سبب");
      const { data: newInvoiceId, error } = await supabase.rpc("app_create_credit_note", {
        p_invoice_id: invoice.id,
        p_reason: note.trim(),
        p_lines: selected.map((line) => ({ invoice_item_id: line.id, qty: line.returnQty })),
        p_note_type: "credit_note",
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
      queryClient.invalidateQueries({ queryKey: ["credited-lines"] });
      toast({ title: "أُنشئ الإشعار الدائن مسوّدة", description: "راجعه في القائمة ثمّ أصدره" });
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

  const busy = lines.isLoading || priorReturns.isLoading || credited.isLoading;

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
              المرتجع يُنشئ إشعارًا دائنًا مسوّدةً على هذه الفاتورة: يُراجَع ثمّ «إصدار» من القائمة فيُبلَّغ
              ZATCA. والنقد المُعاد للمريض يُسجَّل سندَ صرفٍ من زرّ «استرداد» في نافذة تحصيل الفاتورة
              الأصلية — بدونه يُغلق الصندوق بعجزٍ بقيمة ما رُدّ.
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
              <Label>سبب الإرجاع *</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="يُطبع على الإشعار ويُبلَّغ ZATCA" />
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
            disabled={createReturn.isPending || selected.length === 0 || !note.trim()}
            onClick={() => createReturn.mutate()}
          >
            {createReturn.isPending ? "جارٍ الإنشاء..." : "إنشاء الإشعار الدائن"}
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
  const [registersOpen, setRegistersOpen] = useState(false);

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
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>الصناديق والمناوبات</CardTitle>
          <CardDescription>
            لا قبض نقديّ بلا مناوبة مفتوحة — والإغلاق يحتاج جردًا فعليًا، والفرق يحتاج سببًا
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => setRegistersOpen(true)}>
          إدارة الصناديق
        </Button>
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
                    لا مناوبات بعد — اختر الصندوق وافتح مناوبة برصيده الافتتاحيّ الفعلي.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CashRegistersDialog open={registersOpen} onOpenChange={setRegistersOpen} organizationId={organizationId} />

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
