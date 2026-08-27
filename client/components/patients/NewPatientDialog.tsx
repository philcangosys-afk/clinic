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
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

const emptyForm = {
  name_ar: "",
  name_en: "",
  mobile_number: "",
  gender: "" as "" | "male" | "female",
  birth_date: "",
  id_number: "",
  passport_number: "",
  nationality_value_id: "",
  profession_value_id: "",
  marital_status: "" as "" | "single" | "married" | "divorced" | "widowed",
  customer_type_value_id: "",
  source_value_id: "",
  educational_qualification_value_id: "",
  work_entity_value_id: "",
  city: "",
  address: "",
  emergency_number: "",
  email_1: "",
  blood_type: "",
  guarantor_name: "",
  guarantor_number: "",
  nearest_person_name: "",
  nearest_person_number: "",
  insurance_company_name: "",
  insurance_policy_number: "",
  insurance_membership_number: "",
  default_discount_percent: "0",
  general_note: "",
  is_newborn: false,
};

const MARITAL_STATUS_LABELS_AR: Record<string, string> = {
  single: "أعزب",
  married: "متزوج",
  divorced: "مطلّق",
  widowed: "أرمل",
};

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/**
 * نموذج "مريض جديد" — يغطي الحقول الأساسية والهوية والتأمين والضامن/أقرب شخص
 * عند الإنشاء (استجابةً لمراجعة لقطة 1 المرجعية، التي كشفت عرض ١٢ حقلًا فقط
 * من نحو ٦٠ حقلًا موجودًا في جدول patients). باقي الحقول النادرة الاستخدام
 * (مثل GLN، هوية الأب/الأم، إلخ) تبقى قابلة للاستكمال من ملف المريض بعد فتحه.
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
          passport_number: form.passport_number.trim() || null,
          nationality_value_id: form.nationality_value_id || null,
          profession_value_id: form.profession_value_id || null,
          marital_status: form.marital_status || null,
          customer_type_value_id: form.customer_type_value_id || null,
          source_value_id: form.source_value_id || null,
          educational_qualification_value_id: form.educational_qualification_value_id || null,
          work_entity_value_id: form.work_entity_value_id || null,
          address: [form.city, form.address].filter(Boolean).join(" - ") || null,
          emergency_number: form.emergency_number.trim() || null,
          email_1: form.email_1.trim() || null,
          blood_type: form.blood_type || null,
          guarantor_name: form.guarantor_name.trim() || null,
          guarantor_number: form.guarantor_number.trim() || null,
          nearest_person_name: form.nearest_person_name.trim() || null,
          nearest_person_number: form.nearest_person_number.trim() || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
          insurance_membership_number: form.insurance_membership_number.trim() || null,
          default_discount_percent: Number(form.default_discount_percent) || 0,
          general_note: form.general_note.trim() || null,
          is_newborn: form.is_newborn,
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
          <Field label="رقم الجواز">
            <Input value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
          </Field>
          <Field label="الجنسية">
            <LookupSelect
              categoryKey="nationalities"
              value={form.nationality_value_id}
              onChange={(v) => set("nationality_value_id", v)}
            />
          </Field>
          <Field label="المهنة">
            <LookupSelect
              categoryKey="professions"
              value={form.profession_value_id}
              onChange={(v) => set("profession_value_id", v)}
            />
          </Field>
          <Field label="الحالة العائلية">
            <Select
              value={form.marital_status}
              onValueChange={(v) => set("marital_status", v as typeof form.marital_status)}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MARITAL_STATUS_LABELS_AR).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="فصيلة الدم">
            <Select value={form.blood_type} onValueChange={(v) => set("blood_type", v)}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                {BLOOD_TYPES.map((bt) => (
                  <SelectItem key={bt} value={bt}>
                    {bt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="نوع العميل">
            <LookupSelect
              categoryKey="customer_types"
              value={form.customer_type_value_id}
              onChange={(v) => set("customer_type_value_id", v)}
            />
          </Field>
          <Field label="مصدر المريض">
            <LookupSelect
              categoryKey="patient_sources"
              value={form.source_value_id}
              onChange={(v) => set("source_value_id", v)}
            />
          </Field>
          <Field label="المؤهل التعليمي">
            <LookupSelect
              categoryKey="educational_qualifications"
              value={form.educational_qualification_value_id}
              onChange={(v) => set("educational_qualification_value_id", v)}
            />
          </Field>
          <Field label="جهة العمل">
            <LookupSelect
              categoryKey="work_entities"
              value={form.work_entity_value_id}
              onChange={(v) => set("work_entity_value_id", v)}
            />
          </Field>
          <Field label="المدينة">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="العنوان التفصيلي">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="جوال للطوارئ">
            <Input value={form.emergency_number} onChange={(e) => set("emergency_number", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input type="email" value={form.email_1} onChange={(e) => set("email_1", e.target.value)} />
          </Field>
          <Field label="اسم الضامن / الكفيل">
            <Input value={form.guarantor_name} onChange={(e) => set("guarantor_name", e.target.value)} />
          </Field>
          <Field label="رقم جوال الضامن / الكفيل">
            <Input value={form.guarantor_number} onChange={(e) => set("guarantor_number", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="اسم أقرب شخص">
            <Input value={form.nearest_person_name} onChange={(e) => set("nearest_person_name", e.target.value)} />
          </Field>
          <Field label="رقم جوال أقرب شخص">
            <Input
              value={form.nearest_person_number}
              onChange={(e) => set("nearest_person_number", e.target.value)}
              inputMode="tel"
            />
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
          <Field label="رقم العضوية التأمينية">
            <Input
              value={form.insurance_membership_number}
              onChange={(e) => set("insurance_membership_number", e.target.value)}
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
          <Field label="مولود جديد (لا يتطلب هوية مستقلة)">
            <Button
              type="button"
              variant={form.is_newborn ? "default" : "outline"}
              onClick={() => set("is_newborn", !form.is_newborn)}
            >
              {form.is_newborn ? "نعم" : "لا"}
            </Button>
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
