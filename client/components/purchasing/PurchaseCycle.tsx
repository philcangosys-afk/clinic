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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/error-message";
import {
  PurposeBadge, PurposePicker, matchesPurpose, usePurposeFilter, warehouseAccepts,
  type PurchasePurpose,
} from "@/components/purchasing/purchase-purpose";

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

/**
 * لوحات دورة الشراء — كلّ لوحةٍ شاشةٌ مستقلّة في مجموعة «المشتريات» بالقائمة
 * الجانبية (0177): طلبات الشراء، أوامر الشراء، استلام البضاعة، المرتجعات،
 * أرصدة الموردين. كانت تبويباتٍ داخل تبويب «دورة الشراء» داخل شاشة واحدة،
 * فلا يعرف المستخدم أين يبدأ ولا أين وصل.
 *
 * وجهة الشراء (صيدلية / طبي / إداري) تُختار في طلب الشراء وحده، وتُعرض في
 * كلّ لوحة، وتُصفّى بها من شريط الجهة أعلى الشاشة.
 */

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
        .from("warehouses").select("id, name, branch_id, is_disabled, purpose")
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
export function RequestsPanel() {
  const { organization } = useOrganizationAccess();
  const purposeFilter = usePurposeFilter();
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
      description: errorMessage(error, "خطأ غير متوقع"),
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
        description: "بالكمّيات المعتمَدة لا المطلوبة — تجده في «أوامر الشراء»",
      });
    },
    onError: fail("تعذر إصدار الأمر"),
  });

  const suppliers = useSuppliers(organization?.id);
  const rows = (requests.data ?? []).filter((r) => matchesPurpose(purposeFilter, r.purchase_purpose));

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
              الطلب يُقدَّم فيُعتمد ثم يصير أمرًا. يستطيع مقدّم الطلب اعتماده بنفسه، ودور الاعتماد
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
                  <TableHead>الجهة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>البنود</TableHead>
                  <TableHead>القيمة التقديرية</TableHead>
                  <TableHead>مطلوب بحلول</TableHead>
                  <TableHead>المبرّر</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.request_number ?? "—"}</TableCell>
                    <TableCell><PurposeBadge purpose={r.purchase_purpose} /></TableCell>
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
                    <TableCell className="text-end">
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
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا طلبات شراء لهذه الجهة.
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
  const [purpose, setPurpose] = useState<PurchasePurpose | "">("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<{ itemId: string; qty: string; price: string }[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا منشأة");
      if (!purpose) throw new Error("اختر جهة الشراء: الصيدلية، أو المستلزمات الطبية، أو الإدارية");
      // المستودع إلزاميّ: الاستلام يُدخل البضاعة مستودعًا بعينه، وطلبٌ بلا
      // مستودع كان يصير أمرًا يتعذّر استلامه.
      if (!warehouseId) throw new Error("اختر المستودع الذي تدخله البضاعة");
      const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0);
      if (valid.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: req, error } = await supabase
        .from("purchase_requests")
        .insert({
          organization_id: organization.id,
          branch_id: branchId || null,
          warehouse_id: warehouseId || null,
          purchase_purpose: purpose,
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
      setNumber(""); setPurpose(""); setBranchId(""); setWarehouseId("");
      setNeededBy(""); setJustification(""); setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
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
          <div className="flex flex-col gap-1.5">
            <Label>جهة الشراء *</Label>
            <PurposePicker
              value={purpose}
              onChange={(next) => {
                setPurpose(next);
                // مستودعٌ اختير لجهةٍ أخرى لا يبقى مختارًا بصمت
                const current = (warehouses.data ?? []).find((w) => w.id === warehouseId);
                if (current && !warehouseAccepts(current.purpose, next)) setWarehouseId("");
              }}
            />
          </div>
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
              <Label>المستودع *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId} disabled={!purpose}>
                <SelectTrigger>
                  <SelectValue placeholder={purpose ? "اختر مستودعًا" : "اختر جهة الشراء أوّلًا"} />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? [])
                    .filter((w) => !branchId || w.branch_id === branchId)
                    .filter((w) => warehouseAccepts(w.purpose, purpose))
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
          <Button disabled={lines.length === 0 || !purpose || !warehouseId || create.isPending}
                  onClick={() => create.mutate()}>
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
export function OrdersPanel({ view }: { view: "orders" | "receipts" }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const purposeFilter = usePurposeFilter();
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

  // جهة كلّ أمر من جدوله: منظور المسار لا يحملها، وإعادة بنائه تمسّ منظوراتٍ
  // مبنيّةً فوقه — فتُقرأ الجهة وحدها وتُضمّ هنا.
  const orderPurposes = useQuery({
    queryKey: ["purchase-order-purposes", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, purchase_purpose")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of (data ?? []) as { id: string; purchase_purpose: string | null }[]) {
        map[row.id] = row.purchase_purpose;
      }
      return map;
    },
  });
  const purposeOf = (orderId: string) => orderPurposes.data?.[orderId] ?? null;

  const pending = useQuery({
    queryKey: ["pending-receipts", organization?.id],
    enabled: Boolean(organization?.id) && view === "orders",
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
      queryClient.invalidateQueries({ queryKey: ["receipt-invoices", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices", organization?.id] });
      toast({ title: "أُنشئت فاتورة المورد", description: "تجدها في «فواتير الشراء» — تاريخ استحقاقها من مهلة المورد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر إنشاء الفاتورة",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const openStatuses = ["draft", "sent", "partially_received"];
  const allOrders = (orders.data ?? []).filter((o) =>
    matchesPurpose(purposeFilter, purposeOf(o.purchase_order_id)),
  );
  // شاشة الاستلام تعرض ما ينتظر الاستلام وحده؛ شاشة الأوامر تعرض الكلّ
  const shownOrders = view === "receipts" ? allOrders.filter((o) => openStatuses.includes(o.status)) : allOrders;
  const pendingRows = (pending.data ?? []).filter((p) =>
    matchesPurpose(purposeFilter, purposeOf(p.purchase_order_id)),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" />
            {view === "receipts" ? "أوامر بانتظار الاستلام" : "أوامر الشراء"}
          </CardTitle>
          <CardDescription>
            {view === "receipts"
              ? "اختر الأمر الذي وصلت بضاعته واضغط «استلام»: تدخل البضاعة مستودع الجهة وتُسجَّل تشغيلاتها وصلاحيتها."
              : "الأمر يصدر من طلب شراءٍ معتمَد. نسبة المستلَم من المطلوب تُظهر ما لم يصل بعد، والاستلام من شاشة «استلام البضاعة»."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {orders.isLoading && <Skeleton className="h-40 w-full" />}
          {!orders.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأمر</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>المستلَم</TableHead>
                  <TableHead>متوقَّع</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownOrders.map((o) => (
                  <TableRow key={o.purchase_order_id}>
                    <TableCell className="font-mono text-xs">
                      {o.order_number ?? "—"}
                      <span className="block text-[10px] text-muted-foreground">
                        {o.request_number ? `من الطلب ${o.request_number}` : ""}
                      </span>
                    </TableCell>
                    <TableCell><PurposeBadge purpose={purposeOf(o.purchase_order_id)} /></TableCell>
                    <TableCell className="text-sm">{o.supplier_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{o.warehouse_name ?? "—"}</TableCell>
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
                    <TableCell className="text-end">
                      {view === "receipts" && can("purchasing.receive") && openStatuses.includes(o.status) && (
                        <Button size="sm" variant="outline" onClick={() => setReceiving(o)}>
                          <PackageCheck className="h-3.5 w-3.5" />
                          استلام
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {shownOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      {view === "receipts" ? "لا أوامر تنتظر الاستلام." : "لا أوامر شراء لهذه الجهة."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {view === "receipts" && (
        <>
          <DraftReceiptsCard />
          <PostedReceiptsCard onInvoice={(id) => {
            const number = window.prompt("رقم فاتورة المورد؟") ?? "";
            if (!number.trim()) return;
            invoiceIt.mutate({ receiptId: id, number: number.trim() });
          }} />
        </>
      )}

      {view === "orders" && (
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
                  {pendingRows.map((p) => (
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
                  {pendingRows.length === 0 && (
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
      )}

      <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} />
    </div>
  );
}

/**
 * مستندات الاستلام التي بقيت مسوّدة.
 *
 * **لماذا وُجدت هذه البطاقة**: إنشاء مستند الاستلام وترحيله ثلاث عمليات غير
 * ذرّية (رأس، بنود، `app_post_goods_receipt`)، فرفض الترحيل — صنفٌ يُتتبَّع
 * بالصلاحية بلا تاريخ انتهاء، أو استلام زائد بلا صلاحية — يترك مستندًا
 * بحالة `draft` لا يظهر في أي شاشة (بطاقة «الاستلامات المرحَّلة» ترشِّح
 * `posted`) ولا يمكن حذفه (`trg_block_delete_goods_receipts`). فكانت هذه
 * المستندات تتراكم غير مرئية بينما يعيد المستخدم الإدخال فيُنشئ مستندًا آخر.
 *
 * الإلغاء لا الحذف: القاعدة تسمح بحذف المسوّدة، لكن مستندًا مخزنيًّا لا يُمحى —
 * يُلغى بسببٍ مكتوب فيبقى أثره.
 *
 * البطاقة تختفي حين لا توجد مسوّدات: وجودها الدائم يوحي بأن المسوّدات حالة
 * طبيعية، وهي ليست كذلك.
 */
function DraftReceiptsCard() {
  const { organization } = useOrganizationAccess();
  const purposeFilter = usePurposeFilter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const drafts = useQuery({
    queryKey: ["goods-receipts-draft", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("id, receipt_number, received_at, delivery_note_ref, purchase_purpose, distributor:distributors(name_ar), goods_receipt_items(id, qty_received, item:items(name_ar))")
        .eq("organization_id", organization!.id)
        .eq("status", "draft")
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const cancelReceipt = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_reason: reason,
        })
        .eq("id", id)
        // شرط الحالة يمنع إلغاء مستند رحّله غيرك بين آخر تحميل والضغط
        .eq("status", "draft")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("لم يُلغَ المستند — قد يكون رُحّل من مستخدم آخر أو لا تسمح صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts-draft", organization?.id] });
      toast({ title: "أُلغي مستند الاستلام" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الإلغاء",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const draftRows = (drafts.data ?? []).filter((g) => matchesPurpose(purposeFilter, g.purchase_purpose));
  if (drafts.isLoading || draftRows.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">مستندات استلام مسوّدة</CardTitle>
        <CardDescription>
          هذه المستندات **لم تدخل المخزون**: أُنشئت ثم رفضت القاعدة ترحيلها. صحّح البيانات
          واستلم من جديد، ثم ألغِ المسوّدة حتى لا تبقى معلَّقة.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المستند</TableHead>
              <TableHead>الجهة</TableHead>
              <TableHead>المورد</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>البنود</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {draftRows.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-mono text-xs">
                  {g.receipt_number ?? g.id.slice(0, 8)}
                  {g.delivery_note_ref && (
                    <span className="block text-[10px] text-muted-foreground">
                      إشعار {g.delivery_note_ref}
                    </span>
                  )}
                </TableCell>
                <TableCell><PurposeBadge purpose={g.purchase_purpose} /></TableCell>
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
                <TableCell className="text-end">
                  {can("purchasing.receive") && (
                    <Button size="sm" variant="outline" disabled={cancelReceipt.isPending}
                            onClick={() => {
                              const reason = window.prompt("سبب إلغاء المستند؟") ?? "";
                              if (!reason.trim()) return;
                              cancelReceipt.mutate({ id: g.id, reason: reason.trim() });
                            }}>
                      <XCircle className="h-3.5 w-3.5" />
                      إلغاء المستند
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
  const purposeFilter = usePurposeFilter();
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

  const postedRows = (receipts.data ?? []).filter((g) => matchesPurpose(purposeFilter, g.purchase_purpose));

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
                <TableHead>الجهة</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>البنود</TableHead>
                <TableHead>الفاتورة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {postedRows.map((g) => {
                const inv = byReceipt[g.id];
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-xs">{g.receipt_number ?? "—"}</TableCell>
                    <TableCell><PurposeBadge purpose={g.purchase_purpose} /></TableCell>
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
                    <TableCell className="text-end">
                      {!inv && can("purchasing.invoice") && (
                        <Button size="sm" variant="outline" onClick={() => onInvoice(g.id)}>
                          تسجيل الفاتورة
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {postedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
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
      // الثلاث خطوات ليست ذرّية عبر PostgREST: لو رفضت القاعدة الترحيل بقي
      // المستند وبنوده مُدرَجين بحالة `draft`. الرسالة تقول ذلك صراحةً وتدلّ
      // على مكان إلغائه، لأن الصمت عنه كان يجعل المستخدم يعيد الإدخال فيُنشئ
      // مستندًا ثانيًا، والمسوّدات تتراكم بلا شاشة تراها ولا إمكان حذفها.
      if (postError)
        throw new Error(
          `${postError.message} — بقي مستند الاستلام مسوّدةً (${number.trim() || gr.id.slice(0, 8)})؛ صحّح البيانات ثم ألغِه من بطاقة «مستندات استلام مسوّدة» حتى لا يتراكم.`,
        );
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["pending-receipts", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts-draft", organization?.id] });
      setLines({}); setNumber(""); setDeliveryRef("");
      onClose();
      toast({
        title: "رُحّل الاستلام إلى المخزون",
        description: `${count} بندًا — أُنشئت تشغيلاتها بتكلفتها`,
      });
    },
    onError: (error: unknown) => {
      // المسوّدة الناتجة عن الفشل يجب أن تظهر فورًا في بطاقة المسوّدات
      queryClient.invalidateQueries({ queryKey: ["goods-receipts-draft", organization?.id] });
      toast({
        variant: "destructive", title: "تعذر الاستلام",
        description: errorMessage(error, "خطأ غير متوقع"),
      });
    },
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
export function SupplierBalancesPanel() {
  const { organization } = useOrganizationAccess();
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

  const [paying, setPaying] = useState<any | null>(null);

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
                    <TableCell className="text-end">
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
                      <TableCell className="text-end">
                        {l.entry_kind === "invoice" && l.status !== "paid" &&
                          can("suppliers.pay") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPaying({
                                invoiceId: l.reference_id,
                                invoiceNumber: l.reference_number,
                                supplierName: selected.supplier_name,
                                distributorId: selected.distributor_id,
                              })}
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

      <PaySupplierDialog invoice={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

/**
 * نافذة سداد فاتورة مورد.
 *
 * **لماذا كانت الحالة السابقة خطأً**: الزرّ كان يسأل عن المبلغ بـ
 * `window.prompt` ثم يأخذ `payMethods.data[0]` — أوّل صفٍّ يعود من استعلام بلا
 * `order`. أي أن طريقة الدفع المسجَّلة في السند لم يخترها أحد: من يدفع نقدًا قد
 * يُسجَّل له «تحويل بنكي»، فيكذب كشف حساب المورد والسجل المالي ولا شيء في
 * الشاشة يُظهر ما اختاره النظام. والاستعلام لم يكن مقيَّدًا بالمنشأة، فمن يعمل
 * في منشأتين كان يرى طرق دفع منشأة أخرى مخلوطةً بطرقه.
 *
 * القيم النظامية في `v_reference_data` تحمل `organization_id = null`، فالتقييد
 * هو «بلا منشأة أو منشأتي» لا «منشأتي» وحدها.
 */
export function PaySupplierDialog({ invoice, onClose }: { invoice: any | null; onClose: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const payMethods = useQuery({
    queryKey: ["pc-payment-methods", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_data")
        .select("value_id, code, name_ar, category_key, is_disabled, organization_id, sort_order")
        .eq("category_key", "payment_methods")
        .eq("is_disabled", false)
        .or(`organization_id.is.null,organization_id.eq.${organization!.id}`)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const registers = useQuery({
    queryKey: ["pc-cash-registers", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name, is_disabled")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // المتبقّي يُقرأ من الفاتورة نفسها لا من كشف الحساب: العرض يُظهر المدين ولا
  // يُظهر ما سُدّد منه، والدالّة ترفض الدفع فوق المستحقّ — فإظهار الرقم قبل
  // الكتابة أصدق من رسالة خطأ بعدها.
  const invoiceRow = useQuery({
    queryKey: ["pc-invoice-due", invoice?.invoiceId],
    enabled: Boolean(invoice?.invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, net_amount, paid_amount, status")
        .eq("id", invoice!.invoiceId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
  const due = invoiceRow.data
    ? Number(invoiceRow.data.net_amount ?? 0) - Number(invoiceRow.data.paid_amount ?? 0)
    : null;

  const selectedMethod = (payMethods.data ?? []).find((m) => m.value_id === methodId);
  const isCash = selectedMethod?.code === "cash";

  const pay = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة محدَّدة");
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
      if (!methodId) throw new Error("اختر طريقة الدفع");
      const { error } = await supabase.rpc("app_pay_supplier_invoice", {
        p_invoice_id: invoice.invoiceId,
        p_amount: value,
        p_payment_method_value_id: methodId,
        // الصندوق يُمرَّر للنقدي فقط: تمريره لتحويل بنكي يُقيّد حركة على صندوق
        // لم يدخله شيء.
        p_cash_register_id: isCash ? registerId || null : null,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-balances", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger", invoice?.distributorId] });
      queryClient.invalidateQueries({ queryKey: ["pc-invoice-due", invoice?.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      toast({ title: "سُجّل السداد" });
      setAmount(""); setMethodId(""); setRegisterId(""); setReference(""); setNote("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر السداد",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>سداد فاتورة {invoice?.invoiceNumber ?? ""}</DialogTitle>
          <DialogDescription>
            {invoice?.supplierName ?? ""}
            {due !== null ? ` — المتبقّي ${due.toLocaleString("ar-SA")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ *</Label>
            <Input type="number" min={0} step="0.01" value={amount}
                   onChange={(e) => setAmount(e.target.value)} autoFocus />
            {due !== null && due > 0 && (
              <Button size="sm" variant="ghost" className="self-start"
                      onClick={() => setAmount(String(due))}>
                سدّد المتبقّي كاملًا
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>طريقة الدفع *</Label>
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر طريقة الدفع" />
              </SelectTrigger>
              <SelectContent>
                {(payMethods.data ?? []).map((m) => (
                  <SelectItem key={m.value_id} value={m.value_id}>{m.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!payMethods.isLoading && (payMethods.data ?? []).length === 0 && (
              <p className="text-xs text-destructive">
                لا طريقة دفع مُعرَّفة — أضفها من إعدادات البيانات المرجعية أولًا.
              </p>
            )}
          </div>
          {isCash && (
            <div className="flex flex-col gap-1.5">
              <Label>الصندوق</Label>
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الصندوق الذي خرج منه المبلغ" />
                </SelectTrigger>
                <SelectContent>
                  {(registers.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>المرجع</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)}
                   placeholder="رقم الحوالة أو الشيك" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!amount || !methodId || pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? "جارٍ التسجيل..." : "تسجيل السداد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
export function ReturnsAndCostsPanel() {
  const { organization } = useOrganizationAccess();
  const purposeFilter = usePurposeFilter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [returnOpen, setReturnOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

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
      description: errorMessage(error, "خطأ غير متوقع"),
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

  const returnRows = (returns.data ?? []).filter((r) => matchesPurpose(purposeFilter, r.purchase_purpose));

  const EXPENSE_TYPES: Record<string, string> = {
    shipping: "شحن", customs: "تخليص جمركي", insurance: "تأمين نقل",
    handling: "مناولة", other: "أخرى",
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-base">مرتجعات المشتريات</CardTitle>
            <CardDescription>
              المرتجع يخرج من **التشغيلة نفسها** التي دخلت، ولا يتجاوز رصيدها، ولا يُرحَّل مرّتين.
            </CardDescription>
          </div>
          {can("purchasing.return") && (
            <Button size="sm" onClick={() => setReturnOpen(true)}>
              <Plus className="h-4 w-4" />
              مرتجع جديد
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {returns.isLoading && <Skeleton className="h-24 w-full" />}
          {!returns.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>البنود</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.return_number ?? "—"}</TableCell>
                    <TableCell><PurposeBadge purpose={r.purchase_purpose} /></TableCell>
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
                    <TableCell className="text-end">
                      {r.status === "draft" && can("purchasing.return") && (
                        <Button size="sm" variant="outline" disabled={postReturn.isPending}
                                onClick={() => postReturn.mutate(r.id)}>
                          ترحيل
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {returnRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      لا مرتجعات مسجّلة لهذه الجهة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-base">مصروفات الشراء الإضافية</CardTitle>
            <CardDescription>
              الشحن والتخليص تُوزَّع على التشغيلات فتصير التكلفة **واصلةً** لا سعرَ فاتورة.
              الشحن يُوزَّع بالكمّية عادةً، والتخليص بالقيمة.
            </CardDescription>
          </div>
          {can("purchasing.invoice") && (
            <Button size="sm" onClick={() => setExpenseOpen(true)}>
              <Plus className="h-4 w-4" />
              مصروف شراء جديد
            </Button>
          )}
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
                    <TableCell className="text-end">
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

      <NewPurchaseReturnDialog open={returnOpen} onOpenChange={setReturnOpen} />
      <NewPurchaseExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} />
    </div>
  );
}

/**
 * الاستلامات المرحَّلة — مصدرُ كل مرتجع ومصروف.
 *
 * المرتجع والمصروف كلاهما يُنسَب إلى مستند استلام لا إلى أمر شراء: التشغيلات
 * التي ستخرج بضاعتها أو ترتفع تكلفتها أُنشئت بالاستلام، و`app_allocate_purchase_expense`
 * ترفض مصروفًا بلا `goods_receipt_id` صراحةً.
 */
function usePostedReceipts(orgId: string | undefined) {
  return useQuery({
    queryKey: ["posted-receipts-picker", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("id, receipt_number, received_at, branch_id, warehouse_id, distributor_id, distributor:distributors(name_ar)")
        .eq("organization_id", orgId)
        .eq("status", "posted")
        .order("received_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/**
 * مرتجع مشتريات جديد.
 *
 * **لماذا لم يكن التبويب صادقًا قبل هذا**: جدولا المرتجعات والمصروفات كانا
 * للعرض فقط ولا مسار إنشاء لهما في العميل كلّه، فيظلّان «لا مرتجعات مسجّلة»
 * أبدًا وزرّا «ترحيل» و«توزيع على التكلفة» لا يظهران قطّ — أي أن إرجاع بضاعة
 * لمورد وتحميل الشحن على التكلفة كانا مستحيلين، فتبقى تكلفة المخزون أقلّ من
 * الحقيقة والهامش يبدو أكبر ممّا هو.
 *
 * المستند يُنشأ **مسوّدةً** ولا يُرحَّل هنا: الترحيل زرٌّ قائم في الجدول يستدعي
 * `app_post_purchase_return` وهي وحدها من تكتب حركة الخروج وتفحص رصيد
 * التشغيلة. ولو رُحّل من هنا لصار الإنشاء والترحيل عمليتين غير ذرّيتين تتركان
 * مستندًا يتيمًا عند فشل الثانية — نفس الخلل الذي في مستند الاستلام.
 */
function NewPurchaseReturnDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // المصدر: فاتورة شراء مباشرة (0228) — وهي الطريقة المعتمدة الآن — أو مستند
  // استلام من دورة الشراء السابقة.
  const [source, setSource] = useState<"invoice" | "receipt">("invoice");
  const receipts = usePostedReceipts(open && source === "receipt" ? organization?.id : undefined);
  const [sourceId, setSourceId] = useState("");
  const [returnNumber, setReturnNumber] = useState("");
  const [reason, setReason] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});

  const invoices = useQuery({
    queryKey: ["direct-invoices-for-return", organization?.id],
    enabled: open && source === "invoice" && Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_date, branch_id, warehouse_id, distributor_id, distributor:distributors(name_ar)")
        .eq("organization_id", organization!.id)
        .is("goods_receipt_id", null)
        .neq("status", "cancelled")
        .order("invoice_date", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r, distributor: Array.isArray(r.distributor) ? r.distributor[0] : r.distributor,
      })) as any[];
    },
  });

  const receipt = (receipts.data ?? []).find((r) => r.id === sourceId);
  const invoice = (invoices.data ?? []).find((r) => r.id === sourceId);
  const header = source === "invoice" ? invoice : receipt;

  /** بنود المصدر بشكلٍ واحد: الصنف، المستلَم، التشغيلة ورصيدها، التكلفة. */
  type ReturnLine = {
    id: string; item_id: string; name: string; received: number;
    lot_id: string | null; lot_number: string | null; qty_remaining: number | null;
    unit_cost: number; vat_rate: number; receipt_item_id: string | null;
  };

  const sourceLines = useQuery({
    queryKey: ["return-source-lines", source, sourceId],
    enabled: Boolean(sourceId) && Boolean(header),
    queryFn: async (): Promise<ReturnLine[]> => {
      if (source === "receipt") {
        const { data, error } = await supabase
          .from("goods_receipt_items")
          .select("id, item_id, qty_received, free_qty, unit_cost, lot_id, item:items(name_ar), lot:inventory_lots(lot_number, qty_remaining, expiry_date)")
          .eq("goods_receipt_id", sourceId);
        if (error) throw error;
        return ((data ?? []) as any[]).map((li) => {
          const lot = Array.isArray(li.lot) ? li.lot[0] : li.lot;
          const item = Array.isArray(li.item) ? li.item[0] : li.item;
          return {
            id: li.id, item_id: li.item_id, name: item?.name_ar ?? "—",
            received: Number(li.qty_received ?? 0) + Number(li.free_qty ?? 0),
            lot_id: li.lot_id, lot_number: lot?.lot_number ?? null,
            qty_remaining: lot ? Number(lot.qty_remaining ?? 0) : null,
            unit_cost: Number(li.unit_cost ?? 0), vat_rate: 0, receipt_item_id: li.id,
          };
        });
      }
      const { data: items, error } = await supabase
        .from("purchase_invoice_items")
        .select("id, item_id, qty, free_qty, vat_rate, item:items(name_ar)")
        .eq("purchase_invoice_id", sourceId);
      if (error) throw error;
      const ids = ((items ?? []) as any[]).map((i) => i.id);
      // تشغيلة كلّ بند: التي تحمل رقمه في مستودع الفاتورة — المرتجع يخرج منها هي.
      const { data: lots, error: lotsError } = ids.length
        ? await supabase
            .from("inventory_lots")
            .select("id, lot_number, qty_remaining, unit_cost, purchase_invoice_item_id")
            .in("purchase_invoice_item_id", ids)
            .eq("warehouse_id", invoice!.warehouse_id)
        : { data: [], error: null };
      if (lotsError) throw lotsError;
      const lotByLine = new Map(((lots ?? []) as any[]).map((l) => [l.purchase_invoice_item_id, l]));
      return ((items ?? []) as any[]).map((li) => {
        const lot = lotByLine.get(li.id);
        const item = Array.isArray(li.item) ? li.item[0] : li.item;
        return {
          id: li.id, item_id: li.item_id, name: item?.name_ar ?? "—",
          received: Number(li.qty ?? 0) + Number(li.free_qty ?? 0),
          lot_id: lot?.id ?? null, lot_number: lot?.lot_number ?? null,
          qty_remaining: lot ? Number(lot.qty_remaining ?? 0) : null,
          unit_cost: Number(lot?.unit_cost ?? 0), vat_rate: Number(li.vat_rate ?? 0),
          receipt_item_id: null,
        };
      });
    },
  });

  const reset = () => {
    setSourceId(""); setReturnNumber(""); setReason(""); setQtyByLine({});
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      if (!header) throw new Error(source === "invoice" ? "اختر فاتورة الشراء" : "اختر مستند الاستلام");
      if (!reason.trim()) throw new Error("سبب المرتجع مطلوب");
      const chosen = (sourceLines.data ?? [])
        .map((li) => ({ line: li, qty: Number(qtyByLine[li.id] ?? 0) }))
        .filter((row) => row.qty > 0);
      if (chosen.length === 0) throw new Error("أدخل كمّية مرتجعة لبند واحد على الأقل");
      for (const row of chosen) {
        if (row.qty > row.line.received)
          throw new Error(`مرتجع «${row.line.name}» يتجاوز المستلَم (${row.line.received})`);
        if (source === "invoice" && !row.line.lot_id)
          throw new Error(`«${row.line.name}» بلا تشغيلة في مستودع الفاتورة — لا يُرتجع منها`);
        if (row.line.qty_remaining !== null && row.qty > row.line.qty_remaining)
          throw new Error(`مرتجع «${row.line.name}» يتجاوز المتبقّي في التشغيلة (${row.line.qty_remaining})`);
      }

      const { data: created, error } = await supabase
        .from("purchase_returns")
        .insert({
          organization_id: organization.id,
          branch_id: header.branch_id,
          warehouse_id: header.warehouse_id,
          distributor_id: header.distributor_id,
          purchase_invoice_id: source === "invoice" ? header.id : null,
          goods_receipt_id: source === "receipt" ? header.id : null,
          return_number: returnNumber.trim() || null,
          reason: reason.trim(),
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: linesError } = await supabase.from("purchase_return_items").insert(
        chosen.map((row) => {
          const base = Math.round(row.qty * row.line.unit_cost * 100) / 100;
          // ضريبة المدخلات تُردّ بنسبة بند الفاتورة: المورد يُنقص حسابه بالصافي شاملًا الضريبة.
          const vat = Math.round(base * row.line.vat_rate) / 100;
          return {
            organization_id: organization.id,
            purchase_return_id: created.id,
            item_id: row.line.item_id,
            // التشغيلة تُمرَّر كما هي: المرتجع يخرج من الدفعة نفسها التي دخلت،
            // لا من أقرب دفعة انتهاءً — وإلا خرجت بضاعة مورّد آخر.
            lot_id: row.line.lot_id,
            receipt_item_id: row.line.receipt_item_id,
            qty_returned: row.qty,
            unit_cost: row.line.unit_cost,
            vat_rate: row.line.vat_rate,
            vat_amount: vat,
            net_amount: Math.round((base + vat) * 100) / 100,
          };
        }),
      );
      if (linesError) throw linesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns", organization?.id] });
      reset();
      onOpenChange(false);
      toast({
        title: "سُجّل المرتجع مسوّدةً",
        description: "اضغط «ترحيل» في الجدول ليخرج من التشغيلات",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر حفظ المرتجع",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const sourceOptions = source === "invoice" ? invoices : receipts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>مرتجع مشتريات جديد</DialogTitle>
          <DialogDescription>
            يُنشأ مسوّدةً من فاتورة الشراء، ثم يُرحَّل من الجدول فيخرج من تشغيلاتها ويُنقص حساب المورد.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-md border p-1 text-xs">
            {([["invoice", "فاتورة شراء"], ["receipt", "مستند استلام (سابق)"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setSource(key); reset(); }}
                className={`flex-1 rounded px-2 py-1 ${source === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{source === "invoice" ? "فاتورة الشراء *" : "مستند الاستلام *"}</Label>
              <Select value={sourceId} onValueChange={(v) => { setSourceId(v); setQtyByLine({}); }}>
                <SelectTrigger>
                  <SelectValue placeholder={source === "invoice" ? "اختر الفاتورة" : "اختر الاستلام"} />
                </SelectTrigger>
                <SelectContent>
                  {source === "invoice"
                    ? (invoices.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {(r.invoice_number ?? r.id.slice(0, 8))} — {r.distributor?.name_ar ?? "—"} — {r.invoice_date}
                        </SelectItem>
                      ))
                    : (receipts.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {(r.receipt_number ?? r.id.slice(0, 8))} — {r.distributor?.name_ar ?? "—"}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              {!sourceOptions.isLoading && (sourceOptions.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {source === "invoice"
                    ? "لا فواتير شراء — المرتجع لا يُنشأ إلا من بضاعة دخلت فعلًا."
                    : "لا استلامات مرحَّلة."}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم المرتجع</Label>
              <Input value={returnNumber} onChange={(e) => setReturnNumber(e.target.value)} />
            </div>
          </div>

          {sourceId && (
            <div className="max-h-72 overflow-y-auto">
              {sourceLines.isLoading && <Skeleton className="h-20 w-full" />}
              {(sourceLines.data ?? []).map((li) => (
                <div key={li.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="flex-1 text-sm font-medium">{li.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    المستلَم {li.received}
                    {li.lot_id
                      ? ` · تشغيلة ${li.lot_number ?? "بلا رقم"} متبقٍّ ${li.qty_remaining ?? 0}`
                      : " · بلا تشغيلة"}
                  </span>
                  <Input type="number" min={0} max={Math.min(li.received, li.qty_remaining ?? li.received)}
                         className="w-24" placeholder="المرتجع"
                         value={qtyByLine[li.id] ?? ""}
                         onChange={(e) => setQtyByLine((s) => ({ ...s, [li.id]: e.target.value }))} />
                </div>
              ))}
              {!sourceLines.isLoading && (sourceLines.data ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">لا بنود في هذا المستند.</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>سبب المرتجع *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="مثال: تلف بالنقل، صلاحية قريبة، صنف غير مطابق" />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!sourceId || !reason.trim() || create.isPending}
                  onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ المرتجع مسوّدةً"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * مصروف شراء جديد (شحن/تخليص/تأمين/مناولة).
 *
 * يُنشأ **غير موزَّع**، والتوزيع زرٌّ قائم يستدعي
 * `app_allocate_purchase_expense` — وهي من ترفع تكلفة كل تشغيلة وتمنع التوزيع
 * مرّتين. الربط بمستند الاستلام إلزامي لأن الدالّة ترفض المصروف بلا استلام:
 * بلا استلام لا يُعرف على أيّ تشغيلات يُوزَّع.
 */
function NewPurchaseExpenseDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const receipts = usePostedReceipts(organization?.id);
  const [receiptId, setReceiptId] = useState("");
  const [expenseType, setExpenseType] = useState("shipping");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("by_qty");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");

  const receipt = (receipts.data ?? []).find((r) => r.id === receiptId);

  // فاتورة المورد المبنية على هذا الاستلام إن وُجدت: ربط المصروف بها هو ما
  // يجعل `expenses_amount` في الفاتورة يطابق ما وُزّع فعلًا.
  const receiptInvoice = useQuery({
    queryKey: ["receipt-invoice-for-expense", receiptId],
    enabled: Boolean(receiptId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number")
        .eq("goods_receipt_id", receiptId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      if (!receipt) throw new Error("اختر مستند الاستلام");
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
      const { error } = await supabase.from("purchase_expenses").insert({
        organization_id: organization.id,
        goods_receipt_id: receipt.id,
        purchase_invoice_id: receiptInvoice.data?.id ?? null,
        distributor_id: receipt.distributor_id,
        expense_type: expenseType,
        amount: value,
        allocation_method: method,
        reference_number: referenceNumber.trim() || null,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-expenses", organization?.id] });
      setReceiptId(""); setAmount(""); setReferenceNumber(""); setNote("");
      onOpenChange(false);
      toast({
        title: "سُجّل المصروف",
        description: "اضغط «توزيع على التكلفة» ليرتفع سعر تكلفة تشغيلاته",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر حفظ المصروف",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>مصروف شراء جديد</DialogTitle>
          <DialogDescription>
            يُسجَّل غير موزَّع، ثم يُوزَّع من الجدول على تشغيلات الاستلام فتصير التكلفة واصلة.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>مستند الاستلام *</Label>
            <Select value={receiptId} onValueChange={setReceiptId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الاستلام" />
              </SelectTrigger>
              <SelectContent>
                {(receipts.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {(r.receipt_number ?? r.id.slice(0, 8))} — {r.distributor?.name_ar ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {receiptId && receiptInvoice.data && (
              <p className="text-xs text-muted-foreground">
                سيُضاف المبلغ إلى مصروفات الفاتورة {receiptInvoice.data.invoice_number ?? ""} عند التوزيع.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>النوع *</Label>
              <Select value={expenseType} onValueChange={setExpenseType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shipping">شحن</SelectItem>
                  <SelectItem value="customs">تخليص جمركي</SelectItem>
                  <SelectItem value="insurance">تأمين نقل</SelectItem>
                  <SelectItem value="handling">مناولة</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المبلغ *</Label>
              <Input type="number" min={0} step="0.01" value={amount}
                     onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>طريقة التوزيع *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="by_qty">بالكمّية (الشحن والمناولة)</SelectItem>
                <SelectItem value="by_value">بالقيمة (التخليص والتأمين)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المستند المرجعي</Label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
                     placeholder="رقم فاتورة الشحن" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ملاحظة</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!receiptId || !amount || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ المصروف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
