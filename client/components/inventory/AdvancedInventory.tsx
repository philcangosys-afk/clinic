import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight, ClipboardCheck, MapPin, RefreshCcw, ShieldAlert, Sliders, Trash2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/error-message";

/**
 * المخزون المتقدم — المرحلة 18.
 *
 * ثلاثة أشياء لم تكن موجودة: **تحويلٌ يُنفَّذ** (لا يُسجَّل فقط)، و**جردٌ
 * يُسوّي بحركة**، و**حدودٌ لكل مستودع**. وكلّها تمرّ بدوالّ القاعدة، فلا
 * مسار يعدّل الرصيد من وراء سجلّ الحركات.
 */

const TRANSFER_STATUS: Record<string, { label: string; variant: any }> = {
  draft:     { label: "مسوّدة",   variant: "secondary" },
  requested: { label: "مطلوب",    variant: "default" },
  approved:  { label: "معتمَد",   variant: "success" },
  rejected:  { label: "مرفوض",    variant: "destructive" },
  shipped:   { label: "في الطريق", variant: "default" },
  received:  { label: "مستلَم",   variant: "success" },
  cancelled: { label: "ملغى",     variant: "destructive" },
};

const COUNT_STATUS: Record<string, { label: string; variant: any }> = {
  open:      { label: "مفتوح",   variant: "default" },
  counted:   { label: "معدود",   variant: "default" },
  approved:  { label: "معتمَد",  variant: "success" },
  posted:    { label: "مرحَّل",   variant: "outline" },
  cancelled: { label: "ملغى",    variant: "destructive" },
};

export default function AdvancedInventory() {
  return (
    <Tabs defaultValue="transfers">
      <TabsList>
        <TabsTrigger value="transfers">دورة التحويل</TabsTrigger>
        <TabsTrigger value="counts">الجرد والتسويات</TabsTrigger>
        <TabsTrigger value="reorder">حدود المخزون وإعادة الطلب</TabsTrigger>
        <TabsTrigger value="aging">الراكد والتالف</TabsTrigger>
        <TabsTrigger value="locations">المواقع</TabsTrigger>
      </TabsList>
      <TabsContent value="transfers" className="mt-4"><TransfersPanel /></TabsContent>
      <TabsContent value="counts" className="mt-4"><CountsPanel /></TabsContent>
      <TabsContent value="reorder" className="mt-4"><ReorderPanel /></TabsContent>
      <TabsContent value="aging" className="mt-4"><AgingPanel /></TabsContent>
      <TabsContent value="locations" className="mt-4"><LocationsPanel /></TabsContent>
    </Tabs>
  );
}

