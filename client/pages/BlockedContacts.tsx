import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Plus, ShieldBan, ShieldCheck } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { PatientSearchScopeChips } from "@/components/shared/PatientSearchInput";
import {
  matchesPatientSearch,
  patientSearchPlaceholder,
  type PatientSearchScope,
} from "@/lib/patient-search";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PatientPicker from "@/components/shared/PatientPicker";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * الجهات المحجوبة.
 *
 * الجدول موجود منذ 0002 بأربعة حقول، **ولم يكن يمنع شيئًا**: لا مُحفِّز ولا
 * دالة ولا سطر في مسار الحجز. قائمة تُقرأ ويُحجز رغمها.
 *
 * صار الفرض في القاعدة (0063): مُحفِّز على `appointments` يغطّي مسارات
 * الإنشاء الأربعة — الحجز العادي، المريض الحضوري، تحويل قائمة الانتظار،
 * والحجز الإلكتروني لاحقًا. هذه الشاشة تُدير السجلات ولا تحرس شيئًا؛ إخفاء
 * الزر راحة للعين، والمنع تحته في القاعدة.
 */

type BlockRow = {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  patient_file_number: string | null;
  mobile_number: string | null;
  full_name: string | null;
  id_number: string | null;
  block_type: "booking" | "messaging" | "all";
  reason: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  is_in_effect: boolean;
  created_at: string;
  lifted_at: string | null;
  lift_reason: string | null;
};

const TYPE_LABELS: Record<BlockRow["block_type"], string> = {
  booking: "حجز المواعيد",
  messaging: "الرسائل",
  all: "الكل",
};

type StatusFilter = "in_effect" | "scheduled" | "expired" | "lifted" | "all";

/**
 * حالة رابعة لازمة: العرض `v_blocked_contacts` يحسب
 * `is_in_effect = is_active and starts_at <= now() and (ends_at is null or ends_at > now())`،
 * فكل ما ليس ساريًا وهو نشط كان يُعرض «منتهٍ» — بما فيه حظرٌ **لم يبدأ بعد**
 * (والنافذة تسمح بتاريخ بداية مستقبلي). فيقرؤه الموظف كحظرٍ انقضى، فيسجّل
 * حظرًا ثانيًا أو يظنّ الحجز مسموحًا.
 */
const STATUS_LABELS: Record<StatusFilter, string> = {
  in_effect: "ساري الآن",
  scheduled: "يبدأ لاحقًا",
  expired: "منتهٍ",
  lifted: "مرفوع",
  all: "الكل",
};

/** حظر نشط لم يحن موعد بدايته بعد — لا ساريًا ولا منتهيًا. */
const isScheduled = (row: BlockRow) =>
  row.is_active && !row.is_in_effect && new Date(row.starts_at).getTime() > Date.now();

function useBlockedContacts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["blocked-contacts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_blocked_contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BlockRow[];
    },
  });
}

