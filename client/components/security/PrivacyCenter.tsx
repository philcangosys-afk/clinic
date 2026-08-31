import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileLock2, ShieldCheck, Trash2, UserSearch } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * مركز الخصوصية — الموافقات وسجل الاطّلاع وسياسات الاحتفاظ (المرحلة 15).
 *
 * الثلاثة معًا لأنها سؤالٌ واحد يطرحه المدقّق: **مَن أذِن، ومَن اطّلع، وإلى
 * متى نحتفظ؟** تفريقها على ثلاث شاشات يجعل الإجابة عن السؤال الواحد رحلةً.
 */

const CONSENT_TYPES: Record<string, string> = {
  treatment: "الموافقة على العلاج",
  data_processing: "معالجة البيانات",
  data_sharing: "مشاركة البيانات",
  marketing: "التواصل التسويقي",
  photography: "التصوير",
  research: "البحث العلمي",
  telehealth: "الطبّ عن بُعد",
};

const CONSENT_STATUS: Record<string, { label: string; variant: any }> = {
  granted: { label: "سارية", variant: "success" },
  withdrawn: { label: "مسحوبة", variant: "destructive" },
  expired: { label: "منتهية", variant: "secondary" },
  superseded: { label: "مستبدَلة", variant: "outline" },
};

const ACCESS_TYPES: Record<string, string> = {
  view: "اطّلاع",
  print: "طباعة",
  export: "تصدير",
  download: "تنزيل",
  search: "بحث",
};

const ENTITY_KEYS: Record<string, string> = {
  patient_records: "الملفات الطبية",
  appointments: "المواعيد",
  audit_log: "سجل التدقيق",
  access_log: "سجل الاطّلاع",
  documents: "المستندات",
  messages: "الرسائل",
  invoices: "الفواتير",
};

const RETENTION_ACTIONS: Record<string, string> = {
  archive: "أرشفة",
  anonymize: "إخفاء الهوية",
  review: "مراجعة يدوية",
};

