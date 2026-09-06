import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Check, Plus, X, AlertTriangle } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { LeaveBalanceCurrentYearView, LeaveRequestStatus, LeaveTypeRow } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: "قيد المراجعة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};
const STATUS_BADGE: Record<LeaveRequestStatus, "success" | "default" | "destructive" | "secondary"> = {
  pending: "secondary",
  approved: "success",
  rejected: "destructive",
  cancelled: "default",
};

function useLeaveTypes(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["leave-types", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_types")
        .select("*")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("name_ar");
      if (error) throw error;
      return (data as LeaveTypeRow[]) ?? [];
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
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("name_ar");
      if (error) throw error;
      return (data as { id: string; name_ar: string }[]) ?? [];
    },
  });
}

function useLeaveRequests(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["leave-requests", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*, employees(name_ar), leave_types(name_ar)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useLeaveBalances(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["leave-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_leave_balances_current_year")
        .select("*")
        .eq("organization_id", organizationId)
        .order("employee_name");
      if (error) throw error;
      return (data as LeaveBalanceCurrentYearView[]) ?? [];
    },
  });
}

function RequestsTab({ organizationId }: { organizationId: string | undefined }) {
  const requests = useLeaveRequests(organizationId);
  const leaveTypes = useLeaveTypes(organizationId);
  const employees = useEmployeesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["leave-requests", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["leave-balances", organizationId] });
  };

  const createRequest = useMutation({
    mutationFn: async () => {
      if (!organizationId || !employeeId || !leaveTypeId || !startDate || !endDate) {
        throw new Error("كل الحقول مطلوبة");
      }
      const { error } = await supabase.from("leave_requests").insert({
        organization_id: organizationId,
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم إرسال طلب الإجازة" });
      setOpen(false);
      setReason("");
    },
    onError: (error: Error) => toast({ title: "تعذّر إرسال الطلب", description: error.message, variant: "destructive" }),
  });

  const decide = useMutation({
    /**
     * الاعتماد يمرّ بـ`app_approve_leave_request` لا بتحديث مباشر.
     *
     * التحديث المباشر كان يتخطّى ثلاثة أمور تفعلها الدالّة: فحص صلاحية
     * `hr.leave_approve`، وفحص تعارض الإجازة مع جدول الطبيب ومواعيده
     * المحجوزة، وكتابة من اعتمد ومتى في سجلّ التدقيق. أي أن أيّ عضو تسمح له
     * سياسة الجدول بالتحديث كان يعتمد إجازة طبيبٍ عليه مواعيد مؤكَّدة غدًا.
     *
     * وحين يوجد تعارض ترفض الدالّة الاعتماد إلّا بقرار مكتوب — والحقل النصّي
     * في الصفّ هو موضع كتابته (وهو نفسه سبب الرفض عند الرفض).
     */
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const note = rejectionReasons[id]?.trim() || null;
      if (status === "approved") {
        const { error } = await supabase.rpc("app_approve_leave_request", {
          p_request_id: id,
          p_conflict_note: note,
        });
        if (error) throw error;
        return;
      }
      const { data: affectedRows, error } = await supabase
        .from("leave_requests")
        .update({ status, rejection_reason: note })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: (_, vars) => {
      invalidate();
      toast({ title: vars.status === "approved" ? "تم اعتماد الطلب" : "تم رفض الطلب" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">طلبات الإجازة</CardTitle>
          <CardDescription>قاعدة البيانات تمنع تلقائيًا أي طلب يتداخل مع طلب آخر أو يتجاوز الرصيد المتاح</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> طلب إجازة جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>طلب إجازة جديد</DialogTitle>
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
                <Label>نوع الإجازة</Label>
                <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر نوع الإجازة" />
                  </SelectTrigger>
                  <SelectContent>
                    {(leaveTypes.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>من تاريخ</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label>إلى تاريخ</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>السبب (اختياري)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createRequest.mutate()} disabled={createRequest.isPending}>
                إرسال الطلب
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الفترة</TableHead>
              <TableHead>الأيام</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.employees?.name_ar ?? "—"}</TableCell>
                <TableCell>{r.leave_types?.name_ar ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.start_date} → {r.end_date}
                </TableCell>
                <TableCell>{r.days_count}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[r.status as LeaveRequestStatus]}>{STATUS_LABELS[r.status as LeaveRequestStatus]}</Badge>
                </TableCell>
                <TableCell>
                  {r.status === "pending" && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-8 w-32"
                        placeholder="سبب الرفض / قرار التعارض"
                        value={rejectionReasons[r.id] ?? ""}
                        onChange={(e) => setRejectionReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, status: "approved" })}>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, status: "rejected" })}>
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                  {r.status === "rejected" && r.rejection_reason && (
                    <p className="text-xs text-muted-foreground">السبب: {r.rejection_reason}</p>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(requests.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد طلبات إجازة بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * أرصدة الإجازات (لقطة 88).
 *
 * **خلل حقيقي كان قائمًا**: مُحفِّز `app_validate_leave_request` (0020)
 * **يرفض** أي طلب إجازة مدفوعة لا رصيد مُعرَّف له:
 * «لا يوجد رصيد إجازات مُعرَّف لهذا الموظف لنوع الإجازة "..." لسنة ...».
 * ولم تكن هناك أي واجهة لإنشاء رصيد — فكانت الإجازات المدفوعة **معطَّلة
 * بالكامل** في النظام. وكانت الشاشة تقول للمستخدم العكس تمامًا: «تُنشَأ
 * تلقائيًا عند اعتماد أول طلب إجازة». تحقّقت من الرفض بتنفيذ الحالة فعليًا.
 *
 * **`used_days` غير قابل للتعديل من هنا** — يملكه المُحفِّز وحده. تعديله
 * يدويًا يجعل الرصيد يخالف مجموع الطلبات المعتمَدة فعلًا.
 */
function BalancesTab({ organizationId }: { organizationId: string | undefined }) {
  const balances = useLeaveBalances(organizationId);
  const leaveTypes = useLeaveTypes(organizationId);
  const employees = useEmployeesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveBalanceCurrentYearView | null>(null);

  const currentYear = new Date().getFullYear();
  const paidTypes = (leaveTypes.data ?? []).filter((type) => type.is_paid);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["leave-balances", organizationId] });

  /**
   * توليد أرصدة السنة لكل الموظفين النشطين × أنواع الإجازات المدفوعة.
   *
   * `ignoreDuplicates` مقصود: القيد الفريد (موظف، نوع، سنة) يمنع التكرار،
   * والتجاهل يحمي رصيدًا عُدِّل استحقاقه يدويًا من أن يُعاد لقيمة النوع
   * الافتراضية عند إعادة التوليد — والأهم أنه يمنع لمس `used_days` لصف قائم.
   */
  const generate = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const staff = employees.data ?? [];
      if (staff.length === 0) throw new Error("لا يوجد موظفون نشطون");
      if (paidTypes.length === 0)
        throw new Error("لا توجد أنواع إجازات مدفوعة — عرّف نوعًا في تبويب الأنواع أولًا");

      const rows = staff.flatMap((employee) =>
        paidTypes.map((type) => ({
          organization_id: organizationId,
          employee_id: employee.id,
          leave_type_id: type.id,
          year: currentYear,
          entitled_days: Number(type.annual_entitlement_days) || 0,
          // used_days يُترك لقيمته الافتراضية (0) — لا يُكتب أبدًا من الواجهة
        })),
      );

      const { error } = await supabase
        .from("leave_balances")
        .upsert(rows, { onConflict: "employee_id,leave_type_id,year", ignoreDuplicates: true });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      invalidate();
      toast({
        title: `عولجت ${count} حالة رصيد لسنة ${currentYear}`,
        description: "الأرصدة الموجودة مسبقًا تُركت كما هي ولم تُستبدل.",
      });
      setGenerateOpen(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التوليد",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const saveEntitlement = useMutation({
    mutationFn: async ({ row, days }: { row: LeaveBalanceCurrentYearView; days: number }) => {
      if (!Number.isFinite(days) || days < 0) throw new Error("عدد الأيام يجب أن يكون رقمًا غير سالب");

      /**
       * `used_days` يُقرأ من القاعدة لحظة الحفظ لا من الصف المعروض: القيمة
       * المعروضة قد تكون قديمة لدقائق، وقد يكون مديرٌ اعتمد طلبًا بينها
       * وبين الآن. الاعتماد على القيمة القديمة كان يسمح بمستحق أقل من
       * المستخدَم فعلًا فيصير الرصيد سالبًا — ولا قيد في القاعدة يمنع ذلك.
       */
      const { data: current, error: readError } = await supabase
        .from("leave_balances")
        .select("used_days")
        .eq("employee_id", row.employee_id)
        .eq("leave_type_id", row.leave_type_id)
        .eq("year", currentYear)
        .maybeSingle();
      if (readError) throw readError;
      const usedNow = Number(current?.used_days ?? row.used_days);
      if (days < usedNow)
        throw new Error(
          `لا يمكن جعل المستحق (${days}) أقل من المستخدَم فعلًا (${usedNow}) — الرصيد سيصبح سالبًا`,
        );
      const { data, error } = await supabase
        .from("leave_balances")
        .update({ entitled_days: days, updated_at: new Date().toISOString() })
        .eq("employee_id", row.employee_id)
        .eq("leave_type_id", row.leave_type_id)
        .eq("year", currentYear)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST — بلا الفحص تظهر رسالة نجاح كاذبة
      if (!data || data.length === 0)
        throw new Error("لم يُحفظ التعديل — تعديل الأرصدة مقيَّد بصفة مدير الموارد البشرية");
      return days;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تحديث الرصيد المستحق" });
      setEditing(null);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const rows = balances.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">أرصدة الإجازات (سنة {currentYear})</CardTitle>
          <CardDescription>
            المستحق يُحدَّد هنا، والمستخدَم يُحدِّثه النظام وحده عند اعتماد الطلبات أو إلغائها
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setGenerateOpen(true)}>
          <Plus className="h-4 w-4" />
          توليد أرصدة السنة
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 && !balances.isLoading && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>لا يمكن تقديم أي طلب إجازة مدفوعة قبل تعريف الأرصدة.</strong> النظام يرفض
              الطلب إن لم يكن للموظف رصيد مُعرَّف لنوع الإجازة في هذه السنة. اضغط «توليد أرصدة
              السنة» لإنشائها لكل الموظفين النشطين حسب الاستحقاق السنوي المُعرَّف في كل نوع.
            </span>
          </div>
        )}

        {balances.isLoading && <Skeleton className="h-32 w-full" />}
        {!balances.isLoading && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>نوع الإجازة</TableHead>
                <TableHead>المستحق</TableHead>
                <TableHead>المستخدم</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={`${b.employee_id}-${b.leave_type_id}`}>
                  <TableCell className="font-medium">{b.employee_name}</TableCell>
                  <TableCell>{b.leave_type_name}</TableCell>
                  <TableCell className="tabular-nums">{b.entitled_days}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{b.used_days}</TableCell>
                  <TableCell
                    className={`tabular-nums ${Number(b.remaining_days) <= 0 ? "text-destructive" : "text-emerald-600"}`}
                  >
                    {b.remaining_days}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                      تعديل المستحق
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>توليد أرصدة سنة {currentYear}</DialogTitle>
            <DialogDescription>
              يُنشأ رصيد لكل موظف نشط لكل نوع إجازة مدفوعة، بالاستحقاق السنوي المُعرَّف في النوع
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <p>
              الموظفون النشطون: <strong>{(employees.data ?? []).length}</strong>
            </p>
            <p>
              أنواع الإجازات المدفوعة: <strong>{paidTypes.length}</strong>
              {paidTypes.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  ({paidTypes.map((type) => `${type.name_ar} ${type.annual_entitlement_days} يومًا`).join("، ")})
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              الأرصدة الموجودة مسبقًا لن تتغيّر — لا استحقاقها ولا ما استُخدم منها.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={generate.isPending || paidTypes.length === 0 || (employees.data ?? []).length === 0}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? "جارٍ التوليد..." : "توليد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <EditEntitlementDialog
          key={`${editing.employee_id}-${editing.leave_type_id}`}
          row={editing}
          onCancel={() => setEditing(null)}
          onSave={(days) => saveEntitlement.mutate({ row: editing, days })}
          saving={saveEntitlement.isPending}
        />
      )}
    </Card>
  );
}

function EditEntitlementDialog({
  row,
  onCancel,
  onSave,
  saving,
}: {
  row: LeaveBalanceCurrentYearView;
  onCancel: () => void;
  onSave: (days: number) => void;
  saving: boolean;
}) {
  const [days, setDays] = useState(String(row.entitled_days));
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تعديل المستحق</DialogTitle>
          <DialogDescription>
            {row.employee_name} — {row.leave_type_name}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الأيام المستحقة</Label>
            <Input type="number" min={0} step="0.5" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            المستخدَم حاليًا {row.used_days} يومًا — لا يمكن جعل المستحق أقل منه.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            إلغاء
          </Button>
          <Button disabled={saving} onClick={() => onSave(Number(days))}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypesTab({ organizationId }: { organizationId: string | undefined }) {
  const leaveTypes = useLeaveTypes(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [days, setDays] = useState("0");
  const [isPaid, setIsPaid] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(true);

  const createType = useMutation({
    mutationFn: async () => {
      if (!organizationId || !nameAr.trim()) throw new Error("اسم النوع مطلوب");
      const { error } = await supabase.from("leave_types").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        annual_entitlement_days: Number(days) || 0,
        is_paid: isPaid,
        requires_approval: requiresApproval,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-types", organizationId] });
      toast({ title: "تم إضافة نوع الإجازة" });
      setOpen(false);
      setNameAr("");
      setRequiresApproval(true);
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">أنواع الإجازات</CardTitle>
          <CardDescription>الأنواع النظامية الأربعة (سنوية/مرضية/طارئة/بدون راتب) متاحة لكل المؤسسات — يمكن إضافة أنواع خاصة بمؤسستك</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> نوع جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>نوع إجازة جديد</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>الاسم</Label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </div>
              <div>
                <Label>المستحق سنويًا (يوم)</Label>
                <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
                <Label className="font-normal">مدفوعة الأجر</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
                <Label className="font-normal">تتطلب موافقة قبل الاعتماد</Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createType.mutate()} disabled={createType.isPending}>
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
              <TableHead>المستحق سنويًا</TableHead>
              <TableHead>مدفوعة</TableHead>
              <TableHead>تتطلب موافقة</TableHead>
              <TableHead>النطاق</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(leaveTypes.data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name_ar}</TableCell>
                <TableCell>{t.annual_entitlement_days}</TableCell>
                <TableCell>{t.is_paid ? "نعم" : "لا"}</TableCell>
                <TableCell>{t.requires_approval ? "نعم" : "لا"}</TableCell>
                <TableCell>
                  <Badge variant={t.organization_id === null ? "secondary" : "outline"}>
                    {t.organization_id === null ? "نظامي عام" : "خاص بمؤسستك"}
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

export default function Leave() {
  const { organization } = useOrganizationAccess();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarCheck2 className="h-6 w-6" /> الإجازات
        </h1>
        <p className="text-sm text-muted-foreground">طلب ← اعتماد/رفض — الرصيد يُخصَم ويُعاد تلقائيًا من قاعدة البيانات عند كل قرار</p>
      </div>
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">الطلبات</TabsTrigger>
          <TabsTrigger value="balances">الأرصدة</TabsTrigger>
          <TabsTrigger value="types">الأنواع</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4">
          <RequestsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <BalancesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="types" className="mt-4">
          <TypesTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
