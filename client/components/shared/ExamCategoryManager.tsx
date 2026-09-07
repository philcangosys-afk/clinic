import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FolderTree } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * تصنيفات فحوصات المختبر والأشعة.
 *
 * جدولا `lab_test_categories` و`radiology_exam_categories` موجودان منذ 0013
 * و0014، و`lab_tests.category_id` / `radiology_exams.category_id` يشيران
 * إليهما — بلا أي واجهة، فكان عمود التصنيف فارغًا في كل صف وكتالوج بمئات
 * الفحوصات يُعرض قائمة واحدة غير مصنّفة.
 *
 * الجدولان متطابقان في البنية تمامًا، فمكوّن واحد يخدمهما — بناء شاشتين
 * متطابقتين كان سيضاعف موضع أي إصلاح لاحق.
 */
export type CategoryTable = "lab_test_categories" | "radiology_exam_categories";

export type CategoryRow = {
  id: string;
  organization_id: string | null;
  name_ar: string;
  name_en: string | null;
  sort_order: number;
  /** صف عام مشترك بين كل المنشآت — يُقرأ ولا يُعدَّل ولا يُحذف */
  isGlobal: boolean;
};

/** الجدول الذي يستهلك التصنيف — لمعرفة كم فحصًا يستعمله قبل الحذف. */
/**
 * مفتاح استعلام الشاشة التي تقرأ هذه التصنيفات — لا اسم الجدول.
 *
 * كان يحمل اسم الجدول (`lab_tests`) ومفتاح الاستعلام في شاشة المختبر
 * `["lab-tests", org]`، فلا يتطابقان: يُضيف الموظّف تصنيفًا ولا يظهر في قائمة
 * الفحوص حتى يُحدِّث الصفحة.
 */
const CONSUMER: Record<CategoryTable, string> = {
  lab_test_categories: "lab-tests",
  radiology_exam_categories: "radiology-exams",
};

/**
 * التصنيفات العامة (`organization_id is null`) **وتصنيفات المنشأة** معًا.
 *
 * **خلل حقيقي كان قائمًا**: التقييد بـ `.eq("organization_id", ...)` وحده كان
 * يُخفي الـ16 تصنيفًا المزروعة في 0013 و0014 (10 مختبر + 6 أشعة) رغم أن سياسة
 * القراءة تسمح بها صراحةً (`organization_id is null or app_is_member(...)`).
 * النتيجة: شاشة تقول "لا توجد تصنيفات" وتصنيفات موجودة فعلًا، وقائمة اختيار
 * التصنيف في نموذج الفحص لا تعرض إلا "بلا تصنيف" — وهو بعينه العيب الذي
 * يَعِد رأس هذا الملف بإصلاحه.
 *
 * (هذا تكرار لخطأ سبق أن أصلحتُه في `lookup_values` — نفس النمط: صفوف عامة
 * مزروعة يُخفيها فلتر المؤسسة.)
 */
export function useExamCategories(table: CategoryTable, organizationId: string | undefined) {
  return useQuery({
    queryKey: [table, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("id, organization_id, name_ar, name_en, sort_order")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return ((data ?? []) as Omit<CategoryRow, "isGlobal">[]).map((row) => ({
        ...row,
        isGlobal: row.organization_id === null,
      }));
    },
  });
}

