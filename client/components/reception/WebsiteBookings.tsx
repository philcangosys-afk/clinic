import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, FolderOpen, Globe, Phone, XCircle } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
 * حجوزات الموقع الإلكتروني (0226).
 *
 * الحجز من الموقع طلبٌ في `appointment_requests` (source = 'website') برقمٍ
 * متسلسل — بلا ملفّ ولا موعد ولا فاتورة. هنا يراه الاستقبال بحالته:
 *   • «غير مؤكد»: فتح ملفٍّ من بيانات الحاجز (أو ربطه بملفٍّ موجود بنفس الجوال)،
 *     ثمّ «تأكيد» يُنشئ موعدًا مؤكَّدًا بالوقت المطلوب (والطبيب إن اختار الحاجز
 *     «أي طبيب»)، أو «إلغاء» بسبب.
 *   • «مؤكد»: الموعد في الجدول، ومنه يُدار.
 * للاستقبال وإدارة المنشأة — الصفات نفسها التي تقبلها الدوالّ.
 */

type WebsiteBooking = {
  id: string;
  booking_number: number;
  created_at: string;
  guest_name: string | null;
  guest_mobile: string | null;
  guest_gender: string | null;
  service_text: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  requested_start: string | null;
  requested_end: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  patient_id: string | null;
  patient_name: string | null;
  file_number: number | string | null;
  appointment_id: string | null;
  appointment_start: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
};

type Filter = "pending" | "approved" | "cancelled" | "all";

const STAFF_ROLES = ["owner", "organization_admin", "branch_manager", "receptionist"];

const STATUS_META: Record<WebsiteBooking["status"], { label: string; className: string }> = {
  pending: { label: "غير مؤكد", className: "bg-amber-100 text-amber-900" },
  approved: { label: "مؤكد", className: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "ملغى", className: "bg-slate-200 text-slate-700" },
  rejected: { label: "ملغى", className: "bg-slate-200 text-slate-700" },
};

const BOOKINGS_KEY = (org: string | undefined) => ["website-bookings", org] as const;

/** «2026-10-05T13:00» للحقل datetime-local بتوقيت الجهاز */
function toLocalInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const doctorLabel = (name: string | null) => (name ? `د. ${name.replace(/^\s*د\s*\.?\s*/, "")}` : "أي طبيب");

export function useCanSeeWebsiteBookings() {
  const { membership, legacyMode } = useOrganizationAccess();
  return legacyMode || STAFF_ROLES.includes(membership?.role_key ?? "");
}

function useWebsiteBookings(enabled: boolean) {
  const { organization } = useOrganizationAccess();
  return useQuery({
    queryKey: BOOKINGS_KEY(organization?.id),
    enabled: enabled && Boolean(organization?.id),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_website_bookings")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("booking_number", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as WebsiteBooking[];
    },
  });
}

