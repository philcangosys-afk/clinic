import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { PatientRow } from "@/lib/database.types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * نموذج "فتح ملف سريع" لمريض جديد بأقل الحقول اللازمة (الاسم والجوال والجنس)،
 * يُستخدم من شاشة الاستقبال مباشرة عند حضور مريض بلا ملف مسبق، بدل إرسال
 * المستخدم إلى شاشة المرضى الكاملة لفتح الملف. يمكن استكمال باقي الحقول
 * الخمسين لاحقًا من شاشة ملف المريض.
 */
export default function QuickAddPatientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (patient: Pick<PatientRow, "id" | "name_ar" | "mobile_number" | "file_number">) => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nameAr, setNameAr] = useState("");
  const [mobile, setMobile] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");

  const createPatient = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase
        .from("patients")
        .insert({
          organization_id: organization.id,
          name_ar: nameAr.trim(),
          mobile_number: mobile.trim() || null,
          gender: gender || null,
        })
        .select("id, name_ar, mobile_number, file_number")
        .single();
      if (error) throw error;
      return data as Pick<PatientRow, "id" | "name_ar" | "mobile_number" | "file_number">;
    },
    onSuccess: (patient) => {
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم فتح ملف المريض", description: `رقم الملف #${patient.file_number}` });
      onCreated(patient);
      setNameAr("");
      setMobile("");
      setGender("");
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: "تعذر حفظ المريض",
        description: errorMessage(error),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>فتح ملف مريض جديد (سريع)</DialogTitle>
          <DialogDescription>
            يمكن استكمال باقي بيانات الملف الطبي والتأمين لاحقًا من شاشة المرضى.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quick-patient-name">اسم المريض *</Label>
            <Input
              id="quick-patient-name"
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
              placeholder="الاسم الكامل بالعربية"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quick-patient-mobile">رقم الجوال</Label>
            <Input
              id="quick-patient-mobile"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="05xxxxxxxx"
              inputMode="tel"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنس</Label>
            <Select value={gender} onValueChange={(value) => setGender(value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الجنس" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!nameAr.trim() || createPatient.isPending}
            onClick={() => createPatient.mutate()}
          >
            {createPatient.isPending ? "جارٍ الحفظ..." : "حفظ وفتح الملف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