function useWarehouseList(orgId: string | undefined) {
  return useQuery({
    queryKey: ["ai-warehouses", orgId],
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

/* ══════════════════════════════════════════════════════════════════════════
 * دورة التحويل
 * ════════════════════════════════════════════════════════════════════════ */
function TransfersPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const transfers = useQuery({
    queryKey: ["transfer-pipeline", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_transfer_pipeline")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transfer-pipeline", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["stock-on-hand", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_stock_transfer", {
        p_transfer_id: id, p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "اعتُمد التحويل" }); },
    onError: fail("تعذر الاعتماد"),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reject_stock_transfer", {
        p_transfer_id: id, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "رُفض التحويل" }); },
    onError: fail("تعذر الرفض"),
  });

  const ship = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_ship_stock_transfer", {
        p_transfer_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "شُحن التحويل",
        description: "خرج من المصدر بالأقرب انتهاءً أوّلًا، وهو الآن في الطريق",
      });
    },
    onError: fail("تعذر الشحن"),
  });

  const receive = useMutation({
    mutationFn: async ({ id, lines }: { id: string; lines: any[] | null }) => {
      const { data, error } = await supabase.rpc("app_receive_stock_transfer", {
        p_transfer_id: id, p_lines: lines,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "استُلم التحويل", description: "دخل رصيد الوجهة بتشغيلته وصلاحيتها" });
    },
    onError: fail("تعذر الاستلام"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4" />
            دورة التحويل المخزني
          </CardTitle>
          <CardDescription>
            طلب ← اعتماد ← شحن ← استلام. **البضاعة في الطريق خارج رصيد الطرفين** فلا
            تُحسب مرّتين، والنقص عند الاستلام لا يمرّ بلا ملاحظة تفسّره.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => transfers.refetch()}>
          <RefreshCcw className="h-4 w-4" />
          تحديث
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {transfers.isLoading && <Skeleton className="h-40 w-full" />}
        {!transfers.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>من ← إلى</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>المطلوب</TableHead>
                <TableHead>المشحون</TableHead>
                <TableHead>المستلَم</TableHead>
                <TableHead>في الطريق</TableHead>
                <TableHead>السبب</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(transfers.data ?? []).map((t) => (
                <TableRow key={t.transfer_id}>
                  <TableCell className="font-mono text-xs">{t.transfer_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {t.from_warehouse_name} ← {t.to_warehouse_name}
                    <span className="block text-[10px] text-muted-foreground">
                      {t.from_branch_name} ← {t.to_branch_name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TRANSFER_STATUS[t.status]?.variant ?? "secondary"}>
                      {TRANSFER_STATUS[t.status]?.label ?? t.status}
                    </Badge>
                    {t.transit_hours && (
                      <span className="block text-[10px] text-muted-foreground">
                        عبور {t.transit_hours} ساعة
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.qty_requested ?? 0}</TableCell>
                  <TableCell className="font-mono text-xs">{t.qty_shipped ?? 0}</TableCell>
                  <TableCell className="font-mono text-xs">{t.qty_received ?? 0}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {Number(t.qty_in_transit ?? 0) > 0 ? (
                      <Badge variant="default">{t.qty_in_transit}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                    {t.rejected_reason ?? t.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      {["draft", "requested"].includes(t.status) &&
                        can("inventory.transfer_approve") && (
                          <>
                            <Button size="sm" variant="ghost" disabled={approve.isPending}
                                    onClick={() => approve.mutate(t.transfer_id)}>
                              اعتماد
                            </Button>
                            <Button size="sm" variant="ghost" disabled={reject.isPending}
                                    onClick={() => {
                                      const reason = window.prompt("سبب الرفض؟") ?? "";
                                      if (!reason.trim()) return;
                                      reject.mutate({ id: t.transfer_id, reason: reason.trim() });
                                    }}>
                              رفض
                            </Button>
                          </>
                        )}
                      {t.status === "approved" && can("inventory.transfer_ship") && (
                        <Button size="sm" variant="outline" disabled={ship.isPending}
                                onClick={() => ship.mutate(t.transfer_id)}>
                          شحن
                        </Button>
                      )}
                      {t.status === "shipped" && can("inventory.transfer_receive") && (
                        <Button size="sm" variant="outline" disabled={receive.isPending}
                                onClick={() => receive.mutate({ id: t.transfer_id, lines: null })}>
                          استلام كامل
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(transfers.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    لا تحويلات مسجّلة.
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

/* ══════════════════════════════════════════════════════════════════════════
 * الجرد
 * ════════════════════════════════════════════════════════════════════════ */
function CountsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const warehouses = useWarehouseList(organization?.id);

  const [warehouseId, setWarehouseId] = useState("");
  const [countType, setCountType] = useState("periodic");
  const [countNumber, setCountNumber] = useState("");
  const [openCount, setOpenCount] = useState<string | null>(null);

  const counts = useQuery({
    queryKey: ["stock-counts", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("*, warehouse:warehouses(name)")
        .eq("organization_id", organization!.id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const lines = useQuery({
    queryKey: ["count-lines", openCount],
    enabled: Boolean(openCount),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_stock_count_variance")
        .select("*")
        .eq("stock_count_id", openCount)
        .order("item_name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stock-counts", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["count-lines", openCount] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_start_stock_count", {
        p_warehouse_id: warehouseId,
        p_count_type: countType,
        p_number: countNumber.trim() || null,
        p_item_ids: null,
        p_scope_note: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      invalidate();
      setOpenCount(id);
      setCountNumber("");
      toast({
        title: "فُتح الجرد",
        description: "جُمّد الرصيد الدفتري لحظة الفتح — الصرف أثناء العدّ لن يظهر عجزًا",
      });
    },
    onError: fail("تعذر فتح الجرد"),
  });

  const record = useMutation({
    mutationFn: async ({ id, qty, reason }: { id: string; qty: number; reason: string }) => {
      const { error } = await supabase.rpc("app_record_stock_count_line", {
        p_count_item_id: id, p_counted_qty: qty, p_reason: reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: fail("تعذر تسجيل العدّ"),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_stock_count", { p_count_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "اعتُمد الجرد" }); },
    onError: fail("تعذر الاعتماد"),
  });

  const post = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_post_stock_count", { p_count_id: id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      invalidate();
      toast({
        title: "رُحّلت التسوية",
        description: `${n} فرقًا سُوّي بحركة تحمل سببها`,
      });
    },
    onError: fail("تعذر الترحيل"),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("inventory.count") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4" />
              فتح جرد
            </CardTitle>
            <CardDescription>
              الرصيد الدفتري يُجمَّد لحظة الفتح. جردٌ مفتوح واحد لكل مستودع، ومن عدّ لا يعتمد.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-48 flex-col gap-1.5">
              <Label>المستودع *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-40 flex-col gap-1.5">
              <Label>نوع الجرد</Label>
              <Select value={countType} onValueChange={setCountType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="periodic">دوري</SelectItem>
                  <SelectItem value="surprise">مفاجئ</SelectItem>
                  <SelectItem value="partial">جزئي</SelectItem>
                  <SelectItem value="annual">سنوي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-40 flex-col gap-1.5">
              <Label>رقم الجرد</Label>
              <Input value={countNumber} onChange={(e) => setCountNumber(e.target.value)} />
            </div>
            <Button disabled={!warehouseId || start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "جارٍ الفتح..." : "فتح الجرد"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">عمليات الجرد</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {counts.isLoading && <Skeleton className="h-24 w-full" />}
          {!counts.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>المستودع</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>البدء</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(counts.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.count_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.warehouse?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {c.count_type === "surprise" ? "مفاجئ"
                        : c.count_type === "annual" ? "سنوي"
                        : c.count_type === "partial" ? "جزئي" : "دوري"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={COUNT_STATUS[c.status]?.variant ?? "secondary"}>
                        {COUNT_STATUS[c.status]?.label ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(c.started_at).toLocaleDateString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setOpenCount(c.id)}>
                          البنود
                        </Button>
                        {c.status === "counted" && can("inventory.count_approve") && (
                          <Button size="sm" variant="outline" disabled={approve.isPending}
                                  onClick={() => approve.mutate(c.id)}>
                            اعتماد
                          </Button>
                        )}
                        {c.status === "approved" && can("inventory.count_approve") && (
                          <Button size="sm" variant="outline" disabled={post.isPending}
                                  onClick={() => post.mutate(c.id)}>
                            ترحيل التسوية
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(counts.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا عمليات جرد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openCount && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">بنود الجرد</CardTitle>
            <CardDescription>
              **الفرق لا يُقبل بلا سبب.** جردٌ يُقفل بفروقٍ بلا أسباب يحوّل العجز إلى رقم مقبول.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {lines.isLoading && <Skeleton className="h-32 w-full" />}
            {!lines.isLoading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>التشغيلة</TableHead>
                    <TableHead>الموقع</TableHead>
                    <TableHead>الدفتري</TableHead>
                    <TableHead>المعدود</TableHead>
                    <TableHead>الفرق</TableHead>
                    <TableHead>قيمة الفرق</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(lines.data ?? []).map((l) => (
                    <TableRow key={l.count_item_id}>
                      <TableCell className="text-sm">{l.item_name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.lot_number ?? "—"}
                        {l.expiry_date && (
                          <span className="block text-[10px] text-muted-foreground">
                            {l.expiry_date}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.location_code ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.system_qty}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.counted_qty ?? <Badge variant="secondary">لم يُعدّ</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {Number(l.variance_qty) !== 0 ? (
                          <Badge variant="destructive">{l.variance_qty}</Badge>
                        ) : (
                          "0"
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {Number(l.variance_value ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                        {l.variance_reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-end">
                        {["open", "counted"].includes(l.status) && can("inventory.count") && (
                          <Button size="sm" variant="ghost" disabled={record.isPending}
                                  onClick={() => {
                                    const qty = window.prompt(
                                      `الكمّية المعدودة لـ ${l.item_name}؟`,
                                      String(l.counted_qty ?? l.system_qty),
                                    );
                                    if (qty === null) return;
                                    const n = Number(qty);
                                    if (Number.isNaN(n) || n < 0) return;
                                    let reason = "";
                                    if (n !== Number(l.system_qty)) {
                                      reason = window.prompt("سبب الفرق؟ (إلزامي)") ?? "";
                                      if (!reason.trim()) return;
                                    }
                                    record.mutate({
                                      id: l.count_item_id, qty: n, reason: reason.trim(),
                                    });
                                  }}>
                            تسجيل العدّ
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(lines.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                        لا بنود في هذا الجرد.
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
 * حدود المخزون وإعادة الطلب
 * ════════════════════════════════════════════════════════════════════════ */
function ReorderPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const warehouses = useWarehouseList(organization?.id);

  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [minQty, setMinQty] = useState("");
  const [maxQty, setMaxQty] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const [leadDays, setLeadDays] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const suppliers = useQuery({
    queryKey: ["ai-suppliers", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name_ar, is_disabled, is_archived")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const items = useQuery({
    queryKey: ["ai-items", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, track_inventory, is_disabled, is_archived")
        .eq("organization_id", organization!.id)
        .eq("track_inventory", true)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const suggestions = useQuery({
    queryKey: ["reorder-suggestions", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reorder_suggestions")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("needs_reorder", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("item_stock_settings").upsert(
        {
          organization_id: organization!.id,
          warehouse_id: warehouseId,
          item_id: itemId,
          min_qty: Number(minQty) || 0,
          max_qty: maxQty ? Number(maxQty) : null,
          reorder_level: Number(reorderLevel) || 0,
          reorder_qty: reorderQty ? Number(reorderQty) : null,
          // مهلة التوريد والمورد المفضّل: بدونهما يُطلب الصنف متأخّرًا أو من
          // موردٍ يُختار كل مرّة من جديد
          lead_time_days: leadDays ? Number(leadDays) : null,
          preferred_distributor_id: supplierId || null,
        },
        { onConflict: "warehouse_id,item_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reorder-suggestions", organization?.id] });
      setItemId(""); setMinQty(""); setMaxQty(""); setReorderLevel(""); setReorderQty("");
      setLeadDays(""); setSupplierId("");
      toast({ title: "حُفظت الحدود" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {can("inventory.settings") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sliders className="h-4 w-4" />
              حدود صنف في مستودع
            </CardTitle>
            <CardDescription>
              الحدود لكل مستودع على حدة — مستودع الفرع الصغير لا يحتاج ما يحتاجه المركزيّ.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="flex flex-col gap-1.5">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الصنف</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(items.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحدّ الأدنى</Label>
              <Input type="number" min={0} value={minQty}
                     onChange={(e) => setMinQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحدّ الأقصى</Label>
              <Input type="number" min={0} value={maxQty}
                     onChange={(e) => setMaxQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>حدّ إعادة الطلب</Label>
              <Input type="number" min={0} value={reorderLevel}
                     onChange={(e) => setReorderLevel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>كمّية الطلب</Label>
              <Input type="number" min={0} value={reorderQty}
                     onChange={(e) => setReorderQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>مهلة التوريد (يوم)</Label>
              <Input type="number" min={0} value={leadDays}
                     onChange={(e) => setLeadDays(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المورد المفضّل</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
                <SelectContent>
                  {(suppliers.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button disabled={!warehouseId || !itemId || save.isPending}
                      onClick={() => save.mutate()}>
                حفظ
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">اقتراحات إعادة الطلب</CardTitle>
          <CardDescription>
            **المتاح = الرصيد ناقص المحجوز.** صنفٌ رصيده محجوز بالكامل يبدو موجودًا وليس كذلك.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {suggestions.isLoading && <Skeleton className="h-32 w-full" />}
          {!suggestions.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>المحجوز</TableHead>
                  <TableHead>المتاح</TableHead>
                  <TableHead>الأدنى</TableHead>
                  <TableHead>حدّ الطلب</TableHead>
                  <TableHead>المقترح</TableHead>
                  <TableHead>مهلة التوريد</TableHead>
                  <TableHead>المورد المفضّل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(suggestions.data ?? []).map((s) => (
                  <TableRow key={`${s.warehouse_id}-${s.item_id}`}>
                    <TableCell className="text-sm">{s.warehouse_name}</TableCell>
                    <TableCell className="text-sm">
                      {s.item_name}
                      {s.below_minimum && (
                        <Badge variant="destructive" className="ms-2">تحت الأدنى</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.qty_on_hand}</TableCell>
                    <TableCell className="font-mono text-xs">{s.qty_reserved}</TableCell>
                    <TableCell className="font-mono text-xs">{s.available_qty}</TableCell>
                    <TableCell className="font-mono text-xs">{s.min_qty}</TableCell>
                    <TableCell className="font-mono text-xs">{s.reorder_level}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.needs_reorder ? (
                        <Badge variant="destructive">{s.suggested_qty}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.lead_time_days ? `${s.lead_time_days} يومًا` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{s.preferred_supplier_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(suggestions.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                      لا حدود مُعرَّفة بعد. عرّف حدود الأصناف الحرجة أوّلًا.
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

/* ══════════════════════════════════════════════════════════════════════════
 * الراكد والتالف
 * ════════════════════════════════════════════════════════════════════════ */
function AgingPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const aging = useQuery({
    queryKey: ["stock-aging", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_stock_movement_age")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("stock_value", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const lots = useQuery({
    queryKey: ["stock-on-hand", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_stock_on_hand_detailed")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("days_to_expiry", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stock-on-hand", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["stock-aging", organization?.id] });
  };

  const quarantine = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_quarantine_lot", {
        p_lot_id: id, p_reason: reason, p_location_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "حُجرت التشغيلة",
        description: "لا تُصرف ولا تُحوَّل — وتبقى في الرصيد حتى يُسجَّل إتلافها",
      });
    },
    onError: fail("تعذر الحجر"),
  });

  const dispose = useMutation({
    mutationFn: async ({ id, qty, reason }: { id: string; qty: number; reason: string }) => {
      const { error } = await supabase.rpc("app_dispose_lot", {
        p_lot_id: id, p_qty: qty, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "سُجّل الإتلاف", description: "خرج بحركة تحمل سببها" });
    },
    onError: fail("تعذر الإتلاف"),
  });

  const [tracing, setTracing] = useState<any | null>(null);

  const CLASS_VARIANT: Record<string, any> = {
    "نشط": "success", "بطيء": "default", "راكد": "destructive", "راكد تمامًا": "destructive",
  };

  return (
    <div className="flex flex-col gap-4">
      {tracing && <LotTraceCard lot={tracing} onClose={() => setTracing(null)} />}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">حركة المخزون: نشط وبطيء وراكد</CardTitle>
          <CardDescription>
            التصنيف بآخر حركة **خروج** لا بآخر حركة أيًّا كانت — صنفٌ يُستلم شهريًّا ولا
            يُصرف أبدًا ليس نشطًا.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {aging.isLoading && <Skeleton className="h-32 w-full" />}
          {!aging.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>آخر صرف</TableHead>
                  <TableHead>منذ (يوم)</TableHead>
                  <TableHead>التصنيف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aging.data ?? []).map((a) => (
                  <TableRow key={`${a.warehouse_id}-${a.item_id}`}>
                    <TableCell className="text-sm">{a.warehouse_name}</TableCell>
                    <TableCell className="text-sm">{a.item_name}</TableCell>
                    <TableCell className="font-mono text-xs">{a.qty_on_hand}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(a.stock_value ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.last_out_at
                        ? new Date(a.last_out_at).toLocaleDateString("ar-SA-u-nu-latn")
                        : "لم يُصرف قطّ"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.days_since_last_out ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CLASS_VARIANT[a.movement_class] ?? "secondary"}>
                        {a.movement_class}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(aging.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا مخزون.
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
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" />
            التشغيلات بالصلاحية والحجر
          </CardTitle>
          <CardDescription>
            الحجر يمنع الصرف والتحويل **ولا يُخفي الرصيد**؛ الإخراج يكون بإتلافٍ مسجَّل،
            وإلا اختفت البضاعة من الدفاتر بلا حركة.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {lots.isLoading && <Skeleton className="h-32 w-full" />}
          {!lots.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>المستودع / الموقع</TableHead>
                  <TableHead>التشغيلة</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>المتاح</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lots.data ?? []).map((l) => (
                  <TableRow key={l.lot_id}>
                    <TableCell className="text-sm">{l.item_name}</TableCell>
                    <TableCell className="text-sm">
                      {l.warehouse_name}
                      {l.location_code && (
                        <span className="ms-1 font-mono text-xs text-muted-foreground">
                          / {l.location_code}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.lot_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.expiry_date ?? "—"}
                      {l.days_to_expiry !== null && l.days_to_expiry <= 90 && (
                        <Badge variant={l.is_expired ? "destructive" : "default"} className="ms-1">
                          {l.is_expired ? "منتهية" : `${l.days_to_expiry} يومًا`}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.qty_remaining}</TableCell>
                    <TableCell className="font-mono text-xs">{l.available_qty}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(l.stock_value ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={l.lot_status === "available" ? "success" : "destructive"}>
                        {l.lot_status === "available" ? "متاحة"
                          : l.lot_status === "quarantined" ? "محجورة"
                          : l.lot_status === "recalled" ? "مسحوبة" : "منتهية"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {l.lot_status === "available" && can("inventory.count") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => {
                                    const reason = window.prompt("سبب الحجر؟") ?? "";
                                    if (!reason.trim()) return;
                                    quarantine.mutate({ id: l.lot_id, reason: reason.trim() });
                                  }}>
                            حجر
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setTracing(l)}>
                          تتبّع
                        </Button>
                        {can("inventory.count_approve") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => {
                                    const qty = window.prompt(
                                      "كمّية الإتلاف؟", String(l.qty_remaining),
                                    );
                                    if (qty === null || Number(qty) <= 0) return;
                                    const reason = window.prompt("سبب الإتلاف؟") ?? "";
                                    if (!reason.trim()) return;
                                    dispose.mutate({
                                      id: l.lot_id, qty: Number(qty), reason: reason.trim(),
                                    });
                                  }}>
                            <Trash2 className="h-3.5 w-3.5" />
                            إتلاف
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(lots.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                      لا تشغيلات برصيد.
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

/* ══════════════════════════════════════════════════════════════════════════
 * المواقع
 * ════════════════════════════════════════════════════════════════════════ */
function LocationsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const warehouses = useWarehouseList(organization?.id);

  const [warehouseId, setWarehouseId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [locationType, setLocationType] = useState("shelf");
  const [tempControlled, setTempControlled] = useState(false);

  const locations = useQuery({
    queryKey: ["warehouse-locations", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_locations")
        .select("*, warehouse:warehouses(name)")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("code");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("warehouse_locations").insert({
        organization_id: organization!.id,
        warehouse_id: warehouseId,
        code: code.trim(),
        name: name.trim() || null,
        location_type: locationType,
        temperature_controlled: tempControlled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-locations", organization?.id] });
      setCode(""); setName(""); setTempControlled(false);
      toast({ title: "أُضيف الموقع" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const TYPES: Record<string, string> = {
    aisle: "ممرّ", shelf: "رفّ", bin: "صندوق",
    fridge: "ثلاجة", freezer: "مجمّد", quarantine: "حجر",
  };

  return (
    <div className="flex flex-col gap-4">
      {can("inventory.settings") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              موقع تخزين جديد
            </CardTitle>
            <CardDescription>
              موقع «حجر» في كل مستودع يجعل التالف والمنتهي في مكانٍ واحد لا يُصرف منه.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الرمز *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A-01" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الاسم</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>النوع</Label>
              <Select value={locationType} onValueChange={setLocationType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={tempControlled}
                       onChange={(e) => setTempControlled(e.target.checked)} />
                مبرَّد
              </label>
              <Button disabled={!warehouseId || !code.trim() || create.isPending}
                      onClick={() => create.mutate()}>
                إضافة
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مواقع التخزين</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {locations.isLoading && <Skeleton className="h-24 w-full" />}
          {!locations.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الرمز</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>مبرَّد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(locations.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">{l.warehouse?.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.code}</TableCell>
                    <TableCell className="text-sm">{l.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={l.location_type === "quarantine" ? "destructive" : "outline"}>
                        {TYPES[l.location_type] ?? l.location_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {l.temperature_controlled ? "نعم" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(locations.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      لا مواقع مُعرَّفة.
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


/**
 * تتبّع التشغيلة من الاستلام حتى الصرف أو الإتلاف.
 *
 * `app_trace_lot` يعبر التحويل بين الفروع: التحويل يُنشئ تشغيلةً جديدة في
 * الوجهة، فلو اقتصر التتبّع على معرّفٍ واحد لانقطع الخيط عند أوّل تحويل —
 * وهو بالضبط ما يُحتاج إليه عند سحب دفعة معيبة.
 */
function LotTraceCard({ lot, onClose }: { lot: any; onClose: () => void }) {
  const trace = useQuery({
    queryKey: ["lot-trace", lot?.lot_id],
    enabled: Boolean(lot?.lot_id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_trace_lot", { p_lot_id: lot.lot_id });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const KIND: Record<string, string> = {
    purchase_in: "استلام شراء", sale_out: "صرف بيع", return_in: "مرتجع وارد",
    return_out: "مرتجع صادر", transfer_in: "تحويل وارد", transfer_out: "تحويل صادر",
    adjustment_in: "تسوية زيادة", adjustment_out: "تسوية نقص",
    consumption_out: "استهلاك",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">
            تتبّع التشغيلة {lot.lot_number ?? ""} — {lot.item_name}
          </CardTitle>
          <CardDescription>
            من الاستلام حتى الصرف أو الإتلاف، عابرًا التحويلات بين الفروع.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>إغلاق</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {trace.isLoading && <Skeleton className="h-24 w-full" />}
        {!trace.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>الحركة</TableHead>
                <TableHead>الوقت</TableHead>
                <TableHead>الكمّية</TableHead>
                <TableHead>المرجع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(trace.data ?? []).map((s: any) => (
                <TableRow key={`${s.step_order}-${s.occurred_at}`}>
                  <TableCell className="font-mono text-xs">{s.step_order}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={String(s.step_kind).endsWith("_out") ? "destructive" : "success"}>
                      {KIND[s.step_kind] ?? s.step_kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(s.occurred_at).toLocaleString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.qty}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {s.reference || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(trace.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا حركات على هذه التشغيلة.
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
