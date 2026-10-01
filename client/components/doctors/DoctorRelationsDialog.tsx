import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
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
                      ? `${Number(row.price_override).toLocaleString("ar-SA")} (خاص)`
                      : item
                        ? Number(item.price).toLocaleString("ar-SA")
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
    day_of_week: 7,
    pattern_anchor_date: new Date().toISOString().slice(0, 10),
    start_time: "08:00",
    end_time: "14:00",
    slot_duration_minutes: 15,
    capacity: 1,
    effective_from: new Date().toISOString().slice(0, 10),
  });

  const rows = useQuery({
    queryKey: ["doctor-schedules", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_schedules")
        .select(
          "id, clinic_id, recurrence_type, pattern_anchor_date, day_of_week, start_time, end_time, slot_duration_minutes, capacity, effective_from, effective_to, is_active, clinic:clinics!doctor_schedules_clinic_id_fkey(name)",
        )
        .eq("doctor_id", doctorId)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("doctor_schedules").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        clinic_id: form.clinic_id || null,
        recurrence_type: form.recurrence_type,
        day_of_week: Number(form.day_of_week),
        pattern_anchor_date: form.recurrence_type === "alternate_days" ? form.pattern_anchor_date : null,
        start_time: form.start_time,
        end_time: form.end_time,
        slot_duration_minutes: Number(form.slot_duration_minutes) || 15,
        capacity: Number(form.capacity) || 1,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-schedules", doctorId] });
      toast({ title: "أُضيفت فترة الدوام" });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-schedules", doctorId] }),
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
        اختر دوامًا أسبوعيًا لأيام محددة أو نمط يوم عمل ويوم إجازة. ويمكن تسجيل الإجازات والدوام الاستثنائي من تبويب الاستثناءات.
      </p>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="w-44">
            <div className="flex flex-col gap-1.5">
              <Label>نمط الدوام</Label>
              <Select value={form.recurrence_type} onValueChange={(value) => set("recurrence_type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">أسبوعي حسب الأيام</SelectItem>
                  <SelectItem value="alternate_days">يوم عمل ويوم إجازة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.recurrence_type === "weekly" ? (
            <div className="w-28">
              <div className="flex flex-col gap-1.5">
                <Label>اليوم</Label>
                <Select value={String(form.day_of_week)} onValueChange={(value) => set("day_of_week", Number(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="w-40">
              <div className="flex flex-col gap-1.5">
                <Label>أول يوم عمل</Label>
                <Input type="date" value={form.pattern_anchor_date} onChange={(e) => set("pattern_anchor_date", e.target.value)} />
              </div>
            </div>
          )}
          <div className="w-28">
            <div className="flex flex-col gap-1.5">
              <Label>من</Label>
              <Input
                type="time"
                value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)}
              />
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
              <Input
                type="number"
                min={5}
                value={form.slot_duration_minutes}
                onChange={(e) => set("slot_duration_minutes", e.target.value)}
              />
            </div>
          </div>
          <div className="w-20">
            <div className="flex flex-col gap-1.5">
              <Label>السعة</Label>
              <Input
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
              />
            </div>
          </div>
          <div className="w-44">
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select
                value={form.clinic_id || NONE}
                onValueChange={(value) => set("clinic_id", value === NONE ? "" : value)}
              >
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
              <Input
                type="date"
                value={form.effective_from}
                onChange={(e) => set("effective_from", e.target.value)}
              />
            </div>
          </div>
          <div className="w-40">
            <div className="flex flex-col gap-1.5">
              <Label>حتى (اختياري)</Label>
              <Input
                type="date"
                value={form.effective_to ?? ""}
                onChange={(e) => set("effective_to", e.target.value)}
              />
            </div>
          </div>
          <Button disabled={add.isPending} onClick={() => add.mutate()}>
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
              <TableHead>النمط</TableHead>
              <TableHead>اليوم / البداية</TableHead>
              <TableHead>الوقت</TableHead>
              <TableHead>العيادة</TableHead>
              <TableHead>الفتحة</TableHead>
              <TableHead>السعة</TableHead>
              <TableHead>السريان</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.id} className={row.is_active ? "" : "text-muted-foreground"}>
                <TableCell>{row.recurrence_type === "alternate_days" ? "يوم عمل / يوم إجازة" : "أسبوعي"}</TableCell>
                <TableCell>{row.recurrence_type === "alternate_days" ? row.pattern_anchor_date : (DAY_LABEL[row.day_of_week] ?? row.day_of_week)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {String(row.start_time).slice(0, 5)} — {String(row.end_time).slice(0, 5)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {one(row.clinic)?.name ?? "أي عيادة"}
                </TableCell>
                <TableCell>{row.slot_duration_minutes} د</TableCell>
                <TableCell>{row.capacity}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.effective_from} → {row.effective_to ?? "مفتوح"}
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
                <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                  لا جدول دوام مسجَّل — الحجز مفتوح في أي وقت.
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
                  {new Date(row.starts_at).toLocaleString("ar-SA")}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(row.ends_at).toLocaleString("ar-SA")}
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
