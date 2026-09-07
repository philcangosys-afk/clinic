import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Plus, Check, X, Trash2, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * الجلسات العلاجية (لقطة 51).
 *
 * جدول `treatment_sessions` موجود منذ 0003 بلا أي واجهة. الفكرة: بند اتفاقية
 * واحد (مثل "تقويم أسنان") قد يُنفَّذ على عشر جلسات — فالاتفاقية تقول ماذا
 * اتُّفق عليه، والجلسات تقول ما نُفِّذ منه فعلًا ومتى وعلى يد من.
 *
 * **قرار مقصود: الجلسة لا تُنشئ فاتورة ولا تمسّ المبالغ.** الاتفاقية تُفوتَر
 * من شاشة الفوترة، ومُحفِّز `app_recalc_agreement_invoiced` (0003) هو وحده من
 * يحدّث `invoiced_amount`. لو جعلنا إكمال الجلسة يُفوتِر تلقائيًا لأصبح لدينا
 * مساران يكتبان في نفس الرقم — وهو أسرع طريق لاختلاف الحسابين.
 */
type SessionRow = {
  id: string;
  session_number: number;
  scheduled_date: string | null;
  status: "scheduled" | "completed" | "cancelled";
  note: string | null;
  created_at: string;
  agreement_id: string | null;
  agreement_item_id: string | null;
  doctor: { name_ar: string } | null;
  agreement_item: { description: string | null; qty: number } | null;
};

const STATUS_LABELS: Record<SessionRow["status"], string> = {
  scheduled: "مجدولة",
  completed: "منفَّذة",
  cancelled: "ملغاة",
};
const STATUS_VARIANT: Record<SessionRow["status"], "secondary" | "success" | "destructive"> = {
  scheduled: "secondary",
  completed: "success",
  cancelled: "destructive",
};

function useSessions(patientId: string) {
  return useQuery({
    queryKey: ["patient-sessions", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_sessions")
        .select(
          "id, session_number, scheduled_date, status, note, created_at, agreement_id, agreement_item_id, doctor:doctors(name_ar), agreement_item:treatment_agreement_items(description, qty)",
        )
        // المريض ينتمي لمنشأة واحدة، فالتقييد به يكفي لعزل المؤسسات
        .eq("patient_id", patientId)
        /**
         * جلسات هذا التبويب فقط — أي التي بلا `item_id`. الجلسات السريرية
         * (ليزر/تجميل) تُسجَّل بـ`app_record_treatment_session` وتُرقَّم **لكل
         * خدمة على حدة**، بينما هذا التبويب يُرقّم تسلسلًا واحدًا لكل مريض:
         * سردهما في جدول واحد كان يُظهر جلستين برقم `1` لنفس المريض ولا قيد
         * فريد في القاعدة يمنع ذلك. الجلسات السريرية معروضة في اللوح السريري
         * فوق هذا التبويب بأرقامها ومعناها الصحيح.
         */
        .is("item_id", null)
        .order("session_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as SessionRow[];
    },
  });
}

/** بنود اتفاقيات المريض غير المعطَّلة — مصدر ربط الجلسة ببند العلاج. */
function useAgreementItems(patientId: string, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["patient-agreement-items", patientId, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_agreements")
        .select(
          "id, agreement_number, is_disabled, treatment_agreement_items(id, description, qty)",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .eq("is_disabled", false)
        .order("agreement_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        agreement_number: number;
        treatment_agreement_items: { id: string; description: string | null; qty: number }[];
      }[];
    },
  });
}

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["sessions-doctors", organizationId],
    enabled: Boolean(organizationId),
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
}

const NONE = "__none__";

