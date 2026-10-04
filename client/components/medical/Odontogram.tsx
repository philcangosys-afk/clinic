import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Stethoscope, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import DentalProcedureLog, { type DentalDraft } from "@/components/medical/DentalProcedureLog";
import { TeethDefs, ToothGlyph } from "@/components/medical/TeethArch";
import ServiceBrowserDialog, { type PickedService } from "@/components/billing/ServiceBrowserDialog";
import { NO_DOCTOR, useSessionDoctor } from "@/lib/session-doctor";
import { DENTAL_TARGETS, fetchDentalLog, markedTeeth, type DentalTarget } from "@/lib/dental";

/**
 * مخطّط الأسنان — المرحلة 35.
 *
 * كان النظام يكتب «الإجراء» جملةً نصّية واحدة لكل أسنان الزيارة، فلا يعرف
 * ما جرى لسنٍّ بعينه ولا حال الفم الآن. هنا كل سنّ صفٌّ في القاعدة: له حالة
 * تلوّنه، وتاريخٌ من إجراءات، وخطةٌ لما لم يُنفَّذ بعد.
 *
 * الألوان ليست زينة: الحالة تُقرأ من بُعد قبل أن يُقرأ الرقم.
 */

const CONDITIONS: { key: string; label: string; color: string; ring: string }[] = [
  { key: "sound",           label: "سليم",          color: "bg-background",     ring: "border-border" },
  { key: "caries",          label: "تسوّس",          color: "bg-red-500/20",     ring: "border-red-500" },
  { key: "filled",          label: "محشو",          color: "bg-blue-500/20",    ring: "border-blue-500" },
  { key: "root_canal",      label: "علاج عصب",      color: "bg-purple-500/20",  ring: "border-purple-500" },
  { key: "crown",           label: "تلبيسة",        color: "bg-amber-500/25",   ring: "border-amber-500" },
  { key: "bridge",          label: "جسر",           color: "bg-orange-500/25",  ring: "border-orange-500" },
  { key: "implant",         label: "زراعة",         color: "bg-teal-500/25",    ring: "border-teal-500" },
  { key: "veneer",          label: "قشرة تجميلية",  color: "bg-pink-500/20",    ring: "border-pink-500" },
  // 0221: «خلع» — مقرَّرٌ خلعه ولم يُخلع بعد (قبل «مخلوع»)
  { key: "to_extract",      label: "خلع",           color: "bg-red-500/25",     ring: "border-red-600" },
  { key: "extracted",       label: "مخلوع",         color: "bg-muted",          ring: "border-muted-foreground" },
  { key: "missing",         label: "مفقود",         color: "bg-muted",          ring: "border-muted-foreground" },
  { key: "impacted",        label: "منطمر",         color: "bg-yellow-500/20",  ring: "border-yellow-600" },
  { key: "orthodontic",     label: "تقويم",         color: "bg-indigo-500/20",  ring: "border-indigo-500" },
  { key: "under_treatment", label: "قيد العلاج",    color: "bg-cyan-500/20",    ring: "border-cyan-500" },
];

const SURFACES = [
  { key: "mesial", label: "إنسي" },
  { key: "distal", label: "وحشي" },
  { key: "occlusal", label: "إطباقي" },
  { key: "buccal", label: "دهليزي" },
  { key: "lingual", label: "لساني" },
  { key: "cervical", label: "عنقي" },
];

// ترقيم FDI. الترتيب هنا هو ترتيب الفم كما يراه الطبيب: من اليمين لليسار
// في الأعلى، ثم في الأسفل.
const PERMANENT = {
  upper: [
    ["18","17","16","15","14","13","12","11"],
    ["21","22","23","24","25","26","27","28"],
  ],
  lower: [
    ["48","47","46","45","44","43","42","41"],
    ["31","32","33","34","35","36","37","38"],
  ],
};
const PRIMARY = {
  upper: [["55","54","53","52","51"], ["61","62","63","64","65"]],
  lower: [["85","84","83","82","81"], ["71","72","73","74","75"]],
};

function conditionOf(key: string | undefined) {
  return CONDITIONS.find((c) => c.key === key) ?? CONDITIONS[0];
}

