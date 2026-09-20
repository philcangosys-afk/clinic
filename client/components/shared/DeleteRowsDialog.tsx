import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type PurgeEntity = "patients" | "doctors" | "items";

type PurgeRow = { table_name: string; affected: number };

/**
 * نصّ التحذير لكل نوع — **ما يُحذف وما يبقى**، لا «هل أنت متأكد؟».
 *
 * سؤالٌ بلا معلومة لا يُنتج قرارًا: المستخدم يضغط «نعم» لأنّه ضغط الزرّ قبل
 * لحظة. والذي يُغيّر القرار هو معرفةُ ما سيختفي وما لن يختفي.
 */
const COPY: Record<PurgeEntity, { noun: string; effect: string; keeps: string }> = {
  patients: {
    noun: "مريض",
    effect:
      "يُحذف الملفّ كاملًا ومعه زياراته ومواعيده وفواتيره وسنداته ووصفاته وتحاليله وأشعّته واتفاقياته ومحفظته ومستنداته.",
    keeps: "لا تُمسّ فواتير العملاء الخارجيين ولا سندٌ لا مريضَ له.",
  },
  doctors: {
    noun: "طبيب",
    effect:
      "تُحذف بطاقته وجدوله ودوامه وفروعه وعياداته وخدماته، ومواعيده — الموعد بلا طبيب لا وجود له في المخطط.",
    keeps:
      "تاريخ المنشأة يبقى: فاتورةٌ أصدرها تبقى بمبلغها ويُنزع اسمه منها، ومريضٌ هو طبيبه المعالج يبقى بلا طبيب.",
  },
  items: {
    noun: "صنف",
    effect:
      "يُحذف الصنف ومعه أسعاره وفروعه وموارده وأكواد مطالباته وعروضه وحركات مخزونه.",
    keeps:
      "سطور الفواتير القديمة تبقى بأسمائها المحفوظة ويُنزع ربطها بالصنف — فاتورةٌ تختفي لأنّ خدمتها حُذفت خطأٌ محاسبيّ لا تنظيف.",
  },
};

/** فوق هذا العدد يُطلَب تأكيدٌ مكتوب: حذف صفٍّ سهوًا غير حذف أربعين. */
const TYPED_CONFIRM_FROM = 5;

/**
 * حذف صفوفٍ محدَّدة — مريضًا أو طبيبًا أو صنفًا.
 *
 * **الأعداد التي تُعرض حقيقية لا تقديرية:** القاعدة تُنفّذ الحذف داخل نقطة
 * حفظ ثمّ تتراجع عنه، فما في الجدول هو ما سيقع بالضبط. وتقديرٌ مكتوبٌ في
 * الواجهة كان سيفترق عن الواقع أوّل ما يُضاف جدولٌ جديد.
 *
 * **والتأكيد يتناسب مع الأثر:** صفٌّ أو صفّان زرٌّ صريح، وخمسةٌ فأكثر كتابةُ
 * كلمة. تأكيدٌ ثقيلٌ على كل حذفٍ يُدرَّب المستخدم على تجاوزه بلا قراءة.
 */
