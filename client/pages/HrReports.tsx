import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, CalendarCheck2, FileCheck2, UserPlus, Gauge, GraduationCap } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  HrAttendanceMonthlyView,
  HrDashboardSummaryView,
  HrLatestPerformanceView,
  LeaveBalanceCurrentYearView,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function useDashboardSummary(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["hr-dashboard-summary", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hr_dashboard_summary")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as HrDashboardSummaryView | null;
    },
  });
}

function useMonthlyAttendance(organizationId: string | undefined, month: string) {
  return useQuery({
    queryKey: ["hr-attendance-monthly", organizationId, month],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hr_attendance_monthly")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", `${month}-01`)
        .order("employee_name");
      if (error) throw error;
      return (data as HrAttendanceMonthlyView[]) ?? [];
    },
  });
}

function useLatestPerformance(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["hr-latest-performance", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hr_latest_performance")
        .select("*")
        .eq("organization_id", organizationId)
        .order("overall_score", { ascending: false });
      if (error) throw error;
      return (data as HrLatestPerformanceView[]) ?? [];
    },
  });
}

function useLeaveBalances(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["leave-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_leave_balances_current_year")
        .select("*")
        .eq("organization_id", organizationId)
        .order("employee_name");
      if (error) throw error;
      return (data as LeaveBalanceCurrentYearView[]) ?? [];
    },
  });
}

function useExpiringContracts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["hr-expiring-contracts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_employee_contracts_status")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("end_date");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function SummaryCards({ organizationId }: { organizationId: string | undefined }) {
  const summary = useDashboardSummary(organizationId);
  const s = summary.data;
  const cards = [
    { label: "موظفون نشطون", value: s?.active_employees_count ?? 0, icon: Users, color: "text-blue-600" },
    { label: "طلبات إجازة معلَّقة", value: s?.pending_leave_requests_count ?? 0, icon: CalendarCheck2, color: "text-amber-600" },
    { label: "عقود تنتهي خلال 30 يومًا", value: s?.contracts_expiring_soon_count ?? 0, icon: FileCheck2, color: "text-red-600" },
    { label: "مرشحون قيد المعالجة", value: s?.open_candidates_count ?? 0, icon: UserPlus, color: "text-purple-600" },
    { label: "متوسط تقييم الدورة الحالية", value: s?.avg_open_cycle_score ?? "—", icon: Gauge, color: "text-emerald-600" },
    { label: "ساعات تدريب هذا العام", value: s?.training_hours_this_year ?? 0, icon: GraduationCap, color: "text-cyan-600" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-3 py-4">
            <c.icon className={`h-5 w-5 ${c.color}`} />
            <div>
              <p className="text-xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AttendanceReportTab({ organizationId }: { organizationId: string | undefined }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const monthly = useMonthlyAttendance(organizationId, month);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">ملخص الحضور الشهري</CardTitle>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>حاضر</TableHead>
              <TableHead>متأخر</TableHead>
              <TableHead>غائب</TableHead>
              <TableHead>إجازة</TableHead>
              <TableHead>إجمالي دقائق التأخير</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(monthly.data ?? []).map((r) => (
              <TableRow key={r.employee_id}>
                <TableCell className="font-medium">{r.employee_name}</TableCell>
                <TableCell className="text-emerald-600">{r.present_days}</TableCell>
                <TableCell className="text-amber-600">{r.late_days}</TableCell>
                <TableCell className="text-red-600">{r.absent_days}</TableCell>
                <TableCell>{r.on_leave_days}</TableCell>
                <TableCell>{r.total_late_minutes}</TableCell>
              </TableRow>
            ))}
            {(monthly.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد سجلات حضور لهذا الشهر.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LeaveReportTab({ organizationId }: { organizationId: string | undefined }) {
  const balances = useLeaveBalances(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تقرير الإجازات (السنة الحالية)</CardTitle>
        <CardDescription>نفس عرض الأرصدة المستخدَم في شاشة الإجازات — معاد استخدامه هنا كتقرير بلا أي تكرار للبيانات</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>نوع الإجازة</TableHead>
              <TableHead>المستحق</TableHead>
              <TableHead>المستخدم</TableHead>
              <TableHead>المتبقي</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(balances.data ?? []).map((b) => (
              <TableRow key={`${b.employee_id}-${b.leave_type_id}`}>
                <TableCell className="font-medium">{b.employee_name}</TableCell>
                <TableCell>{b.leave_type_name}</TableCell>
                <TableCell>{b.entitled_days}</TableCell>
                <TableCell>{b.used_days}</TableCell>
                <TableCell className={b.remaining_days <= 0 ? "text-destructive" : "text-emerald-600"}>{b.remaining_days}</TableCell>
              </TableRow>
            ))}
            {(balances.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد أرصدة إجازات بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ContractsReportTab({ organizationId }: { organizationId: string | undefined }) {
  const contracts = useExpiringContracts(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تقرير العقود النشطة</CardTitle>
        <CardDescription>العقود التي تنتهي خلال 30 يومًا مُميَّزة — وتظهر أيضًا في شاشة التنبيهات الموحَّدة تلقائيًا</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>الانتهاء</TableHead>
              <TableHead>الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(contracts.data ?? []).map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.employee_name}</TableCell>
                <TableCell className="text-xs">{c.end_date ?? "غير محدد المدة"}</TableCell>
                <TableCell>
                  {c.expiring_within_30_days && <Badge variant="destructive">ينتهي قريبًا</Badge>}
                  {c.is_overdue_for_renewal && <Badge variant="destructive">متأخر عن التجديد</Badge>}
                  {!c.expiring_within_30_days && !c.is_overdue_for_renewal && <Badge variant="success">ساري</Badge>}
                </TableCell>
              </TableRow>
            ))}
            {(contracts.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد عقود نشطة.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PerformanceReportTab({ organizationId }: { organizationId: string | undefined }) {
  const latest = useLatestPerformance(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تقرير آخر تقييم أداء لكل موظف</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>الدورة</TableHead>
              <TableHead>الدرجة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(latest.data ?? []).map((r) => (
              <TableRow key={r.employee_id}>
                <TableCell className="font-medium">{r.employee_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.cycle_name}</TableCell>
                <TableCell>
                  <Badge variant={r.overall_score >= 4 ? "success" : r.overall_score >= 2.5 ? "default" : "destructive"}>
                    {r.overall_score} / 5
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {(latest.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد تقييمات بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function HrReports() {
  const { organization } = useOrganizationAccess();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BarChart3 className="h-6 w-6" /> تقارير الموارد البشرية
        </h1>
        <p className="text-sm text-muted-foreground">لوحة ملخص شاملة تجمع كل موديولات الموارد البشرية الموسّعة في مكان واحد — بلا أي جدول إضافي</p>
      </div>

      <SummaryCards organizationId={organization?.id} />

      <Tabs defaultValue="attendance">
        <TabsList>
          <TabsTrigger value="attendance">الحضور</TabsTrigger>
          <TabsTrigger value="leave">الإجازات</TabsTrigger>
          <TabsTrigger value="contracts">العقود</TabsTrigger>
          <TabsTrigger value="performance">الأداء</TabsTrigger>
        </TabsList>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceReportTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="leave" className="mt-4">
          <LeaveReportTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="contracts" className="mt-4">
          <ContractsReportTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceReportTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
