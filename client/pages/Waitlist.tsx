import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Check, Edit3, Printer, RefreshCw, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { checkDoctorAvailability } from "@/lib/doctor-availability";
import type { AppointmentWaitlistRow, WaitlistStatus } from "@/lib/database.types";
import { PatientSearchInput } from "@/components/shared/PatientSearchInput";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";
import { matchesPatientSearch, type PatientSearchScope } from "@/lib/patient-search";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import { errorMessage } from "@/lib/error-message";
import { formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
import { useMemberNames } from "@/lib/member-names";
import { printHtml } from "@/lib/document-merge";
import { APPOINTMENT_QUERY_KEYS } from "@/lib/appointment-extras";

/**
 * قوائم الانتظار (لقطة 102).
 *
 * جدول `appointment_waitlist` موجود منذ 0002 بحالاته الثلاث
 * (waiting/booked/cancelled) لكنه لم يُستخدم في أي شاشة إطلاقًا — الميزة
 * كانت بنية بيانات بلا واجهة. تسجّل هذه الشاشة المريض في قائمة انتظار طبيب
 * أو تخصص، ثم تُحوّله إلى موعد فعلي عند توفر شاغر.
 */
const STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: "بالانتظار",
  booked: "تم الحجز",
  cancelled: "ملغاة",
};
const STATUS_BADGE: Record<WaitlistStatus, "warning" | "success" | "secondary"> = {
  waiting: "warning",
  booked: "success",
  cancelled: "secondary",
};
const ANY_DOCTOR = "__any__";

/**
 * الأولوية والتاريخ المرغوب كانا يُحفظان ولا يُعرضان.
 *
 * الموظف يختار «طارئ» ويحدّد تاريخًا، ثم يرى صفوفًا متشابهة مرتَّبة بالأقدمية
 * وحدها — فيتعذّر معرفة مَن يُقدَّم عند توفّر شاغر إلا بفتح كل صفّ. الترتيب
 * هنا بالأولوية ثم الأقدمية، كترتيب طابور الاستقبال نفسه، حتى لا يكون لنفس
 * السؤال جوابان في شاشتين.
 */
const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  accessibility: 2,
  elderly: 3,
  normal: 4,
};

const PRIORITY_LABELS: Record<string, string> = {
  emergency: "طارئ",
  urgent: "عاجل",
  accessibility: "ذوو الإعاقة",
  elderly: "كبار السن",
  normal: "عادي",
};

type WaitlistRowJoined = AppointmentWaitlistRow & {
  patient: { id: string; name_ar: string; file_number: number | null; mobile_number: string | null } | null;
  doctor: { id: string; name_ar: string } | null;
  /** 0197: رقم الحجز المتسلسل في المنشأة، وسبب الإلغاء ومن ألغى ومتى. */
  booking_number?: number | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  specialty?: { id: string; name_ar: string } | null;
  appointment?: { id: string; scheduled_start: string; status: string } | null;
};

const ALL = "__all__";

const escapeHtml = (value: unknown) =>
  String(value ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function useWaitlist(organizationId: string | undefined, status: string) {
  return useQuery({
    queryKey: ["waitlist", organizationId, status],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("appointment_waitlist")
        .select(
          "*, patient:patients!waitlist_patient_tenant_fk(id, name_ar, file_number, mobile_number, id_number, phone_1), doctor:doctors!waitlist_doctor_tenant_fk(id, name_ar), " +
            "specialty:lookup_values!appointment_waitlist_specialty_value_id_fkey(id, name_ar), " +
            "appointment:appointments!appointment_waitlist_appointment_id_fkey(id, scheduled_start, status)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as WaitlistRowJoined[];
      // الترتيب بالأولوية يجري بعد الجلب: قيم `priority` نصّية، وترتيبها في
      // القاعدة أبجديٌّ يضع «عادي» قبل «طارئ».
      return [...rows].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority ?? "normal"] ?? 4) - (PRIORITY_ORDER[b.priority ?? "normal"] ?? 4) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    },
  });
}

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-waitlist", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // عمود التفعيل في `doctors` اسمه `is_enabled` لا `is_disabled` (0002).
        // الاستعلام القديم كان يفشل كليًا فتبقى قائمة الأطباء فارغة دائمًا.
        .eq("is_enabled", true)
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

function AddToWaitlistDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const doctors = useDoctors(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState(ANY_DOCTOR);
  const [specialtyId, setSpecialtyId] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!patient) throw new Error("اختر المريض أولًا");
      const { data, error } = await supabase.from("appointment_waitlist").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        doctor_id: doctorId === ANY_DOCTOR ? null : doctorId,
        specialty_value_id: specialtyId || null,
        registration_note: note.trim() || null,
        desired_date: desiredDate || null,
        priority,
        status: "waiting" as const,
        created_by: session?.user.id ?? null,
      })
        .select("*")
        .single();
      if (error) throw error;
      // رقم الحجز يعطيه مُحفِّز القاعدة (0197) — يُبلَّغ للمريض كما في Kizen
      return (data as { booking_number?: number | null } | null)?.booking_number ?? null;
    },
    onSuccess: (bookingNumber) => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({
        title: "تمت إضافة المريض لقائمة انتظار المواعيد",
        description: bookingNumber ? `رقم الحجز ${bookingNumber}` : undefined,
      });
      setPatient(null);
      setDoctorId(ANY_DOCTOR);
      setSpecialtyId("");
      setDesiredDate("");
      setPriority("normal");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة لقائمة انتظار المواعيد</DialogTitle>
          <DialogDescription>
            يُسجَّل المريض بانتظار شاغر لدى طبيب معيّن أو ضمن تخصص، ويمكن تحويله لموعد لاحقًا
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض *</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium">{patient.name_ar}</span>
                <Button variant="ghost" size="sm" onClick={() => setPatient(null)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <PatientPicker onSelect={(row) => setPatient({ id: row.id, name_ar: row.name_ar })} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب المطلوب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="أي طبيب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_DOCTOR}>أي طبيب</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect
              categoryKey="medical_specialties"
              value={specialtyId}
              onChange={setSpecialtyId}
              placeholder="اختياري"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><Label>التاريخ المرغوب</Label><Input type="date" value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">عادي</SelectItem><SelectItem value="urgent">عاجل</SelectItem><SelectItem value="emergency">طارئ</SelectItem><SelectItem value="elderly">كبار السن</SelectItem><SelectItem value="accessibility">ذوو الإعاقة</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة التسجيل</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "إضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Waitlist() {
  const { calendarDisplay } = useLocaleSettings();
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const [status, setStatus] = useState("waiting");
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<WaitlistRowJoined | null>(null);
  const [editTarget, setEditTarget] = useState<WaitlistRowJoined | null>(null);
  const [cancelTarget, setCancelTarget] = useState<WaitlistRowJoined | null>(null);
  /** مرشّحات Kizen: فترة التسجيل، والتخصّص، والطبيب، ومدى رقم الحجز. */
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [doctorFilter, setDoctorFilter] = useState(ALL);
  const [numberFrom, setNumberFrom] = useState("");
  const [numberTo, setNumberTo] = useState("");
  const canManageWaitlist = legacyMode || ["owner", "organization_admin", "branch_manager", "receptionist"].includes(membership?.role_key ?? "");
  const list = useWaitlist(organization?.id, status);
  const doctors = useDoctors(organization?.id);
  const memberNames = useMemberNames(organization?.id);

  // الترشيح مرّة واحدة: الشبكة والعدّاد والطباعة تقرأ القائمة نفسها فلا تختلف
  const visibleWaitlist = (list.data ?? []).filter((row) => {
    if (!matchesPatientSearch(row.patient, search, searchScopes)) return false;
    const registered = new Date(row.created_at).toLocaleDateString("en-CA");
    if (from && registered < from) return false;
    if (to && registered > to) return false;
    if (specialtyId && row.specialty_value_id !== specialtyId) return false;
    if (doctorFilter !== ALL && (row.doctor_id ?? "") !== doctorFilter) return false;
    const number = row.booking_number ?? null;
    if (numberFrom && (number == null || number < Number(numberFrom))) return false;
    if (numberTo && (number == null || number > Number(numberTo))) return false;
    return true;
  });
  const filtersActive = Boolean(from || to || specialtyId || doctorFilter !== ALL || numberFrom || numberTo);

  /**
   * التسلسل: موقع المريض في دور تخصّصه — من ينتظر وحده، بترتيب القائمة
   * (الأولوية ثمّ الأسبقية). «رقم الحجز» ثابتٌ يُبلَّغ للمريض، والتسلسل يتغيّر
   * كلّما حُجز لمن قبله.
   */
  const sequence = new Map<string, number>();
  const counters = new Map<string, number>();
  (list.data ?? []).forEach((row) => {
    if (row.status !== "waiting") return;
    const key = row.specialty_value_id ?? row.doctor_id ?? "";
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    sequence.set(row.id, next);
  });

  const printList = () => {
    const rows = visibleWaitlist
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.booking_number)}</td>
          <td>${escapeHtml(sequence.get(row.id) ?? "")}</td>
          <td>${escapeHtml(row.patient?.file_number)}</td>
          <td>${escapeHtml(row.patient?.name_ar)}</td>
          <td>${escapeHtml(row.patient?.mobile_number)}</td>
          <td>${escapeHtml(row.specialty?.name_ar)}</td>
          <td>${escapeHtml(row.doctor?.name_ar ?? "أي طبيب")}</td>
          <td>${escapeHtml(PRIORITY_LABELS[row.priority ?? "normal"] ?? row.priority)}</td>
          <td>${escapeHtml(formatDate(row.desired_date, calendarDisplay))}</td>
          <td>${escapeHtml(formatDate(row.created_at, calendarDisplay))}</td>
          <td>${escapeHtml(row.created_by ? memberNames.data?.get(row.created_by) : "")}</td>
          <td>${escapeHtml(STATUS_LABELS[row.status])}</td>
          <td>${escapeHtml(row.status === "cancelled" ? row.cancel_reason : row.registration_note)}</td>
        </tr>`,
      )
      .join("");
    printHtml(
      "قائمة انتظار المواعيد",
      `<h2 style="margin:0 0 4px">قائمة انتظار المواعيد</h2>
       <p style="margin:0 0 8px;font-size:11px;color:#555">
         ${escapeHtml(STATUS_TABS.find((tab) => tab.key === status)?.label)}
         ${from || to ? ` · التسجيل من ${escapeHtml(from || "—")} إلى ${escapeHtml(to || "—")}` : ""}
         · العدد ${visibleWaitlist.length}
       </p>
       <table><thead><tr>
         <th>رقم الحجز</th><th>التسلسل</th><th>الملف</th><th>المريض</th><th>الجوال</th><th>التخصص</th>
         <th>الطبيب</th><th>الأولوية</th><th>المرغوب</th><th>التسجيل</th><th>سجّله</th><th>الحالة</th><th>ملاحظة / سبب الإلغاء</th>
       </tr></thead><tbody>${rows}</tbody></table>`,
      "a4",
    );
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">قائمة انتظار المواعيد</h1>
          <p className="text-sm text-muted-foreground">
            مرضى يريدون موعدًا ولم يجدوا وقتًا — يُحوَّلون إلى مواعيد عند توفّر شاغر. ليست طابور
            اليوم: من حضر اليوم مكانه «الاستقبال».
          </p>
        </div>
      </div>

      <ScreenToolbar
        items={[
          {
            key: "new",
            label: "إضافة للانتظار",
            icon: Plus,
            hidden: !canManageWaitlist,
            onClick: () => setAddOpen(true),
          },
          { key: "sep1", separator: true },
          { key: "print", label: "طباعة القائمة", icon: Printer, onClick: printList },
          { key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void list.refetch() },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <PatientSearchInput
          value={search}
          onChange={setSearch}
          scopes={searchScopes}
          onScopesChange={setSearchScopes}
          className="w-full sm:w-auto"
          inputClassName="sm:w-64"
        />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">سُجّل من</Label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">التخصص</Label>
            <LookupSelect
              categoryKey="medical_specialties"
              value={specialtyId}
              onChange={setSpecialtyId}
              allowClear
              clearLabel="كل التخصصات"
              placeholder="كل التخصصات"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الطبيب</Label>
            <Select value={doctorFilter} onValueChange={setDoctorFilter}>
              <SelectTrigger>
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
            <Label className="text-xs">رقم الحجز من</Label>
            <Input type="number" min={1} value={numberFrom} onChange={(event) => setNumberFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="number" min={1} value={numberTo} onChange={(event) => setNumberTo(event.target.value)} />
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start sm:col-span-3 lg:col-span-6"
              onClick={() => {
                setFrom("");
                setTo("");
                setSpecialtyId("");
                setDoctorFilter(ALL);
                setNumberFrom("");
                setNumberTo("");
              }}
            >
              <X className="h-3.5 w-3.5" />
              مسح المرشّحات
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            القائمة
          </CardTitle>
          <CardDescription>
            مرتَّبة بالأولوية ثم أسبقية التسجيل — كترتيب طابور الاستقبال. حجز موعدٍ للمريض عند الطبيب
            أو التخصّص المطلوب يُعلِّم طلبه «تم الحجز» تلقائيًّا ويربطه بالموعد.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {list.isLoading && <Skeleton className="h-40 w-full" />}
          {list.isError && <p className="text-sm text-destructive">تعذّرت القراءة: {errorMessage(list.error)}</p>}
          {!list.isLoading && !list.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">رقم الحجز</TableHead>
                  <TableHead className="whitespace-nowrap">التسلسل</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>رقم الملف</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>التخصص</TableHead>
                  <TableHead>الطبيب المطلوب</TableHead>
                  <TableHead>الأولوية</TableHead>
                  <TableHead>التاريخ المرغوب</TableHead>
                  <TableHead>تاريخ التسجيل</TableHead>
                  <TableHead>سجّله</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-32">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleWaitlist.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs tabular-nums">{row.booking_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{sequence.get(row.id) ?? "—"}</TableCell>
                    <TableCell className="font-medium">{row.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.file_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.mobile_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.specialty?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.doctor?.name_ar ?? "أي طبيب"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.priority === "emergency"
                            ? "destructive"
                            : row.priority && row.priority !== "normal"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {PRIORITY_LABELS[row.priority ?? "normal"] ?? row.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {formatDate(row.desired_date, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(row.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.created_by ? memberNames.data?.get(row.created_by) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      <span className="line-clamp-2">
                        {row.status === "cancelled" && row.cancel_reason
                          ? `أُلغي: ${row.cancel_reason}`
                          : row.registration_note ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                        {row.status === "booked" && row.appointment && (
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            موعده {formatDateTime(row.appointment.scheduled_start, calendarDisplay)}
                          </span>
                        )}
                        {row.status === "cancelled" && row.cancelled_at && (
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {row.cancelled_by ? memberNames.data?.get(row.cancelled_by) ?? "" : ""}{" "}
                            {formatDate(row.cancelled_at, calendarDisplay)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canManageWaitlist && row.status === "waiting" && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="حجز موعد له"
                            onClick={() => setConvertTarget(row)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" title="تعديل الطلب" onClick={() => setEditTarget(row)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="إلغاء الطلب بسبب"
                            onClick={() => setCancelTarget(row)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {visibleWaitlist.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                      {(list.data ?? []).length === 0 ? "لا يوجد مرضى في هذه القائمة." : "لا نتائج بهذه المرشّحات."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!list.isLoading && <GridFooterCount count={visibleWaitlist.length} />}
      </Card>

      {addOpen && (
        <AddToWaitlistDialog open={addOpen} onOpenChange={setAddOpen} organizationId={organization?.id} />
      )}
      <ConvertWaitlistDialog target={convertTarget} onOpenChange={(open) => { if (!open) setConvertTarget(null); }} organizationId={organization?.id} />
      <EditWaitlistDialog target={editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }} organizationId={organization?.id} />
      <CancelWaitlistDialog target={cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }} />
    </div>
  );
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "waiting", label: "بالانتظار" },
  { key: "booked", label: "تم الحجز" },
  { key: "cancelled", label: "ملغاة" },
  { key: "all", label: "الكل" },
];

/**
 * تعديل طلب الانتظار — الطبيب والتخصّص والتاريخ المرغوب والأولوية والملاحظة.
 * المريض ورقم الحجز لا يتغيّران: طلبٌ لمريضٍ آخر طلبٌ جديد.
 */
function EditWaitlistDialog({
  target,
  onOpenChange,
  organizationId,
}: {
  target: WaitlistRowJoined | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const doctors = useDoctors(organizationId);
  const [doctorId, setDoctorId] = useState(ANY_DOCTOR);
  const [specialtyId, setSpecialtyId] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!target) return;
    setDoctorId(target.doctor_id ?? ANY_DOCTOR);
    setSpecialtyId(target.specialty_value_id ?? "");
    setDesiredDate(target.desired_date ?? "");
    setPriority(target.priority ?? "normal");
    setNote(target.registration_note ?? "");
  }, [target]);

  const save = useMutation({
    mutationFn: async () => {
      if (!target || !organizationId) throw new Error("لا طلب محدَّد");
      const { data, error } = await supabase
        .from("appointment_waitlist")
        .update({
          doctor_id: doctorId === ANY_DOCTOR ? null : doctorId,
          specialty_value_id: specialtyId || null,
          desired_date: desiredDate || null,
          priority,
          registration_note: note.trim() || null,
        })
        .eq("id", target.id)
        .eq("organization_id", organizationId)
        .eq("status", "waiting")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("لم يعد الطلب بالانتظار — حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({ title: "عُدِّل طلب الانتظار" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر التعديل", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            تعديل طلب الانتظار {target?.booking_number ? `رقم ${target.booking_number}` : ""}
          </DialogTitle>
          <DialogDescription>{target?.patient?.name_ar}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب المطلوب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_DOCTOR}>أي طبيب</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect
              categoryKey="medical_specialties"
              value={specialtyId}
              onChange={setSpecialtyId}
              allowClear
              placeholder="اختياري"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ المرغوب</Label>
              <Input type="date" value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة التسجيل</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * إلغاء طلب الانتظار — بسبب مكتوب، ويبقى الطلب في «ملغاة» بسببه ومن ألغاه
 * ومتى (`app_cancel_waitlist_entry`، 0197). لا حذف.
 */
function CancelWaitlistDialog({
  target,
  onOpenChange,
}: {
  target: WaitlistRowJoined | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [target?.id]);

  const cancel = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("لا طلب محدَّد");
      const { error } = await supabase.rpc("app_cancel_waitlist_entry", {
        p_waitlist_id: target.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({ title: "أُلغي طلب الانتظار وحُفظ السبب" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إلغاء طلب الانتظار</DialogTitle>
          <DialogDescription>
            {target?.patient?.name_ar}
            {target?.booking_number ? ` — رقم الحجز ${target.booking_number}` : ""}. يبقى الطلب في «ملغاة» بسببه.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>السبب *</Label>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "جارٍ الإلغاء..." : "إلغاء الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertWaitlistDialog({
  target,
  onOpenChange,
  organizationId,
}: {
  target: WaitlistRowJoined | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const doctors = useDoctors(organizationId);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [clinicId, setClinicId] = useState("none");
  const [visitTypeId, setVisitTypeId] = useState("");
  const [note, setNote] = useState("");
  /* التجاوز يُعاد إلى مغلق مع كل طلب: خيارٌ يبقى مفعَّلًا من تحويلٍ سابق
     يتجاوز الدوام في التالي بلا أن ينتبه أحد. */
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

  const clinics = useQuery({
    queryKey: ["waitlist-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name")
        .eq("organization_id", organizationId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (!target) return;
    setDoctorId(target.doctor_id ?? "");
    setDate(target.desired_date ?? new Date().toLocaleDateString("en-CA"));
    setNote(target.registration_note ?? "");
    setAllowOutsideHours(false);
  }, [target]);

  const convert = useMutation({
    mutationFn: async () => {
      if (!target || !doctorId || !date || !time) throw new Error("أكمل الطبيب والتاريخ والوقت");
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(duration) * 60_000);
      const availability = await checkDoctorAvailability(doctorId, start, end);
      if (availability.status === "blocked") throw new Error(availability.message ?? "الطبيب غير متاح");
      /* الخروج عن الدوام تحذيرٌ يُتجاوَز صراحةً، كما في شاشة المواعيد.
         كانت هذه الشاشة تمنع منعًا، فالشاشتان تحكمان على الحالة نفسها
         حكمَين مختلفَين: يُحجَز الموعد من المواعيد ويُرفض من الانتظار. */
      if (availability.status === "outside" && !allowOutsideHours)
        throw new Error(
          `${availability.message ?? "الموعد خارج دوام الطبيب"} — فعّل "حجز خارج الدوام" إن كنت متأكدًا`,
        );
      const { error } = await supabase.rpc("app_convert_waitlist_to_appointment", {
        p_waitlist_id: target.id,
        p_doctor_id: doctorId,
        p_scheduled_start: start.toISOString(),
        p_scheduled_end: end.toISOString(),
        p_clinic_id: clinicId === "none" ? null : clinicId,
        p_visit_type_value_id: visitTypeId || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      APPOINTMENT_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
      toast({ title: "تم إنشاء الموعد وربطه بطلب الانتظار" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر إنشاء الموعد", description: errorMessage(error, "حدث خطأ") }),
  });

  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>تحويل إلى موعد</DialogTitle><DialogDescription>سيُنشأ موعد فعلي للمريض {target?.patient?.name_ar} ويُربط بطلب الانتظار.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div><Label>الطبيب *</Label><Select value={doctorId} onValueChange={setDoctorId}><SelectTrigger><SelectValue placeholder="اختر الطبيب" /></SelectTrigger><SelectContent>{(doctors.data ?? []).map((doctor) => <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid grid-cols-3 gap-2"><div><Label>التاريخ</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><div><Label>الوقت</Label><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div><div><Label>المدة</Label><Input type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>العيادة</Label><Select value={clinicId} onValueChange={setClinicId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون</SelectItem>{(clinics.data ?? []).map((clinic) => <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>)}</SelectContent></Select></div><div><Label>نوع الزيارة</Label><LookupSelect categoryKey="visit_types" value={visitTypeId} onChange={setVisitTypeId} placeholder="بدون" /></div></div>
        <div><Label>ملاحظة الموعد</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={allowOutsideHours}
            onChange={(event) => setAllowOutsideHours(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span>حجز خارج فترات دوام الطبيب</span>
            <span className="text-xs text-muted-foreground">
              فترات الحجب (إجازة أو عملية) تبقى ممنوعة ولا يتجاوزها هذا الخيار.
            </span>
          </span>
        </label>
      </div>
      <DialogFooter><Button disabled={convert.isPending || !doctorId || !date} onClick={() => convert.mutate()}>{convert.isPending ? "جارٍ إنشاء الموعد..." : "إنشاء الموعد"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
