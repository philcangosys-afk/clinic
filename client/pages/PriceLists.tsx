import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus, Tag } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import ItemPicker from "@/components/shared/ItemPicker";

const LIST_KINDS: Record<string, string> = {
  base: "قائمة أساس",
  branch: "أسعار فرع",
  insurance: "تعرفة تأمين",
  corporate: "عقد شركة",
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * قوائم الأسعار.
 *
 * ترتيب الأسبقية عند الفوترة يقرّره `app_resolve_item_price` في القاعدة:
 * تأمين ← شركة ← فرع ← أساس ← سعر الصنف. هذه الشاشة تُظهر الترتيب ولا
 * تُعيد تعريفه، فلا يختلف ما تراه هنا عمّا يُطبَّق على الفاتورة.
 */
export default function PriceLists() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const organizationId = organization?.id;
  const canPrice = can("catalog.pricing");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const lists = useQuery({
    queryKey: ["price-lists-page", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select(
          "id, name, list_kind, priority, effective_from, effective_to, is_active, note, branch_id, insurance_company_id, external_client_id, branch:branches!price_lists_branch_id_fkey(name), company:insurance_companies!price_lists_insurance_company_id_fkey(name_ar), client:external_clients!price_lists_external_client_id_fkey(name)",
        )
        .eq("organization_id", organizationId)
        .order("list_kind")
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const scopeLabel = (row: any) => {
    const one = (value: any) => (Array.isArray(value) ? value[0] : value);
    if (row.list_kind === "branch") return one(row.branch)?.name ?? "—";
    if (row.list_kind === "insurance") return one(row.company)?.name_ar ?? "—";
    if (row.list_kind === "corporate") return one(row.client)?.name ?? "—";
    return "كل المنشأة";
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">قوائم الأسعار</h1>
          <p className="text-sm text-muted-foreground">
            تعرفة التأمين وعقود الشركات وأسعار الفروع — الأخصّ يتقدّم على الأعمّ
          </p>
        </div>
        {canPrice && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            قائمة جديدة
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ترتيب الأسبقية</CardTitle>
          <CardDescription>
            عند الفوترة يُبحث عن سعر الخدمة بهذا الترتيب: تعرفة التأمين، ثم عقد الشركة، ثم أسعار الفرع،
            ثم قائمة الأساس، وأخيرًا السعر المسجَّل على الصنف نفسه. وعند تساوي النوع تُقدَّم القائمة
            ذات الأولوية الأعلى.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {lists.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {lists.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر التحميل: {(lists.error as Error)?.message}
            </p>
          )}
          {!lists.isLoading && !lists.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>النطاق</TableHead>
                  <TableHead>الأولوية</TableHead>
                  <TableHead>السريان</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lists.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        {row.name}
                      </span>
                    </TableCell>
                    <TableCell>{LIST_KINDS[row.list_kind] ?? row.list_kind}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{scopeLabel(row)}</TableCell>
                    <TableCell>{row.priority}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.effective_from} → {row.effective_to ?? "مفتوح"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "success" : "secondary"}>
                        {row.is_active ? "مفعَّلة" : "معطَّلة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
                        <ListPlus className="h-4 w-4" />
                        الأسعار
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(lists.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد قوائم أسعار. أنشئ «قائمة أساس» أولًا ثم تعرفةً لكل شركة تأمين.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateListDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organizationId} />
      <ListItemsDialog list={selected} onClose={() => setSelected(null)} canPrice={canPrice} />
    </div>
  );
}

function CreateListDialog({
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
  const [kind, setKind] = useState("base");
  const [scopeId, setScopeId] = useState("");
  const [priority, setPriority] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [note, setNote] = useState("");

  const branches = useQuery({
    queryKey: ["pricelist-branches", organizationId],
    enabled: open && Boolean(organizationId),
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

  const companies = useQuery({
    queryKey: ["pricelist-companies", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const clients = useQuery({
    queryKey: ["pricelist-clients", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_clients")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const scopeOptions =
    kind === "branch"
      ? (branches.data ?? []).map((r: any) => ({ id: r.id, label: r.name }))
      : kind === "insurance"
        ? (companies.data ?? []).map((r: any) => ({ id: r.id, label: r.name_ar }))
        : kind === "corporate"
          ? (clients.data ?? []).map((r: any) => ({ id: r.id, label: r.name }))
          : [];

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!name.trim()) throw new Error("اسم القائمة مطلوب");
      if (kind !== "base" && !scopeId) throw new Error("اختر نطاق القائمة");
      const { error } = await supabase.from("price_lists").insert({
        organization_id: organizationId,
        name: name.trim(),
        list_kind: kind,
        branch_id: kind === "branch" ? scopeId : null,
        insurance_company_id: kind === "insurance" ? scopeId : null,
        external_client_id: kind === "corporate" ? scopeId : null,
        priority: Number(priority) || 0,
        effective_from: effectiveFrom,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-lists-page"] });
      queryClient.invalidateQueries({ queryKey: ["price-lists"] });
      toast({ title: "أُنشئت القائمة" });
      setName("");
      setScopeId("");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإنشاء",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>قائمة أسعار جديدة</DialogTitle>
          <DialogDescription>
            القائمة وعاء للأسعار؛ الأسعار تُضاف داخلها لكل خدمة بتاريخ سريان.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value);
                setScopeId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LIST_KINDS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind !== "base" && (
            <div className="flex flex-col gap-1.5">
              <Label>
                {kind === "branch" ? "الفرع" : kind === "insurance" ? "شركة التأمين" : "الشركة"} *
              </Label>
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الأولوية</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>تسري من</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "..." : "إنشاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** أسعار قائمة واحدة، وإضافة سعر لخدمة عبر `app_set_price_list_item`. */
function ListItemsDialog({
  list,
  onClose,
  canPrice,
}: {
  list: any | null;
  onClose: () => void;
  canPrice: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [showHistory, setShowHistory] = useState(false);

  const rows = useQuery({
    queryKey: ["price-list-items", list?.id, showHistory],
    enabled: Boolean(list?.id),
    queryFn: async () => {
      let query = supabase
        .from("v_item_price_history")
        .select("id, item_id, item_name, price, discount_percent, effective_from, effective_to, is_current")
        .eq("price_list_id", list.id)
        .order("item_name")
        .order("effective_from", { ascending: false });
      if (!showHistory) query = query.is("effective_to", null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const setItemPrice = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("اختر الخدمة");
      const value = Number(price);
      if (!Number.isFinite(value) || value < 0) throw new Error("السعر يجب أن يكون رقمًا غير سالب");
      const { error } = await supabase.rpc("app_set_price_list_item", {
        p_price_list_id: list.id,
        p_item_id: picked.id,
        p_price: value,
        p_effective_from: effectiveFrom,
        p_discount_percent: Number(discount) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-list-items", list?.id] });
      queryClient.invalidateQueries({ queryKey: ["item-price-history"] });
      setPicked(null);
      setPrice("");
      toast({ title: "سُجّل السعر" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(list)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list?.name}</DialogTitle>
          <DialogDescription>
            تغيير سعر يغلق السعر السابق على اليوم السابق ويفتح الجديد — التاريخ يبقى كاملًا.
          </DialogDescription>
        </DialogHeader>

        {canPrice && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="min-w-52 flex-1">
              <div className="flex flex-col gap-1.5">
                <Label>الخدمة</Label>
                {picked ? (
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    {picked.name}
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setPicked(null)}>
                      تغيير
                    </Button>
                  </div>
                ) : (
                  <ItemPicker
                    onSelect={(item: any) => setPicked({ id: item.id, name: item.name_ar ?? item.name })}
                  />
                )}
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
            <Button
              disabled={!picked || !price || setItemPrice.isPending}
              onClick={() => setItemPrice.mutate()}
            >
              تسجيل
            </Button>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showHistory} onCheckedChange={setShowHistory} />
          عرض الأسعار المنتهية أيضًا
        </label>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>السعر</TableHead>
              <TableHead>الخصم</TableHead>
              <TableHead>من</TableHead>
              <TableHead>إلى</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.id} className={row.is_current ? "" : "text-muted-foreground"}>
                <TableCell>{row.item_name}</TableCell>
                <TableCell>{Number(row.price).toLocaleString("ar-SA")}</TableCell>
                <TableCell>{Number(row.discount_percent) > 0 ? `${row.discount_percent}%` : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.effective_from}</TableCell>
                <TableCell className="font-mono text-xs">{row.effective_to ?? "سارٍ"}</TableCell>
              </TableRow>
            ))}
            {(rows.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  لا توجد أسعار في هذه القائمة بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
