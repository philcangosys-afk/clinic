import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BUCKET = "result-attachments";
const MAX_BYTES = 20 * 1024 * 1024;

type QueueRow = {
  order_id: string;
  patient_id: string;
  patient_name: string;
  patient_id_number: string | null;
  patient_phone: string | null;
  ordering_doctor_id: string | null;
  doctor_name: string | null;
  status: string;
  priority: string;
  clinical_indication: string | null;
  notes: string | null;
  ordered_at: string;
  exam_names: string | null;
  modalities: string | null;
  item_count: number;
  image_count: number;
};

const PRIORITY_LABEL: Record<string, string> = {
  routine: "عادي",
  urgent: "عاجل",
  stat: "طارئ",
};

const STATUS_LABEL: Record<string, string> = {
  ordered: "مطلوب",
  scheduled: "مجدول",
  arrived: "حضر",
  in_progress: "قيد التنفيذ",
};

/**
 * شاشة مختصّ الأشعة — المرحلة 33.
 *
 * تحلّ مشكلة واقعية: الطبيب كان يطلب الصورة، والمختصّ لا يرى الطلب في
 * النظام، فيصل المريض ومعه ورقة. وحين تُصوَّر لا يعلم الطبيب حتى يسأل.
 *
 * هنا طرفا الحلقة: «ما طُلب مني» و«رفع الصور». والرفع عملية واحدة ذرّية في
 * القاعدة (`app_radiology_deliver_images`): إمّا أن تُسجَّل الصور وتنتقل
 * الحالة ويُخطر الطبيب معًا، أو لا يحدث شيء. فلا يبقى طلبٌ «جاهز» بلا صور،
 * ولا صورةٌ لا يعلم بها أحد.
 */
