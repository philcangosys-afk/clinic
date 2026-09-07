import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * جهات الاتصال والمرافقون (0066).
 *
 * كان في ملف المريض رقم طوارئ واحد في عمود نصّي بلا اسم ولا صلة قرابة ولا
 * تفويض. فمن يُتصل به حين يُغمى على مريض؟ ومن يحقّ له استلام نتيجة تحليله؟
 *
 * **التفويض قرار قانوني لا تفصيل اجتماعي**، وافتراضه «لا»: الأصل في المعلومة
 * الطبية السرّية، فمن يستلمها يُسمَّى صراحةً.
 */

type ContactRow = {
  id: string;
  full_name: string;
  relation: string | null;
  mobile_number: string | null;
  is_emergency_contact: boolean;
  authorized_to_receive: boolean;
  companion_type: "primary" | "temporary";
  note: string | null;
};

const COMPANION_LABELS: Record<ContactRow["companion_type"], string> = {
  primary: "مرافق أساسي",
  temporary: "مرافق مؤقت",
};

export default function PatientContactsTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const contacts = useQuery({
    queryKey: ["patient-contacts", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_contacts")
        .select("id, full_name, relation, mobile_number, is_emergency_contact, authorized_to_receive, companion_type, note")
        .eq("patient_id", patientId)
        .order("is_emergency_contact", { ascending: false })
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ContactRow[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("patient_contacts")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // الحذف الذي لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يُحذف شيء.
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-contacts", patientId] });
      toast({ title: "تم الحذف" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحذف",
        description: errorMessage(error),
      }),
  });

  const rows = contacts.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            جهات الاتصال والمرافقون
          </CardTitle>
          <CardDescription>
            من يُتصل به في الطوارئ، ومن يحقّ له استلام نتائج المريض.
          </CardDescription>
        </div>
        {can("patients.update") && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {contacts.isLoading && <Skeleton className="h-24 w-full" />}
        {!contacts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>صلة القرابة</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الصفة</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.full_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.relation ?? "—"}</TableCell>
                  <TableCell className="text-sm" dir="ltr">
                    {row.mobile_number ? (
                      <a className="flex items-center gap-1 hover:text-primary" href={`tel:${row.mobile_number}`}>
                        <Phone className="h-3.5 w-3.5" />
                        {row.mobile_number}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{COMPANION_LABELS[row.companion_type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.is_emergency_contact && <Badge variant="destructive">طوارئ</Badge>}
                      {row.authorized_to_receive && (
                        <Badge variant="success" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          مخوَّل بالاستلام
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {can("patients.update") && (
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا جهات اتصال مسجَّلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AddContactDialog
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        organizationId={organization?.id}
      />
    </Card>
  );
}

function AddContactDialog({
  open,
  onOpenChange,
  patientId,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [fullName, setFullName] = useState("");
  const [relation, setRelation] = useState("");
  const [mobile, setMobile] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [companionType, setCompanionType] = useState<ContactRow["companion_type"]>("temporary");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!fullName.trim()) throw new Error("الاسم مطلوب");
      if (isEmergency && !mobile.trim()) {
        throw new Error("جهة الطوارئ بلا رقم لا تنفع وقت الحاجة — أدخل رقم الجوال");
      }
      const { error } = await supabase.from("patient_contacts").insert({
        organization_id: organizationId,
        patient_id: patientId,
        full_name: fullName.trim(),
        relation: relation.trim() || null,
        mobile_number: mobile.trim() || null,
        is_emergency_contact: isEmergency,
        authorized_to_receive: authorized,
        companion_type: companionType,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-contacts", patientId] });
      toast({ title: "تمت الإضافة" });
      setFullName("");
      setRelation("");
      setMobile("");
      setIsEmergency(false);
      setAuthorized(false);
      setCompanionType("temporary");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّرت الإضافة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة جهة اتصال</DialogTitle>
          <DialogDescription>
            التخويل بالاستلام يعني أن هذا الشخص يستطيع أخذ نتائج المريض وتقاريره — فلا
            يُمنح إلا بطلب المريض.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>صلة القرابة</Label>
              <Input value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="أب، أخ، زوجة..." />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم الجوال</Label>
              <Input value={mobile} onChange={(event) => setMobile(event.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع المرافقة</Label>
            <Select value={companionType} onValueChange={(value) => setCompanionType(value as ContactRow["companion_type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COMPANION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isEmergency} onChange={(event) => setIsEmergency(event.target.checked)} />
            جهة اتصال للطوارئ
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
            مخوَّل باستلام معلومات المريض
          </label>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={create.isPending || !fullName.trim()} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