/** قائمة منسدلة جاهزة لاختيار التصنيف في نماذج إنشاء الفحوصات. */
export function ExamCategorySelect({
  table,
  value,
  onChange,
  placeholder = "بلا تصنيف",
}: {
  table: CategoryTable;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { organization } = useOrganizationAccess();
  const categories = useExamCategories(table, organization?.id);
  return (
    <Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {(categories.data ?? []).map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {category.name_ar}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function ExamCategoryManager({
  table,
  title,
  description,
}: {
  table: CategoryTable;
  title: string;
  description: string;
}) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const categories = useExamCategories(table, organization?.id);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [table] });
    queryClient.invalidateQueries({ queryKey: [CONSUMER[table]] });
  };

  /** عدد الفحوصات المرتبطة بكل تصنيف — يُعرض ويمنع حذفًا يُفقد الربط. */
  const usage = useQuery({
    queryKey: [`${table}-usage`, organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      // يشمل الفحوصات المرتبطة بتصنيف عام أيضًا: العدّ معروض لكل صف، وتقييده
      // بتصنيفات المنشأة كان سيُظهر صفرًا أمام تصنيف عام تستعمله عشرات الفحوص.
      const { data, error } = await supabase
        .from(table === "lab_test_categories" ? "lab_tests" : "radiology_exams")
        .select("category_id")
        .eq("organization_id", organization?.id)
        .not("category_id", "is", null);
      if (error) throw error;
      const counts = new Map<string, number>();
      ((data ?? []) as { category_id: string }[]).forEach((row) =>
        counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1),
      );
      return counts;
    },
  });

  const addCategory = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const trimmed = nameAr.trim();
      if (!trimmed) throw new Error("اكتب اسم التصنيف");
      const { error } = await supabase.from(table).insert({
        organization_id: organization.id,
        name_ar: trimmed,
        name_en: nameEn.trim() || null,
        sort_order: (categories.data?.length ?? 0) * 10 + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setNameAr("");
      setNameEn("");
      toast({ title: "تمت إضافة التصنيف" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: errorMessage(error),
      }),
  });

  const removeCategory = useMutation({
    mutationFn: async (row: CategoryRow) => {
      // التصنيف العام مشترك بين كل المنشآت — حذفه من هنا يحذفه للجميع.
      // القاعدة تمنعه أيضًا (0046) لكن الرسالة هنا أوضح من فشل صامت.
      if (row.isGlobal) throw new Error("هذا تصنيف عام مشترك — لا يمكن حذفه من منشأة واحدة");
      const inUse = usage.data?.get(row.id) ?? 0;
      /**
       * الحذف ممنوع ما دام التصنيف مستعمَلًا. المفتاح الأجنبي في 0013/0014
       * قد يسمح بالحذف مع `on delete set null` — فتفقد عشرات الفحوصات
       * تصنيفها دفعةً واحدة بلا طريقة استرجاع. المنع هنا أوضح للمستخدم من
       * اكتشاف الفقد لاحقًا.
       */
      if (inUse > 0)
        throw new Error(
          `التصنيف مستعمَل في ${inUse} فحصًا — غيّر تصنيفها أولًا حتى لا تفقد ربطها`,
        );
      const { data, error } = await supabase.from(table).delete().eq("id", row.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("لم يُحذف شيء — الحذف مقيَّد بصفة مالك المنشأة أو مدير النظام");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف التصنيف" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: errorMessage(error),
      }),
  });

  const rows = categories.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderTree className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم التصنيف</Label>
            <Input className="w-56" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بالإنجليزي (اختياري)</Label>
            <Input className="w-48" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </div>
          <Button disabled={addCategory.isPending || !nameAr.trim()} onClick={() => addCategory.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>

        {categories.isLoading && <Skeleton className="h-24 w-full" />}
        {!categories.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>بالإنجليزي</TableHead>
                <TableHead>عدد الفحوصات</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const inUse = usage.data?.get(row.id) ?? 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.name_ar}
                      {row.isGlobal && (
                        <span className="ms-2 text-[10px] text-muted-foreground">(عام)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">
                      {row.name_en ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{inUse}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={inUse > 0 || row.isGlobal}
                        title={
                          row.isGlobal
                            ? "تصنيف عام مشترك بين كل المنشآت"
                            : inUse > 0
                              ? "التصنيف مستعمَل — غيّر تصنيف الفحوصات أولًا"
                              : "حذف"
                        }
                        onClick={() => removeCategory.mutate(row)}
                      >
                        <Trash2
                          className={`h-4 w-4 ${inUse > 0 || row.isGlobal ? "text-muted-foreground" : "text-destructive"}`}
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد تصنيفات بعد — أضف تصنيفًا لتنظيم الكتالوج.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