/** زرّ «حجوزات الموقع الإلكتروني» — في الرئيسية والاستقبال، وعليه عدد غير المؤكَّد */
export default function WebsiteBookingsButton({ className }: { className?: string }) {
  const canSee = useCanSeeWebsiteBookings();
  const [open, setOpen] = useState(false);
  const bookings = useWebsiteBookings(canSee);
  if (!canSee) return null;
  const pending = (bookings.data ?? []).filter((b) => b.status === "pending").length;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn(
          "gap-1.5 border-teal-500 text-teal-800 hover:bg-teal-50",
          pending > 0 && "animate-pulse bg-teal-50",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <Globe className="h-4 w-4" />
        حجوزات الموقع الإلكتروني
        {pending > 0 && (
          <span className="rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white tabular-nums">{pending}</span>
        )}
      </Button>
      {open && <WebsiteBookingsDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

function WebsiteBookingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { calendarDisplay } = useLocaleSettings();
  const navigate = useNavigate();
  const bookings = useWebsiteBookings(open);
  const [filter, setFilter] = useState<Filter>("pending");
  const [term, setTerm] = useState("");
  const [fileFor, setFileFor] = useState<WebsiteBooking | null>(null);
  const [confirmFor, setConfirmFor] = useState<WebsiteBooking | null>(null);
  const [cancelFor, setCancelFor] = useState<WebsiteBooking | null>(null);

  const rows = useMemo(() => {
    const all = bookings.data ?? [];
    const byStatus =
      filter === "all"
        ? all
        : filter === "cancelled"
          ? all.filter((b) => b.status === "cancelled" || b.status === "rejected")
          : all.filter((b) => b.status === filter);
    const q = term.trim();
    if (!q) return byStatus;
    return byStatus.filter((b) =>
      [String(b.booking_number), b.guest_name, b.guest_mobile, b.service_text, b.patient_name]
        .filter(Boolean)
        .some((v) => String(v).includes(q)),
    );
  }, [bookings.data, filter, term]);

  const counts = useMemo(() => {
    const all = bookings.data ?? [];
    return {
      pending: all.filter((b) => b.status === "pending").length,
      approved: all.filter((b) => b.status === "approved").length,
      cancelled: all.filter((b) => b.status === "cancelled" || b.status === "rejected").length,
      all: all.length,
    };
  }, [bookings.data]);

  const openFile = (patientId: string) => {
    onOpenChange(false);
    navigate(`/patients/${patientId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-teal-600" />
            حجوزات الموقع الإلكتروني
          </DialogTitle>
          <DialogDescription>
            كلّ حجزٍ من الموقع برقمه. افتح ملفًّا من بيانات الحاجز (أو اربطه بملفّه)، ثمّ أكّد الموعد — أو ألغِه بسبب.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["pending", "غير مؤكد"],
              ["approved", "مؤكد"],
              ["cancelled", "ملغى"],
              ["all", "الكل"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
            >
              {label} ({counts[key]})
            </Button>
          ))}
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="بحث برقم الحجز أو الاسم أو الجوال"
            className="ms-auto h-9 w-64"
          />
        </div>

        {bookings.isLoading && <Skeleton className="h-40 w-full" />}
        {bookings.isError && (
          <p className="text-sm text-destructive">تعذّر التحميل: {errorMessage(bookings.error)}</p>
        )}
        {!bookings.isLoading && !bookings.isError && (
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الحجز</TableHead>
                  <TableHead>الحاجز</TableHead>
                  <TableHead>الخدمة</TableHead>
                  <TableHead>العيادة / الطبيب</TableHead>
                  <TableHead>الموعد المطلوب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الملف</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const meta = STATUS_META[b.status] ?? STATUS_META.pending;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-base font-bold">{b.booking_number}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-semibold">{b.guest_name}</div>
                        <a href={`tel:${b.guest_mobile}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
                          <Phone className="h-3 w-3" /> {b.guest_mobile}
                        </a>
                        <div className="text-[11px] text-muted-foreground">
                          حُجز {formatDateTime(b.created_at, calendarDisplay)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem] text-sm">{b.service_text ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{b.clinic_name ?? "—"}</div>
                        <div className={cn("text-xs", b.doctor_id ? "text-muted-foreground" : "font-semibold text-amber-700")}>
                          {doctorLabel(b.doctor_name)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(b.appointment_start ?? b.requested_start, calendarDisplay)}
                      </TableCell>
                      <TableCell>
                        <Badge className={meta.className}>{meta.label}</Badge>
                        {b.status !== "pending" && b.decided_by_name && (
                          <div className="mt-1 text-[11px] text-muted-foreground">{b.decided_by_name}</div>
                        )}
                        {(b.status === "cancelled" || b.status === "rejected") && b.decision_note && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{b.decision_note}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {b.patient_id ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            onClick={() => openFile(b.patient_id!)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {b.file_number ? `ملف ${b.file_number}` : b.patient_name}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">بلا ملف</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {b.status === "pending" && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {!b.patient_id && (
                              <Button size="sm" variant="outline" onClick={() => setFileFor(b)}>
                                <FolderOpen className="h-3.5 w-3.5" />
                                فتح ملف
                              </Button>
                            )}
                            <Button
                              size="sm"
                              disabled={!b.patient_id}
                              title={b.patient_id ? "إنشاء الموعد مؤكَّدًا" : "افتح ملف المريض أولًا"}
                              onClick={() => setConfirmFor(b)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              تأكيد
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelFor(b)}>
                              <XCircle className="h-3.5 w-3.5" />
                              إلغاء
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا حجوزات في هذا القسم.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </DialogFooter>

        {fileFor && <OpenFileDialog booking={fileFor} onClose={() => setFileFor(null)} />}
        {confirmFor && <ConfirmDialog booking={confirmFor} onClose={() => setConfirmFor(null)} />}
        {cancelFor && <CancelDialog booking={cancelFor} onClose={() => setCancelFor(null)} />}
      </DialogContent>
    </Dialog>
  );
}

/** فتح ملفٍّ من بيانات الحاجز — أو ربطه بملفٍّ موجود بالجوال نفسه */
function OpenFileDialog({ booking, onClose }: { booking: WebsiteBooking; onClose: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const digits = (booking.guest_mobile ?? "").replace(/\D/g, "");
  const tail = digits.slice(-9);

  const matches = useQuery({
    queryKey: ["website-booking-matches", organization?.id, tail],
    enabled: Boolean(organization?.id && tail.length >= 8),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name_ar, file_number, mobile_number")
        .eq("organization_id", organization!.id)
        .ilike("mobile_number", `%${tail}`)
        .order("file_number")
        .limit(10);
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; file_number: number | null; mobile_number: string | null }[];
    },
  });

  const link = useMutation({
    mutationFn: async (patientId: string | null) => {
      const { data, error } = await supabase.rpc("app_website_booking_link_patient", {
        p_request_id: booking.id,
        p_patient_id: patientId,
      });
      if (error) throw error;
      return { created: !patientId, id: String(data) };
    },
    onSuccess: ({ created }) => {
      queryClient.invalidateQueries({ queryKey: ["website-bookings"] });
      toast({ title: created ? "فُتح ملفٌّ جديد من بيانات الحاجز" : "رُبط الحجز بالملف", description: "يمكنك الآن تأكيد الموعد." });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر فتح الملف", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>فتح ملف — حجز رقم {booking.booking_number}</DialogTitle>
          <DialogDescription>
            {booking.guest_name} — <span dir="ltr">{booking.guest_mobile}</span>
            {booking.guest_gender ? ` — ${booking.guest_gender === "female" ? "أنثى" : "ذكر"}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">ملفات بنفس رقم الجوال</p>
          {matches.isLoading && <Skeleton className="h-12 w-full" />}
          {!matches.isLoading && (matches.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">لا يوجد ملف بهذا الجوال.</p>
          )}
          {(matches.data ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <span>
                {p.name_ar} <span className="text-xs text-muted-foreground">— ملف {p.file_number ?? "—"}</span>
              </span>
              <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(p.id)}>
                ربط بهذا الملف
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={link.isPending}>
            رجوع
          </Button>
          <Button disabled={link.isPending} onClick={() => link.mutate(null)}>
            <FolderOpen className="h-4 w-4" />
            {link.isPending ? "جارٍ الحفظ..." : "فتح ملف جديد من بيانات الحاجز"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** التأكيد: موعدٌ مؤكَّد — الطبيب لازم إن اختار الحاجز «أي طبيب» */
function ConfirmDialog({ booking, onClose }: { booking: WebsiteBooking; onClose: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorId, setDoctorId] = useState(booking.doctor_id ?? "");
  const [start, setStart] = useState(toLocalInput(booking.requested_start));

  const doctors = useQuery({
    queryKey: ["website-booking-doctors", organization?.id, booking.clinic_id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let query = supabase
        .from("doctors")
        .select("id, name_ar, clinic_id")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (booking.clinic_id) query = query.eq("clinic_id", booking.clinic_id);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; clinic_id: string | null }[];
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!doctorId) throw new Error("اختر الطبيب");
      if (!start) throw new Error("حدّد وقت الموعد");
      const when = new Date(start);
      if (Number.isNaN(when.getTime())) throw new Error("وقت الموعد غير صحيح");
      const { error } = await supabase.rpc("app_website_booking_confirm", {
        p_request_id: booking.id,
        p_doctor_id: doctorId,
        p_start: when.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: `تأكّد حجز رقم ${booking.booking_number}`, description: "الموعد في جدول المواعيد بحالة «مؤكَّد»." });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التأكيد", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تأكيد حجز رقم {booking.booking_number}</DialogTitle>
          <DialogDescription>
            {booking.guest_name} — {booking.service_text}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب *</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder={booking.doctor_id ? "" : "الحاجز اختار «أي طبيب» — اختر"} />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {doctorLabel(d.name_ar)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>وقت الموعد *</Label>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            <p className="text-xs text-muted-foreground">الوقت الذي اختاره الحاجز — عدّله إن اتفقتم على غيره.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
            رجوع
          </Button>
          <Button disabled={!doctorId || !start || confirm.isPending} onClick={() => confirm.mutate()}>
            <CheckCircle2 className="h-4 w-4" />
            {confirm.isPending ? "جارٍ التأكيد..." : "تأكيد الموعد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ booking, onClose }: { booking: WebsiteBooking; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_website_booking_cancel", {
        p_request_id: booking.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-bookings"] });
      toast({ title: `أُلغي حجز رقم ${booking.booking_number}` });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إلغاء حجز رقم {booking.booking_number}</DialogTitle>
          <DialogDescription>لا يُحذف الحجز: يبقى برقمه وحالته «ملغى» وسببه.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="سبب الإلغاء" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            رجوع
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            إلغاء الحجز
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
