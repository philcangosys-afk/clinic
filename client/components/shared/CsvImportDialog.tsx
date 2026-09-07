import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { errorMessage } from "@/lib/error-message";

/**
 * استيراد سجلات من ملف CSV/إكسل (لقطة 96 وما يماثلها في شاشات الكتالوج).
 *
 * لماذا CSV لا XLSX: قراءة XLSX تتطلب مكتبة إضافية (~600KB) وتحمّل كل مستخدم
 * وزنها في كل زيارة مقابل ميزة تُستعمل مرّات معدودة. كل برامج الجداول تصدّر
 * CSV بضغطة، فالكلفة على المستخدم صفر تقريبًا والكلفة على النظام أقل بكثير.
 *
 * قرارات سلامة مقصودة:
 * • **معاينة إجبارية قبل الإدراج** — لا يُكتب شيء حتى يرى المستخدم ما سيُكتب.
 * • **الصفوف المعطوبة تُعرض ولا تُدرج**، ولا توقف السليمة. رفض الملف كله بسبب
 *   صف واحد يجعل المستخدم يصلح ويعيد الرفع مرارًا.
 * • **الإدراج على دفعات** — دفعة واحدة بآلاف الصفوف تتجاوز حدود الطلب.
 * • **لا تحديث ولا حذف** — الاستيراد يضيف فقط. مطابقة السجلات القائمة تحتاج
 *   مفتاحًا يقرّره المستخدم، وتخمينه هنا قد يستبدل بيانات صحيحة بأخرى.
 */
export type CsvColumn = {
  /** اسم العمود في قاعدة البيانات */
  key: string;
  /** العنوان المتوقَّع في صف العناوين بملف المستخدم */
  header: string;
  required?: boolean;
  /** تحويل النص إلى القيمة المخزَّنة؛ يرمي خطأً برسالة عربية عند قيمة غير صالحة */
  parse?: (raw: string) => unknown;
};

type ParsedRow = { index: number; values: Record<string, unknown>; error: string | null };

/**
 * محلّل CSV يحترم الاقتباس المزدوج وفواصل الأسطر داخل الحقول — التقسيم
 * بـ`split(",")` كان سيمزّق أي عنوان يحوي فاصلة.
 */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // BOM من إكسل يلتصق بأول عنوان فلا يطابق أي عمود
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // رقم السطر الفعلي يُحفظ مع كل صف: حذف الأسطر الفارغة هنا كان يزيح أرقام
  // الأسطر في رسائل الأخطاء، فيُشار إلى السطر 3 والخطأ في السطر 4.
  return rows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter((entry) => entry.cells.some((cell) => cell.trim() !== ""));
}