function NewSessionDialog({
  open,
  onOpenChange,
  patientId,
  organizationId,
  nextNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  organizationId: string | undefined;
  nextNumber: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const agreements = useAgreementItems(patientId, organizationId);
  const doctors = useDoctors(organizationId);

  const [agreementItemId, setAgreementItemId] = useState(NONE);
  const [doctorId, setDoctorId] = useState(NONE);
  const [scheduledDate, setScheduledDate] = useState("");
  const [sessionCount, setSessionCount] = useState("1");
  const [note, setNote] = useState("");

  /** يربط بند الاتفاقية باتفاقيته — الجلسة تخزّن المعرّفين معًا. */
  const itemToAgreement = new Map<string, string>();
  (agreements.data ?? []).forEach((agreement) =>
    (agreement.treatment_agreement_items ?? []).forEach((item) =>
      itemToAgreement.set(item.id, agreement.id),
    ),
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const count = Number(sessionCount);
      if (!Number.isInteger(count) || count < 1 || count > 60)
        throw new Error("عدد الجلسات يجب أن يكون رقمًا صحيحًا بين 1 و60");

      /**
       * منع تجاوز عدد الجلسات المتفق عليه في بند الاتفاقية.
       *
       * لم يكن هناك أي حدّ: بند اتفاقية بأربع جلسات يمكن جدولة عشرين جلسة
       * عليه، فتُنفَّذ العيادة عملًا لم يُتفق عليه ولن يُدفع مقابله — ولا
       * يظهر الخلل إلا عند تسوية الحساب في النهاية.
       *
       * العدّ يُقرأ من القاعدة لا من قائمة الشاشة: القائمة مخزَّنة في ذاكرة
       * react-query وقد يكون زميل جدول جلسات على البند نفسه قبل لحظات.
       * والملغاة تُستثنى — إلغاء جلسة يعيدها إلى الرصيد المتاح.
       */
      if (agreementItemId !== NONE) {
        const agreementItem = agreements.data
          ?.flatMap((agreement) => agreement.treatment_agreement_items ?? [])
          .find((item) => item.id === agreementItemId);
        // البند غير موجود في القائمة (لم تُحمَّل بعد، أو عُطِّلت اتفاقيته) →
        // لا يُفرض حدّ. أما البند الموجود فيُفرض حدّه **ولو كان صفرًا**:
        // `|| 0` مع `if (allowed > 0)` كان يجعل بندًا بكمية صفر بلا أي حدّ.
        const allowed = agreementItem ? Number(agreementItem.qty) || 0 : null;

        if (allowed !== null) {
          const { count: usedCount, error: countError } = await supabase
            .from("treatment_sessions")
            .select("id", { count: "exact", head: true })
            .eq("agreement_item_id", agreementItemId)
            .neq("status", "cancelled");
          if (countError) throw countError;

          const used = usedCount ?? 0;
          const remaining = allowed - used;
          if (remaining <= 0)
            throw new Error(
              `بند الاتفاقية مستهلك بالكامل (${used} من ${allowed}) — عدّل الاتفاقية لزيادة العدد`,
            );
          if (count > remaining)
            throw new Error(
              `المتبقّي في بند الاتفاقية ${remaining} جلسة فقط (${used} من ${allowed} مجدولة)`,
            );
        }
      }

      /**
       * إنشاء عدة جلسات دفعةً واحدة: خطة علاج من عشر جلسات تُجدوَل مرة
       * واحدة لا بعشر عمليات إدخال. الأرقام تتسلسل من آخر رقم موجود.
       */
      const rows = Array.from({ length: count }, (_, index) => ({
        organization_id: organizationId,
        patient_id: patientId,
        doctor_id: doctorId === NONE ? null : doctorId,
        agreement_id: agreementItemId === NONE ? null : itemToAgreement.get(agreementItemId) ?? null,
        agreement_item_id: agreementItemId === NONE ? null : agreementItemId,
        session_number: nextNumber + index,
        // التاريخ للجلسة الأولى فقط؛ الباقي يُجدوَل لاحقًا بلا تخمين فواصل
        // زمنية لا يعرفها النظام (أسبوعية؟ شهرية؟ حسب استجابة المريض؟).
        scheduled_date: index === 0 ? scheduledDate || null : null,
        status: "scheduled" as const,
        note: note.trim() || null,
      }));

      const { error } = await supabase.from("treatment_sessions").insert(rows);
      if (error) throw error;
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["patient-sessions", patientId] });
      toast({ title: count === 1 ? "تمت إضافة الجلسة" : `تمت إضافة ${count} جلسات` });
      setAgreementItemId(NONE);
      setDoctorId(NONE);
      setScheduledDate("");
      setSessionCount("1");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>جدولة جلسات علاجية</DialogTitle>
          <DialogDescription>
            الجلسة تسجّل ما نُفِّذ من خطة العلاج — ولا تُنشئ فاتورة ولا تغيّر مبالغ الاتفاقية
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>بند الاتفاقية</Label>
            <Select value={agreementItemId} onValueChange={setAgreementItemId}>
              <SelectTrigger>
                <SelectValue placeholder="بلا ربط باتفاقية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بلا ربط باتفاقية</SelectItem>
                {(agreements.data ?? []).flatMap((agreement) =>
                  (agreement.treatment_agreement_items ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      #{agreement.agreement_number} — {item.description ?? "بند"} (×{item.qty})
                    </SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
            {(agreements.data ?? []).length === 0 && !agreements.isLoading && (
              <p className="text-xs text-muted-foreground">
                لا توجد اتفاقيات نشطة لهذا المريض — يمكن جدولة جلسات بلا ربط.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الطبيب المعالج</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>تاريخ الجلسة الأولى</Label>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>عدد الجلسات</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={sessionCount}
                onChange={(e) => setSessionCount(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "جدولة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SessionsTab({ patientId }: { patientId: string }) {
  const { organization, session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sessions = useSessions(patientId);
  const [createOpen, setCreateOpen] = useState(false);

  const rows = sessions.data ?? [];
  /**
   * الترقيم يبدأ من آخر رقم في **جلسات هذا التبويب** (بلا `item_id`) — ولذلك
   * **لا يجوز الجدولة قبل تحميل الجلسات**: مريض له جلسات 1..10 وقائمته لم
   * تُحمَّل بعد كان يحصل على جلسات جديدة بأرقام 1، 2، 3 مكرَّرة، ولا قيد فريد
   * في القاعدة يمنع ذلك.
   */
  const nextNumber = rows.length > 0 ? Math.max(...rows.map((row) => row.session_number)) + 1 : 1;
  const canSchedule = !sessions.isLoading && !sessions.isError;
  const completed = rows.filter((row) => row.status === "completed").length;
  const active = rows.filter((row) => row.status !== "cancelled").length;

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SessionRow["status"] }) => {
      /**
       * «منفَّذة» ليست حالةً فقط: الجلسة سجل علاجي يجيب عن «من نفّذها ومتى؟».
       * التحديث القديم كتب `status` وحده، فبقيت `performed_at` و`performed_by`
       * فارغتين — والعرض `v_session_history` يُظهر الجلسة بتاريخ فارغ، واللوح
       * السريري بلا اسم منفِّذ، وهو نفس ما تكتبه `app_record_treatment_session`
       * في المسار الآخر.
       */
      const patch: Record<string, unknown> =
        status === "completed"
          ? { status, performed_at: new Date().toISOString(), performed_by: session?.user.id ?? null }
          : { status };
      const { data, error } = await supabase
        .from("treatment_sessions")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST — بلا هذا الفحص تظهر رسالة
      // نجاح ولا يُحفظ شيء.
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-sessions", patientId] });
      toast({ title: "تم تحديث حالة الجلسة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const removeSession = useMutation({
    mutationFn: async (row: SessionRow) => {
      // الجلسة المنفَّذة سجل علاجي — حذفها يمحو أثر ما جرى للمريض فعلًا.
      // الإلغاء يحفظ الأثر ويوقف العدّ، وهو ما يجب أن يُستعمل.
      if (row.status === "completed")
        throw new Error("لا يمكن حذف جلسة منفَّذة — ألغِها إن كان تسجيلها خطأً");
      const { data, error } = await supabase
        .from("treatment_sessions")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-sessions", patientId] });
      toast({ title: "تم حذف الجلسة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: errorMessage(error),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" />
            الجلسات العلاجية
          </CardTitle>
          <CardDescription>
            {active > 0
              ? `نُفِّذت ${completed} من ${active} جلسة`
              : "خطة الجلسات لبنود العلاج متعددة الجلسات"}
          </CardDescription>
        </div>
        <Button
          size="sm"
          disabled={!canSchedule}
          title={canSchedule ? undefined : "جارٍ تحميل الجلسات الحالية لتحديد الترقيم"}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          جدولة جلسات
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            الجلسات تسجّل <strong>تنفيذ</strong> خطة العلاج ولا تمسّ المبالغ. فوترة الاتفاقية تتم
            من شاشة الفوترة، والمبلغ المُفوتَر يحسبه النظام من الفواتير نفسها. أما الجلسات
            السريرية (الخدمة والجهاز والمنطقة) فتُسجَّل وتُعرض في اللوح السريري أعلاه بترقيمها
            الخاص بكل خدمة.
          </span>
        </div>

        {sessions.isLoading && <Skeleton className="h-32 w-full" />}
        {!sessions.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>بند العلاج</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>ملاحظة</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const item = Array.isArray(row.agreement_item) ? row.agreement_item[0] : row.agreement_item;
                const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.session_number}</TableCell>
                    <TableCell className="text-sm">{item?.description ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.scheduled_date
                        ? new Date(row.scheduled_date).toLocaleDateString("ar-SA")
                        : "غير محدَّد"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {row.status === "scheduled" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              title="تسجيل التنفيذ"
                              onClick={() => setStatus.mutate({ id: row.id, status: "completed" })}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="إلغاء"
                              onClick={() => setStatus.mutate({ id: row.id, status: "cancelled" })}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {row.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="حذف"
                            onClick={() => removeSession.mutate(row)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد جلسات مجدولة لهذا المريض.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {createOpen && (
        <NewSessionDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          patientId={patientId}
          organizationId={organization?.id}
          nextNumber={nextNumber}
        />
      )}
    </Card>
  );
}
