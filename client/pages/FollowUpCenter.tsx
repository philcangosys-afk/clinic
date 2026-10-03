import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  CheckCircle2,
  Eye,
  ListPlus,
  Loader2,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useSessionDoctor } from "@/lib/session-doctor";
import { usePermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, formatTime, useLocaleSettings } from "@/lib/locale";
import {
  buildPatientSearchOr,
  patientSearchPlaceholder,
  PATIENTS_SEARCH_COLUMNS,
} from "@/lib/patient-search";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import FollowUpServicesList from "@/components/follow-up/FollowUpServicesList";
import ServiceBrowserDialog, { type PickedService } from "@/components/billing/ServiceBrowserDialog";
import {
  FOLLOW_UP_COLUMNS,
  FOLLOW_UP_QUERY_KEYS,
  FOLLOW_UP_TYPE,
  followUpStatusLabel,
  localDayBounds,
  todayLocalDate,
  type FollowUpRow,
} from "@/components/follow-up/follow-up-meta";

/**
 * مركز المتابعة (0173) — ما بين الطبيب والاستقبال.
 *
 * **لماذا وُجد:** الطبيب لا يُصدر فاتورة. وما كان يقوله بالفاتورة — «خصم
 * عشرة»، «يدفع كاملًا»، «هذه الجلسة مجانًا» — يقوله هنا بكلمة. كانت الكلمة
 * تُقال بالهاتف أو على ورقةٍ بيد المريض، فلا يبقى لها أثر: مَن قال؟ ومتى؟
 * وهل وصلت؟
 *
 * **شاشةٌ واحدة بوجهين:** الطبيب يكتب ويرى ما أرسل وهل قُرئ، والاستقبال يرى
 * ما وصل من كلّ الأطباء ويختم «اطّلعت». والفرق في الصفة لا في الرابط، فلا
 * رابطان يفترقان.
 *
 * **اليوم افتراضًا.** الاستقبال يعمل على يومه؛ وما قبله يُفتح بتغيير التاريخ
 * صراحةً — حتى لا تختلط ملاحظة أمسٍ أُنجزت بملاحظة اليوم المنتظرة.
 */
