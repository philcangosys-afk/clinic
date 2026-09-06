import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut, UserCheck } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import type { AttendanceStatus, TodayAttendanceView } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  pending: "لم يسجّل",
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  on_leave: "في إجازة",
  holiday: "عطلة",
};
/**
 * شارة لكل حالة، ولا شارتين متطابقتين.
 *
 * كانت «في إجازة» و«عطلة» بشارة `secondary` الرمادية نفسها، وهي قريبة بصريًّا
 * من «لم يسجّل» — فيوم إجازةٍ معتمدة (يكتبه اعتماد الإجازة في سجلّ الحضور) كان
 * يُقرأ في الشاشة كأنه يومٌ لم يُسجَّل فيه شيء، فيعيد المستخدم تحديده «غائبًا».
 * «في إجازة» صارت شارة بارزة مستقلّة، و«متأخر» أخذت العنبريّ المطابق لبطاقة
 * الملخّص أعلى الشاشة.
 */
const STATUS_BADGE: Record<AttendanceStatus, "success" | "default" | "destructive" | "secondary" | "outline" | "warning"> = {
  pending: "outline",
  present: "success",
  late: "warning",
  absent: "destructive",
  on_leave: "default",
  holiday: "secondary",
};

function useTodayAttendance(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["today-attendance", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_today_attendance")
        .select("*")
        .eq("organization_id", organizationId)
        .order("employee_name");
      if (error) throw error;
      return (data as TodayAttendanceView[]) ?? [];
    },
  });
}

