import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  ImageIcon,
  Loader2,
  HeartPulse,
  Microscope,
  Send,
  ShieldCheck,
  Share2,
  StickyNote,
  UserRoundSearch,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PatientSearchScopeChips } from "@/components/shared/PatientSearchInput";
import {
  buildPatientSearchOr,
  patientSearchPlaceholder,
  PATIENTS_SEARCH_COLUMNS,
  type PatientSearchScope,
} from "@/lib/patient-search";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { VITAL_MEASURES } from "@/components/medical/VitalSignsForm";
import ItemPicker from "@/components/shared/ItemPicker";
import { errorMessage } from "@/lib/error-message";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  | "follow_up"
  | "preauth"
  | "referral";

const KINDS: { key: RequestKind; label: string; icon: typeof Activity; hint: string }[] = [
  { key: "radiology", label: "طلب أشعة", icon: Activity, hint: "يصل قسم الأشعة فورًا" },
  { key: "lab", label: "طلب تحليل", icon: Microscope, hint: "يصل المختبر فورًا" },
  { key: "vitals", label: "مؤشرات حيوية", icon: HeartPulse, hint: "يصل طابور القياس" },
  { key: "follow_up", label: "موعد متابعة", icon: CalendarClock, hint: "يصل الاستقبال ليحجزه" },
  { key: "call_patient", label: "استدعاء المريض", icon: UserRoundSearch, hint: "يصل الاستقبال" },
  { key: "collect_payment", label: "تحصيل مبلغ", icon: Banknote, hint: "يصل الاستقبال" },
  { key: "note", label: "ملاحظة", icon: StickyNote, hint: "يصل الاستقبال" },
  { key: "preauth", label: "موافقة تأمين", icon: ShieldCheck, hint: "مسوّدة يرسلها موظّف التأمين" },
  { key: "referral", label: "إحالة لزميل", icon: Share2, hint: "تصل الطبيب المُحال إليه" },
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
export default function DoctorRequestPanel({
  doctorId,
  resolvingDoctor = false,
}: {
  doctorId?: string | null;
  /** ما زال تحديد الطبيب جاريًا — لا يُعلن التعذّر قبل انتهائه. */
  resolvingDoctor?: boolean;
}) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<RequestKind>("radiology");
  const [patientId, setPatientId] = useState("");
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
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
  /**
   * الموافقة المسبقة: **الصنف إلزاميّ.** 0089 أغلق ثقبًا كان فيه الطلب وصفًا
   * نصًّا بلا معرّف، فكانت الموافقة عليه تفتح كلّ خدمة تشترط موافقة.
   */
  const [preauthItem, setPreauthItem] = useState<{ id: string; name_ar: string; price: number | null } | null>(null);
  const [referralDoctorId, setReferralDoctorId] = useState("");

  const patients = useQuery({
    queryKey: ["dr-req-patients", organization?.id, doctorId, search, searchScopes.join("+")],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let q = supabase
        .from("patients")
        .select("id, name_ar, id_number, mobile_number, phone_1, file_number")
        .eq("organization_id", organization!.id)
        .order("name_ar")
        .limit(50);
      // البحث الموحَّد: الاسم والجوال والهوية — أو ما تحصره أزرار النطاق
      const searchFilter = buildPatientSearchOr(search, searchScopes, PATIENTS_SEARCH_COLUMNS);
      if (searchFilter) q = q.or(searchFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; id_number: string | null }[];
    },
  });

  /** زملاء الإحالة: النشطون في هذه المنشأة، والطبيب نفسه مستثنًى. */
  const colleagues = useQuery({
    queryKey: ["dr-referral-doctors", organization?.id, doctorId],
    enabled: Boolean(organization?.id) && kind === "referral",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, job_title")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return ((data ?? []) as { id: string; name_ar: string; job_title: string | null }[]).filter(
        (row) => row.id !== doctorId,
      );
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
    /**
     * بلا طبيبٍ طالب لا يُرسَل طلب.
     *
     * العمود `ordering_doctor_id` يقبل `NULL` والدوالّ تفحص الطبيب فقط إن
     * وُجد — فكان الطلب يُسجَّل بلا صاحب: لا يعرف المختصّ من يسأل، ولا تعود
     * النتيجة إلى طالبها. والرسالة أعلى النموذج تَعِد بأن «كل طلب يُسجَّل
     * باسمك»، فالمنع هنا أصدق من إرسالٍ مجهول.
     */
    if (!doctorId) return false;
    if (kind === "radiology") return examIds.length > 0;
    if (kind === "lab") return testIds.length > 0;
    if (kind === "vitals") return vitalsKind === "general" || vitalsPicked.length > 0;
    if (kind === "follow_up") return Boolean(followDate);
    if (kind === "collect_payment") return Number(amount) > 0;
    if (kind === "note") return body.trim().length > 0;
    // الصنف إلزاميّ في الموافقة، والسبب إلزاميّ في الإحالة — والقاعدة ترفض
    // دونهما، فالزرّ المعطَّل أصدق من نداءٍ يعود بخطأ.
    if (kind === "preauth") return Boolean(preauthItem);
    if (kind === "referral") return Boolean(referralDoctorId) && body.trim().length > 0;
    return true;
  }, [organization?.id, patientId, doctorId, kind, examIds, testIds, followDate, amount, body,
      vitalsKind, vitalsPicked.length, preauthItem, referralDoctorId]);

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
    setPreauthItem(null);
    setReferralDoctorId("");
  };

  const send = useMutation({
    mutationFn: async () => {
      const org = organization!.id;
      if (!doctorId) throw new Error("لم يُتعرَّف على الطبيب الطالب — لا يُسجَّل الطلب بلا طبيب");
      if (kind === "radiology") {
        const { error } = await supabase.rpc("app_create_radiology_order", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId,
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
          p_doctor_id: doctorId,
          p_test_ids: testIds,
          p_priority: priority,
          p_notes: instructions.trim() || null,
          // الفرع كان يُغفَل هنا وحده: `lab_orders.branch_id` يقبل `NULL` ولا
          // مُشغِّل يستنبطه، فطلب التحليل ينتهي بلا انتماء لفرع — لا في تقارير
          // الفرع ولا في إخطاراته — بينما طلب الأشعة من النموذج نفسه يُربَط.
          p_visit_id: null,
          p_branch_id: branch?.id ?? null,
          p_clinic_id: null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "vitals") {
        const { error } = await supabase.rpc("app_request_vital_signs", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_doctor_id: doctorId,
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
          p_doctor_id: doctorId,
          p_preferred_date: followDate,
          p_reason: body.trim() || null,
          p_preferred_period: period,
          p_clinic_id: null,
          p_branch_id: branch?.id ?? null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "preauth") {
        const { error } = await supabase.rpc("app_request_preauthorization", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_item_id: preauthItem!.id,
          p_service_description: body.trim() || preauthItem!.name_ar,
          p_doctor_id: doctorId,
          p_visit_id: null,
          p_clinic_id: null,
          p_qty: 1,
          p_requested_amount: amount ? Number(amount) : (preauthItem!.price ?? null),
          p_note: instructions.trim() || null,
        });
        if (error) throw error;
        return;
      }
      if (kind === "referral") {
        const { error } = await supabase.rpc("app_refer_patient_to_doctor", {
          p_organization_id: org,
          p_patient_id: patientId,
          p_to_doctor_id: referralDoctorId,
          p_from_doctor_id: doctorId,
          p_reason: body.trim(),
          p_preferred_date: followDate || null,
          p_clinic_id: null,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("app_create_staff_request", {
        p_organization_id: org,
        p_request_type: kind,
        p_patient_id: patientId,
        p_doctor_id: doctorId,
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
      queryClient.invalidateQueries({ queryKey: ["doctor-lab-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-requests"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-referrals-in"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-preauth"] });
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
        {!doctorId && !resolvingDoctor && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            لم يُتعرَّف على طبيبٍ مرتبطٍ بحسابك، والطلب لا يُسجَّل بلا طبيب طالب —
            يُربَط الحساب بملفّ الطبيب من شاشة «الأطباء».
          </p>
        )}
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
            placeholder={patientSearchPlaceholder(searchScopes)}
          />
          <PatientSearchScopeChips scopes={searchScopes} onScopesChange={setSearchScopes} />
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

        {kind === "preauth" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الخدمة المطلوب اعتمادها</Label>
              {preauthItem ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">{preauthItem.name_ar}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPreauthItem(null)}>
                    تغيير
                  </Button>
                </div>
              ) : (
                <ItemPicker
                  onSelect={(item) =>
                    setPreauthItem({
                      id: item.id,
                      name_ar: item.name_ar,
                      price: item.price ?? null,
                    })
                  }
                />
              )}
              <span className="text-[11px] text-muted-foreground">
                الصنف إلزاميّ: موافقةٌ بلا صنف تفتح كلّ خدمة تشترط موافقة.
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-pa-desc">وصف الخدمة</Label>
                <Input
                  id="dr-pa-desc"
                  dir="rtl"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={preauthItem?.name_ar ?? "يُملأ باسم الخدمة إن تُرك فارغًا"}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-pa-amount">المبلغ المطلوب</Label>
                <Input
                  id="dr-pa-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={preauthItem?.price != null ? String(preauthItem.price) : ""}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-pa-note">المبرّر الطبيّ</Label>
              <Textarea
                id="dr-pa-note"
                dir="rtl"
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="ما يجعل الإجراء ضروريًّا — هذا ما تقرؤه شركة التأمين"
              />
            </div>
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              الطلب يُحفظ <span className="font-semibold">مسوّدة</span>، ويرسله موظّف
              التأمين إلى الشركة من شاشة «التأمين». وعضوية المريض التأمينية
              تُستنبَط تلقائيًّا.
            </p>
          </div>
        )}

        {kind === "referral" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-ref-doc">الطبيب المُحال إليه</Label>
              {colleagues.isLoading && <Skeleton className="h-10 w-full" />}
              {!colleagues.isLoading && (colleagues.data ?? []).length === 0 && (
                <span className="text-xs text-destructive">
                  لا زملاء نشطون في هذه المنشأة غيرك.
                </span>
              )}
              <select
                id="dr-ref-doc"
                dir="rtl"
                value={referralDoctorId}
                onChange={(e) => setReferralDoctorId(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— اختر الطبيب —</option>
                {(colleagues.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name_ar}
                    {d.job_title ? ` — ${d.job_title}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-ref-reason">سبب الإحالة</Label>
              <Textarea
                id="dr-ref-reason"
                dir="rtl"
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="اشتباه خرّاج يحتاج جراحة فم — ما يصل الزميل فيعرف لماذا"
              />
              <span className="text-[11px] text-muted-foreground">
                إلزاميّ: إحالةٌ بلا سبب تصل الزميل بلا سؤال.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-ref-date">تاريخ مفضّل (اختياري)</Label>
              <Input
                id="dr-ref-date"
                type="date"
                value={followDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFollowDate(e.target.value)}
              />
            </div>
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              الإحالة طلبُ موعدٍ عند الزميل يحمل اسمك سببًا وتاريخًا، ويظهر عنده في
              «أُحيل إليّ» وعندك في «طلباتي».
            </p>
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
export function DoctorInbox({
  doctorId,
  resolvingDoctor = false,
}: {
  doctorId?: string | null;
  resolvingDoctor?: boolean;
}) {
  const { organization } = useOrganizationAccess();

  /**
   * الصندوق شخصيّ: بلا طبيبٍ محدَّد لا يُستعلم.
   *
   * الترشيح كان شرطيًّا (`if (doctorId) …`) فيسقط كليًّا حين تتعذّر معرفة
   * الطبيب — فيرى الطبيب نتائج ومؤشّرات **مرضى كل الأطباء** ويظنّها مرضاه.
   * سقوط المرشِّح في شاشة سريرية اطّلاعٌ على ملفّات لا علاقة له بها، لا مجرد
   * قائمة أطول.
   */
  const scoped = Boolean(organization?.id && doctorId);

  const vitals = useQuery({
    queryKey: ["doctor-vitals-inbox", organization?.id, doctorId],
    enabled: scoped,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_vitals_inbox")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("doctor_id", doctorId!)
        .order("recorded_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const inbox = useQuery({
    queryKey: ["doctor-inbox", organization?.id, doctorId],
    enabled: scoped,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_inbox")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("doctor_id", doctorId!)
        .order("last_image_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = inbox.data ?? [];
  const vitalRows = vitals.data ?? [];

  if (!scoped) {
    if (resolvingDoctor) return <Skeleton className="h-48 w-full" />;
    return (
      <Card>
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <BellRing className="h-9 w-9 text-muted-foreground" />
          <span className="font-medium">لم يُتعرَّف على طبيبٍ مرتبطٍ بحسابك</span>
          <span className="text-sm text-muted-foreground">
            هذا الصندوق يعرض ما وصل مرضاك وحدهم — يُربَط الحساب بملفّ الطبيب من
            شاشة «الأطباء».
          </span>
        </CardContent>
      </Card>
    );
  }

  if (inbox.isLoading || vitals.isLoading) return <Skeleton className="h-48 w-full" />;

  if (inbox.isError || vitals.isError) {
    const failure = (inbox.error ?? vitals.error) as Error | null;
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          تعذّر تحميل الصندوق: {failure?.message ?? "خطأ غير معروف"}
        </CardContent>
      </Card>
    );
  }

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
                {/* اكتشافٌ عاجل: عمودٌ يعلّمه الأخصّائي في 0014 ولم يكن يصل
                    الطبيب — وهو أهمّ ما في التقرير. */}
                {r.has_urgent_finding && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    اكتشاف عاجل
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm">{r.exam_names ?? "—"}</p>
              {/* قراءة الأخصّائي: `findings` و`impression` عمودان موجودان منذ
                  0014، وكان الصندوق يعرض ملاحظة الفنّيّ وحدها — فيفتح الطبيب
                  ملفّ المريض ليقرأ ما كان يجب أن يصله. */}
              {r.impression && (
                <p className="mt-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm">
                  <span className="font-medium">الانطباع التشخيصي: </span>
                  {r.impression}
                </p>
              )}
              {r.findings && (
                <p className="mt-1 whitespace-pre-line rounded-md bg-muted/60 px-2 py-1 text-sm">
                  <span className="font-medium">الموجودات: </span>
                  {r.findings}
                </p>
              )}
              {!r.findings && !r.impression && (
                <p className="mt-1 text-xs text-muted-foreground">
                  الصور رُفعت ولم تُكتب القراءة بعد.
                </p>
              )}
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


/* ══════════════════════════════════════════════════════════════════════════
 * نتائج المختبر — نظير صندوق الأشعة
 *
 * **الحلقة التي كانت مفتوحة:** `v_doctor_inbox` (0138) مبنيّ على
 * `radiology_orders` وحدها، وشاشة القيم الحرجة تعرض ما عُلِّم `is_critical`
 * فقط. فنتيجةٌ غير حرجة وخطيرة — سكّرٌ تراكميّ ٩٪ — كانت لا تصل أحدًا: يطلب
 * الطبيب التحليل، وتُدخَل النتيجة، وينتهي الأمر ما لم يفتح هو ملفّ المريض.
 * ════════════════════════════════════════════════════════════════════════ */

type LabInboxRow = {
  order_id: string;
  patient_id: string;
  patient_name: string;
  file_number: number | null;
  status: string;
  priority: string;
  ordered_at: string;
  item_count: number;
  resulted_count: number;
  abnormal_count: number;
  critical_count: number;
  test_names: string | null;
  last_result_at: string | null;
};

const LAB_STATUS_LABELS: Record<string, string> = {
  resulted: "أُدخلت النتائج",
  verified: "روجعت",
  approved: "اعتُمدت",
  delivered: "سُلِّمت",
};

export function DoctorLabInbox({
  doctorId,
  resolvingDoctor = false,
}: {
  doctorId?: string | null;
  resolvingDoctor?: boolean;
}) {
  const { organization } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const scoped = Boolean(organization?.id && doctorId);

  const inbox = useQuery({
    queryKey: ["doctor-lab-inbox", organization?.id, doctorId],
    enabled: scoped,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_lab_inbox")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("doctor_id", doctorId!)
        .order("last_result_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as LabInboxRow[];
    },
  });

  if (!scoped) {
    if (resolvingDoctor) return <Skeleton className="h-48 w-full" />;
    return (
      <Card>
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <FlaskConical className="h-9 w-9 text-muted-foreground" />
          <span className="font-medium">لم يُتعرَّف على طبيبٍ مرتبطٍ بحسابك</span>
          <span className="text-sm text-muted-foreground">
            هذا الصندوق يعرض نتائج مرضاك وحدهم — يُربَط الحساب بملفّ الطبيب من
            شاشة «الأطباء».
          </span>
        </CardContent>
      </Card>
    );
  }

  if (inbox.isLoading) return <Skeleton className="h-48 w-full" />;
  if (inbox.isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          تعذّر تحميل نتائج المختبر: {errorMessage(inbox.error)}
        </CardContent>
      </Card>
    );
  }

  const rows = inbox.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" />
          نتائج المختبر
        </CardTitle>
        <CardDescription>
          طلباتك التي أُدخلت نتائجها — <span className="font-semibold">الشاذّ منها
          أوّلًا</span>. الطلب الذي لم تُدخَل نتيجته بعد ليس هنا: صندوقٌ يمتلئ بما لا
          يُقرأ يُهمَل كلّه.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المريض</TableHead>
              <TableHead>التحاليل</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>النتائج</TableHead>
              <TableHead>آخر نتيجة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.order_id}>
                <TableCell className="text-sm">
                  <Link to={`/patients/${r.patient_id}`} className="font-medium hover:underline">
                    {r.patient_name}
                  </Link>
                  {r.file_number != null && (
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {r.file_number}
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[18rem] text-xs">{r.test_names ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {LAB_STATUS_LABELS[r.status] ?? r.status}
                  {r.priority !== "routine" && (
                    <Badge variant="destructive" className="ms-1">عاجل</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-mono">
                      {r.resulted_count}/{r.item_count}
                    </span>
                    {r.critical_count > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {r.critical_count} حرجة
                      </Badge>
                    )}
                    {r.abnormal_count > 0 && (
                      <Badge variant="secondary">{r.abnormal_count} شاذّة</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatDateTime(r.last_result_at, calendarDisplay)}
                </TableCell>
                <TableCell className="text-end">
                  <Link to={`/patients/${r.patient_id}`}>
                    <Button size="sm" variant="outline">
                      <CheckCircle2 className="h-4 w-4" />
                      فتح الملف
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  لا نتائج جديدة لمرضاك.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * طلباتي وحالتها — ومعها ما أُحيل إليّ
 *
 * **الحلقة التي كانت مفتوحة:** لوحة الطلبات أعلاه إرسالٌ فقط. يطلب الطبيب
 * تحليلًا ولا يعرف أأُخذت العيّنة أم رُفض الطلب أم ما زال منتظرًا منذ ساعتين،
 * فيسأل بالصوت — وهو ما بُنيت اللوحة لإلغائه.
 * ════════════════════════════════════════════════════════════════════════ */

type DoctorRequestRow = {
  id: string;
  patient_id: string;
  patient_name: string;
  file_number: number | null;
  kind: "lab" | "radiology" | "vitals" | "staff" | "follow_up" | "referral";
  kind_label: string;
  status: string;
  priority: string | null;
  requested_at: string;
  closed_at: string | null;
  body: string | null;
};

type ReferralInRow = {
  request_id: string;
  patient_id: string;
  patient_name: string;
  file_number: number | null;
  referred_by_name: string | null;
  reason: string | null;
  preferred_date: string | null;
  status: string;
  created_at: string;
};

/** الحالات التي تعني «انتهى» في أيٍّ من الجداول الخمسة. */
const CLOSED_STATUSES = new Set([
  "delivered", "approved", "verified", "done", "cancelled", "rejected", "resulted",
]);

export function DoctorRequestsPanel({
  doctorId,
  resolvingDoctor = false,
}: {
  doctorId?: string | null;
  resolvingDoctor?: boolean;
}) {
  const { organization } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const [openOnly, setOpenOnly] = useState(true);
  const scoped = Boolean(organization?.id && doctorId);

  const requests = useQuery({
    queryKey: ["doctor-requests", organization?.id, doctorId],
    enabled: scoped,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_requests")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("doctor_id", doctorId!)
        .order("requested_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as DoctorRequestRow[];
    },
  });

  const referrals = useQuery({
    queryKey: ["doctor-referrals-in", organization?.id, doctorId],
    enabled: scoped,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_referrals_in")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("doctor_id", doctorId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ReferralInRow[];
    },
  });

  if (!scoped) {
    if (resolvingDoctor) return <Skeleton className="h-48 w-full" />;
    return (
      <Card>
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <ClipboardList className="h-9 w-9 text-muted-foreground" />
          <span className="font-medium">لم يُتعرَّف على طبيبٍ مرتبطٍ بحسابك</span>
          <span className="text-sm text-muted-foreground">
            هذه الشاشة تعرض طلباتك أنت — يُربَط الحساب بملفّ الطبيب من شاشة
            «الأطباء».
          </span>
        </CardContent>
      </Card>
    );
  }

  const all = requests.data ?? [];
  const rows = openOnly
    ? all.filter((r) => !r.closed_at && !CLOSED_STATUSES.has(r.status))
    : all;
  const inbound = (referrals.data ?? []).filter((r) => !openOnly || r.status === "pending");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              طلباتي وحالتها
            </CardTitle>
            <CardDescription>
              كل ما أرسلته: تحاليل وأشعة ومؤشّرات وطلبات الاستقبال ومواعيد المتابعة
              والإحالات — بحالة كلٍّ منها.
            </CardDescription>
          </div>
          <Button variant="ghost" onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? "عرض المنتهية أيضًا" : "المفتوحة فقط"}
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading && <Skeleton className="h-40 w-full" />}
          {requests.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل الطلبات: {errorMessage(requests.error)}
            </p>
          )}
          {!requests.isLoading && !requests.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>التفاصيل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>أُرسل</TableHead>
                  <TableHead>أُغلق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  /* المفتاح مركَّب: الإحالة صفٌّ واحد يظهر بنوعين، فـ`id` وحده
                     يتكرّر. */
                  <TableRow key={`${r.kind}:${r.id}`}>
                    <TableCell className="text-xs font-medium">
                      {r.kind_label}
                      {r.priority && r.priority !== "routine" && (
                        <Badge variant="destructive" className="ms-1">عاجل</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link to={`/patients/${r.patient_id}`} className="hover:underline">
                        {r.patient_name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[16rem] text-xs text-muted-foreground">
                      {r.body ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(r.requested_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.closed_at ? formatDateTime(r.closed_at, calendarDisplay) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {openOnly ? "لا طلبات مفتوحة." : "لا طلبات."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4" />
            أُحيل إليّ
          </CardTitle>
          <CardDescription>
            ما أحاله الزملاء إليك ومعه سببه — الإحالة طلب موعد، ويحجزه الاستقبال.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {referrals.isLoading && <Skeleton className="h-24 w-full" />}
          {referrals.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل الإحالات: {errorMessage(referrals.error)}
            </p>
          )}
          {!referrals.isLoading && !referrals.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>المُحيل</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {inbound.map((r) => (
                  <TableRow key={r.request_id}>
                    <TableCell className="text-sm">
                      <Link to={`/patients/${r.patient_id}`} className="hover:underline">
                        {r.patient_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{r.referred_by_name ?? "—"}</TableCell>
                    <TableCell className="max-w-[18rem] text-xs">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(r.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link to={`/patients/${r.patient_id}`}>
                        <Button size="sm" variant="ghost">فتح الملف</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {inbound.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا إحالات {openOnly ? "معلّقة" : ""}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