export default function Odontogram({ patientId }: { patientId: string }) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [toothType, setToothType] = useState<"permanent" | "primary">("permanent");
  /** لوحة «حالة السنّ وخطّة العلاج» — تُفتح بزرّ بعد اختيار سنّ */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * منطق Kizen (0211): النقر على سنٍّ أو هدف يفلتر سجلّ الإجراءات عليه
   * ويضعه في نموذج «إجراء جديد». «عدّة أسنان» يجعل النقر يضيف ويحذف بدل
   * أن يستبدل — لإجراءٍ واحد على أسنانٍ في أرباع مختلفة.
   */
  const [logFilter, setLogFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState<DentalDraft>({ teeth: [], targets: [], toothType: "permanent" });
  const [multi, setMulti] = useState(false);

  const log = useQuery({
    queryKey: ["dental-log", patientId],
    enabled: Boolean(patientId),
    queryFn: () => fetchDentalLog(patientId),
  });
  const marks = useMemo(() => markedTeeth(log.data ?? []), [log.data]);

  const pickTooth = (tooth: string) => {
    if (multi) {
      setDraft((prev) => {
        const teeth = prev.teeth.includes(tooth) ? prev.teeth.filter((t) => t !== tooth) : [...prev.teeth, tooth];
        return { ...prev, teeth, toothType };
      });
      return;
    }
    const same = logFilter === tooth;
    setLogFilter(same ? null : tooth);
    setDraft({ teeth: same ? [] : [tooth], targets: [], toothType });
    if (selected && selected !== tooth) setSelected(null);
  };

  const pickTarget = (target: DentalTarget) => {
    if (multi) {
      setDraft((prev) => ({
        ...prev,
        targets: prev.targets.includes(target) ? prev.targets.filter((t) => t !== target) : [...prev.targets, target],
      }));
      return;
    }
    const same = logFilter === target;
    setLogFilter(same ? null : target);
    setDraft({ teeth: [], targets: same ? [] : [target], toothType });
    setSelected(null);
  };
  const focusTooth = draft.teeth.length === 1 && draft.targets.length === 0 ? draft.teeth[0] : null;

  const chart = useQuery({
    queryKey: ["odontogram", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_odontogram")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const byTooth = useMemo(() => {
    const map: Record<string, any> = {};
    (chart.data ?? []).forEach((r) => (map[r.tooth_number] = r));
    return map;
  }, [chart.data]);

  const plan = useQuery({
    queryKey: ["tooth-plan", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_tooth_procedure_history")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["planned", "in_progress"])
        .order("planned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const arch = toothType === "permanent" ? PERMANENT : PRIMARY;
  const planRows = plan.data ?? [];
  const planTotal = planRows.reduce((sum, r) => sum + Number(r.item_price ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">مخطّط الأسنان</CardTitle>
            <CardDescription>
              اضغط سنًّا لعرض تاريخه وتسجيل إجراء عليه — الإطار الأحمر: سنٌّ له إجراء مسجّل
            </CardDescription>
          </div>
          <div className="flex rounded-lg border p-0.5">
            {(["permanent", "primary"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setToothType(t);
                  setSelected(null);
                  setDraft((prev) => ({ ...prev, teeth: [], toothType: t }));
                  if (logFilter && /^\d+$/.test(logFilter)) setLogFilter(null);
                }}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition",
                  toothType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {t === "permanent" ? "دائمة" : "لبنية"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {chart.isLoading && <Skeleton className="h-40 w-full" />}

          {/* 0221: الأسنان مرسومةً بتيجانها وجذورها (كـKizen) — العلوية فوق
              والسفلية تحت، والحالة تلوّنها، والمحدَّد في إطارٍ أحمر. */}
          {!chart.isLoading && (
            <div className="overflow-x-auto rounded-xl border bg-gradient-to-b from-slate-50 to-white py-3">
              <TeethDefs />
              {(["upper", "lower"] as const).map((jaw) => (
                <div
                  key={jaw}
                  className={cn(
                    "flex min-w-max items-end justify-center gap-4 px-3",
                    jaw === "lower" && "mt-1 items-start border-t border-dashed border-slate-300 pt-2",
                  )}
                >
                  {arch[jaw].map((quad, qi) => (
                    <div key={qi} className={cn("flex", jaw === "upper" ? "items-end" : "items-start")}>
                      {quad.map((tooth) => {
                        const row = byTooth[tooth];
                        const cond = conditionOf(row?.condition);
                        const hasRecord = marks.teeth.has(tooth);
                        return (
                          <ToothGlyph
                            key={tooth}
                            tooth={tooth}
                            condition={row?.condition}
                            selected={draft.teeth.includes(tooth)}
                            hasRecord={hasRecord}
                            planned={Number(row?.planned_count ?? 0)}
                            onClick={() => pickTooth(tooth)}
                            title={`${tooth} — ${cond.label}${hasRecord ? " — له إجراء مسجّل" : ""}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* أهدافٌ ليست سنًّا (Kizen): الفكّ كاملًا لإزالة الجير، الأشعة، التقويم */}
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            {DENTAL_TARGETS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => pickTarget(t.key)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition hover:border-primary/50",
                  marks.targets.has(t.key) && "outline outline-2 outline-offset-1 outline-red-600",
                  draft.targets.includes(t.key) && "bg-slate-100 ring-2 ring-slate-500",
                )}
              >
                {t.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => setMulti((v) => !v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition",
                multi ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50",
              )}
              title="النقر يضيف السنّ إلى الإجراء ويحذفه بدل أن يستبدله"
            >
              عدّة أسنان
            </button>
            {(draft.teeth.length > 0 || draft.targets.length > 0 || logFilter) && (
              <button
                type="button"
                onClick={() => {
                  setDraft({ teeth: [], targets: [], toothType });
                  setLogFilter(null);
                  setSelected(null);
                }}
                className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                مسح الاختيار
              </button>
            )}
            {focusTooth && (
              <Button
                size="sm"
                variant="outline"
                className="ms-auto h-7 text-xs"
                onClick={() => setSelected(selected === focusTooth ? null : focusTooth)}
              >
                <Stethoscope className="h-3.5 w-3.5" />
                {selected === focusTooth ? "إخفاء" : "حالة السنّ"} {focusTooth} وخطة علاجه
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t pt-3">
            {CONDITIONS.filter((c) => c.key !== "sound").map((c) => (
              <span key={c.key} className="flex items-center gap-1.5 text-[11px]">
                <span className={cn("h-3 w-3 rounded border-2", c.color, c.ring)} />
                {c.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <ToothPanel
          // المفتاح هو رقم السنّ: بدونه يبقى المكوّن نفسه حين ينتقل المستخدم
          // من سنّ إلى سنّ، فتبقى الأسطح المختارة والخدمة والملاحظة من السنّ
          // السابق — فتُسجَّل أسطح سنٍّ على سنٍّ آخر.
          key={selected}
          patientId={patientId}
          organizationId={organization?.id}
          branchId={branch?.id ?? null}
          tooth={selected}
          toothType={toothType}
          current={byTooth[selected]}
          onClose={() => setSelected(null)}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ["odontogram", patientId] });
            queryClient.invalidateQueries({ queryKey: ["tooth-plan", patientId] });
            queryClient.invalidateQueries({ queryKey: ["dental-log", patientId] });
          }}
        />
      )}

      <DentalProcedureLog
        patientId={patientId}
        rows={log.data ?? []}
        isLoading={log.isLoading}
        filter={logFilter}
        onClearFilter={() => setLogFilter(null)}
        draft={draft}
        onDraftChange={(next) => {
          setDraft(next);
          if (next.teeth.length > 0 && next.toothType !== toothType) setToothType(next.toothType);
        }}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            خطة العلاج
            {planRows.length > 0 && (
              <>
                <Badge variant="secondary">{planRows.length} إجراء</Badge>
                <Badge variant="outline" className="tabular-nums">
                  {planTotal.toLocaleString("ar")} تقديريًّا
                </Badge>
              </>
            )}
          </CardTitle>
          <CardDescription>ما خُطّط ولم يُنفَّذ بعد</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {plan.isLoading && <Skeleton className="h-24 w-full" />}
          {!plan.isLoading && planRows.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              لا إجراءات مخطَّطة. اضغط سنًّا في المخطّط لتخطيط إجراء عليه.
            </p>
          )}
          {planRows.map((r) => (
            <PlanRow
              key={r.id}
              row={r}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["odontogram", patientId] });
                queryClient.invalidateQueries({ queryKey: ["tooth-plan", patientId] });
                // المفتاح الصحيح لقائمة زيارات المريض وخدماتها. كان
                // `["patient-visit-services"]` ولا استعلام يحمله، فالإجراء
                // المُتمّ لا يظهر في الزيارة حتى يُحدِّث المستخدم الصفحة.
                queryClient.invalidateQueries({ queryKey: ["patient-visits-context", patientId] });
                // إجراء الخطّة المنفَّذ يظهر في سجلّ الإجراءات (0211)
                queryClient.invalidateQueries({ queryKey: ["dental-log", patientId] });
              }}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** لوحة السنّ المختار: حاله الآن، وتخطيط إجراء عليه، وتاريخه. */
function ToothPanel({
  patientId,
  organizationId,
  branchId,
  tooth,
  toothType,
  current,
  onClose,
  onChanged,
}: {
  patientId: string;
  organizationId?: string;
  branchId: string | null;
  tooth: string;
  toothType: "permanent" | "primary";
  current: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [surfaces, setSurfaces] = useState<string[]>(current?.surfaces ?? []);
  const [itemId, setItemId] = useState("");
  const [picked, setPicked] = useState<PickedService | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [note, setNote] = useState("");
  const { doctorId: sessionDoctorId, isDoctorScope } = useSessionDoctor();
  const sessionDoctor = isDoctorScope && sessionDoctorId && sessionDoctorId !== NO_DOCTOR ? sessionDoctorId : null;
  /* السياق السريريّ على السنّ نفسه (0154): من يفتح السنّ بعد سنة يحتاج أن
     يعرف ما الشكوى وما التخدير وهل أُعطي مضادّ وقائيّ — لا سطرًا واحدًا. */
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [diagnosisText, setDiagnosisText] = useState("");
  const [complications, setComplications] = useState("");
  const [anesthesia, setAnesthesia] = useState("");
  const [antibiotic, setAntibiotic] = useState("");
  const [education, setEducation] = useState("");
  const [nextVisit, setNextVisit] = useState("");
  const [clinicalOpen, setClinicalOpen] = useState(false);


  const history = useQuery({
    queryKey: ["tooth-history", patientId, tooth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_tooth_procedure_history")
        .select("*")
        .eq("patient_id", patientId)
        .eq("tooth_number", tooth)
        .order("planned_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const setCondition = useMutation({
    mutationFn: async (condition: string) => {
      const { error } = await supabase.rpc("app_set_tooth_condition", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_tooth_number: tooth,
        p_condition: condition,
        p_tooth_type: toothType,
        p_surfaces: surfaces,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "سُجّلت حالة السنّ" });
      onChanged();
    },
    onError: (e: any) =>
      toast({ title: "تعذّر الحفظ", description: e?.message, variant: "destructive" }),
  });

  const planProcedure = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_plan_tooth_procedures", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_procedures: [
          {
            tooth,
            tooth_type: toothType,
            item_id: itemId,
            surfaces,
            note: note.trim() || null,
            chief_complaint: chiefComplaint.trim() || null,
            diagnosis_text: diagnosisText.trim() || null,
            complications: complications.trim() || null,
            anesthesia: anesthesia.trim() || null,
            antibiotic_prophylaxis: antibiotic.trim() || null,
            patient_education: education.trim() || null,
            next_visit_date: nextVisit || null,
          },
        ],
        p_doctor_id: null,
        p_visit_id: null,
        p_branch_id: branchId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "أُضيف للخطة" });
      setItemId("");
      setPicked(null);
      setNote("");
      setChiefComplaint("");
      setDiagnosisText("");
      setComplications("");
      setAnesthesia("");
      setAntibiotic("");
      setEducation("");
      setNextVisit("");
      onChanged();
      history.refetch();
    },
    onError: (e: any) =>
      toast({ title: "تعذّر التخطيط", description: e?.message, variant: "destructive" }),
  });

  const toggleSurface = (k: string) =>
    setSurfaces((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  return (
    <Card className="border-primary">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          السنّ {tooth}
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {conditionOf(current?.condition).label}
          </span>
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>الأسطح</Label>
          <div className="flex flex-wrap gap-1.5">
            {SURFACES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSurface(s.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition",
                  surfaces.includes(s.key)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>الحالة</Label>
          <div className="flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={setCondition.isPending}
                onClick={() => setCondition.mutate(c.key)}
                className={cn(
                  "rounded-full border-2 px-2.5 py-1 text-xs font-medium transition",
                  c.color,
                  c.ring,
                  current?.condition === c.key && "ring-2 ring-primary ring-offset-1",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label>تخطيط إجراء</Label>
          {/* 0221: كلّ خدمات الأسنان كما في الاتفاقيات — بالمنتقي نفسه (شجرة
              الأقسام والبحث بالاسم والكود والسعر)، لا الموسومة بنوع إجراء وحدها. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setBrowserOpen(true)}>
              <Plus className="h-4 w-4" />
              {picked ? "تغيير الخدمة" : "اختر خدمة / تصفّح خدمات الأسنان"}
            </Button>
            {picked && (
              <Badge variant="secondary" className="gap-2 px-2.5 py-1 text-sm">
                {picked.name_ar}
                <span className="tabular-nums text-muted-foreground">{Number(picked.price ?? 0).toLocaleString("ar")}</span>
                <button
                  type="button"
                  aria-label="إلغاء الخدمة"
                  onClick={() => {
                    setPicked(null);
                    setItemId("");
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Badge>
            )}
          </div>
          <ServiceBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            domain="dental"
            doctorId={sessionDoctor}
            onSelect={(service) => {
              setPicked(service);
              setItemId(service.id);
            }}
          />
          <Input
            dir="rtl"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة (اختياري)"
          />

          {/* السياق السريريّ مطويّ افتراضًا: أكثر الإجراءات تُخطَّط بخدمة
              وملاحظة، وسبعة حقول مفتوحة دائمًا تُبطئ العمل اليوميّ. */}
          <button
            type="button"
            onClick={() => setClinicalOpen((prev) => !prev)}
            className="self-start text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {clinicalOpen ? "إخفاء التفاصيل السريرية" : "تفاصيل سريرية (شكوى، تشخيص، تخدير...)"}
          </button>

          {clinicalOpen && (
            <div className="flex flex-col gap-1.5 rounded-md border p-2">
              <Input
                dir="rtl"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="الشكوى الرئيسية"
              />
              <Input
                dir="rtl"
                value={diagnosisText}
                onChange={(e) => setDiagnosisText(e.target.value)}
                placeholder="التشخيص الطبي"
              />
              <Input
                dir="rtl"
                value={anesthesia}
                onChange={(e) => setAnesthesia(e.target.value)}
                placeholder="التخدير"
              />
              <Input
                dir="rtl"
                value={antibiotic}
                onChange={(e) => setAntibiotic(e.target.value)}
                placeholder="المضادات الحيوية الوقائية"
              />
              <Input
                dir="rtl"
                value={complications}
                onChange={(e) => setComplications(e.target.value)}
                placeholder="المضاعفات"
              />
              <Textarea
                dir="rtl"
                rows={2}
                value={education}
                onChange={(e) => setEducation(e.target.value)}
                placeholder="تثقيف المريض وعائلته"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="tp-next">الزيارة التالية لهذا السنّ</Label>
                <Input
                  id="tp-next"
                  type="date"
                  value={nextVisit}
                  onChange={(e) => setNextVisit(e.target.value)}
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="self-start"
            disabled={!itemId || planProcedure.isPending}
            onClick={() => planProcedure.mutate()}
          >
            {planProcedure.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            أضِف للخطة
          </Button>
        </div>

        {(history.data ?? []).length > 0 && (
          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label>تاريخ هذا السنّ</Label>
            {(history.data ?? []).map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {h.item_name ?? h.procedure_kind ?? "إجراء"}
                  {h.note ? ` — ${h.note}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {h.status === "completed"
                    ? `نُفِّذ ${new Date(h.performed_at).toLocaleDateString("ar")}`
                    : h.status === "cancelled"
                      ? "ملغى"
                      : "مخطَّط"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanRow({ row, onChanged }: { row: any; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: async (action: "complete" | "cancel") => {
      setBusy(action);
      if (action === "complete") {
        const { error } = await supabase.rpc("app_complete_tooth_procedure", {
          p_procedure_id: row.id,
          p_note: null,
          p_visit_id: null,
          p_bill: true,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("app_cancel_tooth_procedure", {
          p_procedure_id: row.id,
          p_reason: null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "تمّ" });
      onChanged();
    },
    onError: (e: any) =>
      toast({ title: "تعذّر التنفيذ", description: e?.message, variant: "destructive" }),
    onSettled: () => setBusy(null),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Badge variant="outline">سنّ {row.tooth_number}</Badge>
          {row.item_name ?? row.procedure_kind ?? "إجراء"}
          {row.item_price != null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Number(row.item_price).toLocaleString("ar")}
            </span>
          )}
        </span>
        {row.note && <span className="block text-xs text-muted-foreground">{row.note}</span>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" disabled={busy !== null} onClick={() => act.mutate("complete")}>
          {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          نُفِّذ
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => act.mutate("cancel")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
