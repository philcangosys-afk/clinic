import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileStack, FilePlus2, Plus, Printer, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { DocumentTemplateAppliesTo, DocumentTemplateRow, GeneratedDocumentRow } from "@/lib/database.types";
import { buildMergeContext, extractCustomTokens, mergeTemplate, printHtml } from "@/lib/document-merge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import LookupSelect from "@/components/shared/LookupSelect";
import PatientPicker from "@/components/shared/PatientPicker";
import { useToast } from "@/hooks/use-toast";

const APPLIES_TO_LABELS: Record<DocumentTemplateAppliesTo, string> = {
  patient: "مريض",
  employee: "موظف",
  generic: "عام (بلا ربط)",
};

const KNOWN_PLACEHOLDERS: Record<DocumentTemplateAppliesTo, { token: string; label: string }[]> = {
  patient: [
    { token: "patient.name_ar", label: "اسم المريض" },
    { token: "patient.id_number", label: "رقم الهوية" },
    { token: "patient.mobile_number", label: "رقم الجوال" },
    { token: "patient.file_number", label: "رقم الملف" },
  ],
  employee: [
    { token: "employee.name_ar", label: "اسم الموظف" },
    { token: "employee.national_id", label: "رقم الهوية" },
    { token: "employee.mobile_1", label: "رقم الجوال" },
    { token: "employee.file_number", label: "رقم الملف" },
    { token: "employee.hire_date", label: "تاريخ التعيين" },
  ],
  generic: [],
};
const ALWAYS_AVAILABLE_PLACEHOLDERS = [
  { token: "organization.name", label: "اسم المنشأة" },
  { token: "organization.tax_number", label: "الرقم الضريبي" },
  { token: "date.today", label: "تاريخ اليوم" },
];

function useTemplates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["document-templates", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("*, category:lookup_values(name_ar)")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as (DocumentTemplateRow & { category: { name_ar: string } | null })[];
    },
  });
}

