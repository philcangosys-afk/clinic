import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Plus, RefreshCcw, Ban } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { ContractType, EmployeeContractStatusView } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

const TYPE_LABELS: Record<ContractType, string> = {
  permanent: "غير محدد المدة",
  fixed_term: "محدد المدة",
  probation: "تحت التجربة",
};

function useContracts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["employee-contracts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_employee_contracts_status")
        .select("*")
        .eq("organization_id", organizationId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data as EmployeeContractStatusView[]) ?? [];
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

function NewContractDialog({
  organizationId,
  renewFrom,
  trigger,
}: {
  organizationId: string | undefined;
  renewFrom?: EmployeeContractStatusView | null;
  trigger: ReactNode;
}) {
  const employees = useEmployeesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(renewFrom?.employee_id ?? "");
  const [contractType, setContractType] = useState<ContractType>(renewFrom?.contract_type ?? "permanent");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [salary, setSalary] = useState(String(renewFrom?.basic_salary ?? 0));
  const [contractNumber, setContractNumber] = useState("");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !employeeId || !startDate) throw new Error("كل الحقول مطلوبة");
      const { error } = await supabase.from("employee_contracts").insert({
        organization_id: organizationId,
        employee_id: employeeId,
        previous_contract_id: renewFrom?.id ?? null,
        contract_number: contractNumber.trim() || null,
        contract_type: contractType,
        start_date: startDate,
        end_date: contractType === "permanent" ? null : endDate || null,
        basic_salary: Number(salary) || 0,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-contracts", organizationId] });
      toast({ title: renewFrom ? "تم تجديد العقد" : "تم إنشاء العقد" });
      setOpen(false);
      setNote("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{renewFrom ? `تجديد عقد — ${renewFrom.employee_name}` : "عقد جديد"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {!renewFrom && (
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
          )}
          <div>
            <Label>نوع العقد</Label>
            <Select value={contractType} onValueChange={(v) => setContractType(v as ContractType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>تاريخ البدء</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {contractType !== "permanent" && (
              <div>
                <Label>تاريخ الانتهاء</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>الراتب الأساسي</Label>
              <Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} />
            </div>
            <div>
              <Label>رقم العقد (اختياري)</Label>
              <Input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>ملاحظة (اختياري)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Contracts() {
  const { organization } = useOrganizationAccess();
  const contracts = useContracts(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const terminate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_contracts").update({ status: "terminated" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-contracts", organization?.id] });
      toast({ title: "تم إنهاء العقد" });
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileCheck2 className="h-6 w-6" /> العقود والملفات
          </h1>
          <p className="text-sm text-muted-foreground">كل تجديد عقد يُؤرشف العقد السابق تلقائيًا — لا يمكن أبدًا وجود عقدين نشطين لنفس الموظف</p>
        </div>
        <NewContractDialog
          organizationId={organization?.id}
          trigger={
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> عقد جديد
            </Button>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">كل العقود</CardTitle>
          <CardDescription>العقود التي تنتهي خلال 30 يومًا تظهر أيضًا في شاشة التنبيهات الموحَّدة تلقائيًا</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>البدء</TableHead>
                <TableHead>الانتهاء</TableHead>
                <TableHead>الراتب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contracts.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.employee_name}</TableCell>
                  <TableCell>{TYPE_LABELS[c.contract_type]}</TableCell>
                  <TableCell className="text-xs">{c.start_date}</TableCell>
                  <TableCell className="text-xs">
                    {c.end_date ?? "—"}
                    {c.expiring_within_30_days && (
                      <Badge variant="destructive" className="ms-1 text-[10px]">
                        ينتهي قريبًا
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{c.basic_salary.toLocaleString("ar-SA")}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        c.status === "active" ? "success" : c.status === "terminated" ? "destructive" : "secondary"
                      }
                    >
                      {c.status === "active" ? "نشط" : c.status === "renewed" ? "مُجدَّد" : c.status === "terminated" ? "منتهٍ" : "انتهى"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.status === "active" && (
                      <div className="flex gap-1.5">
                        <NewContractDialog
                          organizationId={organization?.id}
                          renewFrom={c}
                          trigger={
                            <Button size="sm" variant="outline">
                              <RefreshCcw className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <Button size="sm" variant="outline" onClick={() => terminate.mutate(c.id)}>
                          <Ban className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(contracts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد عقود بعد.
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
