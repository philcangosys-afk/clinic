import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, CheckCircle2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import PayrollRuns from "@/components/hr/PayrollRuns";
import { errorMessage } from "@/lib/error-message";

function currentMonthLabel() {
  return new Date().toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long" });
}
/**
 * أول يوم في الشهر التالي، لاستعماله مع `.lt` بدل `.lte` على آخر يوم.
 *
 * الحساب بـ `Date.UTC` لا بمُنشئ التاريخ المحلي: `new Date("2026-08-01")`
 * يُفسَّر UTC بينما `new Date(2026, 7, 1)` محلي، والخلط بينهما يزيح الحدّ يومًا
 * كاملًا في المناطق الشرقية — وهو ما يُسقِط رواتب آخر يوم في الشهر من الكشف.
 */
function nextMonthStart(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** بند مسيّر معتمَد قابل للصرف — كما يعرضه منظور `v_payroll_items_payable`. */
type PayableItem = {
  item_id: string;
  payroll_run_id: string;
  period_month: string;
  run_status: string;
  employee_id: string;
  employee_name: string | null;
  job_number: string | null;
  gross_salary: number | null;
  deductions_total: number | null;
  net_salary: number | null;
  is_paid: boolean;
  paid_at: string | null;
};

/**
 * بنود الصرف الفرديّ تُقرأ من **المسيّرات المعتمدة** لا من جدول الموظفين.
 *
 * الخطأ الذي كان: الشاشة كانت تقرأ `employees.total_salary` (الإجمالي قبل أي
 * استقطاع) وتعرض زرّ صرف لكل موظّف نشط، وتحكم على «صُرف هذا الشهر» بوجود سند
 * صرف من نوع `salary` في الشهر. فكان الصرف الفرديّ:
 *   1) يدفع الإجمالي بلا استقطاعات (غياب، تأخير، أقساط سلف، جزاءات)،
 *   2) لا يشترط اعتماد مسيّر أصلًا — يُصرف راتبٌ لم يُحتسب،
 *   3) والسند الملغى يُعيد الموظّف «غير مصروف» فيُصرف الشهر نفسه مرّتين.
 *
 * المنظور يُظهر بنود المسيّرات المعتمدة وحدها، بالصافي المحسوب، وبعمود
 * `is_paid` المشتقّ من سند الصرف المختوم على البند نفسه — فلا يكذب على
 * المستخدم ولا يسمح بصرفٍ ثانٍ.
 */
function usePayablePayrollItems(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-payable-items", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_payroll_items_payable")
        .select(
          "item_id, payroll_run_id, period_month, run_status, employee_id, employee_name, job_number, gross_salary, deductions_total, net_salary, is_paid, paid_at",
        )
        .eq("organization_id", organizationId)
        .order("period_month", { ascending: false })
        .order("employee_name")
        .limit(500);
      if (error) throw error;
      return (data as PayableItem[]) ?? [];
    },
  });
}

