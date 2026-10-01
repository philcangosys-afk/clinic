import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * الإعدادات الضريبية للمنشأة — المرحلة ١٢.
 *
 * كانت الفاتورة تقرأ اسم المنشأة ورقمها الضريبي من `organizations` وقت
 * **الطباعة**، ولا وجود لاسم قانونيّ ولا سجل تجاريّ ولا عنوان وطنيّ — وكلّها
 * إلزامية في الفاتورة الضريبية. وبعد 0092 تُلتقط هذه البيانات في
 * `seller_snapshot` لحظة الإصدار، فتعديلها لاحقًا لا يمسّ ما صدر.
 *
 * ولذلك ترتيب العمل: **أكمل هذه الشاشة قبل إصدار أوّل فاتورة ضريبية** — فما
 * صدر بلقطة ناقصة يبقى ناقصًا.
 */
type VatSettings = {
  organization_id: string;
  legal_name_ar: string | null;
  legal_name_en: string | null;
  cr_number: string | null;
  vat_registration_number: string | null;
  vat_registration_date: string | null;
  vat_status: string;
  default_vat_rate: number;
  building_number: string | null;
  street_name: string | null;
  district: string | null;
  city: string | null;
  postal_code: string | null;
  additional_number: string | null;
  country_code: string;
  default_document_type: string;
  numbering_scope: string;
  invoice_number_prefix: string | null;
  sales_vat_enabled: boolean;
};

const VAT_STATUS_LABELS: Record<string, string> = {
  not_registered: "غير مسجَّلة",
  registered: "مسجَّلة في ضريبة القيمة المضافة",
  exempt: "معفاة",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  simplified: "فاتورة ضريبية مبسّطة (للأفراد)",
  standard: "فاتورة ضريبية (للمنشآت)",
};

