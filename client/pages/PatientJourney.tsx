import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarClock,
  ExternalLink,
  FileSignature,
  FileText,
  FlaskConical,
  MessageSquare,
  Pill,
  Printer,
  Receipt,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Wrench,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { printHtml } from "@/lib/document-merge";
import { usePermissions } from "@/lib/permissions";
import PatientPicker from "@/components/shared/PatientPicker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * رحلة المريض — خط زمني موحَّد (0067).
 *
 * كانت الشاشة بطاقات إحصائية: عدد المواعيد، عدد الزيارات، إجمالي الفواتير.
 * وهذه ليست رحلة بل ملخّص. ما يحتاجه من يفتحها فعلًا هو **ماذا حدث لهذا
 * المريض بالترتيب**: متى حجز، متى وصل، متى نودي، ماذا شُخِّص، ماذا طُلب له،
 * متى ظهرت النتيجة، وبكم فُوتِر.
 *
 * الأحداث تُشتقّ من الجداول نفسها لا من سجل التدقيق: سجل التدقيق يسجّل
 * «تغيّر عمود» لا «وصل المريض»، ويبدأ من تاريخ تفعيله فتغيب كل الرحلات
 * السابقة.
 */

type TimelineEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  title: string;
  summary: string | null;
  status: string | null;
  module: string;
  entity_id: string | null;
  appointment_id: string | null;
  visit_id: string | null;
  invoice_id: string | null;
  metadata: Record<string, unknown> | null;
};

const EVENT_META: Record<string, { label: string; icon: typeof CalendarClock; className: string }> = {
  patient_created:     { label: "فتح الملف",   icon: UserRound,     className: "text-slate-700 bg-slate-50 border-slate-300" },
  appointment_created: { label: "حجز موعد",    icon: CalendarClock, className: "text-blue-700 bg-blue-50 border-blue-300" },
  arrival:             { label: "وصول",        icon: UserRound,     className: "text-indigo-700 bg-indigo-50 border-indigo-300" },
  check_in:            { label: "تسجيل دخول",  icon: UserRound,     className: "text-indigo-700 bg-indigo-50 border-indigo-300" },
  call:                { label: "نداء",        icon: UserRound,     className: "text-violet-700 bg-violet-50 border-violet-300" },
  visit_start:         { label: "بدء الزيارة", icon: Stethoscope,   className: "text-emerald-700 bg-emerald-50 border-emerald-300" },
  visit_end:           { label: "إنهاء",       icon: Stethoscope,   className: "text-emerald-700 bg-emerald-50 border-emerald-300" },
  no_show:             { label: "عدم حضور",    icon: XCircle,       className: "text-rose-700 bg-rose-50 border-rose-300" },
  cancellation:        { label: "إلغاء",       icon: XCircle,       className: "text-rose-700 bg-rose-50 border-rose-300" },
  visit:               { label: "زيارة",       icon: Stethoscope,   className: "text-emerald-700 bg-emerald-50 border-emerald-300" },
  diagnosis:           { label: "تشخيص",       icon: FileText,      className: "text-teal-700 bg-teal-50 border-teal-300" },
  service:             { label: "خدمة",        icon: Wrench,        className: "text-teal-700 bg-teal-50 border-teal-300" },
  vitals:              { label: "مؤشرات",      icon: Activity,      className: "text-cyan-700 bg-cyan-50 border-cyan-300" },
  lab_order:           { label: "طلب مختبر",   icon: FlaskConical,  className: "text-amber-700 bg-amber-50 border-amber-300" },
  lab_result:          { label: "نتيجة مختبر", icon: FlaskConical,  className: "text-amber-800 bg-amber-100 border-amber-400" },
  radiology_order:     { label: "طلب أشعة",    icon: FlaskConical,  className: "text-orange-700 bg-orange-50 border-orange-300" },
  radiology_report:    { label: "تقرير أشعة",  icon: FlaskConical,  className: "text-orange-800 bg-orange-100 border-orange-400" },
  prescription:        { label: "وصفة",        icon: Pill,          className: "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-300" },
  dispensing:          { label: "صرف دواء",    icon: Pill,          className: "text-fuchsia-800 bg-fuchsia-100 border-fuchsia-400" },
  invoice:             { label: "فاتورة",      icon: Receipt,       className: "text-sky-700 bg-sky-50 border-sky-300" },
  refund:              { label: "مرتجع",       icon: Receipt,       className: "text-rose-700 bg-rose-50 border-rose-300" },
  payment:             { label: "سند",         icon: Receipt,       className: "text-sky-800 bg-sky-100 border-sky-400" },
  insurance_claim:     { label: "مطالبة",      icon: ShieldCheck,   className: "text-lime-700 bg-lime-50 border-lime-300" },
  message:             { label: "رسالة",       icon: MessageSquare, className: "text-slate-700 bg-slate-50 border-slate-300" },
  document:            { label: "مستند",       icon: FileText,      className: "text-slate-700 bg-slate-50 border-slate-300" },
  consent:             { label: "موافقة",      icon: FileSignature, className: "text-slate-700 bg-slate-50 border-slate-300" },
};

