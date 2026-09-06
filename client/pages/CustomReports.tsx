import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LayoutGrid, Play, Plus, Save, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { CustomReportRow } from "@/lib/database.types";
import { localDayRange } from "@/lib/date-range";
import {
  getReportSource,
  OPERATORS_BY_TYPE,
  REPORT_SOURCES,
  type FilterOperator,
  type ReportFilter,
} from "@/lib/report-builder-sources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const RESULT_ROW_CAP = 500;

/**
 * الأعمدة الزمنية (`timestamptz`) في مصادر التقارير، بمفتاح «المصدر.العمود».
 *
 * **لماذا القائمة موجودة**: مرشّحات التاريخ كانت تمرّر نصّ اليوم كما هو، وعمودٌ
 * زمنيّ يُقارَن بـ`"2026-09-06"` يعني اللحظة 00:00 تمامًا — فـ«يساوي 2026-09-06»
 * يُعيد صفرًا دائمًا (لا صف مخزَّن على منتصف الليل بالضبط)، و«حتى 2026-09-06»
 * تُسقط يوم النهاية كلّه. أمّا الأعمدة من نوع `date` فمقارنتها بالنصّ صحيحة،
 * ولو طُبِّق عليها مدى اللحظات لانحرفت بمقدار إزاحة المنطقة الزمنية. فلا بدّ من
 * التمييز بينهما — وهو ما تفعله هذه القائمة، مأخوذة من أنواع الأعمدة في
 * القاعدة (`patients.birth_date` مثلًا `date`، و`patients.file_date`
 * `timestamptz`).
 */
const TIMESTAMP_FIELDS = new Set([
  "patients.file_date",
  "appointments.scheduled_start",
  "appointments.created_at",
  "sales_invoices.created_at",
  "external_clients.registered_at",
]);

