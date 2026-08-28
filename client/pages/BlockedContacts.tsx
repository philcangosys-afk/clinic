import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldBan, Plus, Trash2, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * الملفات الخارجية المحجوبة (المستوى الأول من لقطة 42).
 *
 * جدول `blocked_external_contacts` موجود منذ 0002 بلا أي واجهة. الفرق عن
 * تبويب "الحجب" في ملف المريض: ذاك يحجب مريضًا **له ملف بالفعل**، وهذا يمنع
 * فتح ملف جديد لشخص محجوب من الأساس — يُطابَق بالجوال أو الهوية أو الاسم
 * عند إنشاء المريض.
 */
type BlockedContactRow = {
  id: string;
  organization_id: string;
  full_name: string | null;
  mobile_number: string | null;
  phone_number: string | null;
  id_number: string | null;
  reason: string | null;
  created_at: string;
};

function useBlockedContacts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["blocked-contacts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blocked_external_contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BlockedContactRow[];
    },
  });
}

function BlockedContactDialog({
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
  const { session } = useOrganizationAccess();
  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      // كل الحقول اختيارية في الجدول، لكن سجلًا بلا أي معرّف لا يمكن مطابقته
      // بأي شيء — فيصبح صفًا ميتًا يوهم المستخدم بأن الحجب مفعَّل.
      if (!fullName.trim() && !mobileNumber.trim() && !idNumber.trim())
        throw new Error("أدخل الاسم أو رقم الجوال أو رقم الهوية على الأقل");
      const { error } = await supabase.from("blocked_external_contacts").insert({
        organization_id: organizationId,
        full_name: fullName.trim() || null,
        mobile_number: mobileNumber.trim() || null,
        phone_number: phoneNumber.trim() || null,
        id_number: idNumber.trim() || null,
        reason: reason.trim() || null,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-contacts"] });
      toast({ title: "تمت إضافة الجهة المحجوبة" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>حجب جهة خارجية</DialogTitle>
          <DialogDescription>
            يُنبَّه الموظف عند محاولة فتح ملف يطابق أيًا من هذه البيانات
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الجوال</Label>
            <Input value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهاتف</Label>
            <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهوية</Label>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب الحجب</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حجب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BlockedContacts() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const contacts = useBlockedContacts(organization?.id);
  const [formOpen, setFormOpen] = useState(false);

  const removeContact = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("blocked_external_contacts").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-contacts"] });
      toast({ title: "تم رفع الحجب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الجهات المحجوبة</h1>
          <p className="text-sm text-muted-foreground">
            أشخاص يُمنع فتح ملف جديد لهم — يختلف عن حجب مريض له ملف بالفعل
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" />
          حجب جهة
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          عند إنشاء مريض جديد بجوال أو هوية مطابقة لأحد هذه السجلات يظهر تنبيه للموظف مع سبب الحجب.
          التنبيه لا يمنع الإنشاء نهائيًا — القرار يبقى للموظف حسب سياسة المنشأة.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldBan className="h-4 w-4" />
            القائمة
          </CardTitle>
          <CardDescription>رفع الحجب يحذف السجل نهائيًا</CardDescription>
        </CardHeader>
        <CardContent>
          {contacts.isLoading && <Skeleton className="h-32 w-full" />}
          {!contacts.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead>الهوية</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>تاريخ الحجب</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contacts.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.full_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.mobile_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.phone_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.id_number ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => removeContact.mutate(row.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(contacts.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد جهات محجوبة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <BlockedContactDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
        />
      )}
    </div>
  );
}
