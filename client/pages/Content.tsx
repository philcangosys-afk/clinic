import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Newspaper, Monitor, Plus, Trash2, Pencil, ChevronUp, ChevronDown, CalendarClock, AlertTriangle } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * المحتوى — نصوص الشريط الأخباري وشاشات الدور (لقطة 77).
 *
 * لماذا هذه الشاشة: "المحتوى" كان أحد عنصرين في القائمة الجانبية **بلا مسار
 * في `App.tsx`** — الضغط عليه يفتح بطاقة "قيد الإنشاء". (الثاني كان "الأمراض
 * والتشخيص"، ومحتواه موجود فعلًا كتبويبين في شاشة البيانات المرجعية، فوُجِّه
 * إليها بدل بناء نسخة ثانية تكتب في نفس الجداول.)
 *
 * جدولاها أُنشئا في 0049. النطاق مقصود ومحدود: هذه شاشة **إعداد** لا محرّك
 * عرض — تحدّد ما يُكتب على الشريط وأي عيادات تعرضها كل شاشة. صفحة العرض التي
 * تُفتح على تلفزيون غرفة الانتظار بناء مستقل يقرأ من هذين الجدولين، والمواصفة
 * تصفها بسطر واحد فقط، فبناؤها تخمينًا يعني واجهة تُرمى لاحقًا.
 */

type TickerRow = {
  id: string;
  body: string;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  is_active: boolean;
};

type ScreenRow = {
  id: string;
  name: string;
  branch_id: string | null;
  clinic_ids: string[];
  show_doctor_name: boolean;
  show_ticker: boolean;
  refresh_seconds: number;
  is_active: boolean;
};

/**
 * تاريخ اليوم **بتوقيت المتصفح**.
 *
 * `toISOString()` يحوّل إلى UTC أولًا: في الرياض (UTC+3) بين منتصف الليل
 * والثالثة فجرًا يُعيد تاريخ الأمس، فرسالة تبدأ اليوم تُعرض حالتها «خارج
 * الفترة» ورسالة انتهت أمس تظهر «معروضة الآن».
 */
const todayIso = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

/**
 * لافتة خطأ صريحة بدل قائمة فارغة كاذبة.
 *
 * بلا هذه اللافتة، فشل الاستعلام يترك `data` غير معرَّفة فتُعرض رسالة "لا توجد
 * رسائل" — أي أن الشاشة تقول "لا يوجد محتوى" بينما الحقيقة "تعذّر الوصول
 * للمحتوى". وأكثر سبب متوقَّع هنا محدَّد ومعروف: **هجرة 0049 لم تُشغَّل بعد**،
 * فالجدولان غير موجودين في القاعدة. ذكر السبب صراحةً يوفّر ساعة بحث.
 */