export default function DeleteRowsDialog({
  entity,
  ids,
  names,
  open,
  onOpenChange,
  onDeleted,
}: {
  entity: PurgeEntity;
  ids: string[];
  /** أسماء ما سيُحذف — تُعرض ليرى المستخدم أنّه حدّد ما قصد. */
  names?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const copy = COPY[entity];

  const [preview, setPreview] = useState<PurgeRow[] | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const call = async (dryRun: boolean) => {
    if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
    if (ids.length === 0) throw new Error("لم تُحدَّد صفوف");
    /**
     * ثلاثة نداءات باسمٍ حرفيّ لا نداءٌ باسمٍ من متغيّر.
     *
     * `completeness-audit` يقرأ اسم الدالّة من النداء نفسه حين يكون نصًّا
     * حرفيًّا، ولا يقرؤه إن جاء من متغيّر — فاسمٌ في متغيّرٍ يجعل الدالّة
     * تبدو ميتةً وهي تُنادى. والمدقّق الذي يكذب مرّةً يُتجاوَز يومًا يكون
     * فيه محقًّا.
     *
     * (وقد بلّغ المدقّق عن دالّةٍ اسمها «اسم» حين كُتب المثال هنا حرفيًّا —
     *  فحتى التعليق يُقرأ.)
     */
    const params = {
      p_organization_id: organization.id,
      p_ids: ids,
      p_dry_run: dryRun,
    };
    const { data, error } =
      entity === "patients"
        ? await supabase.rpc("app_purge_patients", params)
        : entity === "doctors"
          ? await supabase.rpc("app_purge_doctors", params)
          : await supabase.rpc("app_purge_items", params);
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };

  const dryRun = useMutation({
    mutationFn: () => call(true),
    onSuccess: setPreview,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر حساب ما سيُحذف",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  const execute = useMutation({
    mutationFn: () => call(false),
    onSuccess: () => {
      // الحذف يمسّ جداول كثيرة — تبطيل شامل أصدق من تعداد مفاتيح لا تنتهي
      queryClient.invalidateQueries();
      toast({ title: `تمّ حذف ${ids.length} ${copy.noun}` });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف — لم يتغيّر شيء",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  // التجربة تبدأ مع الفتح: التحذير بلا أعدادٍ نصفُ تحذير
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setConfirmText("");
      return;
    }
    if (ids.length > 0) dryRun.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids.join(",")]);

  const needsTyped = ids.length >= TYPED_CONFIRM_FROM;
  const confirmed = !needsTyped || confirmText.trim() === "حذف";
  const rows = (preview ?? []).filter((row) => !row.table_name.startsWith("──"));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            حذف {ids.length} {copy.noun} نهائيًّا
          </DialogTitle>
          <DialogDescription>لا تراجع بعد التنفيذ إلّا من نسخةٍ احتياطية.</DialogDescription>
        </DialogHeader>

        {names && names.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="mb-1 font-medium">المحدَّد:</div>
            <div className="max-h-24 overflow-y-auto text-xs text-muted-foreground">
              {names.slice(0, 40).join(" · ")}
              {names.length > 40 && ` … و${names.length - 40} غيرهم`}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="text-destructive">{copy.effect}</div>
          <div className="text-emerald-700">{copy.keeps}</div>
        </div>

        {dryRun.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        )}

        {!dryRun.isPending && preview && (
          <>
            <div>
              <div className="mb-1 text-sm font-medium">ما سيتغيّر فعلًا:</div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا شيء مرتبط — الحذف نظيف.</p>
              ) : (
                <div className="max-h-[35vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">الجدول</TableHead>
                        <TableHead className="text-right">الصفوف</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.table_name}>
                          <TableCell className="font-mono text-xs">{row.table_name}</TableCell>
                          <TableCell className="tabular-nums">{row.affected}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                أعدادٌ حقيقية: القاعدة نفّذت الحذف ثمّ تراجعت عنه. و«تُفرَّغ» تعني أنّ الصفّ يبقى
                ويُنزع منه الربط.
              </p>
            </div>

            {needsTyped && (
              <div className="flex flex-col gap-2">
                <Label className="text-sm">
                  للتأكيد اكتب كلمة <span className="font-semibold">حذف</span>
                </Label>
                <Input
                  value={confirmText}
                  placeholder="حذف"
                  autoComplete="off"
                  onChange={(event) => setConfirmText(event.target.value)}
                />
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={execute.isPending}
          >
            إلغاء
          </Button>
          <Button
            variant="destructive"
            disabled={!preview || !confirmed || execute.isPending}
            onClick={() => execute.mutate()}
          >
            {execute.isPending ? "جارٍ الحذف..." : "نعم، احذف نهائيًّا"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * تحديد صفوف جدول — منطقٌ واحد لثلاث شاشات.
 *
 * كُتب مرّةً لأنّ «حدِّد الكلّ» و«اقلب صفًّا» و«أفرغ التحديد بعد الحذف» ثلاثة
 * أسطرٍ تُكتب خطأً بثلاث طرقٍ في ثلاث شاشات.
 */
export function useRowSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = (ids: string[]) =>
    setSelected((prev) => (ids.every((id) => prev.includes(id)) ? [] : ids));
  const clear = () => setSelected([]);
  const isSelected = (id: string) => selected.includes(id);
  return { selected, toggle, toggleAll, clear, isSelected };
}
