import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Info, RefreshCcw, ShieldCheck } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * جاهزية الإطلاق — المرحلة 32.
 *
 * **ليست قائمة مهام تُشطب باليد.** قائمةٌ تُشطب يدويًّا تقول ما ادّعاه من
 * شطبها لا ما في النظام. كل سطر هنا يُحسب من قاعدة البيانات لحظة فتح
 * الشاشة: لا خانة تُعلَّم، ولا شيء يبقى «مكتملًا» بعد أن يتغيّر ما بُني عليه.
 * وإن حُذفت قائمة الأسعار غدًا عاد السطر أحمر من تلقاء نفسه.
 */
const LINKS: Record<string, string> = {
  branches: "/organization-settings",
  clinics: "/departments",
  doctors: "/doctors",
  services: "/services",
  base_price_list: "/price-lists",
  chart_of_accounts: "/accounting",
  open_fiscal_period: "/accounting",
  vat_settings: "/operations-settings",
  owners: "/users",
  duty_conflicts: "/users",
  critical_open: "/doctor-workspace",
  consents_missing: "/documents",
  severe_incidents: "/quality",
  stale_visits: "/doctor-workspace",
  overdue_calibration: "/assets",
  expired_stock: "/inventory",
  integration_dead: "/integrations",
  translation_gap: "/operations-settings",
  invalid_ids: "/patients",
};

export default function LaunchReadiness() {
  const { organization } = useOrganizationAccess();

  const checks = useQuery({
    queryKey: ["launch-readiness", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_launch_readiness", {
        p_org: organization!.id,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = checks.data ?? [];
  const blockers = rows.filter((r) => r.severity === "blocker" && !r.is_ok);
  const warnings = rows.filter((r) => r.severity === "warning" && !r.is_ok);
  const passed = rows.filter((r) => r.is_ok && r.severity !== "info");
  const info = rows.filter((r) => r.severity === "info");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">جاهزية الإطلاق</h1>
          <p className="text-sm text-muted-foreground">
            محسوبة من بياناتك لحظة فتح الشاشة — لا قائمة تُشطب باليد
          </p>
        </div>
        <Button variant="outline" onClick={() => checks.refetch()}>
          <RefreshCcw className="h-4 w-4" />
          إعادة الفحص
        </Button>
      </div>

      {checks.isLoading && <Skeleton className="h-64 w-full" />}

      {!checks.isLoading && (
        <>
          <Card className={blockers.length > 0 ? "border-destructive" : "border-emerald-500"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {blockers.length > 0
                  ? <CircleAlert className="h-5 w-5 text-destructive" />
                  : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
                {blockers.length > 0
                  ? `${blockers.length} مانع يجب حلّه قبل التشغيل`
                  : "لا موانع — النظام جاهز للتشغيل"}
              </CardTitle>
              <CardDescription>
                المانع يعني أن العمل به يُنتج بيانات خاطئة أو مخالفة نظامية،
                لا مجرّد نقصٍ في الشكل.
              </CardDescription>
            </CardHeader>
            {blockers.length > 0 && (
              <CardContent className="flex flex-col gap-2">
                {blockers.map((r) => (
                  <CheckRow key={r.check_key} row={r} />
                ))}
              </CardContent>
            )}
          </Card>

          {warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{warnings.length} تحذيرًا</CardTitle>
                <CardDescription>
                  يعمل النظام بها، لكنها نقصٌ سيُكلّف لاحقًا.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {warnings.map((r) => (
                  <CheckRow key={r.check_key} row={r} />
                ))}
              </CardContent>
            </Card>
          )}

          {passed.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {passed.length} فحصًا مكتملًا
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {passed.map((r) => (
                  <div key={r.check_key}
                       className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      {r.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.detail}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {info.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="h-4 w-4" />
                  للعلم
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {info.map((r) => (
                  <div key={r.check_key} className="rounded-lg border px-3 py-2">
                    <span className="block text-xs text-muted-foreground">{r.title}</span>
                    <span className="text-lg font-bold">{r.item_count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function CheckRow({ row }: { row: any }) {
  const to = LINKS[row.check_key];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Badge variant={row.severity === "blocker" ? "destructive" : "secondary"}>
            {row.severity === "blocker" ? "مانع" : "تحذير"}
          </Badge>
          {row.title}
        </span>
        <span className="block text-xs text-muted-foreground">{row.detail}</span>
      </div>
      {to && (
        <Link to={to}>
          <Button size="sm" variant="ghost">فتح الشاشة</Button>
        </Link>
      )}
    </div>
  );
}
