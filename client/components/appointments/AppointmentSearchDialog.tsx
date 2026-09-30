import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Printer, RefreshCw, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { localDayRange } from "@/lib/date-range";
import { useMemberNames } from "@/lib/member-names";
import { formatDate, formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import { STATUS_GROUPS, statusLabel } from "@/lib/appointment-status";
import type { AppointmentStatus } from "@/lib/database.types";
import { printHtml } from "@/lib/document-merge";
import { errorMessage } from "@/lib/error-message";
import { useLookupTree } from "@/components/shared/LookupTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * البحث والطباعة — الجدول الكلاسيكي لشاشة المواعيد (Kizen «البحث / طباعة
 * جدول المواعيد»).
 *
 * المرشّحات تُطبَّق **في الاستعلام** لا في المتصفّح (الفترة والطبيب والعيادة
 * والحالة ونوع الزيارة ومن أدخل الموعد والانتظار والتقريب)، فالعدّادات في
 * الذيل تعدّ ما في القاعدة فعلًا. والسقف معلَن: ما زاد عليه يُقال لا يُقصّ بصمت.
 *
 * مصدر الموعد «أونلاين» = حجز الموقع الإلكتروني (ملاحظته تبدأ بـ«حجز من
 * الموقع الإلكتروني» — المعيار نفسه في بطاقة حجوزات الموقع). «الخارجيّون» في
 * Kizen من لا ملفّ له؛ ولا موعد عندنا بلا ملفّ، فالأقرب «حضوري بلا موعد».
 */
const ROW_LIMIT = 2000;
const ALL = "__all__";
const ONLINE_PREFIX = "حجز من الموقع الإلكتروني";

type Row = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: AppointmentStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  entered_at: string | null;
  is_waiting: boolean;
  waiting_all_day: boolean;
  accepts_earlier: boolean;
  visit_type_value_id: string | null;
  label_value_id: string | null;
  doctor_id: string;
  patient: {
    name_ar: string;
    name_en: string | null;
    file_number: number | string | null;
    mobile_number: string | null;
    phone_1: string | null;
    id_number: string | null;
    gender: string | null;
  } | null;
  doctor: { name_ar: string } | null;
  clinic: { name: string } | null;
  service: { code: string | null; name_ar: string } | null;
};

type TriState = "all" | "only" | "hide";

