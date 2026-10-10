import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  ImageIcon,
  Loader2,
  Plus,
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
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BUCKET = "result-attachments";
const MAX_BYTES = 20 * 1024 * 1024;

const ADVERSE = [
  { key: "none", label: "بلا أعراض" },
  { key: "redness", label: "احمرار" },
  { key: "swelling", label: "تورّم" },
  { key: "blistering", label: "تقرّح" },
  { key: "burn", label: "حرق" },
  { key: "hyperpigmentation", label: "فرط تصبّغ" },
  { key: "hypopigmentation", label: "نقص تصبّغ" },
  { key: "pain", label: "ألم" },
  { key: "itching", label: "حكّة" },
  { key: "infection", label: "التهاب" },
  { key: "scarring", label: "ندبة" },
];

/**
 * جلسات الجلدية والتجميل — المرحلة 36.
 *
 * ما يميّز جلسة الليزر عن أيّ خدمة: أنها **سلسلة** لا حدثًا واحدًا. فما
 * يُقرأ قبل الجلسة هو ما جرى في سابقتها — الجهاز، والطاقة، والمنطقة، وهل
 * ظهر عرضٌ جانبيّ. لذلك يعرض هذا اللوح آخر جلسة **قبل** نموذج التسجيل، لا
 * بعده: القرار يُتخذ قبل الضغط لا بعده.
 *
 * والفاصل الزمنيّ ليس تنظيمًا إداريًّا: التبكير في الليزر يحرق. القاعدة
 * ترفضه إلا بسببٍ مُعلَّل يبقى مكتوبًا.
 */
