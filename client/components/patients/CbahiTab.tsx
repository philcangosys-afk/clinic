import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Info, Eye } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import {
  CBAHI_FORMS,
  CBAHI_STATUS_LABELS,
  computeScore,
  getFormDefinition,
  isScoreComplete,
  resolveBand,
  type CbahiFormDefinition,
} from "@/lib/cbahi-forms";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { errorMessage } from "@/lib/error-message";

/**
 * نماذج CBAHI للجودة وسلامة المريض (لقطة 119).
 *
 * جدول `cbahi_forms` موجود منذ 0006 بلا واجهة — وهو آخر جدول بلا واجهة في
 * المشروع. تعريفات النماذج في `lib/cbahi-forms.ts`.
 */
type CbahiRow = {
  id: string;
  form_type: string;
  status: string;
  form_data: Record<string, string>;
  created_at: string;
  updated_at: string;
};

function useCbahiForms(patientId: string) {
  return useQuery({
    queryKey: ["cbahi-forms", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cbahi_forms")
        .select("id, form_type, status, form_data, created_at, updated_at")
        // المريض ينتمي لمنشأة واحدة، فالتقييد به يكفي لعزل المؤسسات
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CbahiRow[];
    },
  });
}

/** يعرض الدرجة ونطاقها — أو لا شيء إن كان النموذج توثيقيًا بلا مقياس. */
function ScoreBadge({
  definition,
  values,
}: {
  definition: CbahiFormDefinition;
  values: Record<string, string>;
}) {
  const score = computeScore(definition, values);
  if (score == null) return <span className="text-xs text-muted-foreground">توثيقي</span>;
  const band = resolveBand(definition, score);
  const complete = isScoreComplete(definition, values);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-bold tabular-nums">{score}</span>
      {band && <Badge variant={band.tone}>{band.label}</Badge>}
      {!complete && (
        // الدرجة الجزئية مضلِّلة: نصف الحقول تعطي درجة منخفضة تُقرأ كأمان
        <Badge variant="secondary" className="text-[10px]">
          غير مكتمل
        </Badge>
      )}
    </span>
  );
}

function CbahiFormDialog({
  open,
  onOpenChange,
  patientId,
  organizationId,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  organizationId: string | undefined;
  existing: CbahiRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [formType, setFormType] = useState(existing?.form_type ?? CBAHI_FORMS[0].type);
  const [values, setValues] = useState<Record<string, string>>(existing?.form_data ?? {});
  const [status, setStatus] = useState(existing?.status ?? "draft");

  const definition = getFormDefinition(formType);
  const readOnly = existing?.status === "reviewed";

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!definition) throw new Error("نوع نموذج غير معروف");
      /**
       * النموذج "المكتمل" يجب أن يكون مكتمل الدرجة فعلًا — نموذج سقوط
       * بنصف إجاباته يعطي درجة منخفضة تُقرأ كأمان وهي ليست كذلك.
       */
      if (status !== "draft" && !isScoreComplete(definition, values))
        throw new Error("أجب عن كل حقول التقييم قبل اعتماد النموذج، أو احفظه كمسوّدة");

      const payload = {
        organization_id: organizationId,
        patient_id: patientId,
        form_type: formType,
        status,
        form_data: values,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { data, error } = await supabase
          .from("cbahi_forms")
          .update(payload)
          .eq("id", existing.id)
          .select("id");
        if (error) throw error;
        // تحديث لا يطابق صفًا ليس خطأً في PostgREST — بلا الفحص تظهر رسالة نجاح كاذبة
        if (!data || data.length === 0) throw new Error("لم يُحفظ التعديل — راجع صلاحيتك");
      } else {
        const { error } = await supabase
          .from("cbahi_forms")
          .insert({ ...payload, created_by: session?.user.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cbahi-forms", patientId] });
      toast({ title: existing ? "تم تحديث النموذج" : "تم حفظ النموذج" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "عرض/تعديل نموذج" : "نموذج جودة جديد"}</DialogTitle>
          <DialogDescription>
            {definition ? definition.description : "اختر نوع النموذج"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>نوع النموذج</Label>
            <Select
              value={formType}
              onValueChange={(next) => {
                setFormType(next);
                // القيم لا تُنقل بين نوعين: مفاتيح الحقول تختلف، ونقلها
                // يخلط إجابة مقياس بمقياس آخر.
                setValues({});
              }}
              disabled={Boolean(existing)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CBAHI_FORMS.map((form) => (
                  <SelectItem key={form.type} value={form.type}>
                    {form.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {definition && (
            <>
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  يتبع <strong>{definition.instrument}</strong>. الحدود المعروضة تتبع المقياس
                  المنشور — على لجنة الجودة في منشأتك اعتمادها قبل التشغيل، فبعض المنشآت تعتمد
                  حدودًا أشد حسب نوع مرضاها.
                </span>
              </div>

              {definition.fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label>{field.label}</Label>
                  {field.options && (
                    <Select
                      value={values[field.key] ?? ""}
                      onValueChange={(next) => setValues((prev) => ({ ...prev, [field.key]: next }))}
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option.label} value={option.label}>
                            {option.label}
                            {option.score !== 0 && (
                              <span className="text-muted-foreground"> ({option.score})</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {field.numeric && (
                    <Input
                      type="number"
                      min={field.numeric.min}
                      max={field.numeric.max}
                      disabled={readOnly}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                  {field.freeText && (
                    <Textarea
                      rows={2}
                      disabled={readOnly}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <span className="text-sm font-medium">النتيجة</span>
                <ScoreBadge definition={definition} values={values} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>الحالة</Label>
                <Select value={status} onValueChange={setStatus} disabled={readOnly}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CBAHI_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {status === "reviewed" && !readOnly && (
                  <p className="text-xs text-amber-700">
                    النموذج المُراجَع يصبح للقراءة فقط — راجع البيانات قبل الحفظ.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? "إغلاق" : "إلغاء"}
          </Button>
          {!readOnly && (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CbahiTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const forms = useCbahiForms(patientId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CbahiRow | null>(null);

  const rows = forms.data ?? [];

  const open = (row: CbahiRow | null) => {
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            نماذج الجودة وسلامة المريض
          </CardTitle>
          <CardDescription>
            تقييمات السقوط والألم وقرحة الفراش والتثقيف — بدرجاتها المعيارية
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => open(null)}>
          <Plus className="h-4 w-4" />
          نموذج جديد
        </Button>
      </CardHeader>
      <CardContent>
        {forms.isLoading && <Skeleton className="h-32 w-full" />}
        {!forms.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>النموذج</TableHead>
                <TableHead>النتيجة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const definition = getFormDefinition(row.form_type);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {definition?.title ?? row.form_type}
                    </TableCell>
                    <TableCell>
                      {definition ? (
                        <ScoreBadge definition={definition} values={row.form_data ?? {}} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "reviewed" ? "success" : "secondary"}>
                        {CBAHI_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => open(row)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد نماذج جودة لهذا المريض بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {dialogOpen && (
        <CbahiFormDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(null);
          }}
          patientId={patientId}
          organizationId={organization?.id}
          existing={editing}
        />
      )}
    </Card>
  );
}
