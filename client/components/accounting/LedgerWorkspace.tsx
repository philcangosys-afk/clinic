import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote, CalendarClock, Layers, Lock, LockOpen, Plus, RefreshCcw, Undo2, X,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/error-message";

/**
 * دفتر الأستاذ — المرحلة 19.
 *
 * **الشرط الحاكم**: القيود تُولَّد من العمليات بقواعد ترحيل معلَنة، والقيد
 * اليدويّ استثناءٌ يحتاج صلاحيةً منفصلة وسببًا مكتوبًا. ولذلك شاشة القيد
 * اليدويّ هنا تطلب السبب قبل أي شيء، ولا تُخفيه في حقلٍ اختياريّ.
 */

const money = (v: any) =>
  Number(v ?? 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LedgerWorkspace() {
  return (
    <Tabs defaultValue="periods">
      <TabsList>
        <TabsTrigger value="periods">السنوات والفترات</TabsTrigger>
        <TabsTrigger value="manual">القيود اليدوية والعكس</TabsTrigger>
        <TabsTrigger value="statements">القوائم المالية</TabsTrigger>
        <TabsTrigger value="centers">مراكز التكلفة</TabsTrigger>
        <TabsTrigger value="bank">التسويات البنكية</TabsTrigger>
        <TabsTrigger value="rules">قواعد الترحيل</TabsTrigger>
      </TabsList>
      <TabsContent value="periods" className="mt-4"><PeriodsPanel /></TabsContent>
      <TabsContent value="manual" className="mt-4"><EntriesPanel /></TabsContent>
      <TabsContent value="statements" className="mt-4"><StatementsPanel /></TabsContent>
      <TabsContent value="centers" className="mt-4"><CostCentersPanel /></TabsContent>
      <TabsContent value="bank" className="mt-4"><BankPanel /></TabsContent>
      <TabsContent value="rules" className="mt-4"><RulesPanel /></TabsContent>
    </Tabs>
  );
}

function useAccounts(orgId: string | undefined) {
  return useQuery({
    queryKey: ["lw-accounts", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name_ar, account_type, is_active")
        .eq("organization_id", orgId).eq("is_active", true).order("code");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * السنوات والفترات
 * ════════════════════════════════════════════════════════════════════════ */
function PeriodsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [yearName, setYearName] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

  const years = useQuery({
    queryKey: ["fiscal-years", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_years").select("*")
        .eq("organization_id", organization!.id).order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const periods = useQuery({
    queryKey: ["fiscal-period-status", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_fiscal_period_status").select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fiscal-years", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["fiscal-period-status", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  /**
   * إنشاء السنة يولّد فتراتها الاثنتي عشرة دفعةً واحدة.
   *
   * تركُ الفترات للمستخدم يعني سنةً بفترات ناقصة، وقيودًا تقع في فجوةٍ بلا
   * فترة فلا يشملها إقفال.
   */
  const createYear = useMutation({
    mutationFn: async () => {
      const { data: year, error } = await supabase
        .from("fiscal_years")
        .insert({
          organization_id: organization!.id,
          name: yearName.trim(),
          start_date: yearStart,
          end_date: yearEnd,
        })
        .select("id, start_date")
        .single();
      if (error) throw error;

      const start = new Date(yearStart);
      const rows = Array.from({ length: 12 }).map((_, i) => {
        const s = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const e = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
        const fmt = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
            d.getDate(),
          ).padStart(2, "0")}`;
        return {
          organization_id: organization!.id,
          fiscal_year_id: year.id,
          period_number: i + 1,
          name: s.toLocaleDateString("ar-SA-u-nu-latn", { month: "long", year: "numeric" }),
          start_date: fmt(s),
          end_date: fmt(e),
        };
      });
      const { error: pErr } = await supabase.from("fiscal_periods").insert(rows);
      if (pErr) throw pErr;
    },
    onSuccess: () => {
      invalidate();
      setYearName(""); setYearStart(""); setYearEnd("");
      toast({ title: "أُنشئت السنة وفتراتها الاثنتا عشرة" });
    },
    onError: fail("تعذر إنشاء السنة"),
  });

  const close = useMutation({
    mutationFn: async ({ id, lock }: { id: string; lock: boolean }) => {
      const { error } = await supabase.rpc("app_close_fiscal_period", {
        p_period_id: id, p_lock: lock,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُقفلت الفترة", description: "لا يُرحَّل فيها قيد بعد الآن" });
    },
    onError: fail("تعذر الإقفال"),
  });

  const reopen = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reopen_fiscal_period", {
        p_period_id: id, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "أُعيد فتح الفترة" }); },
    onError: fail("تعذر إعادة الفتح"),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("gl.close_period") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              سنة مالية جديدة
            </CardTitle>
            <CardDescription>
              تُنشأ باثنتي عشرة فترة دفعةً واحدة — سنةٌ بفترات ناقصة تترك قيودًا خارج أي إقفال.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-56 flex-col gap-1.5">
              <Label>الاسم *</Label>
              <Input value={yearName} onChange={(e) => setYearName(e.target.value)}
                     placeholder="السنة المالية 2026" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>من</Label>
              <Input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى</Label>
              <Input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} />
            </div>
            <Button disabled={!yearName.trim() || !yearStart || !yearEnd || createYear.isPending}
                    onClick={() => createYear.mutate()}>
              إنشاء
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">الفترات المالية</CardTitle>
          <CardDescription>
            **لا إقفال وفي الفترة مسوّدات**: قيدٌ لم يُرحَّل يعني معاملةً خارج القوائم.
            والإقفال النهائيّ لا يُفتح بعده.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {periods.isLoading && <Skeleton className="h-40 w-full" />}
          {!periods.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>السنة</TableHead>
                  <TableHead>الفترة</TableHead>
                  <TableHead>من</TableHead>
                  <TableHead>إلى</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>القيود</TableHead>
                  <TableHead>مسوّدات</TableHead>
                  <TableHead>الفرق</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(periods.data ?? []).map((p) => (
                  <TableRow key={p.fiscal_period_id}>
                    <TableCell className="text-sm">{p.fiscal_year_name}</TableCell>
                    <TableCell className="text-sm">{p.period_name ?? p.period_number}</TableCell>
                    <TableCell className="font-mono text-xs">{p.report_date}</TableCell>
                    <TableCell className="font-mono text-xs">{p.end_date}</TableCell>
                    <TableCell>
                      <Badge variant={
                        p.status === "locked" ? "destructive"
                          : p.status === "closed" ? "secondary" : "success"}>
                        {p.status === "locked" ? "مقفلة نهائيًّا"
                          : p.status === "closed" ? "مقفلة" : "مفتوحة"}
                      </Badge>
                      {p.reopen_reason && (
                        <span className="block text-[10px] text-muted-foreground">
                          أُعيد فتحها: {p.reopen_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.entry_count ?? 0}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(p.draft_count ?? 0) > 0 ? (
                        <Badge variant="destructive">{p.draft_count}</Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(p.imbalance ?? 0) !== 0 ? (
                        <Badge variant="destructive">{money(p.imbalance)}</Badge>
                      ) : (
                        "متوازنة"
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {p.status === "open" && can("gl.close_period") && (
                          <>
                            <Button size="sm" variant="ghost" disabled={close.isPending}
                                    onClick={() => close.mutate({ id: p.fiscal_period_id, lock: false })}>
                              <Lock className="h-3.5 w-3.5" />
                              إقفال
                            </Button>
                            <Button size="sm" variant="ghost" disabled={close.isPending}
                                    onClick={() => {
                                      if (!window.confirm(
                                        "الإقفال النهائيّ لا يُفتح بعده. متابعة؟")) return;
                                      close.mutate({ id: p.fiscal_period_id, lock: true });
                                    }}>
                              إقفال نهائيّ
                            </Button>
                          </>
                        )}
                        {p.status === "closed" && can("gl.reopen_period") && (
                          <Button size="sm" variant="ghost" disabled={reopen.isPending}
                                  onClick={() => {
                                    const reason = window.prompt("سبب إعادة الفتح؟") ?? "";
                                    if (!reason.trim()) return;
                                    reopen.mutate({ id: p.fiscal_period_id, reason: reason.trim() });
                                  }}>
                            <LockOpen className="h-3.5 w-3.5" />
                            إعادة فتح
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(periods.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا سنوات مالية. أنشئ سنةً قبل بدء الترحيل.
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
 * القيود اليدوية والعكس
 * ════════════════════════════════════════════════════════════════════════ */
function EntriesPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const accounts = useAccounts(organization?.id);

  const [creating, setCreating] = useState(false);
  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<
    { accountId: string; debit: string; credit: string; costCenterId: string }[]
  >([]);

  const centers = useQuery({
    queryKey: ["lw-centers", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_centers").select("id, code, name_ar, is_active")
        .eq("organization_id", organization!.id).eq("is_active", true).order("code");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // مفتاح مميَّز عن مفتاح تبويب «القيود اليومية»: كان الاثنان
  // `["journal-entries", orgId]` بدالّتَي جلب مختلفتين، وهذه الوحيدة التي
  // تجلب البنود — فبيانات تلك تُعرض لحظيًّا هنا فيُحسب مجموع كل قيد صفرًا
  // وتظهر شارة مصدر خاطئة.
  const entries = useQuery({
    queryKey: ["journal-entries-with-lines", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, journal_entry_lines(id, debit, credit, account_id)")
        .eq("organization_id", organization!.id)
        .order("entry_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["journal-entries-with-lines", organization?.id] });
    // تبويب «القيود اليومية» يقرأ نفس الجدول بمفتاحه الخاصّ، فيُبطَّل معه
    queryClient.invalidateQueries({ queryKey: ["journal-entries-basic", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["fiscal-period-status", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["account-balances", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["trial-balance", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.005 && d > 0 };
  }, [lines]);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_create_manual_journal_entry", {
        p_organization_id: organization!.id,
        p_entry_date: entryDate,
        p_description: description.trim() || null,
        p_reason: reason.trim(),
        p_lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({
            account_id: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            cost_center_id: l.costCenterId || null,
          })),
        p_branch_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setEntryDate(""); setDescription(""); setReason(""); setLines([]);
      toast({ title: "حُفظ القيد كمسوّدة", description: "رحّله من القائمة" });
    },
    onError: fail("تعذر الحفظ"),
  });

  const post = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_post_journal_entry", { p_entry_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "رُحّل القيد" }); },
    onError: fail("تعذر الترحيل"),
  });

  const reverse = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reverse_journal_entry", {
        p_entry_id: id, p_reason: reason, p_date: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "عُكس القيد",
        description: "بقيدٍ مضادّ — وإن كانت فترته مقفلة فالعكس في أوّل فترة مفتوحة",
      });
    },
    onError: fail("تعذر العكس"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              القيود
            </CardTitle>
            <CardDescription>
              القيود تُولَّد من العمليات بقواعد ترحيل معلَنة. **القيد اليدويّ استثناء**
              يحتاج صلاحيةً منفصلة وسببًا مكتوبًا.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => entries.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              تحديث
            </Button>
            {can("gl.manual_entry") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                قيد يدويّ
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {entries.isLoading && <Skeleton className="h-40 w-full" />}
          {!entries.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries.data ?? []).map((e) => {
                  const total = (e.journal_entry_lines ?? []).reduce(
                    (s: number, l: any) => s + Number(l.debit ?? 0), 0);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.entry_number ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{e.entry_date}</TableCell>
                      <TableCell className="max-w-64 truncate text-sm">
                        {e.description ?? "—"}
                        {e.manual_reason && (
                          <span className="block text-[10px] text-muted-foreground">
                            السبب: {e.manual_reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {e.reversal_of_id ? (
                          <Badge variant="outline">قيد عكسيّ</Badge>
                        ) : e.is_manual ? (
                          <Badge variant="secondary">يدويّ</Badge>
                        ) : (
                          <Badge variant="success">
                            {e.posting_rule_id ? "من قاعدة ترحيل" : "من عملية"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{money(total)}</TableCell>
                      <TableCell>
                        <Badge variant={
                          e.status === "posted" ? "success"
                            : e.status === "void" ? "destructive" : "secondary"}>
                          {e.status === "posted" ? "مرحَّل"
                            : e.status === "void" ? "ملغى" : "مسوّدة"}
                        </Badge>
                        {e.reversed_by_id && (
                          <span className="block text-[10px] text-muted-foreground">معكوس</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          {e.status === "draft" && can("gl.post") && (
                            <Button size="sm" variant="outline" disabled={post.isPending}
                                    onClick={() => post.mutate(e.id)}>
                              ترحيل
                            </Button>
                          )}
                          {e.status === "posted" && !e.reversed_by_id && can("gl.reverse") && (
                            <Button size="sm" variant="ghost" disabled={reverse.isPending}
                                    onClick={() => {
                                      const r = window.prompt("سبب العكس؟") ?? "";
                                      if (!r.trim()) return;
                                      reverse.mutate({ id: e.id, reason: r.trim() });
                                    }}>
                              <Undo2 className="h-3.5 w-3.5" />
                              عكس
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(entries.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا قيود.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>قيد يدويّ</DialogTitle>
            <DialogDescription>
              السبب إلزاميّ لأن القاعدة أن تُولَّد القيود من العمليات؛ هذا استثناء يُدقَّق.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>التاريخ *</Label>
                <Input type="date" value={entryDate}
                       onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>البيان</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>سبب القيد اليدويّ *</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="لماذا لم يُولَّد هذا القيد من عملية؟" />
            </div>

            <div className="flex items-center justify-between">
              <Label>البنود</Label>
              <Button size="sm" variant="outline"
                      onClick={() => setLines((ls) => [
                        ...ls, { accountId: "", debit: "", credit: "", costCenterId: "" },
                      ])}>
                <Plus className="h-4 w-4" />
                بند
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {lines.map((line, index) => (
                <div key={index} className="mb-2 flex items-center gap-2">
                  <Select value={line.accountId}
                          onValueChange={(v) => setLines((ls) =>
                            ls.map((l, i) => i === index ? { ...l, accountId: v } : l))}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="الحساب" />
                    </SelectTrigger>
                    <SelectContent>
                      {(accounts.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} — {a.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={0} className="w-28" placeholder="مدين"
                         value={line.debit}
                         onChange={(e) => setLines((ls) =>
                           ls.map((l, i) => i === index
                             ? { ...l, debit: e.target.value, credit: "" } : l))} />
                  <Input type="number" min={0} className="w-28" placeholder="دائن"
                         value={line.credit}
                         onChange={(e) => setLines((ls) =>
                           ls.map((l, i) => i === index
                             ? { ...l, credit: e.target.value, debit: "" } : l))} />
                  <Select value={line.costCenterId}
                          onValueChange={(v) => setLines((ls) =>
                            ls.map((l, i) => i === index ? { ...l, costCenterId: v } : l))}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="مركز التكلفة" />
                    </SelectTrigger>
                    <SelectContent>
                      {(centers.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost"
                          onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className={`rounded-md border p-2 text-sm ${
              totals.balanced ? "" : "border-destructive text-destructive"}`}>
              مدين {money(totals.debit)} · دائن {money(totals.credit)}
              {!totals.balanced && " — غير متوازن"}
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!entryDate || !reason.trim() || !totals.balanced || create.isPending}
                    onClick={() => create.mutate()}>
              {create.isPending ? "جارٍ الحفظ..." : "حفظ كمسوّدة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * القوائم المالية
 * ════════════════════════════════════════════════════════════════════════ */
function StatementsPanel() {
  const { organization } = useOrganizationAccess();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const income = useQuery({
    queryKey: ["income-statement", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase.from("v_income_statement").select("*")
        .eq("organization_id", organization!.id);
      if (from) q = q.gte("report_date", from);
      if (to) q = q.lte("report_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const balance = useQuery({
    queryKey: ["balance-sheet", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase.from("v_balance_sheet").select("*")
        .eq("organization_id", organization!.id);
      if (from) q = q.gte("report_date", from);
      if (to) q = q.lte("report_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const cash = useQuery({
    queryKey: ["cash-flow", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase.from("v_cash_flow").select("*")
        .eq("organization_id", organization!.id);
      if (from) q = q.gte("report_date", from);
      if (to) q = q.lte("report_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const group = (rows: any[], key = "account_code") => {
    const map: Record<string, any> = {};
    for (const r of rows) {
      const k = `${r[key]}|${r.account_name}|${r.section ?? ""}`;
      map[k] = map[k] ?? {
        code: r[key], name: r.account_name, section: r.section, amount: 0,
      };
      map[k].amount += Number(r.amount ?? r.net_cash_flow ?? 0);
    }
    return Object.values(map).sort((a: any, b: any) =>
      String(a.code).localeCompare(String(b.code)));
  };

  const revenue = group((income.data ?? []).filter((r) => r.section === "revenue"));
  const expense = group((income.data ?? []).filter((r) => r.section === "expense"));
  const revTotal = revenue.reduce((s: number, r: any) => s + r.amount, 0);
  const expTotal = expense.reduce((s: number, r: any) => s + r.amount, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">نطاق القوائم</CardTitle>
          <CardDescription>
            القوائم تقرأ **القيود المرحَّلة وحدها** — المسوّدة رقمٌ لم يُقَرّ بعد.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">قائمة الدخل</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {income.isLoading && <Skeleton className="h-32 w-full" />}
          {!income.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحساب</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead>المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell colSpan={3} className="bg-muted text-sm font-semibold">
                  الإيرادات
                </TableCell></TableRow>
                {revenue.map((r: any) => (
                  <TableRow key={`rev-${r.code}`}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow><TableCell colSpan={3} className="bg-muted text-sm font-semibold">
                  المصروفات
                </TableCell></TableRow>
                {expense.map((r: any) => (
                  <TableRow key={`exp-${r.code}`}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="text-sm font-semibold">صافي الدخل</TableCell>
                  <TableCell className="font-mono text-xs font-semibold">
                    {money(revTotal - expTotal)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">الميزانية</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {balance.isLoading && <Skeleton className="h-32 w-full" />}
          {!balance.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>القسم</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead>المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group(balance.data ?? []).map((r: any) => (
                  <TableRow key={`bs-${r.code}`}>
                    <TableCell className="text-sm">{r.section}</TableCell>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
                {(balance.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      لا أرصدة في هذا النطاق.
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
          <CardTitle className="text-base">التدفّقات النقدية</CardTitle>
          <CardDescription>بالطريقة المباشرة من حركة حسابات النقد والبنوك.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {cash.isLoading && <Skeleton className="h-24 w-full" />}
          {!cash.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحساب</TableHead>
                  <TableHead>وارد</TableHead>
                  <TableHead>صادر</TableHead>
                  <TableHead>الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cash.data ?? []).map((c) => (
                  <TableRow key={`${c.account_id}-${c.report_date}`}>
                    <TableCell className="text-sm">
                      {c.account_code} — {c.account_name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{money(c.cash_in)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(c.cash_out)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(c.net_cash_flow)}</TableCell>
                  </TableRow>
                ))}
                {(cash.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      لا حركة نقدية في هذا النطاق.
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
 * مراكز التكلفة
 * ════════════════════════════════════════════════════════════════════════ */
function CostCentersPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [centerType, setCenterType] = useState("department");
  const [parentId, setParentId] = useState("");

  const centers = useQuery({
    queryKey: ["cost-centers", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_centers").select("*")
        .eq("organization_id", organization!.id).order("code");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const performance = useQuery({
    queryKey: ["cost-center-performance", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_cost_center_performance").select("*")
        .eq("organization_id", organization!.id)
        .order("net_result", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cost_centers").insert({
        organization_id: organization!.id,
        code: code.trim(),
        name_ar: nameAr.trim(),
        center_type: centerType,
        // التسلسل يجعل تجميع الأقسام تحت الفرع ممكنًا في التقارير
        parent_center_id: parentId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-centers", organization?.id] });
      setCode(""); setNameAr(""); setParentId("");
      toast({ title: "أُضيف مركز التكلفة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  // التجميع في الواجهة لأن المنظور يُعيد صفًّا لكل يوم
  const summary = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of performance.data ?? []) {
      const k = r.cost_center_id ?? `branch:${r.branch_id ?? "none"}`;
      map[k] = map[k] ?? {
        name: r.cost_center_name ?? r.branch_name ?? "بلا مركز",
        code: r.cost_center_code ?? "—",
        revenue: 0, expense: 0, net: 0,
      };
      map[k].revenue += Number(r.revenue ?? 0);
      map[k].expense += Number(r.expense ?? 0);
      map[k].net += Number(r.net_result ?? 0);
    }
    return Object.values(map).sort((a: any, b: any) => a.net - b.net);
  }, [performance.data]);

  const TYPES: Record<string, string> = {
    branch: "فرع", clinic: "عيادة", department: "قسم", project: "مشروع", doctor: "طبيب",
  };

  return (
    <div className="flex flex-col gap-4">
      {can("gl.cost_centers") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">مركز تكلفة جديد</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-32 flex-col gap-1.5">
              <Label>الرمز *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex w-56 flex-col gap-1.5">
              <Label>الاسم *</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="flex w-40 flex-col gap-1.5">
              <Label>النوع</Label>
              <Select value={centerType} onValueChange={setCenterType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-48 flex-col gap-1.5">
              <Label>المركز الأعلى</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue placeholder="بلا" /></SelectTrigger>
                <SelectContent>
                  {(centers.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!code.trim() || !nameAr.trim() || create.isPending}
                    onClick={() => create.mutate()}>
              إضافة
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">أداء مراكز التكلفة</CardTitle>
          <CardDescription>
            مرتَّبًا بالأسوأ أوّلًا — الفرع أو القسم الذي يخسر يظهر هنا لا في الإجمالي.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {performance.isLoading && <Skeleton className="h-32 w-full" />}
          {!performance.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرمز</TableHead>
                  <TableHead>المركز</TableHead>
                  <TableHead>الإيراد</TableHead>
                  <TableHead>المصروف</TableHead>
                  <TableHead>الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((s: any) => (
                  <TableRow key={`${s.code}-${s.name}`}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="text-sm">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{money(s.revenue)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(s.expense)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.net < 0 ? (
                        <Badge variant="destructive">{money(s.net)}</Badge>
                      ) : (
                        money(s.net)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {summary.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      لا حركة على مراكز التكلفة بعد.
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
          <CardTitle className="text-base">المراكز المُعرَّفة</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المركز الأعلى</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(centers.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell className="text-sm">{c.name_ar}</TableCell>
                  <TableCell className="text-sm">{TYPES[c.center_type] ?? c.center_type}</TableCell>
                  <TableCell className="text-sm">
                    {(centers.data ?? []).find((x: any) => x.id === c.parent_center_id)?.name_ar ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.is_active ? "success" : "secondary"}>
                      {c.is_active ? "نشط" : "معطّل"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(centers.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا مراكز تكلفة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * التسويات البنكية
 * ════════════════════════════════════════════════════════════════════════ */
function BankPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const accounts = useAccounts(organization?.id);

  const [accountId, setAccountId] = useState("");
  const [statementDate, setStatementDate] = useState("");
  const [statementBalance, setStatementBalance] = useState("");

  const recs = useQuery({
    queryKey: ["bank-reconciliations", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .select("*, account:chart_of_accounts(code, name_ar)")
        .eq("organization_id", organization!.id)
        .order("statement_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("bank_reconciliations").insert({
        organization_id: organization!.id,
        account_id: accountId,
        statement_date: statementDate,
        statement_balance: Number(statementBalance) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-reconciliations", organization?.id] });
      setStatementBalance("");
      toast({ title: "أُنشئت التسوية كمسوّدة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الإنشاء",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_complete_bank_reconciliation", {
        p_reconciliation_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (book) => {
      queryClient.invalidateQueries({ queryKey: ["bank-reconciliations", organization?.id] });
      toast({
        title: "اكتملت التسوية",
        description: `رصيد الدفاتر ${money(book)}`,
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "التسوية لم تتوازن",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("gl.reconcile") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4" />
              تسوية بنكية جديدة
            </CardTitle>
            <CardDescription>
              **لا تكتمل إلا بفرقٍ مفسَّر بالكامل** بالبنود غير المطابَقة — وإلا فهي لم
              تُسوِّ شيئًا.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-64 flex-col gap-1.5">
              <Label>الحساب البنكيّ *</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).filter((a) => a.account_type === "asset").map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>تاريخ الكشف *</Label>
              <Input type="date" value={statementDate}
                     onChange={(e) => setStatementDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رصيد الكشف *</Label>
              <Input type="number" value={statementBalance}
                     onChange={(e) => setStatementBalance(e.target.value)} />
            </div>
            <Button disabled={!accountId || !statementDate || create.isPending}
                    onClick={() => create.mutate()}>
              إنشاء
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">التسويات</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {recs.isLoading && <Skeleton className="h-24 w-full" />}
          {!recs.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحساب</TableHead>
                  <TableHead>تاريخ الكشف</TableHead>
                  <TableHead>رصيد الكشف</TableHead>
                  <TableHead>رصيد الدفاتر</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recs.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {r.account?.code} — {r.account?.name_ar}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.statement_date}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.statement_balance)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.book_balance)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "success" : "secondary"}>
                        {r.status === "completed" ? "مكتملة" : "مسوّدة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {r.status === "draft" && can("gl.reconcile") && (
                        <Button size="sm" variant="outline" disabled={complete.isPending}
                                onClick={() => complete.mutate(r.id)}>
                          إتمام
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(recs.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا تسويات.
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
 * قواعد الترحيل
 * ════════════════════════════════════════════════════════════════════════ */
function RulesPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const accounts = useAccounts(organization?.id);

  const rules = useQuery({
    queryKey: ["gl-posting-rules", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_posting_rules").select("*")
        .eq("organization_id", organization!.id).order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_seed_gl_posting_rules", {
        p_organization_id: organization!.id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["gl-posting-rules", organization?.id] });
      toast({
        title: n > 0 ? `أُضيفت ${n} قاعدة` : "القواعد مسجَّلة سلفًا",
        description: "اربط كل قاعدة بحسابيها المدين والدائن",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التسجيل",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const setAccount = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string }) => {
      const { data, error } = await supabase
        .from("gl_posting_rules")
        .update({ [field]: value || null })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم تُحفَظ — راجع صلاحيتك");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["gl-posting-rules", organization?.id] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const EVENTS: Record<string, string> = {
    sales_invoice: "فاتورة مبيعات", purchase_invoice: "فاتورة مشتريات",
    payment_voucher: "سند صرف", receipt_voucher: "سند قبض", refund: "استرداد",
    payroll: "رواتب", inventory_movement: "حركة مخزون",
    insurance_settlement: "تسوية تأمين", stock_adjustment: "تسوية مخزون",
    depreciation: "إهلاك",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">قواعد الترحيل المحاسبيّ</CardTitle>
          <CardDescription>
            **الشرط الحاكم للمرحلة**: كل عملية تشغيلية تولّد قيدها من قاعدة واضحة، لا
            بإضافة قيود يدوية. تغييرُ حسابٍ هنا لا يحتاج تعديل دالّة.
          </CardDescription>
        </div>
        {can("gl.rules") && (
          <Button variant="outline" disabled={seed.isPending} onClick={() => seed.mutate()}>
            تسجيل القواعد الافتراضية
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rules.isLoading && <Skeleton className="h-32 w-full" />}
        {!rules.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القاعدة</TableHead>
                <TableHead>الحدث</TableHead>
                <TableHead>الحساب المدين</TableHead>
                <TableHead>الحساب الدائن</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>شرط التطبيق</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.name_ar}</TableCell>
                  <TableCell className="text-sm">
                    {EVENTS[r.source_event] ?? r.source_event}
                  </TableCell>
                  <TableCell>
                    <Select value={r.debit_account_id ?? ""}
                            onValueChange={(v) => setAccount.mutate({
                              id: r.id, field: "debit_account_id", value: v })}
                            disabled={!can("gl.rules")}>
                      <SelectTrigger className="w-52"><SelectValue placeholder="غير محدَّد" /></SelectTrigger>
                      <SelectContent>
                        {(accounts.data ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={r.credit_account_id ?? ""}
                            onValueChange={(v) => setAccount.mutate({
                              id: r.id, field: "credit_account_id", value: v })}
                            disabled={!can("gl.rules")}>
                      <SelectTrigger className="w-52"><SelectValue placeholder="غير محدَّد" /></SelectTrigger>
                      <SelectContent>
                        {(accounts.data ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.amount_expression}</TableCell>
                  <TableCell>
                    {/* شرط تطبيق القاعدة مكتوبٌ بلغة المحاسب: متى تُطبَّق ومتى لا */}
                    <Input
                      className="w-56"
                      defaultValue={r.condition_note ?? ""}
                      placeholder="شرط التطبيق (اختياري)"
                      disabled={!can("gl.rules")}
                      onBlur={(e) => {
                        if ((r.condition_note ?? "") === e.target.value) return;
                        setAccount.mutate({
                          id: r.id, field: "condition_note", value: e.target.value,
                        });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      r.debit_account_id && r.credit_account_id ? "success" : "destructive"}>
                      {r.debit_account_id && r.credit_account_id ? "مكتملة" : "ينقصها حساب"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(rules.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    لا قواعد. سجّل الافتراضية ثم اربطها بحساباتك.
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