export default function BlockedContacts() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const { can } = usePermissions();
  const rows = useBlockedContacts(organizationId);

  const [term, setTerm] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [typeFilter, setTypeFilter] = useState<BlockRow["block_type"] | "all_types">("all_types");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("in_effect");
  const [createOpen, setCreateOpen] = useState(false);
  const [liftTarget, setLiftTarget] = useState<BlockRow | null>(null);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (rows.data ?? []).filter((row) => {
      if (typeFilter !== "all_types" && row.block_type !== typeFilter) return false;
      if (statusFilter === "in_effect" && !row.is_in_effect) return false;
      if (statusFilter === "scheduled" && !isScheduled(row)) return false;
      // «منتهٍ» يعني انقضت مدّته وهو ما زال غير مرفوع — لا يُخلط بالمرفوع
      // يدويًا: الأول انتهى بنفسه، والثاني قرارٌ اتّخذه شخص وله سبب مسجَّل.
      // ولا بمن لم يبدأ بعد: ذاك حظر قادم لا حظر انقضى.
      if (statusFilter === "expired" && (!row.is_active || row.is_in_effect || isScheduled(row)))
        return false;
      if (statusFilter === "lifted" && row.is_active) return false;
      if (!needle) return true;
      // البحث الموحَّد نفسه المستعمَل في بقيّة الشاشات — والاسم هنا قد يكون
      // اسم مريض مسجَّل أو اسم جهة خارجية بلا ملفّ.
      return matchesPatientSearch(
        {
          name_ar: row.patient_name ?? row.full_name,
          name_en: row.full_name,
          mobile_number: row.mobile_number,
          id_number: row.id_number,
          file_number: row.patient_file_number,
        },
        term,
        searchScopes,
      );
    });
  }, [rows.data, term, searchScopes, typeFilter, statusFilter]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldBan className="h-5 w-5" />
            الجهات المحجوبة
          </h1>
          <p className="text-sm text-muted-foreground">
            الحظر مفروض في قاعدة البيانات لا في الشاشة — يشمل الحجز العادي والمريض الحضوري
            وتحويل قائمة انتظار المواعيد.
          </p>
        </div>
        {can("blocked_contacts.manage") && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            إضافة حظر
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>السجلات</CardTitle>
            <CardDescription>
              لا يُحذف سجل الحظر عند رفعه — يبقى بمن رفعه ووقته وسببه، لأن «لماذا مُنع هذا
              المريض؟» سؤال يُطرح بعد أشهر.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 max-w-xs"
              placeholder={patientSearchPlaceholder(searchScopes)}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <PatientSearchScopeChips scopes={searchScopes} onScopesChange={setSearchScopes} />
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_types">كل الأنواع</SelectItem>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.isLoading && <Skeleton className="h-40 w-full" />}
          {!rows.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>المدّة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {row.patient_name ?? row.full_name ?? "بلا اسم"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {[row.patient_file_number && `ملف ${row.patient_file_number}`, row.mobile_number, row.id_number]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.block_type === "messaging" ? "secondary" : "destructive"}>
                        {TYPE_LABELS[row.block_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate text-sm">{row.reason ?? "—"}</div>
                      {row.notes && (
                        <div className="truncate text-xs text-muted-foreground">{row.notes}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>من {new Date(row.starts_at).toLocaleDateString("ar-SA")}</div>
                      <div>{row.ends_at ? `إلى ${new Date(row.ends_at).toLocaleDateString("ar-SA")}` : "دائم"}</div>
                    </TableCell>
                    <TableCell>
                      {row.is_in_effect ? (
                        <Badge variant="destructive">ساري</Badge>
                      ) : isScheduled(row) ? (
                        <Badge variant="warning">
                          يبدأ {new Date(row.starts_at).toLocaleDateString("ar-SA")}
                        </Badge>
                      ) : row.is_active ? (
                        <Badge variant="outline">منتهٍ</Badge>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="success">مرفوع</Badge>
                          {row.lift_reason && (
                            <span className="text-[10px] text-muted-foreground">{row.lift_reason}</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {row.patient_id && (
                          <Button size="sm" variant="ghost" asChild title="فتح ملف المريض">
                            <Link to={`/patients/${row.patient_id}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                        {row.is_active && can("blocked_contacts.manage") && (
                          <Button size="sm" variant="outline" onClick={() => setLiftTarget(row)}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            رفع
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      لا سجلات مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          حظر <strong>الرسائل</strong> لا يمنع الحجز، وحظر <strong>الحجز</strong> لا يمنع الرسائل.
          رسالة إلى محظور تُسجَّل «ملغاة» في سجل الرسائل ولا تُرسَل — ولا تُفشِل تشغيل
          التذكيرات لبقية المرضى.
        </span>
      </div>

      <CreateBlockDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
      <LiftBlockDialog target={liftTarget} onClose={() => setLiftTarget(null)} />
    </div>
  );
}

function CreateBlockDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [mobile, setMobile] = useState("");
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [blockType, setBlockType] = useState<BlockRow["block_type"]>("booking");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [permanent, setPermanent] = useState(true);

  const reset = () => {
    setPatient(null);
    setMobile("");
    setFullName("");
    setIdNumber("");
    setBlockType("booking");
    setReason("");
    setNotes("");
    setStartsAt("");
    setEndsAt("");
    setPermanent(true);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!patient && !mobile.trim()) throw new Error("اختر مريضًا أو أدخل رقم جوال");
      if (!reason.trim()) throw new Error("سبب الحظر مطلوب");
      if (!permanent && !endsAt) throw new Error("حدّد تاريخ نهاية الحظر أو اجعله دائمًا");

      const { error } = await supabase.from("blocked_external_contacts").insert({
        organization_id: organizationId,
        patient_id: patient?.id ?? null,
        mobile_number: mobile.trim() || null,
        full_name: patient ? null : fullName.trim() || null,
        id_number: idNumber.trim() || null,
        block_type: blockType,
        reason: reason.trim(),
        notes: notes.trim() || null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
        ends_at: permanent || !endsAt ? null : new Date(endsAt).toISOString(),
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-contacts"] });
      toast({ title: "تم تسجيل الحظر" });
      reset();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل الحظر",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة حظر</DialogTitle>
          <DialogDescription>
            الحظر يمنع فعليًا من قاعدة البيانات. اختر النوع بدقّة: حظر الرسائل لا يمنع
            المريض من العلاج.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض (إن كان له ملف)</Label>
            {patient ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{patient.name_ar}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <PatientPicker
                onSelect={(selected) => {
                  setPatient({ id: selected.id, name_ar: selected.name_ar });
                  // الجوال يُنسخ من الملف: الحظر يُطابَق بالمريض وبالرقم معًا،
                  // فمن يحجز برقمه من ملف آخر يُمسك أيضًا.
                  if (!mobile.trim() && selected.mobile_number) setMobile(selected.mobile_number);
                }}
              />
            )}
          </div>

          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              أو شخص بلا ملف — يُطابَق بالجوال عند محاولة الحجز.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-normal text-muted-foreground">رقم الجوال</Label>
                <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="05xxxxxxxx" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-normal text-muted-foreground">الاسم</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={Boolean(patient)} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label className="text-xs font-normal text-muted-foreground">رقم الهوية</Label>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>نوع الحظر *</Label>
            <Select value={blockType} onValueChange={(value) => setBlockType(value as BlockRow["block_type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>يبدأ من</Label>
              <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              <span className="text-[10px] text-muted-foreground">الافتراضي: الآن</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ينتهي في</Label>
              <Input
                type="date"
                value={endsAt}
                disabled={permanent}
                onChange={(e) => setEndsAt(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={permanent}
                  onChange={(e) => setPermanent(e.target.checked)}
                />
                دائم
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ الحظر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiftBlockDialog({ target, onClose }: { target: BlockRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const lift = useMutation({
    mutationFn: async () => {
      if (!target) return;
      if (!reason.trim()) throw new Error("سبب رفع الحظر مطلوب");
      // دالة لا تحديث مباشر: هي التي تفحص الصلاحية وتكتب من رفع الحظر ومتى،
      // وترفض الرفع بلا سبب. تحديثٌ من الواجهة كان يتخطّى ذلك كله.
      const { error } = await supabase.rpc("app_lift_contact_block", {
        p_block_id: target.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-contacts"] });
      toast({ title: "تم رفع الحظر" });
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر رفع الحظر",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>رفع الحظر</DialogTitle>
          <DialogDescription>
            {target?.patient_name ?? target?.full_name ?? target?.mobile_number} —{" "}
            {target ? TYPE_LABELS[target.block_type] : ""}
            <br />
            السجل لا يُحذف: يبقى بسبب الحظر الأصلي وسبب رفعه معًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب رفع الحظر *</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button disabled={lift.isPending || !reason.trim()} onClick={() => lift.mutate()}>
            {lift.isPending ? "جارٍ الرفع..." : "رفع الحظر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
