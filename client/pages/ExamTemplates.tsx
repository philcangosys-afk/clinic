import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Plus, Pencil, Copy, Trash2, GripVertical } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import {
  EXAM_FIELD_LABELS,
  examFieldLabel,
  type ExamTemplateSchema,
  type ExamTemplateSection,
} from "@/lib/exam-template-fields";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

/**
 * مصمم شاشات العيادات (لقطة 15 — موصوفة في المواصفة بأنها "مهمة جدًا").
 *
 * جدول `clinic_exam_templates` موجود منذ 0006 ويُقرأ فعليًا في شاشة السجل
 * الطبي لبناء نموذج الفحص ديناميكيًا، لكن لم توجد أي واجهة لإنشاء قالب أو
 * تعديله — كانت القوالب تُزرع يدويًا عبر SQL فقط، فلا يستطيع صاحب المنشأة
 * تخصيص شاشة فحص لتخصص جديد بلا تدخل مبرمج.
 *
 * قرار مهم: القوالب العامة (organization_id = null) لا تُعدَّل ولا تُحذف من
 * هنا — تُنسَخ أولًا لتصبح ملكًا للمؤسسة ثم تُعدَّل النسخة. السبب أن القوالب
 * العامة مشتركة بين كل المؤسسات، وتعديلها من مؤسسة واحدة كان سيغيّر شاشات
 * الفحص لدى الجميع.
 */
const CANVAS_LABELS: Record<string, string> = {
  none: "بلا لوحة",
  dental_chart: "لوحة أسنان",
  body_diagram: "مخطط جسم",
};

const SECTION_TYPE_LABELS: Record<ExamTemplateSection["type"], string> = {
  text: "حقل نصي قصير",
  textarea: "حقل نصي طويل",
  diagnosis: "التشخيص (ICD-10)",
  group: "مجموعة حقول",
};

type TemplateRow = {
  id: string;
  organization_id: string | null;
  specialty_code: string;
  name_ar: string;
  name_en: string | null;
  note: string | null;
  canvas_type: string;
  schema_definition: ExamTemplateSchema;
  is_disabled: boolean;
};

function useTemplates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["exam-templates-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_exam_templates")
        .select("*")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("specialty_code");
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });
}

function emptySchema(): ExamTemplateSchema {
  return { sections: [] };
}

/**
 * قائمة أنواع العيادات المزروعة في 0006 — تُعرض كاقتراحات لكود التخصص.
 * تُبقى كقائمة اقتراحات لا قائمة مغلقة: `specialty_code` عمود نصّي حر، ومنشأة
 * لها تخصص خارج هذه القائمة يجب ألّا تُمنع من إنشاء قالب له.
 */
const CLINIC_TYPE_SUGGESTIONS: { code: string; label: string }[] = [
  { code: "gp", label: "الطبيب العام" },
  { code: "internal", label: "الباطنية" },
  { code: "derma", label: "الجلدية" },
  { code: "emergency", label: "الطوارئ" },
  { code: "gynecology", label: "النساء والولادة" },
  { code: "pediatrician", label: "الأطفال" },
  { code: "physical_therapy", label: "العلاج الطبيعي" },
  { code: "urologist", label: "المسالك البولية" },
  { code: "xray", label: "الأشعة" },
  { code: "simple_dental", label: "الأسنان البسيطة" },
  { code: "endocrine", label: "السكر والغدد" },
  { code: "ent", label: "الأنف والأذن والحنجرة" },
  { code: "orthopedic", label: "العظمية" },
  { code: "digestive", label: "الجهاز الهضمي" },
  { code: "nutrition", label: "التغذية" },
  { code: "neurosurgery", label: "المخ والأعصاب" },
  { code: "respiratory", label: "الصدرية" },
  { code: "psychiatry", label: "الطب النفسي" },
  { code: "kidney", label: "أمراض الكلى" },
  { code: "ophthalmologist", label: "العيون" },
];

