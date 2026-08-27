import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { HealthConditionRow, PatientHealthConditionRow, PatientNoteRow, PatientRow } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: ["patient", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from("patients").select("*").eq("id", id).single();
      if (error) throw error;
      return data as PatientRow;
    },
  });
}

export default function PatientProfile() {
  const { id } = useParams();
  const patient = usePatient(id);

  if (patient.isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!patient.data) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">تعذر العثور على ملف المريض.</div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/patients">
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold">{patient.data.name_ar}</h1>
            <p className="text-sm text-muted-foreground">
              ملف رقم #{patient.data.file_number} · {patient.data.mobile_number ?? "بلا جوال"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {patient.data.block_file && <Badge variant="destructive">الملف محجوب بالكامل</Badge>}
          {patient.data.block_appointments && <Badge variant="destructive">محجوب عن المواعيد</Badge>}
          {patient.data.block_invoices && <Badge variant="destructive">محجوب عن الفوترة</Badge>}
          {patient.data.block_sms && <Badge variant="secondary">محجوب عن SMS</Badge>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="conditions">الحالة الصحية</TabsTrigger>
          <TabsTrigger value="history">السوابق الصحية</TabsTrigger>
          <TabsTrigger value="notes">الملاحظات</TabsTrigger>
          <TabsTrigger value="blocking">الحجب</TabsTrigger>
          <TabsTrigger value="appointments">المواعيد</TabsTrigger>
          <TabsTrigger value="invoices">الفواتير</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab patient={patient.data} />
        </TabsContent>
        <TabsContent value="conditions">
          <HealthConditionsTab patientId={patient.data.id} />
        </TabsContent>
        <TabsContent value="history">
          <MedicalHistoryTab patientId={patient.data.id} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patientId={patient.data.id} />
        </TabsContent>
        <TabsContent value="blocking">
          <BlockingTab patient={patient.data} />
        </TabsContent>
        <TabsContent value="appointments">
          <AppointmentsTab patientId={patient.data.id} />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab patientId={patient.data.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ patient }: { patient: PatientRow }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name_ar: patient.name_ar ?? "",
    name_en: patient.name_en ?? "",
    mobile_number: patient.mobile_number ?? "",
    phone_1: patient.phone_1 ?? "",
    emergency_number: patient.emergency_number ?? "",
    email_1: patient.email_1 ?? "",
    id_number: patient.id_number ?? "",
    passport_number: patient.passport_number ?? "",
    nationality_value_id: patient.nationality_value_id ?? "",
    profession_value_id: patient.profession_value_id ?? "",
    blood_type: patient.blood_type ?? "",
    guarantor_name: patient.guarantor_name ?? "",
    guarantor_number: patient.guarantor_number ?? "",
    nearest_person_name: patient.nearest_person_name ?? "",
    nearest_person_number: patient.nearest_person_number ?? "",
    gln_number: patient.gln_number ?? "",
    insurance_company_name: patient.insurance_company_name ?? "",
    insurance_policy_number: patient.insurance_policy_number ?? "",
    insurance_membership_number: patient.insurance_membership_number ?? "",
    default_discount_percent: String(patient.default_discount_percent ?? 0),
    general_note: patient.general_note ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("patients")
        .update({
          name_ar: form.name_ar.trim(),
          name_en: form.name_en.trim() || null,
          mobile_number: form.mobile_number.trim() || null,
          phone_1: form.phone_1.trim() || null,
          emergency_number: form.emergency_number.trim() || null,
          email_1: form.email_1.trim() || null,
          id_number: form.id_number.trim() || null,
          passport_number: form.passport_number.trim() || null,
          nationality_value_id: form.nationality_value_id || null,
          profession_value_id: form.profession_value_id || null,
          blood_type: form.blood_type || null,
          guarantor_name: form.guarantor_name.trim() || null,
          guarantor_number: form.guarantor_number.trim() || null,
          nearest_person_name: form.nearest_person_name.trim() || null,
          nearest_person_number: form.nearest_person_number.trim() || null,
          gln_number: form.gln_number.trim() || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
          insurance_membership_number: form.insurance_membership_number.trim() || null,
          default_discount_percent: Number(form.default_discount_percent) || 0,
          general_note: form.general_note.trim() || null,
        })
        .eq("id", patient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم حفظ بيانات المريض" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>البيانات الأساسية</CardTitle>
        <CardDescription>الهوية والاتصال والتأمين</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>الاسم بالعربية</Label>
          <Input value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الاسم بالإنجليزية</Label>
          <Input value={form.name_en} onChange={(e) => set("name_en", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم الجوال</Label>
          <Input value={form.mobile_number} onChange={(e) => set("mobile_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>هاتف إضافي</Label>
          <Input value={form.phone_1} onChange={(e) => set("phone_1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم الهوية/الإقامة</Label>
          <Input value={form.id_number} onChange={(e) => set("id_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم الجواز</Label>
          <Input value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>جوال للطوارئ</Label>
          <Input value={form.emergency_number} onChange={(e) => set("emergency_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>البريد الإلكتروني</Label>
          <Input type="email" value={form.email_1} onChange={(e) => set("email_1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الجنسية</Label>
          <LookupSelect
            categoryKey="nationalities"
            value={form.nationality_value_id}
            onChange={(v) => set("nationality_value_id", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>المهنة</Label>
          <LookupSelect
            categoryKey="professions"
            value={form.profession_value_id}
            onChange={(v) => set("profession_value_id", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>فصيلة الدم</Label>
          <Input value={form.blood_type} onChange={(e) => set("blood_type", e.target.value)} placeholder="مثال: O+" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>GLN</Label>
          <Input value={form.gln_number} onChange={(e) => set("gln_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>اسم الضامن / الكفيل</Label>
          <Input value={form.guarantor_name} onChange={(e) => set("guarantor_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم جوال الضامن / الكفيل</Label>
          <Input value={form.guarantor_number} onChange={(e) => set("guarantor_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>اسم أقرب شخص</Label>
          <Input value={form.nearest_person_name} onChange={(e) => set("nearest_person_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم جوال أقرب شخص</Label>
          <Input value={form.nearest_person_number} onChange={(e) => set("nearest_person_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>نسبة خصم افتراضية %</Label>
          <Input
            type="number"
            value={form.default_discount_percent}
            onChange={(e) => set("default_discount_percent", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>شركة التأمين</Label>
          <Input value={form.insurance_company_name} onChange={(e) => set("insurance_company_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم وثيقة التأمين</Label>
          <Input value={form.insurance_policy_number} onChange={(e) => set("insurance_policy_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم العضوية التأمينية</Label>
          <Input
            value={form.insurance_membership_number}
            onChange={(e) => set("insurance_membership_number", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>ملاحظة عامة</Label>
          <Textarea value={form.general_note} onChange={(e) => set("general_note", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" />
            {save.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MedicalHistoryTab({ patientId }: { patientId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["patient-history", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_medical_history")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState({
    personal_history: "",
    treatment_history: "",
    family_history: "",
    drug_allergy: "",
    special_habits: "",
  });

  useEffect(() => {
    if (history.data) {
      setForm({
        personal_history: history.data.personal_history ?? "",
        treatment_history: history.data.treatment_history ?? "",
        family_history: history.data.family_history ?? "",
        drug_allergy: history.data.drug_allergy ?? "",
        special_habits: history.data.special_habits ?? "",
      });
    }
  }, [history.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("patient_medical_history")
        .upsert({ patient_id: patientId, ...form, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-history", patientId] });
      toast({ title: "تم حفظ السوابق الصحية" });
    },
  });

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>السوابق الصحية</CardTitle>
        <CardDescription>سوابق شخصية وعلاجية وعائلية وحساسية الأدوية والعادات الخاصة</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>سوابق شخصية</Label>
          <Textarea value={form.personal_history} onChange={(e) => set("personal_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>سوابق علاجية</Label>
          <Textarea value={form.treatment_history} onChange={(e) => set("treatment_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>سوابق عائلية</Label>
          <Textarea value={form.family_history} onChange={(e) => set("family_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>حساسية الأدوية (أو NKA)</Label>
          <Textarea value={form.drug_allergy} onChange={(e) => set("drug_allergy", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>عادات خاصة</Label>
          <Textarea value={form.special_habits} onChange={(e) => set("special_habits", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" />
            حفظ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NotesTab({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const notes = useQuery({
    queryKey: ["patient-notes", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_notes")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PatientNoteRow[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["patient-notes", patientId] });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("patient_notes")
        .insert({ patient_id: patientId, title: newTitle.trim() || null, body: newNote.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewTitle("");
      setNewNote("");
      invalidate();
    },
  });

  const toggleDisabled = useMutation({
    mutationFn: async (note: PatientNoteRow) => {
      const { error } = await supabase
        .from("patient_notes")
        .update({ is_disabled: !note.is_disabled })
        .eq("id", note.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("patient_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الملاحظات</CardTitle>
        <CardDescription>سجل زمني للملاحظات والمتابعة، بعنوان ونص وإمكانية تعطيل أو حذف كل ملاحظة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="عنوان الملاحظة (اختياري)" />
          <div className="flex gap-2">
            <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="أضف ملاحظة جديدة..." />
            <Button disabled={!newNote.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {(notes.data ?? []).map((note) => (
            <div key={note.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {note.title && <p className="text-sm font-semibold">{note.title}</p>}
                  <p className="text-sm">{note.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(note.created_at).toLocaleString("ar-SA")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {note.is_disabled && <Badge variant="secondary">معطّلة</Badge>}
                  <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(note)}>
                    {note.is_disabled ? "تفعيل" : "تعطيل"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeNote.mutate(note.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {(notes.data ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد ملاحظات بعد.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الحالة الصحية — قائمة تحقق بالأمراض المزمنة (checkbox + ملاحظة لكل حالة)
// تستخدم جدولي health_conditions / patient_health_conditions الموجودين مسبقًا
// في قاعدة البيانات دون أي واجهة — الفجوة كانت في الواجهة فقط، وليست في المخطط.
// ---------------------------------------------------------------------------
function HealthConditionsTab({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const conditions = useQuery({
    queryKey: ["health-conditions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("health_conditions").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as HealthConditionRow[];
    },
  });

  const patientConditions = useQuery({
    queryKey: ["patient-conditions", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_health_conditions")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return (data ?? []) as PatientHealthConditionRow[];
    },
  });

  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (patientConditions.data) {
      const map: Record<string, string> = {};
      for (const row of patientConditions.data) map[row.condition_id] = row.note ?? "";
      setNotes(map);
    }
  }, [patientConditions.data]);

  const checkedIds = new Set((patientConditions.data ?? []).filter((r) => r.is_checked).map((r) => r.condition_id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["patient-conditions", patientId] });

  const toggle = useMutation({
    mutationFn: async ({ conditionId, checked }: { conditionId: string; checked: boolean }) => {
      const { error } = await supabase.from("patient_health_conditions").upsert({
        patient_id: patientId,
        condition_id: conditionId,
        is_checked: checked,
        note: notes[conditionId] ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const saveNote = useMutation({
    mutationFn: async (conditionId: string) => {
      const { error } = await supabase.from("patient_health_conditions").upsert({
        patient_id: patientId,
        condition_id: conditionId,
        is_checked: checkedIds.has(conditionId),
        note: notes[conditionId]?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الحالة الصحية</CardTitle>
        <CardDescription>حدِّد الحالات المزمنة المنطبقة على المريض، مع ملاحظة اختيارية لكل حالة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {conditions.isLoading && <Skeleton className="h-40 w-full" />}
        {!conditions.isLoading && (conditions.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            لائحة الحالات الصحية غير مُهيَّأة بعد — نفّذ ملف هجرة 0028 على قاعدة بياناتك.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(conditions.data ?? []).map((condition) => {
            const isChecked = checkedIds.has(condition.id);
            return (
              <div key={condition.id} className="flex flex-col gap-1.5 rounded-lg border p-2.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={isChecked}
                    onChange={(e) => toggle.mutate({ conditionId: condition.id, checked: e.target.checked })}
                  />
                  {condition.name_ar}
                </label>
                {isChecked && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="ملاحظة (اختياري)"
                    value={notes[condition.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [condition.id]: e.target.value }))}
                    onBlur={() => saveNote.mutate(condition.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// مركز حجوبات المريض — تفعيل/سبب لكل نوع حجب (الحقول موجودة في قاعدة البيانات
// منذ 0002 لكنها كانت تُعرض فقط كشارات للقراءة، بلا أي شاشة للتفعيل)
// ---------------------------------------------------------------------------
const BLOCK_FIELDS: { key: "block_appointments" | "block_invoices" | "block_sms" | "block_file"; reasonKey: "block_appointments_reason" | "block_invoices_reason" | "block_sms_reason" | "block_file_reason"; label: string }[] = [
  { key: "block_appointments", reasonKey: "block_appointments_reason", label: "حجب عن حجز المواعيد" },
  { key: "block_invoices", reasonKey: "block_invoices_reason", label: "حجب عن عمل الفواتير" },
  { key: "block_sms", reasonKey: "block_sms_reason", label: "حجب عن الرسائل النصية" },
  { key: "block_file", reasonKey: "block_file_reason", label: "حجب الملف بالكامل" },
];

function BlockingTab({ patient }: { patient: PatientRow }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(() => {
    const initial: Record<string, string | boolean> = {};
    for (const f of BLOCK_FIELDS) {
      initial[f.key] = patient[f.key];
      initial[f.reasonKey] = patient[f.reasonKey] ?? "";
    }
    return initial;
  });

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const f of BLOCK_FIELDS) {
        patch[f.key] = form[f.key];
        patch[f.reasonKey] = form[f.key] ? (String(form[f.reasonKey] ?? "").trim() || null) : null;
      }
      const { error } = await supabase.from("patients").update(patch).eq("id", patient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم حفظ إعدادات الحجب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>مركز حجوبات المريض</CardTitle>
        <CardDescription>فعّل الحجب المطلوب واكتب السبب — يؤثر فورًا على الاستقبال والفوترة والمراسلة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {BLOCK_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <Label>{f.label}</Label>
              <Button
                type="button"
                size="sm"
                variant={form[f.key] ? "destructive" : "outline"}
                onClick={() => setForm((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              >
                {form[f.key] ? "مفعّل" : "غير مفعّل"}
              </Button>
            </div>
            {Boolean(form[f.key]) && (
              <Input
                placeholder="سبب الحجب"
                value={String(form[f.reasonKey] ?? "")}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.reasonKey]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <Button className="self-start" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" />
          {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AppointmentsTab({ patientId }: { patientId: string }) {
  const appointments = useQuery({
    queryKey: ["patient-appointments", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, scheduled_start, status, doctor:doctors(name_ar)")
        .eq("patient_id", patientId)
        .order("scheduled_start", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل المواعيد</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(appointments.data ?? []).map((appointment: any) => (
          <div key={appointment.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">د. {appointment.doctor?.name_ar ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.scheduled_start).toLocaleString("ar-SA")}
              </p>
            </div>
            <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
          </div>
        ))}
        {(appointments.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مواعيد سابقة.</p>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesTab({ patientId }: { patientId: string }) {
  const invoices = useQuery({
    queryKey: ["patient-invoices", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_number, created_at, status, net_amount, remaining_amount")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل الفواتير</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(invoices.data ?? []).map((invoice: any) => (
          <div key={invoice.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">فاتورة #{invoice.invoice_number}</p>
              <p className="text-xs text-muted-foreground">{new Date(invoice.created_at).toLocaleString("ar-SA")}</p>
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">{Number(invoice.net_amount).toLocaleString("ar-SA")} ر.س</p>
              {Number(invoice.remaining_amount) > 0 && (
                <p className="text-xs text-rose-600">متبقي {Number(invoice.remaining_amount).toLocaleString("ar-SA")}</p>
              )}
            </div>
          </div>
        ))}
        {(invoices.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد فواتير سابقة.</p>
        )}
      </CardContent>
    </Card>
  );
}
