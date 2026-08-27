import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const emptyForm = {
  name_ar: "",
  name_en: "",
  mobile_number: "",
  gender: "" as "" | "male" | "female",
  birth_date: "",
  id_number: "",
  city: "",
  address: "",
  insurance_company_name: "",
  insurance_policy_number: "",
  default_discount_percent: "0",
  general_note: "",
};

/**
 * نموذج "مريض جديد" الكامل — يغطي أهم حقول ملف المريض (الهوية/الاتصال/العنوان/
 * التأمين) دفعة واحدة عند الإنشاء. باقي الحقول التفصيلية (~50 حقل في المخطط
 * الخلفي) تُستكمل من تبويبات ملف المريض بعد فتحه.
 */
export default function NewPatientDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);

  const set = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const createPatient = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase
        .from("patients")
        .insert({
          organization_id: organization.id,
          name_ar: form.name_ar.trim(),
          name_en: form.name_en.trim() || null,
          mobile_number: form.mobile_number.trim() || null,
          gender: form.gender || null,
          birth_date: form.birth_date || null,
          id_number: form.id_number.trim() || null,
          address: [form.city, form.address].filter(Boolean).join(" - ") || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
          default_discount_percent: Number(form.default_discount_percent) || 0,
          general_note: form.general_note.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم فتح ملف المريض" });
      setForm(emptyForm);
      onOpenChange(false);
      navigate(`/patients/${id}`);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ المريض",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>فتح ملف مريض جديد</DialogTitle>
          <DialogDescription>يمكن استكمال باقي الحقول من ملف المريض لاحقًا.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="الاسم بالعربية *">
            <Input value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
          </Field>
          <Field label="الاسم بالإنجليزية">
            <Input value={form.name_en} onChange={(e) => set("name_en", e.target.value)} />
          </Field>
          <Field label="رقم الجوال">
            <Input value={form.mobile_number} onChange={(e) => set("mobile_number", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="الجنس">
            <Select value={form.gender} onValueChange={(value) => set("gender", value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="تاريخ الميلاد">
            <Input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
          </Field>
          <Field label="رقم الهوية/الإقامة">
            <Input value={form.id_number} onChange={(e) => set("id_number", e.target.value)} />
          </Field>
          <Field label="المدينة">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="العنوان التفصيلي">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="شركة التأمين (اتركها فارغة للدفع النقدي)">
            <Input
              value={form.insurance_company_name}
              onChange={(e) => set("insurance_company_name", e.target.value)}
            />
          </Field>
          <Field label="رقم وثيقة التأمين">
            <Input
              value={form.insurance_policy_number}
              onChange={(e) => set("insurance_policy_number", e.target.value)}
            />
          </Field>
          <Field label="نسبة خصم افتراضية %">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.default_discount_percent}
              onChange={(e) => set("default_discount_percent", e.target.value)}
            />
          </Field>
          <Field label="ملاحظة عامة" full>
            <Textarea value={form.general_note} onChange={(e) => set("general_note", e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button disabled={!form.name_ar.trim() || createPatient.isPending} onClick={() => createPatient.mutate()}>
            {createPatient.isPending ? "جارٍ الحفظ..." : "حفظ وفتح الملف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
