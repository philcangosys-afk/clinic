import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, FileText, FlaskConical, LogOut, ReceiptText, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * بوابة المريض — المرحلة 24 (جانب المريض).
 *
 * هذه الشاشة **خارج قشرة النظام** (AppShell) عمدًا: المريض ليس عضوًا في
 * المنشأة ولا يرى قائمتها الجانبية ولا شاشاتها. كل ما هنا يمرّ بسياسات
 * الصفوف في القاعدة: ما لا تسمح به السياسة لا يظهر ولو أخطأت هذه الشاشة.
 *
 * وما لا يفعله المريض هنا مقصود: لا يحجز موعدًا في التقويم (يطلب فيراجَع)،
 * ولا يعدّل هويته (يطلب فيراجَع)، ولا يرى نتيجة لم تُعتمد بعد.
 */
const money = (v: any) =>
  Number(v ?? 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Portal() {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setReady(true);
    });
  }, []);

  const account = useQuery({
    queryKey: ["portal-account", userId],
    enabled: ready && Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_portal_accounts")
        .select("id, organization_id, patient_id, status")
        .eq("status", "active")
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as any;
    },
  });

  useEffect(() => {
    if (account.data?.organization_id) {
      // تسجيل آخر دخول — بلا هذا لا يعرف الموظف أن الحساب مستعمل أصلًا
      supabase.rpc("app_portal_touch", { p_org: account.data.organization_id });
    }
  }, [account.data?.organization_id]);

  if (!ready || account.isLoading) {
    return (
      <main dir="rtl" className="mx-auto max-w-4xl p-6">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (!userId) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-muted/30 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>بوابة المريض</CardTitle>
            <CardDescription>
              سجّل الدخول بحسابك للاطّلاع على مواعيدك ونتائجك.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              إن لم يكن لديك حساب بعد، أنشئ حسابًا ببريدك ثم راجع الاستقبال
              لربطه بملفك — الربط يتمّ بعد التحقّق من هويتك.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!account.data) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-muted/30 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>حسابك غير مربوط بملف</CardTitle>
            <CardDescription>
              راجع استقبال المنشأة لربط هذا الحساب بملفك الطبي.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const orgId = account.data.organization_id as string;

  return (
    <main dir="rtl" className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">بوابتي الصحية</h1>
          <p className="text-sm text-muted-foreground">
            مواعيدك ونتائجك المعتمدة وفواتيرك ومستنداتك
          </p>
        </div>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
          <LogOut className="h-4 w-4" />
          خروج
        </Button>
      </header>

      <Tabs defaultValue="appointments">
        <TabsList>
          <TabsTrigger value="appointments">مواعيدي</TabsTrigger>
          <TabsTrigger value="results">نتائجي</TabsTrigger>
          <TabsTrigger value="invoices">فواتيري</TabsTrigger>
          <TabsTrigger value="documents">مستنداتي</TabsTrigger>
          <TabsTrigger value="requests">طلباتي</TabsTrigger>
        </TabsList>
        <TabsContent value="appointments" className="mt-4"><PortalAppointments orgId={orgId} /></TabsContent>
        <TabsContent value="results" className="mt-4"><PortalResults /></TabsContent>
        <TabsContent value="invoices" className="mt-4"><PortalInvoices /></TabsContent>
        <TabsContent value="documents" className="mt-4"><PortalDocuments /></TabsContent>
        <TabsContent value="requests" className="mt-4"><PortalRequests orgId={orgId} /></TabsContent>
      </Tabs>
    </main>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * المواعيد
 * ════════════════════════════════════════════════════════════════════════ */
function PortalAppointments({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [reason, setReason] = useState("");

  const appointments = useQuery({
    queryKey: ["portal-appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_portal_appointments").select("*")
        .order("scheduled_start", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_portal_cancel_appointment", {
        p_appointment_id: cancelling.id, p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-appointments"] });
      setCancelling(null); setReason("");
      toast({ title: "أُلغي الموعد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الإلغاء",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" />
          مواعيدي
        </CardTitle>
        <CardDescription>يمكنك إلغاء موعد قادم — الإلغاء يحتاج سببًا.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {appointments.isLoading && <Skeleton className="h-32 w-full" />}
        {!appointments.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموعد</TableHead>
                <TableHead>العيادة</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(appointments.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(a.scheduled_start).toLocaleString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell className="text-sm">{a.clinic_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{a.doctor_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={
                      String(a.status).startsWith("cancelled") ? "destructive"
                        : a.is_upcoming ? "default" : "secondary"}>
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {a.is_upcoming && !String(a.status).startsWith("cancelled") && (
                      <Button size="sm" variant="ghost"
                              onClick={() => { setCancelling(a); setReason(""); }}>
                        إلغاء
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(appointments.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا مواعيد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}

        {cancelling && (
          <div className="mt-4 flex flex-col gap-2 rounded-md border p-3">
            <Label>سبب الإلغاء *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={!reason.trim() || cancel.isPending}
                      onClick={() => cancel.mutate()}>
                تأكيد الإلغاء
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelling(null)}>
                تراجع
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * النتائج
 * ════════════════════════════════════════════════════════════════════════ */
function PortalResults() {
  const results = useQuery({
    queryKey: ["portal-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_portal_results").select("*")
        .order("resulted_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" />
          نتائجي
        </CardTitle>
        <CardDescription>
          تظهر هنا النتائج **بعد اعتماد الطبيب أو المختبر** فقط. نتيجة قيد
          المراجعة لا تُعرض حتى لا تُقرأ خطأً.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {results.isLoading && <Skeleton className="h-32 w-full" />}
        {!results.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفحص</TableHead>
                <TableHead>النتيجة</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>التاريخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results.data ?? []).map((r) => (
                <TableRow key={`${r.result_kind}-${r.id}-${r.test_name}`}>
                  <TableCell className="text-sm">
                    {r.test_name ?? (r.result_kind === "radiology" ? "تقرير أشعة" : "فحص")}
                  </TableCell>
                  <TableCell className="max-w-72 text-sm">
                    {r.result_value ?? "—"}
                    {r.unit ? ` ${r.unit}` : ""}
                    {r.is_abnormal && (
                      <Badge variant="destructive" className="ms-2">خارج المعدّل</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.reference_text ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.resulted_at ? new Date(r.resulted_at).toLocaleDateString("ar-SA-u-nu-latn") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(results.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا نتائج معتمدة بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * الفواتير
 * ════════════════════════════════════════════════════════════════════════ */
function PortalInvoices() {
  const invoices = useQuery({
    queryKey: ["portal-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_portal_invoices").select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="h-4 w-4" />
          فواتيري
        </CardTitle>
        <CardDescription>الفواتير الصادرة على ملفك والمتبقّي منها.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {invoices.isLoading && <Skeleton className="h-32 w-full" />}
        {!invoices.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقّي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices.data ?? []).map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">#{i.invoice_number}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(i.created_at).toLocaleDateString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{money(i.net_amount)}</TableCell>
                  <TableCell className="font-mono text-xs">{money(i.paid_amount)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {money(i.remaining_amount)}
                    {Number(i.remaining_amount ?? 0) > 0 && (
                      <Badge variant="destructive" className="ms-1">غير مسدَّدة</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(invoices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا فواتير.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * المستندات
 * ════════════════════════════════════════════════════════════════════════ */
function PortalDocuments() {
  const { toast } = useToast();

  const documents = useQuery({
    queryKey: ["portal-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_portal_documents").select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const open = useMutation({
    mutationFn: async (row: any) => {
      const { data, error } = await supabase.storage
        .from("patient-documents").createSignedUrl(row.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر فتح المستند",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          مستنداتي
        </CardTitle>
        <CardDescription>تقاريرك وموافقاتك الموقَّعة.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {documents.isLoading && <Skeleton className="h-32 w-full" />}
        {!documents.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المستند</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(documents.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-72 truncate text-sm">
                    {d.file_name ?? "مستند"}
                  </TableCell>
                  <TableCell>
                    {d.is_consent ? (
                      <Badge variant={d.signed_at ? "success" : "secondary"}>
                        {d.signed_at ? "موافقة موقَّعة" : "موافقة"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">مستند</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(d.created_at).toLocaleDateString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button size="sm" variant="ghost" onClick={() => open.mutate(d)}>
                      فتح
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(documents.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا مستندات.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * الطلبات
 * ════════════════════════════════════════════════════════════════════════ */
function PortalRequests({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState("any");
  const [reason, setReason] = useState("");
  const [field, setField] = useState("phone_1");
  const [value, setValue] = useState("");

  const requests = useQuery({
    queryKey: ["portal-my-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_requests").select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const changes = useQuery({
    queryKey: ["portal-my-changes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_change_requests").select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const requestAppointment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_portal_request_appointment", {
        p_org: orgId,
        p_clinic_id: null,
        p_doctor_id: null,
        p_date: date || null,
        p_period: period,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-my-requests"] });
      setDate(""); setReason("");
      toast({
        title: "أُرسل طلب الموعد",
        description: "سيتواصل معك الاستقبال لتأكيد الوقت",
      });
    },
    onError: fail("تعذر إرسال الطلب"),
  });

  const requestChange = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_portal_request_change", {
        p_org: orgId, p_field: field, p_value: value.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-my-changes"] });
      setValue("");
      toast({
        title: "أُرسل طلب التعديل",
        description: "يُطبَّق على ملفك بعد مراجعة الموظف",
      });
    },
    onError: fail("تعذر إرسال الطلب"),
  });

  const STATUS: Record<string, { label: string; variant: any }> = {
    pending: { label: "قيد المراجعة", variant: "default" },
    approved: { label: "معتمد", variant: "success" },
    rejected: { label: "مرفوض", variant: "destructive" },
    cancelled: { label: "ملغى", variant: "secondary" },
  };

  const FIELDS: Record<string, string> = {
    phone_1: "الجوال الأساسي",
    phone_2: "جوال آخر",
    email_1: "البريد الإلكتروني",
    address: "العنوان",
    emergency_number: "رقم الطوارئ",
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">طلب موعد</CardTitle>
          <CardDescription>
            هذا **طلب** لا حجز: يراجعه الاستقبال ويحدّد الوقت المناسب.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex w-44 flex-col gap-1.5">
            <Label>اليوم المفضَّل</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex w-40 flex-col gap-1.5">
            <Label>الفترة</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">أيّ وقت</SelectItem>
                <SelectItem value="morning">صباحًا</SelectItem>
                <SelectItem value="evening">مساءً</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label>سبب الزيارة</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button disabled={requestAppointment.isPending}
                  onClick={() => requestAppointment.mutate()}>
            إرسال الطلب
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">طلباتي السابقة</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading && <Skeleton className="h-24 w-full" />}
          {!requests.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اليوم المطلوب</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>ردّ الاستقبال</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.preferred_date ?? "—"}</TableCell>
                    <TableCell className="max-w-64 truncate text-sm">{r.reason ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[r.status]?.variant ?? "secondary"}>
                        {STATUS[r.status]?.label ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {r.decision_note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(requests.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      لا طلبات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            تحديث بيانات التواصل
          </CardTitle>
          <CardDescription>
            يُراجَع قبل تطبيقه على ملفك — بياناتك أساس مطابقة ملفك وتأمينك.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex w-48 flex-col gap-1.5">
            <Label>الحقل</Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(FIELDS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label>القيمة الجديدة</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button disabled={!value.trim() || requestChange.isPending}
                  onClick={() => requestChange.mutate()}>
            إرسال
          </Button>

          {(changes.data ?? []).length > 0 && (
            <div className="mt-2 w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الحقل</TableHead>
                    <TableHead>القيمة المطلوبة</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(changes.data ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm">{FIELDS[c.field_key] ?? c.field_key}</TableCell>
                      <TableCell className="font-mono text-xs">{c.requested_value}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS[c.status]?.variant ?? "secondary"}>
                          {STATUS[c.status]?.label ?? c.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
