import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Banknote, Calculator, CheckCircle2, Download, FileText, XCircle,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/error-message";

/**
 * مسيّرات الرواتب — المرحلة 20.
 *
 * الراتب **يُحسب من مكوّناته** لا يُكتب: الأساسي، والبدلات، والإضافيّ
 * المعتمَد، ناقص الغياب والتأخير وأقساط السلف والاستقطاعات المعرَّفة. وكل
 * مبلغ في القسيمة له سطرٌ يشرح مصدره.
 */

const money = (v: any) =>
  Number(v ?? 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RUN_STATUS: Record<string, { label: string; variant: any }> = {
  draft:      { label: "مسوّدة",  variant: "secondary" },
  calculated: { label: "محتسَب",  variant: "default" },
  approved:   { label: "معتمَد",  variant: "success" },
  paid:       { label: "مصروف",  variant: "outline" },
  cancelled:  { label: "ملغى",    variant: "destructive" },
};

export default function PayrollRuns() {
  return (
    <Tabs defaultValue="runs">
      <TabsList>
        <TabsTrigger value="runs">المسيّرات</TabsTrigger>
        <TabsTrigger value="components">مكوّنات الراتب</TabsTrigger>
        <TabsTrigger value="loans">السلف والقروض</TabsTrigger>
        <TabsTrigger value="attendance">الحضور والإضافيّ والمناوبات</TabsTrigger>
        <TabsTrigger value="documents">وثائق الموظفين</TabsTrigger>
      </TabsList>
      <TabsContent value="runs" className="mt-4"><RunsPanel /></TabsContent>
      <TabsContent value="components" className="mt-4"><ComponentsPanel /></TabsContent>
      <TabsContent value="loans" className="mt-4"><LoansPanel /></TabsContent>
      <TabsContent value="attendance" className="mt-4"><AttendancePanel /></TabsContent>
      <TabsContent value="documents" className="mt-4"><DocumentsPanel /></TabsContent>
    </Tabs>
  );
}

function useEmployeeList(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pr-employees", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name_ar, job_number, basic_salary, status, is_disabled")
        .eq("organization_id", orgId)
        // مطابقة شرط `app_calculate_payroll_run` حرفًا بحرف: المسيّر يشترط
        // `status='active'` **و** `is_disabled=false`. بلا شرط `status` تُسجَّل
        // سلفة — أو يُسند بدل/استقطاع — لموظّف انتهت خدمته، فتظهر سلفةً
        // «سارية» لا تُخصم أبدًا لأن المسيّر يستثنيه أصلًا.
        .eq("status", "active")
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * المسيّرات
 * ════════════════════════════════════════════════════════════════════════ */
function RunsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [runNumber, setRunNumber] = useState("");
  const [openRun, setOpenRun] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["payroll-runs", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs").select("*")
        .eq("organization_id", organization!.id)
        .order("period_month", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const items = useQuery({
    queryKey: ["payroll-register", openRun],
    enabled: Boolean(openRun),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_payroll_register").select("*")
        .eq("payroll_run_id", openRun)
        .order("employee_name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const bankFile = useQuery({
    queryKey: ["payroll-bank-file", openRun],
    enabled: Boolean(openRun),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_payroll_bank_file", {
        p_run_id: openRun,
      });
      if (error) {
        // «لا يُخرَج ملف التحويل من مسير حالته...» رفضٌ متوقَّع لمسيّر لم يُعتمد
        // ويُخفى. أمّا انعدام صلاحية `payroll.pay` أو انقطاع الشبكة فليس
        // متوقَّعًا: معاملته كالرفض تُخفي بطاقة «غير جاهزين للتحويل» بلا سبب،
        // فلا يعرف المستخدم أن هناك موظفين بلا آيبان.
        if (!(error.message ?? "").includes("لا يُخرَج ملف التحويل")) {
          toast({
            variant: "destructive",
            title: "تعذر قراءة ملف التحويل البنكيّ",
            description: error.message ?? "خطأ غير متوقع",
          });
        }
        return [] as any[];
      }
      return (data ?? []) as any[];
    },
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll-runs", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["payroll-register", openRun] });
    queryClient.invalidateQueries({ queryKey: ["payroll-bank-file", openRun] });
    queryClient.invalidateQueries({ queryKey: ["employee-loans", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const createRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .insert({
          organization_id: organization!.id,
          period_month: `${month}-01`,
          run_number: runNumber.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      invalidate();
      setOpenRun(id);
      setRunNumber("");
      toast({ title: "أُنشئ المسير كمسوّدة", description: "احتسبه من القائمة" });
    },
    onError: fail("تعذر الإنشاء"),
  });

  const calculate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_calculate_payroll_run", {
        p_run_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      invalidate();
      toast({
        title: "احتُسب المسير",
        description: `${n} موظفًا — الإضافيّ غير المعتمَد لم يُحتسب`,
      });
    },
    onError: fail("تعذر الاحتساب"),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_payroll_run", { p_run_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "اعتُمد المسير", description: "لا تُعدَّل مبالغه بعد الآن" });
    },
    onError: fail("تعذر الاعتماد"),
  });

  const pay = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_pay_payroll_run", { p_run_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "صُرفت الرواتب",
        description: "خُصمت أقساط السلف وأُنشئ القيد المحاسبيّ",
      });
    },
    onError: fail("تعذر الصرف"),
  });

  const cancel = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_cancel_payroll_run", {
        p_run_id: id, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "أُلغي المسير",
        description: "عُكس قيده ورُدّت أقساط السلف",
      });
    },
    onError: fail("تعذر الإلغاء"),
  });

  const exportBankFile = () => {
    const rows = (bankFile.data ?? []).filter((r: any) => r.is_ready);
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "لا صفوف جاهزة للتحويل" });
      return;
    }
    const lines = ["اسم الموظف,الرقم الوظيفي,الآيبان,الصافي"];
    for (const r of rows) {
      lines.push([r.employee_name, r.job_number ?? "", r.bank_iban, r.net_salary]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-transfer-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "صُدّر ملف التحويل", description: `${rows.length} موظفًا` });
  };

  const notReady = (bankFile.data ?? []).filter((r: any) => !r.is_ready);

  return (
    <div className="flex flex-col gap-4">
      {can("payroll.run") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" />
              مسير جديد
            </CardTitle>
            <CardDescription>
              مسير واحد لكل شهر وفرع. الراتب يُحسب من مكوّناته — الأساسي والبدلات
              والإضافيّ **المعتمَد**، ناقص الغياب والتأخير والسلف والاستقطاعات.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>الشهر *</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="flex w-40 flex-col gap-1.5">
              <Label>رقم المسير</Label>
              <Input value={runNumber} onChange={(e) => setRunNumber(e.target.value)} />
            </div>
            <Button disabled={!month || createRun.isPending} onClick={() => createRun.mutate()}>
              إنشاء
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">المسيّرات</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.isLoading && <Skeleton className="h-32 w-full" />}
          {!runs.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الشهر</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الموظفون</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الاستقطاعات</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.run_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {String(r.period_month).slice(0, 7)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RUN_STATUS[r.status]?.variant ?? "secondary"}>
                        {RUN_STATUS[r.status]?.label ?? r.status}
                      </Badge>
                      {r.cancel_reason && (
                        <span className="block text-[10px] text-muted-foreground">
                          {r.cancel_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.employee_count}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.total_gross)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.total_deductions)}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">
                      {money(r.total_net)}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setOpenRun(r.id)}>
                          <FileText className="h-3.5 w-3.5" />
                          القسائم
                        </Button>
                        {["draft", "calculated"].includes(r.status) && can("payroll.run") && (
                          <Button size="sm" variant="outline" disabled={calculate.isPending}
                                  onClick={() => calculate.mutate(r.id)}>
                            احتساب
                          </Button>
                        )}
                        {r.status === "calculated" && can("payroll.approve") && (
                          <Button size="sm" variant="outline" disabled={approve.isPending}
                                  onClick={() => approve.mutate(r.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            اعتماد
                          </Button>
                        )}
                        {r.status === "approved" && can("payroll.pay") && (
                          <Button size="sm" variant="outline" disabled={pay.isPending}
                                  onClick={() => pay.mutate(r.id)}>
                            <Banknote className="h-3.5 w-3.5" />
                            صرف
                          </Button>
                        )}
                        {["approved", "paid"].includes(r.status) && can("payroll.approve") && (
                          <Button size="sm" variant="ghost" disabled={cancel.isPending}
                                  onClick={() => {
                                    const reason = window.prompt("سبب الإلغاء؟") ?? "";
                                    if (!reason.trim()) return;
                                    cancel.mutate({ id: r.id, reason: reason.trim() });
                                  }}>
                            <XCircle className="h-3.5 w-3.5" />
                            إلغاء منظَّم
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(runs.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا مسيّرات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openRun && (
        <>
          {notReady.length > 0 && (
            <Card className="border-destructive">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {notReady.length} موظفًا غير جاهزين للتحويل
                </CardTitle>
                <CardDescription>
                  التحويل سيُرفض عند البنك لهؤلاء. عالِج السبب قبل رفع الملف.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-sm">
                  {notReady.map((r: any, i: number) => (
                    <li key={i}>
                      {r.employee_name} — {r.issue}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">قسائم الرواتب</CardTitle>
                <CardDescription>
                  كل مبلغ يُفصَّل في القسيمة — قسيمةٌ بإجماليٍّ بلا تفصيل لا تُقنع موظّفًا اعترض.
                </CardDescription>
              </div>
              {can("payroll.pay") && (bankFile.data ?? []).length > 0 && (
                <Button variant="outline" onClick={exportBankFile}>
                  <Download className="h-4 w-4" />
                  ملف التحويل البنكيّ
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {items.isLoading && <Skeleton className="h-32 w-full" />}
              {!items.isLoading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>الأساسي</TableHead>
                      <TableHead>البدلات</TableHead>
                      <TableHead>إضافيّ</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>غياب</TableHead>
                      <TableHead>تأخير</TableHead>
                      <TableHead>سلف</TableHead>
                      <TableHead>أخرى</TableHead>
                      <TableHead>الصافي</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(items.data ?? []).map((it) => (
                      <PayslipRow key={it.payroll_item_id} item={it} />
                    ))}
                    {(items.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">
                          لم يُحتسب المسير بعد.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  {(items.data ?? []).length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="text-sm font-semibold">الإجمالي</TableCell>
                        <TableCell colSpan={8} />
                        <TableCell className="font-mono text-xs font-semibold">
                          {money((items.data ?? []).reduce(
                            (s: number, r: any) => s + Number(r.net_salary ?? 0), 0))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function PayslipRow({ item }: { item: any }) {
  const [open, setOpen] = useState(false);

  const details = useQuery({
    queryKey: ["payslip-details", item.payroll_item_id, open],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_item_details")
        .select("*")
        .eq("payroll_run_item_id", item.payroll_item_id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <>
      <TableRow>
        <TableCell className="text-sm">
          {item.employee_name}
          {item.missing_iban && (
            <Badge variant="destructive" className="ms-2">بلا آيبان</Badge>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{money(item.basic_salary)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.allowances_total)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.overtime_amount)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.gross_salary)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.absence_deduction)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.late_deduction)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.loan_deduction)}</TableCell>
        <TableCell className="font-mono text-xs">{money(item.other_deductions)}</TableCell>
        <TableCell className="font-mono text-xs font-semibold">{money(item.net_salary)}</TableCell>
        <TableCell className="text-end">
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "إخفاء" : "تفصيل"}
          </Button>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/40">
            {details.isLoading && <Skeleton className="h-16 w-full" />}
            {!details.isLoading && (
              <div className="flex flex-col gap-1 p-2 text-sm">
                {(details.data ?? []).map((d) => (
                  <div key={d.id} className="flex justify-between">
                    <span>{d.label}</span>
                    <span className={`font-mono text-xs ${
                      Number(d.amount) < 0 ? "text-destructive" : ""}`}>
                      {money(d.amount)}
                    </span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                  <span>الصافي</span>
                  <span className="font-mono text-xs">{money(item.net_salary)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  أيام العمل {item.worked_days ?? "—"} · غياب {item.absent_days ?? 0} ·
                  تأخير {item.late_minutes} دقيقة · إضافيّ {item.overtime_minutes} دقيقة
                </p>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * مكوّنات الراتب
 * ════════════════════════════════════════════════════════════════════════ */
function ComponentsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const employees = useEmployeeList(organization?.id);

  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [componentType, setComponentType] = useState("allowance");
  const [calculation, setCalculation] = useState("fixed");
  const [defaultValue, setDefaultValue] = useState("0");

  const [assignEmp, setAssignEmp] = useState("");
  const [assignComp, setAssignComp] = useState("");
  const [assignValue, setAssignValue] = useState("");

  const components = useQuery({
    queryKey: ["salary-components", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      // النشط فقط: `app_calculate_payroll_run` تتجاهل المكوّن المعطَّل
      // (`where sc.is_active`)، فإسناد مكوّن معطَّل يُنتج بدلًا/استقطاعًا يبدو
      // مُسندًا ولا يصل إلى القسيمة أبدًا.
      const { data, error } = await supabase
        .from("salary_components").select("*")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const assignments = useQuery({
    queryKey: ["employee-components", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_salary_components")
        // `is_active` يُقرأ ليُعرَض: إسنادٌ لمكوّن عُطّل لاحقًا يبقى في الجدول
        // ويجب أن يُرى أنه لا يصل إلى القسيمة.
        .select("*, employee:employees(name_ar), component:salary_components(name_ar, component_type, calculation, is_active)")
        .eq("organization_id", organization!.id)
        .order("effective_from", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const createComponent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("salary_components").insert({
        organization_id: organization!.id,
        code: code.trim(),
        name_ar: nameAr.trim(),
        component_type: componentType,
        calculation,
        default_value: Number(defaultValue) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-components", organization?.id] });
      setCode(""); setNameAr(""); setDefaultValue("0");
      toast({ title: "أُضيف المكوّن" });
    },
    onError: fail("تعذر الحفظ"),
  });

  const assign = useMutation({
    mutationFn: async () => {
      const comp = (components.data ?? []).find((c) => c.id === assignComp);
      const { error } = await supabase.from("employee_salary_components").insert({
        organization_id: organization!.id,
        employee_id: assignEmp,
        component_id: assignComp,
        value: assignValue !== "" ? Number(assignValue) : Number(comp?.default_value ?? 0),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-components", organization?.id] });
      setAssignEmp(""); setAssignComp(""); setAssignValue("");
      toast({ title: "أُسند المكوّن للموظف" });
    },
    onError: fail("تعذر الإسناد"),
  });

  const CALC: Record<string, string> = {
    fixed: "مبلغ ثابت",
    percent_of_basic: "نسبة من الأساسي",
    percent_of_gross: "نسبة من الإجمالي",
  };

  return (
    <div className="flex flex-col gap-4">
      {can("hr.manage") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">مكوّن راتب جديد</CardTitle>
            <CardDescription>
              البدل أو الاستقطاع الجديد **صفٌّ هنا لا عمودٌ في جدول الموظفين** — التوسّع
              بالبيانات لا بالمخطّط.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label>الرمز *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الاسم *</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>النوع</Label>
              <Select value={componentType} onValueChange={setComponentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allowance">بدل</SelectItem>
                  <SelectItem value="deduction">استقطاع</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>طريقة الحساب</Label>
              <Select value={calculation} onValueChange={setCalculation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CALC).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Input type="number" placeholder="القيمة" value={defaultValue}
                     onChange={(e) => setDefaultValue(e.target.value)} />
              <Button disabled={!code.trim() || !nameAr.trim() || createComponent.isPending}
                      onClick={() => createComponent.mutate()}>
                إضافة
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {can("hr.manage") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">إسناد مكوّن لموظف</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-56 flex-col gap-1.5">
              <Label>الموظف</Label>
              <Select value={assignEmp} onValueChange={setAssignEmp}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(employees.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-56 flex-col gap-1.5">
              <Label>المكوّن</Label>
              <Select value={assignComp} onValueChange={setAssignComp}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(components.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name_ar} ({c.component_type === "allowance" ? "بدل" : "استقطاع"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Label>القيمة</Label>
              <Input type="number" value={assignValue}
                     onChange={(e) => setAssignValue(e.target.value)}
                     placeholder="الافتراضية" />
            </div>
            <Button disabled={!assignEmp || !assignComp || assign.isPending}
                    onClick={() => assign.mutate()}>
              إسناد
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">المكوّنات المُسندة</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {assignments.isLoading && <Skeleton className="h-24 w-full" />}
          {!assignments.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>المكوّن</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>من</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(assignments.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.employee?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {a.component?.name_ar ?? "—"}
                      {a.component && a.component.is_active === false && (
                        <Badge variant="destructive" className="ms-1 text-[10px]">
                          مكوّن معطَّل — لا يُحتسب
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={
                        a.component?.component_type === "allowance" ? "success" : "destructive"}>
                        {a.component?.component_type === "allowance" ? "بدل" : "استقطاع"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {CALC[a.component?.calculation] ?? a.component?.calculation}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.value}</TableCell>
                    <TableCell className="font-mono text-xs">{a.effective_from}</TableCell>
                  </TableRow>
                ))}
                {(assignments.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا مكوّنات مُسندة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * السلف والقروض
 * ════════════════════════════════════════════════════════════════════════ */
function LoansPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const employees = useEmployeeList(organization?.id);

  const [empId, setEmpId] = useState("");
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");

  const loans = useQuery({
    queryKey: ["employee-loans", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_employee_loans_status").select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employee_loans").insert({
        organization_id: organization!.id,
        employee_id: empId,
        amount: Number(amount),
        installment_amount: Number(installment),
        installments_count: Number(count),
        start_month: `${new Date().toISOString().slice(0, 7)}-01`,
        reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans", organization?.id] });
      setEmpId(""); setAmount(""); setInstallment(""); setCount(""); setReason("");
      toast({
        title: "سُجّلت السلفة",
        description: "يُخصم قسطها تلقائيًّا في مسير الراتب",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التسجيل",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("payroll.loans") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">سلفة جديدة</CardTitle>
            <CardDescription>
              الخصم يقع في المسير تلقائيًّا — لا سلفةَ تُنسى على الورق.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label>الموظف *</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(employees.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المبلغ *</Label>
              <Input type="number" min={1} value={amount}
                     onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>قيمة القسط *</Label>
              <Input type="number" min={1} value={installment}
                     onChange={(e) => setInstallment(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>عدد الأقساط *</Label>
              <Input type="number" min={1} value={count}
                     onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Input value={reason} onChange={(e) => setReason(e.target.value)}
                     placeholder="السبب" />
              <Button disabled={!empId || !amount || !installment || !count || create.isPending}
                      onClick={() => create.mutate()}>
                حفظ
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">السلف والقروض</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loans.isLoading && <Skeleton className="h-24 w-full" />}
          {!loans.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>المسدَّد</TableHead>
                  <TableHead>المتبقّي</TableHead>
                  <TableHead>القسط</TableHead>
                  <TableHead>أقساط باقية</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(loans.data ?? []).map((l) => (
                  <TableRow key={l.loan_id}>
                    <TableCell className="text-sm">{l.employee_name}</TableCell>
                    <TableCell className="text-sm">
                      {l.loan_type === "advance" ? "سلفة" : "قرض"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{money(l.amount)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(l.paid_amount)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(l.remaining_amount)}</TableCell>
                    <TableCell className="font-mono text-xs">{money(l.installment_amount)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.remaining_installments ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        l.status === "active" ? "default"
                          : l.status === "settled" ? "success" : "secondary"}>
                        {l.status === "active" ? "سارية"
                          : l.status === "settled" ? "مسدَّدة" : "ملغاة"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(loans.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      لا سلف مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * وثائق الموظفين
 * ════════════════════════════════════════════════════════════════════════ */
function DocumentsPanel() {
  const { organization } = useOrganizationAccess();
  const [filter, setFilter] = useState("expiring");

  const docs = useQuery({
    queryKey: ["employee-docs-expiry", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_employee_documents_expiry").select("*")
        .eq("organization_id", organization!.id)
        .order("days_to_expiry", { ascending: true, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = (docs.data ?? []).filter((d) =>
    filter === "all" ? true
      : filter === "expired" ? d.expiry_status === "منتهية"
      : ["منتهية", "تنتهي خلال شهر", "تنتهي خلال ثلاثة أشهر"].includes(d.expiry_status));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">وثائق الموظفين وتواريخ انتهائها</CardTitle>
        <CardDescription>
          الإقامة أو الرخصة المنتهية تُعطّل الموظف عن العمل نظاميًّا قبل أن يلاحظها أحد.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex w-56 flex-col gap-1.5">
          <Label>العرض</Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="expiring">المنتهية والمقاربة</SelectItem>
              <SelectItem value="expired">المنتهية فقط</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {docs.isLoading && <Skeleton className="h-32 w-full" />}
        {!docs.isLoading && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الإصدار</TableHead>
                  <TableHead>الانتهاء</TableHead>
                  <TableHead>المتبقّي</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.document_id}>
                    <TableCell className="text-sm">
                      {d.employee_name}
                      <span className="ms-2 font-mono text-xs text-muted-foreground">
                        {d.job_number ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{d.document_type ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{d.document_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{d.issue_date ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{d.report_date ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.days_to_expiry ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        d.expiry_status === "منتهية" ? "destructive"
                          : d.expiry_status === "تنتهي خلال شهر" ? "destructive"
                          : d.expiry_status === "تنتهي خلال ثلاثة أشهر" ? "default"
                          : "success"}>
                        {d.expiry_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا وثائق في هذا العرض.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
 * الحضور والعمل الإضافي وتبديل المناوبات
 * ════════════════════════════════════════════════════════════════════════ */
/**
 * مدخلات الراتب.
 *
 * الإضافيّ المسجَّل **ليس مستحقًّا حتى يُعتمد**، ولذلك المسير يقرأ المعتمَد
 * وحده. وهذه الشاشة هي المكان الذي يقع فيه الاعتماد، وإلا بقي الإضافيّ
 * رقمًا لا يصل إلى الراتب أبدًا.
 */
function AttendancePanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const employees = useEmployeeList(organization?.id);

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapRequester, setSwapRequester] = useState("");
  const [swapTarget, setSwapTarget] = useState("");
  const [swapDate, setSwapDate] = useState("");
  const [swapReason, setSwapReason] = useState("");

  /** أول يوم في الشهر التالي، حدًّا أعلى مع `.lt`. */
  const nextMonthStart = (m: string) => {
    const [y, mi] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mi, 1)).toISOString().slice(0, 10);
  };

  const summary = useQuery({
    queryKey: ["attendance-summary", organization?.id, month],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_attendance_summary").select("*")
        .eq("organization_id", organization!.id)
        .eq("report_date", `${month}-01`)
        .order("employee_name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const pendingOvertime = useQuery({
    queryKey: ["pending-overtime", organization?.id, month],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      // الحدّ الأعلى بأوّل الشهر التالي و`.lt`: حساب آخر يوم بمنشئ التاريخ
      // المحلّي ثمّ `toISOString` يزيح الحدّ يومًا كاملًا في المناطق الشرقية،
      // فيسقط إضافيّ آخر يوم في الشهر من قائمة الاعتماد.
      const start = `${month}-01`;
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, work_date, overtime_minutes, absence_reason, status, employee:employees(name_ar)")
        .eq("organization_id", organization!.id)
        .gt("overtime_minutes", 0)
        .is("overtime_approved_by", null)
        .gte("work_date", start)
        .lt("work_date", nextMonthStart(month))
        .order("work_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * أيام الغياب في الشهر.
   *
   * الغياب يُخصم من الراتب، فسببه يجب أن يكون موثَّقًا يُراجَع عند اعتراض
   * الموظّف: عمود `absence_reason` كان يُقرأ ولا يُعرض ولا يُكتب من أي مكان،
   * ودالّة `setAbsenceReason` مكتوبة بلا أي حقل يستدعيها. وأيام الغياب مجموعة
   * أخرى غير أيام الإضافيّ، فلها جدولها.
   */
  const absentDays = useQuery({
    queryKey: ["absent-days", organization?.id, month],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, work_date, absence_reason, status, employee:employees(name_ar)")
        .eq("organization_id", organization!.id)
        .eq("status", "absent")
        .gte("work_date", `${month}-01`)
        .lt("work_date", nextMonthStart(month))
        .order("work_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const swaps = useQuery({
    queryKey: ["shift-swaps", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_swap_requests")
        .select("*, requester:employees!shift_swap_requests_requester_id_fkey(name_ar), target:employees!shift_swap_requests_target_employee_id_fkey(name_ar)")
        .eq("organization_id", organization!.id)
        .order("swap_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const approveOvertime = useMutation({
    mutationFn: async (id: string) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("attendance_records")
        .update({ overtime_approved_by: userId, overtime_approved_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفَظ — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-overtime", organization?.id, month] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary", organization?.id, month] });
      toast({
        title: "اعتُمد العمل الإضافي",
        description: "سيُحتسب في مسير الشهر عند إعادة الاحتساب",
      });
    },
    onError: fail("تعذر الاعتماد"),
  });

  const setAbsenceReason = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase
        .from("attendance_records")
        .update({ absence_reason: reason })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفَظ — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["absent-days", organization?.id, month] });
      toast({ title: "سُجّل سبب الغياب" });
    },
    onError: fail("تعذر الحفظ"),
  });

  /**
   * الحلقة الناقصة في تبديل المناوبات.
   *
   * الجدول كان يُقرأ فقط: لا إنشاء لطلب ولا قبول من الزميل، وزرّ الاعتماد
   * مشروط بحالة `accepted` التي لا سبيل للوصول إليها — فبقيت البطاقة تقول «لا
   * طلبات تبديل» إلى الأبد ودالّة `app_approve_shift_swap` بلا مُستدعٍ.
   */
  const createSwap = useMutation({
    mutationFn: async () => {
      if (!swapRequester || !swapTarget || !swapDate) throw new Error("اختر الطالب والزميل والتاريخ");
      if (swapRequester === swapTarget) throw new Error("لا يُبدَّل الموظّف مناوبته مع نفسه");
      const { error } = await supabase.from("shift_swap_requests").insert({
        organization_id: organization!.id,
        requester_id: swapRequester,
        target_employee_id: swapTarget,
        swap_date: swapDate,
        reason: swapReason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-swaps", organization?.id] });
      toast({ title: "سُجّل طلب التبديل", description: "لا يُعتمد قبل قبول الزميل" });
      setSwapOpen(false);
      setSwapRequester(""); setSwapTarget(""); setSwapDate(""); setSwapReason("");
    },
    onError: fail("تعذر تسجيل الطلب"),
  });

  const acceptSwap = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("shift_swap_requests")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", id)
        // القبول يقع على طلب معلَّق وحده: قبولٌ على طلب مرفوض أو معتمَد يعيد
        // فتح ما أُغلق.
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفَظ — الطلب ليس معلَّقًا أو راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-swaps", organization?.id] });
      toast({ title: "قُبل التبديل من الزميل", description: "بانتظار الاعتماد" });
    },
    onError: fail("تعذر تسجيل القبول"),
  });

  const approveSwap = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_shift_swap", { p_swap_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-swaps", organization?.id] });
      toast({ title: "اعتُمد التبديل" });
    },
    onError: fail("تعذر الاعتماد"),
  });

  const SWAP_STATUS: Record<string, { label: string; variant: any }> = {
    pending:   { label: "بانتظار الزميل", variant: "secondary" },
    accepted:  { label: "قبله الزميل",    variant: "default" },
    approved:  { label: "معتمَد",          variant: "success" },
    rejected:  { label: "مرفوض",          variant: "destructive" },
    cancelled: { label: "ملغى",            variant: "destructive" },
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">شهر المتابعة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex w-48 flex-col gap-1.5">
            <Label>الشهر</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">عمل إضافيّ بانتظار الاعتماد</CardTitle>
          <CardDescription>
            **الإضافيّ لا يُحتسب في الراتب قبل اعتماده** — دقائق مسجَّلة بلا اعتماد ليست
            مستحقّة، وما لم يُعتمد هنا لن يصل إلى القسيمة.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pendingOvertime.isLoading && <Skeleton className="h-24 w-full" />}
          {!pendingOvertime.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الدقائق</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pendingOvertime.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.employee?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.work_date}</TableCell>
                    <TableCell className="font-mono text-xs">{a.overtime_minutes}</TableCell>
                    <TableCell className="text-end">
                      {can("hr.overtime_approve") && (
                        <Button size="sm" variant="outline" disabled={approveOvertime.isPending}
                                onClick={() => approveOvertime.mutate(a.id)}>
                          اعتماد
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(pendingOvertime.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      لا عمل إضافيّ معلّق في هذا الشهر.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">أيام الغياب — وسببها</CardTitle>
          <CardDescription>
            **الغياب المخصوم من الراتب يحتاج سببًا موثَّقًا** — بلا سبب مكتوب لا جواب
            لاعتراض الموظّف على خصم يومٍ كامل.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {absentDays.isLoading && <Skeleton className="h-24 w-full" />}
          {!absentDays.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>سبب الغياب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(absentDays.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.employee?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.work_date}</TableCell>
                    <TableCell>
                      {can("hr.attendance") ? (
                        <Input
                          key={`${a.id}-${a.absence_reason ?? ""}`}
                          defaultValue={a.absence_reason ?? ""}
                          placeholder="سبب الغياب..."
                          className="h-8 w-64 text-xs"
                          disabled={setAbsenceReason.isPending}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next !== (a.absence_reason ?? "")) {
                              setAbsenceReason.mutate({ id: a.id, reason: next });
                            }
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{a.absence_reason ?? "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(absentDays.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      لا أيام غياب في هذا الشهر.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ملخّص الحضور الشهريّ</CardTitle>
          <CardDescription>
            الإضافيّ المسجَّل منفصلٌ عن المعتمَد — الفرق بينهما هو ما ينتظر قرارًا.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {summary.isLoading && <Skeleton className="h-32 w-full" />}
          {!summary.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>أيام مسجَّلة</TableHead>
                  <TableHead>حضور</TableHead>
                  <TableHead>غياب</TableHead>
                  <TableHead>أيام تأخير</TableHead>
                  <TableHead>دقائق التأخير</TableHead>
                  <TableHead>إضافيّ مسجَّل</TableHead>
                  <TableHead>إضافيّ معتمَد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summary.data ?? []).map((a) => (
                  <TableRow key={`${a.employee_id}-${a.report_date}`}>
                    <TableCell className="text-sm">{a.employee_name}</TableCell>
                    <TableCell className="font-mono text-xs">{a.recorded_days}</TableCell>
                    <TableCell className="font-mono text-xs">{a.present_days}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(a.absent_days) > 0 ? (
                        <Badge variant="destructive">{a.absent_days}</Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.late_days}</TableCell>
                    <TableCell className="font-mono text-xs">{a.total_late_minutes}</TableCell>
                    <TableCell className="font-mono text-xs">{a.total_overtime_minutes}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.approved_overtime_minutes}
                      {Number(a.total_overtime_minutes) > Number(a.approved_overtime_minutes) && (
                        <Badge variant="secondary" className="ms-1">
                          {Number(a.total_overtime_minutes) - Number(a.approved_overtime_minutes)} معلّقة
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(summary.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      لا سجلّات حضور في هذا الشهر.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-base">تبديل المناوبات</CardTitle>
            <CardDescription>
              **قبول الزميل شرطٌ للاعتماد** — الاعتماد وحده يفرض مناوبةً على من لم يوافق.
            </CardDescription>
          </div>
          <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">طلب تبديل</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>طلب تبديل مناوبة</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>الطالب *</Label>
                  <Select value={swapRequester} onValueChange={setSwapRequester}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {(employees.data ?? []).map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>الزميل *</Label>
                  <Select value={swapTarget} onValueChange={setSwapTarget}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {(employees.data ?? [])
                        .filter((e) => e.id !== swapRequester)
                        .map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name_ar}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>تاريخ التبديل *</Label>
                  <Input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>السبب</Label>
                  <Input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={!swapRequester || !swapTarget || !swapDate || createSwap.isPending}
                  onClick={() => createSwap.mutate()}
                >
                  حفظ الطلب
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {swaps.isLoading && <Skeleton className="h-24 w-full" />}
          {!swaps.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطالب</TableHead>
                  <TableHead>الزميل</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(swaps.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{s.requester?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm">{s.target?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{s.swap_date}</TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      {s.reason ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SWAP_STATUS[s.status]?.variant ?? "secondary"}>
                        {SWAP_STATUS[s.status]?.label ?? s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {s.status === "pending" && (
                        <Button size="sm" variant="outline" disabled={acceptSwap.isPending}
                                onClick={() => {
                                  const who = s.target?.name_ar ?? "الزميل";
                                  if (!window.confirm(`تأكيد قبول ${who} للتبديل بتاريخ ${s.swap_date}؟`)) return;
                                  acceptSwap.mutate(s.id);
                                }}>
                          قبول الزميل
                        </Button>
                      )}
                      {s.status === "accepted" && can("hr.attendance") && (
                        <Button size="sm" variant="outline" disabled={approveSwap.isPending}
                                onClick={() => approveSwap.mutate(s.id)}>
                          اعتماد
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(swaps.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا طلبات تبديل.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
