import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Pencil, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const RESOURCE_TYPES: Record<string, string> = {
  room: "غرفة",
  chair: "كرسي",
  bed: "سرير",
  device: "جهاز",
  equipment: "معدّة",
  other: "أخرى",
};

const EMPTY = {
  id: "",
  resource_type: "room",
  name_ar: "",
  name_en: "",
  code: "",
  branch_id: "",
  clinic_id: "",
  capacity: "1",
  is_active: true,
  note: "",
};

/**
 * الموارد — غرف وأجهزة وأسرّة.
 *
 * ربط الخدمة بمورد ليس توثيقًا: مورد مطلوب غير متاح في فرع **يمنع** تقديم
 * الخدمة فيه، وهو ما تفحصه `app_check_service_eligibility` في القاعدة.
 */
export default function Resources() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const organizationId = organization?.id;
  const canManage = can("catalog.manage");
  const [editing, setEditing] = useState<any | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const rows = useQuery({
    queryKey: ["resources-page", organizationId, typeFilter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("resources")
        .select(
          "id, resource_type, code, name_ar, name_en, capacity, is_active, note, branch_id, clinic_id, branch:branches(name), clinic:clinics(name)",
        )
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (typeFilter !== "all") query = query.eq("resource_type", typeFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const one = (value: any) => (Array.isArray(value) ? value[0] : value);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الموارد</h1>
          <p className="text-sm text-muted-foreground">
            الغرف والأجهزة والأسرّة التي تعتمد عليها الخدمات
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4" />
            مورد جديد
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {Object.entries(RESOURCE_TYPES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {rows.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {rows.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر التحميل: {(rows.error as Error)?.message}
            </p>
          )}
          {!rows.isLoading && !rows.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>السعة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-muted-foreground" />
                        {row.name_ar}
                      </span>
                    </TableCell>
                    <TableCell>{RESOURCE_TYPES[row.resource_type] ?? row.resource_type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {one(row.branch)?.name ?? "كل الفروع"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {one(row.clinic)?.name ?? "—"}
                    </TableCell>
                    <TableCell>{row.capacity}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "success" : "secondary"}>
                        {row.is_active ? "متاح" : "معطَّل"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditing({
                              id: row.id,
                              resource_type: row.resource_type,
                              name_ar: row.name_ar ?? "",
                              name_en: row.name_en ?? "",
                              code: row.code ?? "",
                              branch_id: row.branch_id ?? "",
                              clinic_id: row.clinic_id ?? "",
                              capacity: String(row.capacity ?? 1),
                              is_active: row.is_active,
                              note: row.note ?? "",
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(rows.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد موارد مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ResourceDialog
        draft={editing}
        organizationId={organizationId}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function ResourceDialog({
  draft,
  organizationId,
  onClose,
}: {
  draft: any | null;
  organizationId: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<any>(EMPTY);
  const [ready, setReady] = useState<string | null>(null);

  // مزامنة النموذج مع الصف المختار دون useEffect: المقارنة بالمعرّف تكفي،
  // وتفادي دورة إضافية من إعادة الرسم أوضح من مزامنة بأثر جانبي.
  const key = draft ? `${draft.id}` : null;
  if (draft && key !== ready) {
    setForm({ ...draft });
    setReady(key);
  }

  const branches = useQuery({
    queryKey: ["resource-branches", organizationId],
    enabled: Boolean(draft) && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const clinics = useQuery({
    queryKey: ["resource-clinics", organizationId],
    enabled: Boolean(draft) && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!String(form.name_ar).trim()) throw new Error("الاسم مطلوب");
      const capacity = Number(form.capacity);
      if (!Number.isInteger(capacity) || capacity < 1) throw new Error("السعة يجب أن تكون عددًا ١ فأكثر");

      const payload = {
        organization_id: organizationId,
        resource_type: form.resource_type,
        name_ar: String(form.name_ar).trim(),
        name_en: String(form.name_en ?? "").trim() || null,
        code: String(form.code ?? "").trim() || null,
        branch_id: form.branch_id || null,
        clinic_id: form.clinic_id || null,
        capacity,
        is_active: Boolean(form.is_active),
        note: String(form.note ?? "").trim() || null,
      };

      if (form.id) {
        const { data, error } = await supabase
          .from("resources")
          .update(payload)
          .eq("id", form.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحدَّث شيء — تحقّق من صلاحيتك");
      } else {
        const { error } = await supabase.from("resources").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources-page"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-resources"] });
      toast({ title: form.id ? "حُفظت التعديلات" : "أُضيف المورد" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "تعديل المورد" : "مورد جديد"}</DialogTitle>
          <DialogDescription>
            المورد بلا فرع يُعدّ متاحًا في كل الفروع.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الاسم *</Label>
              <Input value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الاسم بالإنجليزية</Label>
              <Input value={form.name_en} dir="ltr" onChange={(e) => set("name_en", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>النوع</Label>
              <Select value={form.resource_type} onValueChange={(v) => set("resource_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RESOURCE_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الكود</Label>
              <Input value={form.code} dir="ltr" onChange={(e) => set("code", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الفرع</Label>
              <Select
                value={form.branch_id || "none"}
                onValueChange={(v) => set("branch_id", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">كل الفروع</SelectItem>
                  {(branches.data ?? []).map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select
                value={form.clinic_id || "none"}
                onValueChange={(v) => set("clinic_id", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تخصيص</SelectItem>
                  {(clinics.data ?? []).map((clinic: any) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السعة</Label>
              <Input
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(form.is_active)} onCheckedChange={(v) => set("is_active", v)} />
            متاح للاستخدام
          </label>
          <p className="text-xs text-muted-foreground">
            تعطيل المورد يمنع الخدمات التي تشترطه — راجع الخدمات المرتبطة قبل تعطيله.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={save.isPending || !String(form.name_ar).trim()} onClick={() => save.mutate()}>
            {save.isPending ? "..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
