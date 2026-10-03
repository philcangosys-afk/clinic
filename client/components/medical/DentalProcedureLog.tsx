import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  FileSignature,
  Loader2,
  Pencil,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { useMemberNames } from "@/lib/member-names";
import { errorMessage } from "@/lib/error-message";
import { toast } from "@/hooks/use-toast";
import {
  DENTAL_TARGETS,
  noteExtras,
  printDentalReport,
  targetLabel,
  type DentalLogRow,
  type DentalTarget,
} from "@/lib/dental";
import { dateText, timeText } from "@/lib/patient-report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SignatureCanvas from "@/components/shared/SignatureCanvas";
import { cn } from "@/lib/utils";

/**
 * سجلّ إجراءات الأسنان (منطق Kizen، 0211) — تحت المخطّط مباشرة.
 *
 * يجمع في جدولٍ واحد مجمّعٍ بالتاريخ (الأحدث أولًا، يُطوى ويُفتح):
 *   • إجراءات ZainCare (السجلّ المستقلّ وصفوف الزيارات)،
 *   • إجراءات خطّة العلاج المنفَّذة،
 *   • زيارات الأسنان من Kizen (للقراءة، بشارة «Kizen»).
 * والنقر على سنٍّ في المخطّط يفلتر السجلّ عليه ويضعه في نموذج «إجراء جديد».
 */

export type DentalDraft = {
  teeth: string[];
  targets: DentalTarget[];
  toothType: "permanent" | "primary";
};

type FormState = {
  visitDate: string;
  mainComplaint: string;
  diagnosisText: string;
  icdId: string | null;
  icdLabel: string | null;
  procedure: string;
  anesthesia: string;
  complications: string;
  antibiotics: string;
  education: string;
  note: string;
  nextVisit: string;
};

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

const emptyForm = (): FormState => ({
  visitDate: todayIso(),
  mainComplaint: "",
  diagnosisText: "",
  icdId: null,
  icdLabel: null,
  procedure: "",
  anesthesia: "",
  complications: "",
  antibiotics: "",
  education: "",
  note: "",
  nextVisit: "",
});

const SOURCE_BADGE: Record<DentalLogRow["source"], { label: string; className: string } | null> = {
  zaincare: null,
  plan: { label: "خطة العلاج", className: "border-teal-400 text-teal-700" },
  kizen: { label: "Kizen", className: "border-amber-400 text-amber-700" },
};

export function rowMatchesFilter(row: DentalLogRow, filter: string | null) {
  if (!filter) return true;
  return row.teeth.includes(filter) || row.targets.includes(filter as DentalTarget);
}

