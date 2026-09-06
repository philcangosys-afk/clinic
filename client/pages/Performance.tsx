import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { PerformanceReviewCriterionRow, PerformanceReviewCycleRow } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function useCycles(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["perf-cycles", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_cycles")
        .select("*")
        .eq("organization_id", organizationId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return (data as PerformanceReviewCycleRow[]) ?? [];
    },
  });
}

function useCriteria(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["perf-criteria", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_criteria")
        .select("*")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("name_ar");
      if (error) throw error;
      return (data as PerformanceReviewCriterionRow[]) ?? [];
    },
  });
}

function useEmployeesList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["employees-simple", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name_ar")
        // النشط غير المعطَّل فقط، مطابقًا لشرط `app_calculate_payroll_run`
        // (`status='active'` **و** `is_disabled=false`): موظّفٌ معطَّل أو انتهت
        // خدمته يُقبل في قائمة الاختيار ثمّ يستثنيه المسيّر، فيبدو المُسند
        // مسجَّلًا وهو لا يُحتسب.
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data as { id: string; name_ar: string }[]) ?? [];
    },
  });
}

function useReviews(organizationId: string | undefined, cycleId: string) {
  return useQuery({
    queryKey: ["perf-reviews", organizationId, cycleId],
    enabled: Boolean(organizationId) && Boolean(cycleId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("*, employees(name_ar)")
        .eq("organization_id", organizationId)
        .eq("cycle_id", cycleId)
        .order("overall_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function CyclesTab({ organizationId }: { organizationId: string | undefined }) {
  const cycles = useCycles(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !name.trim() || !start || !end) throw new Error("كل الحقول مطلوبة");
      const { error } = await supabase.from("performance_review_cycles").insert({
        organization_id: organizationId,
        name_ar: name.trim(),
        period_start: start,
        period_end: end,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perf-cycles", organizationId] });
      toast({ title: "تم إنشاء دورة التقييم" });
      setOpen(false);
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  /**
   * إغلاق الدورة/إعادة فتحها.
   *
   * `status` كان عرضيًّا: لا زرّ في النظام كلّه يكتبه، فتبقى كل دورة «مفتوحة»
   * إلى الأبد ويمكن إنشاء تقييمات جديدة في دورة سنةٍ مضت. الإغلاق قرار إداريّ
   * يُتَّخذ من هنا، والقائمة في تبويب التقييمات ترشّح على المفتوح.
   */
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "closed" }) => {
      const { data: affectedRows, error } = await supabase
        .from("performance_review_cycles")
        .update({ status })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر رسالة
      // نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["perf-cycles", organizationId] });
      toast({ title: vars.status === "closed" ? "أُغلقت الدورة" : "أُعيد فتح الدورة" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">دورات التقييم</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> دورة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>دورة تقييم جديدة</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>الاسم</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="تقييم الربع الأول 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>من</Label>
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div>
                  <Label>إلى</Label>
                  <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الفترة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(cycles.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name_ar}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.period_start} → {c.period_end}
                </TableCell>
                <TableCell>
                  <Badge variant={c.status === "open" ? "success" : "secondary"}>{c.status === "open" ? "مفتوحة" : "مغلقة"}</Badge>
                </TableCell>
                <TableCell>
                  {c.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => {
                        if (!window.confirm(`إغلاق دورة «${c.name_ar}»؟ لن تظهر في قائمة اختيار الدورة لتقييم جديد.`)) return;
                        setStatus.mutate({ id: c.id, status: "closed" });
                      }}
                    >
                      إغلاق الدورة
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: c.id, status: "open" })}
                    >
                      إعادة فتح
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(cycles.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد دورات تقييم بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReviewsTab({ organizationId }: { organizationId: string | undefined }) {
  const cycles = useCycles(organizationId);
  const employees = useEmployeesList(organizationId);
  const criteria = useCriteria(organizationId);
  const [cycleId, setCycleId] = useState("");
  const reviews = useReviews(organizationId, cycleId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  /**
   * الدورة المغلقة تُقرأ ولا يُقيَّم فيها.
   *
   * كانت القائمة تعرض كل الدورات، فتُنشأ تقييمات جديدة في دورة سنةٍ انتهت
   * فترتها. الترشيح على المفتوحة، مع خيار صريح لعرض المغلقة للقراءة — والدورة
   * المختارة تبقى في القائمة حتى إن أُغلقت بعد اختيارها كي لا يفرغ الاختيار.
   */
  const cycleOptions = (cycles.data ?? []).filter(
    (c) => showClosed || c.status === "open" || c.id === cycleId,
  );
  const selectedCycleClosed =
    (cycles.data ?? []).find((c) => c.id === cycleId)?.status === "closed";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["perf-reviews", organizationId, cycleId] });

  const createReview = useMutation({
    mutationFn: async () => {
      if (!organizationId || !cycleId || !employeeId) throw new Error("اختر الدورة والموظف");
      const { data, error } = await supabase
        .from("performance_reviews")
        .insert({ organization_id: organizationId, cycle_id: cycleId, employee_id: employeeId, comments: comments.trim() || null })
        .select("id")
        .single();
      if (error) throw error;
      const reviewId = data.id as string;
      const criteriaIds = Object.keys(scores).filter((id) => scores[id] > 0);
      if (criteriaIds.length > 0) {
        const rows = criteriaIds.map((criterionId) => ({ review_id: reviewId, criterion_id: criterionId, score: scores[criterionId] }));
        const { error: scoreError } = await supabase.from("performance_review_scores").insert(rows);
        if (scoreError) throw scoreError;
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حفظ التقييم" });
      setOpen(false);
      setScores({});
      setComments("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const submitReview = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("performance_reviews").update({ status: "submitted" }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم إرسال التقييم" });
    },
    // بلا `onError` يفشل «إرسال» صامتًا: الرسالة تُرفَع ولا يعرضها أحد
    // (`QueryClient` في App.tsx بلا معالج أخطاء افتراضيّ)، فيظنّ المقيّم أن
    // التقييم أُرسل — أو أن الشاشة معلَّقة.
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">تقييمات الموظفين</CardTitle>
          <CardDescription>الدرجة الكلية تُحسَب تلقائيًا من متوسط المعايير المرجَّح بالوزن — لا تُدخَل يدويًا</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            عرض المغلقة (قراءة)
          </label>
          <Select value={cycleId} onValueChange={setCycleId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="اختر دورة تقييم" />
            </SelectTrigger>
            <SelectContent>
              {cycleOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name_ar}
                  {c.status === "closed" ? " (مغلقة)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!cycleId || selectedCycleClosed}>
                <Plus className="ms-1 h-4 w-4" /> تقييم جديد
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>تقييم موظف جديد</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>الموظف</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر موظفًا" />
                    </SelectTrigger>
                    <SelectContent>
                      {(employees.data ?? []).map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>الدرجات (1-5) لكل معيار</Label>
                  {(criteria.data ?? []).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{c.name_ar}</span>
                      <Select
                        value={String(scores[c.id] ?? "")}
                        onValueChange={(v) => setScores((prev) => ({ ...prev, [c.id]: Number(v) }))}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div>
                  <Label>ملاحظات المقيّم (اختياري)</Label>
                  <Textarea value={comments} onChange={(e) => setComments(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createReview.mutate()} disabled={createReview.isPending}>
                  حفظ التقييم
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!cycleId && <p className="py-8 text-center text-sm text-muted-foreground">اختر دورة تقييم لعرض تقييماتها.</p>}
        {cycleId && selectedCycleClosed && (
          <p className="pb-2 text-xs text-muted-foreground">هذه الدورة مغلقة — للقراءة فقط، ولا تُنشأ فيها تقييمات جديدة.</p>
        )}
        {cycleId && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الدرجة الكلية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reviews.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.employees?.name_ar ?? "—"}
                    {r.comments && <p className="text-xs text-muted-foreground">{r.comments}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.overall_score >= 4 ? "success" : r.overall_score >= 2.5 ? "default" : "destructive"}>
                      {r.overall_score} / 5
                    </Badge>
                  </TableCell>
                  <TableCell>{r.status === "submitted" ? "مُرسَل" : "مسودة"}</TableCell>
                  <TableCell>
                    {r.status !== "submitted" && (
                      <Button size="sm" variant="outline" onClick={() => submitReview.mutate(r.id)}>
                        إرسال
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(reviews.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد تقييمات في هذه الدورة بعد.
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

function CriteriaTab({ organizationId }: { organizationId: string | undefined }) {
  const criteria = useCriteria(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [weight, setWeight] = useState("1");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !nameAr.trim()) throw new Error("اسم المعيار مطلوب");
      const { error } = await supabase
        .from("performance_review_criteria")
        .insert({ organization_id: organizationId, name_ar: nameAr.trim(), weight: Number(weight) || 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perf-criteria", organizationId] });
      toast({ title: "تمت إضافة المعيار" });
      setOpen(false);
      setNameAr("");
      setWeight("1");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">معايير التقييم</CardTitle>
          <CardDescription>المعايير النظامية العامة متاحة لكل المؤسسات — يمكن إضافة معايير خاصة بمؤسستك بوزن مختلف</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> معيار جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>معيار تقييم جديد</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>الاسم</Label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </div>
              <div>
                <Label>الوزن</Label>
                <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الوزن</TableHead>
              <TableHead>النطاق</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(criteria.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name_ar}</TableCell>
                <TableCell>{c.weight}</TableCell>
                <TableCell>
                  <Badge variant={c.organization_id === null ? "secondary" : "outline"}>
                    {c.organization_id === null ? "نظامي عام" : "خاص بمؤسستك"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Performance() {
  const { organization } = useOrganizationAccess();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Gauge className="h-6 w-6" /> تقييم الأداء
        </h1>
        <p className="text-sm text-muted-foreground">دورات تقييم بمعايير قابلة للتخصيص — الدرجة الكلية محسوبة تلقائيًا من قاعدة البيانات</p>
      </div>
      <Tabs defaultValue="reviews">
        <TabsList>
          <TabsTrigger value="cycles">الدورات</TabsTrigger>
          <TabsTrigger value="reviews">التقييمات</TabsTrigger>
          <TabsTrigger value="criteria">المعايير</TabsTrigger>
        </TabsList>
        <TabsContent value="cycles" className="mt-4">
          <CyclesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="reviews" className="mt-4">
          <ReviewsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="criteria" className="mt-4">
          <CriteriaTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
