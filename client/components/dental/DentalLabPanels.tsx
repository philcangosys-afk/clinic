import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, Clock, PackageCheck, RotateCcw, Truck } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, useLocaleSettings } from "@/lib/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * لوحات معمل الأسنان — ما لا يُقرأ من جدول الطلبيات.
 *
 * **العيب الذي تعالجه:** القسم كان جدول طلبيات وكتالوج أصناف وأرصدة، ولا شيء
 * فيه **يُجمِّع**. فلا أحد يعرف كم طلبية تأخّرت، ولا مَن من الأطباء له عالقٌ
 * عند المعمل، ولا أيّ معمل يُعيد العمل أكثر من غيره. والطبيب يسأل الاستقبال،
 * والاستقبال يتّصل بالمعمل، والجواب يُنسى قبل السؤال التالي.
 *
 * والتجميع كلّه في القاعدة (0166) لا في المتصفّح: الطلبيات محدودة بسقفٍ من
 * الصفوف، فجمعُ الظاهر منها يُنتج رقمًا أصغر من الحقيقة يبدو صحيحًا.
 */

type LabOrderRow = {
  id: string;
  order_number: number;
  order_date: string | null;
  sent_at: string | null;
  delivery_date: string | null;
  received_date: string | null;
  status: string;
  priority: string;
  lab_name: string | null;
  lab_technician_name: string | null;
  patient_id: string | null;
  patient_name: string | null;
  patient_file_number: number | string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  case_type_name: string | null;
  material_name: string | null;
  shade_code: string | null;
  works: string | null;
  teeth: string | null;
  total_amount: number | null;
  remaining_amount: number | null;
  days_at_lab: number | null;
  rework_count: number | null;
  is_overdue: boolean | null;
  is_due_today: boolean | null;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "لم تُرسَل",
  in_progress: "عند المعمل",
  delivered: "سُلِّمت",
  cancelled: "ملغاة",
};

/**
 * الطلبيات من `v_dental_lab_orders` (0166) — صفٌّ واحد فيه المعمل والمريض
 * والطبيب ونوع الحالة والمادّة واللون والأسنان وأيام المكوث والتأخّر.
 */
