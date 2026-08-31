import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardList, PackageCheck, Plus, RefreshCcw, Send, Truck, X, XCircle,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * دورة الشراء — المرحلة 17.
 *
 * التسلسل واحدٌ لا يُتخطّى:
 *   طلب → اعتماد → أمر → استلام → فاتورة → سداد
 *
 * كل انتقال يمرّ بدالّة في القاعدة تفحص شرطه، فلا يُصدَر أمرٌ من طلبٍ لم
 * يُعتمد، ولا تُفوتَر بضاعةٌ لم تُرحَّل، ولا يُستلَم أكثر من المطلوب إلا
 * بصلاحية وسبب.
 */

const REQ_STATUS: Record<string, { label: string; variant: any }> = {
  draft:              { label: "مسوّدة",        variant: "secondary" },
  submitted:          { label: "بانتظار الاعتماد", variant: "default" },
  approved:           { label: "معتمَد",        variant: "success" },
  partially_approved: { label: "معتمَد جزئيًّا",  variant: "success" },
  rejected:           { label: "مرفوض",         variant: "destructive" },
  ordered:            { label: "صدر له أمر",    variant: "outline" },
  cancelled:          { label: "ملغى",          variant: "destructive" },
};

const PO_STATUS: Record<string, { label: string; variant: any }> = {
  draft:              { label: "مسوّدة",         variant: "secondary" },
  sent:               { label: "مُرسَل للمورد",  variant: "default" },
  partially_received: { label: "استلام جزئي",    variant: "default" },
  received:           { label: "مستلَم",         variant: "success" },
  invoiced:           { label: "مفوتَر",         variant: "outline" },
  closed:             { label: "مغلق",           variant: "outline" },
  cancelled:          { label: "ملغى",           variant: "destructive" },
};

