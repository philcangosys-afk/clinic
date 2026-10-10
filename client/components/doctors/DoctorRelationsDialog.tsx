import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import ItemPicker from "@/components/shared/ItemPicker";
import { errorMessage } from "@/lib/error-message";

/**
 * علاقات الطبيب وجداوله — المرحلة الثانية.
 *
 * قبل 0081 كان للطبيب `clinic_id` **واحد**. طبيبٌ يعمل في عيادتين لا يمكن
 * تمثيله إطلاقًا: يُسجَّل مرتين بملفّين، فتنقسم مواعيده وإحصاءاته بين سجلّين
 * لا يعرف النظام أنهما شخص واحد.
 */

const DAYS: { value: number; label: string }[] = [
  { value: 7, label: "الأحد" },
  { value: 1, label: "الاثنين" },
  { value: 2, label: "الثلاثاء" },
  { value: 3, label: "الأربعاء" },
  { value: 4, label: "الخميس" },
  { value: 5, label: "الجمعة" },
  { value: 6, label: "السبت" },
];

const DAY_LABEL: Record<number, string> = Object.fromEntries(
  DAYS.map((day) => [day.value, day.label]),
) as Record<number, string>;

const EXCEPTION_TYPES: Record<string, string> = {
  leave: "إجازة",
  vacation: "إجازة سنوية",
  training: "تدريب",
  blocked_time: "وقت محجوب",
  emergency: "طارئ",
  custom_hours: "دوام استثنائي",
};

const NONE = "__none__";

