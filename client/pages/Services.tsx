import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus } from "lucide-react";
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

const ITEM_TYPE_LABELS: Record<ItemRow["item_type"], string> = {
  service: "خدمة طبية",
  product: "منتج",
  drug: "دواء",
  lab_service: "خدمة مخبرية",
};

function useItems(organizationId: string | undefined, search: string) {
  return useQuery({
    queryKey: ["items-catalog", organizationId, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("items")
        .select("id, code, name_ar, item_type, price, is_vat_exempt, is_disabled")
        .order("name_ar")
        .limit(100);
      if (search.trim()) query = query.ilike("name_ar", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Services() {
  const { organization } = useOrganizationAccess();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const items = useItems(organization?.id, search);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الخدمات والكتالوج الطبي</h1>
          <p className="text-sm text-muted-foreground">الخدمات والمنتجات والأدوية القابلة للفوترة</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          صنف/خدمة جديدة
        </Button>
      </div>

      <Card>
        <CardHeader>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم..." className="max-w-sm" />
          <CardDescription>كل الأصناف القابلة للفوترة من مكان واحد</CardDescription>
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
                  <TableHead>الاسم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>السعر</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items.data ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
                    <TableCell className="flex items-center gap-2 font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {item.name_ar}
                    </TableCell>
                    <TableCell>{ITEM_TYPE_LABELS[item.item_type as ItemRow["item_type"]]}</TableCell>
                    <TableCell>{Number(item.price).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>{item.is_vat_exempt ? "معفى" : "خاضع"}</TableCell>
                    <TableCell>
                      <Badge variant={item.is_disabled ? "secondary" : "success"}>
                        {item.is_disabled ? "معطّل" : "نشط"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(items.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد أصناف مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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

  const createItem = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("items").insert({
        organization_id: organizationId,
        code: code.trim() || `ITM-${Date.now().toString().slice(-6)}`,
        name_ar: nameAr.trim(),
        item_type: itemType,
        price: Number(price) || 0,
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