export default function PrivacyCenter() {
  const { can } = usePermissions();

  return (
    <Tabs defaultValue="consents">
      <TabsList>
        <TabsTrigger value="consents">موافقات المرضى</TabsTrigger>
        {can("audit.access_log") && (
          <TabsTrigger value="access">سجل الاطّلاع على الملف الطبي</TabsTrigger>
        )}
        <TabsTrigger value="retention">سياسات الاحتفاظ</TabsTrigger>
      </TabsList>
      <TabsContent value="consents" className="mt-4">
        <ConsentsPanel />
      </TabsContent>
      {can("audit.access_log") && (
        <TabsContent value="access" className="mt-4">
          <AccessLogPanel />
        </TabsContent>
      )}
      <TabsContent value="retention" className="mt-4">
        <RetentionPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * الموافقات
 * ════════════════════════════════════════════════════════════════════════ */
function ConsentsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<any | null>(null);
  const [consentType, setConsentType] = useState("treatment");
  const [purpose, setPurpose] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  /**
   * البحث يقرأ من `v_patient_directory` لا من `patients`.
   *
   * المنظور يُخفي الهوية والجوال في **القاعدة** لمن لا يملك
   * `patients.view_identity`. لو قرأنا الجدول مباشرةً لوصلت القيم كاملةً في
   * الاستجابة ثم أخفتها الواجهة — وهذا إخفاءٌ شكليّ يقرؤه من يفتح أدوات
   * المطوّر.
   */
  const patients = useQuery({
    queryKey: ["privacy-patients", organization?.id, search],
    enabled: Boolean(organization?.id) && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_directory")
        .select("id, name_ar, file_number, id_number, phone_1, age_years, identity_visible")
        .eq("organization_id", organization!.id)
        .ilike("name_ar", `%${search.trim()}%`)
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const consents = useQuery({
    queryKey: ["patient-consents", patient?.id],
    enabled: Boolean(patient?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_consents")
        .select("*")
        .eq("patient_id", patient!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      if (!patient?.id) throw new Error("اختر مريضًا أولًا");
      const { error } = await supabase.rpc("app_record_patient_consent", {
        p_patient_id: patient.id,
        p_consent_type: consentType,
        p_purpose: purpose.trim(),
        p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        p_document_id: null,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-consents", patient?.id] });
      setPurpose("");
      setExpiresAt("");
      toast({ title: "سُجّلت الموافقة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const withdraw = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_withdraw_patient_consent", {
        p_consent_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-consents", patient?.id] });
      toast({ title: "سُحبت الموافقة", description: "بقيت مسجَّلة شاهدًا على السحب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر السحب",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserSearch className="h-4 w-4" />
            اختر المريض
          </CardTitle>
          <CardDescription>
            الهوية والجوال يظهران كاملَين لمن يملك صلاحية «عرض الهوية وبيانات التواصل»
            فقط؛ لغيره يصلان مُخفيَين من القاعدة نفسها.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="ابحث باسم المريض (حرفان على الأقل)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {patients.isLoading && <Skeleton className="h-16 w-full" />}
          <div className="flex flex-col gap-1">
            {(patients.data ?? []).map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPatient(p)}
                className={`flex items-center justify-between rounded-md border p-2 text-start text-sm hover:bg-muted ${
                  patient?.id === p.id ? "border-primary" : ""
                }`}
              >
                <span>
                  {p.name_ar}
                  <span className="ms-2 font-mono text-xs text-muted-foreground">
                    {p.file_number ?? "—"}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {p.id_number ?? "—"} · {p.phone_1 ?? "—"}
                  {p.age_years ? ` · ${p.age_years} سنة` : ""}
                  {!p.identity_visible && (
                    <Badge variant="outline" className="ms-2">مُخفاة</Badge>
                  )}
                </span>
              </button>
            ))}
            {search.trim().length >= 2 && !patients.isLoading && (patients.data ?? []).length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">لا نتائج.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {patient && (
        <>
          {can("privacy.consents") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">تسجيل موافقة لـ {patient.name_ar}</CardTitle>
                <CardDescription>
                  الغرض إلزاميّ — موافقةٌ بلا غرض لا تصلح سندًا نظاميًّا. تسجيل موافقة
                  جديدة لنفس الغرض يجعل السابقة «مستبدَلة» ولا يحذفها.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>نوع الموافقة</Label>
                  <Select value={consentType} onValueChange={setConsentType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONSENT_TYPES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>الغرض *</Label>
                  <Textarea
                    rows={2}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="لماذا تُعالَج البيانات؟"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>تنتهي في (اختياري)</Label>
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
                <div className="flex items-end sm:col-span-2">
                  <Button
                    disabled={!purpose.trim() || record.isPending}
                    onClick={() => record.mutate()}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {record.isPending ? "جارٍ الحفظ..." : "تسجيل الموافقة"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <ActiveConsentsStrip patientId={patient.id} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">سجل موافقات {patient.name_ar}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {consents.isLoading && <Skeleton className="h-24 w-full" />}
              {!consents.isLoading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>النسخة</TableHead>
                      <TableHead>الغرض</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>مُنحت في</TableHead>
                      <TableHead>تنتهي في</TableHead>
                      <TableHead>سبب السحب</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(consents.data ?? []).map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">
                          {CONSENT_TYPES[c.consent_type] ?? c.consent_type}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.version}</TableCell>
                        <TableCell className="max-w-64 truncate text-sm">{c.purpose}</TableCell>
                        <TableCell>
                          <Badge variant={CONSENT_STATUS[c.status]?.variant ?? "secondary"}>
                            {CONSENT_STATUS[c.status]?.label ?? c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {new Date(c.granted_at).toLocaleDateString("ar-SA")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.expires_at
                            ? new Date(c.expires_at).toLocaleDateString("ar-SA")
                            : "—"}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                          {c.withdrawal_reason ?? "—"}
                        </TableCell>
                        <TableCell className="text-left">
                          {c.status === "granted" && can("privacy.consents") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={withdraw.isPending}
                              onClick={() => {
                                const reason = window.prompt("سبب سحب الموافقة؟") ?? "";
                                if (!reason.trim()) return;
                                withdraw.mutate({ id: c.id, reason: reason.trim() });
                              }}
                            >
                              سحب
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(consents.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                          لا موافقات مسجَّلة لهذا المريض.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * السريان **الفعليّ** لكل غرض.
 *
 * صفٌّ حالته `granted` وتاريخ انتهائه في الماضي يبدو في الجدول سارياً وهو
 * ليس كذلك — وهذا أخطر من غياب الموافقة، لأن الموظّف يتصرّف على أساسه.
 * `app_has_patient_consent` تحسب الانتهاء والسحب معًا، فهي مصدر الحكم.
 */
function ActiveConsentsStrip({ patientId }: { patientId: string }) {
  const active = useQuery({
    queryKey: ["active-consents", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const entries = await Promise.all(
        Object.keys(CONSENT_TYPES).map(async (type) => {
          const { data, error } = await supabase.rpc("app_has_patient_consent", {
            p_patient_id: patientId,
            p_consent_type: type,
          });
          if (error) throw error;
          return [type, Boolean(data)] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, boolean>;
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">السريان الفعليّ الآن</CardTitle>
        <CardDescription>
          محسوبًا من القاعدة: يأخذ السحب والانتهاء معًا. موافقةٌ انتهت مدّتها تظهر هنا
          غيرَ سارية ولو بقي سطرها في السجل «سارية».
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {active.isLoading && <Skeleton className="h-8 w-full" />}
        {!active.isLoading &&
          Object.entries(CONSENT_TYPES).map(([key, label]) => (
            <Badge key={key} variant={active.data?.[key] ? "success" : "secondary"}>
              {label}: {active.data?.[key] ? "سارية" : "غير سارية"}
            </Badge>
          ))}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * سجل الاطّلاع
 * ════════════════════════════════════════════════════════════════════════ */
function AccessLogPanel() {
  const { organization } = useOrganizationAccess();
  const [days, setDays] = useState("7");

  const log = useQuery({
    queryKey: ["access-log", organization?.id, days],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - Number(days));
      const { data, error } = await supabase
        .from("v_medical_record_access_log_detail")
        .select("id, occurred_at, access_type, context, reason, patient_name, file_number, user_name, user_id, branch_name, device_name")
        .eq("organization_id", organization!.id)
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="h-4 w-4" />
          سجل الاطّلاع على الملفات الطبية
        </CardTitle>
        <CardDescription>
          سجل التدقيق يجيب عن «مَن عدّل»؛ هذا السجل يجيب عن «مَن اطّلع» — وهو ما تسأل
          عنه أنظمة حماية البيانات. السجل لا يُعدَّل ولا يُحذف.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex w-40 flex-col gap-1.5">
          <Label>آخر</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">يوم</SelectItem>
              <SelectItem value="7">٧ أيام</SelectItem>
              <SelectItem value="30">٣٠ يومًا</SelectItem>
              <SelectItem value="90">٩٠ يومًا</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {log.isLoading && <Skeleton className="h-32 w-full" />}
        {!log.isLoading && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوقت</TableHead>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الجهاز والسياق</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(log.data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {new Date(r.occurred_at).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">
                      <p className="font-medium">{r.user_name ?? "—"}</p>
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">{r.user_id?.slice(0, 8) ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p className="font-medium">{r.patient_name ?? "—"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{r.file_number ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm">{r.branch_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {ACCESS_TYPES[r.access_type] ?? r.access_type}
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{r.device_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{r.context ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(log.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا اطّلاعات مسجَّلة في هذه المدّة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * سياسات الاحتفاظ
 * ════════════════════════════════════════════════════════════════════════ */
function RetentionPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [entityKey, setEntityKey] = useState("patient_records");
  const [months, setMonths] = useState("120");
  const [action, setAction] = useState("archive");
  const [basis, setBasis] = useState("");

  const policies = useQuery({
    queryKey: ["retention-policies", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_retention_policies")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("entity_key");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("data_retention_policies").insert({
        organization_id: organization!.id,
        entity_key: entityKey,
        retention_months: Number(months),
        action_on_expiry: action,
        legal_basis: basis.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retention-policies", organization?.id] });
      setBasis("");
      toast({ title: "حُفظت السياسة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  /**
   * حساب أثر السياسة — إحصاءٌ لا تعديل.
   *
   * الأرشفة الفعلية تختلف بين نوع بيانات وآخر وتُنفَّذ في مرحلة كلٍّ منها؛
   * ما يلزم قبل الإطلاق هو أن يرى المشغّل حجم ما تجاوز المدّة، ويُختم وقت
   * آخر مراجعة في السياسة نفسها.
   */
  const review = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_apply_retention_policy", {
        p_policy_id: id,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["retention-policies", organization?.id] });
      toast({
        title: "حُسب أثر السياسة",
        description: `${count.toLocaleString("ar-SA")} سجلًّا تجاوز المدّة — لم يُحذف ولم يُعدَّل شيء`,
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحساب",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from("data_retention_policies")
        .update({ is_active })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["retention-policies", organization?.id] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التعديل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("privacy.retention") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileLock2 className="h-4 w-4" />
              سياسة احتفاظ جديدة
            </CardTitle>
            <CardDescription>
              الإجراء عند الانتهاء لا يتضمّن الحذف: البيانات الطبية والمالية تُؤرشَف أو
              تُخفى هويّتها. والسند النظاميّ إلزاميّ.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>نوع البيانات</Label>
              <Select value={entityKey} onValueChange={setEntityKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ENTITY_KEYS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>مدّة الاحتفاظ (شهرًا)</Label>
              <Input
                type="number"
                min={1}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء عند الانتهاء</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RETENTION_ACTIONS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السند النظاميّ *</Label>
              <Input
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
                placeholder="النظام أو اللائحة التي توجب المدّة"
              />
            </div>
            <div className="sm:col-span-4">
              <Button
                disabled={!basis.trim() || Number(months) < 1 || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "جارٍ الحفظ..." : "حفظ السياسة"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">السياسات المسجَّلة</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {policies.isLoading && <Skeleton className="h-24 w-full" />}
          {!policies.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نوع البيانات</TableHead>
                  <TableHead>المدّة</TableHead>
                  <TableHead>الإجراء</TableHead>
                  <TableHead>السند النظاميّ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(policies.data ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {ENTITY_KEYS[p.entity_key] ?? p.entity_key}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.retention_months} شهرًا
                    </TableCell>
                    <TableCell className="text-sm">
                      {RETENTION_ACTIONS[p.action_on_expiry] ?? p.action_on_expiry}
                    </TableCell>
                    <TableCell className="max-w-72 truncate text-sm text-muted-foreground">
                      {p.legal_basis}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? "سارية" : "معطّلة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {can("privacy.retention") && (
                        <div className="flex justify-end gap-1">
                          {/* حساب الأثر قبل التطبيق: لا يحذف ولا يعدّل صفًّا */}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={review.isPending}
                            onClick={() => review.mutate(p.id)}
                            title={
                              p.last_run_at
                                ? `آخر مراجعة: ${new Date(p.last_run_at).toLocaleString("ar-SA")}`
                                : "لم تُراجَع بعد"
                            }
                          >
                            حساب الأثر
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={toggle.isPending}
                            onClick={() =>
                              toggle.mutate({ id: p.id, is_active: !p.is_active })
                            }
                          >
                            {p.is_active ? "تعطيل" : "تفعيل"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(policies.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا سياسات احتفاظ مسجَّلة. سجّل واحدة لكل نوع بيانات قبل الإطلاق.
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
