import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Lock, Plus, Upload } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";

/**
 * القواميس المرجعية — المرحلة السادسة.
 *
 * `lookup_categories` و`lookup_values` قائمان منذ 0001 ويميّزان أصلًا بين
 * **القاموس النظامي** (`organization_id is null`) و**قاموس المنشأة**. هذه
 * الشاشة تُظهر التمييز وتفرضه: النظامي يُقرأ ولا يُعدَّل من التطبيق — وهو
 * ليس تقييدًا شكليًا، فقاموسٌ نظامي تعدّله منشأةٌ تراه كل المنشآت.
 *
 * وبعض القواميس مرتبطة بقيود قاعدة (أنواع العينات، أجهزة التصوير): مفاتيحها
 * مطابقة للقيد حرفيًا، فتغييرها يكسر إدخال الفحوص. لذلك تظهر بقفل صريح.
 */

/** قواميس مفاتيحها مقيَّدة في القاعدة — تُعرض ولا تُحرَّر. */
const CONSTRAINED = new Set(["specimen_types", "imaging_modalities"]);

export default function DictionariesTab({ readOnly }: { readOnly: boolean }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organizationId = organization?.id;

  const [categoryId, setCategoryId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const categories = useQuery({
    queryKey: ["reference-categories", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_categories")
        .select("id, key, name_ar, name_en, organization_id, is_system, value_count, active_count")
        .order("is_system", { ascending: false })
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const selected = useMemo(
    () => (categories.data ?? []).find((row) => row.id === categoryId),
    [categories.data, categoryId],
  );

  const values = useQuery({
    queryKey: ["reference-values", categoryId, showDisabled],
    enabled: Boolean(categoryId),
    queryFn: async () => {
      let query = supabase
        .from("lookup_values")
        .select("id, code, name_ar, name_en, sort_order, is_disabled, parent_value_id")
        .eq("category_id", categoryId)
        .order("sort_order")
        .order("name_ar");
      if (!showDisabled) query = query.eq("is_disabled", false);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim();
    if (!term) return values.data ?? [];
    return (values.data ?? []).filter(
      (row) =>
        String(row.name_ar ?? "").includes(term) ||
        String(row.name_en ?? "").toLowerCase().includes(term.toLowerCase()) ||
        String(row.code ?? "").toLowerCase().includes(term.toLowerCase()),
    );
  }, [values.data, search]);

  // النظامي لا يُعدَّل من التطبيق، والمقيَّد لا تُغيَّر مفاتيحه.
  const isSystem = Boolean(selected?.is_system);
  const isConstrained = CONSTRAINED.has(selected?.key ?? "");
  const canEdit = !readOnly && !isSystem;

  const save = useMutation({
    mutationFn: async (row: any) => {
      if (!row.name_ar?.trim()) throw new Error("الاسم العربي مطلوب");
      const payload = {
        category_id: categoryId,
        code: String(row.code ?? "").trim() || null,
        name_ar: String(row.name_ar).trim(),
        name_en: String(row.name_en ?? "").trim() || null,
        sort_order: Number(row.sort_order) || 0,
        is_disabled: Boolean(row.is_disabled),
      };
      if (row.id) {
        const { data, error } = await supabase
          .from("lookup_values")
          .update(payload)
          .eq("id", row.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحدَّث شيء — تحقّق من صلاحيتك");
      } else {
        const { error } = await supabase.from("lookup_values").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reference-values", categoryId] });
      queryClient.invalidateQueries({ queryKey: ["reference-categories"] });
      queryClient.invalidateQueries({ queryKey: ["lookup-values"] });
      toast({ title: "حُفظت القيمة" });
      setEditing(null);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  /** التعطيل لا الحذف: قيمةٌ استُعملت في سجلات قديمة لا تُمحى. */
  const toggle = useMutation({
    mutationFn: async (row: any) => {
      const { data, error } = await supabase
        .from("lookup_values")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحدَّث شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reference-values", categoryId] });
      queryClient.invalidateQueries({ queryKey: ["reference-categories"] });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التعديل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const exportCsv = () => {
    const headers = ["الكود", "الاسم", "الاسم بالإنجليزي", "الترتيب", "الحالة"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...filtered.map((row) =>
        [row.code, row.name_ar, row.name_en, row.sort_order, row.is_disabled ? "معطّل" : "نشط"]
          .map(escape)
          .join(","),
      ),
    ];
    // BOM كي تفتح Excel العربية بترميز صحيح.
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected?.key ?? "lookup"}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const IMPORT_COLUMNS: CsvColumn[] = [
    { key: "name_ar", header: "الاسم", required: true },
    { key: "name_en", header: "الاسم بالإنجليزي" },
    { key: "code", header: "الكود" },
    {
      key: "sort_order",
      header: "الترتيب",
      parse: (raw) => {
        const term = raw.trim();
        if (!term) return 0;
        const value = Number(term);
        if (!Number.isInteger(value)) throw new Error("الترتيب يجب أن يكون عددًا صحيحًا");
        return value;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-72">
              <div className="flex flex-col gap-1.5">
                <Label>القاموس</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر قاموسًا" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories.data ?? []).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name_ar}
                        {category.is_system ? " — نظامي" : ""}
                        {` (${category.active_count})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث..."
              className="max-w-xs"
            />
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={showDisabled} onCheckedChange={setShowDisabled} />
              عرض المعطَّل
            </label>
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" />
              تصدير
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" />
                  استيراد
                </Button>
                <Button onClick={() => setEditing({ sort_order: 0 })}>
                  <Plus className="h-4 w-4" />
                  قيمة جديدة
                </Button>
              </>
            )}
          </div>

          {selected && (
            <CardDescription className="flex flex-wrap items-center gap-2 pt-2">
              <span className="font-mono text-xs">{selected.key}</span>
              {isSystem && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" />
                  قاموس نظامي — يُقرأ ولا يُعدَّل
                </Badge>
              )}
              {isConstrained && (
                <Badge variant="outline">
                  مفاتيحه مقيَّدة في القاعدة — تغييرها يكسر إدخال الفحوص
                </Badge>
              )}
              <span>
                {selected.active_count} نشط من {selected.value_count}
              </span>
            </CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {!categoryId && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              اختر قاموسًا لعرض قيمه. القواميس النظامية مشتركة بين كل المنشآت.
            </p>
          )}
          {categoryId && values.isLoading && <Skeleton className="h-32 w-full" />}
          {categoryId && !values.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>بالإنجليزية</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id} className={row.is_disabled ? "text-muted-foreground" : ""}>
                    <TableCell className="font-mono text-xs">{row.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{row.name_ar}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">
                      {row.name_en ?? "—"}
                    </TableCell>
                    <TableCell>{row.sort_order}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_disabled ? "secondary" : "success"}>
                        {row.is_disabled ? "معطَّل" : "نشط"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                            تعديل
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggle.mutate(row)}>
                            {row.is_disabled ? "تفعيل" : "تعطيل"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا قيم مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ValueDialog
        row={editing}
        constrained={isConstrained}
        onClose={() => setEditing(null)}
        onSave={(row) => save.mutate(row)}
        saving={save.isPending}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        table="lookup_values"
        title={`استيراد قيم — ${selected?.name_ar ?? ""}`}
        invalidateKey="reference-values"
        fixedValues={{ category_id: categoryId }}
        columns={IMPORT_COLUMNS}
      />
    </div>
  );
}

function ValueDialog({
  row,
  constrained,
  onClose,
  onSave,
  saving,
}: {
  row: any | null;
  constrained: boolean;
  onClose: () => void;
  onSave: (row: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<any>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = row ? (row.id ?? "__new__") : null;
  if (row && key !== loadedFor) {
    setForm({ ...row });
    setLoadedFor(key);
  }
  if (!row && loadedFor !== null) setLoadedFor(null);

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.id ? "تعديل القيمة" : "قيمة جديدة"}</DialogTitle>
          <DialogDescription>
            القيمة المستعملة في سجلات قديمة تُعطَّل ولا تُحذف — الحذف يترك سجلات تشير إلى لا شيء.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالعربية *</Label>
            <Input value={form.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={form.name_en ?? ""} dir="ltr" onChange={(e) => set("name_en", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الكود</Label>
            <Input
              value={form.code ?? ""}
              dir="ltr"
              disabled={constrained && Boolean(row?.id)}
              onChange={(e) => set("code", e.target.value)}
            />
            {constrained && Boolean(row?.id) && (
              <p className="text-xs text-muted-foreground">
                مفاتيح هذا القاموس مقيَّدة في القاعدة — تغييرها يكسر إدخال الفحوص.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الترتيب</Label>
            <Input
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => set("sort_order", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={saving || !String(form.name_ar ?? "").trim()} onClick={() => onSave(form)}>
            {saving ? "..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
