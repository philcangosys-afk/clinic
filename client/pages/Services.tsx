import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Package, Plus, Upload } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { ItemRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";
import LookupSelect from "@/components/shared/LookupSelect";

const ITEM_TYPE_LABELS: Record<ItemRow["item_type"], string> = {
  service: "خدمة طبية",
  product: "منتج",
  drug: "دواء",
  lab_service: "خدمة مخبرية",
};

const ITEMS_CAP = 200;

function useItems(
  organizationId: string | undefined,
  search: string,
  categoryId: string,
  typeFilter: string,
  statusFilter: string,
) {
  return useQuery({
    queryKey: ["items-catalog", organizationId, search, categoryId, typeFilter, statusFilter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("items")
        .select(
          "id, code, barcode, name_ar, item_type, category_value_id, price, cost_price, is_vat_exempt, is_disabled, category:lookup_values!items_category_value_id_fkey(name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("name_ar")
        .limit(ITEMS_CAP);
      const term = search.trim();
      if (term) query = query.or(`name_ar.ilike.%${term}%,code.ilike.%${term}%,barcode.ilike.%${term}%`);
      if (categoryId) query = query.eq("category_value_id", categoryId);
      if (typeFilter !== "all") query = query.eq("item_type", typeFilter);
      if (statusFilter !== "all") query = query.eq("is_disabled", statusFilter === "disabled");
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** تصدير الكتالوج المعروض — "لائحة الأسعار" في لقطة 10. */
function exportItemsCsv(rows: any[]) {
  const headers = ["الكود", "الباركود", "الاسم", "النوع", "الفئة", "سعر البيع", "التكلفة", "الحالة"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) => {
      const category = Array.isArray(row.category) ? row.category[0] : row.category;
      return [
        row.code,
        row.barcode,
        row.name_ar,
        ITEM_TYPE_LABELS[row.item_type as ItemRow["item_type"]] ?? row.item_type,
        category?.name_ar,
        row.price,
        row.cost_price,
        row.is_disabled ? "معطّل" : "نشط",
      ]
        .map(escape)
        .join(",");
    }),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `items-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * أعمدة استيراد الأصناف. `code` إلزامي لأن على الجدول قيد
 * `unique (organization_id, code)` — صنف بلا كود يعني فشل الإدراج كله.
 */
const ITEM_IMPORT_COLUMNS: CsvColumn[] = [
  { key: "code", header: "الكود", required: true },
  { key: "name_ar", header: "الاسم", required: true },
  { key: "name_en", header: "الاسم بالإنجليزي" },
  {
    key: "item_type",
    header: "النوع",
    parse: (raw) => {
      const map: Record<string, string> = {
        خدمة: "service",
        منتج: "product",
        دواء: "drug",
        "خدمة مختبر": "lab_service",
        service: "service",
        product: "product",
        drug: "drug",
        lab_service: "lab_service",
      };
      const value = map[raw.trim()];
      if (!value) throw new Error("النوع يجب أن يكون: خدمة / منتج / دواء / خدمة مختبر");
      return value;
    },
  },
  {
    key: "price",
    header: "السعر",
    parse: (raw) => {
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("السعر يجب أن يكون رقمًا غير سالب");
      return value;
    },
  },
  {
    key: "cost_price",
    header: "التكلفة",
    parse: (raw) => {
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("التكلفة يجب أن تكون رقمًا غير سالب");
      return value;
    },
  },
  { key: "unit", header: "الوحدة" },
  { key: "barcode", header: "الباركود" },
];

export default function Services() {
  const { organization } = useOrganizationAccess();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const items = useItems(organization?.id, search, categoryId, typeFilter, statusFilter);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الخدمات والكتالوج الطبي</h1>
          <p className="text-sm text-muted-foreground">الخدمات والمنتجات والأدوية القابلة للفوترة</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            استيراد
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            صنف/خدمة جديدة
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الكود أو الباركود..."
              className="max-w-xs"
            />
            <div className="w-48">
              <LookupSelect
                categoryKey="item_categories"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="كل الفئات"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">النشط</SelectItem>
                <SelectItem value="disabled">المعطّل</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => exportItemsCsv(items.data ?? [])}
              disabled={(items.data ?? []).length === 0}
            >
              <Download className="h-4 w-4" />
              تصدير
            </Button>
          </div>
          <CardDescription>
            {(items.data ?? []).length >= ITEMS_CAP
              ? `يُعرض أول ${ITEMS_CAP} صنف — ضيّق البحث`
              : `${(items.data ?? []).length} صنف`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!items.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الباركود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>السعر</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items.data ?? []).map((item) => {
                  const category = Array.isArray(item.category) ? item.category[0] : item.category;
                  return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
                    <TableCell className="font-mono text-xs">{item.barcode ?? "—"}</TableCell>
                    <TableCell className="flex items-center gap-2 font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {item.name_ar}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category?.name_ar ?? "—"}</TableCell>
                    <TableCell>{ITEM_TYPE_LABELS[item.item_type as ItemRow["item_type"]]}</TableCell>
                    <TableCell>{Number(item.price).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>{item.is_vat_exempt ? "معفى" : "خاضع"}</TableCell>
                    <TableCell>
                      <Badge variant={item.is_disabled ? "secondary" : "success"}>
                        {item.is_disabled ? "معطّل" : "نشط"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {(items.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد أصناف مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        table="items"
        title="استيراد أصناف وخدمات من ملف CSV"
        invalidateKey="items-catalog"
        fixedValues={{ organization_id: organization?.id }}
        columns={ITEM_IMPORT_COLUMNS}
      />

      <NewItemDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function NewItemDialog({
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
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [itemType, setItemType] = useState<ItemRow["item_type"]>("service");
  const [price, setPrice] = useState("0");
  const [isVatExempt, setIsVatExempt] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [categoryValueId, setCategoryValueId] = useState("");
  const [costPrice, setCostPrice] = useState("0");

  const createItem = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("items").insert({
        organization_id: organizationId,
        code: code.trim() || `ITM-${Date.now().toString().slice(-6)}`,
        name_ar: nameAr.trim(),
        item_type: itemType,
        price: Number(price) || 0,
        cost_price: Number(costPrice) || 0,
        barcode: barcode.trim() || null,
        category_value_id: categoryValueId || null,
        is_vat_exempt: isVatExempt,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      toast({ title: "تم حفظ الصنف" });
      setCode("");
      setNameAr("");
      setItemType("service");
      setPrice("0");
      setCostPrice("0");
      setBarcode("");
      setCategoryValueId("");
      setIsVatExempt(false);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>صنف/خدمة جديدة</DialogTitle>
          <DialogDescription>يظهر هذا الصنف فورًا عند البحث في شاشة الفوترة</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الكود (اختياري)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={itemType} onValueChange={(value) => setItemType(value as ItemRow["item_type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الباركود</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفئة</Label>
            <LookupSelect
              categoryKey="item_categories"
              value={categoryValueId}
              onChange={setCategoryValueId}
              placeholder="بدون فئة"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سعر التكلفة</Label>
            <Input type="number" min={0} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السعر</Label>
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isVatExempt} onChange={(e) => setIsVatExempt(e.target.checked)} />
            معفى من ضريبة القيمة المضافة
          </label>
        </div>

        <DialogFooter>
          <Button disabled={!nameAr.trim() || createItem.isPending} onClick={() => createItem.mutate()}>
            {createItem.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
