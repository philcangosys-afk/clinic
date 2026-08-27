import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { InsuranceClaimFormType } from "@/lib/database.types";
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
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import { useToast } from "@/hooks/use-toast";

const FORM_TYPE_LABELS: Record<InsuranceClaimFormType, string> = {
  ucaf: "UCAF — نموذج عام",
  dcaf: "DCAF — نموذج أسنان",
  ocaf: "OCAF — نموذج عيون",
};

function useDoctorsList() {
  return useQuery({
    queryKey: ["doctors-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, name_ar").eq("is_enabled", true).order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function usePatientMemberships(patientId: string | undefined) {
  return useQuery({
    queryKey: ["patient-memberships", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_insurance_memberships")
        .select("id, membership_number, policy:insurance_policies(policy_name, company:insurance_companies(name_ar))")
        .eq("patient_id", patientId)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

type FormField = { key: string; label: string; value: string };
type ClaimLine = {
  key: string;
  itemId: string | null;
  serviceCode: string;
  description: string;
  qty: string;
  amount: string;
};

/**
 * إنشاء نموذج مطالبة تأمين يدويًا (UCAF/DCAF/OCAF). معظم النماذج تُنشأ تلقائيًا
 * من الـ Trigger الموجود في 0005 عند فوترة كشفية تأمين — هذا النموذج للحالات
 * التي تحتاج نموذج مطالبة مستقل بلا فاتورة كشفية مرتبطة (مثال: إجراء تأميني
 * مباشر). حقول form_data حرة (مفتاح/قيمة) لأن كل نوع نموذج يختلف جوهريًا حسب
 * معايير CCHI، وهذا يطابق نفس فلسفة الفحص الطبي الديناميكي من 0006.
 */
export default function NewClaimFormDialog({
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
  const doctors = useDoctorsList();
  const [formType, setFormType] = useState<InsuranceClaimFormType>("ucaf");
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [fields, setFields] = useState<FormField[]>([{ key: "1", label: "", value: "" }]);
  const [lines, setLines] = useState<ClaimLine[]>([]);
  const memberships = usePatientMemberships(patient?.id);

  useEffect(() => {
    setMembershipId("");
  }, [patient?.id]);

  const addField = () => setFields((prev) => [...prev, { key: `${Date.now()}`, label: "", value: "" }]);
  const updateField = (key: string, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  const removeField = (key: string) => setFields((prev) => prev.filter((field) => field.key !== key));

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { key: `${Date.now()}`, itemId: null, serviceCode: "", description: "", qty: "1", amount: "0" },
    ]);
  const updateLine = (key: string, patch: Partial<ClaimLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  const selectItemForLine = (
    key: string,
    item: { id: string; code: string | null; name_ar: string; price: number },
  ) => {
    const duplicate = lines.some((line) => line.key !== key && line.itemId === item.id);
    if (duplicate) {
      toast({ variant: "destructive", title: "هذه الخدمة مضافة مسبقًا في هذا النموذج" });
      return;
    }
    updateLine(key, {
      itemId: item.id,
      serviceCode: item.code ?? "",
      description: item.name_ar,
      amount: String(item.price ?? 0),
    });
  };

  const createForm = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر مريضًا أولًا");
      const formData = Object.fromEntries(
        fields.filter((field) => field.label.trim()).map((field) => [field.label.trim(), field.value]),
      );
      const { data: form, error: formError } = await supabase
        .from("insurance_claim_forms")
        .insert({
          organization_id: organizationId,
          form_type: formType,
          patient_id: patient.id,
          doctor_id: doctorId || null,
          membership_id: membershipId || null,
          form_data: formData,
          status: "draft",
        })
        .select("id")
        .single();
      if (formError) throw formError;

      const validLines = lines.filter((line) => line.description.trim());
      if (validLines.length > 0) {
        const { error: linesError } = await supabase.from("insurance_claim_form_items").insert(
          validLines.map((line) => ({
            form_id: form.id,
            item_id: line.itemId || null,
            service_code: line.serviceCode.trim() || null,
            description: line.description.trim(),
            qty: Number(line.qty) || 1,
            amount: Number(line.amount) || 0,
          })),
        );
        if (linesError) throw linesError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-claim-forms"] });
      toast({ title: "تم إنشاء نموذج المطالبة" });
      setPatient(null);
      setDoctorId("");
      setMembershipId("");
      setFields([{ key: "1", label: "", value: "" }]);
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء المطالبة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>نموذج مطالبة تأمين جديد</DialogTitle>
          <DialogDescription>
            أغلب النماذج تُنشأ تلقائيًا عند فوترة كشفية تأمين — استخدم هذا للحالات المستقلة فقط.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع النموذج</Label>
            <Select value={formType} onValueChange={(value) => setFormType(value as InsuranceClaimFormType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      د. {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>عضوية التأمين</Label>
              <Select value={membershipId} onValueChange={setMembershipId} disabled={!patient}>
                <SelectTrigger>
                  <SelectValue placeholder={patient ? "اختر الوثيقة" : "اختر مريضًا أولًا"} />
                </SelectTrigger>
                <SelectContent>
                  {(memberships.data ?? []).map((membership: any) => (
                    <SelectItem key={membership.id} value={membership.id}>
                      {membership.policy?.company?.name_ar} — {membership.policy?.policy_name} (#{membership.membership_number})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">حقول النموذج</p>
              <Button size="sm" variant="outline" onClick={addField}>
                <Plus className="h-3.5 w-3.5" />
                إضافة حقل
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {fields.map((field) => (
                <div key={field.key} className="flex items-center gap-2">
                  <Input
                    placeholder="اسم الحقل"
                    value={field.label}
                    onChange={(e) => updateField(field.key, { label: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    placeholder="القيمة"
                    value={field.value}
                    onChange={(e) => updateField(field.key, { value: e.target.value })}
                    className="flex-1"
                  />
                  <Button size="sm" variant="ghost" onClick={() => removeField(field.key)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">بنود المطالبة (الخدمات)</p>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" />
                إضافة بند
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line.key} className="flex flex-col gap-1.5 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ItemPicker onSelect={(item) => selectItemForLine(line.key, item)} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(line.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <Input
                      placeholder="وصف الخدمة"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className="col-span-5"
                    />
                    <Input
                      placeholder="كود الخدمة"
                      value={line.serviceCode}
                      onChange={(e) => updateLine(line.key, { serviceCode: e.target.value })}
                      className="col-span-2"
                    />
                    <Input
                      type="number"
                      placeholder="الكمية"
                      value={line.qty}
                      onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                      className="col-span-2"
                    />
                    <Input
                      type="number"
                      placeholder="المبلغ"
                      value={line.amount}
                      onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      className="col-span-3"
                    />
                  </div>
                  {line.itemId && <p className="text-xs text-emerald-700">مرتبط بصنف من الكتالوج</p>}
                </div>
              ))}
              {lines.length === 0 && <p className="text-xs text-muted-foreground">لم تُضف بنود بعد.</p>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!patient || createForm.isPending} onClick={() => createForm.mutate()}>
            <Save className="h-4 w-4" />
            {createForm.isPending ? "جارٍ الحفظ..." : "حفظ النموذج"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
