import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  BadgeAlert,
  CalendarDays,
  Stethoscope,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useSessionDoctor } from "@/lib/session-doctor";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}
function endOfTodayIso() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** حالات «في انتظار الطبيب الآن» */
const WAITING_STATUSES = ["arrived", "checked_in", "waiting", "walk_in", "called"];

/**
 * `doctorId`: حساب الطبيب — كلّ رقمٍ وكلّ قائمةٍ له وحده (مرضاه، مواعيده،
 * من ينتظره). أرقام المنشأة كلّها (الأطباء، المستحقات، تنبيهات الانتهاء)
 * ليست من شأن شاشته.
 */
function useDashboardStats(organizationId: string | undefined, doctorId: string | null) {
  return useQuery({
    queryKey: ["dashboard-stats", organizationId, doctorId],
    enabled: Boolean(organizationId),
    // لوحة الطبيب تتجدّد وحدها: «في انتظارك» يتغيّر مع كلّ تسجيل وصول
    refetchInterval: doctorId ? 30_000 : false,
    queryFn: async () => {
      /**
       * كل عدّاد مقيَّد بالمؤسسة النشطة: سياسة RLS تسمح بكل مؤسسة **ينتمي
       * إليها** المستخدم، فبلا هذا التقييد كانت لوحة تحكم عضوٍ في عيادتين
       * تجمع أرقام العيادتين معًا — عدد المرضى وإجمالي المديونية وطابور
       * اليوم — بلا أي إشارة إلى أن الأرقام ليست لهذه العيادة وحدها.
       */
      const todayList = () => {
        let query = supabase
          .from("appointments")
          .select("id, scheduled_start, status, patient:patients!appointments_patient_tenant_fk(name_ar, file_number), doctor:doctors!appointments_doctor_tenant_fk(name_ar)")
          .eq("organization_id", organizationId)
          .gte("scheduled_start", startOfTodayIso())
          .lte("scheduled_start", endOfTodayIso());
        if (doctorId) query = query.eq("doctor_id", doctorId);
        return query.order("scheduled_start", { ascending: true }).limit(8);
      };
      // عدّاد «مواعيد اليوم» استعلامٌ مستقلّ، لأن القائمة مسقوفة بثمانية للعرض.
      const todayCountQuery = (statuses?: string[]) => {
        let query = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("scheduled_start", startOfTodayIso())
          .lte("scheduled_start", endOfTodayIso());
        if (doctorId) query = query.eq("doctor_id", doctorId);
        if (statuses) query = query.in("status", statuses);
        return query;
      };

      if (doctorId) {
        const [patients, todayAppointments, todayCount, waitingNow, doneToday] = await Promise.all([
          supabase
            .from("v_doctor_patients")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("doctor_id", doctorId),
          todayList(),
          todayCountQuery(),
          todayCountQuery(WAITING_STATUSES),
          todayCountQuery(["completed"]),
        ]);
        return {
          patientsCount: patients.count ?? 0,
          doctorsCount: 0,
          todayAppointments: todayAppointments.data ?? [],
          todayAppointmentsCount: todayCount.count ?? 0,
          unpaidTotal: 0,
          alertsCount: 0,
          waitingNow: waitingNow.count ?? 0,
          doneToday: doneToday.count ?? 0,
        };
      }

      const [patients, doctors, todayAppointments, todayCount, unpaidInvoices, alerts] = await Promise.all([
        supabase
          .from("patients")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId),
        supabase
          .from("doctors")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("is_enabled", true),
        todayList(),
        todayCountQuery(),
        supabase
          .from("sales_invoices")
          .select("remaining_amount")
          .eq("organization_id", organizationId)
          .in("status", ["unpaid", "partial"]),
        supabase
          .from("expiring_alerts")
          .select("alert_type", { count: "exact", head: true })
          .eq("organization_id", organizationId),
      ]);

      const unpaidTotal = (unpaidInvoices.data ?? []).reduce(
        (sum, row) => sum + Number((row as { remaining_amount: number }).remaining_amount ?? 0),
        0,
      );

      return {
        patientsCount: patients.count ?? 0,
        doctorsCount: doctors.count ?? 0,
        todayAppointments: todayAppointments.data ?? [],
        todayAppointmentsCount: todayCount.count ?? 0,
        unpaidTotal,
        alertsCount: alerts.count ?? 0,
        waitingNow: 0,
        doneToday: 0,
      };
    },
  });
}

