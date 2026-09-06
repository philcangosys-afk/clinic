import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PlugZap, RefreshCcw } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * التكاملات — المرحلة 30.
 *
 * هذه الشاشة **لا ترسل شيئًا بنفسها**، ولا تحمل مفتاحًا سريًّا. الإرسال
 * الفعلي يتمّ من دالّة خلفية محميّة تقرأ أسرارها من بيئتها، والمتصفّح لا
 * يلمس بيانات مريض ولا مفتاحًا. ما هنا: حالة صندوقَي الإرسال، وما مات
 * منها ولماذا، وإعادة إرسال ما أُصلح سببه — بقرار إنسان وبسبب مكتوب.
 */
const INTEGRATIONS: Record<string, string> = {
  zatca: "الفوترة الإلكترونية (زاتكا)",
  nphies: "نفيس (التأمين)",
  lab_analyzer: "أجهزة المختبر",
  his_hl7: "أنظمة صحية (HL7)",
  accounting_export: "تصدير محاسبي",
  webhook: "ويب هوك",
};

export default function Integrations() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">التكاملات</h1>
        <p className="text-sm text-muted-foreground">
          حالة الإرسال إلى الجهات الخارجية، وما توقّف منها ولماذا
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          الإرسال يتمّ من خدمة خلفية محميّة، لا من هذه الشاشة: **لا تُوضع
          المفاتيح ولا الشهادات في قاعدة البيانات** — يُسجَّل اسم المرجع فقط،
          وقيمته في بيئة الدالّة الخلفية. ولا يوجد تكامل رسائل نصية في النظام.
        </span>
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">حالة الإرسال</TabsTrigger>
          <TabsTrigger value="dead">رسائل متوقّفة</TabsTrigger>
          <TabsTrigger value="settings">العناوين</TabsTrigger>
        </TabsList>
        <TabsContent value="health" className="mt-4"><HealthPanel /></TabsContent>
        <TabsContent value="dead" className="mt-4"><DeadLettersPanel /></TabsContent>
        <TabsContent value="settings" className="mt-4"><EndpointsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * حالة الإرسال
 * ════════════════════════════════════════════════════════════════════════ */
function HealthPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const health = useQuery({
    queryKey: ["integration-health", organization?.id],
    enabled: Boolean(organization?.id),
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_integration_health").select("*")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const check = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_check_integration_health", {
        p_org: organization!.id, p_minutes: 60,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["integration-health", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["notification-summary", organization?.id] });
      /**
       * «أُرسل تنبيه» تُقال عن العالق وحده.
       *
       * الدالّة تُعيد رقمًا واحدًا هو (عالق + متوقّف نهائيًّا) لكنها تستدعي
       * `app_notify_event` داخل `if v_stuck > 0` فقط. فكانت الواجهة تدّعي إرسال
       * تنبيه عن رسائل متوقّفة نهائيًّا لا تنبيه لها — فيظنّ المستخدم أنه أبلغ
       * من يتابع التكاملات وهو لم يُبلَّغ. المتوقّف نهائيًّا معروف من المنظور،
       * فيُشتقّ منه العالق حتى تُصلَح الدالّة فتُعيد الرقمين.
       */
      const dead = (health.data ?? []).reduce((sum, r) => sum + Number(r.dead_count ?? 0), 0);
      const stuck = Math.max(0, Number(count ?? 0) - dead);
      toast({
        title: count ? `${count} رسالة تحتاج انتباهًا` : "لا رسائل عالقة",
        description: !count
          ? undefined
          : stuck > 0
            ? `منها ${stuck} عالقة — أُرسل عنها تنبيه لمن يتابع التكاملات`
            : "كلّها متوقّفة نهائيًّا ولا يُرسَل عنها تنبيه — راجع تبويب «رسائل متوقّفة»",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الفحص",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const unscheduled = (health.data ?? []).reduce(
    (sum, r) => sum + Number(r.unscheduled_count ?? 0), 0,
  );

  return (
    <div className="flex flex-col gap-4">
      {unscheduled > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>{unscheduled}</strong> رسالة حاولت الإرسال ولا موعد لإعادة
            محاولتها — وهي أخطر من الفاشلة لأنها منسيّة.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">حالة صناديق الإرسال</CardTitle>
            <CardDescription>
              الفاتورة التي لم تصل زاتكا اليوم مخالفةٌ بعد أيام.
            </CardDescription>
          </div>
          <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
            <RefreshCcw className="h-4 w-4" />
            فحص العالق
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {health.isLoading && <Skeleton className="h-32 w-full" />}
          {!health.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التكامل</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>قيد الإرسال</TableHead>
                  <TableHead>متوقّفة نهائيًّا</TableHead>
                  <TableHead>بلا موعد إعادة</TableHead>
                  <TableHead>آخر محاولة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(health.data ?? []).map((r) => (
                  <TableRow key={r.integration_key}>
                    <TableCell className="text-sm">
                      {INTEGRATIONS[r.integration_key] ?? r.integration_key}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.total}</TableCell>
                    <TableCell className="font-mono text-xs">{r.open_count}</TableCell>
                    <TableCell>
                      {Number(r.dead_count) > 0
                        ? <Badge variant="destructive">{r.dead_count}</Badge>
                        : <span className="font-mono text-xs">0</span>}
                    </TableCell>
                    <TableCell>
                      {Number(r.unscheduled_count) > 0
                        ? <Badge variant="destructive">{r.unscheduled_count}</Badge>
                        : <span className="font-mono text-xs">0</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.last_attempt_at
                        ? new Date(r.last_attempt_at).toLocaleString("ar-SA")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(health.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا رسائل تكامل بعد.
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

/* ══════════════════════════════════════════════════════════════════════════
 * الرسائل المتوقّفة
 * ════════════════════════════════════════════════════════════════════════ */
function DeadLettersPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [requeueing, setRequeueing] = useState<any | null>(null);
  const [reason, setReason] = useState("");

  const rows = useQuery({
    queryKey: ["integration-dead-letters", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_integration_dead_letters").select("*")
        .eq("organization_id", organization!.id)
        .order("dead_lettered_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const requeue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_requeue_integration_message", {
        p_kind: requeueing.kind, p_id: requeueing.id, p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-dead-letters", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["integration-health", organization?.id] });
      setRequeueing(null); setReason("");
      toast({ title: "أُعيدت الرسالة إلى الطابور" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذرت الإعادة",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">رسائل توقّفت نهائيًّا</CardTitle>
          <CardDescription>
            استنفدت محاولاتها. **أصلح السبب أوّلًا ثم أعِد الإرسال** — الإعادة
            بلا إصلاح تستهلك المحاولات من جديد وتنتهي إلى الموضع نفسه.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.isLoading && <Skeleton className="h-32 w-full" />}
          {!rows.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التكامل</TableHead>
                  <TableHead>المحاولات</TableHead>
                  <TableHead>سبب الفشل</TableHead>
                  <TableHead>توقّفت في</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows.data ?? []).map((r) => (
                  <TableRow key={`${r.kind}-${r.id}`}>
                    <TableCell className="text-sm">
                      {INTEGRATIONS[r.integration_key] ?? r.integration_key}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.attempt_count}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                      {r.last_error ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.dead_lettered_at
                        ? new Date(r.dead_lettered_at).toLocaleString("ar-SA")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      {can("integrations.retry") && (
                        <Button size="sm" variant="outline"
                                onClick={() => { setRequeueing(r); setReason(""); }}>
                          إعادة الإرسال
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(rows.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا رسائل متوقّفة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(requeueing)} onOpenChange={(o) => !o && setRequeueing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعادة إرسال رسالة</DialogTitle>
            <DialogDescription>
              سبب الفشل الأخير: {requeueing?.last_error ?? "غير مسجَّل"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>ما الذي أُصلح؟ *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={!reason.trim() || requeue.isPending}
                    onClick={() => requeue.mutate()}>
              إعادة إلى الطابور
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * العناوين
 * ════════════════════════════════════════════════════════════════════════ */
function EndpointsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [key, setKey] = useState("zatca");
  const [environment, setEnvironment] = useState("sandbox");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [secretRef, setSecretRef] = useState("");

  const endpoints = useQuery({
    queryKey: ["integration-settings", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_settings").select("*")
        .eq("organization_id", organization!.id)
        .order("integration_key");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("integration_settings").insert({
        organization_id: organization!.id,
        integration_key: key,
        environment,
        base_url: baseUrl.trim(),
        secret_ref: secretRef.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-settings", organization?.id] });
      setBaseUrl("https://"); setSecretRef("");
      toast({ title: "أُضيف عنوان التكامل" });
    },
    onError: fail("تعذرت الإضافة"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("integration_settings")
        .update({ is_active: active, updated_at: new Date().toISOString() })
        .eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-settings", organization?.id] });
    },
    onError: fail("تعذر التحديث"),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">عناوين التكامل</CardTitle>
        <CardDescription>
          العنوان يجب أن يكون **https**، و«اسم المرجع» اسمٌ فقط — القاعدة ترفض
          أيّ قيمة تبدو مفتاحًا أو شهادة، لأن ما يُخزَّن هنا تقرؤه الواجهة.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {can("integrations.manage") && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex w-48 flex-col gap-1.5">
              <Label>التكامل</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INTEGRATIONS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-36 flex-col gap-1.5">
              <Label>البيئة</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">تجريبية</SelectItem>
                  <SelectItem value="production">إنتاج</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <Label>العنوان</Label>
              <Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="flex w-48 flex-col gap-1.5">
              <Label>اسم المرجع</Label>
              <Input dir="ltr" value={secretRef} onChange={(e) => setSecretRef(e.target.value)}
                     placeholder="ZATCA_PROD_CERT" />
            </div>
            <Button disabled={!baseUrl.trim() || add.isPending} onClick={() => add.mutate()}>
              إضافة
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التكامل</TableHead>
                <TableHead>البيئة</TableHead>
                <TableHead>العنوان</TableHead>
                <TableHead>اسم المرجع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(endpoints.data ?? []).map((e) => (
                <TableRow key={e.id} className={e.is_active ? undefined : "opacity-60"}>
                  <TableCell className="text-sm">
                    {INTEGRATIONS[e.integration_key] ?? e.integration_key}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.environment === "production" ? "إنتاج" : "تجريبية"}
                  </TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs" dir="ltr">
                    {e.base_url}
                  </TableCell>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {e.secret_ref ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.is_active ? "success" : "secondary"}>
                      {e.is_active ? "مفعَّل" : "معطَّل"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {can("integrations.manage") && (
                      <Button size="sm" variant="ghost" disabled={toggle.isPending}
                              onClick={() => toggle.mutate({ id: e.id, active: !e.is_active })}>
                        {e.is_active ? "تعطيل" : "تفعيل"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(endpoints.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا عناوين مسجّلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
