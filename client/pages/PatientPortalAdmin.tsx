import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LinkIcon, UserCog } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * إدارة بوابة المريض — المرحلة 24 (جانب الموظفين).
 *
 * الربط يدويّ بعد التحقّق من الهوية: **لا يُنشئ النظام حسابًا للمريض ولا
 * يرسل له رمزًا**. المريض يسجّل بنفسه ببريده، والموظف يربط ذلك الحساب بملفه
 * وجهًا لوجه. هذا أضبط أمنيًّا من فتح ملفٍ طبيّ برسالة قد تصل رقمًا خاطئًا.
 */
export default function PatientPortalAdmin() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">بوابة المريض</h1>
        <p className="text-sm text-muted-foreground">
          طلبات المرضى وحسابات وصولهم — الطلب يُراجع، ولا يحجز المريض موعدًا بنفسه
        </p>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">الطلبات المعلّقة</TabsTrigger>
          <TabsTrigger value="accounts">حسابات البوابة</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4"><RequestsPanel /></TabsContent>
        <TabsContent value="accounts" className="mt-4"><AccountsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * الطلبات المعلّقة
 * ════════════════════════════════════════════════════════════════════════ */
function RequestsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [approving, setApproving] = useState<any | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [startAt, setStartAt] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [doctorId, setDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const requests = useQuery({
    queryKey: ["pending-patient-requests", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pending_patient_requests").select("*")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const doctors = useQuery({
    queryKey: ["portal-doctors", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors").select("id, name_ar")
        .eq("organization_id", organization!.id)
        // القائمة تعرض النشطين القابلين للحجز فقط
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const clinics = useQuery({
    queryKey: ["portal-clinics", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics").select("id, name")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["pending-patient-requests", organization?.id] });
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const approveAppointment = useMutation({
    mutationFn: async () => {
      const start = new Date(startAt);
      const end = new Date(start.getTime() + (Number(minutes) || 30) * 60000);
      const { error } = await supabase.rpc("app_approve_appointment_request", {
        p_request_id: approving.id,
        p_start: start.toISOString(),
        p_end: end.toISOString(),
        p_doctor_id: doctorId || null,
        p_clinic_id: clinicId || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setApproving(null); setStartAt(""); setNote(""); setDoctorId(""); setClinicId("");
      toast({ title: "اعتُمد الطلب وحُجز الموعد" });
    },
    onError: fail("تعذر الاعتماد"),
  });

  const rejectRequest = useMutation({
    mutationFn: async () => {
      if (rejecting.request_kind === "appointment") {
        const { error } = await supabase.rpc("app_reject_appointment_request", {
          p_request_id: rejecting.id, p_reason: reason.trim(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("app_decide_patient_change_request", {
          p_request_id: rejecting.id, p_approve: false, p_note: reason.trim(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setRejecting(null); setReason("");
      toast({ title: "رُفض الطلب وأُبلغ المريض بالسبب في بوابته" });
    },
    onError: fail("تعذر الرفض"),
  });

  const approveChange = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_decide_patient_change_request", {
        p_request_id: id, p_approve: true, p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "اعتُمد التعديل وطُبِّق على الملف" });
    },
    onError: fail("تعذر الاعتماد"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" />
            طلبات المرضى المعلّقة
          </CardTitle>
          <CardDescription>
            طلب الموعد **لا يحجز فترة** حتى تعتمده أنت، وتعديل البيانات لا
            يُطبَّق على الملف قبل مراجعتك.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading && <Skeleton className="h-40 w-full" />}
          {!requests.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>نوع الطلب</TableHead>
                  <TableHead>التفاصيل</TableHead>
                  <TableHead>المطلوب</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).map((r) => (
                  <TableRow key={`${r.request_kind}-${r.id}`}>
                    <TableCell className="text-sm">
                      {r.patient_name}
                      {r.file_number && (
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {r.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.request_kind === "appointment" ? "default" : "secondary"}>
                        {r.request_kind === "appointment" ? "طلب موعد" : "تعديل بيانات"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-sm">{r.details || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.requested_value ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(r.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-left">
                      {can("portal.requests") && (
                        <div className="flex justify-end gap-1">
                          {r.request_kind === "appointment" ? (
                            <Button size="sm" variant="outline"
                                    onClick={() => { setApproving(r); setStartAt(""); }}>
                              حجز
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline"
                                    disabled={approveChange.isPending}
                                    onClick={() => approveChange.mutate(r.id)}>
                              اعتماد
                            </Button>
                          )}
                          <Button size="sm" variant="ghost"
                                  onClick={() => { setRejecting(r); setReason(""); }}>
                            رفض
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(requests.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا طلبات معلّقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(approving)} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حجز موعد — {approving?.patient_name}</DialogTitle>
            <DialogDescription>
              الفترة المطلوبة من المريض: {approving?.requested_value ?? "غير محدّدة"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>بداية الموعد *</Label>
              <Input type="datetime-local" value={startAt}
                     onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المدة (دقائق)</Label>
              <Input type="number" min={5} step={5} value={minutes}
                     onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger><SelectValue placeholder="كما طلب المريض" /></SelectTrigger>
                <SelectContent>
                  {(clinics.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger><SelectValue placeholder="كما طلب المريض" /></SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ملاحظة</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!startAt || approveAppointment.isPending}
                    onClick={() => approveAppointment.mutate()}>
              اعتماد وحجز
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض الطلب</DialogTitle>
            <DialogDescription>
              السبب يظهر للمريض في بوابته — رفضٌ بلا سبب لا يفيده.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>سبب الرفض *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={!reason.trim() || rejectRequest.isPending}
                    onClick={() => rejectRequest.mutate()}>
              رفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * حسابات البوابة
 * ════════════════════════════════════════════════════════════════════════ */
function AccountsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [linking, setLinking] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [email, setEmail] = useState("");
  const [revoking, setRevoking] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");

  const accounts = useQuery({
    queryKey: ["portal-accounts", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_portal_accounts")
        .select("*, patient:patients(name_ar, file_number)")
        .eq("organization_id", organization!.id)
        .order("linked_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const patients = useQuery({
    queryKey: ["portal-patient-search", organization?.id, search],
    enabled: Boolean(organization?.id) && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients").select("id, name_ar, file_number")
        .eq("organization_id", organization!.id)
        .ilike("name_ar", `%${search.trim()}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["portal-accounts", organization?.id] });
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const link = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_link_patient_portal_account", {
        p_patient_id: patientId, p_email: email.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setLinking(false); setPatientId(""); setEmail(""); setSearch("");
      toast({ title: "رُبط حساب البوابة بملف المريض" });
    },
    onError: fail("تعذر الربط"),
  });

  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_revoke_patient_portal_access", {
        p_account_id: revoking.id, p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setRevoking(null); setReason("");
      toast({ title: "أُلغي وصول البوابة فورًا" });
    },
    onError: fail("تعذر الإلغاء"),
  });

  const STATUS: Record<string, { label: string; variant: any }> = {
    active: { label: "نشط", variant: "success" },
    suspended: { label: "موقوف", variant: "secondary" },
    revoked: { label: "ملغى", variant: "destructive" },
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCog className="h-4 w-4" />
              حسابات وصول المرضى
            </CardTitle>
            <CardDescription>
              يسجّل المريض بنفسه ببريده، ثم تربط أنت حسابه بملفه **بعد التحقّق
              من هويته**. النظام لا ينشئ حسابًا ولا يرسل رمزًا.
            </CardDescription>
          </div>
          {can("portal.manage") && (
            <Button onClick={() => setLinking(true)}>
              <LinkIcon className="h-4 w-4" />
              ربط حساب
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {accounts.isLoading && <Skeleton className="h-32 w-full" />}
          {!accounts.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>رُبط في</TableHead>
                  <TableHead>آخر دخول</TableHead>
                  <TableHead>سبب الإلغاء</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">
                      {a.patient?.name_ar}
                      {a.patient?.file_number && (
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {a.patient.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[a.status]?.variant ?? "secondary"}>
                        {STATUS[a.status]?.label ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(a.linked_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.last_seen_at
                        ? new Date(a.last_seen_at).toLocaleDateString("ar-SA")
                        : "لم يدخل بعد"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                      {a.revoke_reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      {a.status === "active" && can("portal.manage") && (
                        <Button size="sm" variant="ghost"
                                onClick={() => { setRevoking(a); setReason(""); }}>
                          إلغاء الوصول
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(accounts.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا حسابات بوابة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ربط حساب بوابة</DialogTitle>
            <DialogDescription>
              تحقّق من هوية المريض أمامك قبل الربط — الربط يفتح سجلّه الطبي.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>ابحث عن المريض</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                     placeholder="اسم المريض" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المريض *</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder="اختر من نتائج البحث" /></SelectTrigger>
                <SelectContent>
                  {(patients.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name_ar} {p.file_number ? `— ${p.file_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>بريد الحساب الذي سجّله المريض *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <span className="text-[10px] text-muted-foreground">
                إن لم يكن قد سجّل بعد، فلن يُقبل الربط — يسجّل أوّلًا ثم يُربط
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!patientId || !email.trim() || link.isPending}
                    onClick={() => link.mutate()}>
              ربط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء وصول البوابة</DialogTitle>
            <DialogDescription>
              ينقطع وصول المريض لسجلّه فورًا، ويبقى السبب في السجل.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={!reason.trim() || revoke.isPending}
                    onClick={() => revoke.mutate()}>
              إلغاء الوصول
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
