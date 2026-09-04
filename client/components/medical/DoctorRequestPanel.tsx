import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ImageIcon,
  Loader2,
  HeartPulse,
  Microscope,
  Send,
  StickyNote,
  UserRoundSearch,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { VITAL_MEASURES } from "@/components/medical/VitalSignsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type RequestKind =
  | "radiology"
  | "lab"
  | "vitals"
  | "call_patient"
  | "collect_payment"
  | "note"
  | "follow_up";

const KINDS: { key: RequestKind; label: string; icon: typeof Activity; hint: string }[] = [
  { key: "radiology", label: "طلب أشعة", icon: Activity, hint: "يصل قسم الأشعة فورًا" },
  { key: "lab", label: "طلب تحليل", icon: Microscope, hint: "يصل المختبر فورًا" },
  { key: "vitals", label: "مؤشرات حيوية", icon: HeartPulse, hint: "يصل طابور القياس" },
  { key: "follow_up", label: "موعد متابعة", icon: CalendarClock, hint: "يصل الاستقبال ليحجزه" },
  { key: "call_patient", label: "استدعاء المريض", icon: UserRoundSearch, hint: "يصل الاستقبال" },
  { key: "collect_payment", label: "تحصيل مبلغ", icon: Banknote, hint: "يصل الاستقبال" },
  { key: "note", label: "ملاحظة", icon: StickyNote, hint: "يصل الاستقبال" },
];

/**
 * لوحة طلبات الطبيب — المرحلة 33.
 *
 * الطبيب في العيادة يحتاج ثلاثة أشياء لا تحتمل الانتظار: صورة، وتحليل،
 * وشيءٌ من الاستقبال. كانت الثلاثة تُقضى بالصوت أو بالورقة، فلا يبقى منها
 * أثر يُسأل عنه لاحقًا: مَن طلب؟ متى؟ وهل نُفِّذ؟
 *
 * كل زرّ هنا يكتب في الجدول الذي يخصّه فعلًا — طلب الأشعة في
 * `radiology_orders`، وموعد المتابعة في `appointment_requests` — ولا يُنشئ
 * «صندوق رسائل» موازيًا لما هو قائم.
 */
