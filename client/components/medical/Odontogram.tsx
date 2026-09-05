import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  const [selected, setSelected] = useState<string | null>(null);

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
              اضغط سنًّا لتسجيل حاله أو تخطيط إجراء عليه
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

          {!chart.isLoading && (
            <div className="flex flex-col gap-3 overflow-x-auto">
              {(["upper", "lower"] as const).map((jaw) => (
                <div key={jaw} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {jaw === "upper" ? "الفكّ العلوي" : "الفكّ السفلي"}
                  </span>
                  <div className="flex min-w-max justify-center gap-3">
                    {arch[jaw].map((quad, qi) => (
                      <div key={qi} className="flex gap-1">
                        {quad.map((tooth) => {
                          const row = byTooth[tooth];
                          const cond = conditionOf(row?.condition);
                          const planned = Number(row?.planned_count ?? 0);
                          const gone = row?.condition === "extracted" || row?.condition === "missing";
                          return (
                            <button
                              key={tooth}
                              type="button"
                              onClick={() => setSelected(selected === tooth ? null : tooth)}
                              title={`${tooth} — ${cond.label}`}
                              className={cn(
                                "relative grid h-11 w-9 place-items-center rounded-md border-2 text-xs font-bold transition",
                                cond.color,
                                cond.ring,
                                gone && "opacity-45 line-through",
                                selected === tooth && "ring-2 ring-primary ring-offset-1",
                              )}
                            >
                              {tooth}
                              {planned > 0 && (
                                <span className="absolute -top-1.5 -end-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                                  {planned}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

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
          }}
        />
      )}

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
                queryClient.invalidateQueries({ queryKey: ["patient-visit-services"] });
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
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const services = useQuery({
    queryKey: ["dental-services", organizationId, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let q = supabase
        .from("items")
        .select("id, name_ar, price, dental_procedure_kind")
        .eq("organization_id", organizationId!)
        .not("dental_procedure_kind", "is", null)
        .order("name_ar")
        .limit(60);
      if (search.trim()) q = q.ilike("name_ar", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

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
      setNote("");
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
          <Label htmlFor="tp-item">تخطيط إجراء</Label>
          <Input
            dir="rtl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن خدمة"
          />
          <select
            id="tp-item"
            dir="rtl"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر الخدمة —</option>
            {(services.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_ar} — {Number(s.price ?? 0).toLocaleString("ar")}
              </option>
            ))}
          </select>
          {!services.isLoading && (services.data ?? []).length === 0 && (
            <span className="text-xs text-destructive">
              لا خدمات أسنان موسومة بنوع إجراء — حدّد نوع الإجراء على الخدمة في الكتالوج.
            </span>
          )}
          <Input
            dir="rtl"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة (اختياري)"
          />
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
