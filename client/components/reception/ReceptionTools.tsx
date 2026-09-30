import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { localDayRange } from "@/lib/date-range";
import { formatDate, formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import type { AppointmentStatus } from "@/lib/database.types";
import { printHtml } from "@/lib/document-merge";
import { errorMessage } from "@/lib/error-message";
import { useLookupTree } from "@/components/shared/LookupTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * أدوات «نظام الدور» كما في Kizen: الموجودون الآن، وتقرير الدخول إلى
 * العيادات، وإحصائيات الدور. كلّها قراءةٌ من `appointments` بطوابعها التي
 * تكتبها `app_reception_transition` (وصل `checked_in_1_at`، نداء `called_at`،
 * دخل `entered_at`، خرج `left_at`) — لا جدول جديد ولا حسابٌ مخزَّن.
 */

type QueueRow = {
  id: string;
  queue_number: number | null;
  note: string | null;
  status: AppointmentStatus;
  scheduled_start: string;
  checked_in_1_at: string | null;
  called_at: string | null;
  entered_at: string | null;
  left_at: string | null;
  visit_type_value_id: string | null;
  doctor_id: string;
  clinic_id: string | null;
  patient: { id: string; name_ar: string; file_number: number | string | null; mobile_number: string | null } | null;
  doctor: { id: string; name_ar: string } | null;
  clinic: { id: string; name: string } | null;
};

const QUEUE_SELECT =
  "id, queue_number, note, status, scheduled_start, checked_in_1_at, called_at, entered_at, left_at, visit_type_value_id, doctor_id, clinic_id, " +
  "patient:patients!appointments_patient_tenant_fk(id, name_ar, file_number, mobile_number), " +
  "doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name)";

/** سقفٌ معلن: تقريرٌ مقصوص بصمت يُقرأ كأنّه كامل. */
const ROW_LIMIT = 3000;
const ALL = "__all__";

const minutesBetween = (from: string | null, to: string | null | Date) => {
  if (!from || !to) return null;
  const end = to instanceof Date ? to : new Date(to);
  const minutes = Math.round((end.getTime() - new Date(from).getTime()) / 60_000);
  return minutes >= 0 ? minutes : null;
};

const average = (values: (number | null)[]) => {
  const list = values.filter((value): value is number => value != null);
  if (list.length === 0) return null;
  return Math.round(list.reduce((sum, value) => sum + value, 0) / list.length);
};

const minutesLabel = (value: number | null) => (value == null ? "—" : `${value} د`);

const esc = (value: unknown) =>
  String(value ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function useVisitTypeNames() {
  const nodes = useLookupTree("visit_types");
  return useMemo(() => {
    const map = new Map<string, string>();
    (nodes.data ?? []).forEach((node) => map.set(node.id, node.name_ar));
    return map;
  }, [nodes.data]);
}

/** مرشّح الطبيب والعيادة — مشترك بين التقرير والإحصائيات. */
function ScopeFilters({
  doctors,
  clinics,
  doctorId,
  clinicId,
  onDoctor,
  onClinic,
}: {
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  doctorId: string;
  clinicId: string;
  onDoctor: (value: string) => void;
  onClinic: (value: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">الطبيب</Label>
        <Select value={doctorId} onValueChange={onDoctor}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الأطباء</SelectItem>
            {doctors.map((doctor) => (
              <SelectItem key={doctor.id} value={doctor.id}>
                د. {doctor.name_ar}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">العيادة</Label>
        <Select value={clinicId} onValueChange={onClinic}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل العيادات</SelectItem>
            {clinics.map((clinic) => (
              <SelectItem key={clinic.id} value={clinic.id}>
                {clinic.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

/**
 * من وصل في الفترة (طابور تلك الأيام) — أساس كشف الدخول والإحصائيات. كشف
 * Kizen يعدّ المدخلين وغير المدخلين، فيبدأ من الوصول لا من الدخول.
 */
function useArrivedRows(
  organizationId: string | undefined,
  open: boolean,
  from: string,
  to: string,
  doctorId: string,
  clinicId: string,
  key: string,
) {
  return useQuery({
    queryKey: ["reception-tools", key, organizationId, from, to, doctorId, clinicId],
    enabled: open && Boolean(organizationId && from && to),
    queryFn: async () => {
      const bounds = localDayRange(from, to);
      let query = supabase
        .from("appointments")
        .select(QUEUE_SELECT, { count: "exact" })
        .eq("organization_id", organizationId)
        .gte("checked_in_1_at", bounds.from!)
        .lte("checked_in_1_at", bounds.to!);
      if (doctorId !== ALL) query = query.eq("doctor_id", doctorId);
      if (clinicId !== ALL) query = query.eq("clinic_id", clinicId);
      const { data, error, count } = await query.order("checked_in_1_at").limit(ROW_LIMIT);
      if (error) throw error;
      const rows = (data ?? []) as unknown as QueueRow[];
      return { rows, total: count ?? rows.length };
    },
  });
}

/* ═══════════════════════════════════════════════════════════ الموجودون الآن */

/**
 * «الموجودون الآن» — من وصل اليوم ولم يخرج: ينتظر، أو نودي، أو داخل الكشف،
 * بمدّة انتظاره أو جلوسه حتى اللحظة. يتحدّث كلّ نصف دقيقة.
 */
export function PresentNowDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { calendarDisplay } = useLocaleSettings();
  const visitTypes = useVisitTypeNames();
  const present = useQuery({
    queryKey: ["reception-tools", "present", organizationId],
    enabled: open && Boolean(organizationId),
    refetchInterval: open ? 30_000 : false,
    queryFn: async () => {
      const bounds = localDayRange(todayKey(), todayKey());
      const { data, error } = await supabase
        .from("appointments")
        .select(QUEUE_SELECT)
        .eq("organization_id", organizationId)
        .gte("checked_in_1_at", bounds.from!)
        .lte("checked_in_1_at", bounds.to!)
        .is("left_at", null)
        .in("status", ["arrived", "checked_in", "called", "in_progress", "waiting", "walk_in"])
        .order("checked_in_1_at")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as QueueRow[];
    },
  });

  const now = new Date();
  const rows = present.data ?? [];
  const inside = rows.filter((row) => row.status === "in_progress").length;

  const print = () =>
    printHtml(
      "الموجودون الآن",
      `<h2 style="margin:0 0 4px">الموجودون الآن</h2>
       <p style="margin:0 0 8px;font-size:11px;color:#555">${esc(formatDateTime(now, calendarDisplay))} · ${rows.length} مريض · داخل الكشف ${inside}</p>
       <table><thead><tr><th>العيادة</th><th>الطبيب</th><th>الرقم</th><th>المريض</th><th>الملف</th><th>وصل</th><th>نودي</th><th>دخل</th>
         <th>الحالة</th><th>المدّة</th><th>الزيارة</th><th>الملاحظة</th></tr></thead><tbody>
       ${rows
         .map(
           (row) => `<tr><td>${esc(row.clinic?.name)}</td><td>${esc(row.doctor?.name_ar)}</td><td>${esc(row.queue_number)}</td>
             <td>${esc(row.patient?.name_ar)}</td><td>${esc(row.patient?.file_number)}</td>
             <td>${esc(formatTime(row.checked_in_1_at))}</td><td>${esc(formatTime(row.called_at))}</td><td>${esc(formatTime(row.entered_at))}</td>
             <td>${esc(statusLabel(row.status))}</td>
             <td>${esc(minutesLabel(minutesBetween(row.entered_at ?? row.checked_in_1_at, now)))}</td>
             <td>${esc(row.visit_type_value_id ? visitTypes.get(row.visit_type_value_id) : "")}</td><td>${esc(row.note)}</td></tr>`,
         )
         .join("")}
       </tbody></table>`,
      "a4",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>الموجودون الآن</DialogTitle>
          <DialogDescription>
            من وصل اليوم ولم يخرج بعد — المدّة انتظارٌ منذ الوصول، أو جلوسٌ منذ الدخول لمن هو داخل الكشف.
          </DialogDescription>
        </DialogHeader>
        {present.isLoading && <Skeleton className="h-40 w-full" />}
        {present.isError && <p className="text-sm text-destructive">تعذّرت القراءة: {errorMessage(present.error)}</p>}
        {!present.isLoading && !present.isError && (
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>الرقم</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>الملف</TableHead>
                  <TableHead>وصل</TableHead>
                  <TableHead>نودي</TableHead>
                  <TableHead>دخل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المدّة</TableHead>
                  <TableHead>الزيارة</TableHead>
                  <TableHead>الملاحظة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.clinic?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.queue_number ?? "—"}</TableCell>
                    <TableCell className="font-medium">{row.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.file_number ?? "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.checked_in_1_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.called_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.entered_at)}</TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(row.status)}>{statusLabel(row.status)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {minutesLabel(minutesBetween(row.entered_at ?? row.checked_in_1_at, now))}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.visit_type_value_id ? visitTypes.get(row.visit_type_value_id) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs">{row.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                      لا أحد في المنشأة الآن.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter className="flex-wrap items-center gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            العدد <b className="font-mono">{rows.length}</b> · داخل الكشف <b className="font-mono">{inside}</b> · ينتظرون{" "}
            <b className="font-mono">{rows.length - inside}</b>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={rows.length === 0} onClick={print}>
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════ تقرير الدخول إلى العيادات */

export function ClinicEntryReportDialog({
  organizationId,
  open,
  onOpenChange,
  doctors,
  clinics,
}: {
  organizationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
}) {
  const { calendarDisplay } = useLocaleSettings();
  const visitTypes = useVisitTypeNames();
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const [doctorId, setDoctorId] = useState(ALL);
  const [clinicId, setClinicId] = useState(ALL);
  const report = useArrivedRows(organizationId, open, from, to, doctorId, clinicId, "entries");
  const rows = report.data?.rows ?? [];
  const capped = (report.data?.total ?? 0) > rows.length;

  const waits = rows.map((row) => minutesBetween(row.checked_in_1_at, row.entered_at));
  const sittings = rows.map((row) => minutesBetween(row.entered_at, row.left_at));
  const entered = rows.filter((row) => row.entered_at).length;
  const footer = {
    count: rows.length,
    entered,
    notEntered: rows.length - entered,
    avgWait: average(waits),
    avgSitting: average(sittings),
  };

  const print = () =>
    printHtml(
      "تقرير الدخول إلى العيادات",
      `<h2 style="margin:0 0 4px">تقرير الدخول إلى العيادات</h2>
       <p style="margin:0 0 8px;font-size:11px;color:#555">من ${esc(from)} إلى ${esc(to)}
         ${doctorId !== ALL ? ` · د. ${esc(doctors.find((d) => d.id === doctorId)?.name_ar)}` : ""}
         ${clinicId !== ALL ? ` · ${esc(clinics.find((c) => c.id === clinicId)?.name)}` : ""}</p>
       <table><thead><tr><th>التاريخ</th><th>الملف</th><th>المريض</th><th>الطبيب</th><th>العيادة</th><th>نوع الزيارة</th>
         <th>وصل</th><th>نودي</th><th>دخل</th><th>خرج</th><th>الانتظار</th><th>الجلوس</th></tr></thead><tbody>
       ${rows
         .map(
           (row, index) => `<tr><td>${esc(formatDate(row.checked_in_1_at, calendarDisplay))}</td><td>${esc(row.patient?.file_number)}</td>
             <td>${esc(row.patient?.name_ar)}</td><td>${esc(row.doctor?.name_ar)}</td><td>${esc(row.clinic?.name)}</td>
             <td>${esc(row.visit_type_value_id ? visitTypes.get(row.visit_type_value_id) : "")}</td>
             <td>${esc(formatTime(row.checked_in_1_at))}</td><td>${esc(formatTime(row.called_at))}</td>
             <td>${esc(formatTime(row.entered_at))}</td><td>${esc(formatTime(row.left_at))}</td>
             <td>${esc(minutesLabel(waits[index]))}</td><td>${esc(minutesLabel(sittings[index]))}</td></tr>`,
         )
         .join("")}
       </tbody></table>
       <p style="margin-top:8px;font-size:11px">إجمالي العدد ${footer.count} · المدخلون ${footer.entered} · غير المدخلين ${footer.notEntered}
         · متوسّط الانتظار ${esc(minutesLabel(footer.avgWait))} · متوسّط الجلوس ${esc(minutesLabel(footer.avgSitting))}</p>`,
      "a4",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>كشف الدخول إلى العيادات</DialogTitle>
          <DialogDescription>
            كلّ من وصل في الفترة بطوابع الدور: الانتظار من الوصول إلى الدخول، والجلوس من الدخول إلى الخروج.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(event) => event.target.value && setTo(event.target.value)} />
          </div>
          <ScopeFilters
            doctors={doctors}
            clinics={clinics}
            doctorId={doctorId}
            clinicId={clinicId}
            onDoctor={setDoctorId}
            onClinic={setClinicId}
          />
        </div>
        {capped && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            معروض {rows.length} من {report.data?.total} — ضيّق الفترة لقراءة التقرير كاملًا.
          </p>
        )}
        {report.isLoading && <Skeleton className="h-48 w-full" />}
        {report.isError && <p className="text-sm text-destructive">تعذّرت القراءة: {errorMessage(report.error)}</p>}
        {!report.isLoading && !report.isError && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الملف</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>نوع الزيارة</TableHead>
                  <TableHead>وصل</TableHead>
                  <TableHead>نودي</TableHead>
                  <TableHead>دخل</TableHead>
                  <TableHead>خرج</TableHead>
                  <TableHead>الانتظار</TableHead>
                  <TableHead>الجلوس</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(row.checked_in_1_at, calendarDisplay)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.file_number ?? "—"}</TableCell>
                    <TableCell className="font-medium">{row.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.clinic?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {row.visit_type_value_id ? visitTypes.get(row.visit_type_value_id) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.checked_in_1_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.called_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.entered_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{formatTime(row.left_at)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{minutesLabel(waits[index])}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{minutesLabel(sittings[index])}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                      لم يصل أحدٌ في هذه الفترة بهذا الترشيح.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter className="flex-wrap items-center gap-3 sm:justify-between">
          <span className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>إجمالي العدد <b className="font-mono">{footer.count}</b></span>
            <span>المدخلون <b className="font-mono">{footer.entered}</b></span>
            <span>غير المدخلين <b className="font-mono">{footer.notEntered}</b></span>
            <span>متوسّط الانتظار <b className="font-mono">{minutesLabel(footer.avgWait)}</b></span>
            <span>متوسّط الجلوس <b className="font-mono">{minutesLabel(footer.avgSitting)}</b></span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={rows.length === 0} onClick={print}>
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════ إحصائيات الدور */

/**
 * إحصائيات الدور: متوسّط الانتظار والجلوس لكلّ طبيب وللمركز، وعدد المرضى
 * بنوع الزيارة — من طوابع الدور نفسها في الفترة المختارة.
 */
export function QueueStatsDialog({
  organizationId,
  open,
  onOpenChange,
  doctors,
  clinics,
}: {
  organizationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
}) {
  const visitTypes = useVisitTypeNames();
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const [doctorId, setDoctorId] = useState(ALL);
  const [clinicId, setClinicId] = useState(ALL);
  const report = useArrivedRows(organizationId, open, from, to, doctorId, clinicId, "stats");
  const rows = report.data?.rows ?? [];
  const capped = (report.data?.total ?? 0) > rows.length;

  const byDoctor = useMemo(() => {
    const map = new Map<string, { name: string; rows: QueueRow[] }>();
    rows.forEach((row) => {
      const entry = map.get(row.doctor_id) ?? { name: row.doctor?.name_ar ?? "—", rows: [] };
      entry.rows.push(row);
      map.set(row.doctor_id, entry);
    });
    return [...map.values()]
      .map((entry) => ({
        name: entry.name,
        count: entry.rows.filter((row) => row.entered_at).length,
        avgWait: average(entry.rows.map((row) => minutesBetween(row.checked_in_1_at, row.entered_at))),
        avgSitting: average(entry.rows.map((row) => minutesBetween(row.entered_at, row.left_at))),
      }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const center = {
    count: rows.filter((row) => row.entered_at).length,
    avgWait: average(rows.map((row) => minutesBetween(row.checked_in_1_at, row.entered_at))),
    avgSitting: average(rows.map((row) => minutesBetween(row.entered_at, row.left_at))),
  };

  const byVisitType = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const name = row.visit_type_value_id ? visitTypes.get(row.visit_type_value_id) ?? "نوع غير معروف" : "بلا نوع زيارة";
      map.set(name, (map.get(name) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, visitTypes]);

  const print = () =>
    printHtml(
      "إحصائيات الدور",
      `<h2 style="margin:0 0 4px">إحصائيات الدور</h2>
       <p style="margin:0 0 8px;font-size:11px;color:#555">من ${esc(from)} إلى ${esc(to)}</p>
       <table><thead><tr><th>الطبيب</th><th>دخلوا</th><th>متوسّط الانتظار</th><th>متوسّط الجلوس</th></tr></thead><tbody>
       ${byDoctor
         .map(
           (entry) =>
             `<tr><td>${esc(entry.name)}</td><td>${entry.count}</td><td>${esc(minutesLabel(entry.avgWait))}</td><td>${esc(minutesLabel(entry.avgSitting))}</td></tr>`,
         )
         .join("")}
       <tr style="font-weight:bold"><td>المركز</td><td>${center.count}</td><td>${esc(minutesLabel(center.avgWait))}</td><td>${esc(minutesLabel(center.avgSitting))}</td></tr>
       </tbody></table>
       <h3 style="margin:12px 0 4px">المرضى بنوع الزيارة</h3>
       <table><thead><tr><th>نوع الزيارة</th><th>العدد</th></tr></thead><tbody>
       ${byVisitType.map(([name, count]) => `<tr><td>${esc(name)}</td><td>${count}</td></tr>`).join("")}
       </tbody></table>`,
      "a4",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>إحصائيات الدور</DialogTitle>
          <DialogDescription>
            متوسّط وقت الانتظار (من الوصول إلى الدخول) والجلوس (من الدخول إلى الخروج) لكلّ طبيب وللمركز،
            وعدد المرضى بنوع الزيارة.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(event) => event.target.value && setTo(event.target.value)} />
          </div>
          <ScopeFilters
            doctors={doctors}
            clinics={clinics}
            doctorId={doctorId}
            clinicId={clinicId}
            onDoctor={setDoctorId}
            onClinic={setClinicId}
          />
        </div>
        {capped && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            محسوبة على أوّل {rows.length} من {report.data?.total} — ضيّق الفترة لإحصاءٍ كامل.
          </p>
        )}
        {report.isLoading && <Skeleton className="h-40 w-full" />}
        {report.isError && <p className="text-sm text-destructive">تعذّرت القراءة: {errorMessage(report.error)}</p>}
        {!report.isLoading && !report.isError && (
          <div className="grid max-h-[55vh] gap-3 overflow-auto md:grid-cols-5">
            <div className="rounded-md border md:col-span-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الطبيب</TableHead>
                    <TableHead>دخلوا</TableHead>
                    <TableHead>متوسّط الانتظار</TableHead>
                    <TableHead>متوسّط الجلوس</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byDoctor.map((entry) => (
                    <TableRow key={entry.name}>
                      <TableCell className="text-sm">{entry.name}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.count}</TableCell>
                      <TableCell className="font-mono text-xs">{minutesLabel(entry.avgWait)}</TableCell>
                      <TableCell className="font-mono text-xs">{minutesLabel(entry.avgSitting)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>المركز</TableCell>
                    <TableCell className="font-mono text-xs">{center.count}</TableCell>
                    <TableCell className="font-mono text-xs">{minutesLabel(center.avgWait)}</TableCell>
                    <TableCell className="font-mono text-xs">{minutesLabel(center.avgSitting)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="rounded-md border md:col-span-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نوع الزيارة</TableHead>
                    <TableHead>المرضى</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byVisitType.map(([name, count]) => (
                    <TableRow key={name}>
                      <TableCell className="text-sm">{name}</TableCell>
                      <TableCell className="font-mono text-xs">{count}</TableCell>
                    </TableRow>
                  ))}
                  {byVisitType.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="py-6 text-center text-xs text-muted-foreground">
                        لا وصول في الفترة.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={rows.length === 0} onClick={print}>
            <Printer className="h-4 w-4" />
            طباعة
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