export default function PurchaseCycle() {
  return (
    <Tabs defaultValue="requests">
      <TabsList>
        <TabsTrigger value="requests">طلبات الشراء</TabsTrigger>
        <TabsTrigger value="orders">أوامر الشراء والاستلام</TabsTrigger>
        <TabsTrigger value="returns">المرتجعات والتكلفة الواصلة</TabsTrigger>
        <TabsTrigger value="suppliers">أرصدة الموردين</TabsTrigger>
      </TabsList>
      <TabsContent value="requests" className="mt-4">
        <RequestsPanel />
      </TabsContent>
      <TabsContent value="orders" className="mt-4">
        <OrdersPanel />
      </TabsContent>
      <TabsContent value="returns" className="mt-4">
        <ReturnsAndCostsPanel />
      </TabsContent>
      <TabsContent value="suppliers" className="mt-4">
        <SupplierBalancesPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ── مساعدات مشتركة ─────────────────────────────────────────────────────── */
function useBranches(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pc-branches", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name").eq("organization_id", orgId).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
function useWarehouses(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pc-warehouses", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses").select("id, name, branch_id, is_disabled")
        .eq("organization_id", orgId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
function useSuppliers(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pc-suppliers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name_ar, payment_terms_days, is_disabled, is_archived")
        .eq("organization_id", orgId)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
function useStockItems(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pc-items", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, track_expiry, track_inventory, is_disabled, is_archived")
        .eq("organization_id", orgId)
        .eq("track_inventory", true)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * طلبات الشراء
 * ════════════════════════════════════════════════════════════════════════ */
function RequestsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState<any | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [expected, setExpected] = useState("");

  const requests = useQuery({
    queryKey: ["purchase-requests", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_requests")
        .select("*, purchase_request_items(id, item_id, qty_requested, qty_approved, estimated_price, item:items(name_ar))")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-requests", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const submit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_submit_purchase_request", { p_request_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "قُدّم الطلب للاعتماد" }); },
    onError: fail("تعذر التقديم"),
  });

  const approve = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.rpc("app_approve_purchase_request", {
        p_request_id: id, p_note: note || null, p_lines: null,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "اعتُمد الطلب" }); },
    onError: fail("تعذر الاعتماد"),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reject_purchase_request", {
        p_request_id: id, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "رُفض الطلب" }); },
    onError: fail("تعذر الرفض"),
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_create_purchase_order", {
        p_request_id: ordering.id,
        p_distributor_id: supplierId,
        p_expected_date: expected || null,
        p_note: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      setOrdering(null);
      setSupplierId("");
      setExpected("");
      toast({
        title: "صدر أمر الشراء",
        description: "بالكمّيات المعتمَدة لا المطلوبة — راجعه في تبويب الأوامر",
      });
    },
    onError: fail("تعذر إصدار الأمر"),
  });

  const suppliers = useSuppliers(organization?.id);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              طلبات الشراء
            </CardTitle>
            <CardDescription>
              الطلب يُقدَّم فيُعتمد ثم يصير أمرًا. **مقدّم الطلب لا يعتمده**، ودور الاعتماد
              يُشتقّ من قيمة الطلب.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => requests.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              تحديث
            </Button>
            {can("purchasing.request") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                طلب جديد
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading && <Skeleton className="h-40 w-full" />}
          {!requests.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>البنود</TableHead>
                  <TableHead>القيمة التقديرية</TableHead>
                  <TableHead>مطلوب بحلول</TableHead>
                  <TableHead>المبرّر</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.request_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={REQ_STATUS[r.status]?.variant ?? "secondary"}>
                        {REQ_STATUS[r.status]?.label ?? r.status}
                      </Badge>
                      {r.rejected_reason && (
                        <span className="block text-[10px] text-muted-foreground">
                          {r.rejected_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(r.purchase_request_items ?? []).map((li: any) => (
                        <span key={li.id} className="block">
                          {li.item?.name_ar} × {li.qty_requested}
                          {li.qty_approved !== null &&
                            Number(li.qty_approved) !== Number(li.qty_requested) && (
                              <span className="text-amber-700"> (اعتُمد {li.qty_approved})</span>
                            )}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(r.estimated_total ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.needed_by ?? "—"}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                      {r.justification ?? "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-1">
                        {r.status === "draft" && can("purchasing.request") && (
                          <Button size="sm" variant="ghost" disabled={submit.isPending}
                                  onClick={() => submit.mutate(r.id)}>
                            <Send className="h-3.5 w-3.5" />
                            تقديم
                          </Button>
                        )}
                        {r.status === "submitted" && can("purchasing.approve") && (
                          <>
                            <Button size="sm" variant="ghost" disabled={approve.isPending}
                                    onClick={() => {
                                      const note = window.prompt("ملاحظة الاعتماد (اختياري)") ?? "";
                                      approve.mutate({ id: r.id, note });
                                    }}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              اعتماد
                            </Button>
                            <Button size="sm" variant="ghost" disabled={reject.isPending}
                                    onClick={() => {
                                      const reason = window.prompt("سبب الرفض؟") ?? "";
                                      if (!reason.trim()) return;
                                      reject.mutate({ id: r.id, reason: reason.trim() });
                                    }}>
                              <XCircle className="h-3.5 w-3.5" />
                              رفض
                            </Button>
                          </>
                        )}
                        {["approved", "partially_approved"].includes(r.status) &&
                          can("purchasing.order") && (
                            <Button size="sm" variant="outline" onClick={() => setOrdering(r)}>
                              <Truck className="h-3.5 w-3.5" />
                              أمر شراء
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(requests.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا طلبات شراء بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewRequestDialog open={creating} onOpenChange={setCreating} />

      <Dialog open={Boolean(ordering)} onOpenChange={(o) => !o && setOrdering(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>أمر شراء من الطلب {ordering?.request_number}</DialogTitle>
            <DialogDescription>
              يُبنى بالكمّيات **المعتمَدة** لا المطلوبة، وبضريبتها من مصدر الضريبة الموحّد.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المورد *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="اختر موردًا" /></SelectTrigger>
                <SelectContent>
                  {(suppliers.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name_ar}
                      {s.payment_terms_days > 0 ? ` — مهلة ${s.payment_terms_days} يومًا` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ المتوقَّع للتوريد</Label>
              <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!supplierId || createOrder.isPending}
                    onClick={() => createOrder.mutate()}>
              {createOrder.isPending ? "جارٍ الإصدار..." : "إصدار الأمر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewRequestDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const branches = useBranches(organization?.id);
  const warehouses = useWarehouses(organization?.id);
  const items = useStockItems(organization?.id);

  const [number, setNumber] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<{ itemId: string; qty: string; price: string }[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا منشأة");
      const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0);
      if (valid.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: req, error } = await supabase
        .from("purchase_requests")
        .insert({
          organization_id: organization.id,
          branch_id: branchId || null,
          warehouse_id: warehouseId || null,
          request_number: number.trim() || null,
          needed_by: neededBy || null,
          justification: justification.trim() || null,
          requested_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: liError } = await supabase.from("purchase_request_items").insert(
        valid.map((l) => ({
          organization_id: organization.id,
          purchase_request_id: req.id,
          item_id: l.itemId,
          qty_requested: Number(l.qty),
          estimated_price: l.price ? Number(l.price) : null,
        })),
      );
      if (liError) throw liError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests", organization?.id] });
      toast({ title: "حُفظ الطلب كمسوّدة", description: "قدّمه للاعتماد من القائمة" });
      setNumber(""); setBranchId(""); setWarehouseId("");
      setNeededBy(""); setJustification(""); setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>طلب شراء جديد</DialogTitle>
          <DialogDescription>
            السعر التقديري يُحدِّد قيمة الطلب، ومنها يُشتقّ دور الاعتماد المطلوب.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>رقم الطلب</Label>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>مطلوب بحلول</Label>
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الفرع</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="اختر فرعًا" /></SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر مستودعًا" /></SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? [])
                    .filter((w) => !branchId || w.branch_id === branchId)
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المبرّر</Label>
            <Textarea rows={2} value={justification}
                      onChange={(e) => setJustification(e.target.value)} />
          </div>

          <div className="flex items-center justify-between">
            <Label>البنود</Label>
            <Button size="sm" variant="outline"
                    onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "1", price: "" }])}>
              <Plus className="h-4 w-4" />
              إضافة بند
            </Button>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select value={line.itemId}
                      onValueChange={(v) => setLines((ls) => ls.map((l, i) => i === index ? { ...l, itemId: v } : l))}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="اختر صنفًا" />
                </SelectTrigger>
                <SelectContent>
                  {(items.data ?? []).map((it) => (
                    <SelectItem key={it.id} value={it.id}>{it.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" min={1} className="w-24" placeholder="الكمّية"
                     value={line.qty}
                     onChange={(e) => setLines((ls) => ls.map((l, i) => i === index ? { ...l, qty: e.target.value } : l))} />
              <Input type="number" min={0} className="w-28" placeholder="سعر تقديري"
                     value={line.price}
                     onChange={(e) => setLines((ls) => ls.map((l, i) => i === index ? { ...l, price: e.target.value } : l))} />
              <Button size="sm" variant="ghost"
                      onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">أضف بندًا واحدًا على الأقل</p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={lines.length === 0 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ كمسوّدة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * أوامر الشراء والاستلام
 * ════════════════════════════════════════════════════════════════════════ */
function OrdersPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [receiving, setReceiving] = useState<any | null>(null);

  const orders = useQuery({
    queryKey: ["purchase-orders", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_purchase_pipeline")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const pending = useQuery({
    queryKey: ["pending-receipts", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pending_receipts")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("days_late", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invoiceIt = useMutation({
    mutationFn: async ({ receiptId, number }: { receiptId: string; number: string }) => {
      const { data, error } = await supabase.rpc("app_create_purchase_invoice_from_receipt", {
        p_receipt_id: receiptId,
        p_invoice_number: number,
        p_invoice_date: null,
        p_note: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts", organization?.id] });
      toast({ title: "أُنشئت فاتورة المورد", description: "تاريخ استحقاقها من مهلة المورد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر إنشاء الفاتورة",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" />
            أوامر الشراء
          </CardTitle>
          <CardDescription>
            نسبة المستلَم من المطلوب تُظهر ما لم يصل بعد. الاستلام مستندٌ قائم بذاته،
            والفاتورة تُبنى عليه لا العكس.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {orders.isLoading && <Skeleton className="h-40 w-full" />}
          {!orders.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأمر</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>المستلَم</TableHead>
                  <TableHead>متوقَّع</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders.data ?? []).map((o) => (
                  <TableRow key={o.purchase_order_id}>
                    <TableCell className="font-mono text-xs">
                      {o.order_number ?? "—"}
                      <span className="block text-[10px] text-muted-foreground">
                        {o.request_number ? `من الطلب ${o.request_number}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{o.supplier_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={PO_STATUS[o.status]?.variant ?? "secondary"}>
                        {PO_STATUS[o.status]?.label ?? o.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(o.net_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(o.qty_received ?? 0)} / {Number(o.qty_ordered ?? 0)}
                      {o.received_percent !== null && (
                        <span className="block text-[10px] text-muted-foreground">
                          {o.received_percent}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.expected_date ?? "—"}</TableCell>
                    <TableCell className="text-left">
                      {can("purchasing.receive") &&
                        ["draft", "sent", "partially_received"].includes(o.status) && (
                          <Button size="sm" variant="outline" onClick={() => setReceiving(o)}>
                            <PackageCheck className="h-3.5 w-3.5" />
                            استلام
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
                {(orders.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا أوامر شراء بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PostedReceiptsCard onInvoice={(id) => {
        const number = window.prompt("رقم فاتورة المورد؟") ?? "";
        if (!number.trim()) return;
        invoiceIt.mutate({ receiptId: id, number: number.trim() });
      }} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ما طُلب ولم يصل</CardTitle>
          <CardDescription>مرتَّبًا بالأكثر تأخّرًا عن الموعد المتوقَّع.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pending.isLoading && <Skeleton className="h-32 w-full" />}
          {!pending.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأمر</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>المطلوب</TableHead>
                  <TableHead>المستلَم</TableHead>
                  <TableHead>المتبقّي</TableHead>
                  <TableHead>التأخّر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pending.data ?? []).map((p) => (
                  <TableRow key={p.purchase_order_item_id}>
                    <TableCell className="font-mono text-xs">{p.order_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{p.supplier_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{p.item_name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.qty_ordered}</TableCell>
                    <TableCell className="font-mono text-xs">{p.qty_received}</TableCell>
                    <TableCell className="font-mono text-xs">{p.qty_pending}</TableCell>
                    <TableCell>
                      {p.days_late ? (
                        <Badge variant="destructive">{p.days_late} يومًا</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(pending.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا مطلوبات معلّقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} />
    </div>
  );
}

/**
 * الاستلامات المرحَّلة التي لم تُفوتَر بعد.
 *
 * فصلُ الاستلام عن الفاتورة يعني وجود فجوةٍ زمنية بينهما؛ هذه البطاقة هي
 * ما يمنع الفجوة من أن تصير نسيانًا.
 */
function PostedReceiptsCard({ onInvoice }: { onInvoice: (receiptId: string) => void }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();

  const receipts = useQuery({
    queryKey: ["goods-receipts", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("*, distributor:distributors(name_ar), goods_receipt_items(id, qty_received, item:items(name_ar))")
        .eq("organization_id", organization!.id)
        .eq("status", "posted")
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invoiced = useQuery({
    queryKey: ["receipt-invoices", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("goods_receipt_id, invoice_number, status")
        .eq("organization_id", organization!.id)
        .not("goods_receipt_id", "is", null);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const byReceipt = useMemo(() => {
    const map: Record<string, any> = {};
    for (const inv of invoiced.data ?? []) map[inv.goods_receipt_id] = inv;
    return map;
  }, [invoiced.data]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">الاستلامات المرحَّلة</CardTitle>
        <CardDescription>
          البضاعة دخلت المخزون. ما لم يُفوتَر منها يظهر هنا حتى تصل فاتورة المورد.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {receipts.isLoading && <Skeleton className="h-24 w-full" />}
        {!receipts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المستند</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>البنود</TableHead>
                <TableHead>الفاتورة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(receipts.data ?? []).map((g) => {
                const inv = byReceipt[g.id];
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-xs">{g.receipt_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{g.distributor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(g.received_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(g.goods_receipt_items ?? []).map((li: any) => (
                        <span key={li.id} className="block">
                          {li.item?.name_ar} × {li.qty_received}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {inv ? inv.invoice_number : <Badge variant="destructive">بلا فاتورة</Badge>}
                    </TableCell>
                    <TableCell className="text-left">
                      {!inv && can("purchasing.invoice") && (
                        <Button size="sm" variant="outline" onClick={() => onInvoice(g.id)}>
                          تسجيل الفاتورة
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(receipts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    لا استلامات مرحَّلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiveDialog({ order, onClose }: { order: any | null; onClose: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [number, setNumber] = useState("");
  const [deliveryRef, setDeliveryRef] = useState("");
  const [lines, setLines] = useState<Record<string, any>>({});

  const orderItems = useQuery({
    queryKey: ["po-items", order?.purchase_order_id],
    enabled: Boolean(order?.purchase_order_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("*, item:items(name_ar, track_expiry)")
        .eq("purchase_order_id", order!.purchase_order_id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      if (!organization?.id || !order) throw new Error("لا أمر محدَّد");
      const chosen = Object.entries(lines).filter(([, v]: any) => Number(v?.qty) > 0);
      if (chosen.length === 0) throw new Error("أدخل كمّية مستلَمة لبند واحد على الأقل");

      const { data: gr, error } = await supabase
        .from("goods_receipts")
        .insert({
          organization_id: organization.id,
          branch_id: order.branch_id,
          warehouse_id: order.warehouse_id,
          purchase_order_id: order.purchase_order_id,
          distributor_id: order.distributor_id,
          receipt_number: number.trim() || null,
          delivery_note_ref: deliveryRef.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error: liError } = await supabase.from("goods_receipt_items").insert(
        chosen.map(([poiId, v]: any) => ({
          organization_id: organization.id,
          goods_receipt_id: gr.id,
          purchase_order_item_id: poiId,
          item_id: v.itemId,
          qty_received: Number(v.qty),
          free_qty: v.freeQty ? Number(v.freeQty) : 0,
          unit_cost: Number(v.cost ?? 0),
          lot_number: v.lot || null,
          expiry_date: v.expiry || null,
          source_barcode: v.barcode || null,
          over_receipt_reason: v.overReason || null,
          // من قَبِل الزائد يُسجَّل باسمه: القرار مسؤولية شخص لا مجهول
          over_receipt_approved_by: v.overReason ? userId : null,
        })),
      );
      if (liError) throw liError;

      const { data, error: postError } = await supabase.rpc("app_post_goods_receipt", {
        p_receipt_id: gr.id,
      });
      if (postError) throw postError;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["pending-receipts", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts", organization?.id] });
      setLines({}); setNumber(""); setDeliveryRef("");
      onClose();
      toast({
        title: "رُحّل الاستلام إلى المخزون",
        description: `${count} بندًا — أُنشئت تشغيلاتها بتكلفتها`,
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الاستلام",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(order)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>استلام على الأمر {order?.order_number}</DialogTitle>
          <DialogDescription>
            الاستلام الجزئي مسموح. الصنف الذي يُتتبَّع بالصلاحية لا يدخل بلا تاريخ انتهاء،
            والاستلام بأكثر من المطلوب يحتاج صلاحية `purchasing.over_receive` وسببًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>رقم مستند الاستلام</Label>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>مرجع إشعار التسليم</Label>
              <Input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {(orderItems.data ?? []).map((poi) => {
              const remaining = Number(poi.qty_ordered) - Number(poi.qty_received);
              const v = lines[poi.id] ?? {};
              const over = Number(v.qty ?? 0) > remaining;
              return (
                <div key={poi.id} className="mb-2 rounded-md border p-2">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{poi.item?.name_ar}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      المتبقّي {remaining} من {poi.qty_ordered}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input type="number" min={0} className="w-24" placeholder="المستلَم"
                           value={v.qty ?? ""}
                           onChange={(e) => setLines((ls) => ({
                             ...ls,
                             [poi.id]: { ...ls[poi.id], qty: e.target.value,
                                         itemId: poi.item_id,
                                         cost: ls[poi.id]?.cost ?? poi.unit_price },
                           }))} />
                    <Input type="number" min={0} className="w-24" placeholder="مجّاني"
                           value={v.freeQty ?? ""}
                           onChange={(e) => setLines((ls) => ({
                             ...ls, [poi.id]: { ...ls[poi.id], freeQty: e.target.value },
                           }))} />
                    <Input type="number" min={0} className="w-28" placeholder="تكلفة الوحدة"
                           value={v.cost ?? poi.unit_price}
                           onChange={(e) => setLines((ls) => ({
                             ...ls, [poi.id]: { ...ls[poi.id], cost: e.target.value },
                           }))} />
                    <Input className="w-28" placeholder="رقم التشغيلة"
                           value={v.lot ?? ""}
                           onChange={(e) => setLines((ls) => ({
                             ...ls, [poi.id]: { ...ls[poi.id], lot: e.target.value },
                           }))} />
                    <Input type="date" className="w-36"
                           title={poi.item?.track_expiry ? "إلزامي لهذا الصنف" : "اختياري"}
                           value={v.expiry ?? ""}
                           onChange={(e) => setLines((ls) => ({
                             ...ls, [poi.id]: { ...ls[poi.id], expiry: e.target.value },
                           }))} />
                    <Input className="w-32" placeholder="باركود المورد"
                           value={v.barcode ?? ""}
                           onChange={(e) => setLines((ls) => ({
                             ...ls, [poi.id]: { ...ls[poi.id], barcode: e.target.value },
                           }))} />
                  </div>
                  {over && (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="destructive">استلام زائد</Badge>
                      <Input className="flex-1" placeholder="سبب قبول الزائد (إلزامي)"
                             value={v.overReason ?? ""}
                             onChange={(e) => setLines((ls) => ({
                               ...ls, [poi.id]: { ...ls[poi.id], overReason: e.target.value },
                             }))} />
                    </div>
                  )}
                  {poi.item?.track_expiry && !v.expiry && Number(v.qty ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-destructive">
                      هذا الصنف يُتتبَّع بالصلاحية — تاريخ الانتهاء إلزامي.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={post.isPending} onClick={() => post.mutate()}>
            {post.isPending ? "جارٍ الترحيل..." : "ترحيل الاستلام إلى المخزون"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * أرصدة الموردين
 * ════════════════════════════════════════════════════════════════════════ */
function SupplierBalancesPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [selected, setSelected] = useState<any | null>(null);

  const balances = useQuery({
    queryKey: ["supplier-balances", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_supplier_balances")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("balance_due", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const ledger = useQuery({
    queryKey: ["supplier-ledger", selected?.distributor_id],
    enabled: Boolean(selected?.distributor_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_supplier_ledger")
        .select("*")
        .eq("distributor_id", selected!.distributor_id)
        .order("report_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const payMethods = useQuery({
    queryKey: ["pc-payment-methods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_data")
        .select("value_id, name_ar, category_key, is_disabled")
        .eq("category_key", "payment_methods")
        .eq("is_disabled", false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const pay = useMutation({
    mutationFn: async ({ invoiceId, amount, methodId }: {
      invoiceId: string; amount: number; methodId: string;
    }) => {
      const { error } = await supabase.rpc("app_pay_supplier_invoice", {
        p_invoice_id: invoiceId,
        p_amount: amount,
        p_payment_method_value_id: methodId,
        p_cash_register_id: null,
        p_reference: null,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-balances", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger", selected?.distributor_id] });
      toast({ title: "سُجّل السداد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر السداد",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">أرصدة الموردين</CardTitle>
          <CardDescription>
            المستحقّ والمتأخّر وتجاوز حدّ الائتمان. تواريخ الاستحقاق مشتقّة من مهلة كل مورد.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {balances.isLoading && <Skeleton className="h-32 w-full" />}
          {!balances.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المورد</TableHead>
                  <TableHead>المهلة</TableHead>
                  <TableHead>المفوتَر</TableHead>
                  <TableHead>المسدَّد</TableHead>
                  <TableHead>المستحقّ</TableHead>
                  <TableHead>المتأخّر</TableHead>
                  <TableHead>حدّ الائتمان</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(balances.data ?? []).map((b) => (
                  <TableRow key={b.distributor_id}>
                    <TableCell className="text-sm font-medium">{b.supplier_name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {b.payment_terms_days ? `${b.payment_terms_days} يومًا` : "نقدًا"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(b.total_invoiced ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(b.total_settled ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">
                      {Number(b.balance_due ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(b.overdue_amount ?? 0) > 0 ? (
                        <Badge variant="destructive">
                          {Number(b.overdue_amount).toLocaleString("ar-SA")}
                          {b.max_days_overdue ? ` · ${b.max_days_overdue} يومًا` : ""}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {b.over_credit_limit ? (
                        <Badge variant="destructive">تجاوز الحدّ</Badge>
                      ) : b.credit_limit ? (
                        <span className="font-mono text-xs">
                          {Number(b.credit_limit).toLocaleString("ar-SA")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(b)}>
                        كشف الحساب
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(balances.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      لا موردين مسجّلين.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">كشف حساب {selected.supplier_name}</CardTitle>
            <CardDescription>
              الفواتير مدينة، والمدفوعات والمرتجعات دائنة.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {ledger.isLoading && <Skeleton className="h-32 w-full" />}
            {!ledger.isLoading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>المرجع</TableHead>
                    <TableHead>مدين</TableHead>
                    <TableHead>دائن</TableHead>
                    <TableHead>الاستحقاق</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ledger.data ?? []).map((l) => (
                    <TableRow key={`${l.entry_kind}-${l.reference_id}`}>
                      <TableCell className="font-mono text-xs">{l.report_date}</TableCell>
                      <TableCell className="text-sm">
                        {l.entry_kind === "invoice" ? "فاتورة"
                          : l.entry_kind === "payment" ? "سداد" : "مرتجع"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.reference_number ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {Number(l.debit_amount ?? 0) > 0
                          ? Number(l.debit_amount).toLocaleString("ar-SA") : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {Number(l.credit_amount ?? 0) > 0
                          ? Number(l.credit_amount).toLocaleString("ar-SA") : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.due_date ?? "—"}
                        {l.days_overdue && (
                          <Badge variant="destructive" className="ms-1">
                            متأخّر {l.days_overdue}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-left">
                        {l.entry_kind === "invoice" && l.status !== "paid" &&
                          can("suppliers.pay") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pay.isPending}
                              onClick={() => {
                                const amount = window.prompt("المبلغ المراد سداده؟") ?? "";
                                if (!amount || Number(amount) <= 0) return;
                                const method = (payMethods.data ?? [])[0];
                                if (!method) {
                                  toast({
                                    variant: "destructive",
                                    title: "لا طريقة دفع مُعرَّفة",
                                  });
                                  return;
                                }
                                pay.mutate({
                                  invoiceId: l.reference_id,
                                  amount: Number(amount),
                                  methodId: method.value_id,
                                });
                              }}
                            >
                              سداد
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(ledger.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                        لا حركات على هذا المورد.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
 * المرتجعات والتكلفة الواصلة
 * ════════════════════════════════════════════════════════════════════════ */
/**
 * مرتجع المشتريات ومصروفات الشحن في شاشة واحدة، لأنهما الطرفان اللذان
 * يجعلان تكلفة الصنف في الدفاتر مطابقةً لتكلفته الحقيقية: المرتجع يخرج
 * بضاعةً دخلت، والمصروف يرفع تكلفة ما بقي. إهمالهما يجعل هامش الربح يبدو
 * أكبر ممّا هو.
 */
function ReturnsAndCostsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const returns = useQuery({
    queryKey: ["purchase-returns", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select("*, distributor:distributors(name_ar), purchase_return_items(id, qty_returned, unit_cost, item:items(name_ar))")
        .eq("organization_id", organization!.id)
        .order("returned_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const expenses = useQuery({
    queryKey: ["purchase-expenses", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_expenses")
        .select("*, distributor:distributors(name_ar)")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const postReturn = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_post_purchase_return", {
        p_return_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns", organization?.id] });
      toast({ title: "رُحّل المرتجع", description: `${n} بندًا خرج من التشغيلات` });
    },
    onError: fail("تعذر ترحيل المرتجع"),
  });

  const allocate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_allocate_purchase_expense", {
        p_expense_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-expenses", organization?.id] });
      toast({
        title: "وُزّع المصروف",
        description: `رُفعت تكلفة ${n} تشغيلة إلى تكلفتها الواصلة`,
      });
    },
    onError: fail("تعذر التوزيع"),
  });

  const EXPENSE_TYPES: Record<string, string> = {
    shipping: "شحن", customs: "تخليص جمركي", insurance: "تأمين نقل",
    handling: "مناولة", other: "أخرى",
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مرتجعات المشتريات</CardTitle>
          <CardDescription>
            المرتجع يخرج من **التشغيلة نفسها** التي دخلت، ولا يتجاوز رصيدها، ولا يُرحَّل مرّتين.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {returns.isLoading && <Skeleton className="h-24 w-full" />}
          {!returns.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>البنود</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(returns.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.return_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.distributor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="max-w-48 truncate text-sm">{r.reason}</TableCell>
                    <TableCell className="text-xs">
                      {(r.purchase_return_items ?? []).map((li: any) => (
                        <span key={li.id} className="block">
                          {li.item?.name_ar} × {li.qty_returned}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(r.net_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "posted" ? "success" : "secondary"}>
                        {r.status === "posted" ? "مرحَّل"
                          : r.status === "cancelled" ? "ملغى" : "مسوّدة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {r.status === "draft" && can("purchasing.return") && (
                        <Button size="sm" variant="outline" disabled={postReturn.isPending}
                                onClick={() => postReturn.mutate(r.id)}>
                          ترحيل
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(returns.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا مرتجعات مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مصروفات الشراء الإضافية</CardTitle>
          <CardDescription>
            الشحن والتخليص تُوزَّع على التشغيلات فتصير التكلفة **واصلةً** لا سعرَ فاتورة.
            الشحن يُوزَّع بالكمّية عادةً، والتخليص بالقيمة.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {expenses.isLoading && <Skeleton className="h-24 w-full" />}
          {!expenses.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>طريقة التوزيع</TableHead>
                  <TableHead>المرجع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(expenses.data ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">
                      {EXPENSE_TYPES[e.expense_type] ?? e.expense_type}
                    </TableCell>
                    <TableCell className="text-sm">{e.distributor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(e.amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.allocation_method === "by_qty" ? "بالكمّية" : "بالقيمة"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.reference_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.is_allocated ? "success" : "secondary"}>
                        {e.is_allocated ? "موزَّع" : "غير موزَّع"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {!e.is_allocated && can("purchasing.invoice") && (
                        <Button size="sm" variant="outline" disabled={allocate.isPending}
                                onClick={() => allocate.mutate(e.id)}>
                          توزيع على التكلفة
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(expenses.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا مصروفات شراء مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
