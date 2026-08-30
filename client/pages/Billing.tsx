import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Receipt, WalletCards, Undo2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { useInsuranceSettings } from "@/lib/insurance-settings";
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
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import { printHtml, type PaperSize } from "@/lib/document-merge";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة بالكامل",
  void: "ملغاة",
};
const STATUS_BADGE: Record<SalesInvoiceStatus, string> = {
  unpaid: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-slate-100 text-slate-500",
};

function useInvoices(organizationId: string | undefined, status: string, quotesOnly: boolean) {
  return useQuery({
    queryKey: ["invoices-list", organizationId, status, quotesOnly],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, appointment_id, created_at, status, is_temporary, invoice_type, subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, paid_amount, remaining_amount, insurance_share_amount, patient_share_amount, insurance_company_name, external_customer_name, zatca_invoice_number, zatca_qr, is_insurance_invoice, created_by, nationality_value_id, patient:patients!sales_invoices_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!sales_invoices_doctor_tenant_fk(name_ar), nationality:lookup_values!sales_invoices_nationality_value_id_fkey(name_ar)",
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
       التاريخ: ${new Date(invoice.created_at).toLocaleString("ar-SA")}<br />
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

type BillingAppointmentContext = {
  id: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string | null;
  patient: { id: string; name_ar: string; insurance_company_name: string | null; insurance_policy_number: string | null; insurance_policy_category: string | null; insurance_membership_number: string | null } | { id: string; name_ar: string; insurance_company_name: string | null; insurance_policy_number: string | null; insurance_policy_category: string | null; insurance_membership_number: string | null }[] | null;
};

export default function Billing() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get("appointmentId");
  const memberNames = useMemberNames(organization?.id);
  const printSettings = usePrintSettings(organization?.id);
  const [statusFilter, setStatusFilter] = useState("all");
  const [quotesOnly, setQuotesOnly] = useState(false);
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

  useEffect(() => {
    if (appointment.data && canManageBilling) setCreateOpen(true);
  }, [appointment.data, canManageBilling]);

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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
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
            إجمالي {quotesOnly ? "عروض الأسعار" : "الفواتير"}: {totals.net.toLocaleString("ar-SA")} ر.س · متبقي: {totals.remaining.toLocaleString("ar-SA")} ر.س
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button size="sm" variant={!quotesOnly ? "default" : "ghost"} onClick={() => setQuotesOnly(false)}>
              الفواتير
            </Button>
            <Button size="sm" variant={quotesOnly ? "default" : "ghost"} onClick={() => setQuotesOnly(true)}>
              عروض الأسعار
            </Button>
          </div>
          {!quotesOnly && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="unpaid">غير مدفوعة</SelectItem>
                <SelectItem value="partial">مدفوعة جزئيًا</SelectItem>
                <SelectItem value="paid">مدفوعة بالكامل</SelectItem>
              </SelectContent>
            </Select>
          )}
          {canManageBilling && <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {quotesOnly ? "عرض سعر جديد" : "فاتورة جديدة"}
          </Button>}
        </div>
      </div>

      {!quotesOnly && <InvoiceKpiBar organizationId={organization?.id} />}

      <Card>
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
                <TableRow>
                  <TableHead>#الفاتورة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الوقت</TableHead>
                  <TableHead>الجنسية</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>دون ضريبة</TableHead>
                  <TableHead>الخصم</TableHead>
                  <TableHead>الإعفاء</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>المدفوع</TableHead>
                  <TableHead>المتبقي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
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
                    <TableCell>{invoice.patient?.name_ar ?? invoice.external_customer_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {invoice.patient?.file_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invoice.doctor?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(invoice.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {new Date(invoice.created_at).toLocaleTimeString("ar-SA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {invoice.nationality?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {invoice.created_by ? memberNames.data?.get(invoice.created_by) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(invoice.subtotal_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums text-amber-700">
                      {Number(invoice.discount_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {Number(invoice.exemption_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(invoice.vat_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {Number(invoice.net_amount).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums text-emerald-700">
                      {Number(invoice.paid_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className={Number(invoice.remaining_amount) > 0 ? "text-rose-600" : ""}>
                      {Number(invoice.remaining_amount).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      {invoice.is_temporary ? (
                        <Badge className="bg-indigo-100 text-indigo-700">عرض سعر</Badge>
                      ) : (
                        <Badge className={STATUS_BADGE[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex items-center gap-2">
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
                              description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
                    </TableCell>
                  </TableRow>
                ))}
                {(invoices.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={18} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فواتير مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organization?.id}
        vatRate={organization?.default_vat_rate ?? 15}
        isQuote={quotesOnly}
        appointment={appointment.data ?? null}
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
  const { session } = useOrganizationAccess();
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const lines = useQuery({
    queryKey: ["return-source-lines", invoice?.id],
    enabled: Boolean(invoice?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "id, item_id, description, price, qty, discount_percent, discount_amount, vat_rate, vat_amount, net_amount, doctor_id",
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

      const { data: created, error } = await supabase
        .from("sales_invoices")
        .insert({
          organization_id: organizationId,
          invoice_type: "return",
          original_invoice_id: invoice.id,
          patient_id: invoice.patient?.id ?? null,
          external_customer_name: invoice.patient ? null : invoice.external_customer_name,
          subtotal_amount: round2(totals.subtotal),
          discount_amount: round2(totals.discount),
          vat_amount: round2(totals.vat),
          net_amount: round2(totals.net),
          // المرتجع يُنشأ مسدَّدًا: المبلغ رُدّ للمريض عند الإرجاع. تركه
          // "غير مدفوع" كان سيُظهره كذمّة مدينة على المريض — عكس الحقيقة.
          paid_amount: round2(totals.net),
          status: "paid",
          note: note.trim() || `مرتجع للفاتورة #${invoice.invoice_number}`,
          created_by: session?.user.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const payload = selected.map((line) => ({
        invoice_id: (created as { id: string }).id,
        item_id: line.item_id,
        description: line.description,
        price: line.price,
        qty: line.returnQty,
        discount_percent: line.discount_percent,
        discount_amount: round2(line.returnDiscount),
        vat_rate: line.vat_rate,
        vat_amount: round2(line.returnVat),
        net_amount: round2(line.returnNet),
        doctor_id: line.doctor_id,
      }));
      const { error: linesError } = await supabase.from("sales_invoice_items").insert(payload);
      if (linesError) throw linesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      queryClient.invalidateQueries({ queryKey: ["prior-returns"] });
      toast({ title: "تم إنشاء فاتورة المرتجع" });
      setQtyByLine({});
      setNote("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء المرتجع",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
              حدّد الكمية المرتجعة من كل بند. المبالغ تُحتسب بنسبة الكمية من الأصل، فيُردّ للمريض
              ما دفعه فعلًا بعد الخصم لا سعر القائمة.
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

type DraftLine = {
  key: string;
  item_id: string | null;
  description: string;
  price: number;
  qty: number;
  discount_percent: number;
  /** النسبة التي اقترحها app_resolve_discount — للتمييز بين الآلي واليدوي. */
  auto_discount_percent: number;
  is_vat_exempt: boolean;
  /**
   * ربط السطر ببند اتفاقية علاجية. هذا هو المفتاح الذي يعتمد عليه المُحفِّز
   * `app_recalc_agreement_invoiced` (0003) لتحديث `treatment_agreements.invoiced_amount`
   * — وكان لا يُكتب من هذه الشاشة إطلاقًا، فبقي المبلغ المفوتَر صفرًا مهما
   * فُوترت الاتفاقية، وظهر "المتبقي" خاطئًا في كل تقرير.
   */
  agreement_item_id: string | null;
  /** رقم الاتفاقية — للعرض بجانب السطر فقط، لا يُكتب في القاعدة. */
  agreement_label: string | null;
  /**
   * الخدمة المنفَّذة في الزيارة التي وُلِّد منها هذا السطر (0053).
   *
   * وجوده يجعل الفهرس الفريد في القاعدة يرفض فوترة الخدمة مرتين — فالمنع
   * ليس في هذه الشاشة بل تحتها.
   */
  visit_service_id: string | null;
  /**
   * الطلب (مختبر/أشعة/وصفة) الذي وُلِّد منه هذا السطر (0057).
   *
   * اختياري عمدًا: مواضع إنشاء السطور الأخرى لا تعرف الطلبات، وجعله إلزاميًا
   * كان سيفرض تعديلها كلها بلا فائدة.
   */
  order_source_type?: "lab" | "radiology" | "prescription" | null;
  order_id?: string | null;
};

type VisitOrderRow = {
  source_type: "lab" | "radiology" | "prescription";
  source_order_id: string;
  source_item_id: string;
  item_id: string | null;
  item_name: string;
  source_name: string;
  qty: number;
  unit_price: number;
  is_vat_exempt: boolean;
};

const ORDER_TYPE_LABELS: Record<VisitOrderRow["source_type"], string> = {
  lab: "طلب مختبر",
  radiology: "طلب أشعة",
  prescription: "وصفة",
};

/** قيمة "بدون اختيار" في قوائم Select (لا تقبل قيمة فارغة). */
const NONE = "__none__";

type AgreementItemOption = {
  itemId: string;
  agreementItemId: string;
  agreementNumber: number;
  description: string;
  qty: number;
  unitPrice: number;
  discountPercent: number;
  invoicedQty: number;
};

/**
 * بنود الاتفاقيات العلاجية القابلة للفوترة لمريض بعينه.
 *
 * سبب وجود هذا الاستعلام: التدقيق أثبت أن `sales_invoice_items.agreement_item_id`
 * **لا يُكتب من شاشة الفوترة إطلاقًا** — يُكتب فقط من تبويب الجلسات. والمُحفِّز
 * `app_recalc_agreement_invoiced` (0003) يجمع `net_amount` لبنود الفواتير
 * المربوطة بهذا المفتاح ليحدّث `treatment_agreements.invoiced_amount`. فبلا
 * الربط تبقى الاتفاقية "غير مفوترة" أبدًا مهما صُرف عليها، ويظهر المتبقّي
 * مساويًا للإجمالي في كل تقرير.
 *
 * `invoicedQty` يُحتسب هنا لا في القاعدة: هو عدد ما فُوتر فعلًا من كل بند،
 * ويُستخدم لمنع فوترة البند مرتين — وهو الخطأ الذي يجعل `invoiced_amount`
 * يتجاوز `total_amount` فيظهر المتبقّي سالبًا.
 */
function useAgreementItemsForBilling(patientId: string | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-agreement-items", patientId, organizationId],
    enabled: Boolean(patientId && organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_agreements")
        .select(
          "id, agreement_number, treatment_agreement_items(id, item_id, description, qty, unit_price, discount_percent)",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .eq("is_disabled", false)
        .order("agreement_number");
      if (error) throw error;

      const agreements = (data ?? []) as unknown as {
        id: string;
        agreement_number: number;
        treatment_agreement_items: {
          id: string;
          item_id: string | null;
          description: string | null;
          qty: number;
          unit_price: number;
          discount_percent: number;
        }[];
      }[];

      const options: AgreementItemOption[] = [];
      for (const agreement of agreements) {
        for (const item of agreement.treatment_agreement_items ?? []) {
          if (!item.item_id) continue;
          options.push({
            itemId: item.item_id,
            agreementItemId: item.id,
            agreementNumber: agreement.agreement_number,
            description: item.description ?? "بند اتفاقية",
            qty: Number(item.qty) || 1,
            unitPrice: Number(item.unit_price) || 0,
            discountPercent: Number(item.discount_percent) || 0,
            invoicedQty: 0,
          });
        }
      }
      if (options.length === 0) return options;

      /**
       * كم فُوتر من كل بند حتى الآن — استعلام واحد لكل البنود لا استعلام لكل بند.
       *
       * **الرأس يُجلب مع البند ويُصفّى به.** بلا ذلك كان عرض السعر
       * (`is_temporary = true`) والفاتورة الملغاة (`status = 'void'`) يُحسبان
       * فوترةً: يبني الموظف عرض سعر يحوي بند اتفاقية، فيُقفل البند إلى الأبد
       * ("مفوتَر بالكامل") ولا يمكن فوترته مربوطًا أبدًا — فلا يعمل المُحفِّز
       * ويبقى المتبقّي خاطئًا. أي أن الميزة كانت تُعطّل نفسها بالاستعمال.
       */
      const { data: billed, error: billedError } = await supabase
        .from("sales_invoice_items")
        .select("agreement_item_id, qty, invoice:sales_invoices!inner(is_temporary, status)")
        .in(
          "agreement_item_id",
          options.map((option) => option.agreementItemId),
        );
      if (billedError) throw billedError;

      const billedQty = new Map<string, number>();
      for (const raw of billed ?? []) {
        const row = raw as {
          agreement_item_id: string | null;
          qty: number;
          invoice: { is_temporary: boolean; status: string } | { is_temporary: boolean; status: string }[] | null;
        };
        if (!row.agreement_item_id) continue;
        const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
        if (!invoice || invoice.is_temporary || invoice.status === "void") continue;
        billedQty.set(row.agreement_item_id, (billedQty.get(row.agreement_item_id) ?? 0) + (Number(row.qty) || 0));
      }
      return options.map((option) => ({
        ...option,
        invoicedQty: billedQty.get(option.agreementItemId) ?? 0,
      }));
    },
  });
}

function useBillingDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // عمود التفعيل في `doctors` اسمه `is_enabled` لا `is_disabled` (0002).
        // الاستعلام القديم كان يفشل كليًا فتبقى قائمة الأطباء فارغة دائمًا.
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

function useBillingClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // عمود العيادة اسمه `name` لا `name_ar` (0001) — الاستعلام القديم كان
      // يفشل بالكامل فتظهر قائمة العيادات فارغة دائمًا في نافذة الفاتورة.
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useBillingWarehouses(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-warehouses", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/**
 * مجموعات الفوترة السريعة (لقطة 22) — أزرار تُضيف عدة أصناف دفعةً واحدة.
 * ليست عروضًا (`offers`): العرض كيان تسعيري له نسبة خصم ومدة صلاحية، وهذه
 * اختصار إدخال بلا أي أثر مالي. جداولها في 0042.
 */
function useQuickGroups(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["quick-invoice-groups", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_invoice_groups")
        .select(
          "id, name_ar, color, sort_order, quick_invoice_group_items(id, qty, item:items(id, name_ar, price, is_vat_exempt))",
        )
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as QuickGroupRow[];
    },
  });
}

type QuickGroupRow = {
  id: string;
  name_ar: string;
  color: string | null;
  sort_order: number;
  quick_invoice_group_items: {
    id: string;
    qty: number;
    item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean } | null;
  }[];
};

function NewInvoiceDialog({
  open,
  onOpenChange,
  organizationId,
  vatRate,
  isQuote,
  appointment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  vatRate: number;
  isQuote?: boolean;
  appointment: BillingAppointmentContext | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [externalName, setExternalName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  // رأس الفاتورة — كانت هذه الحقول كلها موجودة في جدول sales_invoices منذ
  // 0003 لكن النافذة لم تكن تُدخل أيًا منها (8 أعمدة من 48).
  const [doctorId, setDoctorId] = useState(NONE);
  const [clinicId, setClinicId] = useState(NONE);
  const [warehouseId, setWarehouseId] = useState(NONE);
  const [idNumber, setIdNumber] = useState("");
  const [note, setNote] = useState("");

  // قسم التأمين — كان غائبًا بالكامل رغم وجود 10 أعمدة له في الجدول،
  // فلم يكن ممكنًا إصدار فاتورة تأمين صحيحة من الواجهة إطلاقًا.
  const [isInsurance, setIsInsurance] = useState(false);
  const [insCompany, setInsCompany] = useState("");
  const [insPolicy, setInsPolicy] = useState("");
  const [insClass, setInsClass] = useState("");
  const [insMembership, setInsMembership] = useState("");
  const [insCopayPercent, setInsCopayPercent] = useState("");
  const [insMaxAmount, setInsMaxAmount] = useState("");
  const [insApprovalNumber, setInsApprovalNumber] = useState("");
  /**
   * فاتورة أعمال (B2B) — عمود `is_b2b` موجود في `sales_invoices` ولم يكن
   * يُكتب من أي مكان، فبقي `false` دائمًا. وZATCA تفرّق بين الفاتورة
   * الضريبية (B2B: تتطلب اسم المشتري ورقمه الضريبي) والفاتورة الضريبية
   * المبسّطة (B2C) — والخلط بينهما سبب رفض شائع.
   */
  const [isB2b, setIsB2b] = useState(false);

  const doctors = useBillingDoctors(organizationId);
  const clinics = useBillingClinics(organizationId);
  const warehouses = useBillingWarehouses(organizationId);
  const quickGroups = useQuickGroups(organizationId);
  const agreementItems = useAgreementItemsForBilling(patient?.id, organizationId);
  const insuranceSettings = useInsuranceSettings(organizationId);

  /**
   * الزيارة المرتبطة بالموعد — لتخزينها في `sales_invoices.visit_id` (0052).
   *
   * بلا هذا الربط تبقى الفاتورة معلَّقة بالموعد وحده، فيتعذّر الرجوع من
   * الفاتورة إلى الزيارة التي وُلِّدت منها — وهو ما يقطع التسلسل المطلوب:
   * خدمة منفَّذة في زيارة ← بند فاتورة ← دفعة ← إغلاق مالي.
   *
   * فهرس فريد على `patient_visits(appointment_id)` يضمن زيارة واحدة لكل موعد،
   * فـ`maybeSingle` آمن هنا ولا يخفي تعدّدًا.
   */
  const appointmentVisit = useQuery({
    queryKey: ["billing-appointment-visit", organizationId, appointment?.id],
    enabled: Boolean(organizationId && appointment?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("appointment_id", appointment!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    },
  });
  const appointmentVisitId = appointmentVisit.data ?? null;

  /**
   * خدمات الزيارة التي لم تُفوتَر بعد — تُقرأ من منظور `v_visit_services_unbilled`
   * (0053) لا من الجدول: المنظور يستثني المفوتَر أصلًا، فلا يحتاج العميل أن
   * يعرف أي خدمة صدرت بها فاتورة.
   */
  const visitServices = useQuery({
    queryKey: ["billing-visit-services", organizationId, appointmentVisitId],
    enabled: Boolean(organizationId && appointmentVisitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_visit_services_unbilled")
        .select("visit_service_id, item_id, item_name, qty, unit_price, is_vat_exempt")
        .eq("organization_id", organizationId)
        .eq("visit_id", appointmentVisitId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as {
        visit_service_id: string;
        item_id: string;
        item_name: string;
        qty: number;
        unit_price: number;
        is_vat_exempt: boolean;
      }[];
    },
  });

  /**
   * إضافة خدمة زيارة كسطر فاتورة.
   *
   * لا تمرّ بـ`addLine`: سعر الخدمة هو **سعر يوم التنفيذ** المخزَّن في
   * `patient_visit_services.unit_price`، وتمريره على `app_resolve_discount`
   * كان سيعيد تسعيره بسعر اليوم وخصومات اليوم — فيختلف ما يُحاسَب عليه
   * المريض عمّا نُفِّذ له.
   */
  const addVisitServiceLine = (service: {
    visit_service_id: string;
    item_id: string;
    item_name: string;
    qty: number;
    unit_price: number;
    is_vat_exempt: boolean;
  }) => {
    if (lines.some((line) => line.visit_service_id === service.visit_service_id)) return;
    setLines((prev) => [
      ...prev,
      {
        key: `vs-${service.visit_service_id}`,
        item_id: service.item_id,
        description: service.item_name,
        price: Number(service.unit_price) || 0,
        qty: Number(service.qty) || 1,
        discount_percent: 0,
        auto_discount_percent: 0,
        is_vat_exempt: Boolean(service.is_vat_exempt),
        agreement_item_id: null,
        agreement_label: null,
        visit_service_id: service.visit_service_id,
      },
    ]);
  };

  const addAllVisitServices = () => (visitServices.data ?? []).forEach(addVisitServiceLine);

  /**
   * طلبات الزيارة غير المفوترة (0057): مختبر وأشعة ووصفة.
   *
   * قبل هذا كان المحاسب لا يرى إلا خدمات الزيارة. أما التحليل الذي طلبه
   * الطبيب والصورة التي أُخذت فلا أثر لهما في الفاتورة — فإمّا يعيد إدخالهما
   * بالاسم والسعر تخمينًا، وإمّا يسقطان. إيراد نُفِّذ ولا يُحصَّل.
   */
  const visitOrders = useQuery({
    queryKey: ["billing-visit-orders", organizationId, appointmentVisitId],
    enabled: Boolean(organizationId && appointmentVisitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_visit_orders_unbilled")
        .select(
          "source_type, source_order_id, source_item_id, item_id, item_name, source_name, qty, unit_price, is_vat_exempt",
        )
        .eq("organization_id", organizationId)
        .eq("visit_id", appointmentVisitId);
      if (error) throw error;
      return (data ?? []) as VisitOrderRow[];
    },
  });

  const visitOrderGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; type: VisitOrderRow["source_type"]; orderId: string; rows: VisitOrderRow[] }
    >();
    for (const row of visitOrders.data ?? []) {
      const key = `${row.source_type}:${row.source_order_id}`;
      if (!groups.has(key)) {
        groups.set(key, { key, type: row.source_type, orderId: row.source_order_id, rows: [] });
      }
      groups.get(key)!.rows.push(row);
    }
    return Array.from(groups.values());
  }, [visitOrders.data]);

  /**
   * الإضافة تتم **بالطلب كاملًا** لا ببنده.
   *
   * لأن `lab_orders.sales_invoice_id` يُختم على مستوى الطلب لا البند: إضافة
   * بندٍ واحد كانت ستُعلّم الطلب كله مفوترًا، فيضيع باقي بنوده بلا فاتورة.
   * الحبيبة في الواجهة تساوي الحبيبة في القاعدة، وإلا كذبت إحداهما على
   * الأخرى.
   */
  const addVisitOrderLines = (group: {
    type: VisitOrderRow["source_type"];
    orderId: string;
    rows: VisitOrderRow[];
  }) => {
    const unlinked = group.rows.filter((row) => !row.item_id);
    const usable = group.rows.filter((row) => row.item_id);
    if (usable.length === 0) {
      toast({
        variant: "destructive",
        title: "لا يمكن فوترة هذا الطلب",
        description: "بنوده غير مربوطة بأصناف فوترة — اربطها من شاشة المختبر/الأشعة أولًا",
      });
      return;
    }
    setLines((prev) => [
      ...prev,
      ...usable
        .filter((row) => !prev.some((line) => line.key === `ord-${row.source_item_id}`))
        .map((row) => ({
          key: `ord-${row.source_item_id}`,
          item_id: row.item_id as string,
          description: row.item_name,
          price: Number(row.unit_price) || 0,
          qty: Number(row.qty) || 1,
          discount_percent: 0,
          auto_discount_percent: 0,
          is_vat_exempt: Boolean(row.is_vat_exempt),
          agreement_item_id: null,
          agreement_label: null,
          visit_service_id: null,
          order_source_type: group.type,
          order_id: group.orderId,
        })),
    ]);
    if (unlinked.length > 0) {
      toast({
        variant: "destructive",
        title: "بنود بلا صنف فوترة سقطت من الفاتورة",
        description: `${unlinked.map((row) => row.source_name).join("، ")} — وسيُعلَّم الطلب مفوترًا رغم ذلك. اربطها بصنف ثم أعد الإصدار إن أردت تحصيلها.`,
      });
    }
  };

  /** معرّفات الطلبات المرتبطة بسطور الفاتورة الحالية، بلا تكرار. */
  const attachedOrderIds = (type: VisitOrderRow["source_type"]) =>
    Array.from(
      new Set(
        lines
          .filter((line) => line.order_source_type === type && line.order_id)
          .map((line) => line.order_id as string),
      ),
    );

  useEffect(() => {
    if (!open || !appointment) return;
    const appointmentPatient = Array.isArray(appointment.patient) ? appointment.patient[0] : appointment.patient;
    if (appointmentPatient) {
      setPatient({ id: appointmentPatient.id, name_ar: appointmentPatient.name_ar });
      setIsInsurance(Boolean(appointmentPatient.insurance_company_name));
      setInsCompany(appointmentPatient.insurance_company_name ?? "");
      setInsPolicy(appointmentPatient.insurance_policy_number ?? "");
      setInsClass(appointmentPatient.insurance_policy_category ?? "");
      setInsMembership(appointmentPatient.insurance_membership_number ?? "");
    }
    setDoctorId(appointment.doctor_id || NONE);
    setClinicId(appointment.clinic_id || NONE);
  }, [appointment, open]);

  /**
   * إضافة بند اتفاقية كسطر فاتورة **حاملًا `agreement_item_id`**.
   *
   * لا يمرّ عبر `addLine`: سعر بند الاتفاقية وخصمه متفق عليهما مع المريض
   * ومكتوبان في الاتفاقية، فاحتساب خصم تلقائي جديد له عبر `app_resolve_discount`
   * كان سيغيّر المبلغ عمّا وُقّع عليه.
   */
  const addAgreementLine = (option: AgreementItemOption) => {
    const remainingQty = Math.max(option.qty - option.invoicedQty, 0);
    if (remainingQty <= 0) return;
    // منع تكرار نفس بند الاتفاقية في الفاتورة الواحدة
    if (lines.some((line) => line.agreement_item_id === option.agreementItemId)) return;
    setLines((prev) => [
      ...prev,
      {
        key: `agr-${option.agreementItemId}-${Date.now()}`,
        item_id: option.itemId,
        description: option.description,
        price: option.unitPrice,
        qty: remainingQty,
        discount_percent: option.discountPercent,
        auto_discount_percent: option.discountPercent,
        is_vat_exempt: false,
        agreement_item_id: option.agreementItemId,
        agreement_label: `اتفاقية #${option.agreementNumber}`,
        visit_service_id: null,
      },
    ]);
  };

  const addLine = async (item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean }) => {
    // منطق أولوية الخصومات (خصم المريض ← الخصم العام ← العروض ← خصم الصنف)
    // مبنيّ في قاعدة البيانات منذ 0004 لكنه لم يكن يُستدعى من أي مكان، فبقيت
    // كل الخصومات يدوية. هنا نستدعيه ليقترح النسبة، ويبقى للمستخدم تعديلها.
    let autoDiscount = 0;
    try {
      const { data, error } = await supabase.rpc("app_resolve_discount", {
        p_organization_id: organizationId,
        p_patient_id: patient?.id ?? null,
        p_item_id: item.id,
      });
      if (!error && data != null) autoDiscount = Number(data) || 0;
    } catch {
      // فشل احتساب الخصم التلقائي لا يمنع إضافة البند — يُضاف بخصم صفر
      // ويستطيع المستخدم إدخاله يدويًا.
      autoDiscount = 0;
    }

    // المفتاح يُولَّد قبل الإضافة ويُعاد للمستدعي، حتى يستطيع تعديل هذا
    // السطر بعينه بلا افتراض أنه الأخير.
    const key = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLines((prev) => [
      ...prev,
      {
        key,
        item_id: item.id,
        description: item.name_ar,
        price: Number(item.price),
        qty: 1,
        discount_percent: autoDiscount,
        auto_discount_percent: autoDiscount,
        is_vat_exempt: item.is_vat_exempt,
        agreement_item_id: null,
        agreement_label: null,
        visit_service_id: null,
      },
    ]);
    return key;
  };

  /**
   * إضافة مجموعة تمرّ ببنودها عبر `addLine` نفسه لا بإدراج مباشر، حتى يُحتسب
   * الخصم التلقائي لكل صنف كما لو أُضيف يدويًا — الإدراج المباشر كان سيتخطّى
   * `app_resolve_discount` فتخرج فاتورة المجموعة بأسعار مختلفة عن نفس
   * الأصناف مضافةً واحدًا واحدًا.
   */
  const addGroup = async (group: QuickGroupRow) => {
    for (const line of group.quick_invoice_group_items ?? []) {
      const item = Array.isArray(line.item) ? line.item[0] : line.item;
      if (!item) continue;
      // `addLine` يُعيد مفتاح السطر الذي أنشأه، والكمية تُطبَّق على **هذا
      // المفتاح** لا على "آخر سطر": ضغط مجموعتين بينما استدعاء الخصم لأولاهما
      // ما زال جاريًا كان يكتب كمية المجموعة الأولى على سطر المجموعة الثانية.
      const key = await addLine(item);
      const qty = Number(line.qty) || 1;
      if (qty !== 1) {
        setLines((prev) => prev.map((draft) => (draft.key === key ? { ...draft, qty } : draft)));
      }
    }
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let vat = 0;
    const computed = lines.map((line) => {
      const lineSubtotal = line.price * line.qty;
      const lineDiscount = (lineSubtotal * line.discount_percent) / 100;
      const taxable = lineSubtotal - lineDiscount;
      const lineVat = line.is_vat_exempt ? 0 : (taxable * vatRate) / 100;
      subtotal += lineSubtotal;
      discount += lineDiscount;
      vat += lineVat;
      return { ...line, lineSubtotal, lineDiscount, lineVat, net: taxable + lineVat };
    });
    return { computed, subtotal, discount, vat, net: subtotal - discount + vat };
  }, [lines, vatRate]);

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!patient && !externalName.trim()) throw new Error("اختر مريضًا أو أدخل اسم عميل خارجي");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");
      // حظر الفوترة في ملف المريض كان معروضًا بلا فرض — يُفرض هنا قبل إنشاء الرأس
      await assertPatientNotBlocked(patient?.id, "invoices");

      /**
       * الإنشاء عبر RPC واحد لا إدراجين.
       *
       * كان المسار: أدرج الرأس، ثم أدرج البنود، وإن فشلت البنود احذف الرأس.
       * هذا **ليس ذرّيًا**: انقطاع الشبكة بين النداءين يترك رأس فاتورة بلا
       * بنود — برقم مستهلَك من التسلسل ويظهر بصفر في كشف المبيعات — وقد يفشل
       * الحذف التعويضي هو الآخر فلا يبقى ما يصحّح الحالة.
       *
       * والأهم أن كل الحسابات كانت تجري هنا في المتصفح ثم تُرسَل جاهزة، فيكفي
       * تعديل الطلب قبل إرساله ليقبل النظام أي إجمالي. الدالة (0052) تُعيد
       * حساب السعر والخصم والضريبة وحصتي التأمين **في القاعدة** من أسعار
       * الأصناف ونسبة الضريبة المخزَّنة، وتتجاهل ما يرسله العميل من إجماليات.
       *
       * `totals` يبقى مستعملًا لعرض الإجمالي على الشاشة قبل الحفظ فقط.
       */
      const { data: newInvoiceId, error: rpcError } = await supabase.rpc("app_create_sales_invoice", {
        p_organization_id: organizationId,
        p_items: totals.computed.map((line) => ({
          item_id: line.item_id,
          description: line.description,
          qty: line.qty,
          price: line.price,
          discount_percent: line.discount_percent,
          is_vat_exempt: line.is_vat_exempt,
          agreement_item_id: line.agreement_item_id,
          visit_service_id: line.visit_service_id,
        })),
        p_patient_id: patient?.id ?? null,
        p_external_customer_name: patient ? null : externalName.trim(),
        p_appointment_id: appointment?.id ?? null,
        p_visit_id: appointmentVisitId ?? null,
        p_doctor_id: doctorId === NONE ? null : doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_warehouse_id: warehouseId === NONE ? null : warehouseId,
        p_invoice_type: "sale",
        p_is_insurance: isInsurance,
        p_insurance: isInsurance
          ? {
              company_name: insCompany.trim() || null,
              policy_number: insPolicy.trim() || null,
              class_number: insClass.trim() || null,
              membership_number: insMembership.trim() || null,
              copay_percent: insCopayPercent || null,
              max_amount: insMaxAmount || null,
              approval_number: insApprovalNumber.trim() || null,
            }
          : {},
        p_is_temporary: Boolean(isQuote),
        p_is_b2b: isB2b,
        p_id_number: idNumber.trim() || null,
        p_note: note.trim() || null,
        // الختم يجري داخل نفس معاملة الفاتورة (0057): إمّا فاتورة وطلبات
        // مختومة معًا، أو لا شيء.
        p_lab_order_ids: attachedOrderIds("lab").length > 0 ? attachedOrderIds("lab") : null,
        p_radiology_order_ids:
          attachedOrderIds("radiology").length > 0 ? attachedOrderIds("radiology") : null,
        p_prescription_ids:
          attachedOrderIds("prescription").length > 0 ? attachedOrderIds("prescription") : null,
      });
      if (rpcError) throw rpcError;
      if (!newInvoiceId) throw new Error("لم تُنشأ الفاتورة — أعد المحاولة");
      return newInvoiceId as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      // المفوتَر من الاتفاقية تغيّر بفعل المُحفِّز — بلا هذا التبطيل يبقى
      // البند معروضًا "غير مفوتر" فيُفوتر مرة ثانية.
      queryClient.invalidateQueries({ queryKey: ["billing-agreement-items"] });
      // الخدمات التي فُوترت للتوّ لم تعد ضمن غير المفوتر — بلا هذا التبطيل
      // تبقى معروضة كأنها متاحة، فيحاول المستخدم فوترتها ثانيةً وترفضه القاعدة.
      queryClient.invalidateQueries({ queryKey: ["billing-visit-services"] });
      queryClient.invalidateQueries({ queryKey: ["billing-visit-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      queryClient.invalidateQueries({ queryKey: ["radiology-orders"] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      toast({ title: isQuote ? "تم إنشاء عرض السعر" : "تم إنشاء الفاتورة" });
      setPatient(null);
      setExternalName("");
      setLines([]);
      setDoctorId(NONE);
      setClinicId(NONE);
      setWarehouseId(NONE);
      setIdNumber("");
      setNote("");
      setIsInsurance(false);
      setIsB2b(false);
      setInsCompany("");
      setInsPolicy("");
      setInsClass("");
      setInsMembership("");
      setInsCopayPercent("");
      setInsMaxAmount("");
      setInsApprovalNumber("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الفاتورة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isQuote ? "عرض سعر جديد" : "فاتورة مبيعات جديدة"}</DialogTitle>
          <DialogDescription>
            {isQuote
              ? "عرض السعر لا يُعد فاتورة فعلية ولا يؤثر على المخزون أو السندات حتى يتم تحويله."
              : `الضريبة محسوبة تلقائيًا بنسبة ${vatRate}% (إعداد المؤسسة الافتراضي)`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>
          {!patient && (
            <div className="flex flex-col gap-1.5">
              <Label>أو اسم عميل خارجي (بلا ملف)</Label>
              <Input value={externalName} onChange={(e) => setExternalName(e.target.value)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب المعالج</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(clinics.data ?? []).map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم الهوية</Label>
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={isInsurance}
                onChange={(e) => setIsInsurance(e.target.checked)}
                className="h-4 w-4"
              />
              فاتورة تأمين
            </label>
            {isInsurance && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>شركة التأمين</Label>
                  <Input value={insCompany} onChange={(e) => setInsCompany(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم البوليصة</Label>
                  <Input value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم الفئة</Label>
                  <Input value={insClass} onChange={(e) => setInsClass(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم العضوية</Label>
                  <Input value={insMembership} onChange={(e) => setInsMembership(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>نسبة التحمل %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={insCopayPercent}
                    onChange={(e) => setInsCopayPercent(e.target.value)}
                  />
                </div>
                {/* `disable_patient_max_copay_field` كان يُحفَظ ولا يُنفَّذ */}
                {!insuranceSettings.data?.disable_patient_max_copay_field && (
                  <div className="flex flex-col gap-1.5">
                    <Label>أعلى مبلغ مغطّى</Label>
                    <Input
                      type="number"
                      min={0}
                      value={insMaxAmount}
                      onChange={(e) => setInsMaxAmount(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>رقم الموافقة</Label>
                  <Input
                    value={insApprovalNumber}
                    onChange={(e) => setInsApprovalNumber(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {(quickGroups.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>مجموعات سريعة</Label>
              <div className="flex flex-wrap gap-2">
                {(quickGroups.data ?? []).map((group) => (
                  <Button
                    key={group.id}
                    size="sm"
                    variant="outline"
                    onClick={() => addGroup(group)}
                    style={group.color ? { borderColor: group.color, color: group.color } : undefined}
                  >
                    {group.name_ar}
                    <span className="text-[10px] text-muted-foreground">
                      ({(group.quick_invoice_group_items ?? []).length})
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={isB2b}
              onChange={(e) => setIsB2b(e.target.checked)}
            />
            <span className="flex flex-col gap-0.5">
              <span>فاتورة أعمال (B2B)</span>
              <span className="text-xs text-muted-foreground">
                فاتورة ضريبية لمنشأة لا لمستهلك — تتطلب الرقم الضريبي للمشتري. اتركها فارغة
                للفاتورة الضريبية المبسّطة (B2C).
              </span>
              {isB2b && !idNumber.trim() && (
                <span className="text-xs text-amber-600">
                  أدخل الرقم الضريبي/الهوية للمشتري في خانة «رقم الهوية» — بدونه تُرفض الفاتورة
                </span>
              )}
            </span>
          </label>

          {(visitServices.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>الخدمات المنفَّذة في الزيارة</Label>
                <Button size="sm" variant="outline" onClick={addAllVisitServices}>
                  <Plus className="h-3.5 w-3.5" />
                  إضافة الكل
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                ما سجّله الطبيب في هذه الزيارة ولم يُفوتَر بعد. السعر هو سعر يوم التنفيذ.
              </p>
              <div className="flex flex-wrap gap-2">
                {(visitServices.data ?? []).map((service) => {
                  const added = lines.some((l) => l.visit_service_id === service.visit_service_id);
                  return (
                    <Button
                      key={service.visit_service_id}
                      size="sm"
                      variant="outline"
                      disabled={added}
                      onClick={() => addVisitServiceLine(service)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">{service.item_name}</span>
                      <Badge variant="secondary">
                        {service.qty} × {Number(service.unit_price).toLocaleString("ar-SA")}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {visitOrderGroups.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-sky-300 bg-sky-50/60 p-3">
              <Label>طلبات الزيارة غير المفوترة</Label>
              <p className="text-xs text-muted-foreground">
                ما طلبه الطبيب في هذه الزيارة: تحاليل وأشعة وأدوية. تُضاف بالطلب كاملًا،
                ويُعلَّم الطلب مفوترًا عند الحفظ.
              </p>
              <div className="flex flex-wrap gap-2">
                {visitOrderGroups.map((group) => {
                  const addedCount = group.rows.filter((row) =>
                    lines.some((line) => line.key === `ord-${row.source_item_id}`),
                  ).length;
                  const billable = group.rows.filter((row) => row.item_id).length;
                  const total = group.rows.reduce(
                    (sum, row) => sum + Number(row.qty) * Number(row.unit_price),
                    0,
                  );
                  return (
                    <Button
                      key={group.key}
                      size="sm"
                      variant="outline"
                      disabled={addedCount > 0 && addedCount === billable}
                      onClick={() => addVisitOrderLines(group)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">
                        {ORDER_TYPE_LABELS[group.type]}: {group.rows.map((row) => row.source_name).join("، ")}
                      </span>
                      <Badge variant="secondary">{total.toLocaleString("ar-SA")}</Badge>
                      {billable < group.rows.length && (
                        <Badge variant="destructive">{group.rows.length - billable} بلا صنف</Badge>
                      )}
                    </Button>
                  );
                })}
              </div>
              {visitOrderGroups.some((group) => {
                const added = group.rows.filter((row) =>
                  lines.some((line) => line.key === `ord-${row.source_item_id}`),
                ).length;
                const billable = group.rows.filter((row) => row.item_id).length;
                return added > 0 && added < billable;
              }) && (
                <p className="text-xs text-amber-700">
                  حذفتَ بندًا من طلب مُضاف — سيُعلَّم الطلب مفوترًا كاملًا عند الحفظ، فلن يظهر
                  البند المحذوف في فاتورة لاحقة.
                </p>
              )}
            </div>
          )}

          {patient && (agreementItems.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Label>بنود الاتفاقيات العلاجية لهذا المريض</Label>
              <p className="text-xs text-muted-foreground">
                إضافة البند من هنا تربطه بالاتفاقية، فيُحدَّث "المفوتَر" و"المتبقّي" فيها تلقائيًا.
                إضافته من "إضافة بند" العادية لا تربطه بشيء.
              </p>
              <div className="flex flex-wrap gap-2">
                {(agreementItems.data ?? []).map((option) => {
                  const remainingQty = Math.max(option.qty - option.invoicedQty, 0);
                  const alreadyAdded = lines.some(
                    (line) => line.agreement_item_id === option.agreementItemId,
                  );
                  return (
                    <Button
                      key={option.agreementItemId}
                      size="sm"
                      variant="outline"
                      disabled={remainingQty <= 0 || alreadyAdded}
                      onClick={() => addAgreementLine(option)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">{option.description}</span>
                      <Badge variant={remainingQty <= 0 ? "secondary" : "default"}>
                        {remainingQty <= 0
                          ? "مفوتَر بالكامل"
                          : `متبقٍ ${remainingQty} من ${option.qty}`}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        اتفاقية #{option.agreementNumber}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>إضافة بند</Label>
            <ItemPicker onSelect={addLine} />
            <p className="text-xs text-muted-foreground">
              يُقترح الخصم تلقائيًا حسب أولوية النظام (خصم المريض ← الخصم العام ← العروض ← خصم الصنف) ويمكن تعديله يدويًا.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-2">
            {totals.computed.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">لم تُضف بنود بعد.</p>
            )}
            {totals.computed.map((line) => (
              <div key={line.key} className="grid grid-cols-12 items-center gap-2 text-sm">
                <span className="col-span-4 flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{line.description}</span>
                  {line.agreement_label && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {line.agreement_label}
                    </Badge>
                  )}
                  {line.visit_service_id && (
                    <Badge className="shrink-0 bg-emerald-100 text-[10px] text-emerald-800">
                      من الزيارة
                    </Badge>
                  )}
                </span>
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  value={line.price}
                  onChange={(e) => updateLine(line.key, { price: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={0}
                  max={100}
                  value={line.discount_percent}
                  onChange={(e) => updateLine(line.key, { discount_percent: Number(e.target.value) })}
                  title={
                    line.auto_discount_percent > 0
                      ? `نسبة الخصم % — اقترح النظام ${line.auto_discount_percent}%`
                      : "نسبة الخصم %"
                  }
                />
                <span className="col-span-1 text-left text-xs font-semibold">{line.net.toFixed(2)}</span>
                <Button variant="ghost" size="sm" className="col-span-1" onClick={() => removeLine(line.key)}>
                  حذف
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات الفاتورة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex flex-col items-end gap-1 text-sm">
            <span>الإجمالي الفرعي: {totals.subtotal.toFixed(2)}</span>
            <span>الخصم: {totals.discount.toFixed(2)}</span>
            <span>الضريبة: {totals.vat.toFixed(2)}</span>
            <span className="text-base font-bold">الصافي: {totals.net.toFixed(2)} ر.س</span>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={createInvoice.isPending || lines.length === 0} onClick={() => createInvoice.mutate()}>
            <Receipt className="h-4 w-4" />
            {createInvoice.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  const [amount, setAmount] = useState("");

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !invoice) throw new Error("بيانات غير مكتملة");
      const paymentAmount = Number(amount);
      if (!paymentAmount || paymentAmount <= 0) throw new Error("أدخل مبلغًا صحيحًا");

      const { data: voucher, error: voucherError } = await supabase
        .from("financial_vouchers")
        .insert({
          organization_id: organizationId,
          voucher_type: "receipt",
          amount: paymentAmount,
          patient_id: invoice.patient?.id ?? null,
          related_sales_invoice_id: invoice.id,
          description: `دفعة على الفاتورة #${invoice.invoice_number}`,
        })
        .select("id")
        .single();
      if (voucherError) throw voucherError;

      const { error: allocationError } = await supabase.from("voucher_invoice_allocations").insert({
        voucher_id: voucher.id,
        sales_invoice_id: invoice.id,
        amount: paymentAmount,
      });
      if (allocationError) throw allocationError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "تم تسجيل الدفعة" });
      setAmount("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل الدفعة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل دفعة</DialogTitle>
          <DialogDescription>
            فاتورة #{invoice?.invoice_number} — المتبقي {Number(invoice?.remaining_amount ?? 0).toLocaleString("ar-SA")} ر.س
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>المبلغ المستلم</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={recordPayment.isPending || !amount} onClick={() => recordPayment.mutate()}>
            {recordPayment.isPending ? "جارٍ الحفظ..." : "تسجيل الدفعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