export default function DoctorRequestPanel({ doctorId }: { doctorId?: string | null }) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<RequestKind>("radiology");
  const [patientId, setPatientId] = useState("");
  const [search, setSearch] = useState("");
  const [examIds, setExamIds] = useState<string[]>([]);
  const [testIds, setTestIds] = useState<string[]>([]);
  const [priority, setPriority] = useState("routine");
  const [indication, setIndication] = useState("");
  const [instructions, setInstructions] = useState("");
  const [amount, setAmount] = useState("");
  const [body, setBody] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [period, setPeriod] = useState("any");
  const [vitalsKind, setVitalsKind] = useState<"general" | "custom">("general");
  const [vitalsPicked, setVitalsPicked] = useState<string[]>([]);

  const patients = useQuery({
    queryKey: ["dr-req-patients", organization?.id, doctorId, search],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase
        .from("patients")
        .select("id, name_ar, id_number")
        .eq("organization_id", organization!.id)
        .order("name_ar")
        .limit(50);
      if (search.trim()) {
        q = q.or(`name_ar.ilike.%${search.trim()}%,id_number.ilike.%${search.trim()}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; id_number: string | null }[];
    },
  });

  const exams = useQuery({
    queryKey: ["dr-req-exams", organization?.id],
    enabled: Boolean(organization?.id) && kind === "radiology",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("radiology_exams")
        .select("id, name_ar, modality")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; modality: string }[];
    },
  });

  const tests = useQuery({
    queryKey: ["dr-req-tests", organization?.id],
    enabled: Boolean(organization?.id) && kind === "lab",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_tests")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name_ar")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const canSend = useMemo(() => {
    if (!organization?.id || !patientId) return false;
    if (kind === "radiology") return examIds.length > 0;
    if (kind === "lab") return testIds.length > 0;
    if (kind === "vitals") return vitalsKind === "general" || vitalsPicked.length > 0;
    if (kind === "follow_up") return Boolean(followDate);
    if (kind === "collect_payment") return Number(amount) > 0;
    if (kind === "note") return body.trim().length > 0;
    return true;
  }, [organization?.id, patientId, kind, examIds, testIds, followDate, amount, body,
      vitalsKind, vitalsPicked.length]);

  const reset = () => {
    setExamIds([]);
    setTestIds([]);
    setIndication("");
    setInstructions("");
    setAmount("");
    setBody("");
    setFollowDate("");
    setVitalsPicked([]);
    setVitalsKind("general");
  };

  const send = useMutation({
    mutationFn: async () => {
      const org = organization!.id;
      if (kind === "radiology") {
        const { error } = await supabase.rpc("app_create_radiology_order", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId ?? null,
          p_exam_ids: examIds,
          p_priority: priority,
          p_clinical_indication: indication.trim() || null,
          p_notes: instructions.trim() || null,
          p_visit_id: null,
          p_branch_id: branch?.id ?? null,
          p_clinic_id: null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "lab") {
        // المختبر له دالّته القائمة منذ 0083 — لا تُبنى ثانية هنا.
        const { error } = await supabase.rpc("app_create_lab_order", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId ?? null,
          p_test_ids: testIds,
          p_priority: priority,
          p_notes: instructions.trim() || null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "vitals") {
        const { error } = await supabase.rpc("app_request_vital_signs", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId ?? null,
          p_request_kind: vitalsKind,
          p_measures: vitalsKind === "custom" ? vitalsPicked : null,
          p_priority: priority === "routine" ? "routine" : "urgent",
          p_note: body.trim() || null,
          p_visit_id: null,
          p_branch_id: branch?.id ?? null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "follow_up") {
        const { error } = await supabase.rpc("app_doctor_request_followup", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId ?? null,
          p_preferred_date: followDate,
          p_reason: body.trim() || null,
          p_preferred_period: period,
          p_clinic_id: null,
          p_branch_id: branch?.id ?? null,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("app_create_staff_request", {
        p_organization_id: org,
        p_request_type: kind,
        p_patient_id: patientId,
        p_doctor_id: doctorId ?? null,
        p_body: body.trim() || null,
        p_amount: kind === "collect_payment" ? Number(amount) : null,
        p_priority: priority === "stat" ? "urgent" : priority === "urgent" ? "urgent" : "routine",
        p_visit_id: null,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "أُرسل الطلب", description: "سيظهر عند الجهة المعنيّة فورًا." });
      reset();
      queryClient.invalidateQueries({ queryKey: ["doctor-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["reception-requests"] });
    },
    onError: (err: any) =>
      toast({
        title: "تعذّر الإرسال",
        description: err?.message ?? "خطأ غير معروف",
        variant: "destructive",
      }),
  });

  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-4 w-4" />
          إرسال طلب
        </CardTitle>
        <CardDescription>
          كل طلب يُسجَّل باسمك ووقته، ويظهر عند الجهة المعنيّة فورًا.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KINDS.map((k) => {
            const Icon = k.icon;
            const active = kind === k.key;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => {
                  setKind(k.key);
                  reset();
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                <span className="text-sm font-semibold">{k.label}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{k.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dr-patient">المريض</Label>
          <Input
            dir="rtl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو رقم الهوية"
          />
          <select
            id="dr-patient"
            dir="rtl"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر المريض —</option>
            {(patients.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar}
                {p.id_number ? ` — ${p.id_number}` : ""}
              </option>
            ))}
          </select>
        </div>

        {kind === "radiology" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>الفحوص المطلوبة</Label>
              {exams.isLoading && <Skeleton className="h-20 w-full" />}
              {!exams.isLoading && (exams.data ?? []).length === 0 && (
                <span className="text-xs text-destructive">
                  لا فحوص في كتالوج الأشعة — أضفها من شاشة «الأشعة».
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                {(exams.data ?? []).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(examIds, setExamIds, e.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      examIds.includes(e.id)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {e.name_ar}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-ind">دواعي التصوير</Label>
              <Input
                id="dr-ind"
                dir="rtl"
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
                placeholder="مثال: ألم صدري مستمر منذ ثلاثة أيام"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-instr">تعليمات التصوير</Label>
              <Textarea
                id="dr-instr"
                dir="rtl"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="مثال: وضع الوقوف — أمامي وجانبي"
              />
            </div>
          </>
        )}

        {kind === "lab" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>التحاليل المطلوبة</Label>
              {tests.isLoading && <Skeleton className="h-20 w-full" />}
              <div className="flex flex-wrap gap-2">
                {(tests.data ?? []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(testIds, setTestIds, t.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      testIds.includes(t.id)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {t.name_ar}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-lnote">ملاحظات للمختبر</Label>
              <Textarea
                id="dr-lnote"
                dir="rtl"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
          </>
        )}

        {kind === "vitals" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVitalsKind("general")}
                className={cn(
                  "rounded-lg border-2 p-3 text-start transition",
                  vitalsKind === "general" ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span className="block font-bold">عام</span>
                <span className="block text-xs text-muted-foreground">
                  ضغط، نبض، حرارة، تنفس، وزن، طول
                </span>
              </button>
              <button
                type="button"
                onClick={() => setVitalsKind("custom")}
                className={cn(
                  "rounded-lg border-2 p-3 text-start transition",
                  vitalsKind === "custom" ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span className="block font-bold">خاص</span>
                <span className="block text-xs text-muted-foreground">تختار ما يُقاس</span>
              </button>
            </div>
            {vitalsKind === "custom" && (
              <div className="flex flex-wrap gap-2">
                {VITAL_MEASURES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggle(vitalsPicked, setVitalsPicked, m.key)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      vitalsPicked.includes(m.key)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-vnote">ملاحظة للقائم بالقياس</Label>
              <Textarea
                id="dr-vnote"
                dir="rtl"
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </>
        )}

        {kind === "follow_up" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-date">تاريخ المتابعة</Label>
              <Input
                id="dr-date"
                type="date"
                value={followDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFollowDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-period">الفترة</Label>
              <select
                id="dr-period"
                dir="rtl"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="any">أي فترة</option>
                <option value="morning">صباحًا</option>
                <option value="evening">مساءً</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="dr-reason">سبب المتابعة</Label>
              <Input
                id="dr-reason"
                dir="rtl"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="مثال: مراجعة نتيجة التحليل"
              />
            </div>
          </div>
        )}

        {kind === "collect_payment" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-amount">المبلغ</Label>
              <Input
                id="dr-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-for">مقابل ماذا</Label>
              <Input
                id="dr-for"
                dir="rtl"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="مثال: قيمة الأشعة"
              />
            </div>
          </div>
        )}

        {(kind === "call_patient" || kind === "note") && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dr-body">
              {kind === "call_patient" ? "تفاصيل الاستدعاء" : "نصّ الملاحظة"}
            </Label>
            <Textarea
              id="dr-body"
              dir="rtl"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                kind === "call_patient" ? "أدخِل المريض الآن" : "المريض يحتاج كرسيًا متحركًا"
              }
            />
          </div>
        )}

        {(kind === "radiology" || kind === "lab" || kind === "call_patient" || kind === "vitals") && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dr-prio">الأولوية</Label>
            <select
              id="dr-prio"
              dir="rtl"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="routine">عادي</option>
              <option value="urgent">عاجل</option>
              {kind !== "call_patient" && kind !== "vitals" && (
                <option value="stat">طارئ</option>
              )}
            </select>
          </div>
        )}

        <Button className="h-11" disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          إرسال الطلب
        </Button>
      </CardContent>
    </Card>
  );
}

/** صندوق الطبيب: ما وصله فعلًا — صورٌ موجودة وقياساتٌ مسجَّلة، لا حالات مُعلنة. */
export function DoctorInbox({ doctorId }: { doctorId?: string | null }) {
  const { organization } = useOrganizationAccess();

  const vitals = useQuery({
    queryKey: ["doctor-vitals-inbox", organization?.id, doctorId],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase
        .from("v_doctor_vitals_inbox")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("recorded_at", { ascending: false })
        .limit(30);
      if (doctorId) q = q.eq("doctor_id", doctorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const inbox = useQuery({
    queryKey: ["doctor-inbox", organization?.id, doctorId],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase
        .from("v_doctor_inbox")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("last_image_at", { ascending: false })
        .limit(50);
      if (doctorId) q = q.eq("doctor_id", doctorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = inbox.data ?? [];
  const vitalRows = vitals.data ?? [];

  if (inbox.isLoading) return <Skeleton className="h-48 w-full" />;

  if (rows.length === 0 && vitalRows.length === 0) {
    return (
      <Card>
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <BellRing className="h-9 w-9 text-muted-foreground" />
          <span className="font-medium">لا نتائج جديدة</span>
          <span className="text-sm text-muted-foreground">
            ما يرفعه قسم الأشعة لمرضاك يظهر هنا فور حفظه.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {vitalRows.map((v) => (
        <Card key={v.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <HeartPulse className="h-3 w-3" />
                  مؤشرات حيوية
                </Badge>
                <Link
                  to={`/patients/${v.patient_id}`}
                  className="text-base font-bold underline-offset-4 hover:underline"
                >
                  {v.patient_name}
                </Link>
              </div>
              <p className="mt-1 text-sm tabular-nums">
                {v.blood_pressure_systolic && v.blood_pressure_diastolic
                  ? `ضغط ${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} · `
                  : ""}
                {v.heart_rate ? `نبض ${v.heart_rate} · ` : ""}
                {v.temperature_celsius ? `حرارة ${v.temperature_celsius}° · ` : ""}
                {v.respiratory_rate ? `تنفس ${v.respiratory_rate} · ` : ""}
                {v.weight_kg ? `وزن ${v.weight_kg} · ` : ""}
                {v.bmi ? `كتلة ${v.bmi}` : ""}
              </p>
              {v.request_note && (
                <p className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-sm">{v.request_note}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(v.recorded_at).toLocaleString("ar")}
              </p>
            </div>
            <Link to={`/patients/${v.patient_id}`}>
              <Button size="sm" variant="outline">
                <CheckCircle2 className="h-4 w-4" />
                فتح ملف المريض
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}

      {rows.map((r) => (
        <Card key={r.order_id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <ImageIcon className="h-3 w-3" />
                  {r.image_count} صورة
                </Badge>
                <Link
                  to={`/patients/${r.patient_id}`}
                  className="text-base font-bold underline-offset-4 hover:underline"
                >
                  {r.patient_name}
                </Link>
                {r.priority !== "routine" && <Badge variant="destructive">عاجل</Badge>}
              </div>
              <p className="mt-1 text-sm">{r.exam_names ?? "—"}</p>
              {r.tech_note && (
                <p className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-sm">
                  <span className="font-medium">ملاحظة المختصّ: </span>
                  {r.tech_note}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {r.last_image_at ? new Date(r.last_image_at).toLocaleString("ar") : ""}
              </p>
            </div>
            <Link to={`/patients/${r.patient_id}`}>
              <Button size="sm" variant="outline">
                <CheckCircle2 className="h-4 w-4" />
                فتح ملف المريض
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
