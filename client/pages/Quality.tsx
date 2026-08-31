import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Gauge, ShieldAlert } from "lucide-react";
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
 * الجودة وسلامة المرضى — المرحلة 26.
 *
 * المبدأ الذي بُنيت عليه الشاشة: **المؤشّر يُحسب من بيانات النظام لا يُكتب
 * باليد**. ما لا يمكن حسابه (رضا المرضى مثلًا) يظهر موسومًا «يدويّ» بمصدره،
 * فلا يختلط بالمحسوب ولا يُستشهد به كأنه قياس.
 */
const CATEGORIES: Record<string, string> = {
  medication: "دواء",
  procedure: "إجراء",
  fall: "سقوط",
  infection: "عدوى",
  documentation: "توثيق",
  equipment: "أجهزة",
  identification: "هوية مريض",
  communication: "تواصل",
  security: "أمن",
  other: "أخرى",
};

const SEVERITY: Record<string, { label: string; variant: any }> = {
  near_miss: { label: "وشيك", variant: "secondary" },
  minor: { label: "بسيط", variant: "secondary" },
  moderate: { label: "متوسّط", variant: "default" },
  major: { label: "جسيم", variant: "destructive" },
  sentinel: { label: "حدث جلل", variant: "destructive" },
};

const DOMAINS: Record<string, string> = {
  clinical: "سريري",
  operational: "تشغيلي",
  financial: "مالي",
  safety: "سلامة",
  experience: "تجربة المريض",
};

export default function Quality() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الجودة وسلامة المرضى</h1>
        <p className="text-sm text-muted-foreground">
          مؤشّرات محسوبة من بيانات النظام، وبلاغات سلامة لا تُغلق بلا سببٍ جذريّ
        </p>
      </div>

      <Tabs defaultValue="scorecard">
        <TabsList>
          <TabsTrigger value="scorecard">بطاقة الأداء</TabsTrigger>
          <TabsTrigger value="incidents">بلاغات السلامة</TabsTrigger>
        </TabsList>
        <TabsContent value="scorecard" className="mt-4"><Scorecard /></TabsContent>
        <TabsContent value="incidents" className="mt-4"><Incidents /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * بطاقة الأداء
 * ════════════════════════════════════════════════════════════════════════ */
