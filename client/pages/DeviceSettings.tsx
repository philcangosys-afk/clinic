import { useEffect, useState } from "react";
import { MonitorCog, Download, Info, HardDriveDownload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

/**
 * إعدادات الجهاز والنسخ الاحتياطي (لقطتا 79 و80).
 *
 * **لماذا التخزين محلي لا في القاعدة:** هذه تفضيلات *جهاز* لا تفضيلات
 * *مستخدم*. جهاز الاستقبال يطبع على طابعة حرارية بينما جهاز المحاسبة يطبع
 * A4، وقد يستعملهما الشخص نفسه بالحساب نفسه. حفظها في القاعدة كان سيجعل
 * إعداد جهاز يتبع المستخدم إلى جهاز آخر فيطبع على الطابعة الخطأ.
 *
 * النتيجة المقصودة: تُمسَح هذه الإعدادات بمسح بيانات المتصفح، ولا تنتقل بين
 * الأجهزة — وهذا هو السلوك الصحيح لا نقصًا فيه.
 */
const STORAGE_KEY = "zaincare-device-settings";

/**
 * حُذفت أربع تفضيلات كانت تُحفظ ولا تقرؤها أي شاشة: «عدد الصفوف في الصفحة»،
 * و«المستودع الافتراضي»، و«العيادة الافتراضية»، و«مقاس الورق لهذا الجهاز»
 * (`rowsPerPage`/`defaultWarehouseId`/`defaultClinicId`/`paperOverride` — صفر
 * مرجع خارج هذا الملفّ). كان المستخدم يضبط مقاس الورق لجهاز الاستقبال ويطبع
 * على المقاس الخطأ وهو واثق أنه ضبطه؛ فإعدادٌ صامت أسوأ من غيابه. يبقى «اسم
 * الجهاز» وهو الحقل الموصول فعلًا (يُرسَل ترويسة `x-device-name` ويظهر في سجل
 * التدقيق). تُعاد أيّ منها متى وُصلت بقارئها الحقيقي (المقاس في دمج المستندات،
 * والمستودع/العيادة كقيمة أولية في نماذج الصرف والحجز).
 */
type DeviceSettings = {
  deviceName: string;
};

const DEFAULTS: DeviceSettings = {
  deviceName: "",
};

/**
 * القراءة والكتابة محاطتان بـ try/catch: التخزين المحلي يرمي استثناءً في
 * وضع التصفح الخاص وفي متصفحات تمنع بيانات المواقع — والانهيار هناك يعطّل
 * الشاشة كلها لأجل تفضيل ثانوي.
 */
export function readDeviceSettings(): DeviceSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DeviceSettings>) };
  } catch {
    return DEFAULTS;
  }
}