function QueryError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "خطأ غير متوقع";
  const missingTable = /does not exist|schema cache|PGRST205/i.test(message);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">تعذّر تحميل البيانات — هذه ليست قائمة فارغة</span>
        {missingTable ? (
          <span>
            الجدول غير موجود في قاعدة البيانات. شغّل الهجرة{" "}
            <code className="font-mono">0049_waiting_room_content.sql</code> في Supabase ثم أعد
            تحميل الصفحة.
          </span>
        ) : (
          <span className="font-mono text-xs">{message}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الشريط الأخباري
// ---------------------------------------------------------------------------
function TickerDialog({
  open,
  onOpenChange,
  organizationId,
  editing,
  nextSort,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  editing: TickerRow | null;
  nextSort: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [body, setBody] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  useEffect(() => {
    if (!open) return;
    setBody(editing?.body ?? "");
    setStartsOn(editing?.starts_on ?? "");
    setEndsOn(editing?.ends_on ?? "");
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (!text) throw new Error("اكتب نص الرسالة");
      // القاعدة ترفض المدى المقلوب بقيد check، لكن الرسالة الخام غير مفهومة
      if (startsOn && endsOn && endsOn < startsOn)
        throw new Error("تاريخ الانتهاء قبل تاريخ البدء");

      const payload = {
        organization_id: organizationId,
        body: text,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
      };

      if (editing) {
        const { data, error } = await supabase
          .from("waiting_room_tickers")
          .update(payload)
          .eq("id", editing.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحفظ التعديل — راجع صلاحيتك");
      } else {
        const { error } = await supabase
          .from("waiting_room_tickers")
          .insert({ ...payload, sort_order: nextSort, created_by: session?.user.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waiting-room-tickers", organizationId] });
      toast({ title: editing ? "تم تعديل الرسالة" : "تمت إضافة الرسالة" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل رسالة" : "رسالة جديدة"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نص الرسالة</Label>
            <Textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="مثال: نرحّب بمرضانا — مواعيد العيادة من 8 صباحًا حتى 9 مساءً"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>تبدأ من (اختياري)</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>تنتهي في (اختياري)</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            اتركهما فارغين لرسالة دائمة. رسالة مثل «إجازة العيد» تُكتب مرة وتختفي وحدها.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={save.isPending || !body.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TickersTab({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TickerRow | null>(null);

  const tickers = useQuery({
    queryKey: ["waiting-room-tickers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiting_room_tickers")
        .select("id, body, starts_on, ends_on, sort_order, is_active")
        .eq("organization_id", organizationId)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as TickerRow[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["waiting-room-tickers", organizationId] });

  const toggleActive = useMutation({
    mutationFn: async (row: TickerRow) => {
      const { data, error } = await supabase
        .from("waiting_room_tickers")
        .update({ is_active: !row.is_active })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  /**
   * تغيير ترتيب الرسائل.
   *
   * كان في العمود الأول **أيقونة سحب بلا وظيفة**: لا `draggable`، ولا سهمَي
   * ترتيب، ولا حقل ترتيب في حوار التعديل. أي أن ترتيب ما يمرّ على شاشات
   * الانتظار كان يُحدَّد لحظة الإنشاء ولا يمكن تغييره أبدًا، بينما الشكل يَعِد
   * بأنه قابل للسحب. الأيقونة استُبدلت بسهمين يعملان.
   *
   * ولماذا ترقيم متسلسل للقائمة كلها لا تبديل قيمتين: الصفوف القديمة قد
   * تتساوى في `sort_order` (كلها 0 مثلًا)، فتبديل قيمتين متساويتين لا يغيّر
   * شيئًا — ويظنّ المستخدم أن الزرّ لا يعمل.
   */
  const reorder = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const target = index + direction;
      const current = tickers.data ?? [];
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      for (let position = 0; position < next.length; position += 1) {
        if (next[position].sort_order === position) continue;
        const { data, error } = await supabase
          .from("waiting_room_tickers")
          .update({ sort_order: position })
          .eq("id", next[position].id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحفظ الترتيب — راجع صلاحيتك");
      }
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تغيير الترتيب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("waiting_room_tickers")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف الرسالة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const rows = tickers.data ?? [];
  const today = todayIso();

  /** هل الرسالة معروضة على الشاشة الآن فعلًا — لا مجرد "مفعّلة". */
  const isLiveNow = (row: TickerRow) =>
    row.is_active &&
    (!row.starts_on || row.starts_on <= today) &&
    (!row.ends_on || row.ends_on >= today);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="h-4 w-4" />
            نصوص الشريط الأخباري
          </CardTitle>
          <CardDescription>
            الرسائل التي تمرّ على شريط شاشات غرف الانتظار، بالترتيب المعروض — بسهمَي الترتيب
          </CardDescription>
        </div>
        {organizationId && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            رسالة جديدة
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {tickers.isLoading && <Skeleton className="h-32 w-full" />}
        {tickers.isError && <QueryError error={tickers.error} />}
        {!tickers.isLoading && !tickers.isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">الترتيب</TableHead>
                <TableHead>النص</TableHead>
                <TableHead className="w-44">الفترة</TableHead>
                <TableHead className="w-28">الحالة</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="أعلى"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => reorder.mutate({ index, direction: -1 })}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="أسفل"
                        disabled={index === rows.length - 1 || reorder.isPending}
                        onClick={() => reorder.mutate({ index, direction: 1 })}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md text-sm">{row.body}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.starts_on || row.ends_on ? (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {row.starts_on ?? "—"} ← {row.ends_on ?? "—"}
                      </span>
                    ) : (
                      "دائمة"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(row)}>
                      {/* "مفعّلة" وحدها تكذب على المستخدم حين تكون فترتها منتهية */}
                      <Badge variant={isLiveNow(row) ? "default" : "secondary"}>
                        {!row.is_active ? "موقوفة" : isLiveNow(row) ? "معروضة الآن" : "خارج الفترة"}
                      </Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد رسائل — الشريط سيظهر فارغًا على شاشات الانتظار.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {organizationId && (
        <TickerDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizationId={organizationId}
          editing={editing}
          nextSort={rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// شاشات الدور
// ---------------------------------------------------------------------------
function ScreensTab({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [selectedClinics, setSelectedClinics] = useState<string[]>([]);

  const clinics = useQuery({
    queryKey: ["content-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const screens = useQuery({
    queryKey: ["queue-display-screens", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("queue_display_screens")
        .select("id, name, branch_id, clinic_ids, show_doctor_name, show_ticker, refresh_seconds, is_active")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ScreenRow[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["queue-display-screens", organizationId] });

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("اكتب اسم الشاشة");
      const { error } = await supabase.from("queue_display_screens").insert({
        organization_id: organizationId,
        name: trimmed,
        clinic_ids: selectedClinics,
      });
      if (error) {
        if (String(error.message).includes("duplicate") || String(error.message).includes("unique"))
          throw new Error("يوجد شاشة بهذا الاسم");
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setName("");
      setSelectedClinics([]);
      toast({ title: "تمت إضافة الشاشة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const patch = useMutation({
    mutationFn: async ({ id, ...changes }: Partial<ScreenRow> & { id: string }) => {
      const { data, error } = await supabase
        .from("queue_display_screens")
        .update(changes)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("queue_display_screens")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف الشاشة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const clinicName = (id: string) => clinics.data?.find((c) => c.id === id)?.name ?? "—";
  const rows = screens.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-4 w-4" />
            شاشة جديدة
          </CardTitle>
          <CardDescription>
            شاشة التلفزيون في غرفة الانتظار — تحدّد أي عيادات يظهر دورها عليها
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الشاشة</Label>
            <Input
              className="max-w-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: انتظار الدور الأول"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادات المعروضة</Label>
            <div className="flex flex-wrap gap-2">
              {(clinics.data ?? []).map((clinic) => {
                const checked = selectedClinics.includes(clinic.id);
                return (
                  <Button
                    key={clinic.id}
                    type="button"
                    size="sm"
                    variant={checked ? "default" : "outline"}
                    onClick={() =>
                      setSelectedClinics((prev) =>
                        checked ? prev.filter((id) => id !== clinic.id) : [...prev, clinic.id],
                      )
                    }
                  >
                    {clinic.name}
                  </Button>
                );
              })}
              {(clinics.data ?? []).length === 0 && !clinics.isLoading && (
                <span className="text-xs text-muted-foreground">
                  لا توجد عيادات مفعّلة — أنشئها من شاشة الأقسام والعيادات أولًا.
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              بلا اختيار = الشاشة تعرض كل العيادات.
            </span>
          </div>
          <div>
            <Button disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الشاشات المعرَّفة</CardTitle>
        </CardHeader>
        <CardContent>
          {screens.isLoading && <Skeleton className="h-32 w-full" />}
          {screens.isError && <QueryError error={screens.error} />}
          {!screens.isLoading && !screens.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الشاشة</TableHead>
                  <TableHead>العيادات</TableHead>
                  <TableHead className="w-32">اسم الطبيب</TableHead>
                  <TableHead className="w-32">الشريط</TableHead>
                  <TableHead className="w-28">التحديث</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.clinic_ids.length === 0 ? (
                        <Badge variant="secondary">كل العيادات</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.clinic_ids.map((id) => (
                            <Badge key={id} variant="outline" className="text-[10px]">
                              {clinicName(id)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch.mutate({ id: row.id, show_doctor_name: !row.show_doctor_name })
                        }
                      >
                        <Badge variant={row.show_doctor_name ? "default" : "secondary"}>
                          {row.show_doctor_name ? "يظهر" : "مخفي"}
                        </Badge>
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch.mutate({ id: row.id, show_ticker: !row.show_ticker })}
                      >
                        <Badge variant={row.show_ticker ? "default" : "secondary"}>
                          {row.show_ticker ? "يظهر" : "مخفي"}
                        </Badge>
                      </Button>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm text-muted-foreground">
                      كل {row.refresh_seconds} ثانية
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا توجد شاشات معرَّفة بعد.
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

// ---------------------------------------------------------------------------
export default function Content() {
  const { organization } = useOrganizationAccess();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Newspaper className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">المحتوى</h1>
          <p className="text-sm text-muted-foreground">
            نصوص الشريط الأخباري وإعداد شاشات الدور في غرف الانتظار
          </p>
        </div>
      </div>

      <Tabs defaultValue="tickers" className="flex flex-col gap-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="tickers">الشريط الأخباري</TabsTrigger>
          <TabsTrigger value="screens">شاشات الدور</TabsTrigger>
        </TabsList>

        <TabsContent value="tickers">
          <TickersTab organizationId={organization?.id} />
        </TabsContent>

        <TabsContent value="screens">
          <ScreensTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