const PERIOD_OPTIONS: Record<string, { label: string; days: number | null }> = {
  all:   { label: "كل الفترات", days: null },
  d30:   { label: "آخر 30 يومًا", days: 30 },
  d90:   { label: "آخر 3 أشهر", days: 90 },
  d365:  { label: "آخر سنة", days: 365 },
};

type SelectedPatient = { id: string; name_ar: string; file_number: number | string | null; mobile_number: string | null };

export default function PatientJourney() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [period, setPeriod] = useState<string>("all");
  const [term, setTerm] = useState("");
  const [record, setRecord] = useState<{ kind: "invoice" | "visit"; id: string } | null>(null);

  const from = useMemo(() => {
    const days = PERIOD_OPTIONS[period]?.days;
    if (!days) return null;
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }, [period]);

  const timeline = useQuery({
    queryKey: ["patient-timeline", patient?.id, from, typeFilter],
    enabled: Boolean(patient?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_get_patient_timeline", {
        p_patient_id: patient!.id,
        p_from: from,
        p_to: null,
        // التصفية بالنوع تجري في القاعدة لا في المتصفح: رحلة مريض قديم قد
        // تبلغ آلاف الأحداث، وجلبها كلها لعرض عشرة منها هدر في كل فتح.
        p_event_types: typeFilter === "all" ? null : [typeFilter],
      });
      if (error) throw error;
      return (data ?? []) as TimelineEvent[];
    },
  });

  const filtered = useMemo(() => {
    const needle = term.trim();
    if (!needle) return timeline.data ?? [];
    return (timeline.data ?? []).filter(
      (event) =>
        event.title.includes(needle) ||
        (event.summary ?? "").includes(needle) ||
        (event.status ?? "").includes(needle),
    );
  }, [timeline.data, term]);

  /** تجميع أحداث اليوم الواحد تحت رأس واحد. */
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of filtered) {
      const key = new Date(event.occurred_at).toLocaleDateString("ar-SA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return Array.from(map.entries());
  }, [filtered]);

  /**
   * فتح السجل المصدر للحدث.
   *
   * كان الزرّ ينقل إلى `/billing?invoiceId=…` و`/patient-visits?visitId=…`
   * وشاشتا الفوترة والزيارات **لا تقرآن هذين المعاملَين** (الفوترة تقرأ
   * `appointmentId` وتفتح به نافذة فاتورة جديدة، لا الفاتورة القائمة) — فكان
   * الضغط ينقل إلى قائمة الشاشة كاملة ويترك المستخدم يبحث يدويًا عن السجل
   * الذي كان أمامه، أو — أسوأ — يفتح نافذة إنشاء فاتورة ثانية.
   *
   * فتُقرأ الفاتورة والزيارة هنا بمعرّفهما وتُعرضان في نافذة، وتبقى أحداث
   * الموعد على شاشة الاستقبال التي تقرأ `appointmentId` فعلًا.
   */
  const openSource = (event: TimelineEvent) => {
    if (event.invoice_id) return setRecord({ kind: "invoice", id: event.invoice_id });
    if (event.visit_id) return setRecord({ kind: "visit", id: event.visit_id });
    if (event.appointment_id) return navigate(`/reception?appointmentId=${event.appointment_id}`);
    if (patient) return navigate(`/patients/${patient.id}`);
  };

  const printJourney = () => {
    if (!patient) return;
    const rows = filtered
      .map(
        (event) =>
          `<tr><td>${new Date(event.occurred_at).toLocaleString("ar-SA")}</td>` +
          `<td>${EVENT_META[event.event_type]?.label ?? event.event_type}</td>` +
          `<td>${event.title}</td><td>${event.summary ?? ""}</td></tr>`,
      )
      .join("");
    printHtml(
      `رحلة المريض — ${patient.name_ar}`,
      `<h2>رحلة المريض</h2>
       <p>${patient.name_ar}${patient.file_number ? ` · ملف ${patient.file_number}` : ""}</p>
       <table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">
         <thead><tr><th>التاريخ</th><th>النوع</th><th>الحدث</th><th>التفاصيل</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>`,
    );
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">رحلة المريض</h1>
        <p className="text-sm text-muted-foreground">
          كل ما حدث للمريض بالترتيب — من فتح الملف إلى آخر فاتورة.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>اختيار المريض</CardTitle>
          <CardDescription>ابحث بالاسم أو رقم الجوال أو رقم الملف</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {patient ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-sm">
                {patient.name_ar}
              </Badge>
              {patient.file_number && (
                <span className="text-xs text-muted-foreground">ملف {patient.file_number}</span>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                تغيير
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patient.id}`)}>
                <ExternalLink className="h-3.5 w-3.5" />
                الملف
              </Button>
              {can("reports.reception") && (
                <Button size="sm" variant="outline" onClick={printJourney}>
                  <Printer className="h-3.5 w-3.5" />
                  طباعة
                </Button>
              )}
            </div>
          ) : (
            <PatientPicker
              onSelect={(selected) =>
                setPatient({
                  id: selected.id,
                  name_ar: selected.name_ar,
                  file_number: selected.file_number,
                  mobile_number: selected.mobile_number,
                })
              }
            />
          )}

          {patient && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="h-9 pr-9"
                  placeholder="بحث داخل الأحداث..."
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأنواع</SelectItem>
                  {Object.entries(EVENT_META).map(([value, meta]) => (
                    <SelectItem key={value} value={value}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIOD_OPTIONS).map(([value, option]) => (
                    <SelectItem key={value} value={value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {!patient && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          اختر مريضًا لعرض رحلته.
        </p>
      )}

      {patient && timeline.isLoading && <Skeleton className="h-96 w-full" />}

      {patient && !timeline.isLoading && grouped.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">لا أحداث في هذه الفترة.</p>
      )}

      {patient &&
        !timeline.isLoading &&
        grouped.map(([day, events]) => (
          <div key={day} className="flex flex-col gap-2">
            <div className="sticky top-0 z-10 bg-background/95 py-1 text-sm font-medium text-muted-foreground backdrop-blur">
              {day} · {events.length} حدث
            </div>
            <div className="relative flex flex-col gap-2 border-e pr-4">
              {events.map((event) => {
                const meta = EVENT_META[event.event_type] ?? {
                  label: event.event_type,
                  icon: FileText,
                  className: "text-slate-700 bg-slate-50 border-slate-300",
                };
                const Icon = meta.icon;
                return (
                  <div
                    key={event.event_id}
                    className={`relative rounded-lg border px-3 py-2 ${meta.className}`}
                  >
                    {/* نقطة على المحور — تُوضع بالإزاحة لا بعنصر منفصل حتى
                        لا ينكسر المحور عند التفاف النص. */}
                    <span className="absolute -right-[1.35rem] top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-current" />
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="text-xs opacity-70">
                        {new Date(event.occurred_at).toLocaleTimeString("ar-SA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-medium">{event.title}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {meta.label}
                      </Badge>
                      {event.status && (
                        <span className="text-[10px] opacity-70">{event.status}</span>
                      )}
                      <span className="flex-1" />
                      {(event.invoice_id || event.visit_id || event.appointment_id) && (
                        <Button size="sm" variant="ghost" onClick={() => openSource(event)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          فتح
                        </Button>
                      )}
                    </div>
                    {event.summary && (
                      <div className="mt-0.5 pr-6 text-xs opacity-80">{event.summary}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      <RecordDialog
        record={record}
        onClose={() => setRecord(null)}
        onOpenPatient={() => {
          if (patient) navigate(`/patients/${patient.id}`);
        }}
      />
    </div>
  );
}

/**
 * نافذة السجل المصدر — فاتورة أو زيارة.
 *
 * تُقرأ الحقول المالية والسريرية كما هي في القاعدة بلا أي حساب في المتصفّح:
 * رقم مُعاد حسابه هنا قد يخالف ما تطبعه الفاتورة، والاختلاف في مبلغ أسوأ من
 * غيابه.
 */
function RecordDialog({
  record,
  onClose,
  onOpenPatient,
}: {
  record: { kind: "invoice" | "visit"; id: string } | null;
  onClose: () => void;
  onOpenPatient: () => void;
}) {
  const invoice = useQuery({
    queryKey: ["journey-invoice", record?.kind === "invoice" ? record.id : null],
    enabled: record?.kind === "invoice",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, invoice_type, document_type, status, is_temporary, created_at, issued_at, net_amount, paid_amount, remaining_amount, discount_amount, vat_amount, insurance_share_amount, patient_share_amount, insurance_company_name, note",
        )
        .eq("id", record!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    },
  });

  const visit = useQuery({
    queryKey: ["journey-visit", record?.kind === "visit" ? record.id : null],
    enabled: record?.kind === "visit",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select("id, visit_date, status, main_complaint, notes, next_visit_plan, next_visit_date, created_at")
        .eq("id", record!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    },
  });

  const active = record?.kind === "invoice" ? invoice : visit;
  const money = (value: unknown) => Number(value ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2 });

  return (
    <Dialog open={Boolean(record)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record?.kind === "invoice" ? "الفاتورة" : "الزيارة"}</DialogTitle>
          <DialogDescription>السجل كما هو في القاعدة — للاطّلاع فقط، والتعديل من شاشته.</DialogDescription>
        </DialogHeader>

        {active?.isLoading && <Skeleton className="h-40 w-full" />}
        {/* الخطأ يُعرض ولا يُخفى: نافذة فارغة تُفهم كسجل بلا بيانات. */}
        {active?.isError && (
          <p className="text-sm text-destructive">
            {active.error instanceof Error ? active.error.message : "تعذر قراءة السجل"}
          </p>
        )}
        {active && !active.isLoading && !active.isError && !active.data && (
          <p className="text-sm text-muted-foreground">السجل غير موجود أو لا تملك الوصول إليه.</p>
        )}

        {record?.kind === "invoice" && invoice.data && (
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">
                {invoice.data.invoice_number ?? invoice.data.id.slice(0, 8)}
              </span>
              <Badge variant="outline">{invoice.data.status}</Badge>
              {invoice.data.invoice_type === "return" && <Badge variant="destructive">مرتجع</Badge>}
              {invoice.data.is_temporary && <Badge variant="secondary">مؤقتة</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(invoice.data.issued_at ?? invoice.data.created_at).toLocaleString("ar-SA")}
            </p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              <span className="tabular-nums">الصافي: {money(invoice.data.net_amount)}</span>
              <span className="tabular-nums">المدفوع: {money(invoice.data.paid_amount)}</span>
              <span className="tabular-nums">المتبقّي: {money(invoice.data.remaining_amount)}</span>
              <span className="tabular-nums">الخصم: {money(invoice.data.discount_amount)}</span>
              <span className="tabular-nums">الضريبة: {money(invoice.data.vat_amount)}</span>
              {invoice.data.insurance_company_name && (
                <span className="tabular-nums">
                  حصّة التأمين: {money(invoice.data.insurance_share_amount)} ({invoice.data.insurance_company_name})
                </span>
              )}
              <span className="tabular-nums">حصّة المريض: {money(invoice.data.patient_share_amount)}</span>
            </div>
            {invoice.data.note && <p className="mt-1 text-xs text-muted-foreground">{invoice.data.note}</p>}
          </div>
        )}

        {record?.kind === "visit" && visit.data && (
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {new Date(visit.data.visit_date ?? visit.data.created_at).toLocaleString("ar-SA")}
              </span>
              {visit.data.status && <Badge variant="outline">{visit.data.status}</Badge>}
            </div>
            <p>الشكوى الرئيسة: {visit.data.main_complaint ?? "—"}</p>
            {visit.data.notes && <p className="text-xs text-muted-foreground">{visit.data.notes}</p>}
            {visit.data.next_visit_plan && <p className="text-xs">خطة الزيارة القادمة: {visit.data.next_visit_plan}</p>}
            {visit.data.next_visit_date && (
              <p className="text-xs">
                الزيارة القادمة: {new Date(visit.data.next_visit_date).toLocaleDateString("ar-SA")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onOpenPatient}>
            <ExternalLink className="h-3.5 w-3.5" />
            ملف المريض
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