function Scorecard() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [measuring, setMeasuring] = useState<any | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [note, setNote] = useState("");

  const scorecard = useQuery({
    queryKey: ["quality-scorecard", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_quality_scorecard").select("*")
        .eq("organization_id", organization!.id)
        .order("domain").order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // تاريخ قياسات المؤشّر المختار: الرقم الواحد بلا سياق لا يقول شيئًا
  const trend = useQuery({
    queryKey: ["quality-trend", measuring?.indicator_id],
    enabled: Boolean(measuring?.indicator_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_quality_trend").select("*")
        .eq("indicator_id", measuring.indicator_id)
        .order("period_end", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const measure = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_measure_quality_indicator", {
        p_indicator_id: measuring.indicator_id,
        p_from: from,
        p_to: to,
        p_manual_value: measuring.is_manual && manualValue ? Number(manualValue) : null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-scorecard", organization?.id] });
      setMeasuring(null); setManualValue(""); setNote("");
      toast({ title: "سُجّل القياس" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر القياس",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const openMeasure = (row: any) => {
    const end = new Date();
    end.setDate(0); // آخر يوم في الشهر الماضي
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFrom(fmt(start));
    setTo(fmt(end));
    setManualValue("");
    setNote("");
    setMeasuring(row);
  };

  const offTarget = (scorecard.data ?? []).filter((r) => r.status === "off_target").length;

  return (
    <div className="flex flex-col gap-4">
      {offTarget > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>{offTarget}</strong> مؤشّرًا خارج هدفه في آخر قياس.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            بطاقة أداء الجودة
          </CardTitle>
          <CardDescription>
            كل مؤشّر هنا **يُحسب من بيانات النظام** ببسطه ومقامه. وما يتعذّر
            حسابه يظهر موسومًا «يدويّ» بمصدره — ولا نسبة بلا مقام.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {scorecard.isLoading && <Skeleton className="h-40 w-full" />}
          {!scorecard.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المؤشّر</TableHead>
                  <TableHead>المجال</TableHead>
                  <TableHead>آخر قيمة</TableHead>
                  <TableHead>البسط/المقام</TableHead>
                  <TableHead>الهدف</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الفترة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scorecard.data ?? []).map((r) => (
                  <TableRow key={r.indicator_id}>
                    <TableCell className="text-sm">
                      {r.name_ar}
                      {r.is_manual && (
                        <Badge variant="secondary" className="ms-1">يدويّ</Badge>
                      )}
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {r.metric_key}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{DOMAINS[r.domain] ?? r.domain}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.value == null ? "—" : r.value}
                      {r.value != null && r.unit === "percent" ? "%" : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.numerator != null && r.denominator != null
                        ? `${r.numerator} / ${r.denominator}`
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.target_value ?? "—"}
                      <span className="block text-[10px] text-muted-foreground">
                        {r.higher_is_better ? "الأعلى أفضل" : "الأقل أفضل"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        r.status === "on_target" ? "success"
                          : r.status === "off_target" ? "destructive" : "secondary"}>
                        {r.status === "on_target" ? "مطابق"
                          : r.status === "off_target" ? "خارج الهدف" : "لم يُقَس"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[10px]">
                      {r.period_start ? `${r.period_start} → ${r.period_end}` : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      {can("quality.manage") && (
                        <Button size="sm" variant="ghost" onClick={() => openMeasure(r)}>
                          قياس
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(scorecard.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا مؤشّرات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(measuring)} onOpenChange={(o) => !o && setMeasuring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>قياس: {measuring?.name_ar}</DialogTitle>
            <DialogDescription>
              {measuring?.is_manual
                ? "مؤشّر مُدخَل يدويًّا — القيمة ومصدرها مطلوبان."
                : "مؤشّر محسوب من بيانات النظام — يكفي تحديد الفترة."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>من *</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>إلى *</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            {measuring?.is_manual && (
              <div className="flex flex-col gap-1.5">
                <Label>القيمة *</Label>
                <Input type="number" step="0.01" value={manualValue}
                       onChange={(e) => setManualValue(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>{measuring?.is_manual ? "مصدر الرقم *" : "ملاحظة"}</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder={measuring?.is_manual ? "مسح رضا 120 مريضًا — أكتوبر" : ""} />
            </div>
            {(trend.data ?? []).length > 0 && (
              <div className="rounded-md border p-2">
                <span className="text-xs font-medium">القياسات السابقة</span>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {(trend.data ?? []).map((t) => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <span className="font-mono">{t.period_start} → {t.period_end}</span>
                      <span className="font-mono">
                        {t.value ?? "—"}
                        {t.target_value != null ? ` (الهدف ${t.target_value})` : ""}
                        {t.is_manual ? " · يدويّ" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={
                !from || !to || measure.isPending ||
                (measuring?.is_manual && (!manualValue || !note.trim()))
              }
              onClick={() => measure.mutate()}
            >
              حفظ القياس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * بلاغات السلامة
 * ════════════════════════════════════════════════════════════════════════ */
function Incidents() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState("medication");
  const [severity, setSeverity] = useState("minor");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [immediate, setImmediate] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const [closing, setClosing] = useState<any | null>(null);
  const [rootCause, setRootCause] = useState("");
  const [corrective, setCorrective] = useState("");
  const [preventive, setPreventive] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const incidents = useQuery({
    queryKey: ["quality-incidents", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_quality_incidents").select("*")
        .eq("organization_id", organization!.id)
        .order("occurred_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["quality-incidents", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["quality-scorecard", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const report = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_report_quality_incident", {
        p_org: organization!.id,
        p_category: category,
        p_severity: severity,
        p_description: description.trim(),
        p_branch_id: null,
        p_patient_id: null,
        p_occurred_at: new Date().toISOString(),
        p_location: location.trim() || null,
        p_immediate: immediate.trim() || null,
        p_anonymous: anonymous,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setReporting(false); setDescription(""); setLocation(""); setImmediate("");
      setAnonymous(false);
      toast({
        title: "رُفع البلاغ",
        description: "أُبلغ المسؤولون عن التحقيق فورًا",
      });
    },
    onError: fail("تعذر رفع البلاغ"),
  });

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_close_quality_incident", {
        p_id: closing.id,
        p_root_cause: rootCause.trim(),
        p_corrective: corrective.trim(),
        p_preventive: preventive.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setClosing(null); setRootCause(""); setCorrective(""); setPreventive("");
      toast({ title: "أُغلق البلاغ بسببه الجذريّ وإجراءاته" });
    },
    onError: fail("تعذر الإغلاق"),
  });

  const rows = (incidents.data ?? []).filter((r) => showClosed || r.is_open);
  const open = (incidents.data ?? []).filter((r) => r.is_open).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              بلاغات السلامة
              {open > 0 && <Badge variant="destructive">{open} مفتوح</Badge>}
            </CardTitle>
            <CardDescription>
              الإبلاغ حقٌّ لكل عامل، ويمكن أن يكون **مجهولًا** — والبلاغ لا
              يُغلق بلا سببٍ جذريّ وإجراء تصحيحيّ، ولا يُحذف أبدًا.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "المفتوح فقط" : "عرض المغلق"}
            </Button>
            {can("quality.report") && (
              <Button onClick={() => setReporting(true)}>بلاغ جديد</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {incidents.isLoading && <Skeleton className="h-40 w-full" />}
          {!incidents.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الخطورة</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>وقع في</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      #{r.incident_number}
                      {r.is_anonymous && (
                        <span className="block text-[10px] text-muted-foreground">مجهول</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {CATEGORIES[r.category] ?? r.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY[r.severity]?.variant ?? "secondary"}>
                        {SEVERITY[r.severity]?.label ?? r.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72 truncate text-sm">
                      {r.description}
                      {r.root_cause && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          السبب: {r.root_cause}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(r.occurred_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      {r.is_open
                        ? <Badge variant="destructive">مفتوح</Badge>
                        : <Badge variant="success">مغلق</Badge>}
                      {r.days_to_close != null && (
                        <span className="block text-[10px] text-muted-foreground">
                          أُغلق خلال {r.days_to_close} يوم
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {r.is_open && can("quality.investigate") && (
                        <Button size="sm" variant="outline"
                                onClick={() => {
                                  setClosing(r); setRootCause(""); setCorrective("");
                                  setPreventive("");
                                }}>
                          تحقيق وإغلاق
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا بلاغات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بلاغ سلامة</DialogTitle>
            <DialogDescription>
              بلّغ عمّا وقع أو كاد يقع. الهدف التعلّم لا اللوم.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>النوع *</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>الخطورة *</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SEVERITY).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ماذا حدث؟ *</Label>
              <Textarea rows={3} value={description}
                        onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المكان</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء الفوري</Label>
              <Textarea rows={2} value={immediate}
                        onChange={(e) => setImmediate(e.target.value)} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={anonymous}
                     onChange={(e) => setAnonymous(e.target.checked)} />
              بلاغ مجهول — لا يُحفظ اسمي
            </label>
          </div>
          <DialogFooter>
            <Button disabled={!description.trim() || report.isPending}
                    onClick={() => report.mutate()}>
              رفع البلاغ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closing)} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحقيق وإغلاق — بلاغ #{closing?.incident_number}</DialogTitle>
            <DialogDescription>
              بلاغٌ يُغلق فارغًا يحوّل نظام السلامة إلى أرشيف شكاوى.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              {closing?.description}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السبب الجذريّ *</Label>
              <Textarea rows={2} value={rootCause}
                        onChange={(e) => setRootCause(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء التصحيحيّ *</Label>
              <Textarea rows={2} value={corrective}
                        onChange={(e) => setCorrective(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء الوقائيّ (لمنع التكرار)</Label>
              <Textarea rows={2} value={preventive}
                        onChange={(e) => setPreventive(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!rootCause.trim() || !corrective.trim() || close.isPending}
                    onClick={() => close.mutate()}>
              إغلاق البلاغ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