export default function CsvImportDialog({
  open,
  onOpenChange,
  table,
  columns,
  fixedValues,
  title,
  invalidateKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** الجدول الهدف */
  table: string;
  columns: CsvColumn[];
  /** قيم تُضاف لكل صف (organization_id مثلًا) */
  fixedValues: Record<string, unknown>;
  title: string;
  /** مفتاح react-query لإبطاله بعد نجاح الاستيراد */
  invalidateKey: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo<{ rows: ParsedRow[]; headerError: string | null }>(() => {
    if (!raw.trim()) return { rows: [], headerError: null };
    const grid = parseCsv(raw);
    if (grid.length < 2) return { rows: [], headerError: "الملف يحتاج صف عناوين وصف بيانات واحدًا على الأقل" };

    const headers = grid[0].cells.map((h) => h.trim());
    const missing = columns
      .filter((col) => col.required && !headers.includes(col.header))
      .map((col) => col.header);
    if (missing.length > 0)
      return { rows: [], headerError: `أعمدة إلزامية غير موجودة في صف العناوين: ${missing.join("، ")}` };

    const rows = grid.slice(1).map((entry) => {
      const cells = entry.cells;
      const values: Record<string, unknown> = { ...fixedValues };
      let error: string | null = null;
      for (const col of columns) {
        const at = headers.indexOf(col.header);
        const cell = at === -1 ? "" : (cells[at] ?? "").trim();
        if (!cell) {
          if (col.required) error = error ?? `العمود "${col.header}" مطلوب وفارغ`;
          // المفتاح يُترك غائبًا لا يُكتب `null`: كتابة null صريحة تتجاوز
          // قيمة العمود الافتراضية، فملف بلا عمود "السعر" كان يُفشل الدفعة
          // كلها بـ null value in column "price" violates not-null، رغم أن
          // للعمود قيمة افتراضية صفر.
          continue;
        }
        try {
          values[col.key] = col.parse ? col.parse(cell) : cell;
        } catch (parseError) {
          error =
            error ??
            `العمود "${col.header}": ${errorMessage(parseError, "قيمة غير صالحة")}`;
        }
      }
      return { index: entry.line, values, error };
    });
    return { rows, headerError: null };
  }, [raw, columns, fixedValues]);

  const validRows = parsed.rows.filter((row) => !row.error);
  const badRows = parsed.rows.filter((row) => row.error);

  const runImport = useMutation({
    mutationFn: async () => {
      if (validRows.length === 0) throw new Error("لا توجد صفوف صالحة للاستيراد");
      // دفعات من 200: طلب واحد بآلاف الصفوف يتجاوز حدود حجم الطلب.
      const size = 200;
      let inserted = 0;
      for (let i = 0; i < validRows.length; i += size) {
        const chunk = validRows.slice(i, i + size).map((row) => row.values);
        const { error } = await supabase.from(table).insert(chunk);
        if (error)
          throw new Error(
            `فشل عند الصف ${validRows[i]?.index ?? "?"}: ${error.message}. ` +
              `أُدرج ${inserted} صفًا قبل هذا الخطأ — راجع البيانات قبل إعادة المحاولة حتى لا تتكرّر.`,
          );
        inserted += chunk.length;
      }
      return inserted;
    },
    onSuccess: (inserted) => {
      queryClient.invalidateQueries({ queryKey: [invalidateKey] });
      toast({ title: `تم استيراد ${inserted} سجلًا` });
      setRaw("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الاستيراد",
        description: errorMessage(error),
      }),
  });

  /** ينزّل ملف قالب بالعناوين المتوقَّعة — أدق من شرحها نصًا. */
  const downloadTemplate = () => {
    const headers = columns.map((col) => `"${col.header}"`).join(",");
    // BOM حتى تفتح إكسل الملف بترميز عربي صحيح
    const blob = new Blob(["﻿" + headers + "\n"], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${table}-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            الاستيراد يضيف سجلات جديدة فقط — لا يعدّل ولا يحذف شيئًا موجودًا
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            اختيار ملف CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            تنزيل قالب بالعناوين
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setRaw(await file.text());
              // تصفير القيمة حتى يعمل اختيار نفس الملف مرة أخرى
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>أو الصق محتوى الملف هنا</Label>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={5}
            dir="ltr"
            placeholder={columns.map((col) => col.header).join(",")}
            className="font-mono text-xs"
          />
        </div>

        <div className="rounded-md border p-3 text-xs">
          <p className="mb-1 font-medium">الأعمدة المتوقَّعة:</p>
          <div className="flex flex-wrap gap-1.5">
            {columns.map((col) => (
              <Badge key={col.key} variant={col.required ? "default" : "secondary"}>
                {col.header}
                {col.required ? " *" : ""}
              </Badge>
            ))}
          </div>
        </div>

        {parsed.headerError && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{parsed.headerError}</span>
          </div>
        )}

        {parsed.rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {validRows.length} صف جاهز
              </span>
              {badRows.length > 0 && (
                <span className="flex items-center gap-1.5 text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  {badRows.length} صف به مشكلة (لن يُدرج)
                </span>
              )}
            </div>

            {badRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">السطر</TableHead>
                    <TableHead>سبب الاستبعاد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {badRows.slice(0, 20).map((row) => (
                    <TableRow key={row.index}>
                      <TableCell className="font-mono text-xs">{row.index}</TableCell>
                      <TableCell className="text-sm text-rose-700">{row.error}</TableCell>
                    </TableRow>
                  ))}
                  {badRows.length > 20 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground">
                        …و{badRows.length - 20} صفًا آخر به مشكلة.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">السطر</TableHead>
                    {columns.map((col) => (
                      <TableHead key={col.key}>{col.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validRows.slice(0, 10).map((row) => (
                    <TableRow key={row.index}>
                      <TableCell className="font-mono text-xs">{row.index}</TableCell>
                      {columns.map((col) => (
                        <TableCell key={col.key} className="text-sm">
                          {row.values[col.key] === null || row.values[col.key] === undefined
                            ? "—"
                            : String(row.values[col.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {validRows.length > 10 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  معاينة أول 10 صفوف — سيُستورَد {validRows.length}.
                </p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            disabled={validRows.length === 0 || runImport.isPending}
            onClick={() => runImport.mutate()}
          >
            {runImport.isPending ? "جارٍ الاستيراد..." : `استيراد ${validRows.length} سجلًا`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
