import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PatientRow } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
          {patient.data.block_appointments && <Badge variant="destructive">محجوب عن المواعيد</Badge>}
          {patient.data.block_invoices && <Badge variant="destructive">محجوب عن الفوترة</Badge>}
          {patient.data.block_sms && <Badge variant="secondary">محجوب عن SMS</Badge>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="history">السوابق الصحية</TabsTrigger>
          <TabsTrigger value="notes">الملاحظات</TabsTrigger>
          <TabsTrigger value="appointments">المواعيد</TabsTrigger>
          <TabsTrigger value="invoices">الفواتير</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab patient={patient.data} />
        </TabsContent>
        <TabsContent value="history">
          <MedicalHistoryTab patientId={patient.data.id} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patientId={patient.data.id} />
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
    id_number: patient.id_number ?? "",
    insurance_company_name: patient.insurance_company_name ?? "",
    insurance_policy_number: patient.insurance_policy_number ?? "",
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
          id_number: form.id_number.trim() || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
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
      return data ?? [];
    },
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("patient_notes").insert({ patient_id: patientId, body: newNote.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewNote("");
      queryClient.invalidateQueries({ queryKey: ["patient-notes", patientId] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الملاحظات</CardTitle>
        <CardDescription>سجل زمني للملاحظات والمتابعة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="أضف ملاحظة جديدة..." />
          <Button disabled={!newNote.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {(notes.data ?? []).map((note) => (
            <div key={note.id} className="rounded-lg border px-3 py-2">
              <p className="text-sm">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleString("ar-SA")}
              </p>
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
