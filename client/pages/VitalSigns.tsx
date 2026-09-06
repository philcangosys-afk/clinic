import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCcw,
  Stethoscope,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import VitalSignsForm, { VITAL_MEASURES } from "@/components/medical/VitalSignsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

const MEASURE_LABEL: Record<string, string> = Object.fromEntries(
  VITAL_MEASURES.map((m) => [m.key, m.label]),
);

/**
 * رتبة الأولوية للترتيب.
 *
 * `priority` عمود نصّي (`routine | urgent`)، والترتيب الأبجدي التصاعدي يضع
 * `routine` أوّلًا و`urgent` آخرًا — أي أن الطلب العاجل يقع في ذيل الطابور
 * تحت لافتةٍ حمراء تقول إنه عاجل. الرتبة الصريحة تصحّح الترتيب.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, routine: 1 };

type QueueRow = {
  request_id: string;
  patient_id: string;
  patient_name: string;
  patient_id_number: string | null;
  patient_phone: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  request_kind: string;
  measures: string[];
  priority: string;
  note: string | null;
  requested_at: string;
  visit_id: string | null;
};

/**
 * شاشة المؤشرات الحيوية — المرحلة 34.
 *
 * مكانٌ واحد لثلاثة أدوار: الاستقبال يقيس عند الدخول، والمختبر ينفّذ ما طلبه
 * الأطباء، والطبيب يرى. فصلُها إلى ثلاث شاشات كان يعني ثلاث نسخ من نموذج
 * واحد تفترق أوّل تعديل.
 *
 * الطابور هو القلب: كل طلب فيه له مريض وطبيبٌ يعود إليه الناتج. وحين يُسجَّل
 * القياس يُغلق الطلب ويصل الطبيب في عملية واحدة — لا خطوة ثانية ينساها أحد.
 */
