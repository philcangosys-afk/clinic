import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BellRing, Inbox, Settings2, TriangleAlert } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { isNotificationSoundOn, setNotificationSound } from "@/components/layout/LiveNotifier";
import { hasArabicVoice, isNotificationVoiceOn, isSpeechSupported, setNotificationVoice } from "@/lib/speech";

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
  // المرحلتان 21 و22: الأجهزة ومستنداتها ومستندات المرضى والكيانات
  asset_warranty_expiry: "ضمان جهاز",
  asset_service_contract_expiry: "عقد صيانة جهاز",
  asset_calibration_due: "معايرة جهاز",
  patient_document_expiry: "مستند مريض",
  entity_document_expiry: "مستند كيان",
};

const ALERT_TYPE_PATHS: Record<string, string> = {
  facility_license: "/licenses",
  inventory_lot_expiry: "/inventory",
  employee_document_expiry: "/contracts",
  insurance_membership_expiry: "/insurance",
  employee_contract_expiry: "/contracts",
  asset_warranty_expiry: "/assets",
  asset_service_contract_expiry: "/assets",
  asset_calibration_due: "/assets",
  patient_document_expiry: "/documents",
  entity_document_expiry: "/documents",
};

const CATEGORY_LABELS: Record<string, string> = {
  clinical: "سريري",
  financial: "مالي",
  operational: "تشغيلي",
  inventory: "مخزون",
  hr: "موارد بشرية",
  compliance: "التزام ورقابة",
  system: "النظام",
};

