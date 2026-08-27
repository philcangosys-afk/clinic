import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Check, Plus, X } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
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
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status, rejection_reason: status === "rejected" ? rejectionReasons[id]?.trim() || null : null })
        .eq("id", id);
      if (error) throw error;
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
                        placeholder="سبب الرفض"
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

function BalancesTab({ organizationId }: { organizationId: string | undefined }) {
  const balances = useLeaveBalances(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">أرصدة الإجازات (السنة الحالية)</CardTitle>
        <CardDescription>تُحدَّث تلقائيًا عند اعتماد أو رفض طلبات الإجازة — لا تُعدَّل يدويًا</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>نوع الإجازة</TableHead>
              <TableHead>المستحق</TableHead>
              <TableHead>المستخدم</TableHead>
              <TableHead>المتبقي</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(balances.data ?? []).map((b) => (
              <TableRow key={`${b.employee_id}-${b.leave_type_id}`}>
                <TableCell className="font-medium">{b.employee_name}</TableCell>
                <TableCell>{b.leave_type_name}</TableCell>
                <TableCell>{b.entitled_days}</TableCell>
                <TableCell>{b.used_days}</TableCell>
                <TableCell className={b.remaining_days <= 0 ? "text-destructive" : "text-emerald-600"}>
                  {b.remaining_days}
                </TableCell>
              </TableRow>
            ))}
            {(balances.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد أرصدة مُعرَّفة بعد — تُنشَأ تلقائيًا عند اعتماد أول طلب إجازة لكل موظف.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
