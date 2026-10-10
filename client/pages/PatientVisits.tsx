import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  ExternalLink,
  FileSignature,
  History,
  Receipt,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { useSessionDoctor } from "@/lib/session-doctor";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * سجل زيارات المرضى — المرحلة السابعة.
 *
 * شاشة **تشغيلية** لا بديلة عن السجل الطبي: من هنا يُتابَع ما هو مفتوح وما
 * وُقِّع وما أُغلق ماليًا.
 *
 * قبل 0087 لم يكن في `patient_visits` **عمود حالة إطلاقًا**: الزيارة إمّا
 * موجودة أو لا. فزيارةٌ بدأها الطبيب ولم يكملها تبدو كزيارة مكتملة تمامًا،
 * ولا تقرير يكشفها.
 */

const NONE = "__none__";

const STATUS_LABELS: Record<string, string> = {
  planned: "مخطَّطة",
  waiting: "منتظرة",
  in_progress: "جارية",
  completed: "مكتملة",
  signed: "موقَّعة",
  closed: "مغلقة",
  cancelled: "ملغاة",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  planned: "secondary",
  waiting: "secondary",
  in_progress: "default",
  completed: "warning",
  signed: "success",
  closed: "success",
  cancelled: "destructive",
};

/** الانتقالات المتاحة — نفس خريطة `app_visit_status_allowed`. */
const NEXT_STATUS: Record<string, { value: string; label: string; needsReason?: boolean }[]> = {
  planned: [
    { value: "in_progress", label: "بدء الزيارة" },
    { value: "cancelled", label: "إلغاء", needsReason: true },
  ],
  waiting: [
    { value: "in_progress", label: "بدء الزيارة" },
    { value: "cancelled", label: "إلغاء", needsReason: true },
  ],
  in_progress: [
    { value: "completed", label: "إنهاء الزيارة" },
    { value: "cancelled", label: "إلغاء", needsReason: true },
  ],
  completed: [
    { value: "signed", label: "توقيع" },
    { value: "in_progress", label: "إعادة فتح", needsReason: true },
  ],
  signed: [
    { value: "closed", label: "إغلاق ماليّ" },
    { value: "in_progress", label: "إعادة فتح", needsReason: true },
  ],
  closed: [{ value: "in_progress", label: "إعادة فتح", needsReason: true }],
};

const INVOICE_STATUS: Record<string, string> = {
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة",
  void: "ملغاة",
};