function useSalaryHistory(organizationId: string | undefined, month: string) {
  return useQuery({
    queryKey: ["payroll-history", organizationId, month],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const start = `${month}-01`;
      const { data, error } = await supabase
        .from("financial_vouchers")
        // `is_void` يُقرأ ليُعرَض: السجلّ يحفظ السند الملغى ولا يُظهره كسندٍ سارٍ
        .select("id, voucher_number, voucher_date, amount, employee_name, description, is_void, void_reason")
        .eq("organization_id", organizationId)
        .eq("voucher_type", "salary")
        .gte("voucher_date", start)
        // `${month}-31` يُنتج 2026-02-31 و2026-04-31 — تواريخ لا وجود لها،
        // فترفضها القاعدة ويفشل **الاستعلام كله**: كشف الرواتب يظهر فارغًا في
        // فبراير وأبريل ويونيو وسبتمبر ونوفمبر بلا أي رسالة خطأ.
        .lt("voucher_date", nextMonthStart(month))
        .order("voucher_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Payroll() {
  const { organization } = useOrganizationAccess();
  const [payTarget, setPayTarget] = useState<PayableItem | null>(null);
  const items = usePayablePayrollItems(organization?.id);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const history = useSalaryHistory(organization?.id, historyMonth);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الرواتب</h1>
        <p className="text-sm text-muted-foreground">مسيّرات الرواتب وصرفها — شهر {currentMonthLabel()}</p>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">المسيّرات والقسائم</TabsTrigger>
          <TabsTrigger value="quick">الصرف الفرديّ</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="mt-4">
          <PayrollRuns />
        </TabsContent>

        <TabsContent value="quick" className="mt-4 flex flex-col gap-5">

      <Card>
        <CardHeader>
          <CardTitle>بنود المسيّرات المعتمدة</CardTitle>
          <CardDescription>
            الصرف الفرديّ يكون على بندٍ في مسيّر معتمَد وبمبلغ <strong>الصافي</strong> المحسوب فيه —
            لا مبلغ يُكتب باليد. البند المصروف يُختم بسنده فلا يُصرف مرّتين.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {items.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                تعذّر قراءة بنود المسيّرات:{" "}
                {errorMessage(items.error, "خطأ غير متوقع")}
              </span>
            </div>
          )}
          {!items.isLoading && !items.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الشهر</TableHead>
                  <TableHead>#الوظيفي</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الاستقطاعات</TableHead>
                  <TableHead>الصافي المستحقّ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items.data ?? []).map((item) => (
                  <TableRow key={item.item_id}>
                    <TableCell className="font-mono text-xs">{String(item.period_month).slice(0, 7)}</TableCell>
                    <TableCell className="font-mono text-xs">{item.job_number ?? "—"}</TableCell>
                    <TableCell className="font-medium">{item.employee_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{money(item.gross_salary)} ر.س</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {Number(item.deductions_total ?? 0) > 0 ? `− ${money(item.deductions_total)}` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums font-semibold">{money(item.net_salary)} ر.س</TableCell>
                    <TableCell>
                      {item.is_paid ? (
                        <Badge variant="success">
                          <CheckCircle2 className="h-3 w-3" />
                          مصروف
                          {item.paid_at && (
                            <span className="ms-1 font-normal">
                              {new Date(item.paid_at).toLocaleDateString("ar-SA-u-nu-latn")}
                            </span>
                          )}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">لم يُصرف بعد</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* البند المصروف لا زرّ له أصلًا — والقاعدة ترفض الصرف الثاني حتى لو
                          فُتحت الشاشة على بيانات قديمة. */}
                      {!item.is_paid && (
                        <Button size="sm" variant="outline" onClick={() => setPayTarget(item)}>
                          <Banknote className="h-3.5 w-3.5" />
                          صرف الصافي
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(items.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد بنود قابلة للصرف — احتسب مسيّر الشهر و<strong>اعتمده</strong> من تبويب
                      «المسيّرات والقسائم»، ثم اصرف بنوده من هنا.
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
            <CardTitle className="text-base">سجل صرف الرواتب</CardTitle>
            <CardDescription>
              كل سندات صرف الراتب المسجّلة خلال الشهر المحدد — الملغى يبقى في السجلّ
              بشارة «ملغى» ولا يُحسب صرفًا
            </CardDescription>
          </div>
          <Input type="month" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} className="w-40" />
        </CardHeader>
        <CardContent>
          {history.isLoading && <Skeleton className="h-32 w-full" />}
          {!history.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#السند</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>البيان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data ?? []).map((voucher: any) => (
                  <TableRow key={voucher.id} className={voucher.is_void ? "opacity-60" : undefined}>
                    <TableCell className="font-mono text-xs">#{voucher.voucher_number}</TableCell>
                    <TableCell className="text-xs">{voucher.voucher_date}</TableCell>
                    <TableCell className="font-medium">{voucher.employee_name ?? "—"}</TableCell>
                    <TableCell className={voucher.is_void ? "line-through" : undefined}>
                      {Number(voucher.amount).toLocaleString("ar-SA-u-nu-latn")} ر.س
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {voucher.is_void && (
                        <Badge variant="destructive" className="me-1 text-[10px]">ملغى</Badge>
                      )}
                      {voucher.void_reason ?? voucher.description ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(history.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      لا توجد سندات صرف رواتب لهذا الشهر.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* المفتاح يُعيد بناء النافذة لكل بند: لا تبقى ملاحظةُ بندٍ سابق في الحقل. */}
      {payTarget && (
        <PayPayrollItemDialog
          key={payTarget.item_id}
          item={payTarget}
          onOpenChange={() => setPayTarget(null)}
        />
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * نافذة صرف بند مسيّر معتمَد.
 *
 * **لا مدخل للمبلغ**: المبلغ هو `net_salary` المحسوب في المسيّر، والدالّة
 * `app_pay_payroll_item` هي التي تقرأه من القاعدة وتكتب السند وتختم البند —
 * فلا يمكن للواجهة أن تُمرّر مبلغًا مخالفًا للمستحقّ. الحقل الوحيد هو بيان
 * السند (اختياري).
 *
 * الصرف عملية متعددة الخطوات (فحص الاعتماد + فحص عدم الصرف المسبق + سند صرف +
 * ختم البند + تدقيق) فلا تُكتب من الواجهة صفًّا صفًّا كما كانت: الإدراج المباشر
 * في `financial_vouchers` كان يترك البند غير مختوم، فيُصرف مرّة أخرى.
 */
function PayPayrollItemDialog({
  item,
  onOpenChange,
}: {
  item: PayableItem;
  onOpenChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");

  const payItem = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_pay_payroll_item", {
        p_item_id: item.item_id,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-payable-items"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-history"] });
      // كشف المسيّرات وقسائمه يقرآن نفس البنود بمفاتيح أخرى.
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-register"] });
      toast({
        title: "تم صرف الراتب بالصافي",
        description: `${item.employee_name ?? ""} — ${money(item.net_salary)} ر.س (شهر ${String(item.period_month).slice(0, 7)})`,
      });
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر صرف الراتب",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>صرف راتب — {item.employee_name ?? "—"}</DialogTitle>
          <DialogDescription>
            بند مسيّر شهر {String(item.period_month).slice(0, 7)} — المبلغ المصروف هو الصافي المحسوب
            في المسيّر المعتمَد، ولا يُعدَّل من هنا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">إجمالي الراتب</span>
              <span className="tabular-nums">{money(item.gross_salary)} ر.س</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">الاستقطاعات</span>
              <span className="tabular-nums text-destructive">− {money(item.deductions_total)} ر.س</span>
            </div>
            <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
              <span>الصافي المستحقّ</span>
              <span className="tabular-nums">{money(item.net_salary)} ر.س</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بيان السند (اختياري)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="يُترك فارغًا فيكتب النظام البيان تلقائيًا"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            إلغاء
          </Button>
          <Button disabled={payItem.isPending} onClick={() => payItem.mutate()}>
            {payItem.isPending ? "جارٍ الصرف..." : `تأكيد صرف ${money(item.net_salary)} ر.س`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
