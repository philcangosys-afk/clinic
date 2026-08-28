import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Pencil } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/**
 * الأقسام والعيادات (لقطتا 2 و3).
 *
 * كانت الشاشة تدعم الإضافة والعرض فقط — بلا تعديل ولا تعطيل، وبلا حقول
 * "المستودع المورد" و"المستودع الاستهلاكي" و"شركة زاتكا" الموجودة في جدول
 * `clinics` منذ 0001. ربط العيادة بمستودعيها شرط لصرف المستلزمات منها،
 * وربطها بشركة زاتكا شرط لإصدار فواتيرها الإلكترونية تحت الرقم الضريبي
 * الصحيح عند وجود أكثر من كيان ضريبي في المنشأة.
 */
type ClinicRow = {
  id: string;
  name: string;
  code: string;
  clinic_type: string | null;
  parent_clinic_id: string | null;
  supplier_warehouse_id: string | null;
  consumable_warehouse_id: string | null;
  zatca_company_id: string | null;
  is_disabled: boolean;
};

const NONE = "__none__";

const CLINIC_TYPES = [
  { value: "general", label: "عام" },
  { value: "dental", label: "أسنان" },
  { value: "dermatology", label: "جلدية" },
  { value: "pediatrics", label: "أطفال" },
  { value: "ophthalmology", label: "عيون" },
  { value: "physiotherapy", label: "علاج طبيعي" },
  { value: "womens_health", label: "نساء وولادة" },
  { value: "lab_center", label: "مختبر" },
  { value: "multi_specialty", label: "متعددة التخصصات" },
];

function useClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["clinics-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select(
          "id, name, code, clinic_type, parent_clinic_id, supplier_warehouse_id, consumable_warehouse_id, zatca_company_id, is_disabled",
        )
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ClinicRow[];
    },
  });
}

function useWarehousesForClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["warehouses-for-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useZatcaCompaniesForClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["zatca-for-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zatca_companies")
        .select("id, name, vat_number")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; vat_number: string }[];
    },
  });
}

export default function Departments() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicRow | null>(null);
  const clinics = useClinics(organization?.id);
  const warehouses = useWarehousesForClinics(organization?.id);
  const zatca = useZatcaCompaniesForClinics(organization?.id);

  const toggleDisabled = useMutation({
    mutationFn: async (row: ClinicRow) => {
      const { data: affectedRows, error } = await supabase
        .from("clinics")
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
      queryClient.invalidateQueries({ queryKey: ["clinics-list"] });
      toast({ title: "تم تحديث حالة العيادة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const warehouseName = (id: string | null) =>
    id ? ((warehouses.data ?? []).find((w) => w.id === id)?.name ?? "—") : "—";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأقسام والعيادات</h1>
          <p className="text-sm text-muted-foreground">إدارة العيادات والأقسام الداخلية للمنشأة</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          قسم/عيادة جديدة
        </Button>
      </div>

      {(warehouses.data ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          لا توجد مستودعات معرَّفة بعد — أنشئها من شاشة "المستودعات" لتتمكن من ربطها بالعيادات.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>القائمة</CardTitle>
          <CardDescription>
            المستودع المورد هو مصدر صرف المستلزمات للعيادة، والاستهلاكي هو ما يُخصم منه أثناء العلاج
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clinics.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!clinics.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المستودع المورد</TableHead>
                  <TableHead>المستودع الاستهلاكي</TableHead>
                  <TableHead>شركة زاتكا</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(clinics.data ?? []).map((clinic) => (
                  <TableRow key={clinic.id}>
                    <TableCell className="flex items-center gap-2 font-medium">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {clinic.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{clinic.code}</TableCell>
                    <TableCell>
                      {CLINIC_TYPES.find((type) => type.value === clinic.clinic_type)?.label ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {warehouseName(clinic.supplier_warehouse_id)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {warehouseName(clinic.consumable_warehouse_id)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {clinic.zatca_company_id
                        ? ((zatca.data ?? []).find((c) => c.id === clinic.zatca_company_id)?.name ?? "—")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={clinic.is_disabled ? "secondary" : "success"}>
                        {clinic.is_disabled ? "معطّلة" : "نشطة"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="تعديل"
                          onClick={() => {
                            setEditing(clinic);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleDisabled.mutate(clinic)}>
                          {clinic.is_disabled ? "تفعيل" : "تعطيل"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(clinics.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عيادات/أقسام بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <ClinicFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
          initial={editing}
          existingClinics={(clinics.data ?? []).filter((c) => c.id !== editing?.id)}
          warehouses={warehouses.data ?? []}
          zatcaCompanies={zatca.data ?? []}
        />
      )}
    </div>
  );
}

function ClinicFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
  existingClinics,
  warehouses,
  zatcaCompanies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: ClinicRow | null;
  existingClinics: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  zatcaCompanies: { id: string; name: string; vat_number: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [clinicType, setClinicType] = useState(initial?.clinic_type ?? NONE);
  const [parentId, setParentId] = useState(initial?.parent_clinic_id ?? NONE);
  const [supplierWarehouseId, setSupplierWarehouseId] = useState(initial?.supplier_warehouse_id ?? NONE);
  const [consumableWarehouseId, setConsumableWarehouseId] = useState(
    initial?.consumable_warehouse_id ?? NONE,
  );
  const [zatcaCompanyId, setZatcaCompanyId] = useState(initial?.zatca_company_id ?? NONE);

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!name.trim()) throw new Error("اسم العيادة مطلوب");
      const payload = {
        organization_id: organizationId,
        name: name.trim(),
        code: code.trim() || name.trim().slice(0, 8),
        clinic_type: clinicType === NONE ? null : clinicType,
        parent_clinic_id: parentId === NONE ? null : parentId,
        supplier_warehouse_id: supplierWarehouseId === NONE ? null : supplierWarehouseId,
        consumable_warehouse_id: consumableWarehouseId === NONE ? null : consumableWarehouseId,
        zatca_company_id: zatcaCompanyId === NONE ? null : zatcaCompanyId,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase
          .from("clinics")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("clinics").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-list"] });
      toast({ title: initial ? "تم تحديث العيادة" : "تم إنشاء القسم/العيادة" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description:
          error instanceof Error
            ? error.message.includes("duplicate") || error.message.includes("unique")
              ? "كود العيادة مستخدم بالفعل — اختر كودًا مختلفًا"
              : error.message
            : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل العيادة" : "قسم/عيادة جديدة"}</DialogTitle>
          <DialogDescription>يمكن جعلها عيادة فرعية تابعة لعيادة رئيسية</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الكود (يُولَّد تلقائيًا إن تُرك فارغًا)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={clinicType} onValueChange={setClinicType}>
              <SelectTrigger>
                <SelectValue placeholder="اختر النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {CLINIC_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {existingClinics.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>عيادة رئيسية (إن كانت هذه فرعية)</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue placeholder="بلا — عيادة رئيسية مستقلة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بلا — عيادة رئيسية مستقلة</SelectItem>
                  {existingClinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>المستودع المورد</Label>
            <Select value={supplierWarehouseId} onValueChange={setSupplierWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>المستودع الاستهلاكي</Label>
            <Select value={consumableWarehouseId} onValueChange={setConsumableWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>شركة زاتكا</Label>
            <Select value={zatcaCompanyId} onValueChange={setZatcaCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {zatcaCompanies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name} — {company.vat_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
