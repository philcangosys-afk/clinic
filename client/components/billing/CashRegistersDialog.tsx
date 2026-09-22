import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import type { CashRegisterRow } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * الصناديق: إضافتها وتعطيلها — من «الحسابات» ومن «الفوترة ← الصناديق» معًا.
 *
 * كانت النافذة في شاشة الحسابات وحدها، فمن يدير المناوبات في الفوترة لا يجد
 * أين يُنشئ صندوقه الحقيقي — ويبقى الصندوق التجريبي هو الوحيد في القائمة.
 * لا حذف: الصندوق الذي قُبض عليه يُعطَّل فيخرج من الاختيار ويبقى أثره.
 */
export default function CashRegistersDialog({
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
  const [name, setName] = useState("");
  const [isDoctorCustody, setIsDoctorCustody] = useState(false);
  const [assignedDoctorId, setAssignedDoctorId] = useState("");

  // قائمة الإدارة (بالمعطّل) بمفتاحها الخاص: مفتاح «cash-registers» تقرؤه
  // قوائم الاختيار بالنشط وحده، ومشاركته كانت تُدخل المعطّل في الاختيار.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cash-registers-admin", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["cash-registers", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["cash-registers-select", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["cash-shifts", organizationId] });
  };

  const registers = useQuery({
    queryKey: ["cash-registers-admin", organizationId],
    enabled: Boolean(organizationId) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("*, doctor:doctors(name_ar)")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const doctors = useQuery({
    queryKey: ["doctors-select-registers", organizationId],
    enabled: Boolean(organizationId) && open && isDoctorCustody,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const addRegister = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("cash_registers").insert({
        organization_id: organizationId,
        name: name.trim(),
        is_doctor_custody: isDoctorCustody,
        assigned_doctor_id: isDoctorCustody ? assignedDoctorId || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُضيف الصندوق — افتح عليه مناوبة قبل القبض النقدي" });
      setName("");
      setIsDoctorCustody(false);
      setAssignedDoctorId("");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّرت إضافة الصندوق", description: errorMessage(error) }),
  });

  const toggleDisabled = useMutation({
    mutationFn: async (register: CashRegisterRow) => {
      const { data: affectedRows, error } = await supabase
        .from("cash_registers")
        .update({ is_disabled: !register.is_disabled })
        .eq("id", register.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير حالة الصندوق", description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>صناديق البيع والعهدة</DialogTitle>
          <DialogDescription>مثل "صندوق المجمع" أو "عهدة الدكتور" — تُختار عند تسجيل أي سند</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الصندوق</Label>
            <Input className="w-40" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDoctorCustody} onChange={(e) => setIsDoctorCustody(e.target.checked)} />
            عهدة طبيب
          </label>
          {isDoctorCustody && (
            <Select value={assignedDoctorId} onValueChange={setAssignedDoctorId}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="الطبيب" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    د. {d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" disabled={!name.trim() || addRegister.isPending} onClick={() => addRegister.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(registers.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.is_doctor_custody ? `عهدة د. ${r.doctor?.name_ar ?? "—"}` : "صندوق عام"}</TableCell>
                <TableCell>
                  <Badge variant={r.is_disabled ? "secondary" : "success"}>{r.is_disabled ? "معطّل" : "نشط"}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(r)}>
                    {r.is_disabled ? "تفعيل" : "تعطيل"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(registers.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد صناديق بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
