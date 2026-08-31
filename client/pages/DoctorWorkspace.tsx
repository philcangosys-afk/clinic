import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertOctagon, ClipboardList, PhoneCall, Stethoscope } from "lucide-react";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * مساحة عمل الطبيب — المرحلة 25.
 *
 * قلب هذه الشاشة تبويب **القيم الحرجة**: النظام كان يعلّم النتيجة الحرجة
 * (`is_critical`) ولا يُلزم أحدًا بأن يعرف. الآن كل قيمة حرجة بلاغٌ مفتوح
 * حتى يُقِرّ به طبيبٌ **بإعادة قراءتها نصًّا** وذكر ما فعله — وما لا يُقَرّ
 * به خلال المهلة يُصعَّد.
 */
export default function DoctorWorkspace() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">مساحة عمل الطبيب</h1>
        <p className="text-sm text-muted-foreground">
          القيم الحرجة أولًا، ثم يومك ومرضاك وزياراتك التي لم تُغلق
        </p>
      </div>

      <Tabs defaultValue="critical">
        <TabsList>
          <TabsTrigger value="critical">القيم الحرجة</TabsTrigger>
          <TabsTrigger value="today">يومي</TabsTrigger>
          <TabsTrigger value="open">زيارات لم تُغلق</TabsTrigger>
        </TabsList>
        <TabsContent value="critical" className="mt-4"><CriticalPanel /></TabsContent>
        <TabsContent value="today" className="mt-4"><TodayPanel /></TabsContent>
        <TabsContent value="open" className="mt-4"><OpenVisitsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * القيم الحرجة
 * ════════════════════════════════════════════════════════════════════════ */
function CriticalPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [acking, setAcking] = useState<any | null>(null);
  const [readBack, setReadBack] = useState("");
  const [action, setAction] = useState("");
  const [phoning, setPhoning] = useState<any | null>(null);
  const [calledTo, setCalledTo] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const results = useQuery({
    queryKey: ["critical-results", organization?.id],
    enabled: Boolean(organization?.id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_critical_results").select("*")
        .eq("organization_id", organization!.id)
        .order("detected_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["critical-results", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["notification-summary", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const acknowledge = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_acknowledge_critical_result", {
        p_id: acking.id, p_read_back: readBack.trim(), p_action: action.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setAcking(null); setReadBack(""); setAction("");
      toast({ title: "سُجّل الإقرار بإعادة القراءة والإجراء" });
    },
    onError: fail("تعذر الإقرار"),
  });

  const phone = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_record_critical_phone_call", {
        p_id: phoning.id, p_called: calledTo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setPhoning(null); setCalledTo("");
      toast({ title: "وُثّق الإبلاغ الهاتفي" });
    },
    onError: fail("تعذر التوثيق"),
  });

  const escalate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_escalate_critical_results", {
        p_org: organization!.id, p_minutes: 30,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      invalidate();
      toast({
        title: count ? `صُعّد ${count} بلاغًا متأخّرًا` : "لا بلاغات متأخّرة",
      });
    },
    onError: fail("تعذر التصعيد"),
  });

  const rows = (results.data ?? []).filter((r) => showClosed || r.is_open);
  const open = (results.data ?? []).filter((r) => r.is_open).length;

  return (
    <div className="flex flex-col gap-4">
      {open > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            يوجد <strong>{open}</strong> قيمة حرجة لم يُقَرّ بها بعد. البلاغ يبقى
            مفتوحًا حتى يقرأها طبيبٌ ويذكر ما فعله.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertOctagon className="h-4 w-4" />
              القيم الحرجة
            </CardTitle>
            <CardDescription>
              الإقرار يشترط **إعادة قراءة القيمة نصًّا** وذكر الإجراء — إقرارٌ
              بضغطة زر يثبت أن أحدًا ضغط، لا أن أحدًا فهم.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "المفتوح فقط" : "عرض المُقَرّ به"}
            </Button>
            {can("critical.oversee") && (
              <Button variant="outline" disabled={escalate.isPending}
                      onClick={() => escalate.mutate()}>
                تصعيد المتأخّر
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {results.isLoading && <Skeleton className="h-40 w-full" />}
          {!results.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>الفحص</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>منذ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.is_open ? "font-medium" : "opacity-70"}>
                    <TableCell className="text-sm">
                      <Link to={`/patients/${r.patient_id}`} className="hover:underline">
                        {r.patient_name}
                      </Link>
                      {r.file_number && (
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {r.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.test_name ?? "—"}
                      <span className="block text-[10px] text-muted-foreground">
                        {r.source_kind === "lab" ? "مختبر" : "أشعة"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs">
                      {r.result_value ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{r.doctor_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.minutes_to_ack} دقيقة
                      {r.escalation_level > 0 && (
                        <Badge variant="destructive" className="ms-1">
                          تصعيد {r.escalation_level}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.is_open ? (
                        <Badge variant="destructive">بانتظار إقرار</Badge>
                      ) : (
                        <Badge variant="success">أُقِرّ به</Badge>
                      )}
                      {r.phoned_at && (
                        <span className="block text-[10px] text-muted-foreground">
                          أُبلغ: {r.phoned_to}
                        </span>
                      )}
                      {r.read_back_text && (
                        <span className="block text-[10px] text-muted-foreground">
                          «{r.read_back_text}»
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      {r.is_open && (
                        <div className="flex justify-end gap-1">
                          {can("critical.oversee") && !r.phoned_at && (
                            <Button size="sm" variant="ghost"
                                    onClick={() => { setPhoning(r); setCalledTo(""); }}>
                              <PhoneCall className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {can("critical.acknowledge") && (
                            <Button size="sm" variant="outline"
                                    onClick={() => { setAcking(r); setReadBack(""); setAction(""); }}>
                              إقرار
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا قيم حرجة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(acking)} onOpenChange={(o) => !o && setAcking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إقرار بقيمة حرجة</DialogTitle>
            <DialogDescription>
              {acking?.test_name}: <strong>{acking?.result_value}</strong> — للمريض{" "}
              {acking?.patient_name}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>إعادة قراءة القيمة *</Label>
              <Input value={readBack} onChange={(e) => setReadBack(e.target.value)}
                     placeholder="اكتب القيمة كما قرأتها" />
              <span className="text-[10px] text-muted-foreground">
                هذا هو إثبات أن القيمة فُهمت لا أنها عُرضت فحسب
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء المتَّخذ *</Label>
              <Textarea rows={3} value={action} onChange={(e) => setAction(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!readBack.trim() || !action.trim() || acknowledge.isPending}
                    onClick={() => acknowledge.mutate()}>
              تسجيل الإقرار
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(phoning)} onOpenChange={(o) => !o && setPhoning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>توثيق الإبلاغ الهاتفي</DialogTitle>
            <DialogDescription>
              يُوثَّق من أُبلغ ومتى — التوثيق لا يُغني عن إقرار الطبيب.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>من أُبلغ *</Label>
            <Input value={calledTo} onChange={(e) => setCalledTo(e.target.value)}
                   placeholder="اسم من تحدّثت إليه" />
          </div>
          <DialogFooter>
            <Button disabled={!calledTo.trim() || phone.isPending}
                    onClick={() => phone.mutate()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * يومي
 * ════════════════════════════════════════════════════════════════════════ */
function TodayPanel() {
  const { organization, session } = useOrganizationAccess();
  const [mineOnly, setMineOnly] = useState(true);

  const worklist = useQuery({
    queryKey: ["doctor-worklist", organization?.id],
    enabled: Boolean(organization?.id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const to = new Date(from.getTime() + 86400000);
      const { data, error } = await supabase
        .from("v_doctor_worklist").select("*")
        .eq("organization_id", organization!.id)
        .gte("scheduled_start", from.toISOString())
        .lt("scheduled_start", to.toISOString())
        .order("scheduled_start");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const userId = session?.user.id;
  const rows = (worklist.data ?? []).filter(
    (r) => !mineOnly || !userId || r.doctor_user_id === userId,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" />
            مرضى اليوم
          </CardTitle>
          <CardDescription>
            بحالة كل موعد وزمن انتظار المريض منذ تسجيل حضوره.
          </CardDescription>
        </div>
        <Button variant="ghost" onClick={() => setMineOnly((v) => !v)}>
          {mineOnly ? "عرض كل الأطباء" : "مرضاي فقط"}
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {worklist.isLoading && <Skeleton className="h-40 w-full" />}
        {!worklist.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوقت</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>العيادة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الانتظار</TableHead>
                <TableHead>الزيارة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.appointment_id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(r.scheduled_start).toLocaleTimeString("ar-SA", {
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/patients/${r.patient_id}`} className="hover:underline">
                      {r.patient_name}
                    </Link>
                    {r.file_number && (
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {r.file_number}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.clinic_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.status}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.waiting_minutes != null ? (
                      <Badge variant={r.waiting_minutes > 30 ? "destructive" : "secondary"}>
                        {r.waiting_minutes} د
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.visit_id ? (
                      <Link to="/patient-visits" className="hover:underline">
                        {r.visit_status}
                      </Link>
                    ) : "لم تُفتح"}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا مواعيد اليوم.
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

/* ══════════════════════════════════════════════════════════════════════════
 * زيارات لم تُغلق
 * ════════════════════════════════════════════════════════════════════════ */
function OpenVisitsPanel() {
  const { organization, session } = useOrganizationAccess();
  const [mineOnly, setMineOnly] = useState(true);

  const visits = useQuery({
    queryKey: ["doctor-open-visits", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_open_visits").select("*")
        .eq("organization_id", organization!.id)
        .order("days_open", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const userId = session?.user.id;
  const rows = (visits.data ?? []).filter(
    (r) => !mineOnly || !userId || r.doctor_user_id === userId,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            زيارات لم تُغلق
          </CardTitle>
          <CardDescription>
            الزيارة المفتوحة **لا تُفوتر ولا تدخل مطالبة تأمين** — كل يوم تبقى
            فيه مفتوحة تأخيرٌ في إيراد المنشأة وفي سجلّ المريض.
          </CardDescription>
        </div>
        <Button variant="ghost" onClick={() => setMineOnly((v) => !v)}>
          {mineOnly ? "عرض كل الأطباء" : "زياراتي فقط"}
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {visits.isLoading && <Skeleton className="h-32 w-full" />}
        {!visits.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>تاريخ الزيارة</TableHead>
                <TableHead>مفتوحة منذ</TableHead>
                <TableHead>الخدمات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.visit_id}>
                  <TableCell className="text-sm">
                    <Link to={`/patients/${r.patient_id}`} className="hover:underline">
                      {r.patient_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(r.visit_date).slice(0, 10)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Badge variant={Number(r.days_open) > 2 ? "destructive" : "secondary"}>
                      {r.days_open} يوم
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.service_count}</TableCell>
                  <TableCell className="text-xs">{r.status}</TableCell>
                  <TableCell className="text-left">
                    <Link to="/patient-visits">
                      <Button size="sm" variant="ghost">فتح</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا زيارات مفتوحة.
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
