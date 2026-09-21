import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Pencil } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { WarehouseRow, ZatcaCompanyRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import {
  WAREHOUSE_PURPOSE_LABELS,
  type WarehousePurpose,
} from "@/components/purchasing/purchase-purpose";

/**
 * إدارة المستودعات (لقطة 67 من النظام القديم).
 *
 * جدول `warehouses` موجود منذ المخطط الأساسي (0001) بكل حقوله — كود، اسم،
 * ملاحظة، ربط شركة زاتكا — لكنه بقي طوال المشروع يُقرأ فقط عبر قوائم
 * الاختيار في شاشات المشتريات والمخزون، بلا أي واجهة لإنشاء مستودع أو
 * تعديله. أي أن المستودعات كان لا بد من إدخالها يدويًا في قاعدة البيانات.
 * هذه الشاشة تسدّ تلك الفجوة.
 */
const NO_ZATCA = "__none__";

function useWarehouses(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["warehouses-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("*")
        .eq("organization_id", organizationId)
        .order("code");
      if (error) throw error;
      return (data ?? []) as WarehouseRow[];
    },
  });
}

function useZatcaCompanies(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["zatca-companies", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zatca_companies")
        .select("id, organization_id, name, vat_number, environment, created_at")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ZatcaCompanyRow[];
    },
  });
}

function WarehouseFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: WarehouseRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const zatca = useZatcaCompanies(organizationId);
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [zatcaId, setZatcaId] = useState(initial?.zatca_company_id ?? NO_ZATCA);
  const [purpose, setPurpose] = useState<WarehousePurpose>(initial?.purpose ?? "general");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!code.trim()) throw new Error("كود المستودع مطلوب");
      if (!name.trim()) throw new Error("اسم المستودع مطلوب");
      const payload = {
        organization_id: organizationId,
        code: code.trim(),
        name: name.trim(),
        note: note.trim() || null,
        zatca_company_id: zatcaId === NO_ZATCA ? null : zatcaId,
        purpose,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("warehouses").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("warehouses").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses-admin"] });
      // مفاتيح المستهلكين الفعلية — المفتاح السابق ["warehouses"] لا يطابق
      // أيًّا منها (react-query يطابق البادئة عنصرًا بعنصر)، فكان مستودع
      // جديد لا يظهر في المشتريات ولا المخزون حتى إعادة تحميل الصفحة.
      queryClient.invalidateQueries({ queryKey: ["warehouses-list"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses-for-clinics"] });
      queryClient.invalidateQueries({ queryKey: ["pc-warehouses"] });
      toast({ title: initial ? "تم تحديث المستودع" : "تمت إضافة المستودع" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description:
          /duplicate|unique/i.test(errorMessage(error))
            ? "كود المستودع مستخدم بالفعل — اختر كودًا مختلفًا"
            : errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل المستودع" : "مستودع جديد"}</DialogTitle>
          <DialogDescription>
            المستودعات تُستخدم في فواتير الشراء والمناقلات وحركات المخزون
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>الكود *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-01" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="المستودع الرئيسي" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>نوع المستودع</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as WarehousePurpose)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(WAREHOUSE_PURPOSE_LABELS) as WarehousePurpose[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {WAREHOUSE_PURPOSE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              المخصّص لجهةٍ يقبل مشترياتها وحدها: أدوية الصيدلية لا تدخل مستودعًا إداريًّا. والعامّ يقبل الكلّ.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>شركة زاتكا المرتبطة</Label>
            <Select value={zatcaId ?? NO_ZATCA} onValueChange={setZatcaId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون ربط" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ZATCA}>بدون ربط</SelectItem>
                {(zatca.data ?? []).map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name} — {company.vat_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Warehouses() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const warehouses = useWarehouses(organization?.id);
  const zatca = useZatcaCompanies(organization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: async (row: WarehouseRow) => {
      const { data: affectedRows, error } = await supabase
        .from("warehouses")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses-admin"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses-list"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses-for-clinics"] });
      queryClient.invalidateQueries({ queryKey: ["pc-warehouses"] });
      toast({ title: "تم تحديث حالة المستودع" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const zatcaName = (id: string | null) =>
    id ? ((zatca.data ?? []).find((c) => c.id === id)?.name ?? "—") : "—";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المستودعات</h1>
          <p className="text-sm text-muted-foreground">
            إدارة مستودعات المنشأة المستخدمة في الشراء والمخزون والمناقلات
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          مستودع جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            قائمة المستودعات
          </CardTitle>
          <CardDescription>
            تعطيل المستودع يُخفيه من قوائم الاختيار في الشاشات الأخرى دون حذف حركاته السابقة
          </CardDescription>
        </CardHeader>
        <CardContent>
          {warehouses.isLoading && <Skeleton className="h-40 w-full" />}
          {!warehouses.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>شركة زاتكا</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-32">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(warehouses.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-xs">{WAREHOUSE_PURPOSE_LABELS[row.purpose] ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {zatcaName(row.zatca_company_id)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_disabled ? "secondary" : "success"}>
                        {row.is_disabled ? "معطّل" : "نشط"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(row);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleDisabled.mutate(row)}>
                          {row.is_disabled ? "تفعيل" : "تعطيل"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(warehouses.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد مستودعات بعد — أضف المستودع الأول لتتمكن من تسجيل المشتريات وحركات المخزون.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <WarehouseFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
    </div>
  );
}