function toCsv(
  rows: Record<string, unknown>[],
  fields: string[],
  labels: Record<string, string>,
  notice?: string,
): string {
  const header = fields.map((f) => labels[f] ?? f).join(",");
  const lines = rows.map((row) =>
    fields
      .map((f) => {
        const value = row[f];
        const text = value == null ? "" : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  // التحذير يُكتب في الملفّ نفسه: من يفتح CSV لا يرى تحذير الشاشة
  if (notice) lines.push(`"${notice.replace(/"/g, '""')}"`);
  return [header, ...lines].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function useSavedReports(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["custom-reports", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_reports")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomReportRow[];
    },
  });
}

export default function CustomReports() {
  const { organization, session } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedReports = useSavedReports(organization?.id);

  const [sourceKey, setSourceKey] = useState(REPORT_SOURCES[0].key);
  const [selectedFields, setSelectedFields] = useState<string[]>(REPORT_SOURCES[0].fields.slice(0, 4).map((f) => f.key));
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [groupByField, setGroupByField] = useState<string>("");
  const [aggregation, setAggregation] = useState<"count" | "sum" | "">("");
  const [aggregationField, setAggregationField] = useState<string>("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [grouped, setGrouped] = useState<{ group: string; value: number }[] | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reportName, setReportName] = useState("");
  const [loadedReportId, setLoadedReportId] = useState<string | null>(null);
  /** عدد الصفوف المقروءة فعلًا وعدد المطابق في القاعدة — للتمييز بينهما. */
  const [fetchedCount, setFetchedCount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);

  const source = getReportSource(sourceKey)!;
  const fieldLabels = useMemo(() => Object.fromEntries(source.fields.map((f) => [f.key, f.label])), [source]);
  const numericFields = source.fields.filter((f) => f.type === "number");
  const groupableFields = source.fields.filter((f) => f.type === "enum" || f.type === "text" || f.type === "boolean");

  const changeSource = (key: string) => {
    const nextSource = getReportSource(key)!;
    setSourceKey(key);
    setSelectedFields(nextSource.fields.slice(0, 4).map((f) => f.key));
    setFilters([]);
    setGroupByField("");
    setAggregation("");
    setAggregationField("");
    setResults(null);
    setGrouped(null);
    setLoadedReportId(null);
    setReportName("");
  };

  const toggleField = (key: string) => {
    setSelectedFields((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const addFilter = () => {
    const firstField = source.fields[0];
    setFilters((prev) => [...prev, { field: firstField.key, operator: OPERATORS_BY_TYPE[firstField.type][0].value, value: "" }]);
  };
  const updateFilter = (index: number, patch: Partial<ReportFilter>) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (selectedFields.length === 0) throw new Error("اختر عمودًا واحدًا على الأقل");

      const fieldsToFetch = new Set(selectedFields);
      if (groupByField) fieldsToFetch.add(groupByField);
      if (aggregation === "sum" && aggregationField) fieldsToFetch.add(aggregationField);

      // `count: "exact"` يكشف كم صفًّا يطابق الفلاتر **قبل** السقف: بلا هذا
      // العدد كان التجميع يُحسب على أول 500 صف ويُعرض كإجمالي بلا أي إشارة.
      let query = supabase
        .from(source.table)
        .select(Array.from(fieldsToFetch).join(","), { count: "exact" })
        .eq("organization_id", organization.id);

      for (const filter of filters) {
        if (!filter.value && filter.operator !== "is_empty" && filter.operator !== "is_not_empty") continue;
        const fieldDef = source.fields.find((f) => f.key === filter.field);
        if (!fieldDef) continue;
        // عمود زمنيّ: «يساوي يومًا» مدى اليوم كاملًا، و«حتى يوم» نهايته —
        // بحدود بتوقيت المستخدم من `date-range.ts` لا بتوقيت الخادم.
        if (fieldDef.type === "date" && TIMESTAMP_FIELDS.has(`${sourceKey}.${filter.field}`)) {
          const bounds = localDayRange(String(filter.value), String(filter.value));
          if (bounds.from && bounds.to) {
            if (filter.operator === "eq") query = query.gte(filter.field, bounds.from).lte(filter.field, bounds.to);
            else if (filter.operator === "gte") query = query.gte(filter.field, bounds.from);
            else if (filter.operator === "lte") query = query.lte(filter.field, bounds.to);
          }
          continue;
        }
        const value: string | number | boolean =
          fieldDef.type === "number" ? Number(filter.value) : fieldDef.type === "boolean" ? filter.value === "true" : filter.value;
        switch (filter.operator as FilterOperator) {
          case "contains":
            query = query.ilike(filter.field, `%${filter.value}%`);
            break;
          case "eq":
            query = query.eq(filter.field, value);
            break;
          case "neq":
            query = query.neq(filter.field, value);
            break;
          case "gt":
            query = query.gt(filter.field, value);
            break;
          case "gte":
            query = query.gte(filter.field, value);
            break;
          case "lt":
            query = query.lt(filter.field, value);
            break;
          case "lte":
            query = query.lte(filter.field, value);
            break;
          case "is_empty":
            query = query.or(`${filter.field}.is.null,${filter.field}.eq.`);
            break;
          case "is_not_empty":
            query = query.not(filter.field, "is", null);
            break;
        }
      }

      if (source.defaultOrderBy) query = query.order(source.defaultOrderBy, { ascending: false });
      query = query.limit(RESULT_ROW_CAP);

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      setFetchedCount(rows.length);
      setMatchedCount(count ?? rows.length);

      if (groupByField && aggregation) {
        const map = new Map<string, number>();
        for (const row of rows) {
          const key = String(row[groupByField] ?? "—");
          const prev = map.get(key) ?? 0;
          if (aggregation === "count") map.set(key, prev + 1);
          else map.set(key, prev + Number(row[aggregationField] ?? 0));
        }
        setGrouped(Array.from(map.entries()).map(([group, value]) => ({ group, value })).sort((a, b) => b.value - a.value));
        setResults(null);
      } else {
        setResults(rows);
        setGrouped(null);
      }
      return rows.length;
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر تشغيل التقرير", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  const saveReport = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!reportName.trim()) throw new Error("اسم التقرير مطلوب");
      const payload = {
        organization_id: organization.id,
        name: reportName.trim(),
        source_key: sourceKey,
        selected_fields: selectedFields,
        filters,
        group_by_field: groupByField || null,
        aggregation: aggregation || null,
        aggregation_field: aggregationField || null,
        created_by: session?.user.id ?? null,
      };
      if (loadedReportId) {
        const { data: affectedRows, error } = await supabase.from("custom_reports").update(payload).eq("id", loadedReportId)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("custom_reports").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-reports", organization?.id] });
      toast({ title: "تم حفظ التقرير" });
      setSaveOpen(false);
      // الاسم يبقى بعد تحديث تقرير محمَّل ليظهر في المرّة القادمة
      if (!loadedReportId) setReportName("");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  const deleteReport = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("custom_reports").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-reports", organization?.id] });
      toast({ title: "تم حذف التقرير" });
    },
  });

  const loadReport = (report: CustomReportRow) => {
    setSourceKey(report.source_key);
    setSelectedFields(report.selected_fields);
    setFilters(report.filters as ReportFilter[]);
    setGroupByField(report.group_by_field ?? "");
    setAggregation((report.aggregation as "count" | "sum" | null) ?? "");
    setAggregationField(report.aggregation_field ?? "");
    setLoadedReportId(report.id);
    // اسم التقرير المحمَّل يُحمَل معه: زرّ «تحديث الحفظ» كان يفتح الحوار باسم
    // فارغ فيُرفض بـ«اسم التقرير مطلوب»، أو يُعاد كتابته باسم مختلف فيتغيّر
    // اسم تقرير محفوظ بلا قصد.
    setReportName(report.name);
    setResults(null);
    setGrouped(null);
  };

  /** بلغ التشغيل سقف الصفوف: المطابق في القاعدة أكثر من المقروء. */
  const isCapped = matchedCount > fetchedCount;
  const capNotice = `تحذير: بلغ التشغيل حدّه الأقصى (${RESULT_ROW_CAP} صف) — قُرئ ${fetchedCount} من ${matchedCount} صفًّا مطابقًا، وما أدناه محسوب على المقروء فقط لا على كل المطابق.`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <LayoutGrid className="h-6 w-6" /> تقارير مخصصة
        </h1>
        <p className="text-sm text-muted-foreground">
          اختر مصدر بيانات من القائمة أدناه، وحدِّد الأعمدة والفلاتر، ثم شغّل التقرير. كل استعلام يمر عبر نفس الحماية (RLS) المطبَّقة على
          الشاشات الأخرى — لا SQL حر، ونتائج كل تشغيل محدودة بأول {RESULT_ROW_CAP} صف.
        </p>
      </div>

      {(savedReports.data ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">تقارير محفوظة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(savedReports.data ?? []).map((report) => (
              <div key={report.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs">
                <button className="font-medium hover:underline" onClick={() => loadReport(report)}>
                  {report.name}
                </button>
                <button onClick={() => deleteReport.mutate(report.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">مصدر البيانات</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 sm:w-64">
            <Label>المصدر</Label>
            <Select value={sourceKey} onValueChange={changeSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_SOURCES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الأعمدة المعروضة</Label>
            <div className="flex flex-wrap gap-3 rounded-lg border p-3">
              {source.fields.map((field) => (
                <label key={field.key} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={selectedFields.includes(field.key)} onChange={() => toggleField(field.key)} />
                  {field.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>الفلاتر</Label>
              <Button size="sm" variant="outline" onClick={addFilter}>
                <Plus className="h-3.5 w-3.5" />
                إضافة فلتر
              </Button>
            </div>
            {filters.map((filter, index) => {
              const fieldDef = source.fields.find((f) => f.key === filter.field) ?? source.fields[0];
              const operators = OPERATORS_BY_TYPE[fieldDef.type];
              const needsValue = filter.operator !== "is_empty" && filter.operator !== "is_not_empty";
              return (
                <div key={index} className="grid grid-cols-12 gap-2">
                  <Select
                    value={filter.field}
                    onValueChange={(v) => {
                      const nextDef = source.fields.find((f) => f.key === v)!;
                      updateFilter(index, { field: v, operator: OPERATORS_BY_TYPE[nextDef.type][0].value, value: "" });
                    }}
                  >
                    <SelectTrigger className="col-span-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {source.fields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filter.operator} onValueChange={(v) => updateFilter(index, { operator: v as FilterOperator, value: "" })}>
                    <SelectTrigger className="col-span-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {needsValue && (fieldDef.type === "enum" || fieldDef.type === "boolean") ? (
                    <Select value={filter.value} onValueChange={(v) => updateFilter(index, { value: v })}>
                      <SelectTrigger className="col-span-4">
                        <SelectValue placeholder="القيمة" />
                      </SelectTrigger>
                      <SelectContent>
                        {(fieldDef.enumOptions ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : needsValue ? (
                    <Input
                      className="col-span-4"
                      type={fieldDef.type === "date" ? "date" : fieldDef.type === "number" ? "number" : "text"}
                      value={filter.value}
                      onChange={(e) => updateFilter(index, { value: e.target.value })}
                      placeholder="القيمة"
                    />
                  ) : (
                    <div className="col-span-4" />
                  )}
                  <Button size="sm" variant="ghost" className="col-span-1" onClick={() => removeFilter(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {filters.length === 0 && <p className="text-xs text-muted-foreground">بلا فلاتر — سيعرض التقرير كل الصفوف (حتى {RESULT_ROW_CAP}).</p>}
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">تجميع حسب (اختياري)</Label>
              <Select value={groupByField || "__none"} onValueChange={(v) => setGroupByField(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">بلا تجميع</SelectItem>
                  {groupableFields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">نوع التجميع</Label>
              <Select
                value={aggregation || "__none"}
                onValueChange={(v) => setAggregation(v === "__none" ? "" : (v as "count" | "sum"))}
                disabled={!groupByField}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">بلا</SelectItem>
                  <SelectItem value="count">عدد الصفوف</SelectItem>
                  <SelectItem value="sum">جمع قيمة عمود</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">العمود المُجمَّع (عند الجمع)</Label>
              {/* «—» رمز واجهة لا اسم عمود: تخزينه كما هو كان يضع `__none` في
                  قائمة الأعمدة المطلوبة فيفشل التشغيل بخطأ عمود غير موجود. */}
              <Select
                value={aggregationField || "__none"}
                onValueChange={(v) => setAggregationField(v === "__none" ? "" : v)}
                disabled={aggregation !== "sum"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {numericFields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button disabled={run.isPending} onClick={() => run.mutate()}>
              <Play className="h-4 w-4" />
              {run.isPending ? "جارٍ التشغيل..." : "تشغيل التقرير"}
            </Button>
            <Button variant="outline" onClick={() => setSaveOpen(true)}>
              <Save className="h-4 w-4" />
              {loadedReportId ? "تحديث الحفظ" : "حفظ التقرير"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(results || grouped) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">النتائج</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                grouped
                  ? downloadCsv(
                      "report.csv",
                      toCsv(
                        grouped as unknown as Record<string, unknown>[],
                        ["group", "value"],
                        { group: fieldLabels[groupByField] ?? groupByField, value: "القيمة" },
                        isCapped ? capNotice : undefined,
                      ),
                    )
                  : downloadCsv(
                      "report.csv",
                      toCsv(results ?? [], selectedFields, fieldLabels, isCapped ? capNotice : undefined),
                    )
              }
            >
              <Download className="h-3.5 w-3.5" />
              تنزيل CSV
            </Button>
          </CardHeader>
          <CardContent>
            {/* التحذير فوق النتائج ولكلا العرضين: كان داخل فرع «النتائج
                المفصّلة» وحده، فيختفي تمامًا في العرض المجمَّع — وهو العرض
                الذي يُقرأ فيه الرقم كإجمالي. */}
            {isCapped && (
              <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {capNotice} ضيّق الفلاتر ليكون الرقم كاملًا.
              </p>
            )}
            {grouped && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{fieldLabels[groupByField] ?? groupByField}</TableHead>
                    <TableHead>{aggregation === "count" ? "عدد الصفوف" : "الإجمالي"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map((row) => (
                    <TableRow key={row.group}>
                      <TableCell className="font-medium">{row.group}</TableCell>
                      <TableCell>{row.value.toLocaleString("ar-SA")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {results && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {selectedFields.map((f) => (
                        <TableHead key={f}>{fieldLabels[f] ?? f}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row, index) => (
                      <TableRow key={index}>
                        {selectedFields.map((f) => (
                          <TableCell key={f} className="text-sm">
                            {String(row[f] ?? "—")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {results.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={selectedFields.length} className="py-8 text-center text-sm text-muted-foreground">
                          لا توجد نتائج مطابقة للفلاتر المحدَّدة.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{loadedReportId ? "تحديث التقرير المحفوظ" : "حفظ التقرير"}</DialogTitle>
            <DialogDescription>
              {loadedReportId
                ? "يُحدَّث تعريف التقرير المحمَّل بالإعدادات الحالية. تغيير الاسم هنا يعيد تسميته."
                : "يُحفظ تعريف التقرير (المصدر والأعمدة والفلاتر) لتشغيله لاحقًا بنفس الإعدادات"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>اسم التقرير</Label>
            <Input value={reportName} onChange={(e) => setReportName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button disabled={saveReport.isPending} onClick={() => saveReport.mutate()}>
              {saveReport.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