export default function DentalProcedureLog({
  patientId,
  rows,
  isLoading,
  filter,
  onClearFilter,
  draft,
  onDraftChange,
}: {
  patientId: string;
  rows: DentalLogRow[];
  isLoading: boolean;
  filter: string | null;
  onClearFilter: () => void;
  draft: DentalDraft;
  onDraftChange: (draft: DentalDraft) => void;
}) {
  const { organization, membership, session } = useOrganizationAccess() as any;
  const { can } = usePermissions();
  const canWrite = can("medical_records.write" as any);
  const queryClient = useQueryClient();
  const members = useMemberNames(organization?.id);
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DentalLogRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [signTarget, setSignTarget] = useState<DentalLogRow | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const userName =
    membership?.display_name?.trim() ||
    String(session?.user?.user_metadata?.display_name ?? "").trim() ||
    session?.user?.email ||
    "";

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const visible = useMemo(() => {
    const term = search.trim();
    return rows.filter(
      (row) =>
        (showCancelled || !row.is_cancelled) &&
        rowMatchesFilter(row, filter) &&
        (!term ||
          [row.main_complaint, row.diagnosis, row.procedure_text, row.note, row.doctor_name]
            .filter(Boolean)
            .some((text) => String(text).includes(term))),
    );
  }, [rows, filter, search, showCancelled]);

  const groups = useMemo(() => {
    const map = new Map<string, DentalLogRow[]>();
    for (const row of visible) {
      const list = map.get(row.visit_date);
      if (list) list.push(row);
      else map.set(row.visit_date, [row]);
    }
    return Array.from(map.entries());
  }, [visible]);

  // الأحدث مفتوح افتراضًا، والبقية مطويّة (كما في Kizen) — ما لم يُفلتر على سنّ
  const isCollapsed = (date: string, index: number) =>
    collapsed[date] ?? (filter || search.trim() ? false : index > 0);

  const anyOpen = groups.some(([date], index) => !isCollapsed(date, index));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dental-log", patientId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const payload = {
        teeth: draft.teeth,
        tooth_type: draft.toothType,
        visit_date: form.visitDate,
        main_complaint: form.mainComplaint,
        diagnosis_text: form.diagnosisText,
        diagnosis_icd10_id: form.icdId,
        procedure_done: form.procedure,
        anesthesia: form.anesthesia,
        complications: form.complications,
        prophylactic_antibiotics: form.antibiotics,
        patient_family_education: form.education,
        note: form.note,
        next_visit_plan: form.nextVisit,
        ...Object.fromEntries(DENTAL_TARGETS.map((t) => [t.key === "xray" ? "is_xray" : t.key, draft.targets.includes(t.key)])),
      };
      const { error } = await supabase.rpc("app_save_dental_procedure", {
        p_organization_id: organization.id,
        p_patient_id: patientId,
        p_payload: payload,
        p_entry_id: editingId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: editingId ? "عُدِّل الإجراء" : "سُجِّل الإجراء" });
      setForm(emptyForm());
      setEditingId(null);
      onDraftChange({ teeth: [], targets: [], toothType: draft.toothType });
      invalidate();
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_cancel_dental_procedure", {
        p_entry_id: cancelTarget!.id,
        p_reason: cancelReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "أُلغي الإجراء" });
      setCancelTarget(null);
      setCancelReason("");
      invalidate();
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  const sign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_sign_dental_procedure", {
        p_entry_id: signTarget!.id,
        p_signature: signature,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "حُفظ توقيع المريض" });
      setSignTarget(null);
      setSignature(null);
      invalidate();
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذّر حفظ التوقيع", description: errorMessage(error) }),
  });

  const startEdit = (row: DentalLogRow) => {
    setEditingId(row.id);
    onDraftChange({ teeth: row.teeth, targets: row.targets, toothType: row.tooth_type });
    setForm({
      visitDate: row.visit_date,
      mainComplaint: row.main_complaint ?? "",
      diagnosisText: row.diagnosis_free_text ?? "",
      icdId: row.diagnosis_icd10_id,
      icdLabel: row.icd10_code,
      procedure: row.procedure_text ?? "",
      anesthesia: row.anesthesia ?? "",
      complications: row.complications ?? "",
      antibiotics: row.antibiotics ?? "",
      education: row.education ?? "",
      note: row.note ?? "",
      nextVisit: row.next_visit ?? "",
    });
    document.getElementById("dental-procedure-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const print = async (visitDate?: string) => {
    setPrinting(true);
    try {
      await printDentalReport({
        patientId,
        organizationName: organization?.name ?? "",
        userName,
        visitDate: visitDate ?? null,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّرت الطباعة", description: errorMessage(error) });
    } finally {
      setPrinting(false);
    }
  };

  const selectionText =
    [...draft.teeth.map((t) => t), ...draft.targets.map(targetLabel)].join("، ") || "اختر سنًّا أو هدفًا من المخطّط";
  const kizenCount = rows.filter((row) => row.source === "kizen").length;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0 pb-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              سجلّ الإجراءات
              <Badge variant="secondary">{rows.filter((r) => !r.is_cancelled).length} إجراء</Badge>
              <Badge variant="outline">{new Set(rows.filter((r) => !r.is_cancelled).map((r) => r.visit_date)).size} زيارة</Badge>
              {kizenCount > 0 && (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  منها {kizenCount} من Kizen
                </Badge>
              )}
            </CardTitle>
            <CardDescription>كل إجراء بسنّه وشكواه وتشخيصه — اضغط سنًّا في المخطّط لعرض تاريخه وحده.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filter && (
              <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
                فلترة: {targetLabel(filter)}
                <button type="button" onClick={onClearFilter} aria-label="إلغاء الفلترة">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="بحث في السجلّ"
                className="h-9 w-48 ps-8"
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowCancelled((v) => !v)}>
              {showCancelled ? "إخفاء الملغاة" : "إظهار الملغاة"}
            </Button>
            {groups.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsed(Object.fromEntries(groups.map(([date]) => [date, anyOpen])))}
              >
                {anyOpen ? "طيّ الكل" : "توسيع الكل"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={printing} onClick={() => void print()}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              طباعة كشف الزيارات
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {filter ? `لا إجراءات مسجّلة على ${targetLabel(filter)}.` : "لا إجراءات مسجّلة لهذا المريض بعد."}
            </p>
          )}
          {!isLoading && groups.length > 0 && (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                  <th className="w-28">الأسنان</th>
                  <th>الشكوى الرئيسية</th>
                  <th>الإجراء</th>
                  <th>التشخيص الطبي</th>
                  <th>ملاحظة</th>
                  <th className="w-32">الطبيب / المسجّل</th>
                  <th className="w-28">آخر تعديل</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {groups.map(([date, list], index) => {
                  const closed = isCollapsed(date, index);
                  return (
                    <GroupRows
                      key={date}
                      date={date}
                      list={list}
                      closed={closed}
                      onToggle={() => setCollapsed((prev) => ({ ...prev, [date]: !closed }))}
                      onPrint={() => void print(date)}
                      memberName={(id) => (id ? members.data?.get(id) ?? "" : "")}
                      canWrite={canWrite}
                      onEdit={startEdit}
                      onCancel={(row) => {
                        setCancelReason("");
                        setCancelTarget(row);
                      }}
                      onSign={(row) => {
                        setSignature(null);
                        setSignTarget(row);
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <Card id="dental-procedure-form" className={cn(editingId && "border-amber-400")}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">{editingId ? "تعديل إجراء" : "إجراء جديد"}</CardTitle>
              <CardDescription>
                الأسنان: <span className="font-semibold text-foreground">{selectionText}</span>
                {draft.teeth.length > 0 && ` · ${draft.toothType === "primary" ? "لبنية" : "دائمة"}`}
              </CardDescription>
            </div>
            {editingId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                  onDraftChange({ teeth: [], targets: [], toothType: draft.toothType });
                }}
              >
                إلغاء التعديل
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="تاريخ الزيارة">
              <Input
                type="date"
                value={form.visitDate}
                max={todayIso()}
                onChange={(event) => set("visitDate", event.target.value)}
              />
            </Field>
            <Field label="الشكوى الرئيسية">
              <Input value={form.mainComplaint} onChange={(event) => set("mainComplaint", event.target.value)} />
            </Field>
            <Field label="التشخيص الطبي">
              <div className="flex flex-col gap-1.5">
                <Input value={form.diagnosisText} onChange={(event) => set("diagnosisText", event.target.value)} />
                <IcdDentalPicker
                  valueId={form.icdId}
                  valueLabel={form.icdLabel}
                  onChange={(id, label) => setForm((prev) => ({ ...prev, icdId: id, icdLabel: label }))}
                />
              </div>
            </Field>
            <Field label="الإجراء">
              <Input value={form.procedure} onChange={(event) => set("procedure", event.target.value)} />
            </Field>
            <Field label="التخدير">
              <Input value={form.anesthesia} onChange={(event) => set("anesthesia", event.target.value)} />
            </Field>
            <Field label="المضاعفات">
              <Input value={form.complications} onChange={(event) => set("complications", event.target.value)} />
            </Field>
            <Field label="المضادات الحيوية الوقائية">
              <Input value={form.antibiotics} onChange={(event) => set("antibiotics", event.target.value)} />
            </Field>
            <Field label="تثقيف المريض وعائلته">
              <Input value={form.education} onChange={(event) => set("education", event.target.value)} />
            </Field>
            <Field label="ملاحظة">
              <Textarea rows={3} value={form.note} onChange={(event) => set("note", event.target.value)} />
            </Field>
            <Field label="الزيارة التالية (تعليمات)">
              <Textarea rows={3} value={form.nextVisit} onChange={(event) => set("nextVisit", event.target.value)} />
            </Field>
            <div className="flex items-center gap-2 md:col-span-2">
              <Button
                disabled={save.isPending || (draft.teeth.length === 0 && draft.targets.length === 0)}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "حفظ التعديل" : "إدخال"}
              </Button>
              {draft.teeth.length === 0 && draft.targets.length === 0 && (
                <span className="text-xs text-muted-foreground">اختر السنّ أو الهدف من المخطّط أعلاه أولًا.</span>
              )}
              {editingId && rows.find((r) => r.id === editingId)?.has_signature && (
                <span className="text-xs text-amber-700">التعديل يُسقط توقيع المريض السابق على هذا الإجراء.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إلغاء الإجراء</DialogTitle>
            <DialogDescription>لا يُحذف الإجراء: يبقى في السجلّ بحالة «ملغى» وسببه.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="السبب" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              رجوع
            </Button>
            <Button variant="destructive" disabled={!cancelReason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
              إلغاء الإجراء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(signTarget)} onOpenChange={(open) => !open && setSignTarget(null)}>
        <DialogContent dir="rtl" className="w-[min(96vw,640px)] max-w-none">
          <DialogHeader>
            <DialogTitle>توقيع المريض على الإجراء</DialogTitle>
            <DialogDescription>
              {signTarget && [signTarget.teeth.join("، "), signTarget.procedure_text].filter(Boolean).join(" — ")}
            </DialogDescription>
          </DialogHeader>
          <SignatureCanvas onChange={setSignature} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignTarget(null)}>
              رجوع
            </Button>
            <Button disabled={!signature || sign.isPending} onClick={() => sign.mutate()}>
              حفظ التوقيع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function GroupRows({
  date,
  list,
  closed,
  onToggle,
  onPrint,
  memberName,
  canWrite,
  onEdit,
  onCancel,
  onSign,
}: {
  date: string;
  list: DentalLogRow[];
  closed: boolean;
  onToggle: () => void;
  onPrint: () => void;
  memberName: (id: string | null) => string;
  canWrite: boolean;
  onEdit: (row: DentalLogRow) => void;
  onCancel: (row: DentalLogRow) => void;
  onSign: (row: DentalLogRow) => void;
}) {
  return (
    <>
      <tr className="border-t bg-muted/40">
        <td colSpan={8} className="px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={onToggle} className="flex items-center gap-1 text-sm font-semibold">
              {closed ? <ChevronLeft className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              تاريخ: <span className="tabular-nums">{dateText(date)}</span>
              <span className="text-xs font-normal text-muted-foreground">({list.length})</span>
            </button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onPrint}>
              <Printer className="h-3.5 w-3.5" />
              طباعة هذه الزيارة
            </Button>
          </div>
        </td>
      </tr>
      {!closed &&
        list.map((row) => {
          const badge = SOURCE_BADGE[row.source];
          const extras = noteExtras(row);
          const editable = canWrite && row.source === "zaincare" && !row.visit_id && !row.is_cancelled;
          return (
            <tr key={`${row.source}-${row.id}`} className={cn("border-t align-top", row.is_cancelled && "text-muted-foreground line-through")}>
              <td className="px-2 py-1.5">
                <div className="flex flex-wrap gap-1">
                  {row.teeth.map((t) => (
                    <Badge key={t} variant="outline" className="px-1.5 tabular-nums">
                      {t}
                    </Badge>
                  ))}
                  {row.targets.map((t) => (
                    <Badge key={t} variant="secondary" className="px-1.5">
                      {targetLabel(t)}
                    </Badge>
                  ))}
                  {row.teeth.length === 0 && row.targets.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                </div>
                {badge && (
                  <Badge variant="outline" className={cn("mt-1 text-[10px]", badge.className)}>
                    {badge.label}
                  </Badge>
                )}
              </td>
              <td className="whitespace-pre-line px-2 py-1.5">{row.main_complaint}</td>
              <td className="whitespace-pre-line px-2 py-1.5">{row.procedure_text}</td>
              <td className="whitespace-pre-line px-2 py-1.5">
                {row.diagnosis}
                {row.icd10_code && row.diagnosis_free_text && (
                  <span className="block text-[11px] text-muted-foreground tabular-nums">{row.icd10_code}</span>
                )}
              </td>
              <td className="whitespace-pre-line px-2 py-1.5">
                {row.note}
                {extras.length > 0 && <span className="block text-xs text-muted-foreground">{extras.join("\n")}</span>}
                {row.is_cancelled && row.cancel_reason && (
                  <span className="block text-xs text-destructive no-underline">ملغى: {row.cancel_reason}</span>
                )}
                {row.has_signature && (
                  <Badge variant="outline" className="mt-1 gap-1 border-emerald-400 text-[10px] text-emerald-700">
                    <FileSignature className="h-3 w-3" />
                    وقّع المريض
                  </Badge>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {row.doctor_name ?? "—"}
                <span className="block text-muted-foreground tabular-nums">{timeText(row.recorded_at)}</span>
                {row.created_by && <span className="block text-muted-foreground">{memberName(row.created_by)}</span>}
              </td>
              <td className="px-2 py-1.5 text-xs text-muted-foreground">
                {row.updated_by && row.updated_at ? (
                  <>
                    <span className="tabular-nums">{dateText(row.updated_at)}</span>
                    <span className="block">{memberName(row.updated_by)}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-1 py-1">
                {editable && (
                  <div className="flex justify-end gap-0.5">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => onEdit(row)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="توقيع المريض" onClick={() => onSign(row)}>
                      <FileSignature className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      title="إلغاء (لا حذف)"
                      onClick={() => onCancel(row)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

/** قائمة تشخيصات الأسنان (ICD10، مجموعة Dental) بالبحث. */
function IcdDentalPicker({
  valueId,
  valueLabel,
  onChange,
}: {
  valueId: string | null;
  valueLabel: string | null;
  onChange: (id: string | null, label: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const codes = useQuery({
    queryKey: ["icd10-dental"],
    enabled: open,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("icd10_codes")
        .select("id, code, name_en, name_ar")
        .ilike("diagnosis_group", "dental")
        .eq("is_disabled", false)
        .order("code");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; name_en: string; name_ar: string | null }[];
    },
  });
  const list = (codes.data ?? []).filter((c) => {
    const t = term.trim().toLowerCase();
    return !t || c.code.toLowerCase().includes(t) || c.name_en.toLowerCase().includes(t) || (c.name_ar ?? "").includes(term.trim());
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen((v) => !v)}>
          ICD10
        </Button>
        {valueId ? (
          <Badge variant="secondary" className="gap-1 tabular-nums">
            {valueLabel}
            <button type="button" onClick={() => onChange(null, null)} aria-label="إزالة الكود">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">كود التشخيص (اختياري — يُستعمل في مطالبات التأمين)</span>
        )}
      </div>
      {open && (
        <div className="rounded-md border p-2">
          <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="ابحث بالكود أو الاسم" className="mb-2 h-8" />
          <div className="max-h-48 overflow-y-auto">
            {codes.isLoading && <Skeleton className="h-16 w-full" />}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c.code);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded px-2 py-1 text-start text-xs hover:bg-muted",
                  valueId === c.id && "bg-primary/10",
                )}
              >
                <span className="w-14 shrink-0 font-mono">{c.code}</span>
                <span>
                  {c.name_ar ?? c.name_en}
                  <span className="block text-muted-foreground" dir="ltr">
                    {c.name_en}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