export default function SessionsPanel({ patientId }: { patientId: string }) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const history = useQuery({
    queryKey: ["session-history", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_session_history")
        .select("*")
        .eq("patient_id", patientId)
        .order("performed_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const due = useQuery({
    queryKey: ["sessions-due", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sessions_due")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = history.data ?? [];
  const dueRows = due.data ?? [];
  const overdue = dueRows.filter((d) => Number(d.days_overdue ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      {dueRows.length > 0 && (
        <Card className={overdue.length > 0 ? "border-amber-500" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              الجلسات المستحقّة
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dueRows.map((d) => (
              <div
                key={d.last_session_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <strong>{d.service_name ?? "خدمة"}</strong>
                  {d.body_area ? ` — ${d.body_area}` : ""}
                  <span className="ms-2 text-xs text-muted-foreground">
                    الجلسة {d.session_number}
                    {d.default_sessions_count ? ` من ${d.default_sessions_count}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {Number(d.days_overdue ?? 0) > 0 ? (
                    <Badge variant="destructive">
                      متأخّرة {d.days_overdue} يومًا
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      {new Date(d.next_due_date).toLocaleDateString("ar-u-nu-latn")}
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">جلسات العلاج</CardTitle>
            <CardDescription>
              الجهاز والمنطقة والإعدادات — ما يُقرأ قبل الجلسة التالية
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {open ? "إغلاق" : "تسجيل جلسة"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {open && (
            <RecordSession
              patientId={patientId}
              organizationId={organization?.id}
              branchId={branch?.id ?? null}
              lastSession={rows[0]}
              onSaved={() => {
                setOpen(false);
                queryClient.invalidateQueries({ queryKey: ["session-history", patientId] });
                queryClient.invalidateQueries({ queryKey: ["sessions-due", patientId] });
              }}
            />
          )}

          {history.isLoading && <Skeleton className="h-40 w-full" />}
          {!history.isLoading && rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لا جلسات مسجَّلة لهذا المريض.
            </p>
          )}

          {rows.map((s) => (
            <SessionRow key={s.id} session={s} organizationId={organization?.id} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RecordSession({
  patientId,
  organizationId,
  branchId,
  lastSession,
  onSaved,
}: {
  patientId: string;
  organizationId?: string;
  branchId: string | null;
  lastSession?: any;
  onSaved: () => void;
}) {
  const { session } = useOrganizationAccess();
  const userId = session?.user.id;
  const [itemId, setItemId] = useState(lastSession?.item_id ?? "");
  const [areaId, setAreaId] = useState(lastSession?.body_area_value_id ?? "");
  const [deviceId, setDeviceId] = useState(lastSession?.device_resource_id ?? "");
  const [doctorId, setDoctorId] = useState("");
  const [params, setParams] = useState<Record<string, string>>(
    lastSession?.parameters && typeof lastSession.parameters === "object"
      ? { ...lastSession.parameters }
      : {},
  );
  const [events, setEvents] = useState<string[]>(["none"]);
  const [adverseNote, setAdverseNote] = useState("");
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);

  /**
   * قوائم الاختيار تعرض النشط غير المؤرشف وحده.
   *
   * كانت الثلاثة بلا ترشيح — بخلاف `ItemPicker` و`LookupSelect` و`Assets` —
   * فتظهر خدمات أُخرجت من الكتالوج (وأسعارها قديمة)، ومناطق جسم معطَّلة،
   * وأجهزة موقوفة عن العمل كأنها صالحة. اختيارٌ من قائمةٍ كهذه يُسجِّل جلسة
   * على صنفٍ أو جهازٍ لا يُستعمل اليوم.
   */
  const services = useQuery({
    queryKey: ["session-services", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, default_sessions_count, session_interval_days, min_interval_days")
        .eq("organization_id", organizationId!)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .not("default_sessions_count", "is", null)
        .order("name_ar")
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const areas = useQuery({
    queryKey: ["body-areas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, name_ar, lookup_categories!inner(key)")
        .eq("lookup_categories.key", "body_parts")
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const devices = useQuery({
    queryKey: ["session-devices", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("id, name_ar")
        .eq("organization_id", organizationId!)
        .eq("resource_type", "device")
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * منتقي الطبيب — الجلسة كانت تُسجَّل بلا **من نفّذها**.
   *
   * النموذج لم يحتوِ منتقيًا أصلًا والنداء يمرّر `p_doctor_id: null` ثابتًا،
   * والدالّة تُدرج ما وصلها ولا تستنبطه — فيبقى `performed_by = auth.uid()`
   * وحده، ولا يُعرف في الجلسة التالية من ضبط الإعدادات ولا يمكن تقرير
   * «جلسات لكل طبيب». والمبدئي هو الطبيب المرتبط بالجلسة الحالية إن وُجد.
   */
  const doctors = useQuery({
    queryKey: ["session-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, user_id")
        .eq("organization_id", organizationId!)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; user_id: string | null }[];
    },
  });

  // التعبئة المبدئية مرّة واحدة فقط: من أفرغ المنتقي بنفسه لا يُعاد ملؤه فوقه.
  const doctorPrefilled = useRef(false);
  useEffect(() => {
    if (doctorPrefilled.current || !userId) return;
    const mine = (doctors.data ?? []).find((d) => d.user_id === userId);
    if (!mine) return;
    doctorPrefilled.current = true;
    setDoctorId(mine.id);
  }, [doctors.data, userId]);

  const service = (services.data ?? []).find((s) => s.id === itemId);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_record_treatment_session", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_item_id: itemId,
        p_doctor_id: doctorId || null,
        p_body_area_value_id: areaId || null,
        p_device_resource_id: deviceId || null,
        p_parameters: params,
        p_adverse_events: events,
        p_adverse_note: adverseNote.trim() || null,
        p_note: note.trim() || null,
        p_agreement_item_id: null,
        p_package_id: null,
        p_override_reason: override.trim() || null,
        p_branch_id: branchId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: "سُجّلت الجلسة" });
      setNeedsOverride(false);
      setOverride("");
      onSaved();
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? "");
      if (msg.includes("أقلّ فاصل مسموح")) {
        setNeedsOverride(true);
        toast({ title: "الجلسة قبل أوانها", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "تعذّر التسجيل", description: msg, variant: "destructive" });
    },
  });

  /**
   * إلغاء آخر عَرَض يعود إلى «بلا أعراض» لا إلى الفراغ.
   *
   * كان `next.filter(…) || []` بلا أثر (المصفوفة دائمًا صادقة)، فمن اختار
   * عرضًا ثم ألغاه تُحفظ جلسته بمصفوفة فارغة — سجلٌّ لا يُميّز «فُحِص فلم
   * يوجد شيء» من «لم يُسأل». والنفي الصريح هو ما يُقرأ في الجلسة التالية.
   */
  const toggleEvent = (k: string) =>
    setEvents((prev) => {
      if (k === "none") return ["none"];
      const next = prev.filter((x) => x !== "none");
      if (!next.includes(k)) return [...next, k];
      const without = next.filter((x) => x !== k);
      return without.length === 0 ? ["none"] : without;
    });

  const setParam = (k: string, v: string) =>
    setParams((prev) => {
      const next = { ...prev };
      if (v.trim() === "") delete next[k];
      else next[k] = v;
      return next;
    });

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
      {lastSession && (
        <div className="rounded-md border bg-background px-3 py-2 text-sm">
          <span className="font-medium">آخر جلسة: </span>
          {lastSession.service_name}
          {lastSession.body_area ? ` — ${lastSession.body_area}` : ""}
          {lastSession.device_name ? ` — ${lastSession.device_name}` : ""}
          {lastSession.performed_at
            ? ` — ${new Date(lastSession.performed_at).toLocaleDateString("ar-u-nu-latn")}`
            : ""}
          {lastSession.parameters && Object.keys(lastSession.parameters).length > 0 && (
            <span className="block text-xs text-muted-foreground">
              الإعدادات:{" "}
              {Object.entries(lastSession.parameters)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </span>
          )}
          {(lastSession.adverse_events ?? []).filter((e: string) => e !== "none").length > 0 && (
            <span className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              أعراض سابقة:{" "}
              {(lastSession.adverse_events ?? [])
                .filter((e: string) => e !== "none")
                .map((e: string) => ADVERSE.find((a) => a.key === e)?.label ?? e)
                .join("، ")}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-item">الخدمة</Label>
          <select
            id="ss-item"
            dir="rtl"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر —</option>
            {(services.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_ar}
              </option>
            ))}
          </select>
          {(services.data ?? []).length === 0 && !services.isLoading && (
            <span className="text-xs text-destructive">
              لا خدمة لها بروتوكول جلسات — حدّد عدد الجلسات والفاصل على الخدمة في الكتالوج.
            </span>
          )}
          {service && (
            <span className="text-xs text-muted-foreground">
              {service.default_sessions_count} جلسات · كل {service.session_interval_days} يومًا
              {service.min_interval_days ? ` · أقلّها ${service.min_interval_days}` : ""}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-area">المنطقة</Label>
          <select
            id="ss-area"
            dir="rtl"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر —</option>
            {(areas.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name_ar}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-doctor">الطبيب المنفِّذ</Label>
          <select
            id="ss-doctor"
            dir="rtl"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر —</option>
            {(doctors.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                د. {d.name_ar}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-device">الجهاز</Label>
          <select
            id="ss-device"
            dir="rtl"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— اختر —</option>
            {(devices.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name_ar}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { key: "fluence", label: "الطاقة (J/cm²)" },
          { key: "pulse_width", label: "عرض النبضة" },
          { key: "spot", label: "قطر البقعة" },
        ].map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`ss-${f.key}`}>{f.label}</Label>
            <Input
              id={`ss-${f.key}`}
              dir="rtl"
              value={params[f.key] ?? ""}
              onChange={(e) => setParam(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>الأعراض الجانبية</Label>
        <div className="flex flex-wrap gap-1.5">
          {ADVERSE.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => toggleEvent(a.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition",
                events.includes(a.key)
                  ? a.key === "none"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-amber-600 bg-amber-600 text-white"
                  : "border-border hover:border-primary/50",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        {!events.includes("none") && events.length > 0 && (
          <Input
            dir="rtl"
            value={adverseNote}
            onChange={(e) => setAdverseNote(e.target.value)}
            placeholder="وصف العرض ومدّته"
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ss-note">ملاحظة الجلسة</Label>
        <Textarea
          id="ss-note"
          dir="rtl"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {needsOverride && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-destructive bg-destructive/5 p-3">
          <Label htmlFor="ss-ovr" className="text-destructive">
            الجلسة قبل أقلّ فاصل مسموح — اكتب السبب لتُسجَّل
          </Label>
          <Input
            id="ss-ovr"
            dir="rtl"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="مثال: المريضة مسافرة — بقرار الطبيب"
          />
        </div>
      )}

      <Button
        className="h-11"
        disabled={!itemId || save.isPending || (needsOverride && !override.trim())}
        onClick={() => save.mutate()}
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        حفظ الجلسة
      </Button>
    </div>
  );
}

function SessionRow({ session, organizationId }: { session: any; organizationId?: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const photos = useQuery({
    queryKey: ["session-photos", session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_session_photos")
        .select("*")
        .eq("session_id", session.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const upload = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: string }) => {
      if (!organizationId) throw new Error("لا منشأة");
      if (file.size > MAX_BYTES) throw new Error("الملف يتجاوز 20 ميجابايت");
      setUploading(category);
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${organizationId}/sessions/${session.id}/${category}-${Date.now()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file);
      if (up.error) throw up.error;
      const { error } = await supabase.rpc("app_register_entity_document", {
        p_org: organizationId,
        p_entity_type: "treatment_session",
        p_entity_id: session.id,
        p_title: category === "before" ? "قبل الجلسة" : "بعد الجلسة",
        p_storage_path: path,
        p_file_name: file.name,
        p_category: category,
        p_branch_id: session.branch_id ?? null,
        p_issue_date: null,
        p_expires_at: null,
        p_mime_type: file.type || null,
        p_size_bytes: file.size,
        p_note: null,
      });
      if (error) {
        // السجل فشل بعد الرفع: الملف اليتيم يُزال فورًا، وإلا بقي في التخزين
        // بلا مرجع يشير إليه.
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "رُفعت الصورة" });
      queryClient.invalidateQueries({ queryKey: ["session-photos", session.id] });
    },
    onError: (e: any) =>
      toast({ title: "تعذّر الرفع", description: e?.message, variant: "destructive" }),
    onSettled: () => setUploading(null),
  });

  const openPhoto = async (row: any) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 60);
    if (error) {
      toast({ title: "تعذّر الفتح", description: error.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const [pending, setPending] = useState<string>("before");
  const adverse = (session.adverse_events ?? []).filter((e: string) => e !== "none");
  const photoRows = photos.data ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">جلسة {session.session_number}</Badge>
          <strong className="text-sm">{session.service_name ?? "خدمة"}</strong>
          {session.body_area && (
            <span className="text-sm text-muted-foreground">{session.body_area}</span>
          )}
          {adverse.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {adverse
                .map((e: string) => ADVERSE.find((a) => a.key === e)?.label ?? e)
                .join("، ")}
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {session.performed_at
            ? new Date(session.performed_at).toLocaleString("ar-u-nu-latn")
            : session.scheduled_date}
        </span>
      </div>

      {/* `v_session_history` يُخرج `doctor_name` وكان فارغًا دائمًا لأن الجلسة
          تُسجَّل بلا طبيب — يُعرض الآن ليُعرف من نفّذ. */}
      {session.doctor_name && (
        <span className="text-xs text-muted-foreground">الطبيب: د. {session.doctor_name}</span>
      )}
      {session.device_name && (
        <span className="text-xs text-muted-foreground">الجهاز: {session.device_name}</span>
      )}
      {session.parameters && Object.keys(session.parameters).length > 0 && (
        <span className="text-xs text-muted-foreground">
          {Object.entries(session.parameters)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </span>
      )}
      {session.interval_override_reason && (
        <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
          نُفِّذت قبل الفاصل: {session.interval_override_reason}
        </span>
      )}
      {session.note && <span className="text-sm">{session.note}</span>}

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate({ file: f, category: pending });
            e.target.value = "";
          }}
        />
        {(["before", "after"] as const).map((c) => (
          <Button
            key={c}
            size="sm"
            variant="outline"
            disabled={uploading !== null}
            onClick={() => {
              setPending(c);
              fileRef.current?.click();
            }}
          >
            {uploading === c ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : c === "before" ? (
              <Camera className="h-3.5 w-3.5" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {c === "before" ? "صورة قبل" : "صورة بعد"}
          </Button>
        ))}
        {photoRows.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => openPhoto(p)}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent/10"
          >
            <ImageIcon className="h-3 w-3" />
            {p.category === "before" ? "قبل" : p.category === "after" ? "بعد" : p.category}
          </button>
        ))}
      </div>
    </div>
  );
}
