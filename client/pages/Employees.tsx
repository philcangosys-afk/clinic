import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, UserCog } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        .select("id, file_number, name_ar, mobile_1, phone_1, source_country_phone_code, job_number, profession_value_id, national_id, birth_date, nationality_value_id, termination_date, status, basic_salary, housing_allowance, transportation_allowance, other_allowances, total_salary, hire_date")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId)
        .order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Employees() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeEditRow | null>(null);
  const [documentsFor, setDocumentsFor] = useState<{ id: string; name_ar: string } | null>(null);
  const employees = useEmployees(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الموظفون</h1>
          <p className="text-sm text-muted-foreground">ملفات الموظفين، الرواتب، والوثائق</p>
        </div>
        <Button onClick={() => {
            setEditing(null);
            setCreateOpen(true);
          }}>
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
                  <TableHead>الرقم الوظيفي</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>تاريخ التعيين</TableHead>
                  <TableHead>تاريخ الخروج</TableHead>
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
                    <TableCell className="font-mono text-xs">{employee.job_number ?? "—"}</TableCell>
                    <TableCell>{employee.mobile_1 ?? "—"}</TableCell>
                    <TableCell>{employee.hire_date ? new Date(employee.hire_date).toLocaleDateString("ar-SA") : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {employee.termination_date
                        ? new Date(employee.termination_date).toLocaleDateString("ar-SA")
                        : "—"}
                    </TableCell>
                    <TableCell className="font-semibold">{Number(employee.total_salary).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>
                      <Badge variant={employee.status === "active" ? "success" : "secondary"}>
                        {employee.status === "active" ? "نشط" : "منتهي"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="تعديل"
                          onClick={() => {
                            setEditing(employee as unknown as EmployeeEditRow);
                            setCreateOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDocumentsFor({ id: employee.id, name_ar: employee.name_ar })}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          الوثائق
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(employees.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد موظفون مسجّلون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <NewEmployeeDialog
          key={editing?.id ?? "new"}
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) setEditing(null);
          }}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
      <EmployeeDocumentsDialog employee={documentsFor} onOpenChange={() => setDocumentsFor(null)} organizationId={organization?.id} />
    </div>
  );
}

/** حقول الموظف التي يقرأها/يكتبها النموذج (إنشاء وتعديل). */
export type EmployeeEditRow = {
  id: string;
  name_ar: string;
  mobile_1: string | null;
  phone_1: string | null;
  source_country_phone_code: string | null;
  job_number: string | null;
  profession_value_id: string | null;
  hire_date: string | null;
  termination_date: string | null;
  basic_salary: number | null;
  housing_allowance: number | null;
  transportation_allowance: number | null;
  other_allowances: number | null;
  national_id: string | null;
  birth_date: string | null;
  nationality_value_id: string | null;
  status: string;
};

function NewEmployeeDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** عند تمريره تتحول النافذة لوضع التعديل. */
  initial?: EmployeeEditRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [mobile, setMobile] = useState(initial?.mobile_1 ?? "");
  const [professionId, setProfessionId] = useState(initial?.profession_value_id ?? "");
  const [hireDate, setHireDate] = useState(initial?.hire_date ?? "");
  const [basicSalary, setBasicSalary] = useState(String(initial?.basic_salary ?? 0));
  const [housing, setHousing] = useState(String(initial?.housing_allowance ?? 0));
  const [transport, setTransport] = useState(String(initial?.transportation_allowance ?? 0));
  const [otherAllowances, setOtherAllowances] = useState(String(initial?.other_allowances ?? 0));
  const [nationalId, setNationalId] = useState(initial?.national_id ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birth_date ?? "");
  const [nationalityId, setNationalityId] = useState(initial?.nationality_value_id ?? "");
  // حقول في جدول employees منذ 0008 بلا إدخال في الواجهة (لقطة 78)
  const [phone1, setPhone1] = useState(initial?.phone_1 ?? "");
  const [sourceCountryPhone, setSourceCountryPhone] = useState(initial?.source_country_phone_code ?? "");
  const [jobNumber, setJobNumber] = useState(initial?.job_number ?? "");
  const [terminationDate, setTerminationDate] = useState(initial?.termination_date ?? "");

  const createEmployee = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const payload = {
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        mobile_1: mobile.trim() || null,
        profession_value_id: professionId || null,
        hire_date: hireDate || null,
        basic_salary: Number(basicSalary) || 0,
        housing_allowance: Number(housing) || 0,
        transportation_allowance: Number(transport) || 0,
        other_allowances: Number(otherAllowances) || 0,
        national_id: nationalId.trim() || null,
        birth_date: birthDate || null,
        nationality_value_id: nationalityId || null,
        phone_1: phone1.trim() || null,
        source_country_phone_code: sourceCountryPhone.trim() || null,
        job_number: jobNumber.trim() || null,
        // تسجيل تاريخ خروج ينهي خدمة الموظف — نُحدِّث الحالة معه حتى لا يبقى
        // "نشطًا" وله تاريخ خروج، وهو تناقض يُفسد تقارير الموارد البشرية.
        termination_date: terminationDate || null,
        status: terminationDate ? ("terminated" as const) : ("active" as const),
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("employees").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list"] });
      toast({ title: initial ? "تم تحديث ملف الموظف" : "تم حفظ ملف الموظف" });
      setNameAr("");
      setMobile("");
      setProfessionId("");
      setHireDate("");
      setBasicSalary("0");
      setHousing("0");
      setTransport("0");
      setOtherAllowances("0");
      setNationalId("");
      setBirthDate("");
      setNationalityId("");
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
          {/*
            العنوان يتبع الوضع لا يُكتب ثابتًا: نافذة التعديل كانت تقول «موظف
            جديد» وهي معبّأة ببيانات موظّف قائم، فيخشى المستخدم أنه يُنشئ سجلًّا
            مكرَّرًا فيتردّد في الحفظ — وكل بقيّة النافذة (الحمولة، رسالة النجاح)
            تعرف الوضع من `initial` أصلًا.
          */}
          <DialogTitle>{initial ? `تعديل ملف — ${initial.name_ar}` : "موظف جديد"}</DialogTitle>
          <DialogDescription>
            {initial
              ? "تعديل بيانات موظّف قائم — إجمالي الراتب يُحسب تلقائيًا من مكوّناته أدناه"
              : "إجمالي الراتب يُحسب تلقائيًا من مكوّنات الراتب أدناه"}
          </DialogDescription>
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
            <Label>الرقم الوظيفي</Label>
            <Input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>هاتف إضافي</Label>
            <Input value={phone1} onChange={(e) => setPhone1(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>هاتف بلد المصدر</Label>
            <Input
              value={sourceCountryPhone}
              onChange={(e) => setSourceCountryPhone(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الخروج</Label>
            <Input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">تعبئته تُنهي خدمة الموظف وتحوّل حالته إلى "منتهي"</p>
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
          <div className="flex flex-col gap-1.5">
            <Label>بدلات أخرى</Label>
            <Input type="number" value={otherAllowances} onChange={(e) => setOtherAllowances(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهوية الوطنية</Label>
            <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الميلاد</Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنسية</Label>
            <LookupSelect categoryKey="nationalities" value={nationalityId} onChange={setNationalityId} />
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
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");

  const documents = useQuery({
    queryKey: ["employee-documents", employee?.id],
    enabled: Boolean(employee?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("id, document_number, issue_date, expiry_date, document_type_value_id, note")
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
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", employee?.id] });
      toast({ title: "تم حفظ الوثيقة" });
      setDocTypeId("");
      setDocumentNumber("");
      setIssueDate("");
      setExpiryDate("");
      setNote("");
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
              <div className="flex flex-col">
                <span>{doc.document_number ?? "بلا رقم"}</span>
                {doc.note && <span className="text-xs text-muted-foreground">{doc.note}</span>}
              </div>
              <span className="text-xs text-muted-foreground">
                {doc.issue_date ? `إصدار: ${new Date(doc.issue_date).toLocaleDateString("ar-SA")} — ` : ""}
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
            <Label className="text-xs">تاريخ الإصدار</Label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">تاريخ الانتهاء</Label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <Label className="text-xs">ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
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