const QUICK_LINKS = [
  { to: "/reception", label: "الاستقبال", icon: Activity, hint: "طابور اليوم الحي" },
  { to: "/patients", label: "المرضى", icon: UsersRound, hint: "البحث والملف الطبي" },
  { to: "/appointments", label: "المواعيد", icon: CalendarDays, hint: "جدول الأطباء" },
  { to: "/billing", label: "الفوترة والمدفوعات", icon: WalletCards, hint: "الفواتير والسندات" },
];

/** الوصول السريع لحساب الطبيب — شاشاته هو، بلا الفوترة. */
const DOCTOR_QUICK_LINKS = [
  { to: "/doctor-workspace", label: "مساحة عمل الطبيب", icon: Stethoscope, hint: "من ينتظرك الآن وطلباتك" },
  { to: "/patients", label: "مرضاي", icon: UsersRound, hint: "من تعالجهم أو لك معهم موعد" },
  { to: "/appointments", label: "مواعيدي", icon: CalendarDays, hint: "جدولك اليومي" },
  { to: "/alerts", label: "التنبيهات", icon: BadgeAlert, hint: "ما أُرسل إليك" },
];

export default function Index() {
  const access = useOrganizationAccess();
  const { doctorId: scopeDoctorId, isDoctorScope } = useSessionDoctor();
  const doctorView = isDoctorScope && Boolean(scopeDoctorId);
  const stats = useDashboardStats(access.organization?.id, doctorView ? scopeDoctorId : null);
  const quickLinks = doctorView ? DOCTOR_QUICK_LINKS : QUICK_LINKS;

  if (access.legacyMode) {
    return (
      <div className="flex h-full min-h-[70vh] items-center justify-center p-6">
        <Card className="max-w-lg text-center">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Stethoscope className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-lg font-bold">مرحبًا بك</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                سجّل الدخول أو أنشئ منشأتك الطبية للبدء باستخدام النظام الفعلي
                المربوط بقاعدة البيانات.
              </p>
            </div>
            <Button asChild>
              <Link to="/onboarding">
                تسجيل الدخول / إنشاء منشأة
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">نظرة عامة</h1>
        <p className="text-sm text-muted-foreground">
          {doctorView
            ? "يومك أنت: مرضاك ومواعيدك ومن ينتظرك."
            : `ملخص سريع لحركة اليوم في ${access.organization?.name ?? "منشأتك"}.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={UsersRound}
          label={doctorView ? "مرضاي" : "إجمالي المرضى"}
          value={stats.data?.patientsCount}
          loading={stats.isLoading}
        />
        {/* للطبيب (0218): «في انتظارك» و«مواعيدي اليوم» بلونٍ مختلف، تومض ما
            دام فيها أحد، وتُفتح بالضغط — منتظِرك في مساحة عملك، ومواعيدك في
            شاشة المواعيد. */}
        <KpiCard
          icon={Stethoscope}
          label={doctorView ? "في انتظارك الآن" : "الأطباء النشطون"}
          value={doctorView ? stats.data?.waitingNow : stats.data?.doctorsCount}
          loading={stats.isLoading}
          to={doctorView ? "/doctor-workspace" : undefined}
          tone={doctorView ? "attention" : undefined}
          blink={doctorView && (stats.data?.waitingNow ?? 0) > 0}
        />
        <KpiCard
          icon={CalendarDays}
          label={doctorView ? "مواعيدي اليوم" : "مواعيد اليوم"}
          value={stats.data?.todayAppointmentsCount}
          loading={stats.isLoading}
          to={doctorView ? "/appointments" : undefined}
          tone={doctorView ? "info" : undefined}
          blink={doctorView && (stats.data?.todayAppointmentsCount ?? 0) > 0}
        />
        {doctorView ? (
          <KpiCard icon={Activity} label="أُنجز اليوم" value={stats.data?.doneToday} loading={stats.isLoading} />
        ) : (
          <KpiCard
            icon={WalletCards}
            label="مستحقات غير مُحصّلة"
            value={stats.data ? `${stats.data.unpaidTotal.toLocaleString("ar-SA")} ر.س` : undefined}
            loading={stats.isLoading}
            tone="warning"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{doctorView ? "مواعيدي اليوم" : "مواعيد اليوم"}</CardTitle>
              <CardDescription>أقرب المواعيد المجدولة الآن</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/appointments">عرض الكل</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {stats.isLoading &&
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            {!stats.isLoading && stats.data?.todayAppointments.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {doctorView ? "لا مواعيد لك اليوم." : "لا توجد مواعيد مجدولة اليوم."}
              </p>
            )}
            {stats.data?.todayAppointments.map((appointment: any) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold">{appointment.patient?.name_ar ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {!doctorView && <>د. {appointment.doctor?.name_ar ?? "—"} ·{" "}</>}
                    {appointment.patient?.file_number != null && <>ملف {appointment.patient.file_number} ·{" "}</>}
                    {new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
              </div>
            ))}
            {/* البطاقة تعرض أقرب ثمانية. قول ذلك صريحًا يمنع قراءة القائمة
                كأنها كل مواعيد اليوم. */}
            {(stats.data?.todayAppointmentsCount ?? 0) > (stats.data?.todayAppointments.length ?? 0) && (
              <p className="pt-1 text-center text-xs text-muted-foreground">
                معروض {stats.data?.todayAppointments.length} من {stats.data?.todayAppointmentsCount} موعدًا اليوم —
                افتح «عرض الكل» لبقيّتها.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الوصول السريع</CardTitle>
            <CardDescription>{doctorView ? "شاشاتك اليومية" : "الأساسيات التشغيلية اليومية"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {quickLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted"
              >
                <link.icon className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{link.label}</p>
                  <p className="text-xs text-muted-foreground">{link.hint}</p>
                </div>
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
            {Boolean(stats.data?.alertsCount) && (
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                <BadgeAlert className="h-4 w-4" />
                <span className="text-xs font-medium">{stats.data?.alertsCount} تنبيه بحاجة إلى مراجعة</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const KPI_TONES = {
  warning: { card: "", icon: "bg-amber-100 text-amber-700", value: "" },
  attention: {
    card: "border-amber-400 bg-amber-50 hover:bg-amber-100",
    icon: "bg-amber-500 text-white",
    value: "text-amber-800",
  },
  info: {
    card: "border-sky-400 bg-sky-50 hover:bg-sky-100",
    icon: "bg-sky-600 text-white",
    value: "text-sky-800",
  },
} as const;

function KpiCard({
  icon: Icon,
  label,
  value,
  loading,
  tone,
  to,
  blink,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string | number | undefined;
  loading: boolean;
  tone?: keyof typeof KPI_TONES;
  /** يُفتح بالضغط */
  to?: string;
  /** يومض ما دام فيه شيء */
  blink?: boolean;
}) {
  const style = tone ? KPI_TONES[tone] : null;
  const card = (
    <Card className={`${style?.card ?? ""} ${to ? "cursor-pointer transition-colors" : ""} ${blink ? "animate-pulse" : ""}`}>
      <CardContent className="flex items-center gap-3 py-5">
        <div className={`relative flex h-11 w-11 items-center justify-center rounded-xl ${style?.icon ?? "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
          {blink && (
            <span className="absolute -left-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
            </span>
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-16" />
          ) : (
            <p className={`text-lg font-bold ${style?.value ?? ""}`}>{value ?? "—"}</p>
          )}
        </div>
        {to && <ArrowLeft className="h-4 w-4 text-muted-foreground" />}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {card}
    </Link>
  ) : (
    card
  );
}
