import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { NO_DOCTOR, useSessionDoctor } from "@/lib/session-doctor";
import { ROUTE_LABELS, printPrescription } from "@/lib/prescriptions";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import PatientPicker from "@/components/shared/PatientPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * وصفة طبية جديدة (0221) — للطبيب من ملفّ المريض أو من شاشة الوصفات.
 *
 * الدواء يُختار من كتالوج الأدوية إن وُجد فيه، **أو يُكتب اسمه** (العيادة لا
 * صيدلية فيها). تُرسَل إلى الاستقبال فتظهر في مركز المتابعة بزرّ «طباعة»،
 * وتُطبع بترويسة المجمع. الطبيب الداخل يُصدر باسمه وحده — لا قائمة أطباء.
 */

const CATALOG_NONE = "__typed__";

type Line = {
  key: string;
  drugId: string;
  drugName: string;
  frequency: string;
  durationDays: string;
  quantity: string;
  route: string;
  instructions: string;
};

const emptyLine = (): Line => ({
  key: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  drugId: CATALOG_NONE,
  drugName: "",
  frequency: "",
  durationDays: "",
  quantity: "1",
  route: "oral",
  instructions: "",
});

export default function PrescriptionDialog({
  open,
  onOpenChange,
  organizationId,
  patient: fixedPatient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** من ملفّ المريض: المريض ثابت */
  patient?: { id: string; name_ar: string } | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { branch } = useOrganizationAccess();
  const { doctorId: sessionDoctorId, isDoctorScope } = useSessionDoctor();
  const sessionDoctor = isDoctorScope && sessionDoctorId && sessionDoctorId !== NO_DOCTOR ? sessionDoctorId : null;

  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(fixedPatient ?? null);
  const [doctorId, setDoctorId] = useState("");
  const [notes, setNotes] = useState("");
  const [sendToReception, setSendToReception] = useState(true);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  useEffect(() => {
    if (!open) return;
    setPatient(fixedPatient ?? null);
    setDoctorId(sessionDoctor ?? "");
    setNotes("");
    setSendToReception(true);
    setLines([emptyLine()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doctors = useQuery({
    queryKey: ["prescription-doctors", organizationId, sessionDoctor],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      let q = supabase.from("doctors").select("id, name_ar").eq("organization_id", organizationId!).eq("is_enabled", true);
      // الطبيب الداخل: نفسه وحده
      if (sessionDoctor) q = q.eq("id", sessionDoctor);
      const { data, error } = await q.order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const drugs = useQuery({
    queryKey: ["prescription-drugs", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar")
        .eq("organization_id", organizationId!)
        .eq("item_type", "drug")
        .eq("is_archived", false)
        .order("name_ar")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const validLines = lines.filter((line) => (line.drugId !== CATALOG_NONE ? true : line.drugName.trim().length > 0));

  const issue = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض");
      if (validLines.length === 0) throw new Error("أضف دواءً واحدًا على الأقل");
      const { data, error } = await supabase.rpc("app_issue_prescription", {
        p_organization_id: organizationId,
        p_patient_id: patient.id,
        p_lines: validLines.map((line) => ({
          drug_item_id: line.drugId !== CATALOG_NONE ? line.drugId : null,
          drug_name: line.drugId === CATALOG_NONE ? line.drugName.trim() : null,
          frequency: line.frequency.trim() || null,
          duration_days: line.durationDays ? Number(line.durationDays) : null,
          quantity: Number(line.quantity) || 1,
          route: line.route,
          instructions: line.instructions.trim() || null,
        })),
        p_doctor_id: doctorId || null,
        p_notes: notes.trim() || null,
        p_send_to_reception: sendToReception,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (prescriptionId) => {
      queryClient.invalidateQueries({ queryKey: ["patient-prescriptions-context"] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-queue", organizationId] });
      toast({
        title: "صدرت الوصفة",
        description: sendToReception ? "وصلت إلى الاستقبال للطباعة." : "يمكنك طباعتها من قائمة الوصفات.",
        action: (
          <ToastAction altText="طباعة الوصفة" onClick={() => void printPrescription(prescriptionId)}>
            طباعة
          </ToastAction>
        ),
      });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إصدار الوصفة", description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] w-[min(96vw,760px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>وصفة طبية جديدة</DialogTitle>
          <DialogDescription>
            اختر الدواء من الكتالوج أو اكتب اسمه. تصل الوصفة إلى الاستقبال لتُطبع بترويسة المجمع.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>المريض *</Label>
              {patient ? (
                <div className="flex h-10 items-center justify-between rounded-md border px-3">
                  <span className="font-medium">{patient.name_ar}</span>
                  {!fixedPatient && (
                    <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ) : (
                <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب المعالج</Label>
              <Select value={doctorId} onValueChange={setDoctorId} disabled={Boolean(sessionDoctor)}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الطبيب" />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>الأدوية</Label>
            <Button size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus className="h-4 w-4" />
              دواء آخر
            </Button>
          </div>

          {lines.map((line, index) => (
            <div key={line.key} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="w-5 text-center text-xs font-bold text-muted-foreground">{index + 1}</span>
                {(drugs.data ?? []).length > 0 && (
                  <Select value={line.drugId} onValueChange={(value) => update(line.key, { drugId: value })}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CATALOG_NONE}>اكتب اسم الدواء</SelectItem>
                      {(drugs.data ?? []).map((drug) => (
                        <SelectItem key={drug.id} value={drug.id}>
                          {drug.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {line.drugId === CATALOG_NONE && (
                  <Input
                    className="flex-1"
                    placeholder="اسم الدواء والتركيز، مثل Amoxicillin 500mg"
                    value={line.drugName}
                    onChange={(event) => update(line.key, { drugName: event.target.value })}
                  />
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="ms-auto h-8 w-8"
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  placeholder="الجرعة والتكرار (حبة 3 مرات)"
                  value={line.frequency}
                  onChange={(event) => update(line.key, { frequency: event.target.value })}
                />
                <Input
                  type="number"
                  placeholder="عدد الأيام"
                  value={line.durationDays}
                  onChange={(event) => update(line.key, { durationDays: event.target.value })}
                />
                <Input
                  type="number"
                  placeholder="الكمية"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                />
                <Select value={line.route} onValueChange={(value) => update(line.key, { route: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROUTE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="تعليمات (بعد الأكل، قبل النوم...)"
                value={line.instructions}
                onChange={(event) => update(line.key, { instructions: event.target.value })}
              />
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={sendToReception} onCheckedChange={(v) => setSendToReception(v === true)} />
            أرسلها إلى الاستقبال للطباعة
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={!patient || validLines.length === 0 || issue.isPending} onClick={() => issue.mutate()}>
            {issue.isPending ? "جارٍ الإصدار…" : "إصدار الوصفة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