function TemplateEditor({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: TemplateRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const allTemplates = useTemplates(organizationId);
  const [specialtyCode, setSpecialtyCode] = useState(initial?.specialty_code ?? "");
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [canvasType, setCanvasType] = useState(initial?.canvas_type ?? "none");
  const [schema, setSchema] = useState<ExamTemplateSchema>(
    initial?.schema_definition?.sections ? initial.schema_definition : emptySchema(),
  );

  const addSection = (type: ExamTemplateSection["type"]) => {
    const key = `section_${Date.now()}`;
    const base = { key, label_ar: "قسم جديد" };
    const section: ExamTemplateSection =
      type === "group" ? { ...base, type: "group", fields: [] } : { ...base, type };
    setSchema((prev) => ({ sections: [...prev.sections, section] }));
  };

  const updateSection = (index: number, patch: Partial<ExamTemplateSection>) =>
    setSchema((prev) => ({
      sections: prev.sections.map((section, i) =>
        i === index ? ({ ...section, ...patch } as ExamTemplateSection) : section,
      ),
    }));

  const removeSection = (index: number) =>
    setSchema((prev) => ({ sections: prev.sections.filter((_, i) => i !== index) }));

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= schema.sections.length) return;
    const sections = [...schema.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    setSchema({ sections });
  };

  /**
   * نسخ أقسام قالب آخر إلى هذا القالب (لقطة 115).
   *
   * الأقسام تُلحَق ولا تستبدل القائم — الاستبدال يمحو عمل المستخدم بضغطة.
   * ومفاتيح الأقسام تُعاد توليدها: مفتاح مكرَّر في نفس القالب يجعل قيمتين
   * مختلفتين في `patient_visits.exam_data` تتنافسان على نفس المفتاح فتضيع
   * إحداهما بلا أثر.
   */
  const copySectionsFrom = (source: TemplateRow) => {
    const existing = new Set(schema.sections.map((section) => section.key));
    const incoming = (source.schema_definition?.sections ?? []).map((section, index) => {
      let key = section.key;
      if (existing.has(key)) key = `${section.key}_copy_${index + 1}`;
      existing.add(key);
      return { ...section, key } as ExamTemplateSection;
    });
    if (incoming.length === 0) {
      toast({ variant: "destructive", title: "القالب المصدر لا يحوي أقسامًا" });
      return;
    }
    setSchema((prev) => ({ sections: [...prev.sections, ...incoming] }));
    toast({ title: `أُضيف ${incoming.length} قسمًا من "${source.name_ar}"` });
  };

  const toggleGroupField = (index: number, fieldKey: string) => {
    const section = schema.sections[index];
    if (section.type !== "group") return;
    const fields = section.fields.includes(fieldKey)
      ? section.fields.filter((f) => f !== fieldKey)
      : [...section.fields, fieldKey];
    updateSection(index, { fields } as Partial<ExamTemplateSection>);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!specialtyCode.trim()) throw new Error("كود التخصص مطلوب");
      if (!nameAr.trim()) throw new Error("الاسم العربي مطلوب");
      // كود التخصص يربط القالب بقيمة specialty_code في lookup_values، فيجب أن
      // يبقى بالحروف اللاتينية الصغيرة بلا مسافات ليطابق ما تقرأه شاشة الفحص.
      if (!/^[a-z0-9_]+$/.test(specialtyCode.trim()))
        throw new Error("كود التخصص يجب أن يكون حروفًا لاتينية صغيرة وأرقامًا وشرطة سفلية فقط");

      const payload = {
        organization_id: organizationId,
        specialty_code: specialtyCode.trim(),
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        note: note.trim() || null,
        canvas_type: canvasType,
        schema_definition: schema,
        updated_at: new Date().toISOString(),
      };

      // القوالب العامة تُنسَخ ولا تُعدَّل (انظر التعليق أعلى الملف)
      const isEditingOwn = initial && initial.organization_id === organizationId;
      if (isEditingOwn) {
        const { data: affectedRows, error } = await supabase
          .from("clinic_exam_templates")
          .update(payload)
          .eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("clinic_exam_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates-admin"] });
      queryClient.invalidateQueries({ queryKey: ["exam-template"] });
      toast({ title: "تم حفظ القالب" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description:
          error instanceof Error
            ? error.message.includes("duplicate") || error.message.includes("unique")
              ? "يوجد قالب بنفس كود التخصص في مؤسستك — عدّله بدل إنشاء قالب جديد"
              : error.message
            : "حدث خطأ غير متوقع",
      }),
  });

  const isGlobalSource = initial && initial.organization_id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initial ? (isGlobalSource ? "نسخ وتخصيص قالب عام" : "تعديل القالب") : "قالب فحص جديد"}
          </DialogTitle>
          <DialogDescription>
            الأقسام التي تضيفها هنا هي ما يراه الطبيب في شاشة الفحص لهذا التخصص
          </DialogDescription>
        </DialogHeader>

        {isGlobalSource && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            هذا قالب عام مشترك بين كل المنشآت — سيُحفظ كنسخة خاصة بمنشأتك وتبقى النسخة العامة كما هي.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>كود التخصص *</Label>
            <Input
              value={specialtyCode}
              onChange={(e) => setSpecialtyCode(e.target.value)}
              placeholder="derma"
              dir="ltr"
              list="clinic-type-suggestions"
            />
            {/* datalist لا Select: العمود نصّي حر، وقائمة مغلقة كانت ستمنع
                منشأة لها تخصص خارج هذه القائمة من إنشاء قالب له. */}
            <datalist id="clinic-type-suggestions">
              {CLINIC_TYPE_SUGGESTIONS.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.label}
                </option>
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              اكتب أو اختر من الأنواع المعروفة —{" "}
              {CLINIC_TYPE_SUGGESTIONS.slice(0, 4)
                .map((type) => type.label)
                .join("، ")}
              ، وغيرها.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع اللوحة</Label>
            <Select value={canvasType} onValueChange={setCanvasType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CANVAS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم العربي *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم الإنجليزي</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">أقسام شاشة الفحص</p>
            <div className="flex flex-wrap items-center gap-1">
              <Select
                value=""
                onValueChange={(id) => {
                  const source = (allTemplates.data ?? []).find((row) => row.id === id);
                  if (source) copySectionsFrom(source);
                }}
              >
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="نسخ أقسام من قالب آخر" />
                </SelectTrigger>
                <SelectContent>
                  {(allTemplates.data ?? [])
                    .filter((row) => row.id !== initial?.id)
                    .map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name_ar}
                        {row.organization_id === null ? " (عام)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {(Object.keys(SECTION_TYPE_LABELS) as ExamTemplateSection["type"][]).map((type) => (
                <Button key={type} size="sm" variant="outline" onClick={() => addSection(type)}>
                  <Plus className="h-3.5 w-3.5" />
                  {SECTION_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </div>

          {schema.sections.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لم تُضف أقسام بعد — أضف قسمًا واحدًا على الأقل ليظهر النموذج للطبيب.
            </p>
          )}

          {schema.sections.map((section, index) => (
            <div key={section.key} className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  className="h-8 max-w-xs"
                  value={section.label_ar}
                  onChange={(e) => updateSection(index, { label_ar: e.target.value })}
                />
                <Badge variant="secondary">{SECTION_TYPE_LABELS[section.type]}</Badge>
                <div className="ms-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveSection(index, -1)} disabled={index === 0}>
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === schema.sections.length - 1}
                  >
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSection(index)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {section.type === "group" && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(EXAM_FIELD_LABELS).map((fieldKey) => {
                    const active = section.fields.includes(fieldKey);
                    return (
                      <button
                        key={fieldKey}
                        type="button"
                        onClick={() => toggleGroupField(index, fieldKey)}
                        className={
                          active
                            ? "rounded-full border border-primary bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                            : "rounded-full border border-input bg-background px-2.5 py-1 text-xs hover:border-primary"
                        }
                      >
                        {examFieldLabel(fieldKey)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ القالب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExamTemplates() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const templates = useTemplates(organization?.id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: async (row: TemplateRow) => {
      if (row.organization_id === null) throw new Error("لا يمكن تعطيل قالب عام — انسخه أولًا");
      const { data: affectedRows, error } = await supabase
        .from("clinic_exam_templates")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates-admin"] });
      toast({ title: "تم تحديث حالة القالب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تصميم شاشات العيادات</h1>
          <p className="text-sm text-muted-foreground">
            قوالب نموذج الفحص لكل تخصص — تحدد ما يراه الطبيب في شاشة السجل الطبي
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          قالب جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4" />
            القوالب
          </CardTitle>
          <CardDescription>
            القوالب العامة مشتركة بين كل المنشآت — انسخها لتخصيصها دون التأثير على غيرك
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.isLoading && <Skeleton className="h-40 w-full" />}
          {!templates.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التخصص</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>اللوحة</TableHead>
                  <TableHead>الأقسام</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead className="w-36">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(templates.data ?? []).map((row) => {
                  const isGlobal = row.organization_id === null;
                  const sectionCount = row.schema_definition?.sections?.length ?? 0;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.specialty_code}</TableCell>
                      <TableCell className="font-medium">{row.name_ar}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {CANVAS_LABELS[row.canvas_type] ?? row.canvas_type}
                      </TableCell>
                      <TableCell className="tabular-nums">{sectionCount}</TableCell>
                      <TableCell>
                        <Badge variant={isGlobal ? "secondary" : "success"}>
                          {isGlobal ? "عام" : "خاص بالمنشأة"}
                        </Badge>
                        {row.is_disabled && (
                          <Badge variant="destructive" className="ms-1">
                            معطّل
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title={isGlobal ? "نسخ وتخصيص" : "تعديل"}
                            onClick={() => {
                              setEditing(row);
                              setEditorOpen(true);
                            }}
                          >
                            {isGlobal ? (
                              <Copy className="h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          {!isGlobal && (
                            <Button variant="ghost" size="sm" onClick={() => toggleDisabled.mutate(row)}>
                              {row.is_disabled ? "تفعيل" : "تعطيل"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(templates.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد قوالب.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editorOpen && (
        <TemplateEditor
          key={editing?.id ?? "new"}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
    </div>
  );
}