export default function FollowUpCenter() {
  const { organization, branch } = useOrganizationAccess();
  const { isDoctorRole, doctorId, unresolvedDoctor } = useSessionDoctor();
  const { can } = usePermissions();

  const canSend = isDoctorRole && can("follow_up_center.send");
  const canHandle = !isDoctorRole && can("reception.requests");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BellRing className="h-6 w-6 text-primary" />
          مركز المتابعة
        </h1>
        <p className="text-sm text-muted-foreground">
          {isDoctorRole
            ? "اكتب للاستقبال ما يخصّ مريضك — خصم، أو دفع كامل، أو أيّ توجيه — فيصلهم فورًا، وترى هنا متى قرؤوه."
            : "كلّ ما يرسله الأطباء إلى الاستقبال: ملاحظاتهم، واستدعاء المرضى، وطلبات التحصيل، ومواعيد المتابعة."}
        </p>
      </div>

      {isDoctorRole && unresolvedDoctor && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-900">
            حسابك غير مربوط ببطاقة طبيب في هذه المنشأة، فلا يُعرف باسم مَن تُرسَل الملاحظة. اطلب من
            مدير المنشأة ربط حسابك ببطاقتك.
          </CardContent>
        </Card>
      )}

      {canSend && doctorId && organization?.id && (
        <ComposeCard
          organizationId={organization.id}
          doctorId={doctorId}
          branchId={branch?.id ?? null}
        />
      )}

      {organization?.id && (
        <InboxCard
          organizationId={organization.id}
          doctorScopeId={isDoctorRole ? doctorId : null}
          isDoctorRole={isDoctorRole}
          canHandle={canHandle}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

type PickedPatient = { id: string; name_ar: string; file_number: number | null };

/** خدمةٌ في ملاحظة الطبيب (0218): السعر والخصم هنا فقط — الكتالوج لا يتغيّر. */
type DraftService = {
  key: string;
  item_id: string;
  name: string;
  code: string | null;
  catalogPrice: number;
  price: string;
  discount: string;
};

const num = (value: string) => {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** عباراتٌ تُضاف إلى النصّ بضغطة — تبقى نصًّا يُعدَّل لا خيارًا مُقيِّدًا. */
const QUICK_PHRASES = ["اعملوا له خصم ", "يدفع كاملًا", "هذه الجلسة مجانًا", "حصّلوا المتبقّي"];

const MAX_NOTE = 1000;

/**
 * كتابة الملاحظة — للطبيب.
 *
 * **مرضى اليوم أوّلًا:** الطبيب يكتب عن المريض الذي خرج من عنده للتوّ، فهو في
 * مواعيد اليوم غالبًا — ضغطةٌ بدل بحث. والبحث لما عداهم، **ومحصورٌ في مرضاه**
 * (`v_doctor_patients`) كما تحصره القاعدة: بحثٌ يُعيد مريضًا ستُرفض الملاحظة
 * عليه يُضيّع وقت الطبيب.
 */
function ComposeCard({
  organizationId,
  doctorId,
  branchId,
}: {
  organizationId: string;
  doctorId: string;
  branchId: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [term, setTerm] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [services, setServices] = useState<DraftService[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);

  const addService = (item: PickedService) =>
    setServices((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item_id: item.id,
        name: item.name_ar,
        code: item.code,
        catalogPrice: Number(item.price ?? 0),
        price: String(Number(item.price ?? 0)),
        discount: "0",
      },
    ]);
  const updateService = (key: string, patch: Partial<DraftService>) =>
    setServices((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const servicesTotal = services.reduce((sum, s) => sum + Math.max(num(s.price) - num(s.discount), 0), 0);
  const badDiscount = services.some((s) => num(s.discount) > num(s.price));

  const todayPatients = useQuery({
    queryKey: ["follow-up-today-patients", organizationId, doctorId],
    queryFn: async () => {
      const { fromIso, toIso } = localDayBounds(todayLocalDate());
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, scheduled_start, status, patient:patients!appointments_patient_tenant_fk(id, name_ar, file_number)",
        )
        .eq("organization_id", organizationId)
        .eq("doctor_id", doctorId)
        .gte("scheduled_start", fromIso)
        .lt("scheduled_start", toIso)
        .neq("status", "cancelled_by_patient")
        .order("scheduled_start");
      if (error) throw error;
      // مريضٌ بموعدين اليوم يظهر مرّة
      const seen = new Set<string>();
      const out: PickedPatient[] = [];
      for (const row of (data ?? []) as any[]) {
        const p = row.patient;
        if (p?.id && !seen.has(p.id)) {
          seen.add(p.id);
          out.push({ id: p.id, name_ar: p.name_ar, file_number: p.file_number ?? null });
        }
      }
      return out;
    },
  });

  const search = useQuery({
    queryKey: ["follow-up-patient-search", organizationId, doctorId, term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      let q = supabase
        .from("v_doctor_patients")
        .select("id, name_ar, file_number")
        .eq("organization_id", organizationId)
        .eq("doctor_id", doctorId)
        .order("name_ar")
        .limit(8);
      const filter = buildPatientSearchOr(term, [], PATIENTS_SEARCH_COLUMNS);
      if (filter) q = q.or(filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PickedPatient[];
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!patient) throw new Error("اختر المريض");
      const text = body.trim();
      if (!text && services.length === 0) throw new Error("اكتب الملاحظة أو اختر خدمة");
      if (badDiscount) throw new Error("الخصم أكبر من السعر في إحدى الخدمات");
      const { error } = await supabase.rpc("app_send_follow_up_note", {
        p_organization_id: organizationId,
        p_patient_id: patient.id,
        p_body: text,
        p_doctor_id: doctorId,
        p_priority: urgent ? "urgent" : "routine",
        p_branch_id: branchId,
        ...(services.length > 0
          ? {
              p_services: services.map((s) => ({
                item_id: s.item_id,
                price: num(s.price),
                discount: num(s.discount),
              })),
            }
          : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "وصلت الملاحظة إلى الاستقبال", description: patient?.name_ar });
      setPatient(null);
      setBody("");
      setUrgent(false);
      setTerm("");
      setServices([]);
      FOLLOW_UP_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "لم تُرسَل الملاحظة",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  const appendPhrase = (phrase: string) =>
    setBody((prev) => {
      const joined = prev.trim() ? `${prev.trimEnd()} — ${phrase}` : phrase;
      return joined.slice(0, MAX_NOTE);
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-4 w-4" />
          ملاحظة إلى الاستقبال
        </CardTitle>
        <CardDescription>اختر المريض، واكتب ما تريد — تصلهم فورًا بتنبيهٍ وصوت.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* ١) المريض */}
        <div className="flex flex-col gap-2">
          <Label>المريض</Label>
          {patient ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-2 px-3 py-1.5 text-sm">
                {patient.name_ar}
                {patient.file_number !== null && (
                  <span className="text-xs text-muted-foreground">ملف {patient.file_number}</span>
                )}
                <button
                  type="button"
                  aria-label="تغيير المريض"
                  className="rounded-full hover:bg-muted"
                  onClick={() => setPatient(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Badge>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {todayPatients.isLoading && <Skeleton className="h-7 w-48" />}
                {todayPatients.isError && (
                  <span className="text-xs text-destructive">
                    تعذّر قراءة مواعيد اليوم: {errorMessage(todayPatients.error)}
                  </span>
                )}
                {!todayPatients.isLoading && (todayPatients.data ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground">لا مواعيد لك اليوم — ابحث بالأسفل.</span>
                )}
                {(todayPatients.data ?? []).map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setPatient(p)}
                  >
                    {p.name_ar}
                  </Button>
                ))}
              </div>
              <div className="relative max-w-md">
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder={`أو ابحث في مرضاك — ${patientSearchPlaceholder([])}`}
                    className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                {term.trim().length >= 2 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
                    {search.isLoading && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">جارٍ البحث...</p>
                    )}
                    {search.isError && (
                      <p className="px-3 py-2 text-xs text-destructive">
                        تعذّر البحث: {errorMessage(search.error)}
                      </p>
                    )}
                    {!search.isLoading && !search.isError && (search.data ?? []).length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">لا أحد من مرضاك بهذا البحث.</p>
                    )}
                    {(search.data ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                        onClick={() => {
                          setPatient(p);
                          setTerm("");
                        }}
                      >
                        <span className="flex-1">{p.name_ar}</span>
                        <span className="text-xs text-muted-foreground">#{p.file_number ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ٢) الخدمات (0218): من الكتالوج بحسب تخصّص الطبيب، والسعر والخصم يُعدَّلان
            هنا فقط — لا فاتورة، تصل إلى الاستقبال مع الملاحظة. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>الخدمات</Label>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => setBrowserOpen(true)}>
              <ListPlus className="h-4 w-4" />
              اختر خدمة / تصفّح الخدمات
            </Button>
          </div>
          {services.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">
                    <th>الخدمة</th>
                    <th className="w-28">المبلغ</th>
                    <th className="w-28">الخصم</th>
                    <th className="w-24">الصافي</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => {
                    const net = num(s.price) - num(s.discount);
                    return (
                      <tr key={s.key} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                        <td>
                          <span className="font-medium">{s.name}</span>
                          {s.code && <span className="ms-1 font-mono text-[10px] text-muted-foreground">{s.code}</span>}
                          {num(s.price) !== s.catalogPrice && (
                            <span className="block text-[10px] text-muted-foreground">
                              سعر الكتالوج {formatAmount(s.catalogPrice)} — لا يتغيّر
                            </span>
                          )}
                        </td>
                        <td>
                          <Input
                            inputMode="decimal"
                            className="h-8 tabular-nums"
                            value={s.price}
                            onChange={(event) => updateService(s.key, { price: event.target.value })}
                          />
                        </td>
                        <td>
                          <Input
                            inputMode="decimal"
                            className={cn("h-8 tabular-nums", num(s.discount) > num(s.price) && "border-destructive")}
                            value={s.discount}
                            onChange={(event) => updateService(s.key, { discount: event.target.value })}
                          />
                        </td>
                        <td className={cn("font-semibold tabular-nums", net < 0 && "text-destructive")}>
                          {formatAmount(Math.max(net, 0))}
                        </td>
                        <td>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label="حذف الخدمة"
                            onClick={() => setServices((prev) => prev.filter((x) => x.key !== s.key))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-bold [&>td]:px-2 [&>td]:py-1.5">
                    <td colSpan={3}>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-xs font-medium"
                        onClick={() => setBrowserOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        خدمة أخرى
                      </Button>
                    </td>
                    <td className="tabular-nums">{formatAmount(servicesTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {services.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                تذكير: إذا كان دفع هذه الخدمة على أكثر من مقابلة (جلسات أو دفعات) فيجب إنشاء{" "}
                {patient ? (
                  <Link className="underline underline-offset-2" to={`/patients/${patient.id}?section=agreements`}>
                    اتفاقية داخل ملف المريض
                  </Link>
                ) : (
                  "اتفاقية داخل ملف المريض"
                )}
                . هذه الخدمات لا تُصدر فاتورة — تصل إلى الاستقبال فقط.
              </span>
            </div>
          )}
          <ServiceBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            onSelect={addService}
            doctorId={doctorId}
          />
        </div>

        {/* ٣) الملاحظة */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="follow-up-body">
            الملاحظة{services.length > 0 && <span className="text-xs font-normal text-muted-foreground"> (اختيارية مع الخدمات)</span>}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PHRASES.map((phrase) => (
              <Button
                key={phrase}
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => appendPhrase(phrase)}
              >
                + {phrase.trim()}
              </Button>
            ))}
          </div>
          <Textarea
            id="follow-up-body"
            value={body}
            maxLength={MAX_NOTE}
            rows={3}
            placeholder="مثال: اعملوا له خصم ٥٠ — مراجعة بعد أسبوع"
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} />
              عاجلة
            </label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {body.length} / {MAX_NOTE}
            </span>
          </div>
        </div>

        <div>
          <Button
            onClick={() => send.mutate()}
            disabled={!patient || (!body.trim() && services.length === 0) || badDiscount || send.isPending}
            className="gap-2"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            إرسال إلى الاستقبال
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * ما وصل — للاستقبال كلّه، وللطبيب ما أرسله هو.
 *
 * «اطّلعت» غير «أُنجز»: طلب تحصيلٍ يُقرأ الآن ويُحصَّل بعد ساعة. فالختمان
 * منفصلان، والطبيب يرى الأوّل («قرأها فلان ١٠:٤٢») قبل أن يقع الثاني.
 */
function InboxCard({
  organizationId,
  doctorScopeId,
  isDoctorRole,
  canHandle,
}: {
  organizationId: string;
  doctorScopeId: string | null;
  isDoctorRole: boolean;
  canHandle: boolean;
}) {
  const { calendarDisplay } = useLocaleSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(todayLocalDate());
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  // الطبيب يرى ما أرسله هو وحده؛ ومُرشِّح الطبيب للاستقبال
  const effectiveDoctor = isDoctorRole ? doctorScopeId : doctorFilter === "all" ? null : doctorFilter;
  const isToday = day === todayLocalDate();

  // الطبيب الذي لم تُعرف هويّته لا يرى رسائل غيره بديلًا عن رسائله
  const blindDoctor = isDoctorRole && !doctorScopeId;

  const doctors = useQuery({
    queryKey: ["follow-up-doctors", organizationId],
    enabled: !isDoctorRole,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const rows = useQuery({
    queryKey: ["follow-up-center", organizationId, day, effectiveDoctor ?? "all"],
    enabled: !blindDoctor,
    // النافذة الجانبية تُبطل هذا المفتاح عند كل حدثٍ فوريّ؛ والدورة احتياطٌ
    refetchInterval: 30_000,
    queryFn: async () => {
      const { fromIso, toIso } = localDayBounds(day);
      let q = supabase
        .from("v_follow_up_center")
        .select(FOLLOW_UP_COLUMNS)
        .eq("organization_id", organizationId)
        .gte("requested_at", fromIso)
        .lt("requested_at", toIso)
        .order("requested_at", { ascending: false })
        .limit(500);
      if (effectiveDoctor) q = q.eq("doctor_id", effectiveDoctor);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as FollowUpRow[];
    },
  });

  // تغيير الطبيب المعايَن في وضع المعاينة يُعيد المرشِّح إلى الكلّ
  useEffect(() => setDoctorFilter("all"), [isDoctorRole]);

  const invalidateAll = () =>
    FOLLOW_UP_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));

  const markSeen = useMutation({
    mutationFn: async (targets: FollowUpRow[]) => {
      const staff = targets.filter((r) => r.source_kind === "staff").map((r) => r.id);
      const appts = targets.filter((r) => r.source_kind === "appointment").map((r) => r.id);
      const { error } = await supabase.rpc("app_mark_follow_up_seen", {
        p_organization_id: organizationId,
        p_staff_ids: staff,
        p_appointment_ids: appts,
      });
      if (error) throw error;
    },
    onMutate: (targets) => setBusyId(targets.length === 1 ? targets[0].id : "all"),
    onSuccess: invalidateAll,
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الختم", description: errorMessage(error, "خطأ غير متوقع") }),
    onSettled: () => setBusyId(null),
  });

  const resolve = useMutation({
    mutationFn: async (row: FollowUpRow) => {
      const { error } = await supabase.rpc("app_resolve_staff_request", {
        p_request_id: row.id,
        p_status: "done",
        p_note: null,
      });
      if (error) throw error;
    },
    onMutate: (row) => setBusyId(row.id),
    onSuccess: () => {
      toast({ title: "أُنجز" });
      invalidateAll();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإقفال", description: errorMessage(error, "خطأ غير متوقع") }),
    onSettled: () => setBusyId(null),
  });

  const list = rows.data ?? [];
  const unseen = useMemo(
    () => list.filter((r) => !r.seen_at && !r.resolved_at && r.status === "pending"),
    [list],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {isDoctorRole ? "ما أرسلتُه" : "ما وصل من الأطباء"}
              {!isDoctorRole && unseen.length > 0 && (
                <Badge variant="destructive">{unseen.length} لم يُطَّلع عليها</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {isToday
                ? "سجلّات اليوم"
                : `سجلّات ${formatDate(new Date(localDayBounds(day).fromIso), calendarDisplay)}`}{" "}
              — {list.length}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">التاريخ</Label>
              <Input
                type="date"
                value={day}
                max={todayLocalDate()}
                onChange={(event) => event.target.value && setDay(event.target.value)}
                className="h-9 w-40"
              />
            </div>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setDay(todayLocalDate())}>
                اليوم
              </Button>
            )}
            {!isDoctorRole && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">الطبيب</Label>
                <Select value={doctorFilter} onValueChange={setDoctorFilter}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كلّ الأطباء</SelectItem>
                    {(doctors.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {canHandle && unseen.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={markSeen.isPending}
                onClick={() => markSeen.mutate(unseen)}
              >
                <CheckCheck className="h-4 w-4" />
                اطّلعت على الكلّ
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {blindDoctor && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            لا يُعرف أيّ طبيبٍ أنت، فلا يُعرض ما أرسلته. اربط حسابك ببطاقتك أوّلًا.
          </p>
        )}
        {rows.isLoading && <Skeleton className="h-40 w-full" />}
        {rows.isError && (
          <p className="py-6 text-center text-sm text-destructive">
            تعذّر التحميل: {errorMessage(rows.error)} — إن لم تُنفَّذ الترقية 0173 فهذا سببه.
          </p>
        )}
        {!rows.isLoading && !rows.isError && !blindDoctor && list.length === 0 && (
          <div className="grid place-items-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <span className="text-sm text-muted-foreground">
              {isDoctorRole ? "لم ترسل شيئًا في هذا اليوم." : "لم يصل شيءٌ من الأطباء في هذا اليوم."}
            </span>
          </div>
        )}
        {list.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 whitespace-nowrap">الوقت</TableHead>
                  {!isDoctorRole && <TableHead className="whitespace-nowrap">الطبيب</TableHead>}
                  <TableHead className="min-w-[9rem]">المريض</TableHead>
                  <TableHead className="whitespace-nowrap">النوع</TableHead>
                  <TableHead className="min-w-[16rem]">الملاحظة</TableHead>
                  <TableHead className="whitespace-nowrap">الاطّلاع</TableHead>
                  <TableHead className="whitespace-nowrap">الحالة</TableHead>
                  {canHandle && <TableHead className="whitespace-nowrap">إجراء</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const type = FOLLOW_UP_TYPE[row.request_type] ?? FOLLOW_UP_TYPE.note;
                  const TypeIcon = type.icon;
                  const status = followUpStatusLabel(row);
                  const isUnseen = !row.seen_at && !row.resolved_at && row.status === "pending";
                  const busy = busyId === row.id || busyId === "all";
                  return (
                    <TableRow
                      key={`${row.source_kind}-${row.id}`}
                      className={cn(
                        isUnseen && "bg-amber-50/70",
                        row.priority === "urgent" && status.tone === "open" && "border-s-4 border-s-rose-500",
                      )}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                        {formatTime(row.requested_at)}
                      </TableCell>
                      {!isDoctorRole && (
                        <TableCell className="whitespace-nowrap text-sm">{row.doctor_name ?? "—"}</TableCell>
                      )}
                      <TableCell>
                        {row.patient_id ? (
                          <Link
                            to={`/patients/${row.patient_id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {row.patient_name ?? "مريض"}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {row.file_number !== null && (
                          <span className="block text-xs text-muted-foreground">ملف {row.file_number}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Badge variant="outline" className="gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {type.label}
                          </Badge>
                          {row.priority === "urgent" && <Badge variant="destructive">عاجلة</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.body && <p className="whitespace-pre-wrap">{row.body}</p>}
                        <FollowUpServicesList services={row.services} />
                        {row.amount !== null && !row.services?.length && (
                          <p className="font-semibold tabular-nums">المبلغ: {formatAmount(row.amount)}</p>
                        )}
                        {row.preferred_date && (
                          <p className="text-xs text-muted-foreground">
                            التاريخ المطلوب: {formatDate(row.preferred_date, calendarDisplay)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {row.seen_at ? (
                          <span className="flex items-center gap-1 text-emerald-700">
                            <Eye className="h-3.5 w-3.5" />
                            {row.seen_by_name ?? "الاستقبال"} · {formatTime(row.seen_at)}
                          </span>
                        ) : row.resolved_at ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                            لم يُطَّلع عليها
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span
                          className={cn(
                            "font-medium",
                            status.tone === "open" && "text-amber-700",
                            status.tone === "done" && "text-emerald-700",
                            status.tone === "closed" && "text-muted-foreground",
                          )}
                        >
                          {status.label}
                        </span>
                        {row.resolved_at && (
                          <span className="block text-muted-foreground">
                            {row.resolved_by_name ?? "—"} · {formatTime(row.resolved_at)}
                          </span>
                        )}
                      </TableCell>
                      {canHandle && (
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {isUnseen && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                disabled={busy}
                                onClick={() => markSeen.mutate([row])}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                اطّلعت
                              </Button>
                            )}
                            {row.source_kind === "staff" && row.status === "pending" && (
                              <Button
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                disabled={busy}
                                onClick={() => resolve.mutate(row)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                أُنجز
                              </Button>
                            )}
                            {/* موعد المتابعة لا يُقفَل بـ«أُنجز»: إقفاله حجزُ موعدٍ
                                فعليّ، ومكانه لوحة الاستقبال التي تحجزه وتُقفله معًا. */}
                            {row.source_kind === "appointment" && row.status === "pending" && (
                              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                                <Link to="/reception">احجزه من الاستقبال</Link>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