export default function VitalSigns() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("queue");
  const [target, setTarget] = useState<QueueRow | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["vitals-queue", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_vital_sign_queue")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return [...((data ?? []) as QueueRow[])].sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          String(a.requested_at ?? "").localeCompare(String(b.requested_at ?? "")),
      );
    },
  });

  const today = useQuery({
    queryKey: ["vitals-today", organization?.id],
    enabled: Boolean(organization?.id) && tab === "today",
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("v_patient_vitals")
        .select("*")
        .eq("organization_id", organization!.id)
        .gte("recorded_at", since.toISOString())
        .order("recorded_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as any[];

      // اسم المريض لا يحمله المنظور (`v_patient_vitals` لا يضمّ `patients`)،
      // فوُضع نصّ ثابت «عرض الملف» مكان الاسم — وتبويب «قياسات اليوم» صار صفوفًا
      // متطابقة لا يُعرف صاحب أيٍّ منها إلّا بفتحه، وهو نقيض الغرض منه.
      const ids = Array.from(new Set(rows.map((row) => row.patient_id).filter(Boolean)));
      if (ids.length > 0) {
        const { data: people, error: peopleError } = await supabase
          .from("patients")
          .select("id, name_ar, id_number")
          .in("id", ids);
        if (peopleError) throw peopleError;
        const byId = new Map(((people ?? []) as any[]).map((row) => [row.id, row]));
        for (const row of rows) {
          const person = byId.get(row.patient_id);
          row.patient_name = person?.name_ar ?? null;
          row.patient_id_number = person?.id_number ?? null;
        }
      }
      return rows;
    },
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      setCancelling(id);
      const { error } = await supabase.rpc("app_cancel_vital_request", {
        p_request_id: id,
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vitals-queue"] });
      toast({ title: "أُلغي الطلب" });
    },
    onError: (err: any) =>
      toast({ title: "تعذّر الإلغاء", description: err?.message, variant: "destructive" }),
    onSettled: () => setCancelling(null),
  });

  const rows = queue.data ?? [];
  const urgent = rows.filter((r) => r.priority === "urgent");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المؤشرات الحيوية</h1>
          <p className="text-sm text-muted-foreground">
            ما طلبه الأطباء والاستقبال، وتسجيل القياس عند الدخول
          </p>
        </div>
        <Button variant="outline" onClick={() => queue.refetch()}>
          <RefreshCcw className="h-4 w-4" />
          تحديث
        </Button>
      </div>

      {urgent.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-destructive" />
              {urgent.length} طلب عاجل
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">
            طابور القياس {rows.length > 0 && `(${rows.length})`}
          </TabsTrigger>
          <TabsTrigger value="record">تسجيل مباشر</TabsTrigger>
          <TabsTrigger value="today">قياسات اليوم</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 flex flex-col gap-3">
          {queue.isLoading && <Skeleton className="h-56 w-full" />}
          {/* الفشل يُعرض فشلًا: «لا طلبات معلّقة» على استعلامٍ سقط يقرأه
              المستخدم طابورًا فارغًا فيمضي، والطلبات معلّقة فعلًا. */}
          {queue.isError && (
            <Card className="border-destructive">
              <CardContent className="py-6 text-center text-sm text-destructive">
                تعذّر تحميل الطابور: {(queue.error as any)?.message ?? "خطأ غير معروف"}
              </CardContent>
            </Card>
          )}
          {!queue.isLoading && !queue.isError && rows.length === 0 && (
            <Card>
              <CardContent className="grid place-items-center gap-2 py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                <span className="font-medium">لا طلبات معلّقة</span>
                <span className="text-sm text-muted-foreground">
                  لتسجيل قياسٍ بلا طلب، استعمل تبويب «تسجيل مباشر».
                </span>
              </CardContent>
            </Card>
          )}

          {rows.map((row) => (
            <Card key={row.request_id} className={target?.request_id === row.request_id ? "border-primary" : ""}>
              <CardContent className="flex flex-col gap-3 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.priority === "urgent" && <Badge variant="destructive">عاجل</Badge>}
                      <Badge variant="outline">
                        {row.request_kind === "general" ? "طلب عام" : "طلب خاص"}
                      </Badge>
                      <Link
                        to={`/patients/${row.patient_id}`}
                        className="text-base font-bold underline-offset-4 hover:underline"
                      >
                        {row.patient_name}
                      </Link>
                      {row.patient_id_number && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {row.patient_id_number}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {(row.measures ?? []).map((m) => (
                        <span
                          key={m}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                        >
                          {MEASURE_LABEL[m] ?? m}
                        </span>
                      ))}
                    </p>
                    {row.note && <p className="mt-1 text-sm text-muted-foreground">{row.note}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.doctor_name ? (
                        <>
                          <Stethoscope className="me-1 inline h-3 w-3" />
                          يعود إلى {row.doctor_name} ·{" "}
                        </>
                      ) : (
                        "بلا طبيب محدّد · "
                      )}
                      {new Date(row.requested_at).toLocaleString("ar")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        setTarget(target?.request_id === row.request_id ? null : row)
                      }
                    >
                      <ClipboardList className="h-4 w-4" />
                      {target?.request_id === row.request_id ? "إغلاق" : "تسجيل القياس"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancelling === row.request_id}
                      onClick={() => cancel.mutate(row.request_id)}
                    >
                      {cancelling === row.request_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {target?.request_id === row.request_id && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <VitalSignsForm
                      patientId={row.patient_id}
                      requestId={row.request_id}
                      doctorId={row.doctor_id}
                      visitId={row.visit_id}
                      measures={row.measures}
                      onSaved={() => {
                        setTarget(null);
                        queue.refetch();
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="record" className="mt-4">
          <DirectRecordPanel />
        </TabsContent>

        <TabsContent value="today" className="mt-4">
          {today.isLoading && <Skeleton className="h-48 w-full" />}
          {today.isError && (
            <Card className="border-destructive">
              <CardContent className="py-10 text-center text-sm text-destructive">
                تعذّر تحميل قياسات اليوم: {(today.error as any)?.message ?? "خطأ غير معروف"}
              </CardContent>
            </Card>
          )}
          {!today.isLoading && !today.isError && (today.data ?? []).length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                لا قياسات اليوم
              </CardContent>
            </Card>
          )}
          <div className="flex flex-col gap-2">
            {(today.data ?? []).map((v) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <Link
                    to={`/patients/${v.patient_id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {v.patient_name ?? "عرض الملف"}
                  </Link>
                  {v.patient_id_number && (
                    <span className="ms-2 text-xs text-muted-foreground tabular-nums">
                      {v.patient_id_number}
                    </span>
                  )}
                  <p className="mt-0.5 text-sm tabular-nums">
                    {v.blood_pressure_systolic && v.blood_pressure_diastolic
                      ? `ضغط ${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} · `
                      : ""}
                    {v.heart_rate ? `نبض ${v.heart_rate} · ` : ""}
                    {v.temperature_celsius ? `حرارة ${v.temperature_celsius} · ` : ""}
                    {v.bmi ? `كتلة ${v.bmi}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{v.source_label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.recorded_at).toLocaleTimeString("ar")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** قياس بلا طلب: ما يفعله الاستقبال حين يصل المريض. */
function DirectRecordPanel() {
  const { organization } = useOrganizationAccess();
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");

  const patients = useQuery({
    queryKey: ["vitals-direct-patients", organization?.id, search],
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

  const doctors = useQuery({
    queryKey: ["vitals-direct-doctors", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">تسجيل قياس مباشر</CardTitle>
        {/* الوعد القديم («اختيار الطبيب يجعل القياس يصل لوحته») لا يتحقّق:
            صندوق الطبيب يقرأ `v_doctor_vitals_inbox` المبنيّ على **طلب** مُغلق،
            والقياس المباشر لا يُنشئ طلبًا — فلا صلة تربطه بالطبيب. تصحيح النصّ
            حتى لا يظنّ الاستقبال أنه أرسل قياسًا لم يصل أحدًا. */}
        <CardDescription>
          للمريض الذي يصل بلا طلب — قياس الاستقبال عند الدخول. القياس يُحفظ في ملف
          المريض؛ ولإيصاله إلى لوحة الطبيب اطلبه من لوحته حتى يُسجَّل على طلب.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vs-patient">المريض</Label>
            <Input
              dir="rtl"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو رقم الهوية"
            />
            <select
              id="vs-patient"
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vs-doctor">الطبيب (اختياري)</Label>
            <select
              id="vs-doctor"
              dir="rtl"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— بلا طبيب —</option>
              {(doctors.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name_ar}
                </option>
              ))}
            </select>
          </div>
        </div>

        {patientId ? (
          <div className="rounded-lg border bg-muted/20 p-4">
            <VitalSignsForm patientId={patientId} doctorId={doctorId || null} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            اختر المريض أولًا.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