export default function RadiologyConsole() {
  const { organization, branch } = useOrganizationAccess();
  const [tab, setTab] = useState("queue");
  const [target, setTarget] = useState<QueueRow | null>(null);

  const queue = useQuery({
    queryKey: ["rad-console-queue", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_radiology_console_queue")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("priority", { ascending: true })
        .order("ordered_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QueueRow[];
    },
  });

  const rows = queue.data ?? [];
  const urgent = rows.filter((r) => r.priority !== "routine");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">قسم الأشعة</h1>
          <p className="text-sm text-muted-foreground">
            ما طلبه الأطباء، ورفع الصور إلى ملف المريض
          </p>
        </div>
        <Button variant="outline" onClick={() => queue.refetch()}>
          <RefreshCcw className="h-4 w-4" />
          تحديث
        </Button>
      </div>

      {urgent.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-destructive" />
              {urgent.length} طلب عاجل أو طارئ
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">
            المطلوب مني {rows.length > 0 && `(${rows.length})`}
          </TabsTrigger>
          <TabsTrigger value="upload">رفع صور</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          {queue.isLoading && <Skeleton className="h-64 w-full" />}
          {!queue.isLoading && rows.length === 0 && (
            <Card>
              <CardContent className="grid place-items-center gap-2 py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                <span className="font-medium">لا طلبات معلّقة</span>
                <span className="text-sm text-muted-foreground">
                  كل ما طُلب من القسم رُفعت صوره. يمكنك الرفع المباشر من تبويب «رفع صور».
                </span>
              </CardContent>
            </Card>
          )}
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <Card key={row.order_id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={row.priority === "routine" ? "secondary" : "destructive"}>
                        {PRIORITY_LABEL[row.priority] ?? row.priority}
                      </Badge>
                      <Badge variant="outline">{STATUS_LABEL[row.status] ?? row.status}</Badge>
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
                    <p className="mt-1.5 text-sm font-medium">{row.exam_names ?? "—"}</p>
                    {row.clinical_indication && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">دواعي التصوير: </span>
                        {row.clinical_indication}
                      </p>
                    )}
                    {row.notes && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">تعليمات: </span>
                        {row.notes}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      الطبيب الطالب: {row.doctor_name ?? "—"} ·{" "}
                      {new Date(row.ordered_at).toLocaleString("ar")}
                      {row.image_count > 0 && ` · ${row.image_count} صورة مرفوعة`}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setTarget(row);
                      setTab("upload");
                    }}
                  >
                    <ImagePlus className="h-4 w-4" />
                    رفع الصور
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <UploadPanel
            organizationId={organization?.id}
            branchId={branch?.id ?? null}
            target={target}
            onClear={() => setTarget(null)}
            onDone={() => {
              setTarget(null);
              setTab("queue");
              queue.refetch();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * لوحة الرفع.
 *
 * المسار الذي وصفه التشغيل: اختر الطبيب ← تُفتح قائمة مرضاه ← اختر المريض ←
 * ارفع صورة أو أكثر بملاحظة ← احفظ وأرسل.
 *
 * «مرضى الطبيب» ليست كل مرضى المنشأة: هم من له معهم موعد أو زيارة أو طلب.
 * لو لم يكن المريض منهم — أوّل مراجعة مثلًا — يُفتح البحث في كل المرضى
 * بضغطة، لأن منعَه يعني أن يقف العمل عند حالةٍ واقعية.
 */
function UploadPanel({
  organizationId,
  branchId,
  target,
  onClear,
  onDone,
}: {
  organizationId?: string;
  branchId: string | null;
  target: QueueRow | null;
  onClear: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [doctorId, setDoctorId] = useState<string>(target?.ordering_doctor_id ?? "");
  const [patientId, setPatientId] = useState<string>(target?.patient_id ?? "");
  const [examId, setExamId] = useState<string>("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [allPatients, setAllPatients] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // الطلب المختار من القائمة يملأ الحقول مرة واحدة.
  const lockedOrder = target?.order_id ?? null;
  const effectiveDoctor = lockedOrder ? target!.ordering_doctor_id ?? "" : doctorId;
  const effectivePatient = lockedOrder ? target!.patient_id : patientId;

  const doctors = useQuery({
    queryKey: ["rad-upload-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId!)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const patients = useQuery({
    queryKey: ["rad-upload-patients", organizationId, effectiveDoctor, allPatients, search],
    enabled: Boolean(organizationId) && (allPatients || Boolean(effectiveDoctor)),
    queryFn: async () => {
      if (allPatients) {
        let q = supabase
          .from("patients")
          .select("id, name_ar, id_number")
          .eq("organization_id", organizationId!)
          .order("name_ar")
          .limit(50);
        if (search.trim()) {
          q = q.or(`name_ar.ilike.%${search.trim()}%,id_number.ilike.%${search.trim()}%`);
        }
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as { id: string; name_ar: string; id_number: string | null }[];
      }

      // مرضى الطبيب: من مواعيده وزياراته وطلباته — بلا جدول وسيط جديد.
      const [appts, visits, orders] = await Promise.all([
        supabase
          .from("appointments")
          .select("patient_id")
          .eq("organization_id", organizationId!)
          .eq("doctor_id", effectiveDoctor)
          .limit(300),
        supabase
          .from("patient_visits")
          .select("patient_id")
          .eq("organization_id", organizationId!)
          .eq("doctor_id", effectiveDoctor)
          .limit(300),
        supabase
          .from("radiology_orders")
          .select("patient_id")
          .eq("organization_id", organizationId!)
          .eq("ordering_doctor_id", effectiveDoctor)
          .limit(300),
      ]);
      const ids = Array.from(
        new Set(
          [...(appts.data ?? []), ...(visits.data ?? []), ...(orders.data ?? [])]
            .map((r: any) => r.patient_id)
            .filter(Boolean),
        ),
      );
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("patients")
        .select("id, name_ar, id_number")
        .in("id", ids)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; id_number: string | null }[];
    },
  });

  const exams = useQuery({
    queryKey: ["rad-upload-exams", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("radiology_exams")
        .select("id, name_ar, modality")
        .eq("organization_id", organizationId!)
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; modality: string }[];
    },
  });

  const patientList = patients.data ?? [];
  const examList = exams.data ?? [];

  const canSave = useMemo(
    () => Boolean(organizationId && effectivePatient && examId && files.length > 0 && !busy),
    [organizationId, effectivePatient, examId, files.length, busy],
  );

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      toast({
        title: "ملف كبير",
        description: `${tooBig.name} يتجاوز 20 ميجابايت.`,
        variant: "destructive",
      });
      return;
    }
    setFiles((prev) => [...prev, ...picked]);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا منشأة");
      setBusy(true);
      const uploaded: { path: string; name: string; mime: string; size: string }[] = [];
      try {
        for (const file of files) {
          const safe = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `${organizationId}/radiology/${effectivePatient}/${Date.now()}-${safe}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, file);
          if (error) throw error;
          uploaded.push({
            path,
            name: file.name,
            mime: file.type || "application/octet-stream",
            size: String(file.size),
          });
        }

        const { data, error } = await supabase.rpc("app_radiology_deliver_images", {
          p_organization_id: organizationId,
          p_patient_id: effectivePatient,
          p_doctor_id: effectiveDoctor || null,
          p_exam_id: examId,
          p_images: uploaded,
          p_order_id: lockedOrder,
          p_note: note.trim() || null,
          p_branch_id: branchId,
        });
        if (error) throw error;
        return data as string;
      } catch (err) {
        // الملفات التي رُفعت قبل الفشل تُزال، وإلّا بقيت في التخزين بلا سجلّ
        // يشير إليها — ملفات يتيمة لا يراها أحد ولا يحذفها أحد.
        if (uploaded.length > 0) {
          await supabase.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
        }
        throw err;
      } finally {
        setBusy(false);
      }
    },
    onSuccess: () => {
      toast({ title: "حُفظت وأُرسلت", description: "الصور في ملف المريض، ووصل الطبيب إشعار." });
      setFiles([]);
      setNote("");
      setExamId("");
      queryClient.invalidateQueries({ queryKey: ["rad-console-queue"] });
      onDone();
    },
    onError: (err: any) => {
      toast({
        title: "تعذّر الحفظ",
        description: err?.message ?? "خطأ غير معروف",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {lockedOrder ? "رفع صور لطلب قائم" : "رفع صور مباشر"}
        </CardTitle>
        <CardDescription>
          {lockedOrder
            ? `${target!.patient_name} — ${target!.exam_names ?? ""} (طلب ${target!.doctor_name ?? "—"})`
            : "للمريض الذي وصل بلا طلب مسبق: اختر الطبيب ثم المريض."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {lockedOrder && (
          <Button variant="ghost" size="sm" className="self-start" onClick={onClear}>
            <X className="h-4 w-4" />
            إلغاء الربط بالطلب والرفع المباشر
          </Button>
        )}

        {!lockedOrder && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-doctor">الطبيب</Label>
              <select
                id="rc-doctor"
                dir="rtl"
                value={doctorId}
                onChange={(e) => {
                  setDoctorId(e.target.value);
                  setPatientId("");
                }}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— اختر الطبيب —</option>
                {(doctors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="rc-patient">المريض</Label>
                <button
                  type="button"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                  onClick={() => setAllPatients((v) => !v)}
                >
                  {allPatients ? "مرضى الطبيب فقط" : "بحث في كل المرضى"}
                </button>
              </div>
              {allPatients && (
                <Input
                  dir="rtl"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="اسم أو رقم هوية"
                  className="mb-1"
                />
              )}
              <select
                id="rc-patient"
                dir="rtl"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                disabled={!allPatients && !doctorId}
                className="h-10 rounded-md border bg-background px-3 text-sm disabled:opacity-50"
              >
                <option value="">
                  {!allPatients && !doctorId ? "— اختر الطبيب أولًا —" : "— اختر المريض —"}
                </option>
                {patientList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_ar}
                    {p.id_number ? ` — ${p.id_number}` : ""}
                  </option>
                ))}
              </select>
              {!allPatients && doctorId && !patients.isLoading && patientList.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  لا مرضى مسجَّلون لهذا الطبيب — استعمل «بحث في كل المرضى».
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rc-exam">نوع التصوير</Label>
          <select
            id="rc-exam"
            dir="rtl"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر الفحص —</option>
            {examList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name_ar}
              </option>
            ))}
          </select>
          {examList.length === 0 && !exams.isLoading && (
            <span className="text-xs text-destructive">
              لا فحوص في الكتالوج — أضفها من شاشة «الأشعة» أولًا.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label>الصور</Label>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.dcm"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition",
              "border-border hover:border-primary hover:bg-accent/5",
            )}
          >
            <Upload className="h-7 w-7 text-muted-foreground" />
            <span className="text-sm font-medium">اختر الصور من الحاسوب</span>
            <span className="text-xs text-muted-foreground">
              صورة أو أكثر · حتى 20 ميجابايت للملف
            </span>
          </button>

          {files.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {(f.size / 1024).toFixed(0)} ك.ب
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rc-note">ملاحظات المختصّ (اختياري)</Label>
          <Textarea
            id="rc-note"
            dir="rtl"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: الصورة الثانية بوضع جانبي — المريض لم يستطع الوقوف"
          />
          <span className="text-xs text-muted-foreground">
            هذه ملاحظة تشغيلية تصل الطبيب مع الصور، وليست تقريرًا طبيًّا.
          </span>
        </div>

        <Button className="h-11" disabled={!canSave} onClick={() => save.mutate()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          حفظ وإرسال إلى الطبيب
        </Button>
      </CardContent>
    </Card>
  );
}
