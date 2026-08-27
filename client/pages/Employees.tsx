import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, UserCog } from "lucide-react";
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
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

function useEmployees(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["employees-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, file_number, name_ar, mobile_1, status, basic_salary, housing_allowance, transportation_allowance, other_allowances, total_salary, hire_date")
        .order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Employees() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [documentsFor, setDocumentsFor] = useState<{ id: string; name_ar: string } | null>(null);
  const employees = useEmployees(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الموظفون</h1>
          <p className="text-sm text-muted-foreground">ملفات الموظفين، الرواتب، والوثائق</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          موظف جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قائمة الموظفين</CardTitle>
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
                  <TableHead>الاسم</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>تاريخ التعيين</TableHead>
                  <TableHead>إجمالي الراتب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(employees.data ?? []).map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-mono text-xs">#{employee.file_number}</TableCell>
                    <TableCell className="flex items-center gap-2 font-medium">
                      <UserCog className="h-4 w-4 text-muted-foreground" />
                      {employee.name_ar}
                    </TableCell>
                    <TableCell>{employee.mobile_1 ?? "—"}</TableCell>
                    <TableCell>{employee.hire_date ? new Date(employee.hire_date).toLocaleDateString("ar-SA") : "—"}</TableCell>
                    <TableCell className="font-semibold">{Number(employee.total_salary).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>
                      <Badge variant={employee.status === "active" ? "success" : "secondary"}>
                        {employee.status === "active" ? "نشط" : "منتهي"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDocumentsFor({ id: employee.id, name_ar: employee.name_ar })}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        الوثائق
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(employees.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد موظفون مسجّلون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewEmployeeDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
      <EmployeeDocumentsDialog employee={documentsFor} onOpenChange={() => setDocumentsFor(null)} organizationId={organization?.id} />
    </div>
  );
}

function NewEmployeeDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState("");
  const [mobile, setMobile] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [basicSalary, setBasicSalary] = useState("0");
  const [housing, setHousing] = useState("0");
  const [transport, setTransport] = useState("0");

  const createEmployee = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("employees").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        mobile_1: mobile.trim() || null,
        profession_value_id: professionId || null,
        hire_date: hireDate || null,
        basic_salary: Number(basicSalary) || 0,
        housing_allowance: Number(housing) || 0,
        transportation_allowance: Number(transport) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list"] });
      toast({ title: "تم حفظ ملف الموظف" });
      setNameAr("");
      setMobile("");
      setProfessionId("");
      setHireDate("");
      setBasicSalary("0");
      setHousing("0");
      setTransport("0");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الموظف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>موظف جديد</DialogTitle>
          <DialogDescription>إجمالي الراتب يُحسب تلقائيًا من مكوّنات الراتب أدناه</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المهنة</Label>
            <LookupSelect categoryKey="professions" value={professionId} onChange={setProfessionId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ التعيين</Label>
            <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الراتب الأساسي</Label>
            <Input type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بدل السكن</Label>
            <Input type="number" value={housing} onChange={(e) => setHousing(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بدل النقل</Label>
            <Input type="number" value={transport} onChange={(e) => setTransport(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!nameAr.trim() || createEmployee.isPending} onClick={() => createEmployee.mutate()}>
            {createEmployee.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDocumentsDialog({
  employee,
  onOpenChange,
  organizationId,
}: {
  employee: { id: string; name_ar: string } | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [docTypeId, setDocTypeId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const documents = useQuery({
    queryKey: ["employee-documents", employee?.id],
    enabled: Boolean(employee?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("id, document_number, expiry_date, document_type_value_id")
        .eq("employee_id", employee?.id)
        .order("expiry_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addDocument = useMutation({
    mutationFn: async () => {
      if (!organizationId || !employee) throw new Error("بيانات غير مكتملة");
      const { error } = await supabase.from("employee_documents").insert({
        organization_id: organizationId,
        employee_id: employee.id,
        document_type_value_id: docTypeId || null,
        document_number: documentNumber.trim() || null,
        expiry_date: expiryDate || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", employee?.id] });
      toast({ title: "تم حفظ الوثيقة" });
      setDocTypeId("");
      setDocumentNumber("");
      setExpiryDate("");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>وثائق {employee?.name_ar}</DialogTitle>
          <DialogDescription>تغذّي هذه الوثائق شاشة التنبيهات الموحّدة عند اقتراب الانتهاء</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {(documents.data ?? []).map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span>{doc.document_number ?? "بلا رقم"}</span>
              <span className="text-xs text-muted-foreground">
                {doc.expiry_date ? `ينتهي: ${new Date(doc.expiry_date).toLocaleDateString("ar-SA")}` : "بلا تاريخ انتهاء"}
              </span>
            </div>
          ))}
          {(documents.data ?? []).length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">لا توجد وثائق مسجّلة بعد.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">نوع الوثيقة</Label>
            <LookupSelect categoryKey="employee_document_types" value={docTypeId} onChange={setDocTypeId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">رقم الوثيقة</Label>
            <Input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">تاريخ الانتهاء</Label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={addDocument.isPending} onClick={() => addDocument.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة وثيقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
