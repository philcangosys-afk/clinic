import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, TriangleAlert } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * التنبيهات الموحّدة (لقطة 80).
 *
 * العرض `expiring_alerts` يجمع خمسة مصادر انتهاء صلاحية بـ UNION ALL
 * (تراخيص المنشأة، دفعات المخزون، وثائق الموظفين، عضويات التأمين، عقود
 * الموظفين) — لكنه كان يُستخدم كعدّاد رقمي واحد فقط في لوحة التحكم، فلا
 * يعرف المستخدم ما الذي يوشك على الانتهاء ولا يستطيع التصرف.
 *
 * "عرض قبل: N يوم" المذكور في اللقطة مطبَّق هنا كفلتر على مستوى كل الأنواع.
 */
type AlertRow = {
  organization_id: string;
  alert_type: string;
  title: string;
  expires_on: string;
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  facility_license: "ترخيص منشأة",
  inventory_lot_expiry: "صلاحية دفعة مخزون",
  employee_document_expiry: "وثيقة موظف",
  insurance_membership_expiry: "عضوية تأمين",
  employee_contract_expiry: "عقد موظف",
};

const WINDOWS = [
  { value: "30", label: "خلال 30 يومًا" },
  { value: "60", label: "خلال 60 يومًا" },
  { value: "90", label: "خلال 90 يومًا" },
  { value: "180", label: "خلال 180 يومًا" },
  { value: "all", label: "كل التنبيهات" },
];

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function useAlerts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["expiring-alerts-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expiring_alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("expires_on");
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });
}

export default function Alerts() {
  const { organization } = useOrganizationAccess();
  const alerts = useAlerts(organization?.id);
  const [windowDays, setWindowDays] = useState("90");
  const [typeFilter, setTypeFilter] = useState("all");

  const rows = useMemo(() => {
    let list = alerts.data ?? [];
    if (typeFilter !== "all") list = list.filter((row) => row.alert_type === typeFilter);
    if (windowDays !== "all") {
      const limit = Number(windowDays);
      list = list.filter((row) => daysUntil(row.expires_on) <= limit);
    }
    return list;
  }, [alerts.data, windowDays, typeFilter]);

  const expiredCount = rows.filter((row) => daysUntil(row.expires_on) < 0).length;

  const statusOf = (dateStr: string) => {
    const days = daysUntil(dateStr);
    if (days < 0) return { label: `منتهٍ منذ ${Math.abs(days)} يومًا`, variant: "destructive" as const };
    if (days === 0) return { label: "ينتهي اليوم", variant: "destructive" as const };
    if (days <= 30) return { label: `${days} يومًا`, variant: "destructive" as const };
    if (days <= 90) return { label: `${days} يومًا`, variant: "warning" as const };
    return { label: `${days} يومًا`, variant: "success" as const };
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">التنبيهات</h1>
        <p className="text-sm text-muted-foreground">
          كل ما يوشك على الانتهاء في مكان واحد — تراخيص، مخزون، وثائق وعقود الموظفين، عضويات التأمين
        </p>
      </div>

      {expiredCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            يوجد <strong>{expiredCount}</strong> بند منتهي الصلاحية ضمن النطاق المعروض.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            قائمة التنبيهات
          </CardTitle>
          <CardDescription>مرتَّبة بالأقرب انتهاءً أولًا</CardDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.isLoading && <Skeleton className="h-40 w-full" />}
          {!alerts.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>البند</TableHead>
                  <TableHead>تاريخ الانتهاء</TableHead>
                  <TableHead>المتبقي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const status = statusOf(row.expires_on);
                  return (
                    <TableRow key={`${row.alert_type}-${row.title}-${row.expires_on}-${index}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {ALERT_TYPE_LABELS[row.alert_type] ?? row.alert_type}
                      </TableCell>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell className="text-sm">{row.expires_on}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد تنبيهات ضمن النطاق المختار.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
