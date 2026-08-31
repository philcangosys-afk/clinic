import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileStack, GripVertical, Layers, Plus, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import LookupSelect from "@/components/shared/LookupSelect";

/**
 * مصمّم نماذج الفحص السريري — المرحلة الخامسة.
 *
 * قبل 0085 كان النموذج كله في عمود `schema_definition jsonb` واحد، بأربعة
 * أنواع حقول ولا وحدات ولا إلزام ولا إظهار شرطي ولا إصدارات. وغياب
 * الإصدارات أخطر مما يبدو: تعديل نموذج مستعمَل كان **يغيّر معنى الزيارات
 * القديمة** — حقلٌ أُعيدت تسميته تُقرأ إجابته القديمة بالعنوان الجديد.
 *
 * الآن: أقسامٌ وحقولٌ وخيارات في جداول، و`schema_definition` يُبنى منها
 * تلقائيًا (فلا يفترق التمثيلان)، والزيارة تلتقط نسخة النموذج وقتها.
 */

const NONE = "__none__";

const FIELD_TYPES: Record<string, string> = {
  text: "نصّ",
  textarea: "نصّ طويل",
  number: "رقم",
  date: "تاريخ",
  time: "وقت",
  select: "قائمة اختيار",
  multi_select: "اختيار متعدّد",
  checkbox: "مربّع تأشير",
  radio: "اختيار واحد",
  yes_no: "نعم / لا",
  measurement: "قياس بوحدة",
  clinical_code: "كود سريري",
  body_map: "خريطة الجسم",
  file: "مرفق",
};

/** الأنواع التي تحتاج قائمة خيارات. */
const NEEDS_OPTIONS = new Set(["select", "multi_select", "radio"]);

