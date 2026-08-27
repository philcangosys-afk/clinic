import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { DoctorRow } from "@/lib/database.types";
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
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, file_number, name_ar, name_en, job_title, mobile_number, is_enabled, default_appointment_duration_minutes")
        .order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Doctors() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const doctors = useDoctors(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase.from("doctors").update({ is_enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctors-list"] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث حالة الطبيب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأطباء</h1>
          <p className="text-sm text-muted-foreground">ملفات الأطباء وإعدادات الحجز الخاصة بكل طبيب</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          طبيب جديد
        </Button>
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
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>مدة الموعد</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doctors.data ?? []).map((doctor) => (
                  <TableRow key={doctor.id}>
                    <TableCell className="font-mono text-xs">#{doctor.file_number}</TableCell>
                    <TableCell className="font-medium">د. {doctor.name_ar}</TableCell>
                    <TableCell>{doctor.job_title ?? "—"}</TableCell>
                    <TableCell>{doctor.mobile_number ?? "—"}</TableCell>
                    <TableCell>{doctor.default_appointment_duration_minutes ?? 30} دقيقة</TableCell>
                    <TableCell>
                      <Badge variant={doctor.is_enabled ? "success" : "secondary"}>
                        {doctor.is_enabled ? "مفعّل" : "معطّل"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleEnabled.mutate({ id: doctor.id, is_enabled: !doctor.is_enabled })}
                      >
                        {doctor.is_enabled ? "تعطيل" : "تفعيل"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(doctors.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد أطباء مسجّلون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewDoctorDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function NewDoctorDialog({
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
  const [nameAr, setNameAr] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [mobile, setMobile] = useState("");
  const [duration, setDuration] = useState("30");

  const createDoctor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("doctors").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        job_title: jobTitle.trim() || null,
        specialty_value_id: specialtyId || null,
        gender: gender || null,
        mobile_number: mobile.trim() || null,
        default_appointment_duration_minutes: Number(duration) || 30,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] });
      toast({ title: "تم حفظ ملف الطبيب" });
      setNameAr("");
      setJobTitle("");
      setSpecialtyId("");
      setGender("");
      setMobile("");
      setDuration("30");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الطبيب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>طبيب جديد</DialogTitle>
          <DialogDescription>التخصص يحدّد قالب الفحص الافتراضي في السجل الطبي</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>اسم الطبيب *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="استشاري، أخصائي..." />
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
            <Label>رقم الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>مدة الموعد الافتراضية (دقيقة)</Label>
            <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
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