export function useLabOrderBoard(organizationId: string | undefined, doctorId?: string | null) {
  return useQuery({
    queryKey: ["dental-lab-board", organizationId, doctorId ?? ""],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("v_dental_lab_orders")
        .select(
          "id, order_number, order_date, sent_at, delivery_date, received_date, status, priority, " +
            "lab_name, lab_technician_name, patient_id, patient_name, patient_file_number, doctor_id, doctor_name, " +
            "case_type_name, material_name, shade_code, works, teeth, total_amount, remaining_amount, " +
            "days_at_lab, rework_count, is_overdue, is_due_today",
        )
        // RLS يسمح بكل مؤسّسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId);
      if (doctorId) query = query.eq("doctor_id", doctorId);
      const { data, error } = await query.order("order_date", { ascending: false }).limit(300);
      if (error) throw error;
      return (data ?? []) as LabOrderRow[];
    },
  });
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof Clock;
  tone?: "rose" | "amber" | "sky" | "emerald";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "emerald"
          ? "text-emerald-700"
          : "text-sky-700";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-3 rounded-lg border p-3 text-start transition disabled:cursor-default ${
        active ? "border-primary bg-primary/5" : onClick ? "hover:border-primary/40" : ""
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${toneClass}`} />
      <span className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`font-mono text-xl font-bold tabular-nums ${toneClass}`}>
          {formatAmount(value)}
        </span>
      </span>
    </button>
  );
}

/**
 * لوحة اليوم — أربعة أرقام وقائمة ما يستحقّ النظر.
 *
 * الأرقام تُحسب على **كلّ** الطلبيات المقروءة لا على المعروض، والضغط على
 * رقمٍ يحصر القائمة به: رقمٌ لا يُفتح على ما وراءه رقمٌ لا يُتصرَّف بناءً
 * عليه.
 */
export function LabBoardTab({
  organizationId,
  doctorId,
}: {
  organizationId: string | undefined;
  doctorId?: string | null;
}) {
  const orders = useLabOrderBoard(organizationId, doctorId);
  const { calendarDisplay } = useLocaleSettings();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<"overdue" | "due" | "open" | "unsent" | null>("overdue");

  const rows = orders.data ?? [];
  const stats = useMemo(
    () => ({
      overdue: rows.filter((r) => r.is_overdue).length,
      due: rows.filter((r) => r.is_due_today).length,
      open: rows.filter((r) => r.status === "in_progress").length,
      unsent: rows.filter((r) => r.status === "pending").length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    if (bucket === "overdue") return rows.filter((r) => r.is_overdue);
    if (bucket === "due") return rows.filter((r) => r.is_due_today);
    if (bucket === "open") return rows.filter((r) => r.status === "in_progress");
    if (bucket === "unsent") return rows.filter((r) => r.status === "pending");
    return rows.filter((r) => r.status !== "cancelled");
  }, [rows, bucket]);

  return (
    <div className="flex flex-col gap-4">
      {orders.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          تعذّر تحميل الطلبيات: {errorMessage(orders.error)} — إن لم تُنفَّذ الترقية{" "}
          <span className="font-mono">0166</span> على القاعدة بعد، نفِّذها.
        </p>
      )}
      {orders.isLoading && <Skeleton className="h-24 w-full" />}

      {!orders.isLoading && !orders.isError && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="متأخّرة عن موعد التسليم"
              value={stats.overdue}
              icon={AlertTriangle}
              tone="rose"
              active={bucket === "overdue"}
              onClick={() => setBucket(bucket === "overdue" ? null : "overdue")}
            />
            <StatCard
              label="تُسلَّم اليوم"
              value={stats.due}
              icon={CalendarClock}
              tone="amber"
              active={bucket === "due"}
              onClick={() => setBucket(bucket === "due" ? null : "due")}
            />
            <StatCard
              label="عند المعمل"
              value={stats.open}
              icon={Truck}
              tone="sky"
              active={bucket === "open"}
              onClick={() => setBucket(bucket === "open" ? null : "open")}
            />
            <StatCard
              label="مسجَّلة ولم تُرسَل"
              value={stats.unsent}
              icon={PackageCheck}
              tone="emerald"
              active={bucket === "unsent"}
              onClick={() => setBucket(bucket === "unsent" ? null : "unsent")}
            />
          </div>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">
                {bucket === "overdue"
                  ? "المتأخّرة"
                  : bucket === "due"
                    ? "تُسلَّم اليوم"
                    : bucket === "open"
                      ? "عند المعمل"
                      : bucket === "unsent"
                        ? "لم تُرسَل بعد"
                        : "كلّ الطلبيات المفتوحة"}
              </CardTitle>
              <CardDescription>
                اضغط الرقم أعلاه لتحصر القائمة به، واضغطه ثانيةً لتعرض الكلّ.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">الرقم</TableHead>
                      <TableHead className="whitespace-nowrap">المريض</TableHead>
                      <TableHead className="whitespace-nowrap">الطبيب</TableHead>
                      <TableHead className="whitespace-nowrap">المعمل</TableHead>
                      <TableHead className="whitespace-nowrap">الحالة/المادّة</TableHead>
                      <TableHead className="whitespace-nowrap">الأسنان</TableHead>
                      <TableHead className="whitespace-nowrap">اللون</TableHead>
                      <TableHead className="whitespace-nowrap">أُرسلت</TableHead>
                      <TableHead className="whitespace-nowrap">التسليم</TableHead>
                      <TableHead className="whitespace-nowrap">أيام عند المعمل</TableHead>
                      <TableHead className="whitespace-nowrap">إعادات</TableHead>
                      <TableHead className="whitespace-nowrap">المتبقّي</TableHead>
                      <TableHead className="whitespace-nowrap">الوضع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums">
                          <span className="flex items-center gap-1">
                            {row.order_number}
                            {row.priority === "urgent" && (
                              <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                                عاجل
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.patient_name ? (
                            <button
                              type="button"
                              className="text-start hover:text-primary"
                              onClick={() => row.patient_id && navigate(`/patients/${row.patient_id}`)}
                            >
                              {row.patient_name}
                              {row.patient_file_number ? ` · ${row.patient_file_number}` : ""}
                            </button>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{row.doctor_name ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.lab_name ?? "—"}
                          {row.lab_technician_name && (
                            <span className="block text-[10px] text-muted-foreground">
                              {row.lab_technician_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.case_type_name ?? "—"}
                          {row.material_name && (
                            <span className="block text-[10px] text-muted-foreground">
                              {row.material_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{row.teeth ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.shade_code ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {row.sent_at ? formatDate(row.sent_at, calendarDisplay) : "—"}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap tabular-nums ${row.is_overdue ? "font-semibold text-rose-600" : ""}`}
                        >
                          {row.delivery_date ? formatDate(row.delivery_date, calendarDisplay) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {row.days_at_lab === null ? "—" : `${formatAmount(row.days_at_lab)} يوم`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {Number(row.rework_count ?? 0) > 0 ? (
                            <span className="text-amber-700">{formatAmount(row.rework_count ?? 0)}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {Number(row.remaining_amount ?? 0) > 0 ? (
                            <span className="text-rose-600">{formatAmount(row.remaining_amount ?? 0)}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge className={STATUS_BADGE[row.status] ?? ""}>
                            {STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {shown.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={13} className="py-8 text-center text-muted-foreground">
                          لا طلبيات في هذا النطاق.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * حسب الطبيب — مَن له عالقٌ عند المعمل.
 *
 * الطبيب بلا طلبيات لا يظهر: قائمةٌ فيها عشرون طبيبًا أصفارًا تُخفي الثلاثة
 * الذين لهم متأخّرات.
 */
export function LabByDoctorTab({ organizationId }: { organizationId: string | undefined }) {
  const { calendarDisplay } = useLocaleSettings();
  const rows = useQuery({
    queryKey: ["dental-lab-by-doctor", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_dental_lab_by_doctor")
        .select("*")
        .eq("organization_id", organizationId)
        .order("overdue_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">طلبيات المعمل حسب الطبيب</CardTitle>
        <CardDescription>
          الطبيب بلا طلبيات لا يظهر. والأرقام مجمَّعة في القاعدة على كلّ طلبياته لا على المعروض.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.isLoading && <Skeleton className="m-3 h-24" />}
        {rows.isError && (
          <p className="m-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            تعذّر التحميل: {errorMessage(rows.error)} — الترقية{" "}
            <span className="font-mono">0166</span> تُنشئ هذا المنظور.
          </p>
        )}
        {!rows.isLoading && !rows.isError && (
          <div className="overflow-x-auto text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطبيب</TableHead>
                  <TableHead className="whitespace-nowrap">مفتوحة</TableHead>
                  <TableHead className="whitespace-nowrap">متأخّرة</TableHead>
                  <TableHead className="whitespace-nowrap">تُسلَّم اليوم</TableHead>
                  <TableHead className="whitespace-nowrap">سُلِّمت</TableHead>
                  <TableHead className="whitespace-nowrap">إعادات</TableHead>
                  <TableHead className="whitespace-nowrap">متوسّط الأيام</TableHead>
                  <TableHead className="whitespace-nowrap">الإجمالي</TableHead>
                  <TableHead className="whitespace-nowrap">المتبقّي</TableHead>
                  <TableHead className="whitespace-nowrap">آخر طلبية</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows.data ?? []).map((row) => (
                  <TableRow key={row.doctor_id}>
                    <TableCell className="whitespace-nowrap font-medium">{row.doctor_name}</TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.open_count)}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.overdue_count) > 0 ? (
                        <span className="font-semibold text-rose-600">{formatAmount(row.overdue_count)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.due_today_count)}</TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.delivered_count)}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.rework_events) > 0 ? (
                        <span className="text-amber-700">{formatAmount(row.rework_events)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.avg_days_at_lab === null ? "—" : formatAmount(row.avg_days_at_lab)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.total_amount)}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.remaining_amount) > 0 ? (
                        <span className="text-rose-600">{formatAmount(row.remaining_amount)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {row.last_order_date ? formatDate(row.last_order_date, calendarDisplay) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(rows.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      لا طبيب له طلبيات عند المعامل بعد.
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

/**
 * أداء المعامل.
 *
 * **نسبة الإعادة تُحسب على المُسلَّم لا على الكلّ:** طلبيةٌ ما زالت عند
 * المعمل لم يُحكَم عليها بعد، وإدخالها في المقام يُخفّف نسبة معملٍ رديء
 * كلّما تأخّر أكثر.
 */
export function LabPerformanceTab({ organizationId }: { organizationId: string | undefined }) {
  const rows = useQuery({
    queryKey: ["dental-lab-by-lab", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_dental_lab_by_lab")
        .select("*")
        .eq("organization_id", organizationId)
        .order("overdue_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw className="h-4 w-4" />
          أداء المعامل
        </CardTitle>
        <CardDescription>
          نسبة الإعادة محسوبة على ما سُلِّم لا على الكلّ — وهي أوّل مؤشّر على جودة المعمل.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.isLoading && <Skeleton className="m-3 h-24" />}
        {rows.isError && (
          <p className="m-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            تعذّر التحميل: {errorMessage(rows.error)} — الترقية{" "}
            <span className="font-mono">0166</span> تُنشئ هذا المنظور.
          </p>
        )}
        {!rows.isLoading && !rows.isError && (
          <div className="overflow-x-auto text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المعمل</TableHead>
                  <TableHead className="whitespace-nowrap">مفتوحة</TableHead>
                  <TableHead className="whitespace-nowrap">متأخّرة</TableHead>
                  <TableHead className="whitespace-nowrap">سُلِّمت</TableHead>
                  <TableHead className="whitespace-nowrap">إعادات</TableHead>
                  <TableHead className="whitespace-nowrap">نسبة الإعادة</TableHead>
                  <TableHead className="whitespace-nowrap">متوسّط الأيام</TableHead>
                  <TableHead className="whitespace-nowrap">الإجمالي</TableHead>
                  <TableHead className="whitespace-nowrap">المتبقّي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows.data ?? []).map((row) => (
                  <TableRow key={row.distributor_id}>
                    <TableCell className="whitespace-nowrap font-medium">{row.lab_name}</TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.open_count)}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.overdue_count) > 0 ? (
                        <span className="font-semibold text-rose-600">{formatAmount(row.overdue_count)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.delivered_count)}</TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.rework_events)}</TableCell>
                    <TableCell className="tabular-nums">
                      <span className={Number(row.rework_percent) >= 10 ? "font-semibold text-rose-600" : ""}>
                        {formatAmount(row.rework_percent)}%
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.avg_days_at_lab === null ? "—" : formatAmount(row.avg_days_at_lab)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.total_amount)}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.remaining_amount) > 0 ? (
                        <span className="text-rose-600">{formatAmount(row.remaining_amount)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(rows.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      لا معمل له طلبيات بعد.
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
