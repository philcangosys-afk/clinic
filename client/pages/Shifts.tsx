import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CalendarX, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { ShiftTemplateRow } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const WEEKDAYS = [
  { value: 0, label: "الأحد" },
  { value: 1, label: "الإثنين" },
  { value: 2, label: "الثلاثاء" },
  { value: 3, label: "الأربعاء" },
  { value: 4, label: "الخميس" },
  { value: 5, label: "الجمعة" },
  { value: 6, label: "السبت" },
];

function useShiftTemplates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["shift-templates", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .order("start_time");
      if (error) throw error;
      return (data as ShiftTemplateRow[]) ?? [];
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
        .select("id, name_ar, status")
        // النشط غير المعطَّل فقط، مطابقًا لشرط `app_calculate_payroll_run`
        // (`status='active'` **و** `is_disabled=false`): موظّفٌ معطَّل أو انتهت
        // خدمته يُقبل في قائمة الاختيار ثمّ يستثنيه المسيّر، فيبدو المُسند
        // مسجَّلًا وهو لا يُحتسب.
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data as { id: string; name_ar: string; status: string }[]) ?? [];
    },
  });
}

function useShiftAssignments(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["shift-assignments", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_shift_assignments")
        .select("*, employees(name_ar), shift_templates(name_ar, start_time, end_time)")
        .eq("organization_id", organizationId)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function ShiftTemplatesTab({ organizationId }: { organizationId: string | undefined }) {
  const templates = useShiftTemplates(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [graceMinutes, setGraceMinutes] = useState("10");
  const [isNight, setIsNight] = useState(false);

  const createTemplate = useMutation({
    mutationFn: async () => {
      if (!organizationId || !nameAr.trim()) throw new Error("اسم المناوبة مطلوب");
      const { error } = await supabase.from("shift_templates").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        start_time: startTime,
        end_time: endTime,
        break_minutes: Number(breakMinutes) || 0,
        grace_minutes: Number(graceMinutes) || 0,
        is_night_shift: isNight,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-templates", organizationId] });
      toast({ title: "تم إنشاء المناوبة" });
      setOpen(false);
      setNameAr("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">قوالب المناوبات</CardTitle>
          <CardDescription>كل قالب يحدد وقت البدء/الانتهاء وسماحية التأخير — يُستخدم لاحقًا في إسناد الموظفين والحضور التلقائي</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> مناوبة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>مناوبة جديدة</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>اسم المناوبة</Label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="صباحي / مسائي..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>وقت البدء</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <Label>وقت الانتهاء</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>استراحة (دقيقة)</Label>
                  <Input type="number" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
                </div>
                <div>
                  <Label>سماحية التأخير (دقيقة)</Label>
                  <Input type="number" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isNight} onChange={(e) => setIsNight(e.target.checked)} />
                <Label className="font-normal">مناوبة ليلية (تمتد لليوم التالي)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createTemplate.mutate()} disabled={createTemplate.isPending}>
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
              <TableHead>البدء</TableHead>
              <TableHead>الانتهاء</TableHead>
              <TableHead>استراحة</TableHead>
              <TableHead>سماحية التأخير</TableHead>
              <TableHead>ليلية</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(templates.data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name_ar}</TableCell>
                <TableCell>{t.start_time}</TableCell>
                <TableCell>{t.end_time}</TableCell>
                <TableCell>{t.break_minutes} د</TableCell>
                <TableCell>{t.grace_minutes} د</TableCell>
                <TableCell>{t.is_night_shift ? <Badge variant="secondary">ليلية</Badge> : "—"}</TableCell>
              </TableRow>
            ))}
            {(templates.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد مناوبات بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AssignmentsTab({ organizationId }: { organizationId: string | undefined }) {
  const assignments = useShiftAssignments(organizationId);
  const templates = useShiftTemplates(organizationId);
  const employees = useEmployeesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [showEnded, setShowEnded] = useState(false);
  const [ending, setEnding] = useState<any | null>(null);
  const [endDate, setEndDate] = useState("");

  const toggleDay = (day: number) => {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const createAssignment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !employeeId || !shiftId) throw new Error("اختر الموظف والمناوبة");
      if (weekdays.length === 0) throw new Error("اختر يومًا واحدًا على الأقل");
      const { error } = await supabase.from("employee_shift_assignments").insert({
        organization_id: organizationId,
        employee_id: employeeId,
        shift_template_id: shiftId,
        weekdays,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-assignments", organizationId] });
      toast({ title: "تم إسناد المناوبة" });
      setOpen(false);
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  /**
   * إنهاء الإسناد بتاريخ لا حذفه.
   *
   * نقل موظّف من الصباحيّة إلى المسائيّة كان يُنفَّذ بحذف الإسناد القديم، فيُمحى
   * أثر أنه كان يعمل صباحًا: وأيّ مراجعة لاحقة لتأخير شهر ماضٍ تُقاس على
   * المناوبة الجديدة (المُحفِّز `app_fill_attendance_shift` يختار الإسناد
   * السّاري في `work_date` نفسه). والجدول يحمل `effective_to` وهو الحقل
   * المخصّص لذلك، ولم تكن أي واجهة تكتبه.
   */
  const endAssignment = useMutation({
    mutationFn: async ({ id, endDate, from }: { id: string; endDate: string; from: string }) => {
      if (!endDate) throw new Error("حدّد تاريخ الإنهاء");
      // القيد في القاعدة يفرض effective_to >= effective_from — نمنعه هنا برسالة
      // مفهومة بدل رسالة قيد خامّة.
      if (endDate < from) throw new Error("تاريخ الإنهاء لا يكون قبل تاريخ بداية الإسناد");
      const { data: affectedRows, error } = await supabase
        .from("employee_shift_assignments")
        .update({ effective_to: endDate })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-assignments", organizationId] });
      toast({ title: "أُنهي الإسناد بتاريخه", description: "سجلّ المناوبة السابقة محفوظ للمراجعة" });
      setEnding(null);
    },
    // بلا `onError` تفشل العملية صامتة: الرسالة تُرفَع ولا يعرضها أحد
    // (`QueryClient` في App.tsx بلا معالج أخطاء افتراضيّ).
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const isActiveAssignment = (a: any) => !a.effective_to || a.effective_to >= today;
  const rows = (assignments.data ?? []).filter((a: any) => showEnded || isActiveAssignment(a));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">إسناد المناوبات للموظفين</CardTitle>
          <CardDescription>كل إسناد يحدد أيام الأسبوع التي يعمل فيها الموظف بهذه المناوبة</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> إسناد جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إسناد مناوبة جديد</DialogTitle>
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
              <div>
                <Label>المناوبة</Label>
                <Select value={shiftId} onValueChange={setShiftId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر مناوبة" />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name_ar} ({t.start_time}–{t.end_time})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>أيام العمل</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={
                        weekdays.includes(d.value)
                          ? "rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                          : "rounded-full border px-3 py-1 text-xs text-muted-foreground"
                      }
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createAssignment.mutate()} disabled={createAssignment.isPending}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
          عرض الإسنادات المنتهية أيضًا
        </label>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>المناوبة</TableHead>
              <TableHead>الأيام</TableHead>
              <TableHead>من تاريخ</TableHead>
              <TableHead>إلى تاريخ</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a: any) => (
              <TableRow key={a.id} className={isActiveAssignment(a) ? undefined : "opacity-60"}>
                <TableCell className="font-medium">{a.employees?.name_ar ?? "—"}</TableCell>
                <TableCell>{a.shift_templates?.name_ar ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {(a.weekdays ?? []).map((d: number) => WEEKDAYS.find((w) => w.value === d)?.label).join("، ")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.effective_from}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.effective_to ?? "—"}
                  {a.effective_to && (
                    <Badge variant="secondary" className="ms-1 text-[10px]">
                      منتهٍ
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {isActiveAssignment(a) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="إنهاء الإسناد بتاريخ"
                      onClick={() => {
                        setEnding(a);
                        setEndDate(today);
                      }}
                    >
                      <CalendarX className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  {(assignments.data ?? []).length === 0 ? "لا توجد إسنادات بعد." : "لا إسنادات سارية — أظهر المنتهية لعرضها."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* تأكيد صريح: الإنهاء يغيّر ما تُقاس عليه المناوبة من تاريخه، فلا يقع بضغطة واحدة */}
      <Dialog open={Boolean(ending)} onOpenChange={(next) => !next && setEnding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنهاء إسناد المناوبة</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p>
              {ending?.employees?.name_ar ?? "—"} — {ending?.shift_templates?.name_ar ?? "—"} (من {ending?.effective_from})
            </p>
            <p className="text-xs text-muted-foreground">
              الإسناد لا يُحذف: يُنهى بتاريخ فيبقى محفوظًا لمراجعة تأخير الأشهر الماضية على المناوبة التي كانت سارية فعلًا.
            </p>
            <div>
              <Label>تاريخ الإنهاء</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnding(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              disabled={!endDate || endAssignment.isPending}
              onClick={() =>
                endAssignment.mutate({ id: ending.id, endDate, from: ending.effective_from })
              }
            >
              تأكيد الإنهاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Shifts() {
  const { organization } = useOrganizationAccess();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarRange className="h-6 w-6" /> المناوبات والجداول
        </h1>
        <p className="text-sm text-muted-foreground">تعريف قوالب المناوبات وإسنادها للموظفين — تُستخدم تلقائيًا لحساب التأخير في شاشة الحضور</p>
      </div>
      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">القوالب</TabsTrigger>
          <TabsTrigger value="assignments">الإسنادات</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4">
          <ShiftTemplatesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
