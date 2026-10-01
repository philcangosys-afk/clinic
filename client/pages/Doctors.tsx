import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope, Pencil, CalendarClock, Network, Trash2, KeyRound } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import DeleteRowsDialog, { useRowSelection } from "@/components/shared/DeleteRowsDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";
import DoctorRelationsDialog from "@/components/doctors/DoctorRelationsDialog";
import { errorMessage } from "@/lib/error-message";
import { usePermissions } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/role-permissions";

/** الحقول التي يقرأها/يكتبها نموذج الطبيب (إنشاء وتعديل). */
export type DoctorFormRow = {
  id: string;
  name_ar: string;
  name_en: string | null;
  job_title: string | null;
  clinic_id: string | null;
  specialty_value_id: string | null;
  gender: string | null;
  nationality_value_id: string | null;
  id_number: string | null;
  mobile_number: string | null;
  email: string | null;
  birth_date: string | null;
  default_appointment_duration_minutes: number | null;
  consultation_fee_renewal_days: number | null;
  free_reviews_count: number | null;
  patient_waiting_minutes: number | null;
  notes: string | null;
  address: string | null;
  specialty_authority: string | null;
  specialty_authority_number: string | null;
  disabled_from_booking: boolean;
  receive_appointment_confirmation_sms: boolean;
  hide_patient_messages: boolean;
  force_session_selection: boolean;
  is_enabled: boolean;
};

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select(
          "id, file_number, name_ar, name_en, job_title, clinic_id, specialty_value_id, gender, nationality_value_id, id_number, mobile_number, email, birth_date, notes, address, specialty_authority, specialty_authority_number, consultation_fee_renewal_days, free_reviews_count, patient_waiting_minutes, is_enabled, disabled_from_booking, receive_appointment_confirmation_sms, hide_patient_messages, force_session_selection, default_appointment_duration_minutes, user_id, clinic:clinics(id, name)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId)
        .order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useClinicsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["clinics-select", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        // العيادة تُكتب في `doctors.clinic_id` بلا قيد يربطها بنفس المنشأة —
        // فبلا هذا الفلتر يمكن إسناد طبيب منشأة إلى عيادة منشأة أخرى.
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/** حسابٌ في المنشأة يُربط ببطاقة طبيب (0198). */
type AccountCandidate = {
  user_id: string;
  display_name: string;
  email: string | null;
  role_key: string;
  custom_role_name: string | null;
  member_kind: string | null;
  linked_doctor_id: string | null;
  linked_doctor_name: string | null;
};

/**
 * حسابات المنشأة النشطة بالبريد والدور والطبيب المربوط — من دالّةٍ في القاعدة
 * لأنّ البريد في `auth.users` لا يقرؤه المتصفّح. تحتاج `users.manage`.
 */
function useAccountCandidates(organizationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["doctor-account-candidates", organizationId],
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_doctor_account_candidates", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data ?? []) as AccountCandidate[];
    },
  });
}

const roleLabelOf = (candidate: AccountCandidate) =>
  candidate.custom_role_name ?? ROLE_LABELS[candidate.role_key] ?? candidate.role_key;

