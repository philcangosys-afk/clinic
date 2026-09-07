import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Trash2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * الخانات الإجبارية لنماذج المطالبات (لقطة 87).
 *
 * جدول `insurance_form_field_requirements` موجود منذ 0005 بلا أي واجهة —
 * وكان آخر جدول في قائمة الثمانية التي رصدها التدقيق الأول بلا واجهة.
 *
 * الفائدة العملية: نماذج CCHI الثلاثة (UCAF/DCAF/OCAF) تختلف خاناتها
 * الإلزامية، وشركة التأمين ترفض النموذج الناقص. تعريف الخانات هنا يجعل نافذة
 * إنشاء النموذج **تُنشئها مسبقًا وتمنع الحفظ ناقصًا** — بدل أن يكتشف
 * المحاسب النقص بعد أسابيع مع خطاب الرفض.
 */
export const FORM_TYPES = [
  { value: "ucaf", label: "UCAF — نموذج موحّد" },
  { value: "dcaf", label: "DCAF — أسنان" },
  { value: "ocaf", label: "OCAF — بصريات" },
] as const;

export type FormRequirementRow = {
  id: string;
  form_type: string;
  field_key: string;
  field_type: "text" | "numeric";
  is_required: boolean;
};

export function useFormRequirements(organizationId: string | undefined, formType?: string) {
  return useQuery({
    queryKey: ["insurance-form-requirements", organizationId, formType ?? "all"],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("insurance_form_field_requirements")
        .select("id, form_type, field_key, field_type, is_required")
        .eq("organization_id", organizationId)
        .order("form_type")
        .order("field_key");
      if (formType) query = query.eq("form_type", formType);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as FormRequirementRow[];
    },
  });
}

export default function FormRequirementsTab({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const requirements = useFormRequirements(organizationId);
  const [formType, setFormType] = useState<string>("ucaf");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldType, setFieldType] = useState<"text" | "numeric">("text");
  const [isRequired, setIsRequired] = useState(true);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["insurance-form-requirements"] });

  const addRequirement = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const trimmed = fieldKey.trim();
      if (!trimmed) throw new Error("اكتب اسم الخانة");
      const { error } = await supabase.from("insurance_form_field_requirements").insert({
        organization_id: organizationId,
        form_type: formType,
        field_key: trimmed,
        field_type: fieldType,
        is_required: isRequired,
      });
      if (error) {
        // القيد الفريد (منشأة، نوع، خانة) — رسالة مفهومة بدل نص القيد الخام
        if (String(error.message).includes("duplicate") || String(error.message).includes("unique"))
          throw new Error("هذه الخانة معرَّفة مسبقًا لهذا النوع من النماذج");
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setFieldKey("");
      toast({ title: "تمت إضافة الخانة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  const toggleRequired = useMutation({
    mutationFn: async (row: FormRequirementRow) => {
      const { data, error } = await supabase
        .from("insurance_form_field_requirements")
        .update({ is_required: !row.is_required })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST — بلا الفحص تظهر رسالة نجاح كاذبة
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تحديث الإلزامية" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const removeRequirement = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("insurance_form_field_requirements")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف الخانة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: errorMessage(error),
      }),
  });

  const rows = requirements.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          خانات نماذج المطالبات
        </CardTitle>
        <CardDescription>
          تُنشأ هذه الخانات مسبقًا في نافذة إنشاء النموذج، والإلزامية منها تمنع الحفظ ناقصًا
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            نماذج CCHI الثلاثة تختلف خاناتها الإلزامية، وشركة التأمين ترفض النموذج الناقص.
            تعريفها هنا يمنع إرسال نموذج ناقص بدل اكتشاف النقص بعد أسابيع مع خطاب الرفض.
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع النموذج</Label>
            <Select value={formType} onValueChange={setFormType}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم الخانة</Label>
            <Input
              className="w-56"
              value={fieldKey}
              onChange={(e) => setFieldKey(e.target.value)}
              placeholder="مثال: رقم الموافقة المسبقة"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={fieldType} onValueChange={(value) => setFieldType(value as "text" | "numeric")}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">نصّي</SelectItem>
                <SelectItem value="numeric">رقمي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />
            إلزامية
          </label>
          <Button disabled={addRequirement.isPending || !fieldKey.trim()} onClick={() => addRequirement.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>

        {requirements.isLoading && <Skeleton className="h-24 w-full" />}
        {!requirements.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النموذج</TableHead>
                <TableHead>الخانة</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الإلزامية</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs uppercase">{row.form_type}</TableCell>
                  <TableCell className="font-medium">{row.field_key}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.field_type === "numeric" ? "رقمي" : "نصّي"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => toggleRequired.mutate(row)}>
                      <Badge variant={row.is_required ? "default" : "secondary"}>
                        {row.is_required ? "إلزامية" : "اختيارية"}
                      </Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => removeRequirement.mutate(row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد خانات معرَّفة — النماذج ستُنشأ بخانات حرة فقط.
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
