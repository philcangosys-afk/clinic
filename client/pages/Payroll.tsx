import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function currentMonthLabel() {
  return new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long" });
}
function startOfMonthIso() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function useEmployeesWithPayroll(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["employees-payroll", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data: employees, error: employeesError } = await supabase
        .from("employees")
        .select("id, file_number, name_ar, total_salary")
        .eq("status", "active")
        .order("file_number");
      if (employeesError) throw employeesError;

      const { data: vouchers, error: vouchersError } = await supabase
        .from("financial_vouchers")
        .select("employee_ref_id, amount, voucher_date")
        .eq("voucher_type", "salary")
        .gte("voucher_date", startOfMonthIso().slice(0, 10));
      if (vouchersError) throw vouchersError;

      const paidThisMonth = new Set((vouchers ?? []).map((voucher) => voucher.employee_ref_id));
      return (employees ?? []).map((employee) => ({ ...employee, paidThisMonth: paidThisMonth.has(employee.id) }));
    },
  });
}

export default function Payroll() {
  const { organization } = useOrganizationAccess();
  const [payTarget, setPayTarget] = useState<{ id: string; name_ar: string; total_salary: number } | null>(null);
  const employees = useEmployeesWithPayroll(organization?.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الرواتب</h1>
        <p className="text-sm text-muted-foreground">صرف رواتب شهر {currentMonthLabel()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الموظفون النشطون</CardTitle>
          <CardDescription>صرف الراتب يُنشئ سند صرف (salary) مرتبطًا بالموظف تلقائيًا</CardDescription>
        </CardHeader>
        <CardContent>
          {employees.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!employees.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>إجمالي الراتب</TableHead>
                  <TableHead>حالة هذا الشهر</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(employees.data ?? []).map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-mono text-xs">#{employee.file_number}</TableCell>
                    <TableCell className="font-medium">{employee.name_ar}</TableCell>
                    <TableCell>{Number(employee.total_salary).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>
                      {employee.paidThisMonth ? (
                        <Badge variant="success">
                          <CheckCircle2 className="h-3 w-3" />
                          صُرف
                        </Badge>
                      ) : (
                        <Badge variant="secondary">لم يُصرف بعد</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={employee.paidThisMonth}
                        onClick={() =>
                          setPayTarget({ id: employee.id, name_ar: employee.name_ar, total_salary: Number(employee.total_salary) })
                        }
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        صرف الراتب
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(employees.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد موظفون نشطون.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PaySalaryDialog target={payTarget} onOpenChange={() => setPayTarget(null)} organizationId={organization?.id} />
    </div>
  );
}

function PaySalaryDialog({
  target,
  onOpenChange,
  organizationId,
}: {
  target: { id: string; name_ar: string; total_salary: number } | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");

  // مزامنة قيمة الحقل مع الموظف المحدد حديثًا — الراتب الإجمالي كقيمة مبدئية قابلة للتعديل
  useEffect(() => {
    if (target) setAmount(String(target.total_salary));
  }, [target?.id]);

  const paySalary = useMutation({
    mutationFn: async () => {
      if (!organizationId || !target) throw new Error("بيانات غير مكتملة");
      const { error } = await supabase.from("financial_vouchers").insert({
        organization_id: organizationId,
        voucher_type: "salary",
        amount: Number(amount) || target.total_salary,
        employee_ref_id: target.id,
        employee_name: target.name_ar,
        description: `راتب شهر ${currentMonthLabel()} — ${target.name_ar}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-payroll"] });
      toast({ title: "تم صرف الراتب" });
      setAmount("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر صرف الراتب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>صرف راتب — {target?.name_ar}</DialogTitle>
          <DialogDescription>يمكن تعديل المبلغ عن الإجمالي المحسوب إن وُجدت استقطاعات أو مكافآت</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>المبلغ</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={!amount || paySalary.isPending} onClick={() => paySalary.mutate()}>
            {paySalary.isPending ? "جارٍ الصرف..." : "تأكيد الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
