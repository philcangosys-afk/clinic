import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Download, Info, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { printHtml } from "@/lib/document-merge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

/**
 * تقارير الاستقبال والمواعيد (0068).
 *
 * كل الأرقام تُحسب في القاعدة لا في المتصفح. ثلاثة أسباب:
 *
 *   • PostgREST يسقّف الرد بألف صف، فتقرير شهر فيه ثلاثة آلاف موعد كان
 *     يُحسب على ألف — ويظهر رقمًا **يبدو صحيحًا** وهو ناقص.
 *   • التجميع بالأيام في المتصفح يستعمل منطقة جهاز الموظف، فيختلف التقرير
 *     باختلاف من يفتحه.
 *   • الانتظار يُقاس بنفس تعريف لوحة الاستقبال بالضبط — لا تعريفين
 *     يتنازعان.
 */

const ALL = "__all__";

type Filters = {
  from: string;
  to: string;
  doctorId: string;
  clinicId: string;
  branchId: string;
};

function todayMinus(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** تصدير CSV مع BOM — بدونه تفتح Excel العربية حروفًا مشوَّهة. */
function exportCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (value: string | number | null) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${todayMinus(0)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * حالات كل بطاقة **كما تعدّها القاعدة بالضبط**.
 *
 * `app_report_appointments` تعدّ «غير مؤكدة» على `new|scheduled|unconfirmed`
 * و«ملغاة» على الإلغاء من المريض ومن الموظف معًا و«حضوريون» على
 * `walk_in|waiting`. البطاقات كانت تنتقل بحالة واحدة من كل مجموعة
 * (`?status=cancelled_by_staff` مثلًا)، فيرى الموظف رقمًا في البطاقة ونصفه في
 * الشاشة التي تفتحها — فيظن أن سجلات ناقصة أو أن الرقم خطأ.
 */
const CARD_STATUSES: { key: string; label: string; statuses: string[] }[] = [
  { key: "total", label: "إجمالي المواعيد", statuses: [] },
  { key: "confirmed", label: "مؤكدة", statuses: ["confirmed"] },
  { key: "unconfirmed", label: "غير مؤكدة", statuses: ["new", "scheduled", "unconfirmed"] },
  { key: "completed", label: "زيارات مكتملة", statuses: ["completed"] },
  { key: "cancelled", label: "ملغاة", statuses: ["cancelled_by_patient", "cancelled_by_staff"] },
  { key: "no_show", label: "عدم حضور", statuses: ["no_show"] },
  { key: "walk_in", label: "حضوريون", statuses: ["walk_in", "waiting"] },
];

/** جملة تُقال في وصف كل تقرير لا تقبل دالّته مرشّح العيادة. */

export default function ReceptionReports() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const { can, isLoading: permissionsLoading } = usePermissions();
  const queryClient = useQueryClient();
  /**
   * `can()` تُعيد `false` أثناء التحميل وعند فشل استعلام الصلاحيات (اتجاه
   * مقصود للأزرار)، فبناء رسالة «صلاحيتك لا تسمح» عليه يعني إخبار مستخدمٍ
   * يملك الصلاحية أنه لا يملكها — وتبقى الرسالة قائمة إن فشل الاستعلام.
   * حالة الاستعلام تُقرأ من ذاكرة react-query للتمييز بين الحالات الثلاث.
   */
  const permissionsFailed =
    queryClient.getQueryState(["my-permissions", organizationId])?.status === "error";
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({
    from: todayMinus(30),
    to: todayMinus(0),
    doctorId: ALL,
    clinicId: ALL,
    branchId: ALL,
  });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const branches = useQuery({
    queryKey: ["report-branches", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const doctors = useQuery({
    queryKey: ["report-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const clinics = useQuery({
    queryKey: ["report-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, branch_id")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; branch_id: string | null }[];
    },
  });

  const visibleClinics = (clinics.data ?? []).filter(
    (clinic) => filters.branchId === ALL || clinic.branch_id === filters.branchId,
  );

  const args = useMemo(
    () => ({
      p_organization_id: organizationId,
      p_from: filters.from,
      p_to: filters.to,
      p_branch_id: filters.branchId === ALL ? null : filters.branchId,
      p_doctor_id: filters.doctorId === ALL ? null : filters.doctorId,
      p_clinic_id: filters.clinicId === ALL ? null : filters.clinicId,
    }),
    [organizationId, filters],
  );

  const enabled = Boolean(organizationId) && can("reports.reception");

  const summary = useQuery({
    queryKey: ["report-appointments", args],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_report_appointments", args);
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Record<string, number> | null;
    },
  });

  const waiting = useQuery({
    queryKey: ["report-waiting", args],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_report_waiting", args);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const occupancy = useQuery({
    queryKey: ["report-occupancy", args],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_report_occupancy", args);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const sources = useQuery({
    queryKey: ["report-sources", args],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_report_booking_sources", args);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const noShow = useQuery({
    queryKey: ["report-no-show", args],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_report_no_show", args);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const repeatNoShow = useQuery({
    queryKey: ["report-repeat-no-show", organizationId, filters],
    enabled,
    queryFn: async () => {
      // المُرشِّحات الثلاثة صارت مقبولة في 0144: كانت الدالّة تُجمِّع على
      // المنشأة كلّها فتُعرض قائمة المتخلّفين عن مواعيد عيادةٍ أخرى تحت
      // مُرشِّح عيادة.
      const { data, error } = await supabase.rpc("app_report_repeat_no_show", {
        p_organization_id: organizationId,
        p_from: filters.from,
        p_to: filters.to,
        p_min_count: 2,
        p_branch_id: filters.branchId === ALL ? null : filters.branchId,
        p_doctor_id: filters.doctorId === ALL ? null : filters.doctorId,
        p_clinic_id: filters.clinicId === ALL ? null : filters.clinicId,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // أثناء تحميل الصلاحيات لا يُقال شيء قاطع — لا «تسمح» ولا «لا تسمح»
  if (permissionsLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (permissionsFailed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          تعذّر التحقّق من صلاحياتك — هذه ليست رسالة نفي صلاحية. أعد تحميل الصفحة، وإن تكرّر فراجع
          مدير المنشأة.
        </span>
      </div>
    );
  }
  if (!can("reports.reception")) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        صلاحيتك لا تسمح بعرض تقارير الاستقبال.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">المرشِّحات</CardTitle>
          <CardDescription>
            الفترة والفرع والطبيب تُطبَّق على التقارير كلها وعلى التصدير. أمّا العيادة فتُطبَّق على
            بطاقات المواعيد وتقرير الانتظار فقط — التقارير الثلاثة التي لا تقبلها مكتوب فيها ذلك.
            وتقرير «متكرّرو عدم الحضور» يتبع الفترة وحدها.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={filters.from}
              onChange={(event) => set("from", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={filters.to}
              onChange={(event) => set("to", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الفرع</Label>
            <Select
              value={filters.branchId}
              onValueChange={(value) =>
                setFilters((previous) => ({
                  ...previous,
                  branchId: value,
                  clinicId: ALL,
                }))
              }
            >
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الفروع</SelectItem>
                {(branches.data ?? []).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الطبيب</Label>
            <Select value={filters.doctorId} onValueChange={(value) => set("doctorId", value)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الأطباء</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">العيادة</Label>
            <Select value={filters.clinicId} onValueChange={(value) => set("clinicId", value)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل العيادات</SelectItem>
                {visibleClinics.map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* بطاقات المواعيد */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {CARD_STATUSES.map((card) => (
          <button
            key={card.key}
            type="button"
            // الانتقال من الرقم إلى السجلات المكوِّنة له: بطاقة لا يمكن فتحها
            // تجعل الموظف يعيد بناء نفس التصفية يدويًا في شاشة المواعيد.
            // الحالات كلها تُمرَّر مفصولة بفاصلة **مع الفترة**، لأن الرقم في
            // البطاقة محسوب على الفترة لا على اليوم الذي تفتحه تلك الشاشة.
            onClick={() => {
              const params = new URLSearchParams({ from: filters.from, to: filters.to });
              if (card.statuses.length > 0) params.set("status", card.statuses.join(","));
              navigate(`/appointments?${params.toString()}`);
            }}
            className="rounded-lg border p-3 text-start transition hover:border-primary hover:bg-primary/5"
          >
            <div className="text-xs text-muted-foreground">{card.label}</div>
            <div className="text-xl font-bold tabular-nums">
              {summary.isLoading ? "…" : Number(summary.data?.[card.key] ?? 0).toLocaleString("ar-SA")}
            </div>
          </button>
        ))}
      </div>

      <ReportTable
        title="تقرير الانتظار"
        description="حتى النداء = الوصول ← النداء · حتى البدء = الوصول ← الدخول · داخل العيادة = الدخول ← الخروج"
        loading={waiting.isLoading}
        headers={["الطبيب", "العيادة", "عدد المرضى", "متوسط حتى النداء", "أطول انتظار", "متوسط حتى البدء", "متوسط داخل العيادة"]}
        rows={(waiting.data ?? []).map((row) => [
          row.doctor_name,
          row.clinic_name ?? "—",
          row.patients_count,
          row.avg_wait_to_call ?? "—",
          row.max_wait_to_call ?? "—",
          row.avg_wait_to_start ?? "—",
          row.avg_in_clinic ?? "—",
        ])}
        exportName="تقرير-الانتظار"
      />

      <ReportTable
        title="تقرير الإشغال"
        description={`الساعات المتاحة من دوام الطبيب المسجَّل. طبيب بلا دوام مسجَّل تظهر نسبته «لا يُعرف» لا صفرًا.`}
        loading={occupancy.isLoading}
        headers={["الطبيب", "ساعات متاحة", "ساعات محجوزة", "نسبة الإشغال %", "ساعات غير مستغلة"]}
        rows={(occupancy.data ?? []).map((row) => [
          row.doctor_name,
          row.available_hours,
          row.booked_hours,
          row.utilization_pct ?? "لا يُعرف",
          row.idle_hours ?? "—",
        ])}
        exportName="تقرير-الإشغال"
      />

      <ReportTable
        title="مصادر الحجز"
        description={`المواعيد بلا مصدر تظهر باسمها الصريح «غير محدَّد» — نصيبها مؤشّر على جودة الإدخال.`}
        loading={sources.isLoading}
        headers={["المصدر", "العدد", "مكتملة", "عدم حضور", "النسبة %"]}
        rows={(sources.data ?? []).map((row) => [
          row.source_name,
          row.total,
          row.completed,
          row.no_show,
          row.share_pct ?? "—",
        ])}
        exportName="مصادر-الحجز"
      />

      <ReportTable
        title="الإلغاء وعدم الحضور"
        description={`الخسارة تقديرية: متوسط صافي فواتير الطبيب في الفترة × عدد المتغيّبين. ليست خسارة محقّقة.`}
        loading={noShow.isLoading}
        headers={["الطبيب", "إجمالي المواعيد", "عدم حضور", "ملغاة", "نسبة عدم الحضور %", "متوسط الفاتورة", "خسارة تقديرية"]}
        rows={(noShow.data ?? []).map((row) => [
          row.doctor_name,
          row.total,
          row.no_show_count,
          row.cancelled_count,
          row.no_show_pct ?? "—",
          row.avg_invoice ?? "—",
          row.estimated_loss ?? "لا بيانات",
        ])}
        exportName="عدم-الحضور"
      />

      <ReportTable
        title="مرضى متكرّرو عدم الحضور"
        description="مرّتان فأكثر في الفترة المحدَّدة. هذا التقرير يتبع الفترة وحدها: دالّته لا تقبل الفرع ولا الطبيب ولا العيادة."
        loading={repeatNoShow.isLoading}
        headers={["المريض", "رقم الملف", "الجوال", "مرات عدم الحضور", "آخر مرة"]}
        rows={(repeatNoShow.data ?? []).map((row) => [
          row.patient_name,
          row.file_number ?? "—",
          row.mobile_number ?? "—",
          row.no_show_count,
          row.last_no_show ? new Date(row.last_no_show).toLocaleDateString("ar-SA") : "—",
        ])}
        exportName="متكررو-عدم-الحضور"
      />

      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          كل الأرقام محسوبة في قاعدة البيانات بالمنطقة الزمنية للمنشأة، وبنفس تعريف الانتظار
          المستعمل في لوحة الاستقبال. والتصدير يحترم المرشِّحات المطبَّقة على كل تقرير كما هي
          مذكورة في وصفه — لا مرشّح يعمل في الشاشة ولا يعمل في الملف.
        </span>
      </div>
    </div>
  );
}

function ReportTable({
  title,
  description,
  loading,
  headers,
  rows,
  exportName,
}: {
  title: string;
  description: string;
  loading: boolean;
  headers: string[];
  rows: (string | number | null)[][];
  exportName: string;
}) {
  const print = () =>
    printHtml(
      title,
      `<h2>${title}</h2><p style="font-size:11px">${description}</p>
       <table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">
         <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
         <tbody>${rows
           .map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`)
           .join("")}</tbody>
       </table>`,
    );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => exportCsv(exportName, headers, rows)} disabled={rows.length === 0}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={print} disabled={rows.length === 0}>
            <Printer className="h-3.5 w-3.5" />
            طباعة
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex} className="tabular-nums">
                        {cell ?? "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={headers.length} className="py-8 text-center text-sm text-muted-foreground">
                      لا بيانات في هذه الفترة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
