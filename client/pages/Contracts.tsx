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
  const [terminating, setTerminating] = useState<EmployeeContractStatusView | null>(null);
  const [terminationReason, setTerminationReason] = useState("");

  /**
   * إنهاء العقد بسبب مكتوب وتأكيد صريح.
   *
   * كان الإنهاء يقع بضغطة واحدة على أيقونة صغيرة بجانب أيقونة التجديد: بلا
   * تأكيد ولا سبب ولا تراجع (الأزرار تظهر لعقد `active` وحده)، والعقد بيانات
   * تعاقديّة لا تُغيَّر حالتها بلا سبب موثَّق.
   *
   * السبب يُحفظ في عموده `termination_reason` (أُضيف في 0144)، ويُلحَق كذلك
   * بملاحظة العقد مؤرَّخًا حتى يبقى ظاهرًا لمن يقرأ الملاحظة وحدها.
   */
  const terminate = useMutation({
    mutationFn: async ({ contract, reason }: { contract: EmployeeContractStatusView; reason: string }) => {
      const trimmed = reason.trim();
      if (!trimmed) throw new Error("سبب إنهاء العقد مطلوب");
      // التاريخ محليّ لا عالميّ: `toISOString` يُخرج يوم أمس بعد التاسعة مساءً.
      const today = new Date();
      const stampDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const stamp = `إنهاء العقد بتاريخ ${stampDate}: ${trimmed}`;
      const nextNote = [contract.note?.trim() || null, stamp].filter(Boolean).join(" | ");
      const { data: affectedRows, error } = await supabase
        .from("employee_contracts")
        .update({ status: "terminated", note: nextNote, termination_reason: trimmed })
        .eq("id", contract.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-contracts", organization?.id] });
      toast({ title: "تم إنهاء العقد", description: "سُجّل السبب في سجلّ العقد" });
      setTerminating(null);
      setTerminationReason("");
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
                        <Button
                          size="sm"
                          variant="outline"
                          title="إنهاء العقد"
                          onClick={() => {
                            setTerminating(c);
                            setTerminationReason("");
                          }}
                        >
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

      <Dialog
        open={Boolean(terminating)}
        onOpenChange={(next) => {
          if (!next) setTerminating(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنهاء عقد — {terminating?.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="text-xs text-muted-foreground">
              حالة العقد ستصير «منتهٍ» ولا يظهر له زرّ تجديد بعدها. السبب يُسجَّل في ملاحظة العقد ولا يُحذف.
            </p>
            <div>
              <Label>سبب الإنهاء *</Label>
              <Input
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                placeholder="استقالة، فسخ بالتراضي، انتهاء مشروع..."
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminating(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              disabled={!terminationReason.trim() || terminate.isPending}
              onClick={() => terminate.mutate({ contract: terminating!, reason: terminationReason })}
            >
              تأكيد الإنهاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