function useMonthHistory(organizationId: string | undefined, month: string) {
  return useQuery({
    queryKey: ["attendance-history", organizationId, month],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // نهاية الشهر تُحسب لا تُفترض: كان الحدّ `${month}-31` فترفضه القاعدة
      // في فبراير وأبريل ويونيو وسبتمبر ونوفمبر بخطأ «date/time field value
      // out of range»، فيفشل الاستعلام كلّه ويظهر سجلّ الشهر فارغًا في خمسة
      // أشهر من كل سنة.
      const start = `${month}-01`;
      const [year, monthIndex] = month.split("-").map(Number);
      const end = new Date(year, monthIndex, 0);
      const endIso = `${month}-${String(end.getDate()).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*, employees(name_ar)")
        .eq("organization_id", organizationId)
        .gte("work_date", start)
        .lte("work_date", endIso)
        .order("work_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Attendance() {
  const { organization } = useOrganizationAccess();
  const today = useTodayAttendance(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const history = useMonthHistory(organization?.id, month);

  const checkIn = useMutation({
    mutationFn: async (employeeId: string) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة");
      const { error } = await supabase.from("attendance_records").upsert(
        {
          organization_id: organization.id,
          employee_id: employeeId,
          work_date: new Date().toISOString().slice(0, 10),
          check_in_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,work_date" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-attendance", organization?.id] });
      // سجلّ الشهر يقرأ من نفس الجدول بمفتاح آخر: بلا إبطاله يحفظ المستخدم
      // حضورًا ولا يراه في الجدول أسفل الشاشة حتى يُحدِّث الصفحة.
      queryClient.invalidateQueries({ queryKey: ["attendance-history", organization?.id] });
      toast({ title: "تم تسجيل الحضور" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const checkOut = useMutation({
    mutationFn: async (employeeId: string) => {
      const { data: affectedRows, error } = await supabase
        .from("attendance_records")
        .update({ check_out_at: new Date().toISOString() })
        .eq("employee_id", employeeId)
        .eq("work_date", new Date().toISOString().slice(0, 10))
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-attendance", organization?.id] });
      // سجلّ الشهر يقرأ من نفس الجدول بمفتاح آخر: بلا إبطاله يحفظ المستخدم
      // حضورًا ولا يراه في الجدول أسفل الشاشة حتى يُحدِّث الصفحة.
      queryClient.invalidateQueries({ queryKey: ["attendance-history", organization?.id] });
      toast({ title: "تم تسجيل الانصراف" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const saveNote = useMutation({
    /**
     * الملاحظة **تُحدِّث** صفّ اليوم ولا تُنشئه.
     *
     * كانت `upsert`: فكتابة ملاحظة على موظّف لم يسجّل حضوره تُنشئ صفًّا بلا
     * توقيت حضور، ومحفِّز `app_calc_attendance_status` يحوّل هذا الصفّ إلى
     * «غائب» — فيُخصم من راتب موظّف حاضر لأن أحدهم كتب ملاحظة على اسمه.
     * تحقّقت من ذلك في القاعدة: صفٌّ بلا `check_in_at` وحالته الافتراضية
     * `pending` يصير `absent`.
     */
    mutationFn: async ({ employeeId, note }: { employeeId: string; note: string }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة");
      const { data: affectedRows, error } = await supabase
        .from("attendance_records")
        .update({ note: note.trim() || null })
        .eq("organization_id", organization.id)
        .eq("employee_id", employeeId)
        .eq("work_date", new Date().toISOString().slice(0, 10))
        .select("id");
      if (error) throw error;
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("سجّل الحضور أو حدّد حالة اليوم أولًا، ثم اكتب الملاحظة عليها");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-attendance", organization?.id] });
      // سجلّ الشهر يقرأ من نفس الجدول بمفتاح آخر: بلا إبطاله يحفظ المستخدم
      // حضورًا ولا يراه في الجدول أسفل الشاشة حتى يُحدِّث الصفحة.
      queryClient.invalidateQueries({ queryKey: ["attendance-history", organization?.id] });
      toast({ title: "تم حفظ الملاحظة" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const markStatus = useMutation({
    mutationFn: async ({ employeeId, status }: { employeeId: string; status: AttendanceStatus }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة");
      const { error } = await supabase.from("attendance_records").upsert(
        {
          organization_id: organization.id,
          employee_id: employeeId,
          work_date: new Date().toISOString().slice(0, 10),
          status,
        },
        { onConflict: "employee_id,work_date" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-attendance", organization?.id] });
      // سجلّ الشهر يقرأ من نفس الجدول بمفتاح آخر: بلا إبطاله يحفظ المستخدم
      // حضورًا ولا يراه في الجدول أسفل الشاشة حتى يُحدِّث الصفحة.
      queryClient.invalidateQueries({ queryKey: ["attendance-history", organization?.id] });
      toast({ title: "تم تحديث الحالة" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const setOvertime = useMutation({
    /**
     * مدخل دقائق العمل الإضافيّ.
     *
     * `overtime_minutes` لم يكن يُكتب من أي موضع في الواجهة ولا يحسبه أي
     * مُحفِّز، فبطاقة «عمل إضافيّ بانتظار الاعتماد» في شاشة الرواتب تشترط
     * `overtime_minutes > 0` فلا تُطابق شيئًا أبدًا: يظلّ بند الإضافيّ في
     * القسيمة صفرًا ولا يجد المستخدم مكانًا يُدخل فيه الدقائق. الإدخال هنا على
     * صفّ الحضور القائم لأن الإضافيّ صفةُ يومٍ مسجَّل — ولا يُنشئ صفًّا (الصفّ
     * الجديد بلا توقيت حضور يصير «غائبًا» بالمُحفِّز).
     */
    mutationFn: async ({ id, minutes }: { id: string; minutes: number }) => {
      if (!Number.isFinite(minutes) || minutes < 0) throw new Error("دقائق العمل الإضافيّ رقم غير سالب");
      const { data: affectedRows, error } = await supabase
        .from("attendance_records")
        .update({ overtime_minutes: Math.round(minutes) })
        .eq("id", id)
        // المعتمَد لا يُعدَّل من هنا: تعديله بعد الاعتماد يغيّر مستحقًّا أُقرّ.
        .is("overtime_approved_by", null)
        .select("id");
      if (error) throw error;
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — الإضافيّ معتمَد أو راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-history", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["today-attendance", organization?.id] });
      // بطاقة الاعتماد في شاشة الرواتب تقرأ نفس الجدول بمفتاح آخر.
      queryClient.invalidateQueries({ queryKey: ["pending-overtime"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      toast({ title: "سُجّلت دقائق العمل الإضافيّ", description: "لا تُحتسب في الراتب قبل اعتمادها" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const summary = useMemo(() => {
    const rows = today.data ?? [];
    return {
      present: rows.filter((r) => r.status === "present").length,
      late: rows.filter((r) => r.status === "late").length,
      absent: rows.filter((r) => r.status === "absent").length,
      // «في إجازة» لم تكن معدودة في الملخّص أصلًا، فكان مجموع البطاقات أقلّ من
      // عدد الموظفين بلا تفسير ظاهر — ومن في إجازة معتمدة يبدو غائبًا عن الكشف.
      onLeave: rows.filter((r) => r.status === "on_leave").length,
      pending: rows.filter((r) => r.status === "pending").length,
    };
  }, [today.data]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Clock className="h-6 w-6" /> الحضور والانصراف
        </h1>
        <p className="text-sm text-muted-foreground">
          تسجيل حضور اليوم لكل الموظفين — الحالة والتأخير تُحسب تلقائيًا من قاعدة البيانات مقارنةً
          بالمناوبة المُسندة، وأيام الإجازات المعتمدة تظهر هنا «في إجازة» من تلقاء نفسها
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{summary.present}</p>
            <p className="text-xs text-muted-foreground">حاضر</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{summary.late}</p>
            <p className="text-xs text-muted-foreground">متأخر</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-red-600">{summary.absent}</p>
            <p className="text-xs text-muted-foreground">غائب</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-primary">{summary.onLeave}</p>
            <p className="text-xs text-muted-foreground">في إجازة</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{summary.pending}</p>
            <p className="text-xs text-muted-foreground">لم يسجّل بعد</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">حضور اليوم</CardTitle>
          <CardDescription>{new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</CardDescription>
        </CardHeader>
        <CardContent>
          {today.isLoading && <Skeleton className="h-40 w-full" />}
          {!today.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الحضور</TableHead>
                  <TableHead>الانصراف</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التأخير</TableHead>
                  <TableHead>الانصراف المبكر</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(today.data ?? []).map((row) => (
                  <TableRow key={row.employee_id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-muted-foreground" /> {row.employee_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.check_in_at ? new Date(row.check_in_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.check_out_at ? new Date(row.check_out_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.late_minutes > 0 ? `${row.late_minutes} د` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.early_leave_minutes > 0 ? `${row.early_leave_minutes} د` : "—"}
                    </TableCell>
                    <TableCell>
                      <Input
                        key={`${row.employee_id}-${row.note ?? ""}`}
                        defaultValue={row.note ?? ""}
                        placeholder="ملاحظة..."
                        className="h-8 w-32 text-xs"
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (row.note ?? "")) {
                            saveNote.mutate({ employeeId: row.employee_id, note: e.target.value });
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {!row.check_in_at && (
                          <Button size="sm" variant="outline" onClick={() => checkIn.mutate(row.employee_id)}>
                            <LogIn className="ms-1 h-3.5 w-3.5" /> حضور
                          </Button>
                        )}
                        {row.check_in_at && !row.check_out_at && (
                          <Button size="sm" variant="outline" onClick={() => checkOut.mutate(row.employee_id)}>
                            <LogOut className="ms-1 h-3.5 w-3.5" /> انصراف
                          </Button>
                        )}
                        {/*
                          يوم الإجازة المعتمدة لا يُعاد تحديد حالته من هنا: صفّه كتبه اعتماد
                          الإجازة، وتحديده «غائبًا» بـ`upsert` كان يمحو أثر إجازةٍ معتمدة
                          فيُخصَم من راتب موظّفٍ في إجازة نظامية. تُلغى الإجازة من شاشة
                          الإجازات لا من هنا.
                        */}
                        {!row.check_in_at && row.status !== "on_leave" && (
                          <Select onValueChange={(v) => markStatus.mutate({ employeeId: row.employee_id, status: v as AttendanceStatus })}>
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue placeholder="تحديد حالة" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="absent">غائب</SelectItem>
                              <SelectItem value="on_leave">في إجازة</SelectItem>
                              <SelectItem value="holiday">عطلة</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {row.status === "on_leave" && (
                          <span className="text-[11px] text-muted-foreground">
                            إجازة معتمدة — تُلغى من شاشة الإجازات
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(today.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد موظفون نشطون.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">سجل الحضور الشهري</CardTitle>
            <CardDescription>
              كل السجلات المحفوظة خلال الشهر المحدد — دقائق العمل الإضافيّ تُدخَل هنا على يوم
              مسجَّل، ولا تُحتسب في الراتب قبل اعتمادها في «الرواتب ← الحضور والإضافيّ»
            </CardDescription>
          </div>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>الحضور</TableHead>
                <TableHead>الانصراف</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التأخير</TableHead>
                <TableHead>الانصراف المبكر</TableHead>
                <TableHead>إضافيّ (د)</TableHead>
                <TableHead>ملاحظة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.work_date}</TableCell>
                  <TableCell className="font-medium">{r.employees?.name_ar ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString("ar-SA") : "—"}</TableCell>
                  <TableCell className="text-xs">{r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString("ar-SA") : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[r.status as AttendanceStatus]}>{STATUS_LABELS[r.status as AttendanceStatus]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.late_minutes > 0 ? `${r.late_minutes} د` : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.early_leave_minutes > 0 ? `${r.early_leave_minutes} د` : "—"}</TableCell>
                  <TableCell className="text-xs">
                    {r.overtime_approved_by ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        {r.overtime_minutes}
                        <Badge variant="success" className="text-[10px]">معتمَد</Badge>
                      </span>
                    ) : can("hr.attendance") ? (
                      <Input
                        key={`${r.id}-${r.overtime_minutes}`}
                        type="number"
                        min={0}
                        defaultValue={String(r.overtime_minutes ?? 0)}
                        className="h-8 w-20 text-xs"
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (next !== Number(r.overtime_minutes ?? 0)) {
                            setOvertime.mutate({ id: r.id, minutes: next });
                          }
                        }}
                      />
                    ) : (
                      <span className="text-muted-foreground">{r.overtime_minutes ?? 0}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.note ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(history.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد سجلات لهذا الشهر.
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