export default function ExamTemplates() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const organizationId = organization?.id;
  const canManage = can("exam_templates.manage");
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);

  const templates = useQuery({
    queryKey: ["exam-templates", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_exam_templates")
        .select(
          "id, name_ar, name_en, specialty_code, specialty_value_id, specialty_name, clinic_id, clinic_name, canvas_type, version, parent_template_id, effective_from, is_disabled, section_count, field_count, usage_count",
        )
        .eq("organization_id", organizationId)
        .order("name_ar")
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const visible = useMemo(
    () => (templates.data ?? []).filter((row) => showDisabled || !row.is_disabled),
    [templates.data, showDisabled],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">نماذج الفحص السريري</h1>
          <p className="text-sm text-muted-foreground">
            نموذجٌ لكل تخصص بأقسامه وحقوله. الزيارة تحتفظ بنسخة النموذج المستعمَلة وقتها.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            نموذج جديد
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showDisabled} onCheckedChange={setShowDisabled} />
            عرض النسخ المعطَّلة والقديمة
          </label>
          <CardDescription>{visible.length} نموذج</CardDescription>
        </CardHeader>
        <CardContent>
          {templates.isLoading && <Skeleton className="h-32 w-full" />}
          {templates.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر التحميل: {(templates.error as Error)?.message}
            </p>
          )}
          {!templates.isLoading && !templates.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النموذج</TableHead>
                  <TableHead>التخصص</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الإصدار</TableHead>
                  <TableHead>الأقسام</TableHead>
                  <TableHead>الحقول</TableHead>
                  <TableHead>الاستعمال</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id} className={row.is_disabled ? "text-muted-foreground" : ""}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <FileStack className="h-4 w-4 text-muted-foreground" />
                        {row.name_ar}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.specialty_name ?? row.specialty_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.clinic_name ?? "كل العيادات"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">v{row.version}</Badge>
                    </TableCell>
                    <TableCell>{row.section_count}</TableCell>
                    <TableCell>{row.field_count}</TableCell>
                    <TableCell>
                      {row.usage_count > 0 ? (
                        <Badge variant="secondary" title="عدد الزيارات التي استعملت هذا النموذج">
                          {row.usage_count} زيارة
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_disabled ? "secondary" : "success"}>
                        {row.is_disabled ? "معطَّل" : "مفعَّل"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row.id)}>
                        <Layers className="h-4 w-4" />
                        البناء
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا نماذج. أنشئ نموذجًا واربطه بتخصص، ثم أضف أقسامه وحقوله.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewTemplateDialog
        open={createOpen}
        organizationId={organizationId}
        onClose={() => setCreateOpen(false)}
      />
      <TemplateBuilderDialog
        templateId={selected}
        organizationId={organizationId}
        canManage={canManage}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function NewTemplateDialog({
  open,
  organizationId,
  onClose,
}: {
  open: boolean;
  organizationId: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ canvas_type: "none" });

  const clinics = useQuery({
    queryKey: ["tpl-clinics", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_clinic_summary")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!String(form.name_ar ?? "").trim()) throw new Error("اسم النموذج مطلوب");
      const { error } = await supabase.from("clinic_exam_templates").insert({
        organization_id: organizationId,
        name_ar: String(form.name_ar).trim(),
        name_en: String(form.name_en ?? "").trim() || null,
        specialty_code: String(form.specialty_code ?? "").trim() || null,
        specialty_value_id: form.specialty_value_id || null,
        clinic_id: form.clinic_id || null,
        canvas_type: form.canvas_type ?? "none",
        schema_definition: { sections: [] },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates"] });
      toast({ title: "أُنشئ النموذج", description: "أضف أقسامه وحقوله من زر «البناء»." });
      setForm({ canvas_type: "none" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإنشاء",
        description:
          error instanceof Error && error.message.includes("uq_exam_template_active_specialty")
            ? "يوجد نموذج مفعَّل لهذا التخصص — عطّله أو اختر تخصصًا آخر"
            : error instanceof Error
              ? error.message
              : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>نموذج فحص جديد</DialogTitle>
          <DialogDescription>
            نموذجٌ مفعَّل واحد لكل تخصص. النسخ القديمة تبقى معطَّلة ولا تُحذف.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={form.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={form.name_en ?? ""} dir="ltr" onChange={(e) => set("name_en", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect
              categoryKey="medical_specialties"
              value={form.specialty_value_id ?? ""}
              onChange={(value) => set("specialty_value_id", value)}
              placeholder="بدون تخصص"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رمز التخصص (للتوافق مع القوالب القديمة)</Label>
            <Input
              value={form.specialty_code ?? ""}
              dir="ltr"
              placeholder="general, dental, occupational_health…"
              onChange={(e) => set("specialty_code", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة</Label>
            <Select
              value={form.clinic_id || NONE}
              onValueChange={(value) => set("clinic_id", value === NONE ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>كل العيادات</SelectItem>
                {(clinics.data ?? []).map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    {clinic.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>لوحة الرسم</Label>
            <Select value={form.canvas_type ?? "none"} onValueChange={(value) => set("canvas_type", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون</SelectItem>
                <SelectItem value="dental_chart">مخطط الأسنان</SelectItem>
                <SelectItem value="body_diagram">مخطط الجسم</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "..." : "إنشاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function TemplateBuilderDialog({
  templateId,
  organizationId,
  canManage,
  onClose,
}: {
  templateId: string | null;
  organizationId: string | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("build");

  const detail = useQuery({
    queryKey: ["exam-template-detail", templateId],
    enabled: Boolean(templateId),
    queryFn: async () => {
      const [tpl, sections, fields, options] = await Promise.all([
        supabase
          .from("v_exam_templates")
          .select("id, name_ar, version, usage_count, is_disabled, canvas_type")
          .eq("id", templateId)
          .maybeSingle(),
        supabase
          .from("exam_template_sections")
          .select("id, key, name_ar, sort_order")
          .eq("template_id", templateId)
          .order("sort_order"),
        supabase
          .from("exam_template_fields")
          .select(
            "id, section_id, key, label_ar, field_type, unit, is_required, min_value, max_value, sort_order, is_active, visible_when_field_id, visible_when_value",
          )
          .eq("template_id", templateId)
          .order("sort_order"),
        supabase
          .from("exam_field_options")
          .select("id, field_id, value, label_ar, sort_order")
          .eq("organization_id", organizationId),
      ]);
      if (tpl.error) throw tpl.error;
      if (sections.error) throw sections.error;
      if (fields.error) throw fields.error;
      if (options.error) throw options.error;
      return {
        template: tpl.data as any,
        sections: (sections.data ?? []) as any[],
        fields: (fields.data ?? []) as any[],
        options: (options.data ?? []) as any[],
      };
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["exam-template-detail", templateId] });
    queryClient.invalidateQueries({ queryKey: ["exam-templates"] });
  };

  const fail = (error: unknown, title: string) =>
    toast({
      variant: "destructive",
      title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const usage = Number(detail.data?.template?.usage_count ?? 0);
  const locked = usage > 0;

  const [sectionForm, setSectionForm] = useState<any>({});
  const addSection = useMutation({
    mutationFn: async () => {
      if (!String(sectionForm.name_ar ?? "").trim()) throw new Error("اسم القسم مطلوب");
      if (!String(sectionForm.key ?? "").trim()) throw new Error("مفتاح القسم مطلوب");
      const { error } = await supabase.from("exam_template_sections").insert({
        organization_id: organizationId,
        template_id: templateId,
        key: String(sectionForm.key).trim(),
        name_ar: String(sectionForm.name_ar).trim(),
        sort_order: Number(sectionForm.sort_order) || (detail.data?.sections.length ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSectionForm({});
      invalidate();
    },
    onError: (error) => fail(error, "تعذّرت إضافة القسم"),
  });

  const removeSection = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("exam_template_sections")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error) => fail(error, "تعذّر الحذف"),
  });

  const [fieldForm, setFieldForm] = useState<any>({ field_type: "text" });
  const addField = useMutation({
    mutationFn: async () => {
      if (!fieldForm.section_id) throw new Error("اختر القسم");
      if (!String(fieldForm.key ?? "").trim()) throw new Error("مفتاح الحقل مطلوب");
      if (!String(fieldForm.label_ar ?? "").trim()) throw new Error("عنوان الحقل مطلوب");
      const { error } = await supabase.from("exam_template_fields").insert({
        organization_id: organizationId,
        template_id: templateId,
        section_id: fieldForm.section_id,
        key: String(fieldForm.key).trim(),
        label_ar: String(fieldForm.label_ar).trim(),
        field_type: fieldForm.field_type,
        unit: String(fieldForm.unit ?? "").trim() || null,
        is_required: Boolean(fieldForm.is_required),
        min_value: String(fieldForm.min_value ?? "").trim() || null,
        max_value: String(fieldForm.max_value ?? "").trim() || null,
        visible_when_field_id: fieldForm.visible_when_field_id || null,
        visible_when_value: fieldForm.visible_when_field_id
          ? String(fieldForm.visible_when_value ?? "").trim() || null
          : null,
        sort_order: (detail.data?.fields.length ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFieldForm({ field_type: "text" });
      invalidate();
      toast({ title: "أُضيف الحقل" });
    },
    onError: (error) => fail(error, "تعذّرت إضافة الحقل"),
  });

  const removeField = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("exam_template_fields")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error) => fail(error, "تعذّر الحذف"),
  });

  const [optionForm, setOptionForm] = useState<any>({});
  const addOption = useMutation({
    mutationFn: async () => {
      if (!optionForm.field_id) throw new Error("اختر الحقل");
      if (!String(optionForm.value ?? "").trim()) throw new Error("القيمة مطلوبة");
      const { error } = await supabase.from("exam_field_options").insert({
        organization_id: organizationId,
        field_id: optionForm.field_id,
        value: String(optionForm.value).trim(),
        label_ar: String(optionForm.label_ar ?? optionForm.value).trim(),
        sort_order: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOptionForm({ field_id: optionForm.field_id });
      invalidate();
    },
    onError: (error) => fail(error, "تعذّرت إضافة الخيار"),
  });

  const clone = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_clone_exam_template", {
        p_template_id: templateId,
        p_name_ar: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates"] });
      toast({
        title: "أُنشئت نسخة جديدة",
        description: "النسخة معطَّلة حتى تراجعها وتفعّلها.",
      });
      onClose();
    },
    onError: (error) => fail(error, "تعذّر إنشاء النسخة"),
  });

  const fieldsBySection = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const field of detail.data?.fields ?? []) {
      const list = map.get(field.section_id) ?? [];
      list.push(field);
      map.set(field.section_id, list);
    }
    return map;
  }, [detail.data]);

  const optionsByField = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const option of detail.data?.options ?? []) {
      const list = map.get(option.field_id) ?? [];
      list.push(option);
      map.set(option.field_id, list);
    }
    return map;
  }, [detail.data]);

  const fieldLabel = (id: string) =>
    (detail.data?.fields ?? []).find((f) => f.id === id)?.label_ar ?? "";

  return (
    <Dialog open={Boolean(templateId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {detail.data?.template?.name_ar}{" "}
            <Badge variant="outline">v{detail.data?.template?.version}</Badge>
          </DialogTitle>
          <DialogDescription>
            الأقسام والحقول. المخطط المخزَّن يُبنى من هذه الجداول تلقائيًا.
          </DialogDescription>
        </DialogHeader>

        {locked && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            هذا النموذج مستعمَل في <strong>{usage}</strong> زيارة. يمكنك تعديل العناوين والوحدات،
            لكن <strong>تغيير مفتاح حقل أو نوعه مرفوض</strong> — فهما ما يُقرأ بهما ما حُفظ سابقًا.
            للتغيير الجوهري أنشئ نسخة جديدة.
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="ms-2"
                disabled={clone.isPending}
                onClick={() => clone.mutate()}
              >
                <Copy className="h-3.5 w-3.5" />
                إنشاء نسخة جديدة
              </Button>
            )}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="build">البناء</TabsTrigger>
            <TabsTrigger value="preview">المعاينة</TabsTrigger>
          </TabsList>

          <TabsContent value="build" className="flex flex-col gap-5 pt-3">
            {detail.isLoading && <Skeleton className="h-40 w-full" />}

            {/* الأقسام */}
            {canManage && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="w-36">
                  <div className="flex flex-col gap-1.5">
                    <Label>مفتاح القسم</Label>
                    <Input
                      value={sectionForm.key ?? ""}
                      dir="ltr"
                      onChange={(e) => setSectionForm({ ...sectionForm, key: e.target.value })}
                    />
                  </div>
                </div>
                <div className="min-w-40 flex-1">
                  <div className="flex flex-col gap-1.5">
                    <Label>اسم القسم</Label>
                    <Input
                      value={sectionForm.name_ar ?? ""}
                      onChange={(e) => setSectionForm({ ...sectionForm, name_ar: e.target.value })}
                    />
                  </div>
                </div>
                <Button disabled={addSection.isPending} onClick={() => addSection.mutate()}>
                  <Plus className="h-4 w-4" />
                  قسم
                </Button>
              </div>
            )}

            {(detail.data?.sections ?? []).map((section) => (
              <div key={section.id} className="rounded-md border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{section.name_ar}</span>
                  <span className="font-mono text-xs text-muted-foreground">{section.key}</span>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ms-auto"
                      onClick={() => removeSection.mutate(section.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-col divide-y">
                  {(fieldsBySection.get(section.id) ?? []).map((field) => (
                    <div key={field.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{field.label_ar}</span>
                      <span className="font-mono text-xs text-muted-foreground">{field.key}</span>
                      <Badge variant="outline">{FIELD_TYPES[field.field_type] ?? field.field_type}</Badge>
                      {field.unit && <Badge variant="secondary">{field.unit}</Badge>}
                      {field.is_required && <Badge variant="destructive">إلزامي</Badge>}
                      {field.visible_when_field_id && (
                        <Badge variant="outline">
                          يظهر إذا: {fieldLabel(field.visible_when_field_id)} ={" "}
                          {field.visible_when_value}
                        </Badge>
                      )}
                      {NEEDS_OPTIONS.has(field.field_type) && (
                        <span className="text-xs text-muted-foreground">
                          {(optionsByField.get(field.id) ?? []).map((o) => o.label_ar).join("، ") ||
                            "بلا خيارات"}
                        </span>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ms-auto"
                          onClick={() => removeField.mutate(field.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {(fieldsBySection.get(section.id) ?? []).length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">لا حقول في هذا القسم.</p>
                  )}
                </div>
              </div>
            ))}

            {/* إضافة حقل */}
            {canManage && (detail.data?.sections ?? []).length > 0 && (
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <Label>إضافة حقل</Label>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <div className="flex flex-col gap-1.5">
                      <Label>القسم</Label>
                      <Select
                        value={fieldForm.section_id ?? ""}
                        onValueChange={(value) => setFieldForm({ ...fieldForm, section_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر" />
                        </SelectTrigger>
                        <SelectContent>
                          {(detail.data?.sections ?? []).map((section) => (
                            <SelectItem key={section.id} value={section.id}>
                              {section.name_ar}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="w-32">
                    <div className="flex flex-col gap-1.5">
                      <Label>المفتاح</Label>
                      <Input
                        value={fieldForm.key ?? ""}
                        dir="ltr"
                        onChange={(e) => setFieldForm({ ...fieldForm, key: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="min-w-40 flex-1">
                    <div className="flex flex-col gap-1.5">
                      <Label>العنوان</Label>
                      <Input
                        value={fieldForm.label_ar ?? ""}
                        onChange={(e) => setFieldForm({ ...fieldForm, label_ar: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="flex flex-col gap-1.5">
                      <Label>النوع</Label>
                      <Select
                        value={fieldForm.field_type ?? "text"}
                        onValueChange={(value) => setFieldForm({ ...fieldForm, field_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FIELD_TYPES).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="w-28">
                    <div className="flex flex-col gap-1.5">
                      <Label>الوحدة</Label>
                      <Input
                        value={fieldForm.unit ?? ""}
                        onChange={(e) => setFieldForm({ ...fieldForm, unit: e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <Switch
                      checked={Boolean(fieldForm.is_required)}
                      onCheckedChange={(value) => setFieldForm({ ...fieldForm, is_required: value })}
                    />
                    إلزامي
                  </label>
                </div>

                <Separator />

                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-52">
                    <div className="flex flex-col gap-1.5">
                      <Label>يظهر إذا كان الحقل</Label>
                      <Select
                        value={fieldForm.visible_when_field_id || NONE}
                        onValueChange={(value) =>
                          setFieldForm({
                            ...fieldForm,
                            visible_when_field_id: value === NONE ? "" : value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>يظهر دائمًا</SelectItem>
                          {(detail.data?.fields ?? []).map((field) => (
                            <SelectItem key={field.id} value={field.id}>
                              {field.label_ar}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {fieldForm.visible_when_field_id && (
                    <div className="w-40">
                      <div className="flex flex-col gap-1.5">
                        <Label>يساوي</Label>
                        <Input
                          value={fieldForm.visible_when_value ?? ""}
                          onChange={(e) =>
                            setFieldForm({ ...fieldForm, visible_when_value: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  )}
                  <Button disabled={addField.isPending} onClick={() => addField.mutate()}>
                    <Plus className="h-4 w-4" />
                    إضافة الحقل
                  </Button>
                </div>
              </div>
            )}

            {/* خيارات حقول القوائم */}
            {canManage &&
              (detail.data?.fields ?? []).some((f) => NEEDS_OPTIONS.has(f.field_type)) && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="w-52">
                    <div className="flex flex-col gap-1.5">
                      <Label>خيارات الحقل</Label>
                      <Select
                        value={optionForm.field_id ?? ""}
                        onValueChange={(value) => setOptionForm({ ...optionForm, field_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر حقلًا" />
                        </SelectTrigger>
                        <SelectContent>
                          {(detail.data?.fields ?? [])
                            .filter((f) => NEEDS_OPTIONS.has(f.field_type))
                            .map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.label_ar}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="w-32">
                    <div className="flex flex-col gap-1.5">
                      <Label>القيمة</Label>
                      <Input
                        value={optionForm.value ?? ""}
                        dir="ltr"
                        onChange={(e) => setOptionForm({ ...optionForm, value: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="flex flex-col gap-1.5">
                      <Label>العنوان</Label>
                      <Input
                        value={optionForm.label_ar ?? ""}
                        onChange={(e) => setOptionForm({ ...optionForm, label_ar: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button disabled={addOption.isPending} onClick={() => addOption.mutate()}>
                    <Plus className="h-4 w-4" />
                    خيار
                  </Button>
                </div>
              )}
          </TabsContent>

          <TabsContent value="preview" className="pt-3">
            <p className="mb-3 text-xs text-muted-foreground">
              هكذا يظهر النموذج للطبيب. الحقول الشرطية تُعرض هنا دائمًا مع بيان شرطها.
            </p>
            <div className="flex flex-col gap-4">
              {(detail.data?.sections ?? []).map((section) => (
                <Card key={section.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">{section.name_ar}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {(fieldsBySection.get(section.id) ?? []).map((field) => (
                      <div key={field.id} className="flex flex-col gap-1.5">
                        <Label>
                          {field.label_ar}
                          {field.unit ? ` (${field.unit})` : ""}
                          {field.is_required && <span className="text-destructive"> *</span>}
                        </Label>
                        {NEEDS_OPTIONS.has(field.field_type) ? (
                          <Select disabled>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  (optionsByField.get(field.id) ?? [])
                                    .map((o) => o.label_ar)
                                    .join(" / ") || "بلا خيارات"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent />
                          </Select>
                        ) : field.field_type === "yes_no" ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" disabled>
                              نعم
                            </Button>
                            <Button size="sm" variant="outline" disabled>
                              لا
                            </Button>
                          </div>
                        ) : (
                          <Input disabled placeholder={FIELD_TYPES[field.field_type]} />
                        )}
                        {field.visible_when_field_id && (
                          <p className="text-xs text-muted-foreground">
                            يظهر إذا كان «{fieldLabel(field.visible_when_field_id)}» ={" "}
                            {field.visible_when_value}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
              {(detail.data?.sections ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  النموذج فارغ — أضف قسمًا وحقولًا من تبويب البناء.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {canManage && !locked && (
            <Button variant="outline" disabled={clone.isPending} onClick={() => clone.mutate()}>
              <Copy className="h-4 w-4" />
              نسخة جديدة
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
