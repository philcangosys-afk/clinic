import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  FileText,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserCog,
} from "lucide-react";
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
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, useLocaleSettings } from "@/lib/locale";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmployeeAccountDialog } from "@/components/security/MemberAccountDialogs";

function useEmployees(organizationId: string | undefined, includeArchived: boolean) {
  return useQuery({
    queryKey: ["employees-list", organizationId, includeArchived],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("employees")
        .select("id, file_number, name_ar, mobile_1, phone_1, source_country_phone_code, job_number, profession_value_id, national_id, birth_date, nationality_value_id, termination_date, status, basic_salary, housing_allowance, transportation_allowance, other_allowances, total_salary, hire_date, user_id, email, is_archived, archived_at, archive_reason")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId);
      // المؤرشف لا يظهر إلّا بطلب: هذا موضع القاعدة العامة في النظام
      // «كل قائمة تعرض النشط غير المؤرشف» — والمفتاح أعلى الشاشة يكشفه.
      if (!includeArchived) query = query.eq("is_archived", false);
      const { data, error } = await query.order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

type EmployeeRowLite = {
  id: string;
  name_ar: string;
  is_archived?: boolean | null;
};

export default function Employees() {
  const { calendarDisplay } = useLocaleSettings();
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeEditRow | null>(null);
  const [documentsFor, setDocumentsFor] = useState<{ id: string; name_ar: string } | null>(null);
  const [accountFor, setAccountFor] = useState<{
    id: string;
    name_ar: string;
    user_id: string | null;
    email: string | null;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveFor, setArchiveFor] = useState<EmployeeRowLite | null>(null);
  const [deleteFor, setDeleteFor] = useState<EmployeeRowLite | null>(null);
  const employees = useEmployees(organization?.id, showArchived);
  const restoreEmployee = useRestoreEmployee(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الموظفون</h1>
          <p className="text-sm text-muted-foreground">ملفات الموظفين، الرواتب، والوثائق</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="show-archived" className="cursor-pointer text-sm text-muted-foreground">
              إظهار المؤرشفين
            </Label>
          </div>
          <Button onClick={() => {
              setEditing(null);
              setCreateOpen(true);
            }}>
            <Plus className="h-4 w-4" />
            موظف جديد
          </Button>
        </div>
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
                  <TableHead>حساب الدخول</TableHead>
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
                    <TableCell className="font-mono text-[11px]" dir="ltr">
                      {(employee as { email?: string | null }).email ??
                        ((employee as { user_id?: string | null }).user_id ? "—" : "")}
                      {!(employee as { user_id?: string | null }).user_id && (
                        <span className="font-sans text-xs text-muted-foreground">بلا حساب</span>
                      )}
                    </TableCell>
                    <TableCell>{employee.mobile_1 ?? "—"}</TableCell>
                    <TableCell>{formatDate(employee.hire_date, calendarDisplay)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(employee.termination_date, calendarDisplay)}
                    </TableCell>
                    <TableCell className="font-semibold">{formatAmount(employee.total_salary)} ر.س</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(employee as { is_archived?: boolean | null }).is_archived ? (
                        <Badge variant="outline" className="border-amber-400 text-amber-700">
                          مؤرشف
                        </Badge>
                      ) : (
                        <Badge variant={employee.status === "active" ? "success" : "secondary"}>
                          {employee.status === "active" ? "نشط" : "منتهي"}
                        </Badge>
                      )}
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
                          variant="ghost"
                          title="حساب الدخول وكلمة المرور"
                          onClick={() =>
                            setAccountFor({
                              id: employee.id,
                              name_ar: employee.name_ar,
                              user_id: (employee as { user_id?: string | null }).user_id ?? null,
                              email: (employee as { email?: string | null }).email ?? null,
                            })
                          }
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDocumentsFor({ id: employee.id, name_ar: employee.name_ar })}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          الوثائق
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" title="خيارات أخرى">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {(employee as { is_archived?: boolean | null }).is_archived ? (
                              <DropdownMenuItem
                                onSelect={() => restoreEmployee.mutate(employee.id)}
                                disabled={restoreEmployee.isPending}
                              >
                                <ArchiveRestore className="h-4 w-4" />
                                استعادة من الأرشيف
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() =>
                                  setArchiveFor({ id: employee.id, name_ar: employee.name_ar })
                                }
                              >
                                <Archive className="h-4 w-4" />
                                أرشفة الملفّ
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() =>
                                setDeleteFor({ id: employee.id, name_ar: employee.name_ar })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                              حذف نهائيّ
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(employees.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
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
      {archiveFor && (
        <ArchiveEmployeeDialog
          organizationId={organization?.id}
          employee={archiveFor}
          onOpenChange={() => setArchiveFor(null)}
        />
      )}
      {deleteFor && (
        <DeleteEmployeeDialog
          organizationId={organization?.id}
          employee={deleteFor}
          onOpenChange={() => setDeleteFor(null)}
        />
      )}
      {accountFor && (
        <EmployeeAccountDialog
          organizationId={organization?.id}
          employee={accountFor}
          onOpenChange={() => setAccountFor(null)}
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
  email: string | null;
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
  const [email, setEmail] = useState(initial?.email ?? "");

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
        // فارغًا في الإنشاء يتولّد في القاعدة (0184)؛ وفي التعديل يبقى ما
        // كان — تفريغه كان يمحو رقمًا مولَّدًا لمجرّد أن الحقل لم يُملأ.
        job_number: jobNumber.trim() || (initial ? initial.job_number : null),
        email: email.trim() || null,
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
        description: errorMessage(error),
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
            <Input
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="يتولّد تلقائيًا"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              اتركه فارغًا ليتولّد من رمز المنشأة ورقمٍ متسلسل (مثل ASN-1001)
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" inputMode="email" />
            <p className="text-xs text-muted-foreground">
              حساب الدخول يُنشأ بزرّ المفتاح في قائمة الموظفين
            </p>
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
            <LookupSelect categoryKey="nationalities" centered title="الجنسية" allowClear value={nationalityId} onChange={setNationalityId} />
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
  const { calendarDisplay } = useLocaleSettings();
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
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errorMessage(error, "خطأ غير متوقع") }),
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
                {doc.issue_date ? `إصدار: ${formatDate(doc.issue_date, calendarDisplay)} — ` : ""}
                {doc.expiry_date ? `ينتهي: ${formatDate(doc.expiry_date, calendarDisplay)}` : "بلا تاريخ انتهاء"}
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


/**
 * ═══ الأرشفة والحذف النهائيّ ═══════════════════════════════════════════════
 *
 * بابان لا باب واحد، ولكلٍّ حالته:
 *
 * **الأرشفة** لمن عمل فعلًا. راتبه مصروف وحضوره مسجَّل وتوقيعه على تقارير،
 * فحذفه يكسر قيودًا محاسبيّة ويُفقد أثرًا لا يجوز فقده. فيُرفع من القوائم،
 * ويُقطع دخوله في نفس المعاملة، ويبقى سجلّه.
 *
 * **الحذف النهائيّ** لحالةٍ واحدة: ملفٌّ أُدخل بالخطأ ولم يتعلّق به شيء.
 * والقاعدة هي من تحكم لا الشاشة: `app_delete_employee` تسأل `pg_constraint`
 * عن كلّ جدولٍ يشير إلى الموظّف، فإن وجدت صفًّا واحدًا رفضت **وسمَّت الجدول**.
 * فرسالة الرفض هنا ليست «تعذّر الحذف» بل «يتعلّق به سجلّاتٌ في …».
 */

function useRestoreEmployee(organizationId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await supabase.rpc("app_restore_employee", { p_employee_id: employeeId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list", organizationId] });
      toast({
        title: "أُعيد الملفّ",
        description: "الدخول لم يُفتح تلقائيًّا — فعّله من «المستخدمون والصلاحيات» إن أردت",
      });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّرت الاستعادة", description: errorMessage(error) }),
  });
}

function ArchiveEmployeeDialog({
  organizationId,
  employee,
  onOpenChange,
}: {
  organizationId: string | undefined;
  employee: { id: string; name_ar: string };
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_archive_employee", {
        p_employee_id: employee.id,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast({ title: "أُرشف الملفّ", description: "رُفع من القوائم وقُطع دخوله، وسجلّه محفوظ" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّرت الأرشفة", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>أرشفة ملفّ: {employee.name_ar}</DialogTitle>
          <DialogDescription>
            يُرفع الملفّ من القوائم وقوائم الاختيار، ويُقطع دخوله للنظام، ويبقى كلّ سجلّه كما هو —
            الرواتب والحضور والوثائق والتقارير. ويمكن استعادته لاحقًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="archive-reason">سبب الأرشفة (اختياري)</Label>
          <Textarea
            id="archive-reason"
            rows={3}
            placeholder="تركَ العمل، نهاية العقد، نُقل إلى فرعٍ آخر..."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={archive.isPending} onClick={() => archive.mutate()}>
            {archive.isPending ? "جارٍ الأرشفة..." : "أرشفة الملفّ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEmployeeDialog({
  organizationId,
  employee,
  onOpenChange,
}: {
  organizationId: string | undefined;
  employee: { id: string; name_ar: string };
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmation, setConfirmation] = useState("");

  // ما يتعلّق بالملفّ يُقرأ قبل الضغط لا بعده: من يرى «يتعلّق به 3 صفوف في
  // payroll_run_items» يعرف أنّ أمامه أرشفةً، فلا يضغط زرًّا ليُرَدّ.
  const dependencies = useQuery({
    queryKey: ["employee-dependencies", employee.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_employee_dependencies", {
        p_employee_id: employee.id,
      });
      if (error) throw error;
      return (data ?? []) as { table_name: string; row_count: number; blocking: boolean }[];
    },
  });

  const blocking = (dependencies.data ?? []).filter((row) => row.blocking);
  const canDelete = dependencies.isSuccess && blocking.length === 0;

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_delete_employee", { p_employee_id: employee.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list", organizationId] });
      toast({ title: "حُذف الملفّ نهائيًّا" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحذف", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">حذف نهائيّ: {employee.name_ar}</DialogTitle>
          <DialogDescription>
            الحذف النهائيّ لا رجعة فيه. وهو متاح فقط لملفٍّ لم يتعلّق به أيّ سجلّ مالي أو تشغيليّ —
            ملفٍّ أُدخل بالخطأ. أمّا من عمل فعلًا فبابه الأرشفة.
          </DialogDescription>
        </DialogHeader>

        {dependencies.isLoading && <Skeleton className="h-16 w-full" />}

        {dependencies.isError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            تعذّر فحص ما يتعلّق بالملفّ: {errorMessage(dependencies.error)}
          </p>
        )}

        {dependencies.isSuccess && blocking.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-semibold">لا يُحذف هذا الملفّ — يتعلّق به سجلّات:</p>
            <ul className="flex flex-col gap-0.5 ps-4">
              {blocking.map((row) => (
                <li key={row.table_name} className="list-disc font-mono text-[11px]" dir="ltr">
                  {row.table_name} ({row.row_count})
                </li>
              ))}
            </ul>
            <p>استخدم الأرشفة: تُخفيه من القوائم وتقطع دخوله وتُبقي سجلّه.</p>
          </div>
        )}

        {canDelete && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-confirm">
              للتأكيد اكتب اسم الموظّف: <span className="font-bold">{employee.name_ar}</span>
            </Label>
            <Input
              id="delete-confirm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={employee.name_ar}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete || confirmation.trim() !== employee.name_ar.trim() || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "جارٍ الحذف..." : "حذف نهائيّ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