export default function Doctors() {
  const { organization, membership, legacyMode, session } = useOrganizationAccess();
  /**
   * الحذف النهائيّ لصاحب المنشأة ومسؤولها وحدهما — والقاعدة تفرضه (0171)،
   * فإخفاء الزرّ راحةٌ للعين لا حراسة.
   */
  const canPurge =
    legacyMode || ["owner", "organization_admin"].includes(membership?.role_key ?? "");
  const selection = useRowSelection();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DoctorFormRow | null>(null);
  const [relationsTarget, setRelationsTarget] = useState<{
    id: string;
    name_ar: string;
    initialTab?: string;
    /** الطبيب يفتح جدوله هو بصلاحية `doctors.self_edit` (0204) */
    selfEdit?: boolean;
  } | null>(null);
  /** «بياناتي» — الطبيب يعدّل بياناته الشخصية (0204) */
  const [selfTarget, setSelfTarget] = useState<DoctorFormRow | null>(null);
  const [accountTarget, setAccountTarget] = useState<{ id: string; name_ar: string; user_id: string | null } | null>(null);
  const doctors = useDoctors(organization?.id);
  const { can } = usePermissions();
  /**
   * الكتابة لمن يملك `doctors.manage` وحده — والقاعدة تفرضها. كانت الأزرار
   * ظاهرةً لكلّ من يرى الشاشة، فيضغط الطبيب «تعديل» ثمّ يُرفض الحفظ.
   */
  const canManage = legacyMode || can("doctors.manage");
  /** الطبيب المربوط بحسابه يعدّل بياناته الشخصية وجدول عمله (0204). */
  const canSelfEdit = can("doctors.self_edit");
  const myUserId = session?.user.id ?? null;
  const isMine = (doctor: { user_id?: string | null }) => Boolean(myUserId) && doctor.user_id === myUserId;
  /** ربط الحساب يمنح صاحبه هويّة الطبيب في النظام — صلاحية إدارة المستخدمين. */
  const canLinkAccounts = legacyMode || can("users.manage");
  const candidates = useAccountCandidates(organization?.id, canLinkAccounts);
  const accountById = new Map<string, AccountCandidate>((candidates.data ?? []).map((row) => [row.user_id, row] as const));
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { data: affectedRows, error } = await supabase.from("doctors").update({ is_enabled }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctors-list"] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث حالة الطبيب",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      {canPurge && selection.selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <span>
            المحدَّد: <span className="font-semibold tabular-nums">{selection.selected.length}</span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={selection.clear}>
              إلغاء التحديد
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteIds(selection.selected)}>
              <Trash2 className="h-3.5 w-3.5" />
              حذف المحدَّد
            </Button>
          </div>
        </div>
      )}
      <DeleteRowsDialog
        entity="doctors"
        ids={deleteIds}
        names={(doctors.data ?? []).filter((row: any) => deleteIds.includes(row.id)).map((row: any) => row.name_ar)}
        open={deleteIds.length > 0}
        onOpenChange={(next) => !next && setDeleteIds([])}
        onDeleted={selection.clear}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأطباء</h1>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "ملفات الأطباء وإعدادات الحجز الخاصة بكل طبيب"
              : canSelfEdit
                ? "للاطّلاع — وتعدّل في صفّك أنت بياناتك الشخصية وجدول عملك وإجازاتك"
                : "للاطّلاع فقط"}
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            طبيب جديد
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قائمة الأطباء</CardTitle>
        </CardHeader>
        <CardContent>
          {doctors.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!doctors.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  {canPurge && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          (doctors.data ?? []).length > 0 &&
                          (doctors.data ?? []).every((row: any) => selection.isSelected(row.id))
                        }
                        onCheckedChange={() =>
                          selection.toggleAll((doctors.data ?? []).map((row: any) => row.id))
                        }
                        aria-label="تحديد الكل"
                      />
                    </TableHead>
                  )}
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الاسم الإنجليزي</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>مدة الموعد</TableHead>
                  <TableHead>حساب الدخول</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doctors.data ?? []).map((doctor: any) => (
                  <TableRow key={doctor.id}>
                    {canPurge && (
                      <TableCell>
                        <Checkbox
                          checked={selection.isSelected(doctor.id)}
                          onCheckedChange={() => selection.toggle(doctor.id)}
                          aria-label={`تحديد ${doctor.name_ar}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">#{doctor.file_number}</TableCell>
                    <TableCell className="font-medium">
                      د. {doctor.name_ar}
                      {isMine(doctor) && (
                        <Badge variant="secondary" className="ms-2">
                          أنت
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{doctor.name_en ?? "—"}</TableCell>
                    <TableCell>{doctor.clinic?.name ?? "—"}</TableCell>
                    <TableCell>{doctor.job_title ?? "—"}</TableCell>
                    <TableCell>{doctor.mobile_number ?? "—"}</TableCell>
                    <TableCell>{doctor.default_appointment_duration_minutes ?? 30} دقيقة</TableCell>
                    <TableCell className="text-xs">
                      {doctor.user_id ? (
                        <span className="flex flex-col">
                          <span className="font-medium">
                            {accountById.get(doctor.user_id)?.email ?? "مربوط بحساب"}
                          </span>
                          {accountById.get(doctor.user_id) && (
                            <span className="text-muted-foreground">
                              {roleLabelOf(accountById.get(doctor.user_id)!)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <Badge variant="outline">غير مربوط</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={doctor.is_enabled ? "success" : "secondary"}>
                          {doctor.is_enabled ? "مفعّل" : "معطّل"}
                        </Badge>
                        {doctor.disabled_from_booking && <Badge variant="warning">محجوب عن الحجز</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="تعديل"
                            onClick={() => {
                              setEditing(doctor as unknown as DoctorFormRow);
                              setCreateOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          canSelfEdit &&
                          isMine(doctor) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="بياناتي الشخصية"
                              onClick={() => setSelfTarget(doctor as unknown as DoctorFormRow)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                        {canLinkAccounts && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="حساب الدخول"
                            onClick={() =>
                              setAccountTarget({ id: doctor.id, name_ar: doctor.name_ar, user_id: doctor.user_id ?? null })
                            }
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="أوقات الدوام"
                          onClick={() =>
                            setRelationsTarget({
                              id: doctor.id,
                              name_ar: doctor.name_ar,
                              initialTab: "schedule",
                              selfEdit: !canManage && canSelfEdit && isMine(doctor),
                            })
                          }
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="العيادات والخدمات وجدول العمل"
                          onClick={() =>
                            setRelationsTarget({
                              id: doctor.id,
                              name_ar: doctor.name_ar,
                              selfEdit: !canManage && canSelfEdit && isMine(doctor),
                            })
                          }
                        >
                          <Network className="h-3.5 w-3.5" />
                        </Button>
                        {canPurge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="حذف نهائيّ"
                            onClick={() => setDeleteIds([doctor.id])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleEnabled.mutate({ id: doctor.id, is_enabled: !doctor.is_enabled })}
                          >
                            {doctor.is_enabled ? "تعطيل" : "تفعيل"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(doctors.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canPurge ? 11 : 10} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد أطباء مسجّلون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <NewDoctorDialog
          key={editing?.id ?? "new"}
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) setEditing(null);
          }}
          organizationId={organization?.id}
          initial={editing}
        />
      )}

      <DoctorAccountDialog
        target={accountTarget}
        candidates={candidates.data ?? []}
        loading={candidates.isLoading}
        loadError={candidates.isError ? errorMessage(candidates.error) : null}
        onOpenChange={(next) => {
          if (!next) setAccountTarget(null);
        }}
      />

      <DoctorRelationsDialog
        key={`${relationsTarget?.id ?? "closed"}-${relationsTarget?.initialTab ?? "places"}`}
        doctor={relationsTarget}
        initialTab={relationsTarget?.initialTab}
        selfEdit={Boolean(relationsTarget?.selfEdit)}
        onClose={() => setRelationsTarget(null)}
      />

      {selfTarget && (
        <MyDoctorProfileDialog
          key={selfTarget.id}
          organizationId={organization?.id}
          doctor={selfTarget}
          onClose={() => setSelfTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * «بياناتي» — الطبيب يعدّل بياناته الشخصية بنفسه (0204).
 *
 * عبر `app_update_my_doctor_profile`: الحقول الشخصية وحدها، ولصفّه هو وحده،
 * وبصلاحية `doctors.self_edit`. الاسم العربيّ والعيادة والحالة والحجز
 * والترخيص للمدير — تظهر هنا للاطّلاع ولا تُعدَّل.
 */
function MyDoctorProfileDialog({
  organizationId,
  doctor,
  onClose,
}: {
  organizationId: string | undefined;
  doctor: DoctorFormRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameEn, setNameEn] = useState(doctor.name_en ?? "");
  const [mobile, setMobile] = useState(doctor.mobile_number ?? "");
  const [email, setEmail] = useState(doctor.email ?? "");
  const [address, setAddress] = useState(doctor.address ?? "");
  const [birthDate, setBirthDate] = useState(doctor.birth_date ?? "");
  const [gender, setGender] = useState<"male" | "female" | "">((doctor.gender as "male" | "female") ?? "");
  const [nationalityId, setNationalityId] = useState(doctor.nationality_value_id ?? "");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا منشأة نشطة");
      const { error } = await supabase.rpc("app_update_my_doctor_profile", {
        p_organization_id: organizationId,
        p_payload: {
          name_en: nameEn.trim(),
          mobile_number: mobile.trim(),
          email: email.trim(),
          address: address.trim(),
          birth_date: birthDate || "",
          gender: gender || "",
          nationality_value_id: nationalityId || "",
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      toast({ title: "حُفظت بياناتك" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>بياناتي — د. {doctor.name_ar}</DialogTitle>
          <DialogDescription>
            بياناتك الشخصية. الاسم العربيّ والعيادة والترخيص وإعدادات الحجز يعدّلها المدير.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكترونيّ</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الميلاد</Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنس</Label>
            <Select value={gender} onValueChange={(value) => setGender(value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنسية</Label>
            <LookupSelect
              categoryKey="nationalities"
              centered
              title="الجنسية"
              allowClear
              value={nationalityId}
              onChange={setNationalityId}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NO_ACCOUNT = "__none__";

/**
 * «حساب الدخول» — يربط حسابًا بالطبيب فيعرف النظام «أيّ طبيبٍ أنت»: تُحصَر
 * شاشاته على مرضاه ومواعيده، وتعمل «يومي» و«زيارات لم تُغلق». الربط والفكّ
 * بـ`app_set_doctor_user` (0198): صلاحية، وعضويّة نشطة، وحسابٌ لطبيبٍ واحد،
 * وسطر تدقيق.
 */
function DoctorAccountDialog({
  target,
  candidates,
  loading,
  loadError,
  onOpenChange,
}: {
  target: { id: string; name_ar: string; user_id: string | null } | null;
  candidates: AccountCandidate[];
  loading: boolean;
  loadError: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userId, setUserId] = useState(NO_ACCOUNT);
  const [lastTarget, setLastTarget] = useState<string | null>(null);
  if (target && target.id !== lastTarget) {
    setLastTarget(target.id);
    setUserId(target.user_id ?? NO_ACCOUNT);
  }

  const picked = candidates.find((row) => row.user_id === userId) ?? null;
  const changed = Boolean(target) && (target?.user_id ?? NO_ACCOUNT) !== userId;

  const save = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("لا طبيب محدَّد");
      const { error } = await supabase.rpc("app_set_doctor_user", {
        p_doctor_id: target.id,
        p_user_id: userId === NO_ACCOUNT ? null : userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-account-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["session-doctor-id"] });
      toast({
        title: userId === NO_ACCOUNT ? `فُكّ حساب الدخول عن د. ${target?.name_ar}` : `رُبط الحساب بـ د. ${target?.name_ar}`,
        description: userId === NO_ACCOUNT ? undefined : "يسري عند دخول الطبيب التالي أو تحديث صفحته.",
      });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الربط", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>حساب الدخول — د. {target?.name_ar}</DialogTitle>
          <DialogDescription>
            الحساب الذي يدخل به الطبيب. بعد الربط يرى الطبيب مرضاه ومواعيده هو، وتعمل «يومي» و«زيارات لم تُغلق»
            في مساحة الطبيب. الحساب نفسه يُنشأ أوّلًا من «الموظفين» (زرّ المفتاح) أو «المستخدمين».
          </DialogDescription>
        </DialogHeader>
        {loading && <Skeleton className="h-10 w-full" />}
        {loadError && <p className="text-sm text-destructive">تعذّرت قراءة الحسابات: {loadError}</p>}
        {!loading && !loadError && (
          <div className="flex flex-col gap-2">
            <Label>الحساب</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>بدون حساب (غير مربوط)</SelectItem>
                {candidates.map((row) => {
                  const takenByOther = Boolean(row.linked_doctor_id && row.linked_doctor_id !== target?.id);
                  return (
                    <SelectItem key={row.user_id} value={row.user_id} disabled={takenByOther}>
                      {row.display_name}
                      {row.email ? ` · ${row.email}` : ""} · {roleLabelOf(row)}
                      {takenByOther ? ` — مربوط بـ د. ${row.linked_doctor_name}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">لا حسابات نشطة في المنشأة بعد — أنشئ حساب الطبيب من «الموظفين».</p>
            )}
            {picked && picked.role_key !== "doctor" && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                دور هذا الحساب «{roleLabelOf(picked)}». حصر الشاشات على مرضى الطبيب يعمل حين تكون صفة الحساب
                «طبيب» — غيّر دوره من «المستخدمين» إن كان حساب الطبيب نفسه.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button disabled={!changed || save.isPending || loading || Boolean(loadError)} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : userId === NO_ACCOUNT ? "فكّ الربط" : "ربط الحساب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDoctorDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** عند تمريره تتحول النافذة لوضع التعديل بدل الإنشاء. */
  initial?: DoctorFormRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const clinics = useClinicsList(organizationId);
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.job_title ?? "");
  const [clinicId, setClinicId] = useState(initial?.clinic_id ?? "");
  const [specialtyId, setSpecialtyId] = useState(initial?.specialty_value_id ?? "");
  const [gender, setGender] = useState<"male" | "female" | "">((initial?.gender as "male" | "female") ?? "");
  const [nationalityId, setNationalityId] = useState(initial?.nationality_value_id ?? "");
  const [idNumber, setIdNumber] = useState(initial?.id_number ?? "");
  const [mobile, setMobile] = useState(initial?.mobile_number ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birth_date ?? "");
  const [duration, setDuration] = useState(String(initial?.default_appointment_duration_minutes ?? 30));
  const [renewalDays, setRenewalDays] = useState(
    initial?.consultation_fee_renewal_days != null ? String(initial.consultation_fee_renewal_days) : "",
  );
  const [freeReviews, setFreeReviews] = useState(String(initial?.free_reviews_count ?? 0));
  const [waitingMinutes, setWaitingMinutes] = useState(
    initial?.patient_waiting_minutes != null ? String(initial.patient_waiting_minutes) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // حقول كانت في جدول doctors منذ 0002 بلا إدخال في الواجهة (لقطة 4)
  const [address, setAddress] = useState(initial?.address ?? "");
  const [authority, setAuthority] = useState(initial?.specialty_authority ?? "");
  const [authorityNumber, setAuthorityNumber] = useState(initial?.specialty_authority_number ?? "");
  const [disabledFromBooking, setDisabledFromBooking] = useState(Boolean(initial?.disabled_from_booking));
  /**
   * حُذف مفتاح «يستلم رسالة تأكيد المواعيد» (`receive_appointment_confirmation_sms`)
   * من النموذج: لا يقرؤه شيء في القاعدة ولا في العميل، وقناة الرسائل النصّية
   * غير مفعّلة بقرار المالك — فمفتاحٌ يوعد بوصول رسالة إلى جوّال الطبيب وعدٌ
   * لا سبيل إلى الوفاء به. العمود باقٍ في القاعدة بقيمه السابقة.
   */
  const [hidePatientMessages, setHidePatientMessages] = useState(Boolean(initial?.hide_patient_messages));
  const [forceSessionSelection, setForceSessionSelection] = useState(
    Boolean(initial?.force_session_selection),
  );

  const resetForm = () => {
    setNameAr("");
    setNameEn("");
    setJobTitle("");
    setClinicId("");
    setSpecialtyId("");
    setGender("");
    setNationalityId("");
    setIdNumber("");
    setMobile("");
    setEmail("");
    setBirthDate("");
    setDuration("30");
    setRenewalDays("");
    setFreeReviews("0");
    setWaitingMinutes("");
    setNotes("");
    setAddress("");
    setAuthority("");
    setAuthorityNumber("");
    setDisabledFromBooking(false);
    setHidePatientMessages(false);
    setForceSessionSelection(false);
  };

  const createDoctor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const payload = {
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        job_title: jobTitle.trim() || null,
        clinic_id: clinicId || null,
        specialty_value_id: specialtyId || null,
        gender: gender || null,
        nationality_value_id: nationalityId || null,
        id_number: idNumber.trim() || null,
        mobile_number: mobile.trim() || null,
        email: email.trim() || null,
        birth_date: birthDate || null,
        default_appointment_duration_minutes: Number(duration) || 30,
        consultation_fee_renewal_days: renewalDays ? Number(renewalDays) : null,
        free_reviews_count: Number(freeReviews) || 0,
        patient_waiting_minutes: waitingMinutes ? Number(waitingMinutes) : null,
        notes: notes.trim() || null,
        address: address.trim() || null,
        specialty_authority: authority.trim() || null,
        specialty_authority_number: authorityNumber.trim() || null,
        disabled_from_booking: disabledFromBooking,
        hide_patient_messages: hidePatientMessages,
        force_session_selection: forceSessionSelection,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase
          .from("doctors")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("doctors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] });
      toast({ title: initial ? "تم تحديث ملف الطبيب" : "تم حفظ ملف الطبيب" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الطبيب",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* العنوان كان ثابتًا «طبيب جديد» حتى عند التعديل، فيظنّ المستخدم أنه
              يُنشئ سجلًّا ثانيًا للطبيب نفسه. المكوّن يعرف حالته من `initial`. */}
          <DialogTitle>{initial ? `تعديل: د. ${initial.name_ar}` : "طبيب جديد"}</DialogTitle>
          <DialogDescription>التخصص يحدّد قالب الفحص الافتراضي في السجل الطبي</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>اسم الطبيب بالعربية *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم الطبيب بالإنجليزية</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="استشاري، أخصائي..." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر عيادة" />
              </SelectTrigger>
              <SelectContent>
                {(clinics.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect categoryKey="medical_specialties" value={specialtyId} onChange={setSpecialtyId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنس</Label>
            <Select value={gender} onValueChange={(value) => setGender(value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنسية</Label>
            <LookupSelect categoryKey="nationalities" centered title="الجنسية" allowClear value={nationalityId} onChange={setNationalityId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهوية/الإقامة</Label>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الميلاد</Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مدة الموعد الافتراضية (دقيقة)</Label>
            <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الهيئة المانحة للتخصص</Label>
            <Input value={authority} onChange={(e) => setAuthority(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم التصنيف بالهيئة</Label>
            <Input value={authorityNumber} onChange={(e) => setAuthorityNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:col-span-2">
            <p className="text-sm font-semibold">إعدادات الحجز</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={disabledFromBooking}
                onChange={(e) => setDisabledFromBooking(e.target.checked)}
                className="h-4 w-4"
              />
              محجوب عن الحجز (لا تظهر له مواعيد جديدة)
            </label>
            <p className="text-xs text-muted-foreground">
              هذا المفتاح مُطبَّق فعلًا: يفحصه النظام قبل قبول أي موعد جديد.
            </p>
          </div>

          {/*
            هذه الحقول تُحفظ في `doctors` ولا يقرؤها شيء بعد — لا دالّة ولا
            مُحفِّز ولا شاشة. إبقاؤها بين إعدادات الحجز كان يجعلها تبدو نافذة،
            وأخطرها «حجب المرضى عن رسائل المواعيد» لأنه وعدُ خصوصية يبني عليه
            المستخدم قراره. فصارت معلَنة صراحةً حتى تُوصَل في القاعدة (فحص الحجب
            في مُحفِّز تذكير الموعد، وفحص الجلسة في نافذة الحجز، وسلسلة احتساب
            الكشفية عند الفوترة).
          */}
          <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 sm:col-span-2">
            <p className="text-sm font-semibold">حقول تُحفظ ولا تُطبَّق بعد</p>
            <p className="text-xs">
              تُسجَّل في ملفّ الطبيب لكن لا شيء في النظام يقرؤها اليوم — لا تبنِ عليها قرارًا
              تشغيليًّا ولا قرار خصوصية.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hidePatientMessages}
                onChange={(e) => setHidePatientMessages(e.target.checked)}
                className="h-4 w-4"
              />
              حجب المرضى عن رسائل المواعيد (غير مُنفَّذ: التذكيرات لا تفحصه)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forceSessionSelection}
                onChange={(e) => setForceSessionSelection(e.target.checked)}
                className="h-4 w-4"
              />
              فرض اختيار جلسة عند الحجز (غير مُنفَّذ: نافذة الحجز لا تفحصه)
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">مدة انتظار المريض (دقيقة)</Label>
                <Input type="number" min={0} value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">أيام تجديد الكشفية</Label>
                <Input type="number" min={1} value={renewalDays} onChange={(e) => setRenewalDays(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">عدد المراجعات المجانية</Label>
                <Input type="number" min={0} value={freeReviews} onChange={(e) => setFreeReviews(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!nameAr.trim() || createDoctor.isPending} onClick={() => createDoctor.mutate()}>
            <Stethoscope className="h-4 w-4" />
            {createDoctor.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