const CLAIM_STATUS: Record<string, string> = {
  pending: "قيد المطالبة",
  accepted: "مقبولة",
  rejected: "مرفوضة",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function PatientVisits() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const [searchParams] = useSearchParams();
  const organizationId = organization?.id;
  const [tab, setTab] = useState("register");

  const [filters, setFilters] = useState<any>({
    from: today(),
    to: today(),
    status: "all",
    branch: "all",
    clinic: "all",
    doctor: "all",
    invoice: "all",
    search: "",
  });
  const [target, setTarget] = useState<any | null>(null);

  const set = (field: string, value: any) => setFilters((prev: any) => ({ ...prev, [field]: value }));

  const branches = useQuery({
    queryKey: ["visit-branches", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const clinics = useQuery({
    queryKey: ["visit-clinics", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        // مرشِّح لا يُختار منه: العيادة المعطَّلة لا تُستقبل فيها زيارة اليوم،
        // فوجودها في القائمة يطيلها بأسماء لا معنى لاختيارها. والترشيح على
        // القائمة لا على النتائج — زيارات العيادة القديمة تبقى كما هي.
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const doctors = useQuery({
    queryKey: ["visit-doctors", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // كما في شاشة السجل الطبي وحوار طلب المؤشرات: الطبيب الموقوف لا يُرشَّح به.
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * ما يدخل الاستعلام فعلًا — بلا `search`.
   *
   * المفتاح كان يضمّ كائن المرشِّحات كاملًا ومنه `search`، وهو لا يُستعمل في
   * الاستعلام إطلاقًا (الترشيح عليه محلّي في `rows` أدناه). فكل حرف يُكتب في
   * مربّع البحث كان يُطلق طلبًا جديدًا بخمس مئة صفّ ويرتعش الجدول بلا داع.
   */
  const serverFilters = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      status: filters.status,
      branch: filters.branch,
      clinic: filters.clinic,
      doctor: filters.doctor,
      invoice: filters.invoice,
    }),
    [
      filters.from,
      filters.to,
      filters.status,
      filters.branch,
      filters.clinic,
      filters.doctor,
      filters.invoice,
    ],
  );

  const visits = useQuery({
    queryKey: ["visit-register", organizationId, serverFilters],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("v_visit_register")
        .select(
          "id, patient_id, patient_name, file_number, doctor_name, clinic_name, branch_name, visit_date, started_at, ended_at, status, main_complaint, primary_diagnosis, service_count, unbilled_service_count, services_amount, invoice_id, invoice_number, invoice_status, invoice_amount, remaining_amount, is_insurance_invoice, insurance_company_name, claim_status, has_services_no_invoice, appointment_id, signed_at, closed_at, reopened_at",
        )
        .eq("organization_id", organizationId)
        .gte("visit_date", serverFilters.from)
        .lte("visit_date", serverFilters.to)
        .order("visit_date", { ascending: false })
        .limit(500);
      if (serverFilters.status !== "all") query = query.eq("status", serverFilters.status);
      if (serverFilters.branch !== "all") query = query.eq("branch_name", serverFilters.branch);
      if (serverFilters.clinic !== "all") query = query.eq("clinic_name", serverFilters.clinic);
      if (serverFilters.doctor !== "all") query = query.eq("doctor_name", serverFilters.doctor);
      if (serverFilters.invoice === "none") query = query.is("invoice_id", null);
      if (serverFilters.invoice === "unpaid") {
        query = query.in("invoice_status", ["unpaid", "partial"]);
      }
      if (serverFilters.invoice === "paid") query = query.eq("invoice_status", "paid");
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * الزيارة المطلوبة برابط `?visitId=…`.
   *
   * شاشات أخرى (رحلة المريض مثلًا) توجّه إلى هنا بـ`visitId` وهذه الشاشة لم
   * تكن تقرأ مُعاملات الرابط إطلاقًا، فتُفتح على سجلّ اليوم العامّ ويبحث
   * الموظّف من جديد عن الزيارة التي جاء منها. وتُقرأ بمفردها لأنها قد تكون
   * خارج الفترة المُرشَّحة (المبدئي: اليوم) فلا توجد في صفوف القائمة.
   */
  const deepVisitId = searchParams.get("visitId");
  const deepVisit = useQuery({
    queryKey: ["visit-register-one", organizationId, deepVisitId],
    enabled: Boolean(organizationId && deepVisitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_visit_register")
        .select(
          "id, patient_id, patient_name, file_number, doctor_name, clinic_name, visit_date, status, main_complaint, primary_diagnosis, service_count, services_amount, invoice_id, appointment_id, signed_at, closed_at, reopened_at",
        )
        .eq("organization_id", organizationId)
        .eq("id", deepVisitId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as any | null;
    },
  });

  useEffect(() => {
    if (deepVisit.data) setTarget(deepVisit.data);
  }, [deepVisit.data]);

  const incomplete = useQuery({
    queryKey: ["incomplete-visits", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_incomplete_visits")
        .select(
          "id, patient_name, file_number, doctor_name, clinic_name, visit_date, status, issue, days_open, service_count, unbilled_service_count, services_amount",
        )
        .eq("organization_id", organizationId)
        .order("days_open", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = useMemo(() => {
    const term = String(filters.search ?? "").trim();
    if (!term) return visits.data ?? [];
    return (visits.data ?? []).filter(
      (row) =>
        String(row.patient_name ?? "").includes(term) ||
        String(row.file_number ?? "").includes(term) ||
        String(row.invoice_number ?? "").includes(term),
    );
  }, [visits.data, filters.search]);

  const exportCsv = () => {
    const headers = [
      "التاريخ",
      "المريض",
      "رقم الملف",
      "الطبيب",
      "العيادة",
      "الحالة",
      "التشخيص",
      "الخدمات",
      "مبلغ الخدمات",
      "الفاتورة",
      "حالة الفاتورة",
      "المبلغ",
      "المتبقي",
      "المطالبة",
    ];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          String(row.visit_date).slice(0, 10),
          row.patient_name,
          row.file_number,
          row.doctor_name,
          row.clinic_name,
          STATUS_LABELS[row.status] ?? row.status,
          row.primary_diagnosis,
          row.service_count,
          row.services_amount,
          row.invoice_number,
          INVOICE_STATUS[row.invoice_status] ?? "",
          row.invoice_amount,
          row.remaining_amount,
          CLAIM_STATUS[row.claim_status] ?? "",
        ]
          .map(escape)
          .join(","),
      ),
    ];
    // BOM كي تفتح Excel العربية بترميز صحيح.
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `visits-${filters.from}-${filters.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">سجل زيارات المرضى</h1>
          <p className="text-sm text-muted-foreground">
            شاشة تشغيلية: ما هو مفتوح، وما وُقِّع، وما أُغلق ماليًا. ليست بديلة عن السجل الطبي.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4" />
          تصدير
        </Button>
      </div>

      {deepVisitId && deepVisit.isError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          تعذّر فتح الزيارة المطلوبة: {(deepVisit.error as Error)?.message ?? "خطأ غير متوقع"}
        </p>
      )}
      {deepVisitId && !deepVisit.isLoading && !deepVisit.isError && !deepVisit.data && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          الزيارة المطلوبة غير موجودة في هذه المنشأة.
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="register">السجل</TabsTrigger>
          <TabsTrigger value="incomplete">
            غير المكتملة
            {(incomplete.data ?? []).length > 0 && (
              <Badge variant="destructive" className="ms-2">
                {(incomplete.data ?? []).length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <div className="flex flex-col gap-1.5">
                    <Label>من</Label>
                    <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
                  </div>
                </div>
                <div className="w-40">
                  <div className="flex flex-col gap-1.5">
                    <Label>إلى</Label>
                    <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
                  </div>
                </div>
                <Filter
                  label="الحالة"
                  value={filters.status}
                  onChange={(v) => set("status", v)}
                  options={[{ value: "all", label: "كل الحالات" }].concat(
                    Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
                  )}
                />
                <Filter
                  label="الفرع"
                  value={filters.branch}
                  onChange={(v) => set("branch", v)}
                  options={[{ value: "all", label: "كل الفروع" }].concat(
                    (branches.data ?? []).map((b: any) => ({ value: b.name, label: b.name })),
                  )}
                />
                <Filter
                  label="العيادة"
                  value={filters.clinic}
                  onChange={(v) => set("clinic", v)}
                  options={[{ value: "all", label: "كل العيادات" }].concat(
                    (clinics.data ?? []).map((c: any) => ({ value: c.name, label: c.name })),
                  )}
                />
                <Filter
                  label="الطبيب"
                  value={filters.doctor}
                  onChange={(v) => set("doctor", v)}
                  options={[{ value: "all", label: "كل الأطباء" }].concat(
                    (doctors.data ?? []).map((d: any) => ({ value: d.name_ar, label: d.name_ar })),
                  )}
                />
                <Filter
                  label="الفاتورة"
                  value={filters.invoice}
                  onChange={(v) => set("invoice", v)}
                  options={[
                    { value: "all", label: "الكل" },
                    { value: "none", label: "بلا فاتورة" },
                    { value: "unpaid", label: "غير مسدَّدة" },
                    { value: "paid", label: "مسدَّدة" },
                  ]}
                />
                <Input
                  value={filters.search}
                  onChange={(e) => set("search", e.target.value)}
                  placeholder="اسم المريض أو رقم الملف أو الفاتورة..."
                  className="max-w-xs"
                />
              </div>
              <CardDescription>
                {rows.length} زيارة
                {rows.length >= 500 && " — يُعرض أول ٥٠٠، ضيّق الفترة"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visits.isLoading && <Skeleton className="h-40 w-full" />}
              {visits.isError && (
                <p className="py-6 text-center text-sm text-destructive">
                  تعذّر التحميل: {(visits.error as Error)?.message}
                </p>
              )}
              {!visits.isLoading && !visits.isError && (
                <VisitTable
                  rows={rows}
                  onOpen={setTarget}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incomplete" className="mt-4">
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                زيارات لم تُغلق ولها ما ينقصها: جارية من يوم سابق، أو مكتملة ولم تُوقَّع منذ
                يومين، أو عليها خدمات بلا فاتورة. عملُ اليوم الجاري ليس نقصًا ولا يظهر هنا.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {incomplete.isLoading && <Skeleton className="h-32 w-full" />}
              {!incomplete.isLoading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المريض</TableHead>
                      <TableHead>الطبيب</TableHead>
                      <TableHead>العيادة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الملاحظة</TableHead>
                      <TableHead>منذ</TableHead>
                      <TableHead>مبلغ معلّق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(incomplete.data ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.patient_name}
                          {row.file_number && (
                            <span className="ms-2 font-mono text-xs text-muted-foreground">
                              {row.file_number}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.doctor_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.clinic_name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {String(row.visit_date).slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE[row.status] ?? "secondary"}>
                            {STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{row.issue}</TableCell>
                        <TableCell>
                          <Badge variant={row.days_open >= 7 ? "destructive" : "outline"}>
                            {row.days_open} يوم
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {Number(row.services_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")} ر.س
                        </TableCell>
                      </TableRow>
                    ))}
                    {(incomplete.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          لا زيارات ناقصة. كل شيء مغلق أو قيد العمل اليوم.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <VisitActionsDialog visit={target} onClose={() => setTarget(null)} />

    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="w-40">
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function VisitTable({
  rows,
  onOpen,
}: {
  rows: any[];
  onOpen: (row: any) => void;
}) {
  const { can } = usePermissions();
  /**
   * الطبيب لا يُصدر فاتورة (0173) — لا «إنشاء فاتورة» ولا غيرها. الفوترة
   * للاستقبال، وما يريده الطبيب في الحساب يكتبه في مركز المتابعة.
   *
   * و`can` وحدها لا تكفي هنا: المالك الذي يعاين بصفة الطبيب يملك كلّ شيء،
   * فيرى زرًّا لن يراه الطبيب الحقيقيّ — والمعاينة التي تكذب لا تنفع.
   * والقاعدة ترفض الطبيب في الدالّتين أيًّا كان ما يظهر هنا.
   */
  const { isDoctorRole } = useSessionDoctor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /**
   * إنشاء الفاتورة **من الزيارة** لا من شاشة الفوترة.
   *
   * `app_create_invoice_from_visit` (0091) يجمع كل ما نُفِّذ ولم يُفوتَر —
   * خدمات وأدوية مصروفة — ويسعّره من قائمة العقد أو التأمين أو الأساس، ويوزّع
   * حصّتَي المريض والشركة، ويحسب الضريبة لكل بند على حدة. قبله كان الموظف
   * يعيد إدخال البنود يدويًا في شاشة الفوترة، فما نسيه لا يُفوتَر.
   */
  const createInvoice = useMutation({
    mutationFn: async (visitId: string) => {
      const { data, error } = await supabase.rpc("app_create_invoice_from_visit", {
        p_visit_id: visitId,
        p_use_insurance: true,
        p_membership_id: null,
        p_note: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visit-register"] });
      queryClient.invalidateQueries({ queryKey: ["incomplete-visits"] });
      toast({
        title: "أُنشئت الفاتورة كمسوّدة",
        description: "راجعها في شاشة الفوترة ثم أصدرها",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الفاتورة",
        description: errorMessage(error),
      }),
  });

  /**
   * إنشاء المطالبة **من الزيارة** بعد إصدار فاتورة تأمينية.
   *
   * `app_create_claim_from_visit` (0093) يقرأ التشخيصات وبنود الفاتورة
   * بحصّة الشركة، ويرث رقم الموافقة المسبقة من بند الفاتورة إن وُجد،
   * ويرفض الإنشاء إذا كانت المطالبة موجودة أو الفاتورة غير تأمينية.
   * ما يُنشأ هنا مسوّدة تُراجَع في مساحة المطالبات قبل الإرسال.
   */
  const createClaim = useMutation({
    mutationFn: async (row: any) => {
      const { data, error } = await supabase.rpc("app_create_claim_from_visit", {
        p_visit_id: row.id,
        p_invoice_id: row.invoice_id ?? null,
        p_form_type: "ucaf",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visit-register"] });
      toast({
        title: "أُنشئت المطالبة كمسوّدة",
        description: "راجع بنودها في التأمين ← معالجة المطالبات ثم أرسلها",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء المطالبة",
        description: errorMessage(error),
      }),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>التاريخ</TableHead>
          <TableHead>المريض</TableHead>
          <TableHead>الطبيب</TableHead>
          <TableHead>العيادة</TableHead>
          <TableHead>التشخيص</TableHead>
          <TableHead>الخدمات</TableHead>
          <TableHead>الفاتورة</TableHead>
          <TableHead>المطالبة</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">
              {String(row.visit_date).slice(0, 10)}
            </TableCell>
            <TableCell className="font-medium">
              <Link to={`/patients/${row.patient_id}`} className="hover:underline">
                {row.patient_name}
              </Link>
              {row.file_number && (
                <span className="ms-2 font-mono text-xs text-muted-foreground">{row.file_number}</span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{row.doctor_name ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{row.clinic_name ?? "—"}</TableCell>
            <TableCell className="max-w-48 truncate text-sm">
              {row.primary_diagnosis ?? row.main_complaint ?? "—"}
            </TableCell>
            <TableCell>
              {row.service_count > 0 ? (
                <span className="flex items-center gap-1">
                  {row.service_count}
                  {row.unbilled_service_count > 0 && (
                    <Badge variant="outline" title="خدمات لم تُفوتَر">
                      {row.unbilled_service_count} معلّقة
                    </Badge>
                  )}
                </span>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              {row.invoice_id ? (
                <span className="flex flex-col">
                  <span className="font-mono text-xs">#{row.invoice_number}</span>
                  <span className="text-xs text-muted-foreground">
                    {INVOICE_STATUS[row.invoice_status] ?? row.invoice_status} —{" "}
                    {Number(row.invoice_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                  </span>
                </span>
              ) : row.has_services_no_invoice ? (
                <div className="flex flex-col items-start gap-1">
                  <Badge variant="destructive">بلا فاتورة</Badge>
                  {can("billing.issue") && !isDoctorRole && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createInvoice.isPending}
                      onClick={() => createInvoice.mutate(row.id)}
                    >
                      <Receipt className="h-3.5 w-3.5" />
                      إنشاء فاتورة
                    </Button>
                  )}
                </div>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.claim_status ? (
                CLAIM_STATUS[row.claim_status] ?? row.claim_status
              ) : row.is_insurance_invoice && row.invoice_id ? (
                can("insurance.claims") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={createClaim.isPending}
                    onClick={() => createClaim.mutate(row)}
                  >
                    <FileSignature className="h-3.5 w-3.5" />
                    إنشاء مطالبة
                  </Button>
                ) : (
                  <Badge variant="outline">بلا مطالبة</Badge>
                )
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE[row.status] ?? "secondary"} title={row.reopened_at ? "أُعيد فتحها" : undefined}>
                {STATUS_LABELS[row.status] ?? row.status}
                {row.reopened_at ? " ↻" : ""}
              </Badge>
            </TableCell>
            <TableCell className="text-end">
              <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
                <ClipboardList className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
              لا زيارات في هذه الفترة.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

/**
 * إجراءات الزيارة.
 *
 * كل انتقال يمرّ بـ`app_set_visit_status`: الدالة ترفض القفز، وتفرض لكل
 * انتقال صلاحيته، وتُلزم بسبب لإعادة الفتح والإلغاء، وتمنع الإغلاق على خدمة
 * لم تُفوتَر، وتمسح التوقيع عند إعادة الفتح — توقيعٌ على محتوى تغيّر ليس
 * توقيعًا.
 */
function VisitActionsDialog({ visit, onClose }: { visit: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<{ value: string; label: string } | null>(null);
  const [reason, setReason] = useState("");

  const audit = useQuery({
    queryKey: ["visit-audit", visit?.id],
    enabled: Boolean(visit?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, occurred_at, action_type, details, reason, user_id")
        .eq("entity_id", visit.id)
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const advance = useMutation({
    mutationFn: async ({ next, note }: { next: string; note?: string }) => {
      const { error } = await supabase.rpc("app_set_visit_status", {
        p_visit_id: visit.id,
        p_status: next,
        p_reason: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visit-register"] });
      queryClient.invalidateQueries({ queryKey: ["incomplete-visits"] });
      queryClient.invalidateQueries({ queryKey: ["visit-audit", visit?.id] });
      setStep(null);
      setReason("");
      toast({ title: "تم تحديث حالة الزيارة" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Dialog open={Boolean(visit)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{visit?.patient_name}</DialogTitle>
          <DialogDescription>
            زيارة {String(visit?.visit_date ?? "").slice(0, 10)} —{" "}
            {STATUS_LABELS[visit?.status] ?? visit?.status}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <Info label="الطبيب" value={visit?.doctor_name} />
          <Info label="العيادة" value={visit?.clinic_name} />
          <Info label="التشخيص" value={visit?.primary_diagnosis} />
          <Info label="الشكوى" value={visit?.main_complaint} />
          <Info label="الخدمات" value={String(visit?.service_count ?? 0)} />
          <Info
            label="مبلغ الخدمات"
            value={`${Number(visit?.services_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")} ر.س`}
          />
          {visit?.signed_at && (
            <Info label="وُقِّعت" value={new Date(visit.signed_at).toLocaleString("ar-SA-u-nu-latn")} />
          )}
          {visit?.closed_at && (
            <Info label="أُغلقت" value={new Date(visit.closed_at).toLocaleString("ar-SA-u-nu-latn")} />
          )}
          {visit?.reopened_at && (
            <Info label="أُعيد فتحها" value={new Date(visit.reopened_at).toLocaleString("ar-SA-u-nu-latn")} />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to={`/medical-records?visitId=${visit?.id}`}>
              <ExternalLink className="h-4 w-4" />
              السجل الطبي
            </Link>
          </Button>
          {visit?.appointment_id && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/appointments?appointmentId=${visit.appointment_id}`}>
                <ExternalLink className="h-4 w-4" />
                الموعد
              </Link>
            </Button>
          )}
          {visit?.invoice_id && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/billing?invoiceId=${visit.invoice_id}`}>
                <Receipt className="h-4 w-4" />
                الفاتورة
              </Link>
            </Button>
          )}
        </div>

        <Separator />

        <div className="flex flex-wrap gap-2">
          {(NEXT_STATUS[visit?.status ?? ""] ?? []).map((option) => (
            <Button
              key={option.value}
              variant={option.needsReason ? "outline" : "default"}
              disabled={advance.isPending}
              onClick={() => {
                if (option.needsReason) {
                  setStep(option);
                } else {
                  advance.mutate({ next: option.value });
                }
              }}
            >
              {option.label}
            </Button>
          ))}
          {(NEXT_STATUS[visit?.status ?? ""] ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">لا إجراء متاح — الزيارة في حالة نهائية.</p>
          )}
        </div>

        <Separator />

        <div>
          <Label className="flex items-center gap-2">
            <History className="h-4 w-4" />
            سجلّ التدقيق
          </Label>
          <div className="mt-2 flex flex-col gap-1">
            {(audit.data ?? []).map((entry) => (
              <div key={entry.id} className="flex flex-wrap gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="font-mono text-muted-foreground">
                  {new Date(entry.occurred_at).toLocaleString("ar-SA-u-nu-latn")}
                </span>
                <span>{entry.details}</span>
                {entry.reason && <span className="text-muted-foreground">— {entry.reason}</span>}
              </div>
            ))}
            {(audit.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">لا أحداث مسجَّلة.</p>
            )}
          </div>
        </div>

        <Dialog open={Boolean(step)} onOpenChange={(open) => !open && setStep(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{step?.label}</DialogTitle>
              <DialogDescription>
                هذا الإجراء يحتاج سببًا مكتوبًا — يُحفظ في سجلّ التدقيق.
                {step?.value === "in_progress" && " وإعادة الفتح تمسح التوقيع والإغلاق."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>السبب *</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(null)}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                disabled={!reason.trim() || advance.isPending}
                onClick={() => step && advance.mutate({ next: step.value, note: reason.trim() })}
              >
                تأكيد
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{value ?? "—"}</span>
    </div>
  );
}
