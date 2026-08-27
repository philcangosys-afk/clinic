import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Save, Stethoscope } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { examFieldLabel, type ExamTemplateSchema } from "@/lib/exam-template-fields";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import PatientPicker from "@/components/shared/PatientPicker";
import IcdPicker from "@/components/shared/IcdPicker";
import { useToast } from "@/hooks/use-toast";

function useRecentVisits(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["medical-visits", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select(
          "id, visit_date, main_complaint, patient:patients(id, name_ar, file_number), doctor:doctors(id, name_ar)",
        )
        .order("visit_date", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function MedicalRecords() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const visits = useRecentVisits(organization?.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">السجل الطبي</h1>
          <p className="text-sm text-muted-foreground">زيارات الفحص الطبي — نموذج ديناميكي حسب تخصص الطبيب</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          زيارة فحص جديدة
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>آخر الزيارات</CardTitle>
          <CardDescription>آخر 40 زيارة فحص في المنشأة</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {visits.isLoading &&
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {!visits.isLoading && (visits.data ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد زيارات فحص مسجّلة بعد.</p>
          )}
          {(visits.data ?? []).map((visit: any) => (
            <div key={visit.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">{visit.patient?.name_ar ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    د. {visit.doctor?.name_ar ?? "—"} · {visit.main_complaint ?? "بلا شكوى مسجّلة"}
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(visit.visit_date).toLocaleString("ar-SA")}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <NewVisitDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function useDoctorsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-enabled", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, specialty_value_id")
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useTemplateForSpecialty(specialtyValueId: string | null | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["exam-template", specialtyValueId, organizationId],
    enabled: Boolean(specialtyValueId),
    queryFn: async () => {
      const { data: specialty, error: specialtyError } = await supabase
        .from("lookup_values")
        .select("extra")
        .eq("id", specialtyValueId)
        .single();
      if (specialtyError) throw specialtyError;
      const specialtyCode = (specialty?.extra as { specialty_code?: string } | null)?.specialty_code;
      if (!specialtyCode) return null;

      const { data: templates, error: templatesError } = await supabase
        .from("clinic_exam_templates")
        .select("id, canvas_type, schema_definition")
        .eq("specialty_code", specialtyCode)
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (templatesError) throw templatesError;
      return templates as { id: string; canvas_type: string; schema_definition: ExamTemplateSchema } | null;
    },
  });
}

function NewVisitDialog({
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
  const doctors = useDoctorsList(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [mainComplaint, setMainComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [nextVisitPlan, setNextVisitPlan] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [diagnoses, setDiagnoses] = useState<{ id: string; code: string; name_ar: string | null; name_en: string }[]>([]);

  const selectedDoctor = (doctors.data ?? []).find((doctor) => doctor.id === doctorId);
  const template = useTemplateForSpecialty(selectedDoctor?.specialty_value_id, organizationId);

  useEffect(() => {
    setFieldValues({});
  }, [template.data?.id]);

  const groupSections = useMemo(
    () => (template.data?.schema_definition.sections ?? []).filter((section) => section.type === "group"),
    [template.data],
  );

  const createVisit = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب");
      const { data: visit, error: visitError } = await supabase
        .from("patient_visits")
        .insert({
          organization_id: organizationId,
          patient_id: patient.id,
          doctor_id: doctorId,
          template_id: template.data?.id ?? null,
          canvas_type: template.data?.canvas_type ?? "none",
          main_complaint: mainComplaint.trim() || null,
          exam_data: fieldValues,
          notes: notes.trim() || null,
          next_visit_plan: nextVisitPlan.trim() || null,
        })
        .select("id")
        .single();
      if (visitError) throw visitError;

      if (diagnoses.length > 0) {
        const { error: diagnosesError } = await supabase.from("patient_visit_diagnoses").insert(
          diagnoses.map((code) => ({ visit_id: visit.id, icd10_code_id: code.id })),
        );
        if (diagnosesError) throw diagnosesError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medical-visits"] });
      toast({ title: "تم حفظ زيارة الفحص" });
      setPatient(null);
      setDoctorId("");
      setMainComplaint("");
      setNotes("");
      setNextVisitPlan("");
      setFieldValues({});
      setDiagnoses([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الزيارة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>زيارة فحص جديدة</DialogTitle>
          <DialogDescription>يتغيّر نموذج الفحص تلقائيًا حسب تخصص الطبيب المختار</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الطبيب الفاحص</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الطبيب" />
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
            <Label>الشكوى الرئيسية</Label>
            <Input value={mainComplaint} onChange={(e) => setMainComplaint(e.target.value)} />
          </div>

          {doctorId && !template.data && !template.isLoading && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              لا يوجد قالب فحص مطابق لتخصص هذا الطبيب — حدَّد تخصص الطبيب من شاشة الأطباء أولًا.
            </p>
          )}

          {groupSections.map((section) => (
            <div key={section.key} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">{section.label_ar}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {section.fields.map((fieldKey) => (
                  <div key={fieldKey} className="flex flex-col gap-1">
                    <Label className="text-xs font-normal text-muted-foreground">{examFieldLabel(fieldKey)}</Label>
                    <Input
                      value={fieldValues[fieldKey] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>التشخيص (ICD10)</Label>
            <IcdPicker selected={diagnoses} onChange={setDiagnoses} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات عامة</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>خطة المتابعة القادمة</Label>
            <Textarea value={nextVisitPlan} onChange={(e) => setNextVisitPlan(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!patient || !doctorId || createVisit.isPending} onClick={() => createVisit.mutate()}>
            <Save className="h-4 w-4" />
            {createVisit.isPending ? "جارٍ الحفظ..." : "حفظ الزيارة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
