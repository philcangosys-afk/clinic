import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Pencil, TriangleAlert } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { FacilityLicenseRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
 * تراخيص المنشأة (لقطات 79 و80).
 *
 * جدول `facility_licenses` موجود منذ 0001 ويُغذّي العرض الموحّد
 * `expiring_alerts` الذي يظهر كعدّاد في لوحة التحكم — لكن لم تكن هناك أي
 * شاشة لإضافة ترخيص أو تعديل تاريخ انتهائه. عمليًا كان العدّاد يشير إلى
 * بيانات لا يستطيع المستخدم إدخالها.
 *
 * تتضمن الشاشة أيضًا "عرض قبل: N يوم" المذكور في لقطة 80 كفلتر للتنبيهات.
 */
const ALERT_WINDOWS = [
  { value: "30", label: "خلال 30 يومًا" },
  { value: "60", label: "خلال 60 يومًا" },
  { value: "90", label: "خلال 90 يومًا" },
  { value: "180", label: "خلال 180 يومًا" },
  { value: "all", label: "كل التراخيص (مع المعطَّلة)" },
];

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function useLicenses(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["facility-licenses", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_licenses")
        .select("*")
        .eq("organization_id", organizationId)
        .order("end_date");
      if (error) throw error;
      return (data ?? []) as FacilityLicenseRow[];
    },
  });
}

function LicenseFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: FacilityLicenseRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [authority, setAuthority] = useState(initial?.authority_name ?? "");
  const [licenseNumber, setLicenseNumber] = useState(initial?.license_number ?? "");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!authority.trim()) throw new Error("اسم الجهة مطلوب");
      if (!licenseNumber.trim()) throw new Error("رقم الترخيص مطلوب");
      if (!endDate) throw new Error("تاريخ الانتهاء مطلوب");
      if (startDate && endDate && startDate > endDate)
        throw new Error("تاريخ البدء يجب أن يسبق تاريخ الانتهاء");
      const payload = {
        organization_id: organizationId,
        authority_name: authority.trim(),
        license_number: licenseNumber.trim(),
        start_date: startDate || null,
        end_date: endDate,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("facility_licenses").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("facility_licenses").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["facility-licenses"] });
      queryClient.invalidateQueries({ queryKey: ["expiring-alerts-list"] });
      toast({ title: initial ? "تم تحديث الترخيص" : "تمت إضافة الترخيص" });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل الترخيص" : "ترخيص جديد"}</DialogTitle>
          <DialogDescription>التراخيص التي تقارب على الانتهاء تظهر في تنبيهات لوحة التحكم</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الجهة الحكومية *</Label>
            <Input
              value={authority}
              onChange={(e) => setAuthority(e.target.value)}
              placeholder="وزارة الصحة، البلدية، الدفاع المدني..."
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>رقم الترخيص *</Label>
            <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ البدء</Label>
            <Input type="date" value={startDate ?? ""} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الانتهاء *</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

export default function Licenses() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const licenses = useLicenses(organization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FacilityLicenseRow | null>(null);
  /**
   * النطاق الابتدائي «كل التراخيص» لا «خلال 90 يومًا».
   *
   * الشاشة اسمها «تراخيص المنشأة» لا «التراخيص المنتهية»: بالبدء من 90 يومًا
   * كان الترخيص المُضاف للتوّ لسنتين يختفي فور رسالة النجاح، فيظنّ المستخدم أن
   * الحفظ فشل ويعيد الإضافة فتتكرّر التراخيص. النطاقات باقية كمُرشِّح اختياري.
   */
  const [alertWindow, setAlertWindow] = useState("all");

  const rows = useMemo(() => {
    // معالجة `is_disabled` موحّدة بين الفرعين: النطاقات الزمنية تعرض السارية
    // وحدها (لأنها مُرشِّح تنبيه)، و«كل التراخيص» يعرض الكل — وهو ما يقوله نصّه.
    const list = licenses.data ?? [];
    if (alertWindow === "all") return list;
    const limit = Number(alertWindow);
    return list.filter((row) => !row.is_disabled && daysUntil(row.end_date) <= limit);
  }, [licenses.data, alertWindow]);

  const expiredCount = (licenses.data ?? []).filter(
    (row) => !row.is_disabled && daysUntil(row.end_date) < 0,
  ).length;

  const toggleDisabled = useMutation({
    mutationFn: async (row: FacilityLicenseRow) => {
      const { data: affectedRows, error } = await supabase
        .from("facility_licenses")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["facility-licenses"] });
      toast({ title: "تم تحديث حالة الترخيص" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const statusOf = (row: FacilityLicenseRow) => {
    if (row.is_disabled) return { label: "معطّل", variant: "secondary" as const };
    const days = daysUntil(row.end_date);
    if (days < 0) return { label: `منتهٍ منذ ${Math.abs(days)} يومًا`, variant: "destructive" as const };
    if (days <= 30) return { label: `ينتهي خلال ${days} يومًا`, variant: "destructive" as const };
    if (days <= 90) return { label: `ينتهي خلال ${days} يومًا`, variant: "warning" as const };
    return { label: "ساري", variant: "success" as const };
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تراخيص المنشأة</h1>
          <p className="text-sm text-muted-foreground">
            تراخيص الجهات الحكومية وتواريخ انتهائها — مصدر تنبيهات لوحة التحكم
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          ترخيص جديد
        </Button>
      </div>

      {expiredCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            يوجد <strong>{expiredCount}</strong> ترخيص منتهي الصلاحية — يُنصح بتجديده أو تعطيله من القائمة.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            التراخيص
          </CardTitle>
          <CardDescription>اختر نطاق التنبيه لعرض التراخيص التي تقارب على الانتهاء خلاله</CardDescription>
          <div className="mt-2">
            <Select value={alertWindow} onValueChange={setAlertWindow}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_WINDOWS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {licenses.isLoading && <Skeleton className="h-40 w-full" />}
          {!licenses.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهة</TableHead>
                  <TableHead>رقم الترخيص</TableHead>
                  <TableHead>البدء</TableHead>
                  <TableHead>الانتهاء</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-32">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = statusOf(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.authority_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.license_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.start_date ?? "—"}</TableCell>
                      <TableCell className="text-sm">{row.end_date}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleDisabled.mutate(row)}>
                            {row.is_disabled ? "تفعيل" : "تعطيل"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {alertWindow === "all"
                        ? "لا توجد تراخيص مسجَّلة بعد."
                        : "لا توجد تراخيص ضمن النطاق المختار — اختر «كل التراخيص» لعرض الجميع."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <LicenseFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
    </div>
  );
}