export default function DoctorRelationsDialog({
  doctor,
  initialTab = "places",
  selfEdit = false,
  onClose,
}: {
  doctor: { id: string; name_ar: string } | null;
  initialTab?: string;
  /**
   * الطبيب يفتح سجلّه هو بصلاحية `doctors.self_edit` (0204): يكتب جدول عمله
   * وإجازاته واستثناءاته، ويطّلع على الباقي. والقاعدة تفرض ذلك بسياستين لا
   * تفتحان إلّا صفوف الطبيب المربوط بالحساب الداخل.
   */
  selfEdit?: boolean;
  onClose: () => void;
}) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const organizationId = organization?.id;
  const canManage = can("doctors.manage");
  const canEditSchedule = canManage || selfEdit;
  const [tab, setTab] = useState(initialTab);

  return (
    <Dialog open={Boolean(doctor)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{doctor?.name_ar}</DialogTitle>
          <DialogDescription>
            الفروع والعيادات والخدمات وجدول العمل. الحجز يفلتر بهذه العلاقات، والقاعدة تفرضها.
          </DialogDescription>
        </DialogHeader>

        {!canManage && (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {selfEdit
              ? "تعدّل هنا جدول عملك وإجازاتك واستثناءاتك. الفروع والعيادات والخدمات والتراخيص يعدّلها المدير."
              : "صلاحيتك تسمح بالاطّلاع فقط."}
          </p>
        )}

        {doctor && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="places">الفروع والعيادات</TabsTrigger>
              <TabsTrigger value="services">الخدمات</TabsTrigger>
              <TabsTrigger value="schedule">جدول العمل</TabsTrigger>
              <TabsTrigger value="exceptions">الإجازات والاستثناءات</TabsTrigger>
              <TabsTrigger value="license">التراخيص</TabsTrigger>
            </TabsList>

            <TabsContent value="places" className="pt-3">
              <PlacesTab doctorId={doctor.id} organizationId={organizationId} canManage={canManage} />
            </TabsContent>
            <TabsContent value="services" className="pt-3">
              <ServicesTab doctorId={doctor.id} organizationId={organizationId} canManage={canManage} />
            </TabsContent>
            <TabsContent value="schedule" className="pt-3">
              <ScheduleTab doctorId={doctor.id} organizationId={organizationId} canManage={canEditSchedule} />
            </TabsContent>
            <TabsContent value="exceptions" className="pt-3">
              <ExceptionsTab doctorId={doctor.id} organizationId={organizationId} canManage={canEditSchedule} />
            </TabsContent>
            <TabsContent value="license" className="pt-3">
              <LicenseTab doctorId={doctor.id} canManage={canManage} />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useBranches(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctor-rel-branches", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctor-rel-clinics", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_clinic_summary")
        .select("id, name_ar, branch_id, branch_name, is_disabled")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ---------------------------------------------------------------------------
function PlacesTab({
  doctorId,
  organizationId,
  canManage,
}: {
  doctorId: string;
  organizationId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const branches = useBranches(organizationId);
  const clinics = useClinics(organizationId);

  const rows = useQuery({
    queryKey: ["doctor-places", doctorId],
    queryFn: async () => {
      const [b, c] = await Promise.all([
        supabase
          .from("doctor_branches")
          .select("id, branch_id, is_primary, is_active")
          .eq("doctor_id", doctorId),
        supabase
          .from("doctor_clinics")
          .select("id, clinic_id, branch_id, is_primary, is_active")
          .eq("doctor_id", doctorId),
      ]);
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      return { branches: b.data ?? [], clinics: c.data ?? [] };
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["doctor-places", doctorId] });
    queryClient.invalidateQueries({ queryKey: ["clinics-summary"] });
  };

  const fail = (error: unknown, title: string) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const toggleClinic = useMutation({
    mutationFn: async ({ clinicId, on }: { clinicId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("doctor_clinics").insert({
          organization_id: organizationId,
          doctor_id: doctorId,
          clinic_id: clinicId,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("doctor_clinics")
          .delete()
          .eq("doctor_id", doctorId)
          .eq("clinic_id", clinicId)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
      }
    },
    onSuccess: invalidate,
    onError: (error) => fail(error, "تعذّر التعديل"),
  });

  const setPrimaryClinic = useMutation({
    mutationFn: async (clinicId: string) => {
      // الرئيسية واحدة: تُلغى القديمة أولًا، وفهرسٌ فريد يمنع اثنتين على كل حال.
      const cleared = await supabase
        .from("doctor_clinics")
        .update({ is_primary: false })
        .eq("doctor_id", doctorId)
        .eq("is_primary", true)
        .select("id");
      if (cleared.error) throw cleared.error;
      const { data, error } = await supabase
        .from("doctor_clinics")
        .update({ is_primary: true })
        .eq("doctor_id", doctorId)
        .eq("clinic_id", clinicId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحدَّث شيء — تحقّق من صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error) => fail(error, "تعذّر التعيين"),
  });

  const toggleBranch = useMutation({
    mutationFn: async ({ branchId, on }: { branchId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("doctor_branches").insert({
          organization_id: organizationId,
          doctor_id: doctorId,
          branch_id: branchId,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("doctor_branches")
          .delete()
          .eq("doctor_id", doctorId)
          .eq("branch_id", branchId)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
      }
    },
    onSuccess: invalidate,
    onError: (error) => fail(error, "تعذّر التعديل"),
  });

  const clinicIds = new Set((rows.data?.clinics ?? []).map((row: any) => row.clinic_id));
  const branchIds = new Set((rows.data?.branches ?? []).map((row: any) => row.branch_id));
  const primaryClinic = (rows.data?.clinics ?? []).find((row: any) => row.is_primary)?.clinic_id;

  if (rows.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label>الفروع</Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          لا تختر شيئًا ليكون الطبيب متاحًا في كل الفروع — بما فيها فروعٌ تُفتح لاحقًا.
        </p>
        <div className="flex flex-col gap-2">
          {(branches.data ?? []).map((branch) => (
            <label key={branch.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canManage || toggleBranch.isPending}
                checked={branchIds.has(branch.id)}
                onChange={(e) => toggleBranch.mutate({ branchId: branch.id, on: e.target.checked })}
              />
              {branch.name}
            </label>
          ))}
          {(branches.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">لا توجد فروع مسجّلة.</p>
          )}
        </div>
      </div>

      <Separator />

      <div>
        <Label>العيادات</Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          الطبيب غير المرتبط بعيادة <strong>لا يمكن حجزه فيها</strong> — القاعدة ترفض الموعد، لا
          الشاشة وحدها.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>العيادة</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>رئيسية</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(clinics.data ?? []).map((clinic) => (
              <TableRow key={clinic.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    disabled={!canManage || toggleClinic.isPending}
                    checked={clinicIds.has(clinic.id)}
                    onChange={(e) => toggleClinic.mutate({ clinicId: clinic.id, on: e.target.checked })}
                  />
                </TableCell>
                <TableCell>{clinic.name_ar}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {clinic.branch_name ?? "—"}
                </TableCell>
                <TableCell>
                  {clinicIds.has(clinic.id) &&
                    (primaryClinic === clinic.id ? (
                      <Badge>رئيسية</Badge>
                    ) : (
                      canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPrimaryClinic.mutate(clinic.id)}
                        >
                          تعيين رئيسية
                        </Button>
                      )
                    ))}
                </TableCell>
              </TableRow>
            ))}
            {(clinics.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد عيادات نشطة.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ServicesTab({
  doctorId,
  organizationId,
  canManage,
}: {
  doctorId: string;
  organizationId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const branches = useBranches(organizationId);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [duration, setDuration] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [branchId, setBranchId] = useState("");

  const rows = useQuery({
    queryKey: ["doctor-services", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_services")
        .select(
          "id, item_id, branch_id, duration_minutes, price_override, is_active, item:items!doctor_services_item_id_fkey(name_ar, price), branch:branches!doctor_services_branch_id_fkey(name)",
        )
        .eq("doctor_id", doctorId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("اختر الخدمة");
      const { error } = await supabase.from("doctor_services").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        item_id: picked.id,
        branch_id: branchId || null,
        duration_minutes: duration.trim() ? Number(duration) : null,
        price_override: priceOverride.trim() ? Number(priceOverride) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-services", doctorId] });
      setPicked(null);
      setDuration("");
      setPriceOverride("");
      toast({ title: "أُضيفت الخدمة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّرت الإضافة",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("doctor_services").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-services", doctorId] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const one = (value: any) => (Array.isArray(value) ? value[0] : value);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        تحديد خدمات الطبيب <strong>يقصر</strong> ما يظهر عند الحجز عليها. طبيبٌ بلا خدمات محدَّدة
        تظهر له خدمات عيادته كلها — كي لا يتعطّل الحجز لمن لم تُسجَّل خدماته بعد.
      </p>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="min-w-52 flex-1">
            <div className="flex flex-col gap-1.5">
              <Label>الخدمة</Label>
              {picked ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  {picked.name}
                  <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setPicked(null)}>
                    تغيير
                  </Button>
                </div>
              ) : (
                <ItemPicker onSelect={(item: any) => setPicked({ id: item.id, name: item.name_ar })} />
              )}
            </div>
          </div>
          <div className="w-28">
            <div className="flex flex-col gap-1.5">
              <Label>المدة (د)</Label>
              <Input
                type="number"
                min={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>
          <div className="w-28">
            <div className="flex flex-col gap-1.5">
              <Label>سعر خاص</Label>
              <Input
                type="number"
                min={0}
                value={priceOverride}
                onChange={(e) => setPriceOverride(e.target.value)}
              />
            </div>
          </div>
          <div className="w-40">
            <div className="flex flex-col gap-1.5">
              <Label>الفرع</Label>
              <Select value={branchId || NONE} onValueChange={(v) => setBranchId(v === NONE ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>كل الفروع</SelectItem>
                  {(branches.data ?? []).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button disabled={!picked || add.isPending} onClick={() => add.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
      )}

      {rows.isLoading && <Skeleton className="h-24 w-full" />}
      {!rows.isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>المدة</TableHead>
              <TableHead>السعر</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).map((row) => {
              const item = one(row.item);
              const branch = one(row.branch);
              return (
                <TableRow key={row.id}>
                  <TableCell>{item?.name_ar ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {branch?.name ?? "كل الفروع"}
                  </TableCell>
                  <TableCell>{row.duration_minutes ? `${row.duration_minutes} د` : "افتراضي"}</TableCell>
                  <TableCell>
                    {row.price_override !== null
                      ? `${Number(row.price_override).toLocaleString("ar-SA-u-nu-latn")} (خاص)`
                      : item
                        ? Number(item.price).toLocaleString("ar-SA-u-nu-latn")
                        : "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {(rows.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا خدمات محدَّدة — تظهر خدمات العيادة كلها عند الحجز.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
type ScheduleRow = {
  id: string;
  clinic_id: string | null;
  recurrence_type: "weekly" | "alternate_days" | "monthly";
  pattern_anchor_date: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  clinic: { name: string } | { name: string }[] | null;
};

const RECURRENCE_LABEL: Record<string, string> = {
  weekly: "أسبوعي",
  monthly: "شهري",
  alternate_days: "يوم عمل / يوم إجازة",
};

const hhmm = (value: string) => String(value).slice(0, 5);

/** وصف يوم الفترة: «الأحد» / «يوم 15 من كلّ شهر» / «يوم ويوم من 2026-10-05». */
function scheduleDayLabel(row: Pick<ScheduleRow, "recurrence_type" | "day_of_week" | "day_of_month" | "pattern_anchor_date">) {
  if (row.recurrence_type === "monthly") return `يوم ${row.day_of_month} من كلّ شهر`;
  if (row.recurrence_type === "alternate_days") return `يوم ويوم من ${row.pattern_anchor_date}`;
  return DAY_LABEL[row.day_of_week ?? 0] ?? String(row.day_of_week);
}

/**
 * الفترات القائمة التي ستتغيّر بحفظ فترةٍ جديدة — القاعدة نفسها التي في
 * مُحفِّز 0231: النمط نفسه واليوم نفسه والعيادة نفسها، وتقاطع السريان والوقت.
 */
function schedulesReplacedBy(
  existing: ScheduleRow[],
  draft: {
    recurrence_type: string;
    day_of_week: number | null;
    day_of_month: number | null;
    pattern_anchor_date: string | null;
    clinic_id: string | null;
    start_time: string;
    end_time: string;
    effective_from: string;
    effective_to: string | null;
  },
  ignoreId?: string,
) {
  const far = "9999-12-31";
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
  return existing.filter((row) => {
    if (!row.is_active || row.id === ignoreId) return false;
    if (row.recurrence_type !== draft.recurrence_type) return false;
    if (draft.recurrence_type === "weekly" && row.day_of_week !== draft.day_of_week) return false;
    if (draft.recurrence_type === "monthly" && row.day_of_month !== draft.day_of_month) return false;
    if (
      draft.recurrence_type === "alternate_days" &&
      (!row.pattern_anchor_date || !draft.pattern_anchor_date ||
        Math.abs(dayDiff(row.pattern_anchor_date, draft.pattern_anchor_date)) % 2 !== 0)
    )
      return false;
    if ((row.clinic_id ?? "") !== (draft.clinic_id ?? "")) return false;
    const datesOverlap =
      row.effective_from <= (draft.effective_to || far) && draft.effective_from <= (row.effective_to || far);
    const timesOverlap = hhmm(row.start_time) < draft.end_time && draft.start_time < hhmm(row.end_time);
    return datesOverlap && timesOverlap;
  });
}

const todayKey = () => new Date().toLocaleDateString("en-CA");

function ScheduleTab({
  doctorId,
  organizationId,
  canManage,
}: {
  doctorId: string;
  organizationId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const clinics = useClinics(organizationId);
  const [form, setForm] = useState<any>({
    recurrence_type: "weekly",
    pattern_anchor_date: todayKey(),
    start_time: "08:00",
    end_time: "14:00",
    slot_duration_minutes: 15,
    capacity: 1,
    effective_from: todayKey(),
  });
  // أيّامٌ عدّة في إضافةٍ واحدة: فترةٌ لكلّ يومٍ مختار
  const [weekDays, setWeekDays] = useState<number[]>([7]);
  const [monthDays, setMonthDays] = useState<number[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);

  const rows = useQuery({
    queryKey: ["doctor-schedules", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_schedules")
        .select(
          "id, clinic_id, recurrence_type, pattern_anchor_date, day_of_week, day_of_month, start_time, end_time, slot_duration_minutes, capacity, effective_from, effective_to, is_active, clinic:clinics!doctor_schedules_clinic_id_fkey(name)",
        )
        .eq("doctor_id", doctorId)
        .order("effective_from");
      if (error) throw error;
      return (data ?? []) as unknown as ScheduleRow[];
    },
  });

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));
  const toggle = (list: number[], value: number) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);

  /** الفترات الجديدة كما ستُكتب — واحدة لكلّ يوم مختار. */
  const drafts = useMemo(() => {
    const base = {
      clinic_id: form.clinic_id || null,
      start_time: form.start_time,
      end_time: form.end_time,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
    };
    if (form.recurrence_type === "weekly")
      return weekDays.map((d) => ({ ...base, recurrence_type: "weekly", day_of_week: d, day_of_month: null, pattern_anchor_date: null }));
    if (form.recurrence_type === "monthly")
      return monthDays.map((d) => ({ ...base, recurrence_type: "monthly", day_of_week: null, day_of_month: d, pattern_anchor_date: null }));
    return [{ ...base, recurrence_type: "alternate_days", day_of_week: null, day_of_month: null, pattern_anchor_date: form.pattern_anchor_date }];
  }, [form, weekDays, monthDays]);

  const replaced = useMemo(() => {
    const ids = new Set<string>();
    const list: ScheduleRow[] = [];
    for (const draft of drafts) {
      for (const row of schedulesReplacedBy(rows.data ?? [], draft)) {
        if (!ids.has(row.id)) {
          ids.add(row.id);
          list.push(row);
        }
      }
    }
    return list;
  }, [drafts, rows.data]);

  const problem =
    drafts.length === 0
      ? form.recurrence_type === "monthly"
        ? "اختر يومًا واحدًا على الأقل من أيّام الشهر"
        : "اختر يومًا واحدًا على الأقل"
      : !form.start_time || !form.end_time || form.end_time <= form.start_time
        ? "وقت «إلى» يجب أن يكون بعد «من»"
        : !form.effective_from
          ? "اختر تاريخ السريان"
          : form.effective_to && form.effective_to < form.effective_from
            ? "تاريخ «حتى» قبل «يسري من»"
            : null;

  const add = useMutation({
    mutationFn: async () => {
      if (problem) throw new Error(problem);
      const { error } = await supabase.from("doctor_schedules").insert(
        drafts.map((draft) => ({
          organization_id: organizationId,
          doctor_id: doctorId,
          ...draft,
          slot_duration_minutes: Number(form.slot_duration_minutes) || 15,
          capacity: Number(form.capacity) || 1,
        })),
      );
      if (error) throw error;
      return { count: drafts.length, replaced: replaced.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["doctor-schedules", doctorId] });
      queryClient.invalidateQueries({ queryKey: ["calendar-availability"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-schedule-bounds"] });
      toast({
        title: result.count > 1 ? `أُضيفت ${result.count} فترات دوام` : "أُضيفت فترة الدوام",
        description: result.replaced > 0 ? `وحلّت محلّ ${result.replaced} فترة سابقة من تاريخ سريانها.` : undefined,
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّرت الإضافة",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("doctor_schedules").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-schedules", doctorId] });
      queryClient.invalidateQueries({ queryKey: ["calendar-availability"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-schedule-bounds"] });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const one = (value: any) => (Array.isArray(value) ? value[0] : value);
  const visibleRows = (rows.data ?? [])
    .filter((row) => showInactive || row.is_active)
    .sort((a, b) => {
      const order = (r: ScheduleRow) =>
        r.recurrence_type === "weekly" ? DAYS.findIndex((d) => d.value === r.day_of_week) : r.recurrence_type === "monthly" ? 10 + (r.day_of_month ?? 0) : 50;
      return order(a) - order(b) || hhmm(a.start_time).localeCompare(hhmm(b.start_time)) || a.effective_from.localeCompare(b.effective_from);
    });
  const inactiveCount = (rows.data ?? []).filter((row) => !row.is_active).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        دوامٌ أسبوعيّ لأيّامٍ محدّدة، أو شهريّ لأيّامٍ من الشهر، أو يوم عمل ويوم إجازة. الفترة الجديدة التي تتداخل مع
        فترةٍ قائمة <strong>تحلّ محلّها من تاريخ سريانها</strong> — لا حاجة لحذف القديمة. والإجازات والدوام الاستثنائي
        من تبويب الاستثناءات.
      </p>

      {canManage && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>نمط الدوام</Label>
              <div className="flex rounded-md border p-0.5 text-xs">
                {(["weekly", "monthly", "alternate_days"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set("recurrence_type", key)}
                    className={`rounded px-3 py-1.5 ${form.recurrence_type === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {key === "weekly" ? "أسبوعي" : key === "monthly" ? "شهري" : "يوم عمل ويوم إجازة"}
                  </button>
                ))}
              </div>
            </div>
            {form.recurrence_type === "alternate_days" && (
              <div className="w-40">
                <div className="flex flex-col gap-1.5">
                  <Label>أول يوم عمل</Label>
                  <Input type="date" value={form.pattern_anchor_date} onChange={(e) => set("pattern_anchor_date", e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {form.recurrence_type === "weekly" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">الأيام (اختر يومًا أو أكثر)</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => setWeekDays((list) => toggle(list, day.value))}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      weekDays.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.recurrence_type === "monthly" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">أيّام الشهر (تتكرّر كلّ شهر)</Label>
              <div className="grid w-fit grid-cols-7 gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setMonthDays((list) => toggle(list, d))}
                    className={`h-8 w-9 rounded-md border font-mono text-sm tabular-nums ${
                      monthDays.includes(d) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">الشهر الذي لا يوم فيه بالرقم المختار (31 في الأشهر القصيرة) لا دوام فيه بهذه الفترة.</span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28">
              <div className="flex flex-col gap-1.5">
                <Label>من</Label>
                <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
              </div>
            </div>
            <div className="w-28">
              <div className="flex flex-col gap-1.5">
                <Label>إلى</Label>
                <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
              </div>
            </div>
            <div className="w-24">
              <div className="flex flex-col gap-1.5">
                <Label>الفتحة (د)</Label>
                <Input type="number" min={5} value={form.slot_duration_minutes} onChange={(e) => set("slot_duration_minutes", e.target.value)} />
              </div>
            </div>
            <div className="w-20">
              <div className="flex flex-col gap-1.5">
                <Label>السعة</Label>
                <Input type="number" min={1} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
              </div>
            </div>
            <div className="w-44">
              <div className="flex flex-col gap-1.5">
                <Label>العيادة</Label>
                <Select value={form.clinic_id || NONE} onValueChange={(value) => set("clinic_id", value === NONE ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>أي عيادة</SelectItem>
                    {(clinics.data ?? []).map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="w-40">
              <div className="flex flex-col gap-1.5">
                <Label>يسري من</Label>
                <Input type="date" value={form.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
              </div>
            </div>
            <div className="w-40">
              <div className="flex flex-col gap-1.5">
                <Label>حتى (اختياري)</Label>
                <Input type="date" value={form.effective_to ?? ""} onChange={(e) => set("effective_to", e.target.value)} />
              </div>
            </div>
            <Button disabled={add.isPending || Boolean(problem)} onClick={() => add.mutate()}>
              <Plus className="h-4 w-4" />
              {replaced.length > 0 ? "إضافة واستبدال" : drafts.length > 1 ? `إضافة ${drafts.length} فترات` : "إضافة"}
            </Button>
          </div>

          {problem && <p className="text-xs text-destructive">{problem}</p>}
          {!problem && replaced.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                تتداخل مع فترات قائمة — ستحلّ الجديدة محلّها من {form.effective_from}
                {form.effective_to ? ` حتى ${form.effective_to} (وتعود القديمة بعده)` : ""}:
              </p>
              <ul className="mt-1 list-inside list-disc">
                {replaced.map((row) => (
                  <li key={row.id}>
                    {scheduleDayLabel(row)} · {hhmm(row.start_time)}–{hhmm(row.end_time)} · {row.effective_from} → {row.effective_to ?? "مفتوح"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {rows.isLoading && <Skeleton className="h-24 w-full" />}
      {!rows.isLoading && (
        <>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              إظهار الفترات الموقوفة ({inactiveCount})
            </label>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النمط</TableHead>
                <TableHead>اليوم</TableHead>
                <TableHead>الوقت</TableHead>
                <TableHead>العيادة</TableHead>
                <TableHead>الفتحة</TableHead>
                <TableHead>السعة</TableHead>
                <TableHead>السريان</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id} className={row.is_active ? "" : "text-muted-foreground line-through"}>
                  <TableCell>{RECURRENCE_LABEL[row.recurrence_type] ?? row.recurrence_type}</TableCell>
                  <TableCell>{scheduleDayLabel(row)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {hhmm(row.start_time)} — {hhmm(row.end_time)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{one(row.clinic)?.name ?? "أي عيادة"}</TableCell>
                  <TableCell>{row.slot_duration_minutes} د</TableCell>
                  <TableCell>{row.capacity}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.effective_from} → {row.effective_to ?? "مفتوح"}
                  </TableCell>
                  <TableCell className="text-end">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        {row.is_active && (
                          <Button size="sm" variant="ghost" title="تعديل" onClick={() => setEditing(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" title="حذف" onClick={() => remove.mutate(row.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                    لا جدول دوام مسجَّل — الحجز مفتوح في أي وقت.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}

      <EditScheduleDialog
        row={editing}
        allRows={rows.data ?? []}
        clinics={(clinics.data ?? []).map((c: any) => ({ id: c.id, name: c.name_ar }))}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ["doctor-schedules", doctorId] });
          queryClient.invalidateQueries({ queryKey: ["calendar-availability"] });
          queryClient.invalidateQueries({ queryKey: ["calendar-schedule-bounds"] });
        }}
      />
    </div>
  );
}

/** تعديل فترة دوامٍ قائمة: الوقت والفتحة والسعة والعيادة والسريان. */
function EditScheduleDialog({
  row,
  allRows,
  clinics,
  onClose,
  onSaved,
}: {
  row: ScheduleRow | null;
  allRows: ScheduleRow[];
  clinics: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<any>(null);
  const current = row && draft?.id === row.id ? draft : row
    ? {
        id: row.id,
        start_time: hhmm(row.start_time),
        end_time: hhmm(row.end_time),
        slot_duration_minutes: row.slot_duration_minutes,
        capacity: row.capacity,
        clinic_id: row.clinic_id ?? "",
        effective_from: row.effective_from,
        effective_to: row.effective_to ?? "",
      }
    : null;
  const set = (field: string, value: any) => setDraft({ ...current, [field]: value });

  const replaced = row && current
    ? schedulesReplacedBy(
        allRows,
        {
          recurrence_type: row.recurrence_type,
          day_of_week: row.day_of_week,
          day_of_month: row.day_of_month,
          pattern_anchor_date: row.pattern_anchor_date,
          clinic_id: current.clinic_id || null,
          start_time: current.start_time,
          end_time: current.end_time,
          effective_from: current.effective_from,
          effective_to: current.effective_to || null,
        },
        row.id,
      )
    : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!row || !current) return;
      if (!current.start_time || !current.end_time || current.end_time <= current.start_time)
        throw new Error("وقت «إلى» يجب أن يكون بعد «من»");
      if (current.effective_to && current.effective_to < current.effective_from)
        throw new Error("تاريخ «حتى» قبل «يسري من»");
      const { data, error } = await supabase
        .from("doctor_schedules")
        .update({
          start_time: current.start_time,
          end_time: current.end_time,
          slot_duration_minutes: Number(current.slot_duration_minutes) || 15,
          capacity: Number(current.capacity) || 1,
          clinic_id: current.clinic_id || null,
          effective_from: current.effective_from,
          effective_to: current.effective_to || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      toast({ title: "حُفظ تعديل فترة الدوام" });
      setDraft(null);
      onSaved();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) { setDraft(null); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل فترة الدوام</DialogTitle>
          <DialogDescription>
            {row ? `${RECURRENCE_LABEL[row.recurrence_type]} — ${scheduleDayLabel(row)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {current && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>من</Label>
              <Input type="time" value={current.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى</Label>
              <Input type="time" value={current.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الفتحة (د)</Label>
              <Input type="number" min={5} value={current.slot_duration_minutes} onChange={(e) => set("slot_duration_minutes", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السعة</Label>
              <Input type="number" min={1} value={current.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select value={current.clinic_id || NONE} onValueChange={(value) => set("clinic_id", value === NONE ? "" : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>أي عيادة</SelectItem>
                  {clinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>يسري من</Label>
              <Input type="date" value={current.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>حتى (اختياري)</Label>
              <Input type="date" value={current.effective_to} onChange={(e) => set("effective_to", e.target.value)} />
            </div>
            {replaced.length > 0 && (
              <p className="col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                تتداخل مع {replaced.length} فترة قائمة — ستحلّ هذه محلّها في المدّة المشتركة.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setDraft(null); onClose(); }} disabled={save.isPending}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ExceptionsTab({
  doctorId,
  organizationId,
  canManage,
}: {
  doctorId: string;
  organizationId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<any>({
    exception_type: "leave",
    starts_at: "",
    ends_at: "",
    reason: "",
  });

  const rows = useQuery({
    queryKey: ["doctor-exceptions", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_working_hours")
        .select("id, starts_at, ends_at, exception_type, is_blocked, reason, note")
        .eq("doctor_id", doctorId)
        .order("starts_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const add = useMutation({
    mutationFn: async () => {
      if (!form.starts_at || !form.ends_at) throw new Error("حدّد البداية والنهاية");
      if (new Date(form.ends_at) <= new Date(form.starts_at)) {
        throw new Error("النهاية يجب أن تكون بعد البداية");
      }
      const { error } = await supabase.from("doctor_working_hours").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        exception_type: form.exception_type,
        reason: form.reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-exceptions", doctorId] });
      setForm({ exception_type: "leave", starts_at: "", ends_at: "", reason: "" });
      toast({ title: "سُجِّل الاستثناء" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر التسجيل",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("doctor_working_hours")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-exceptions", doctorId] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        الإجازة والتدريب والطارئ <strong>تمنع</strong> الحجز في وقتها. و«دوام استثنائي» يستبدل
        الجدول الأسبوعي في يومه — لا يُضاف إليه.
      </p>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="w-36">
            <div className="flex flex-col gap-1.5">
              <Label>النوع</Label>
              <Select
                value={form.exception_type}
                onValueChange={(value) => set("exception_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXCEPTION_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="w-52">
            <div className="flex flex-col gap-1.5">
              <Label>من</Label>
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
              />
            </div>
          </div>
          <div className="w-52">
            <div className="flex flex-col gap-1.5">
              <Label>إلى</Label>
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
              />
            </div>
          </div>
          <div className="min-w-40 flex-1">
            <div className="flex flex-col gap-1.5">
              <Label>السبب</Label>
              <Input value={form.reason} onChange={(e) => set("reason", e.target.value)} />
            </div>
          </div>
          <Button disabled={add.isPending} onClick={() => add.mutate()}>
            <Plus className="h-4 w-4" />
            تسجيل
          </Button>
        </div>
      )}

      {rows.isLoading && <Skeleton className="h-24 w-full" />}
      {!rows.isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>النوع</TableHead>
              <TableHead>من</TableHead>
              <TableHead>إلى</TableHead>
              <TableHead>السبب</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant={row.is_blocked ? "destructive" : "secondary"}>
                    {EXCEPTION_TYPES[row.exception_type] ?? row.exception_type}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(row.starts_at).toLocaleString("ar-SA-u-nu-latn")}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(row.ends_at).toLocaleString("ar-SA-u-nu-latn")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.reason ?? row.note ?? "—"}
                </TableCell>
                <TableCell className="text-end">
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(rows.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا استثناءات مسجَّلة.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function LicenseTab({ doctorId, canManage }: { doctorId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});
  const [loaded, setLoaded] = useState(false);

  const row = useQuery({
    queryKey: ["doctor-license", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_license_status")
        .select(
          "doctor_id, license_number, license_authority, license_expiry_date, classification_number, classification_expiry_date, license_days_left, classification_days_left, license_expired, classification_expired",
        )
        .eq("doctor_id", doctorId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  if (row.data && !loaded) {
    setForm({
      license_number: row.data.license_number ?? "",
      license_authority: row.data.license_authority ?? "",
      license_expiry_date: row.data.license_expiry_date ?? "",
      specialty_authority_number: row.data.classification_number ?? "",
      classification_expiry_date: row.data.classification_expiry_date ?? "",
    });
    setLoaded(true);
  }

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const text = (value: any) => {
        const raw = String(value ?? "").trim();
        return raw === "" ? null : raw;
      };
      const { data, error } = await supabase
        .from("doctors")
        .update({
          license_number: text(form.license_number),
          license_authority: text(form.license_authority),
          license_expiry_date: text(form.license_expiry_date),
          specialty_authority_number: text(form.specialty_authority_number),
          classification_expiry_date: text(form.classification_expiry_date),
        })
        .eq("id", doctorId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحدَّث شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-license", doctorId] });
      // المفتاح كان `["doctors"]` ولا يستعمله أي استعلام في المشروع، فلم يكن
      // يُحدِّث شيئًا: قائمة الأطباء مفتاحها `doctors-list` والقوائم المنسدلة
      // `doctors-enabled`.
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] });
      toast({ title: "حُفظت بيانات الترخيص" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  if (row.isLoading) return <Skeleton className="h-40 w-full" />;

  const warn = (expired: boolean, days: number | null) => {
    if (expired) return { variant: "destructive" as const, text: "منتهٍ" };
    if (days !== null && days < 30) return { variant: "secondary" as const, text: `${days} يومًا` };
    return null;
  };

  const licenseWarn = warn(Boolean(row.data?.license_expired), row.data?.license_days_left ?? null);
  const classWarn = warn(
    Boolean(row.data?.classification_expired),
    row.data?.classification_days_left ?? null,
  );

  return (
    <div className="flex flex-col gap-3">
      {(licenseWarn || classWarn) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {licenseWarn && <div>الترخيص: {licenseWarn.text}</div>}
            {classWarn && <div>التصنيف: {classWarn.text}</div>}
            <div className="mt-1 text-xs">
              الحجز لا يُمنع — يُعرض تنبيه للموظف. المنع الكامل يوقف عيادةً بسبب ورقة تُجدَّد،
              فيعطّل الموظف الفحص بدل أن يحترمه.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>رقم الترخيص</Label>
          <Input
            value={form.license_number ?? ""}
            dir="ltr"
            disabled={!canManage}
            onChange={(e) => set("license_number", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>جهة الترخيص</Label>
          <Input
            value={form.license_authority ?? ""}
            disabled={!canManage}
            onChange={(e) => set("license_authority", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>انتهاء الترخيص</Label>
          <Input
            type="date"
            value={form.license_expiry_date ?? ""}
            disabled={!canManage}
            onChange={(e) => set("license_expiry_date", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم التصنيف</Label>
          <Input
            value={form.specialty_authority_number ?? ""}
            dir="ltr"
            disabled={!canManage}
            onChange={(e) => set("specialty_authority_number", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>انتهاء التصنيف</Label>
          <Input
            type="date"
            value={form.classification_expiry_date ?? ""}
            disabled={!canManage}
            onChange={(e) => set("classification_expiry_date", e.target.value)}
          />
        </div>
      </div>

      {canManage && (
        <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "..." : "حفظ"}
        </Button>
      )}
    </div>
  );
}
