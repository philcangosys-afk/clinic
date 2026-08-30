import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const LIST_KIND_LABELS: Record<string, string> = {
  base: "أساس",
  branch: "فرع",
  insurance: "تأمين",
  corporate: "شركة",
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * أسعار خدمة واحدة عبر قوائم الأسعار.
 *
 * التعديل يمرّ بـ`app_set_price_list_item` لا بـ`update` مباشر: الدالة تغلق
 * السعر القديم على اليوم السابق وتفتح الجديد في معاملة واحدة. تحديثٌ مباشر
 * للصف يمحو التاريخ، ومعه القدرة على تفسير فاتورةٍ صدرت الشهر الماضي.
 */
export default function ServicePriceLists({
  itemId,
  basePrice,
}: {
  itemId: string;
  basePrice: number;
}) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organizationId = organization?.id;
  const canPrice = can("catalog.pricing");

  const [listId, setListId] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(today());

  const lists = useQuery({
    queryKey: ["price-lists", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, name, list_kind, is_active, priority, effective_from, effective_to")
        .eq("organization_id", organizationId)
        .order("list_kind")
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const history = useQuery({
    queryKey: ["item-price-history", itemId],
    enabled: Boolean(itemId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_item_price_history")
        .select("id, price_list_id, price_list_name, list_kind, price, discount_percent, effective_from, effective_to, is_current")
        .eq("item_id", itemId)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const setPriceMutation = useMutation({
    mutationFn: async () => {
      if (!listId) throw new Error("اختر قائمة الأسعار");
      const value = Number(price);
      if (!Number.isFinite(value) || value < 0) throw new Error("السعر يجب أن يكون رقمًا غير سالب");
      const { error } = await supabase.rpc("app_set_price_list_item", {
        p_price_list_id: listId,
        p_item_id: itemId,
        p_price: value,
        p_effective_from: effectiveFrom,
        p_discount_percent: Number(discount) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["item-price-history", itemId] });
      setPrice("");
      toast({ title: "سُجّل السعر الجديد", description: "أُغلق السعر السابق ولم يُمحَ." });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل السعر",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const current = (history.data ?? []).filter((row) => row.is_current);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Label>الأسعار السارية</Label>
          <Badge variant="secondary">السعر الأساسي للصنف {basePrice.toLocaleString("ar-SA")} ر.س</Badge>
        </div>
        {history.isLoading && <Skeleton className="h-16 w-full" />}
        {!history.isLoading && current.length === 0 && (
          <p className="text-sm text-muted-foreground">
            لا توجد قوائم أسعار لهذه الخدمة — تُفوتر بسعر الصنف الأساسي.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {current.map((row) => (
            <div key={row.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{LIST_KIND_LABELS[row.list_kind] ?? row.list_kind}</Badge>
                <span className="font-medium">{row.price_list_name}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {Number(row.price).toLocaleString("ar-SA")} ر.س
                {Number(row.discount_percent) > 0 && ` — خصم ${row.discount_percent}%`}
                {` — من ${row.effective_from}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {canPrice ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="w-52">
            <div className="flex flex-col gap-1.5">
              <Label>قائمة الأسعار</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر قائمة" />
                </SelectTrigger>
                <SelectContent>
                  {(lists.data ?? []).map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({LIST_KIND_LABELS[list.list_kind] ?? list.list_kind})
                      {!list.is_active ? " — معطَّلة" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="w-28">
            <div className="flex flex-col gap-1.5">
              <Label>السعر</Label>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="w-24">
            <div className="flex flex-col gap-1.5">
              <Label>خصم %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>
          <div className="w-40">
            <div className="flex flex-col gap-1.5">
              <Label>يسري من</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <Button disabled={!listId || !price || setPriceMutation.isPending} onClick={() => setPriceMutation.mutate()}>
            {setPriceMutation.isPending ? "..." : "تسجيل السعر"}
          </Button>
          {(lists.data ?? []).length === 0 && (
            <p className="w-full text-xs text-muted-foreground">
              لا توجد قوائم أسعار بعد — تُنشأ من شاشة قوائم الأسعار.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          تعديل الأسعار يحتاج صلاحية «تسعير الكتالوج».
        </p>
      )}

      <div>
        <Label>تاريخ الأسعار</Label>
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>القائمة</TableHead>
              <TableHead>السعر</TableHead>
              <TableHead>الخصم</TableHead>
              <TableHead>من</TableHead>
              <TableHead>إلى</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(history.data ?? []).map((row) => (
              <TableRow key={row.id} className={row.is_current ? "" : "text-muted-foreground"}>
                <TableCell>{row.price_list_name}</TableCell>
                <TableCell>{Number(row.price).toLocaleString("ar-SA")}</TableCell>
                <TableCell>{Number(row.discount_percent) > 0 ? `${row.discount_percent}%` : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.effective_from}</TableCell>
                <TableCell className="font-mono text-xs">{row.effective_to ?? "سارٍ"}</TableCell>
              </TableRow>
            ))}
            {(history.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا يوجد تاريخ أسعار.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