function writeDeviceSettings(value: DeviceSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** الجداول القابلة للتصدير — كلها محكومة بـ RLS فلا يخرج إلا ما تراه المنشأة. */
const EXPORTABLE = [
  { table: "patients", label: "المرضى" },
  { table: "doctors", label: "الأطباء" },
  { table: "items", label: "الأصناف والخدمات" },
  { table: "distributors", label: "الموردون" },
  { table: "sales_invoices", label: "فواتير المبيعات" },
  { table: "sales_invoice_items", label: "بنود فواتير المبيعات" },
  { table: "appointments", label: "المواعيد" },
  { table: "patient_visits", label: "زيارات المرضى" },
  { table: "inventory_movements", label: "حركات المخزون" },
  { table: "financial_vouchers", label: "السندات المالية" },
];

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '""';
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

export default function DeviceSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULTS);
  const [exporting, setExporting] = useState<string | null>(null);

  // القراءة في تأثير لا في القيمة الأولية: التقديم من الخادم (SSR) لا يملك
  // window، والقراءة المباشرة كانت ستنهار قبل الوصول للمتصفح.
  useEffect(() => setSettings(readDeviceSettings()), []);

  const save = () => {
    if (writeDeviceSettings(settings)) toast({ title: "حُفظت إعدادات هذا الجهاز" });
    else
      toast({
        variant: "destructive",
        title: "تعذر الحفظ على هذا الجهاز",
        description: "المتصفح يمنع تخزين بيانات المواقع — جرّب خارج وضع التصفح الخاص.",
      });
  };

  const exportTable = async (table: string, label: string) => {
    setExporting(table);
    try {
      // صفحات من 1000: طلب واحد بكل الصفوف يصطدم بحد PostgREST الافتراضي
      // فيُصدَّر جزء من البيانات ويظن المستخدم أنه صدّر الكل.
      const page = 1000;
      const all: Record<string, unknown>[] = [];
      for (let from = 0; ; from += page) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .range(from, from + page - 1);
        if (error) throw error;
        all.push(...((data ?? []) as Record<string, unknown>[]));
        if ((data ?? []).length < page) break;
      }
      if (all.length === 0) {
        toast({ title: `لا توجد بيانات في "${label}"` });
        return;
      }
      // BOM حتى تفتح إكسل الملف بترميز عربي صحيح
      const blob = new Blob(["﻿" + toCsv(all)], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${table}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: `صُدِّر ${all.length} صفًا من "${label}"` });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: `تعذر تصدير "${label}"`,
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <MonitorCog className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">إعدادات الجهاز والنسخ</h1>
          <p className="text-sm text-muted-foreground">
            تفضيلات تخصّ هذا الجهاز وحده، وتصدير بيانات المنشأة
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تفضيلات هذا الجهاز</CardTitle>
          <CardDescription>
            تُحفظ في هذا المتصفح فقط ولا تنتقل معك إلى جهاز آخر — وهذا مقصود: جهاز الاستقبال قد
            يطبع على طابعة حرارية بينما جهاز المحاسبة يطبع A4، والحساب نفسه قد يُستعمل على
            الاثنين.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>اسم الجهاز</Label>
              <Input
                value={settings.deviceName}
                onChange={(e) => setSettings((prev) => ({ ...prev, deviceName: e.target.value }))}
                placeholder="استقبال 1"
              />
              <p className="text-xs text-muted-foreground">
                يُعرض في سجل التدقيق مع العمليات المنفَّذة من هذا الجهاز — ويسري على الطلبات بعد
                تحديث الصفحة (يُقرأ مرة عند إقلاع التطبيق).
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            مقاس الورق لهذا الجهاز والمستودع/العيادة الافتراضيان وعدد الصفوف: أُزيلت من هذه
            الشاشة لأنها كانت تُحفظ ولا تقرؤها أي شاشة — فالطباعة تتبع إعداد المنشأة من تبويب
            «الطباعة» في إعدادات التشغيل.
          </p>

          <Button className="self-start" onClick={save}>
            حفظ إعدادات الجهاز
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-4 w-4" />
            تصدير البيانات
          </CardTitle>
          <CardDescription>تصدير كل صفوف الجدول المرئية لمنشأتك كملف CSV</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>هذا تصدير بيانات، وليس نسخة احتياطية كاملة.</strong> النسخة الاحتياطية
              الحقيقية (بكل الجداول والعلاقات والصلاحيات، وقابلة للاستعادة) تُؤخَذ من لوحة تحكم
              Supabase — لا من المتصفح، لأن المتصفح لا يملك ولا يجوز أن يملك صلاحية قراءة قاعدة
              البيانات كاملة. استعمل هذا التصدير للأرشفة والتحليل في إكسل.
            </span>
          </div>

          <Separator />

          <div className="grid gap-2 sm:grid-cols-2">
            {EXPORTABLE.map((entry) => (
              <div
                key={entry.table}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{entry.table}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting !== null}
                  onClick={() => exportTable(entry.table, entry.label)}
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting === entry.table ? "جارٍ..." : "تصدير"}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            التصدير يمرّ بنفس سياسات الأمان (RLS) المطبَّقة على الشاشات — فلا يخرج منه إلا ما
            تراه منشأتك أصلًا.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>نظام الترقيم</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            أرقام الفواتير والاتفاقيات والمناقلات تُولَّد في قاعدة البيانات بمتتاليات
            (<span className="font-mono text-xs">bigserial</span>) — لا في المتصفح. هذا مقصود: توليد
            الرقم في المتصفح يعني أن جهازين يصدران فاتورتين في اللحظة نفسها قد يعطيانهما{" "}
            <strong>الرقم ذاته</strong>، وهو خطأ محاسبي لا يمكن إصلاحه بأثر رجعي.
          </p>
          <p className="mt-2">
            <Badge variant="secondary">التسلسل الحالي مستمر ولا ينقطع</Badge> — إضافة بادئة أو
            لاحقة مخصصة لكل نوع مستند تحتاج تعديلًا على القاعدة، ويمكن إضافتها لاحقًا دون كسر
            الأرقام الصادرة.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