function useGeneratedDocuments(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["generated-documents", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("*, patient:patients(name_ar), employee:employees(name_ar)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function TemplateFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: DocumentTemplateRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_value_id ?? "");
  const [appliesTo, setAppliesTo] = useState<DocumentTemplateAppliesTo>(initial?.applies_to ?? "generic");
  const [note, setNote] = useState(initial?.note ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const insertToken = (token: string) => {
    const el = bodyRef.current;
    const placeholder = `{{${token}}}`;
    if (!el) {
      setBodyHtml((prev) => prev + placeholder);
      return;
    }
    const start = el.selectionStart ?? bodyHtml.length;
    const end = el.selectionEnd ?? bodyHtml.length;
    const next = bodyHtml.slice(0, start) + placeholder + bodyHtml.slice(end);
    setBodyHtml(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + placeholder.length;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!nameAr.trim()) throw new Error("اسم القالب مطلوب");
      const payload = {
        organization_id: organizationId,
        category_value_id: categoryId || null,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        applies_to: appliesTo,
        body_html: bodyHtml,
        note: note.trim() || null,
      };
      if (initial) {
        const { error } = await supabase.from("document_templates").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("document_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates", organizationId] });
      toast({ title: initial ? "تم تحديث القالب" : "تم إنشاء القالب" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  const palette = [...KNOWN_PLACEHOLDERS[appliesTo], ...ALWAYS_AVAILABLE_PLACEHOLDERS];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل القالب" : "قالب مستند جديد"}</DialogTitle>
          <DialogDescription>
            استخدم عناصر نائبة مثل {"{{patient.name_ar}}"} داخل النص — تُستبدل تلقائيًا ببيانات المريض/الموظف عند توليد مستند من القالب.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>اسم القالب</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية (اختياري)</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفئة</Label>
            <LookupSelect categoryKey="document_template_categories" value={categoryId} onChange={setCategoryId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>القالب مرتبط بـ</Label>
            <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as DocumentTemplateAppliesTo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(APPLIES_TO_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>ملاحظة (اختياري)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Label className="ms-1">إدراج عنصر نائب:</Label>
            {palette.map((p) => (
              <Button key={p.token} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => insertToken(p.token)}>
                {p.label}
              </Button>
            ))}
          </div>
          <Textarea
            ref={bodyRef}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={12}
            className="font-mono text-sm"
            placeholder="<p>عزيزنا {{patient.name_ar}}...</p>"
          />
          <p className="text-xs text-muted-foreground">يُكتب المحتوى بصيغة HTML بسيطة (فقرات، عناوين، جداول) — يُعرض ويُطبع كما هو.</p>
        </div>

        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ القالب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useOrganizationMergeFields(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization-merge-fields", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("name, tax_number").eq("id", organizationId).maybeSingle();
      if (error) throw error;
      return data as { name: string; tax_number: string | null } | null;
    },
  });
}

function useEmployeesList() {
  return useQuery({
    queryKey: ["employees-for-document-generation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name_ar, national_id, mobile_1, file_number, hire_date")
        .eq("status", "active")
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function GenerateDocumentDialog({
  template,
  onOpenChange,
  organizationId,
  currentUserId,
}: {
  template: DocumentTemplateRow | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [patient, setPatient] = useState<{ id: string; name_ar: string; mobile_number?: string | null; file_number?: number | null } | null>(
    null,
  );
  const [patientIdNumber, setPatientIdNumber] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const employees = useEmployeesList();
  const orgFields = useOrganizationMergeFields(organizationId);
  const selectedEmployee = (employees.data ?? []).find((e) => e.id === employeeId) ?? null;

  const customTokens = useMemo(() => (template ? extractCustomTokens(template.body_html) : []), [template]);

  const merged = useMemo(() => {
    if (!template) return "";
    const context = buildMergeContext({
      patient: patient ? { name_ar: patient.name_ar, id_number: patientIdNumber, mobile_number: patient.mobile_number, file_number: patient.file_number } : null,
      employee: selectedEmployee,
      organization: orgFields.data,
      custom: customValues,
    });
    return mergeTemplate(template.body_html, context);
  }, [template, patient, patientIdNumber, selectedEmployee, orgFields.data, customValues]);

  const onSelectPatient = async (found: { id: string; name_ar: string; mobile_number?: string | null; file_number?: number | null }) => {
    setPatient(found);
    const { data } = await supabase.from("patients").select("id_number").eq("id", found.id).maybeSingle();
    setPatientIdNumber((data as { id_number: string | null } | null)?.id_number ?? null);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId || !template) throw new Error("بيانات غير مكتملة");
      if (template.applies_to === "patient" && !patient) throw new Error("اختر مريضًا أولًا");
      if (template.applies_to === "employee" && !employeeId) throw new Error("اختر موظفًا أولًا");
      const title = `${template.name_ar} — ${patient?.name_ar ?? selectedEmployee?.name_ar ?? new Date().toLocaleDateString("ar-SA")}`;
      const { error } = await supabase.from("generated_documents").insert({
        organization_id: organizationId,
        template_id: template.id,
        template_name_snapshot: template.name_ar,
        patient_id: patient?.id ?? null,
        employee_id: employeeId || null,
        title,
        body_html: merged,
        extra_fields: customValues,
        created_by: currentUserId ?? null,
      });
      if (error) throw error;
      return title;
    },
    onSuccess: (title) => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents", organizationId] });
      toast({ title: "تم توليد المستند" });
      printHtml(title ?? template?.name_ar ?? "مستند", merged);
      setPatient(null);
      setPatientIdNumber(null);
      setEmployeeId("");
      setCustomValues({});
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر التوليد", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <Dialog open={Boolean(template)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>توليد مستند — {template?.name_ar}</DialogTitle>
          <DialogDescription>تُملأ العناصر النائبة تلقائيًا، ثم يمكن طباعة المستند أو حفظه في سجل المستندات المولَّدة</DialogDescription>
        </DialogHeader>

        {template?.applies_to === "patient" && (
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={onSelectPatient} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>
        )}

        {template?.applies_to === "employee" && (
          <div className="flex flex-col gap-1.5">
            <Label>الموظف</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر موظفًا" />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {customTokens.length > 0 && (
          <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2">
            {customTokens.map((token) => (
              <div key={token} className="flex flex-col gap-1.5">
                <Label className="text-xs">{token}</Label>
                <Input
                  value={customValues[token] ?? ""}
                  onChange={(e) => setCustomValues((prev) => ({ ...prev, [token]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">معاينة</Label>
          <div className="max-h-72 overflow-y-auto rounded-lg border bg-white p-4" dangerouslySetInnerHTML={{ __html: merged }} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => printHtml(template?.name_ar ?? "مستند", merged)}>
            <Printer className="h-4 w-4" />
            طباعة بدون حفظ
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <FilePlus2 className="h-4 w-4" />
            {save.isPending ? "جارٍ الحفظ..." : "حفظ وطباعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesTab({ organizationId, currentUserId }: { organizationId: string | undefined; currentUserId: string | undefined }) {
  const templates = useTemplates(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplateRow | null>(null);
  const [generating, setGenerating] = useState<DocumentTemplateRow | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: async (tpl: DocumentTemplateRow) => {
      const { error } = await supabase.from("document_templates").update({ is_disabled: !tpl.is_disabled }).eq("id", tpl.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates", organizationId] });
      toast({ title: "تم تحديث حالة القالب" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر التحديث", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("document_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates", organizationId] });
      toast({ title: "تم حذف القالب" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحذف", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          قالب جديد
        </Button>
      </div>

      {templates.isLoading && <Skeleton className="h-40 w-full" />}
      {!templates.isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(templates.data ?? []).map((tpl) => (
            <Card key={tpl.id} className={tpl.is_disabled ? "opacity-60" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{tpl.name_ar}</CardTitle>
                  <div className="flex gap-1">
                    <Badge variant="secondary">{APPLIES_TO_LABELS[tpl.applies_to]}</Badge>
                    {tpl.organization_id === null && <Badge variant="outline">نظامي</Badge>}
                  </div>
                </div>
                {tpl.category?.name_ar && <CardDescription>{tpl.category.name_ar}</CardDescription>}
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => setGenerating(tpl)}>
                  <FilePlus2 className="h-3.5 w-3.5" />
                  توليد مستند
                </Button>
                {tpl.organization_id !== null && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(tpl);
                        setFormOpen(true);
                      }}
                    >
                      تعديل
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(tpl)}>
                      {tpl.is_disabled ? "تفعيل" : "تعطيل"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteTemplate.mutate(tpl.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          {(templates.data ?? []).length === 0 && (
            <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">لا توجد قوالب بعد — أنشئ أول قالب.</p>
          )}
        </div>
      )}

      <TemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        organizationId={organizationId}
        initial={editing}
      />
      <GenerateDocumentDialog
        template={generating}
        onOpenChange={() => setGenerating(null)}
        organizationId={organizationId}
        currentUserId={currentUserId}
      />
    </div>
  );
}

function GeneratedDocumentsTab({ organizationId }: { organizationId: string | undefined }) {
  const docs = useGeneratedDocuments(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">المستندات المولَّدة</CardTitle>
        <CardDescription>آخر 200 مستند تم توليده من أي قالب</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {docs.isLoading && <Skeleton className="h-40 w-full" />}
        {!docs.isLoading &&
          (docs.data ?? []).map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">{doc.title}</span>
                <span className="text-xs text-muted-foreground">
                  {doc.template_name_snapshot} — {doc.patient?.name_ar ?? doc.employee?.name_ar ?? "بلا ربط"} —{" "}
                  {new Date(doc.created_at).toLocaleString("ar-SA")}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => printHtml(doc.title, doc.body_html)}>
                <Printer className="h-3.5 w-3.5" />
                طباعة
              </Button>
            </div>
          ))}
        {!docs.isLoading && (docs.data ?? []).length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">لا توجد مستندات مولَّدة بعد.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentTemplates() {
  const { organization, session } = useOrganizationAccess();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileStack className="h-6 w-6" /> قوالب المستندات
        </h1>
        <p className="text-sm text-muted-foreground">
          عقود وشهادات ونماذج قابلة لإعادة الاستخدام — استخدم عناصر نائبة لملء بيانات المريض/الموظف تلقائيًا، ثم اطبع أو احفظ المستند الناتج
        </p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">القوالب</TabsTrigger>
          <TabsTrigger value="generated">المستندات المولَّدة</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab organizationId={organization?.id} currentUserId={session?.user.id} />
        </TabsContent>
        <TabsContent value="generated" className="mt-4">
          <GeneratedDocumentsTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
