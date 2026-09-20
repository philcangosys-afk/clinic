import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Package, Stethoscope, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

type PurgeRow = { table_name: string; affected: number };

type PurgeKind = {
  key: "patients" | "doctors" | "items";
  label: string;
  icon: typeof Users;
  /** ما يقع فعلًا — يُقرأ قبل الضغط لا بعده. */
  effect: string;
  keeps: string;
};

/**
 * منطقة الخطر — تفريغ بيانات التجربة قبل التشغيل الحقيقيّ.
 *
 * **لماذا هنا لا في شاشتَي المرضى والخدمات؟** زرُّ حذفٍ جماعيّ في شريط أدوات
 * شاشةٍ تُفتح كل يوم يُضغط خطأً يومًا ما. وموضعه الصحيح صفحةُ إعداداتٍ لا
 * يدخلها إلّا صاحب المنشأة، تحت عنوانٍ يقول ما هو.
 *
 * **وثلاثة حُرّاس قبل الحذف:**
 *   ١) الدور يُفحَص **في القاعدة** لا هنا: مَن ليس مالكًا ولا مسؤولًا يُرفَض
 *      ولو وصل إلى الزرّ بأيّ طريق.
 *   ٢) **تجربةٌ إلزامية**: لا يظهر زرّ التنفيذ قبل أن تُعرض أعدادُ ما سيُحذف،
 *      وهي أعدادٌ حقيقية — القاعدة تُنفّذ الحذف ثمّ تتراجع عنه.
 *   ٣) **كتابة اسم المنشأة بخطّ اليد**: تأكيدٌ لا يُضغط سهوًا.
 */
const KINDS: PurgeKind[] = [
  {
    key: "patients",
    label: "حذف كلّ المرضى",
    icon: Users,
    effect:
      "يُحذف كلّ مريض ومعه كلّ ما تعلّق به: زياراته ومواعيده وفواتيره وسنداته ووصفاته وتحاليله وأشعّته واتفاقياته ومحفظته وملفّاته.",
    keeps:
      "لا تُمسّ فواتير العملاء الخارجيين ولا أيّ سندٍ لا مريضَ له. وأرقام الفواتير لا تعود إلى ١ — التسلسل يمضي ولا يرجع.",
  },
  {
    key: "doctors",
    label: "حذف كلّ الأطباء",
    icon: Stethoscope,
    effect:
      "تُحذف بطاقات الأطباء وصفوفهم الخاصّة: جداولهم ودوامهم وفروعهم وعياداتهم وخدماتهم — ومواعيدهم (الموعد بلا طبيب لا وجود له في المخطط).",
    keeps:
      "تاريخ المنشأة يبقى: فاتورةٌ أصدرها طبيب تبقى بمبلغها ويُنزع اسمه منها، ومريضٌ هو طبيبه المعالج يبقى بلا طبيب. حذفُ فواتيره معه كان سيُنقص إيراد المنشأة.",
  },
  {
    key: "items",
    label: "حذف كلّ الخدمات والأصناف",
    icon: Package,
    effect:
      "يُحذف كلّ ما في شاشة «أصناف المركز والخدمات»: الخدمات والمنتجات والأدوية، ومعها أسعارها وفروعها ومواردها وأكواد مطالباتها وعروضها وحركات مخزونها.",
    keeps:
      "سطور الفواتير القديمة تبقى بأسمائها المحفوظة ويُنزع ربطها بالصنف — فاتورةٌ تختفي لأنّ خدمتها حُذفت خطأٌ محاسبيّ لا تنظيف.",
  },
];