const ARRIVED: AppointmentStatus[] = ["arrived", "checked_in", "waiting", "walk_in", "called", "in_progress", "completed"];

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function AppointmentSearchDialog({
  organizationId,
  open,
  onOpenChange,
  doctors,
  clinics,
  defaultDay,
  scopedDoctorId,
  onOpenAppointment,
}: {
  organizationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  defaultDay: string;
  /** صفة الطبيب: يومه هو لا العيادة كلّها. */
  scopedDoctorId?: string | null;
  onOpenAppointment: (id: string) => void;
}) {
  const { calendarDisplay } = useLocaleSettings();
  const memberNames = useMemberNames(organizationId);
  const visitTypes = useLookupTree("visit_types");
  const labels = useLookupTree("appointment_labels");
  const [from, setFrom] = useState(defaultDay);
  const [to, setTo] = useState(defaultDay);
  const [doctorId, setDoctorId] = useState(ALL);
  const [clinicId, setClinicId] = useState(ALL);
  const [statusKey, setStatusKey] = useState(ALL);
  const [visitTypeId, setVisitTypeId] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [waiting, setWaiting] = useState<TriState>("all");
  const [earlier, setEarlier] = useState<TriState>("all");
  const [source, setSource] = useState<"all" | "online" | "offline">("all");
  const [patientText, setPatientText] = useState("");
  const [applied, setApplied] = useState(0);

  const reset = () => {
    setFrom(defaultDay);
    setTo(defaultDay);
    setDoctorId(ALL);
    setClinicId(ALL);
    setStatusKey(ALL);
    setVisitTypeId(ALL);
    setUserId(ALL);
    setWaiting("all");
    setEarlier("all");
    setSource("all");
    setPatientText("");
    setApplied((n) => n + 1);
  };

  const filters = { from, to, doctorId, clinicId, statusKey, visitTypeId, userId, waiting, earlier, source };
  const result = useQuery({
    queryKey: ["appointment-search", organizationId, scopedDoctorId ?? "", applied, JSON.stringify(filters)],
    enabled: Boolean(open && organizationId && from && to),
    queryFn: async () => {
      const bounds = localDayRange(from, to);
      let query = supabase
        .from("appointments")
        .select(
          "id, scheduled_start, scheduled_end, status, note, created_by, created_at, updated_by, updated_at, " +
            "confirmed_by, confirmed_at, entered_at, is_waiting, waiting_all_day, accepts_earlier, " +
            "visit_type_value_id, label_value_id, doctor_id, " +
            "patient:patients!appointments_patient_tenant_fk(name_ar, name_en, file_number, mobile_number, phone_1, id_number, gender), " +
            "doctor:doctors!appointments_doctor_tenant_fk(name_ar), " +
            "clinic:clinics!appointments_clinic_tenant_fk(name), " +
            "service:items!appointments_item_tenant_fk(code, name_ar)",
          { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .gte("scheduled_start", bounds.from ?? `${from}T00:00:00`)
        .lte("scheduled_start", bounds.to ?? `${to}T23:59:59`);
      const doctorFilter = scopedDoctorId ?? (doctorId !== ALL ? doctorId : null);
      if (doctorFilter) query = query.eq("doctor_id", doctorFilter);
      if (clinicId !== ALL) query = query.eq("clinic_id", clinicId);
      if (statusKey !== ALL) {
        const group = STATUS_GROUPS.find((g) => g.key === statusKey);
        if (group) query = query.in("status", group.statuses);
      }
      if (visitTypeId !== ALL) query = query.eq("visit_type_value_id", visitTypeId);
      if (userId !== ALL) query = query.eq("created_by", userId);
      if (waiting === "only") query = query.eq("is_waiting", true);
      if (waiting === "hide") query = query.eq("is_waiting", false);
      if (earlier === "only") query = query.eq("accepts_earlier", true);
      if (earlier === "hide") query = query.eq("accepts_earlier", false);
      if (source === "online") query = query.ilike("note", `${ONLINE_PREFIX}%`);
      if (source === "offline") query = query.or(`note.is.null,note.not.ilike."${ONLINE_PREFIX}*"`);
      const { data, error, count } = await query
        .order("doctor_id")
        .order("scheduled_start")
        .limit(ROW_LIMIT);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  const visitTypeName = useMemo(() => {
    const map = new Map<string, string>();
    (visitTypes.data ?? []).forEach((node) => map.set(node.id, node.name_ar));
    return map;
  }, [visitTypes.data]);
  const labelName = useMemo(() => {
    const map = new Map<string, string>();
    (labels.data ?? []).forEach((node) => map.set(node.id, node.name_ar));
    return map;
  }, [labels.data]);

  const needle = patientText.trim();
  const rows = useMemo(
    () =>
      (result.data?.rows ?? []).filter(
        (row) =>
          !needle ||
          Boolean(row.patient?.name_ar?.includes(needle)) ||
          Boolean(row.patient?.name_en?.toLowerCase().includes(needle.toLowerCase())) ||
          String(row.patient?.file_number ?? "") === needle ||
          Boolean(row.patient?.mobile_number?.includes(needle)) ||
          Boolean(row.patient?.id_number?.includes(needle)),
      ),
    [result.data, needle],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((row) => {
      const key = row.doctor?.name_ar ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    return [...map.entries()];
  }, [rows]);

  const counters = useMemo(() => {
    const isNewVisit = (row: Row) => (visitTypeName.get(row.visit_type_value_id ?? "") ?? "").includes("جديد");
    return [
      { label: "كل المواعيد", value: rows.length },
      { label: "مؤكَّدة", value: rows.filter((r) => r.status === "confirmed" || r.confirmed_at).length },
      { label: "غير مؤكَّدة", value: rows.filter((r) => ["new", "scheduled", "unconfirmed"].includes(r.status)).length },
      { label: "حضرت", value: rows.filter((r) => ARRIVED.includes(r.status)).length },
      { label: "لم تحضر", value: rows.filter((r) => r.status === "no_show").length },
      { label: "اعتذرت", value: rows.filter((r) => r.status === "cancelled_by_patient").length },
      { label: "ألغتها المنشأة", value: rows.filter((r) => r.status === "cancelled_by_staff").length },
      { label: "حضوري بلا موعد", value: rows.filter((r) => r.status === "walk_in").length },
      { label: "انتظار", value: rows.filter((r) => r.is_waiting).length },
      { label: "زيارة جديدة", value: rows.filter(isNewVisit).length },
    ];
  }, [rows, visitTypeName]);

  const name = (id: string | null) => (id ? memberNames.data?.get(id) ?? "—" : "—");
  const isOnline = (row: Row) => (row.note ?? "").startsWith(ONLINE_PREFIX);
  const genderLabel = (g: string | null) => (g === "male" ? "ذكر" : g === "female" ? "أنثى" : "—");

  const columns: { head: string; cell: (row: Row) => string }[] = [
    { head: "التاريخ", cell: (r) => formatDate(r.scheduled_start, calendarDisplay) },
    { head: "الوقت", cell: (r) => (r.is_waiting ? (r.waiting_all_day ? "انتظار — طوال اليوم" : `انتظار من ${formatTime(r.scheduled_start)}`) : formatTime(r.scheduled_start)) },
    { head: "النهاية", cell: (r) => (r.is_waiting ? "—" : formatTime(r.scheduled_end)) },
    { head: "الملف", cell: (r) => String(r.patient?.file_number ?? "—") },
    { head: "المريض", cell: (r) => r.patient?.name_ar ?? "—" },
    { head: "Patient", cell: (r) => r.patient?.name_en ?? "" },
    { head: "الجوال", cell: (r) => r.patient?.mobile_number ?? "" },
    { head: "الهاتف", cell: (r) => r.patient?.phone_1 ?? "" },
    { head: "الهوية", cell: (r) => r.patient?.id_number ?? "" },
    { head: "الجنس", cell: (r) => genderLabel(r.patient?.gender ?? null) },
    { head: "العيادة", cell: (r) => r.clinic?.name ?? "" },
    { head: "الحالة", cell: (r) => statusLabel(r.status) },
    { head: "الوسم", cell: (r) => labelName.get(r.label_value_id ?? "") ?? "" },
    { head: "نوع الزيارة", cell: (r) => visitTypeName.get(r.visit_type_value_id ?? "") ?? "" },
    { head: "الخدمة", cell: (r) => (r.service ? `${r.service.code ? `${r.service.code} · ` : ""}${r.service.name_ar}` : "") },
    { head: "أكّده", cell: (r) => (r.confirmed_at ? `${name(r.confirmed_by)} · ${formatDateTime(r.confirmed_at, calendarDisplay)}` : "") },
    { head: "أدخله", cell: (r) => `${name(r.created_by)} · ${formatDateTime(r.created_at, calendarDisplay)}` },
    { head: "آخر تعديل", cell: (r) => (r.updated_by ? `${name(r.updated_by)} · ${formatDateTime(r.updated_at, calendarDisplay)}` : "") },
    { head: "دخل العيادة", cell: (r) => (r.entered_at ? formatDateTime(r.entered_at, calendarDisplay) : "") },
    { head: "المصدر", cell: (r) => (isOnline(r) ? "الموقع" : "الاستقبال") },
    { head: "انتظار", cell: (r) => (r.is_waiting ? "✓" : "") },
    { head: "تقريب", cell: (r) => (r.accepts_earlier ? "✓" : "") },
    { head: "ملاحظة", cell: (r) => r.note ?? "" },
  ];

  const filterSummary = () =>
    [
      `من ${from} إلى ${to}`,
      doctorId !== ALL ? `الطبيب: ${doctors.find((d) => d.id === doctorId)?.name_ar ?? ""}` : "",
      clinicId !== ALL ? `العيادة: ${clinics.find((c) => c.id === clinicId)?.name ?? ""}` : "",
      statusKey !== ALL ? `الحالة: ${STATUS_GROUPS.find((g) => g.key === statusKey)?.label ?? ""}` : "",
      visitTypeId !== ALL ? `نوع الزيارة: ${visitTypeName.get(visitTypeId) ?? ""}` : "",
      waiting !== "all" ? (waiting === "only" ? "الانتظار فقط" : "بلا انتظار") : "",
      earlier !== "all" ? (earlier === "only" ? "التقريب فقط" : "بلا تقريب") : "",
      source !== "all" ? (source === "online" ? "الموقع فقط" : "الاستقبال فقط") : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const print = () => {
    const body = groups
      .map(
        ([doctor, list]) =>
          `<h3>د. ${escapeHtml(doctor)} — ${list.length} موعد</h3>` +
          `<table border="1" cellspacing="0" cellpadding="4" style="width:100%;border-collapse:collapse;font-size:11px">` +
          `<thead><tr>${["التاريخ", "الوقت", "الملف", "المريض", "الجوال", "الحالة", "نوع الزيارة", "الخدمة", "ملاحظة"]
            .map((h) => `<th>${h}</th>`)
            .join("")}</tr></thead><tbody>` +
          list
            .map((r) => {
              const cells = [0, 1, 3, 4, 6, 11, 13, 14, 22].map((i) => columns[i].cell(r));
              return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
            })
            .join("") +
          `</tbody></table>`,
      )
      .join("");
    const footer = counters.map((c) => `${c.label}: ${c.value}`).join(" · ");
    printHtml(
      "جدول المواعيد",
      `<h2>جدول المواعيد</h2><p>${escapeHtml(filterSummary())}</p>${body}<p><b>${escapeHtml(footer)}</b></p>`,
    );
  };

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["الطبيب", ...columns.map((c) => c.head)].map(esc).join(","),
      ...rows.map((r) => [r.doctor?.name_ar ?? "", ...columns.map((c) => c.cell(r))].map(esc).join(",")),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appointments-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tri = (value: TriState, set: (v: TriState) => void, labelsAr: [string, string, string]) => (
    <Select value={value} onValueChange={(v) => set(v as TriState)}>
      <SelectTrigger className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{labelsAr[0]}</SelectItem>
        <SelectItem value="only">{labelsAr[1]}</SelectItem>
        <SelectItem value="hide">{labelsAr[2]}</SelectItem>
      </SelectContent>
    </Select>
  );

  const capped = (result.data?.count ?? 0) > (result.data?.rows.length ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[95vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            البحث والطباعة — جدول المواعيد
          </DialogTitle>
          <DialogDescription>مجمّعٌ حسب الطبيب. المرشّحات تُطبَّق في القاعدة، والعدّادات أسفله لما عُرض.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" className="h-8" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">المريض (اسم، ملف، جوال، هوية)</Label>
            <Input className="h-8" value={patientText} onChange={(e) => setPatientText(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الطبيب</Label>
            <Select value={scopedDoctorId ?? doctorId} onValueChange={setDoctorId} disabled={Boolean(scopedDoctorId)}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الأطباء</SelectItem>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">العيادة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل العيادات</SelectItem>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">المستخدم (من أدخل)</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل المستخدمين</SelectItem>
                {[...(memberNames.data?.entries() ?? [])].map(([id, n]) => (
                  <SelectItem key={id} value={id}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">حالة الموعد</Label>
            <Select value={statusKey} onValueChange={setStatusKey}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الحالات</SelectItem>
                {STATUS_GROUPS.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">نوع الزيارة</Label>
            <Select value={visitTypeId} onValueChange={setVisitTypeId}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الأنواع</SelectItem>
                {(visitTypes.data ?? []).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">مرضى الانتظار</Label>
            {tri(waiting, setWaiting, ["الانتظار مع الكل", "الانتظار فقط", "إخفاء الانتظار"])}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">مرضى التقريب</Label>
            {tri(earlier, setEarlier, ["التقريب مع الكل", "التقريب فقط", "إخفاء التقريب"])}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">مصدر الموعد</Label>
            <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="offline">الاستقبال (أوفلاين)</SelectItem>
                <SelectItem value="online">الموقع (أونلاين)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-1">
            <Button size="sm" variant="outline" className="h-8" onClick={reset} title="إعادة الضبط">
              <RotateCcw className="h-3.5 w-3.5" />
              إعادة الضبط
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => result.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={print}>
            <Printer className="h-3.5 w-3.5" />
            طباعة المواعيد
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" />
            تصدير الجدول
          </Button>
          {capped && (
            <span className="flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              معروض {result.data?.rows.length} من {result.data?.count} — ضيّق الفترة
            </span>
          )}
        </div>

        {result.isLoading && <Skeleton className="h-60 w-full" />}
        {result.isError && <p className="text-sm text-destructive">تعذّر البحث: {errorMessage(result.error)}</p>}

        {!result.isLoading && !result.isError && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.head} className="whitespace-nowrap text-xs">
                      {c.head}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(([doctor, list]) => (
                  <GroupRows
                    key={doctor}
                    doctor={doctor}
                    list={list}
                    columns={columns}
                    span={columns.length}
                    onOpen={(id) => {
                      onOpenChange(false);
                      onOpenAppointment(id);
                    }}
                  />
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                      لا مواعيد مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          {counters.map((c) => (
            <div key={c.label} className="rounded-md border px-3 py-1.5">
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className="font-mono text-base font-bold tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupRows({
  doctor,
  list,
  columns,
  span,
  onOpen,
}: {
  doctor: string;
  list: Row[];
  columns: { head: string; cell: (row: Row) => string }[];
  span: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <TableRow className="bg-primary/5 hover:bg-primary/5">
        <TableCell colSpan={span} className="py-1.5 text-sm font-semibold">
          اسم الطبيب: د. {doctor} <Badge variant="outline" className="ms-2">{list.length}</Badge>
        </TableCell>
      </TableRow>
      {list.map((row) => (
        <TableRow key={row.id} className="cursor-pointer" onDoubleClick={() => onOpen(row.id)} title="نقرتان لفتح الموعد">
          {columns.map((c) => (
            <TableCell key={c.head} className="whitespace-nowrap py-1.5 text-xs">
              {c.cell(row)}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

