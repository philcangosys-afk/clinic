import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { GENERAL_MEASURES, VITAL_MEASURES } from "@/components/medical/VitalSignsForm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * طلب قياس المؤشرات الحيوية من ملف المريض.
 *
 * يستعمله الاستقبال ليصل المريض إلى الطبيب مقيسًا، ويستعمله الطبيب حين ينسى
 * الاستقبال. الزرّ واحد لكليهما لأن الفعل واحد — والقاعدة تعرف من طلب.
 *
 * **عام** = الستة المعتادة، تُقرأ من نفس القائمة التي تحرسها القاعدة.
 * **خاص** = اختيار صريح، ويشمل السكر لأنه قرارٌ يُتخذ لا افتراضٌ يُمرَّر.
 */
export default function RequestVitalsDialog({
  patientId,
  defaultDoctorId,
  trigger,
}: {
  patientId: string;
  defaultDoctorId?: string | null;
  trigger?: React.ReactNode;
}) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"general" | "custom">("general");
  const [picked, setPicked] = useState<string[]>([]);
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? "");
  const [priority, setPriority] = useState("routine");
  const [note, setNote] = useState("");

  const doctors = useQuery({
    queryKey: ["req-vitals-doctors", organization?.id],
    enabled: Boolean(organization?.id) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const canSend = useMemo(
    () => Boolean(organization?.id) && (kind === "general" || picked.length > 0),
    [organization?.id, kind, picked.length],
  );

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_request_vital_signs", {
        p_organization_id: organization!.id,
        p_patient_id: patientId,
        p_doctor_id: doctorId || null,
        p_request_kind: kind,
        p_measures: kind === "custom" ? picked : null,
        p_priority: priority,
        p_note: note.trim() || null,
        p_visit_id: null,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({
        title: "أُرسل الطلب",
        description: "يظهر الآن في طابور المؤشرات الحيوية.",
      });
      setOpen(false);
      setPicked([]);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["vitals-queue"] });
      queryClient.invalidateQueries({ queryKey: ["patient-vitals"] });
    },
    onError: (err: any) =>
      toast({
        title: "تعذّر الطلب",
        description: err?.message ?? "خطأ غير معروف",
        variant: "destructive",
      }),
  });

  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Activity className="h-4 w-4" />
            طلب مؤشرات حيوية
          </Button>
        )}
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg text-start">
        <DialogHeader>
          <DialogTitle>طلب قياس المؤشرات الحيوية</DialogTitle>
          <DialogDescription>
            يظهر الطلب في طابور القياس، وحين يُسجَّل يصل الطبيب المختار تلقائيًّا.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("general")}
              className={cn(
                "rounded-lg border-2 p-3 text-start transition",
                kind === "general" ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span className="block font-bold">عام</span>
              <span className="block text-xs text-muted-foreground">
                الستة المعتادة: ضغط، نبض، حرارة، تنفس، وزن، طول
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("custom")}
              className={cn(
                "rounded-lg border-2 p-3 text-start transition",
                kind === "custom" ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span className="block font-bold">خاص</span>
              <span className="block text-xs text-muted-foreground">
                تختار أنت ما يُقاس
              </span>
            </button>
          </div>

          {kind === "custom" && (
            <div className="flex flex-col gap-1.5">
              <Label>القياسات المطلوبة</Label>
              <div className="flex flex-wrap gap-2">
                {VITAL_MEASURES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggle(m.key)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      picked.includes(m.key)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {picked.length === 0 && (
                <span className="text-xs text-muted-foreground">اختر قياسًا واحدًا على الأقل.</span>
              )}
            </div>
          )}

          {kind === "general" && (
            <p className="flex flex-wrap gap-1.5">
              {VITAL_MEASURES.filter((m) => GENERAL_MEASURES.includes(m.key as any)).map((m) => (
                <span key={m.key} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {m.label}
                </span>
              ))}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rv-doctor">يعود إلى الطبيب</Label>
              <select
                id="rv-doctor"
                dir="rtl"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— بلا طبيب —</option>
                {(doctors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rv-prio">الأولوية</Label>
              <select
                id="rv-prio"
                dir="rtl"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="routine">عادي</option>
                <option value="urgent">عاجل</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rv-note">ملاحظة (اختياري)</Label>
            <Textarea
              id="rv-note"
              dir="rtl"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: قبل دخول الطبيب — المريض يشكو دوارًا"
            />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            إرسال الطلب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