export default function DangerZoneTab() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organizationId = organization?.id;
  const organizationName = organization?.name ?? "";

  const isOwner =
    legacyMode || ["owner", "organization_admin"].includes(membership?.role_key ?? "");

  const [openKind, setOpenKind] = useState<PurgeKind | null>(null);
  const [preview, setPreview] = useState<PurgeRow[] | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const close = () => {
    setOpenKind(null);
    setPreview(null);
    setConfirmText("");
  };

  const call = async (kind: PurgeKind, dryRun: boolean) => {
    if (!organizationId) throw new Error("لا توجد منشأة نشطة");
    // اسمٌ حرفيّ لكلّ نداء — المدقّق لا يرى الاسم إن كان في متغيّر.
    // و`p_ids` تُترك فارغةً هنا: هذه الشاشة تُفرّغ المنشأة كلّها.
    const params = { p_organization_id: organizationId, p_dry_run: dryRun };
    const { data, error } =
      kind.key === "patients"
        ? await supabase.rpc("app_purge_patients", params)
        : kind.key === "doctors"
          ? await supabase.rpc("app_purge_doctors", params)
          : await supabase.rpc("app_purge_items", params);
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };

  const dryRun = useMutation({
    mutationFn: (kind: PurgeKind) => call(kind, true),
    onSuccess: (rows) => setPreview(rows),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر حساب ما سيُحذف",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  const execute = useMutation({
    mutationFn: (kind: PurgeKind) => call(kind, false),
    onSuccess: (rows) => {
      // كل شيء تقريبًا تغيّر — تبطيل شامل أصدق من تعداد مفاتيح لا تنتهي
      queryClient.invalidateQueries();
      const total = rows.find((r) => r.table_name.startsWith("──"))?.affected ?? 0;
      toast({ title: `تمّ الحذف — ${total} صفًّا رئيسيًّا` });
      close();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف — لم يتغيّر شيء",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  const busy = dryRun.isPending || execute.isPending;
  // التأكيد باسم المنشأة: نصٌّ يُكتب لا زرٌّ يُضغط
  const confirmed = confirmText.trim() === organizationName.trim() && organizationName !== "";

  if (!isOwner) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="py-4 text-sm text-amber-900">
          التفريغ لصاحب المنشأة أو مسؤولها وحدهما — والقاعدة تفرض ذلك أيضًا، فهذه الشاشة
          لا تُخفي ما تقبله القاعدة.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            منطقة الخطر — تفريغ بيانات التجربة
          </CardTitle>
          <CardDescription>
            لا تراجع بعد التنفيذ إلّا من نسخةٍ احتياطية. وكلّ زرٍّ يمسّ{" "}
            <span className="font-semibold">{organizationName || "المنشأة الحالية"}</span> وحدها —
            المنشأة الأخرى لا تُمسّ.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {KINDS.map((kind) => {
            const Icon = kind.icon;
            return (
              <div
                key={kind.key}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <div className="font-medium">{kind.label}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{kind.effect}</p>
                    <p className="mt-1 text-xs text-emerald-700">{kind.keeps}</p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => {
                    setOpenKind(kind);
                    setPreview(null);
                    setConfirmText("");
                    dryRun.mutate(kind);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {kind.label}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={Boolean(openKind)} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-destructive">{openKind?.label}</DialogTitle>
            <DialogDescription>
              هذه أعدادٌ حقيقية لا تقديرية: القاعدة نفّذت الحذف ثمّ تراجعت عنه، فما تراه هو ما
              سيقع بالضبط.
            </DialogDescription>
          </DialogHeader>

          {dryRun.isPending && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!dryRun.isPending && preview && (
            <>
              {preview.length <= 1 ? (
                <p className="rounded-md border bg-muted/40 p-3 text-sm">
                  لا شيء ليُحذف — المنشأة فارغة من هذا النوع أصلًا.
                </p>
              ) : (
                <div className="max-h-[40vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">الجدول</TableHead>
                        <TableHead className="text-right">الصفوف</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview
                        .filter((row) => !row.table_name.startsWith("──"))
                        .map((row) => (
                          <TableRow key={row.table_name}>
                            <TableCell className="font-mono text-xs">{row.table_name}</TableCell>
                            <TableCell className="tabular-nums">{row.affected}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {preview.length > 1 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-sm">
                    للتأكيد اكتب اسم المنشأة:{" "}
                    <span className="font-semibold">{organizationName}</span>
                  </Label>
                  <Input
                    value={confirmText}
                    placeholder={organizationName}
                    autoComplete="off"
                    onChange={(event) => setConfirmText(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    الحذف كلّه عبارةٌ واحدة: إن تعثّر جدولٌ واحد لم يتغيّر شيء.
                  </p>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={execute.isPending}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={!preview || preview.length <= 1 || !confirmed || execute.isPending}
              onClick={() => openKind && execute.mutate(openKind)}
            >
              {execute.isPending ? "جارٍ الحذف..." : "نعم، احذف نهائيًّا"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