export default function TaxSettingsTab() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const canEdit = can("billing.issue");

  const settings = useQuery({
    queryKey: ["vat-settings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_vat_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as VatSettings | null;
    },
  });

  if (settings.data && !loaded) {
    setLoaded(true);
    const s = settings.data;
    setForm({
      legal_name_ar: s.legal_name_ar ?? "",
      legal_name_en: s.legal_name_en ?? "",
      cr_number: s.cr_number ?? "",
      vat_registration_number: s.vat_registration_number ?? "",
      vat_registration_date: s.vat_registration_date ?? "",
      vat_status: s.vat_status ?? "not_registered",
      default_vat_rate: String(s.default_vat_rate ?? 15),
      building_number: s.building_number ?? "",
      street_name: s.street_name ?? "",
      district: s.district ?? "",
      city: s.city ?? "",
      postal_code: s.postal_code ?? "",
      additional_number: s.additional_number ?? "",
      country_code: s.country_code ?? "SA",
      default_document_type: s.default_document_type ?? "simplified",
      numbering_scope: s.numbering_scope ?? "organization",
      invoice_number_prefix: s.invoice_number_prefix ?? "",
    });
  }

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا منشأة نشطة");
      const payload = {
        organization_id: organizationId,
        legal_name_ar: form.legal_name_ar?.trim() || null,
        legal_name_en: form.legal_name_en?.trim() || null,
        cr_number: form.cr_number?.trim() || null,
        vat_registration_number: form.vat_registration_number?.trim() || null,
        vat_registration_date: form.vat_registration_date || null,
        vat_status: form.vat_status,
        default_vat_rate: Number(form.default_vat_rate) || 15,
        building_number: form.building_number?.trim() || null,
        street_name: form.street_name?.trim() || null,
        district: form.district?.trim() || null,
        city: form.city?.trim() || null,
        postal_code: form.postal_code?.trim() || null,
        additional_number: form.additional_number?.trim() || null,
        country_code: form.country_code?.trim() || "SA",
        default_document_type: form.default_document_type,
        numbering_scope: form.numbering_scope,
        invoice_number_prefix: form.invoice_number_prefix?.trim() || null,
      };
      const { data, error } = await supabase
        .from("organization_vat_settings")
        .upsert(payload, { onConflict: "organization_id" })
        .select("organization_id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vat-settings", organizationId] });
      toast({ title: "حُفظت الإعدادات الضريبية" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  const registered = form.vat_status === "registered";
  const missing: string[] = [];
  if (registered) {
    if (!form.legal_name_ar?.trim()) missing.push("الاسم القانوني بالعربية");
    if (!form.vat_registration_number?.trim()) missing.push("الرقم الضريبي");
    if (!form.city?.trim()) missing.push("المدينة");
    if (!form.street_name?.trim()) missing.push("الشارع");
    if (!form.building_number?.trim()) missing.push("رقم المبنى");
    if (!form.postal_code?.trim()) missing.push("الرمز البريدي");
  }

  if (settings.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>الإعدادات الضريبية والفوترة الإلكترونية</CardTitle>
        <CardDescription>
          هذه البيانات تُلتقط في الفاتورة **لحظة إصدارها** — أكملها قبل إصدار أوّل فاتورة
          ضريبية، فما صدر بلقطة ناقصة يبقى ناقصًا.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {missing.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            المنشأة مسجَّلة في الضريبة وينقصها: {missing.join("، ")}. الفاتورة الضريبية لن تكتمل
            بياناتها النظامية بدونها.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>حالة التسجيل الضريبي</Label>
            <Select
              value={form.vat_status ?? "not_registered"}
              onValueChange={(v) => set("vat_status", v)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VAT_STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نسبة الضريبة الافتراضية ٪</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.default_vat_rate ?? "15"}
              onChange={(e) => set("default_vat_rate", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم القانوني بالعربية {registered && "*"}</Label>
            <Input
              value={form.legal_name_ar ?? ""}
              onChange={(e) => set("legal_name_ar", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم القانوني بالإنجليزية</Label>
            <Input
              value={form.legal_name_en ?? ""}
              onChange={(e) => set("legal_name_en", e.target.value)}
              dir="ltr"
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرقم الضريبي {registered && "*"}</Label>
            <Input
              value={form.vat_registration_number ?? ""}
              onChange={(e) => set("vat_registration_number", e.target.value)}
              dir="ltr"
              placeholder="15 رقمًا"
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السجل التجاري</Label>
            <Input
              value={form.cr_number ?? ""}
              onChange={(e) => set("cr_number", e.target.value)}
              dir="ltr"
              disabled={!canEdit}
            />
          </div>
        </div>

        <Separator />
        <h4 className="text-sm font-medium">العنوان الوطني</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>رقم المبنى {registered && "*"}</Label>
            <Input value={form.building_number ?? ""} onChange={(e) => set("building_number", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الشارع {registered && "*"}</Label>
            <Input value={form.street_name ?? ""} onChange={(e) => set("street_name", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الحي</Label>
            <Input value={form.district ?? ""} onChange={(e) => set("district", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المدينة {registered && "*"}</Label>
            <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرمز البريدي {registered && "*"}</Label>
            <Input value={form.postal_code ?? ""} onChange={(e) => set("postal_code", e.target.value)} dir="ltr" disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرقم الإضافي</Label>
            <Input value={form.additional_number ?? ""} onChange={(e) => set("additional_number", e.target.value)} dir="ltr" disabled={!canEdit} />
          </div>
        </div>

        <Separator />
        <h4 className="text-sm font-medium">الترقيم ونوع المستند</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع الفاتورة الافتراضي</Label>
            <Select
              value={form.default_document_type ?? "simplified"}
              onValueChange={(v) => set("default_document_type", v)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نطاق التسلسل</Label>
            <Select
              value={form.numbering_scope ?? "organization"}
              onValueChange={(v) => set("numbering_scope", v)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">تسلسل واحد للمنشأة</SelectItem>
                <SelectItem value="branch">تسلسل مستقلّ لكل فرع</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بادئة رقم الفاتورة</Label>
            <Input
              value={form.invoice_number_prefix ?? ""}
              onChange={(e) => set("invoice_number_prefix", e.target.value)}
              placeholder="INV"
              dir="ltr"
              disabled={!canEdit}
            />
          </div>
        </div>

        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          تغيير نطاق التسلسل بعد إصدار فواتير يبدأ سلسلةً جديدة ولا يُعيد ترقيم ما صدر — وهذا
          مقصود: المستند الصادر لا يتغيّر رقمه أبدًا.
        </p>

        {canEdit && (
          <div className="flex justify-end">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * حالة الفواتير الإلكترونية.
 *
 * **لا إرسال هنا.** الزرّ يولّد المستند ورمزه محليًّا ويترك حالته `generated`.
 * الإرسال إلى نفيس/فاتورة يحتاج شهادات إنتاج معتمدة، وهي قرار لاحق — ولذلك
 * البيئة الافتراضية `sandbox` ولا يوجد نداء خارجيّ في هذه الشاشة.
 */
const EINVOICE_STATUS_LABELS: Record<string, string> = {
  not_required: "غير مطلوب",
  pending: "بانتظار التوليد",
  generated: "مُولَّد محليًّا",
  submitted: "مُرسَل",
  accepted: "مقبول",
  warning: "مقبول بملاحظات",
  rejected: "مرفوض",
  failed: "فشل الإرسال",
};

const EINVOICE_STATUS_TONE: Record<string, "default" | "secondary" | "success" | "destructive" | "warning"> = {
  not_required: "secondary",
  pending: "secondary",
  generated: "default",
  submitted: "default",
  accepted: "success",
  warning: "warning",
  rejected: "destructive",
  failed: "destructive",
};

export function EInvoicePanel() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [filter, setFilter] = useState("all");

  const docs = useQuery({
    queryKey: ["einvoice-status", organizationId, filter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let q = supabase
        .from("v_einvoice_status")
        .select("*")
        .eq("organization_id", organizationId)
        .order("issued_at", { ascending: false })
        .limit(100);
      if (filter === "attention") q = q.eq("needs_attention", true);
      else if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const pending = useQuery({
    queryKey: ["invoices-without-einvoice", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_invoice_register")
        .select("id, document_number:invoice_number, patient_name, net_amount, issued_at")
        .eq("organization_id", organizationId)
        .not("issued_at", "is", null)
        .neq("status", "void")
        .order("issued_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const generate = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc("app_generate_einvoice", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["einvoice-status", organizationId] });
      toast({
        title: "تُوِّلد المستند ورمزه",
        description: "في بيئة الاختبار — لم يُرسل إلى الهيئة",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التوليد",
        description: errorMessage(error),
      }),
  });

  /**
   * تسجيل ردّ الهيئة يدويًّا.
   *
   * ما دام الربط الآليّ غير مُفعَّل، يقدّم المحاسب المستند من بوّابة الهيئة
   * ويسجّل نتيجته هنا — فتبقى حالة كل مستند معروفة في النظام بدل أن تعيش في
   * ذاكرة الموظف. و`app_set_einvoice_status` تمنع تغيير المقبول، فلا يفترق
   * سجلّنا عن سجلّ الهيئة.
   */
  const recordResponse = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note: string }) => {
      const { error } = await supabase.rpc("app_set_einvoice_status", {
        p_document_id: id,
        p_status: status,
        p_response: note ? { manual_note: note } : null,
        p_errors: status === "rejected" && note ? { reason: note } : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["einvoice-status", organizationId] });
      toast({ title: "سُجّل ردّ الهيئة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: errorMessage(error),
      }),
  });

  const generated = new Set((docs.data ?? []).map((d) => d.sales_invoice_id));
  const ungenerated = (pending.data ?? []).filter((i) => !generated.has(i.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>الفواتير الإلكترونية</CardTitle>
        <CardDescription>
          التوليد محليّ في بيئة الاختبار — **لا إرسال إلى الهيئة ولا شهادات إنتاج** حتى
          اعتماد إعدادات الربط.
        </CardDescription>
        <div className="mt-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="attention">تحتاج معالجة</SelectItem>
              <SelectItem value="generated">مُولَّدة</SelectItem>
              <SelectItem value="accepted">مقبولة</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ungenerated.length > 0 && can("billing.issue") && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm">
              {ungenerated.length} فاتورة صادرة بلا مستند إلكتروني.
            </p>
            <div className="flex flex-col gap-1">
              {ungenerated.slice(0, 5).map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm">
                  <span>
                    #{i.document_number} — {i.patient_name} —{" "}
                    {Number(i.net_amount).toLocaleString("ar-SA")} ر.س
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate(i.id)}
                  >
                    توليد المستند
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {docs.isLoading && <Skeleton className="h-40 w-full" />}
        {!docs.isLoading &&
          (docs.data ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  #{d.document_number} — {d.patient_name ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Number(d.net_amount).toLocaleString("ar-SA")} ر.س · ضريبة{" "}
                  {Number(d.vat_amount).toLocaleString("ar-SA")} · بيئة {d.environment}
                  {d.attempt_count > 0 ? ` · ${d.attempt_count} محاولة` : ""}
                </p>
                {d.validation_errors && (
                  <p className="text-xs text-destructive">
                    {JSON.stringify(d.validation_errors)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {d.has_qr && <Badge variant="secondary">QR</Badge>}
                <Badge variant={EINVOICE_STATUS_TONE[d.status] ?? "secondary"}>
                  {EINVOICE_STATUS_LABELS[d.status] ?? d.status}
                </Badge>
                {can("billing.issue") && d.status !== "accepted" && (
                  <Select
                    value=""
                    onValueChange={(v) => {
                      const note =
                        v === "rejected" || v === "warning"
                          ? window.prompt("ملاحظة الهيئة أو سبب الرفض؟") ?? ""
                          : "";
                      if (v === "rejected" && !note.trim()) return;
                      recordResponse.mutate({ id: d.id, status: v, note: note.trim() });
                    }}
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue placeholder="تسجيل ردّ الهيئة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="submitted">أُرسل يدويًّا</SelectItem>
                      <SelectItem value="accepted">قُبل</SelectItem>
                      <SelectItem value="warning">قُبل بملاحظات</SelectItem>
                      <SelectItem value="rejected">رُفض</SelectItem>
                      <SelectItem value="failed">فشل الإرسال</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        {!docs.isLoading && (docs.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            لا مستندات إلكترونية بعد.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * إقرار الضريبة الشهري.
 *
 * `v_vat_summary` (0092) يفصل الوعاء والضريبة **حسب فئة الضريبة ونوع
 * المستند** — لا رقمًا واحدًا مجملًا. والفصل هو ما يجعل الإقرار قابلًا
 * للتقديم: الهيئة تسأل عن المبيعات الخاضعة والمعفاة والصفرية كلٍّ على حدة.
 */
export function VatReturnPanel() {
  const { organization } = useOrganizationAccess();
  const [months, setMonths] = useState("3");

  const rows = useQuery({
    queryKey: ["vat-summary", organization?.id, months],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const from = new Date();
      from.setMonth(from.getMonth() - Number(months));
      const { data, error } = await supabase
        .from("v_vat_summary")
        .select("*")
        .eq("organization_id", organization?.id)
        .gte("period_month", from.toISOString().slice(0, 10))
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const CATEGORY_LABELS: Record<string, string> = {
    standard: "خاضع للنسبة الأساسية",
    zero_rated: "خاضع لنسبة الصفر",
    exempt: "معفى",
    out_of_scope: "خارج النطاق",
  };

  const totals = (rows.data ?? []).reduce(
    (acc, r) => {
      acc.taxable += Number(r.taxable_amount ?? 0);
      acc.vat += Number(r.vat_amount ?? 0);
      return acc;
    },
    { taxable: 0, vat: 0 },
  );

  const exportCsv = () => {
    const header = ["الشهر", "نوع المستند", "فئة الضريبة", "عدد الفواتير", "الوعاء", "الضريبة"];
    const lines = (rows.data ?? []).map((r) =>
      [
        r.period_month,
        r.document_type,
        CATEGORY_LABELS[r.vat_category] ?? r.vat_category,
        r.invoice_count,
        Number(r.taxable_amount ?? 0).toFixed(2),
        Number(r.vat_amount ?? 0).toFixed(2),
      ].join(","),
    );
    const blob = new Blob(["\ufeff" + [header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat-return-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>إقرار ضريبة القيمة المضافة</CardTitle>
        <CardDescription>
          الوعاء {totals.taxable.toLocaleString("ar-SA")} · الضريبة{" "}
          {totals.vat.toLocaleString("ar-SA")} ر.س
        </CardDescription>
        <div className="mt-2 flex items-center gap-2">
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">آخر شهر</SelectItem>
              <SelectItem value="3">آخر ٣ أشهر</SelectItem>
              <SelectItem value="12">آخر سنة</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            تصدير CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.isLoading && <Skeleton className="h-32 w-full" />}
        {!rows.isLoading && (
          <div className="flex flex-col gap-1">
            {(rows.data ?? []).map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {new Date(`${r.period_month}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory", { month: "long", year: "numeric" })} ·{" "}
                  {CATEGORY_LABELS[r.vat_category] ?? r.vat_category}
                  <span className="block text-xs text-muted-foreground">
                    {r.invoice_count} فاتورة · {r.document_type === "simplified" ? "مبسّطة" : r.document_type === "standard" ? "ضريبية (أعمال)" : r.document_type}
                    {r.vat_category === "standard" && Number(r.vat_amount ?? 0) === 0 && Number(r.taxable_amount ?? 0) > 0
                      ? " · ضريبة صفر: مرضى سعوديون تتحمّل الدولة ضريبتهم"
                      : ""}
                  </span>
                </span>
                <span className="tabular-nums">
                  {Number(r.taxable_amount ?? 0).toLocaleString("ar-SA")} +{" "}
                  <span className="font-semibold">
                    {Number(r.vat_amount ?? 0).toLocaleString("ar-SA")}
                  </span>
                </span>
              </div>
            ))}
            {(rows.data ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                لا فواتير صادرة في هذه المدّة.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * معاينة الفاتورة الضريبية قبل الإصدار وبعده.
 *
 * `v_tax_invoice_lines` (0092) يعرض كل بند بوعائه ونسبته وضريبته وسبب
 * إعفائه — وهو **الشكل النظاميّ** للفاتورة الضريبية. الشاشة القديمة كانت
 * تعرض الإجمالي والضريبة الكليّة فقط، وذلك لا يكفي مراجعةً ولا طباعةً.
 */
export function TaxInvoicePreview({ invoiceId }: { invoiceId: string | null }) {
  const lines = useQuery({
    queryKey: ["tax-invoice-lines", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_tax_invoice_lines")
        .select("*")
        .eq("invoice_id", invoiceId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const CATEGORY_LABELS: Record<string, string> = {
    standard: "خاضع",
    zero_rated: "صفري",
    exempt: "معفى",
    out_of_scope: "خارج النطاق",
  };

  if (!invoiceId) return null;
  if (lines.isLoading) return <Skeleton className="h-32 w-full" />;

  const rows = lines.data ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.base += Number(r.taxable_base ?? 0);
      acc.vat += Number(r.vat_amount ?? 0);
      return acc;
    },
    { base: 0, vat: 0 },
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {rows[0]?.document_type === "credit_note"
            ? "إشعار دائن"
            : rows[0]?.document_type === "standard"
              ? "فاتورة ضريبية"
              : "فاتورة ضريبية مبسّطة"}{" "}
          #{rows[0]?.document_number ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          الرقم الضريبي للبائع: {rows[0]?.seller_vat_number ?? "—"}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between border-t pt-1 text-sm">
          <span>
            {r.item_name_snapshot} × {r.qty}
            <span className="block text-xs text-muted-foreground">
              {CATEGORY_LABELS[r.vat_category] ?? r.vat_category}
              {r.vat_category !== "standard" && r.exemption_reason
                ? ` — ${r.exemption_reason}`
                : ` ${r.vat_rate}٪`}
            </span>
          </span>
          <span className="tabular-nums">
            {Number(r.taxable_base).toLocaleString("ar-SA")} +{" "}
            {Number(r.vat_amount).toLocaleString("ar-SA")}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>الإجمالي قبل الضريبة / الضريبة / بعدها</span>
        <span className="tabular-nums">
          {totals.base.toLocaleString("ar-SA")} · {totals.vat.toLocaleString("ar-SA")} ·{" "}
          {(totals.base + totals.vat).toLocaleString("ar-SA")}
        </span>
      </div>
    </div>
  );
}
