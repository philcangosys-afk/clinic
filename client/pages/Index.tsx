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

function useDashboardStats(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard-stats", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      /**
       * كل عدّاد مقيَّد بالمؤسسة النشطة: سياسة RLS تسمح بكل مؤسسة **ينتمي
       * إليها** المستخدم، فبلا هذا التقييد كانت لوحة تحكم عضوٍ في عيادتين
       * تجمع أرقام العيادتين معًا — عدد المرضى وإجمالي المديونية وطابور
       * اليوم — بلا أي إشارة إلى أن الأرقام ليست لهذه العيادة وحدها.
       */
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
        supabase
          .from("appointments")
          .select("id, scheduled_start, status, patient:patients!appointments_patient_tenant_fk(name_ar, file_number), doctor:doctors!appointments_doctor_tenant_fk(name_ar)")
          .eq("organization_id", organizationId)
          .gte("scheduled_start", startOfTodayIso())
          .lte("scheduled_start", endOfTodayIso())
          .order("scheduled_start", { ascending: true })
          .limit(8),
        // عدّاد «مواعيد اليوم» استعلامٌ مستقلّ، لأن القائمة أعلاه مسقوفة
        // بثمانية للعرض. كان العدّاد يقرأ طول القائمة المسقوفة، فعيادة فيها
        // أربعون موعدًا اليوم ترى الرقم 8 — رقمٌ يبدو حقيقيًّا تمامًا لأنه
        // يتحرّك بين صفر وثمانية، ويقرأ منه المدير حجم يومه.
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("scheduled_start", startOfTodayIso())
          .lte("scheduled_start", endOfTodayIso()),
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
      };
    },
  });
}

const QUICK_LINKS = [
  { to: "/reception", label: "الاستقبال والانتظار", icon: Activity, hint: "طابور اليوم الحي" },
  { to: "/patients", label: "المرضى", icon: UsersRound, hint: "البحث والملف الطبي" },
  { to: "/appointments", label: "المواعيد", icon: CalendarDays, hint: "جدول الأطباء" },
  { to: "/billing", label: "الفوترة والمدفوعات", icon: WalletCards, hint: "الفواتير والسندات" },
];

export default function Index() {
  const access = useOrganizationAccess();
  const stats = useDashboardStats(access.organization?.id);

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
          ملخص سريع لحركة اليوم في {access.organization?.name ?? "منشأتك"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={UsersRound}
          label="إجمالي المرضى"
          value={stats.data?.patientsCount}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Stethoscope}
          label="الأطباء النشطون"
          value={stats.data?.doctorsCount}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={CalendarDays}
          label="مواعيد اليوم"
          value={stats.data?.todayAppointmentsCount}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={WalletCards}
          label="مستحقات غير مُحصّلة"
          value={stats.data ? `${stats.data.unpaidTotal.toLocaleString("ar-SA")} ر.س` : undefined}
          loading={stats.isLoading}
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>مواعيد اليوم</CardTitle>
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
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مواعيد مجدولة اليوم.</p>
            )}
            {stats.data?.todayAppointments.map((appointment: any) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold">{appointment.patient?.name_ar ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    د. {appointment.doctor?.name_ar ?? "—"} ·{" "}
                    {new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <Badge variant="secondary">{appointment.status}</Badge>
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
            <CardDescription>الأساسيات التشغيلية اليومية</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {QUICK_LINKS.map((link) => (
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

function KpiCard({
  icon: Icon,
  label,
  value,
  loading,
  tone,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string | number | undefined;
  loading: boolean;
  tone?: "warning";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${
            tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="mt-1 h-5 w-16" /> : <p className="text-lg font-bold">{value ?? "—"}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