const SEVERITY: Record<string, { label: string; variant: any }> = {
  info: { label: "معلومة", variant: "secondary" },
  warning: { label: "تحذير", variant: "default" },
  critical: { label: "حرِج", variant: "destructive" },
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

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "خطأ غير متوقع";

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm font-medium text-destructive">تعذر تحميل البيانات</p>
      <p className="max-w-xl text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={retry}>إعادة المحاولة</Button>
    </div>
  );
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
          ما يصلك من أحداث النظام، وما يوشك على الانتهاء — والقواعد التي تحدّد
          من يصله كل تنبيه
        </p>
      </div>

      <Tabs defaultValue="inbox" dir="rtl">
        <TabsList className="flex w-full justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="rules">قواعد التوجيه</TabsTrigger>
          <TabsTrigger value="expiry">ما يوشك على الانتهاء</TabsTrigger>
          <TabsTrigger value="inbox">صندوق تنبيهاتي</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4"><RoutingRules /></TabsContent>

        <TabsContent value="expiry" className="mt-4 flex flex-col gap-4">
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
          <div className="mt-2 flex flex-wrap justify-start gap-2">
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
          {alerts.isError && <QueryError error={alerts.error} retry={() => void alerts.refetch()} />}
          {!alerts.isLoading && !alerts.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>البند</TableHead>
                  <TableHead>تاريخ الانتهاء</TableHead>
                  <TableHead>المتبقي</TableHead>
                  <TableHead />
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
                      <TableCell className="text-end">
                        {ALERT_TYPE_PATHS[row.alert_type] && (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={ALERT_TYPE_PATHS[row.alert_type]}>فتح القسم</Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد تنبيهات ضمن النطاق المختار.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="inbox" className="mt-4"><NotificationInbox /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * صندوق تنبيهاتي — المرحلة 23
 * ════════════════════════════════════════════════════════════════════════ */
function NotificationInbox() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [soundOn, setSoundOn] = useState(isNotificationSoundOn);
  const [voiceOn, setVoiceOn] = useState(isNotificationVoiceOn);

  const notifications = useQuery({
    queryKey: ["my-notifications", organization?.id],
    enabled: Boolean(organization?.id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_my_notifications").select("*")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const preferences = useQuery({
    queryKey: ["notification-preferences", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences").select("category, is_muted")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-notifications", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["notification-summary", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["notification-preferences", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_mark_notification_read", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: fail("تعذر التعليم كمقروء"),
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_mark_all_notifications_read", {
        p_org: organization!.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: fail("تعذر التعليم"),
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_dismiss_notification", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: fail("تعذر الإخفاء"),
  });

  const mute = useMutation({
    mutationFn: async ({ category, muted }: { category: string; muted: boolean }) => {
      const { error } = await supabase.rpc("app_set_notification_preference", {
        p_org: organization!.id, p_category: category, p_muted: muted,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "حُدّثت التفضيلات",
        description: "التنبيه الحرِج يصلك دائمًا ولو كُتمت فئته",
      });
    },
    onError: fail("تعذر الحفظ"),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_generate_expiry_notifications", {
        p_org: organization!.id, p_days: 180,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      invalidate();
      toast({
        title: `وُلّد ${count ?? 0} تنبيه انتهاء`,
        description: "تكرار التوليد لا يضاعف التنبيهات",
      });
    },
    onError: fail("تعذر التوليد"),
  });

  const muted = new Set(
    (preferences.data ?? []).filter((p) => p.is_muted).map((p) => p.category),
  );
  const rows = (notifications.data ?? []).filter((n) => !onlyUnread || n.is_unread);
  const unread = (notifications.data ?? []).filter((n) => n.is_unread).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4" />
              صندوق تنبيهاتي
              {unread > 0 && <Badge variant="destructive">{unread} غير مقروء</Badge>}
            </CardTitle>
            <CardDescription>
              ما يخصّك أنت وفق صلاحياتك — لا يراه غيرك.
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-start gap-2">
            <Button variant="ghost" onClick={() => setOnlyUnread((v) => !v)}>
              {onlyUnread ? "عرض الكل" : "غير المقروء فقط"}
            </Button>
            <Button
              variant="outline"
              title="صوت التنبيه الجديد على هذا الجهاز"
              onClick={() => {
                setNotificationSound(!soundOn);
                setSoundOn(!soundOn);
              }}
            >
              {soundOn ? "الصوت: مفعّل" : "الصوت: مكتوم"}
            </Button>
            {/* قراءة التنبيه بالعربي (0224): «دكتور أمجد، لديك مريض جديد…» */}
            <Button
              variant="outline"
              title={
                !isSpeechSupported()
                  ? "المتصفّح لا يدعم النطق"
                  : hasArabicVoice()
                    ? "قراءة التنبيه بالصوت على هذا الجهاز"
                    : "لا يوجد صوت عربي في هذا الجهاز — ثبّت اللغة العربية في إعدادات ويندوز (الكلام) أو استخدم كروم"
              }
              disabled={!isSpeechSupported()}
              onClick={() => {
                setNotificationVoice(!voiceOn);
                setVoiceOn(!voiceOn);
                if (!voiceOn && "speechSynthesis" in window) {
                  const u = new SpeechSynthesisUtterance("تم تفعيل قراءة التنبيهات بالصوت");
                  u.lang = "ar-SA";
                  window.speechSynthesis.speak(u);
                }
              }}
            >
              {voiceOn ? "النطق: مفعّل" : "النطق: مكتوم"}
            </Button>
            <Button variant="outline" disabled={generate.isPending}
                    onClick={() => generate.mutate()}>
              توليد تنبيهات الانتهاء
            </Button>
            <Button disabled={unread === 0 || markAll.isPending}
                    onClick={() => markAll.mutate()}>
              تعليم الكل كمقروء
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {notifications.isLoading && <Skeleton className="h-40 w-full" />}
          {notifications.isError && (
            <QueryError error={notifications.error} retry={() => void notifications.refetch()} />
          )}
          {!notifications.isLoading && !notifications.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التنبيه</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>الخطورة</TableHead>
                  <TableHead>الوقت</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((n) => (
                  <TableRow key={n.id} className={n.is_unread ? "font-medium" : "opacity-70"}>
                    <TableCell className="max-w-96">
                      <span className="block truncate">{n.title}</span>
                      {n.body && (
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {CATEGORY_LABELS[n.category] ?? n.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY[n.severity]?.variant ?? "secondary"}>
                        {SEVERITY[n.severity]?.label ?? n.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(n.created_at).toLocaleString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {n.action_path && (
                          <Link to={n.action_path}>
                            <Button variant="ghost" size="sm">فتح</Button>
                          </Link>
                        )}
                        {n.is_unread && (
                          <Button variant="ghost" size="sm"
                                  onClick={() => markRead.mutate(n.id)}>
                            مقروء
                          </Button>
                        )}
                        <Button variant="ghost" size="sm"
                                onClick={() => dismiss.mutate(n.id)}>
                          إخفاء
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا تنبيهات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">فئات أتابعها</CardTitle>
          <CardDescription>
            كتم فئة يوقف تنبيهاتها العادية عنك — **أمّا الحرِج فيصلك دائمًا**.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-start gap-2 text-start">
          {preferences.isLoading && <Skeleton className="h-10 w-full" />}
          {preferences.isError && (
            <QueryError error={preferences.error} retry={() => void preferences.refetch()} />
          )}
          {!preferences.isLoading && !preferences.isError && Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <Button
              key={key}
              variant={muted.has(key) ? "outline" : "default"}
              size="sm"
              disabled={mute.isPending}
              onClick={() => mute.mutate({ category: key, muted: !muted.has(key) })}
            >
              {label} {muted.has(key) ? "— مكتومة" : ""}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * قواعد التوجيه
 * ════════════════════════════════════════════════════════════════════════ */
function RoutingRules() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const rules = useQuery({
    queryKey: ["notification-rules", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_rules").select("*")
        .eq("organization_id", organization!.id)
        .order("category").order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("notification_rules").update({ is_active: active, updated_at: new Date().toISOString() })
        .eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", organization?.id] });
      toast({ title: "حُدّثت القاعدة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التحديث",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" />
          قواعد التوجيه
        </CardTitle>
        <CardDescription>
          التنبيه يُوجَّه **بالصلاحية لا بالاسم**: من يملك صلاحية اعتماد
          الرواتب هو من يُنبَّه، فلا يضيع التنبيه عند تغيّر الموظف.
          القناة الوحيدة المتاحة الآن داخل النظام — لا رسائل خارجية.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rules.isLoading && <Skeleton className="h-40 w-full" />}
        {rules.isError && <QueryError error={rules.error} retry={() => void rules.refetch()} />}
        {!rules.isLoading && !rules.isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحدث</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>الخطورة</TableHead>
                <TableHead>يُوجَّه إلى</TableHead>
                <TableHead>القناة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules.data ?? []).map((r) => (
                <TableRow key={r.id} className={r.is_active ? undefined : "opacity-60"}>
                  <TableCell className="text-sm">
                    {r.name_ar}
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {r.event_key}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {CATEGORY_LABELS[r.category] ?? r.category}
                  </TableCell>
                  <TableCell>
                    <Badge variant={SEVERITY[r.severity]?.variant ?? "secondary"}>
                      {SEVERITY[r.severity]?.label ?? r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.target_permission ?? r.target_role_key ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">داخل النظام</TableCell>
                  <TableCell className="text-end">
                    {can("notifications.manage") && (
                      <Button
                        variant={r.is_active ? "ghost" : "outline"}
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: r.id, active: !r.is_active })}
                      >
                        {r.is_active ? "تعطيل" : "تفعيل"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(rules.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا قواعد توجيه.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
