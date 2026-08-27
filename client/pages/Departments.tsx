import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function useClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["clinics-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, code, clinic_type, parent_clinic_id, is_disabled")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

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

export default function Departments() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const clinics = useClinics(organization?.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأقسام والعيادات</h1>
          <p className="text-sm text-muted-foreground">إدارة العيادات والأقسام الداخلية للمنشأة</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          قسم/عيادة جديدة
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>القائمة</CardTitle>
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
                  <TableHead>الحالة</TableHead>
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
                    <TableCell>{CLINIC_TYPES.find((type) => type.value === clinic.clinic_type)?.label ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={clinic.is_disabled ? "secondary" : "success"}>
                        {clinic.is_disabled ? "معطّلة" : "نشطة"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(clinics.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عيادات/أقسام بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewClinicDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organization?.id}
        existingClinics={clinics.data ?? []}
      />
    </div>
  );
}

function NewClinicDialog({
  open,
  onOpenChange,
  organizationId,
  existingClinics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  existingClinics: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [clinicType, setClinicType] = useState("");
  const [parentId, setParentId] = useState("");

  const createClinic = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("clinics").insert({
        organization_id: organizationId,
        name: name.trim(),
        code: code.trim() || name.trim().slice(0, 8),
        clinic_type: clinicType || null,
        parent_clinic_id: parentId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-list"] });
      toast({ title: "تم إنشاء القسم/العيادة" });
      setName("");
      setCode("");
      setClinicType("");
      setParentId("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>قسم/عيادة جديدة</DialogTitle>
          <DialogDescription>يمكن جعلها عيادة فرعية تابعة لعيادة رئيسية</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الكود (اختياري — يُولَّد تلقائيًا إن تُرك فارغًا)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={clinicType} onValueChange={setClinicType}>
              <SelectTrigger>
                <SelectValue placeholder="اختر النوع" />
              </SelectTrigger>
              <SelectContent>
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
                  {existingClinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button disabled={!name.trim() || createClinic.isPending} onClick={() => createClinic.mutate()}>
            {createClinic.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
