import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { GitMerge, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PatientPicker from "@/components/shared/PatientPicker";
import { useToast } from "@/hooks/use-toast";

/**
 * دمج ملف مكرَّر في هذا الملف (0066).
 *
 * الاتجاه مثبَّت عمدًا: **هذا الملف هو الأصل**، والمختار هو المكرَّر الذي
 * يُدمج فيه. عكس الاتجاه في نافذة واحدة كان سيجعل خطأً واحدًا في الاختيار
 * يدفن الملف الصحيح.
 *
 * ولا حذف: المكرَّر يبقى مُعلَّمًا ومشيرًا إلى الأصل، لأن رقم ملفه مكتوب على
 * وصفات ورقية وفواتير مطبوعة.
 */
export default function MergePatientsDialog({
  open,
  onOpenChange,
  primaryPatientId,
  primaryPatientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryPatientId: string;
  primaryPatientName: string;
}) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [duplicate, setDuplicate] = useState<{ id: string; name_ar: string } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");

  /** معاينة ما سيُنقل قبل التنفيذ — الدمج لا رجعة فيه بسهولة. */
  const preview = useQuery({
    queryKey: ["merge-preview", duplicate?.id],
    enabled: Boolean(duplicate?.id),
    queryFn: async () => {
      const [appointments, visits, invoices, documents] = await Promise.all([
        supabase.from("appointments").select("id", { count: "exact", head: true }).eq("patient_id", duplicate!.id),
        supabase.from("patient_visits").select("id", { count: "exact", head: true }).eq("patient_id", duplicate!.id),
        supabase.from("sales_invoices").select("id", { count: "exact", head: true }).eq("patient_id", duplicate!.id),
        supabase.from("patient_documents").select("id", { count: "exact", head: true }).eq("patient_id", duplicate!.id),
      ]);
      /**
       * خطأ أي عدّ يُرمى ولا يُبتلع: `count` تكون `null` عند الفشل فتصير `0`
       * بـ`?? 0`، فتقول اللوحة «0 موعد، 0 زيارة، 0 فاتورة، 0 مستند» قبل عملية
       * لا رجعة فيها — فيمضي الموظف وهو يظن الملف المكرَّر خاليًا.
       */
      for (const result of [appointments, visits, invoices, documents]) {
        if (result.error) throw result.error;
      }
      return {
        appointments: appointments.count ?? 0,
        visits: visits.count ?? 0,
        invoices: invoices.count ?? 0,
        documents: documents.count ?? 0,
      };
    },
  });

  const merge = useMutation({
    mutationFn: async () => {
      if (!duplicate) throw new Error("اختر الملف المكرَّر");
      if (!reason.trim()) throw new Error("سبب الدمج مطلوب");
      if (confirmText.trim() !== "دمج") throw new Error("اكتب كلمة «دمج» للتأكيد");
      const { error } = await supabase.rpc("app_merge_patients", {
        p_primary_patient_id: primaryPatientId,
        p_duplicate_patient_id: duplicate.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "تم الدمج", description: "نُقل كل ما كان مرتبطًا بالملف المكرَّر إلى هذا الملف." });
      setDuplicate(null);
      setReason("");
      setConfirmText("");
      onOpenChange(false);
      navigate(`/patients/${primaryPatientId}`);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الدمج",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            دمج ملف مكرَّر
          </DialogTitle>
          <DialogDescription>
            كل ما يرتبط بالملف المكرَّر — مواعيد، زيارات، فواتير، مستندات، وصفات، طلبات —
            ينتقل إلى <strong>{primaryPatientName}</strong>. والملف المكرَّر يبقى مُعلَّمًا لا
            محذوفًا، لأن رقمه مكتوب على مستندات ورقية سابقة.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الملف المكرَّر (سيُدمج في هذا الملف)</Label>
            {duplicate ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{duplicate.name_ar}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setDuplicate(null)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <PatientPicker
                onSelect={(selected) => {
                  if (selected.id === primaryPatientId) {
                    toast({ variant: "destructive", title: "لا يمكن دمج الملف في نفسه" });
                    return;
                  }
                  setDuplicate({ id: selected.id, name_ar: selected.name_ar });
                }}
              />
            )}
          </div>

          {duplicate && preview.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                تعذّر حساب المعاينة:{" "}
                {preview.error instanceof Error ? preview.error.message : "خطأ غير متوقع"} — لا
                تعتمد على أرقام غائبة قبل الدمج.
              </span>
            </div>
          )}

          {duplicate && preview.data && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="mb-1 font-medium">سيُنقل من الملف المكرَّر:</div>
              <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                <span>{preview.data.appointments} موعد</span>
                <span>{preview.data.visits} زيارة</span>
                <span>{preview.data.invoices} فاتورة</span>
                <span>{preview.data.documents} مستند</span>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50/60 p-3 text-xs text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              الدمج لا يُعكس من هذه الشاشة. راجع أن الملفين لنفس الشخص فعلًا — الهوية
              والجوال وتاريخ الميلاد — قبل المتابعة.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>سبب الدمج *</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="مثال: نفس رقم الهوية ونفس الجوال — فُتح ملف ثانٍ بالخطأ"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>اكتب «دمج» للتأكيد *</Label>
            <input
              className="h-9 rounded-md border px-3 text-sm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            variant="destructive"
            disabled={merge.isPending || !duplicate || !reason.trim() || confirmText.trim() !== "دمج"}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? "جارٍ الدمج..." : "تنفيذ الدمج"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
