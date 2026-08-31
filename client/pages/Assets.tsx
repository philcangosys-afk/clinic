import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeftRight, Bell, HardDrive, Plus, RefreshCcw, ShieldCheck, Wrench,
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
 * الأجهزة والأصول والصيانة — المرحلة 21.
 *
 * الجهاز الطبيّ **مورد حجزٍ وأصلٌ يُصان** في آنٍ واحد. الربط بينهما هو ما
 * يجعل إخراج الجهاز من الخدمة يمنع الحجز عليه فورًا — من القاعدة، لا من
 * شاشة تُنسى.
 */

const money = (v: any) =>
  Number(v ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ASSET_STATUS: Record<string, { label: string; variant: any }> = {
  in_service:          { label: "في الخدمة",     variant: "success" },
  under_maintenance:   { label: "تحت الصيانة",   variant: "default" },
  out_of_service:      { label: "خارج الخدمة",   variant: "destructive" },
  reserved_for_repair: { label: "محجوز للإصلاح", variant: "destructive" },
  disposed:            { label: "متخلَّص منه",    variant: "secondary" },
};

const CATEGORIES: Record<string, string> = {
  medical_device: "جهاز طبي",
  lab_device: "جهاز مختبر",
  imaging_device: "جهاز أشعة",
  furniture: "أثاث",
  it_equipment: "تقنية معلومات",
  vehicle: "مركبة",
  other: "أخرى",
};

export default function Assets() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الأجهزة والأصول</h1>
        <p className="text-sm text-muted-foreground">
          سجل الأصول وصيانتها ومعايرتها — الجهاز خارج الخدمة لا يُحجز عليه
        </p>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">سجل الأصول</TabsTrigger>
          <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
          <TabsTrigger value="maintenance">الصيانة</TabsTrigger>
          <TabsTrigger value="calibration">المعايرة</TabsTrigger>
          <TabsTrigger value="depreciation">الإهلاك</TabsTrigger>
        </TabsList>
        <TabsContent value="register" className="mt-4"><RegisterPanel /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><AlertsPanel /></TabsContent>
        <TabsContent value="maintenance" className="mt-4"><MaintenancePanel /></TabsContent>
        <TabsContent value="calibration" className="mt-4"><CalibrationPanel /></TabsContent>
        <TabsContent value="depreciation" className="mt-4"><DepreciationPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function useAssetList(orgId: string | undefined) {
  return useQuery({
    queryKey: ["asset-register", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_asset_register").select("*")
        .eq("organization_id", orgId)
        .order("asset_number");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * سجل الأصول
 * ════════════════════════════════════════════════════════════════════════ */
function RegisterPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState<any | null>(null);
  const [toBranch, setToBranch] = useState("");
  const [toRoom, setToRoom] = useState("");
  const [transferReason, setTransferReason] = useState("");

  const assets = useAssetList(organization?.id);

  const branches = useQuery({
    queryKey: ["as-branches", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name")
        .eq("organization_id", organization!.id).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["asset-register", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["asset-alerts", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const setStatus = useMutation({
    mutationFn: async ({ id, status, reason }: {
      id: string; status: string; reason: string | null;
    }) => {
      const { error } = await supabase.rpc("app_set_asset_status", {
        p_asset_id: id, p_status: status, p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "تغيّرت حالة الجهاز",
        description: "الحجز عليه يتبع حالته تلقائيًّا",
      });
    },
    onError: fail("تعذر التغيير"),
  });

  const reportFault = useMutation({
    mutationFn: async ({ id, description, severity }: {
      id: string; description: string; severity: string;
    }) => {
      const { error } = await supabase.rpc("app_report_asset_fault", {
        p_asset_id: id,
        p_description: description,
        p_severity: severity,
        p_out_of_service: severity === "critical",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["maintenance-requests", organization?.id] });
      toast({
        title: "سُجّل بلاغ العطل",
        description: "العطل الحرِج يُخرج الجهاز من الخدمة فورًا",
      });
    },
    onError: fail("تعذر البلاغ"),
  });

  const transfer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_transfer_asset", {
        p_asset_id: transferring.asset_id,
        p_to_branch_id: toBranch,
        p_to_clinic_id: null,
        p_to_room: toRoom.trim() || null,
        p_reason: transferReason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setTransferring(null);
      setToBranch(""); setToRoom(""); setTransferReason("");
      toast({ title: "نُقل الجهاز" });
    },
    onError: fail("تعذر النقل"),
  });

  const dispose = useMutation({
    mutationFn: async ({ id, method, reason, amount }: {
      id: string; method: string; reason: string; amount: number | null;
    }) => {
      const { error } = await supabase.rpc("app_dispose_asset", {
        p_asset_id: id, p_method: method, p_reason: reason,
        p_sale_amount: amount, p_buyer: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "سُجّل التخلّص من الأصل",
        description: "السجل يبقى بقيمته وتاريخه — لا يُحذف",
      });
    },
    onError: fail("تعذر التخلّص"),
  });

  // إهلاك الشهر المنقضي: القيمة الدفترية في الجدول أعلاه لا تتحرّك ما لم
  // يُرحَّل الإهلاك، فيظهر عند التخلّص ربحٌ وهميّ.
  const lastMonth = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();

  const depreciate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_post_asset_depreciation", {
        p_org: organization!.id,
        p_month: lastMonth,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: `رُحّل إهلاك ${lastMonth.slice(0, 7)}`,
        description: "القيد أُنشئ مسودّة في دفتر الأستاذ ليعتمده المحاسب",
      });
    },
    onError: fail("تعذر ترحيل الإهلاك"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" />
              سجل الأصول
            </CardTitle>
            <CardDescription>
              الجهاز المرتبط بمورد حجز: **إخراجه من الخدمة يمنع الحجز عليه فورًا**، ومعايرته
              المنتهية تمنع استخدامه.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => assets.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              تحديث
            </Button>
            {can("assets.manage") && (
              <Button variant="outline" disabled={depreciate.isPending}
                      onClick={() => depreciate.mutate()}>
                ترحيل إهلاك {lastMonth.slice(0, 7)}
              </Button>
            )}
            {can("assets.manage") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                أصل جديد
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {assets.isLoading && <Skeleton className="h-40 w-full" />}
          {!assets.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>الموقع</TableHead>
                  <TableHead>التسلسلي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الضمان</TableHead>
                  <TableHead>المعايرة</TableHead>
                  <TableHead>القيمة الدفترية</TableHead>
                  <TableHead>تكلفة الصيانة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(assets.data ?? []).map((a) => (
                  <TableRow key={a.asset_id}>
                    <TableCell className="font-mono text-xs">{a.asset_number}</TableCell>
                    <TableCell className="text-sm">
                      {a.asset_name}
                      <span className="block text-[10px] text-muted-foreground">
                        {CATEGORIES[a.asset_category] ?? a.asset_category}
                        {a.model ? ` · ${a.model}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.branch_name ?? "—"}
                      {a.room_number && (
                        <span className="block text-[10px] text-muted-foreground">
                          {a.room_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.serial_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={ASSET_STATUS[a.status]?.variant ?? "secondary"}>
                        {ASSET_STATUS[a.status]?.label ?? a.status}
                      </Badge>
                      {a.status_reason && (
                        <span className="block text-[10px] text-muted-foreground">
                          {a.status_reason}
                        </span>
                      )}
                      {Number(a.open_requests ?? 0) > 0 && (
                        <Badge variant="destructive" className="mt-1">
                          {a.open_requests} بلاغ مفتوح
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.warranty_end_date ?? "—"}
                      {a.warranty_expired && (
                        <Badge variant="destructive" className="ms-1">منتهٍ</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.requires_calibration ? (
                        <>
                          {a.next_calibration_date ?? "—"}
                          {a.calibration_overdue && (
                            <Badge variant="destructive" className="ms-1">متأخّرة</Badge>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{money(a.book_value)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(a.maintenance_cost_total)}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-1">
                        {a.status !== "disposed" && can("assets.maintenance") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => {
                                    const d = window.prompt("وصف العطل؟") ?? "";
                                    if (!d.trim()) return;
                                    const crit = window.confirm(
                                      "هل العطل حرِج (يُخرج الجهاز فورًا)؟");
                                    reportFault.mutate({
                                      id: a.asset_id, description: d.trim(),
                                      severity: crit ? "critical" : "normal",
                                    });
                                  }}>
                            <Wrench className="h-3.5 w-3.5" />
                            بلاغ عطل
                          </Button>
                        )}
                        {a.status === "in_service" && can("assets.manage") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => {
                                    const r = window.prompt("سبب الإخراج من الخدمة؟") ?? "";
                                    if (!r.trim()) return;
                                    setStatus.mutate({
                                      id: a.asset_id, status: "out_of_service",
                                      reason: r.trim(),
                                    });
                                  }}>
                            إخراج
                          </Button>
                        )}
                        {["out_of_service", "under_maintenance", "reserved_for_repair"]
                          .includes(a.status) && can("assets.manage") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => setStatus.mutate({
                                    id: a.asset_id, status: "in_service", reason: null,
                                  })}>
                            إعادة للخدمة
                          </Button>
                        )}
                        {a.status !== "disposed" && can("assets.manage") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => setTransferring(a)}>
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            نقل
                          </Button>
                        )}
                        {a.status !== "disposed" && can("assets.dispose") && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => {
                                    const reason = window.prompt("سبب التخلّص؟") ?? "";
                                    if (!reason.trim()) return;
                                    const amt = window.prompt(
                                      "مبلغ البيع إن وُجد (اتركه فارغًا للإتلاف)") ?? "";
                                    dispose.mutate({
                                      id: a.asset_id,
                                      method: amt ? "sold" : "scrapped",
                                      reason: reason.trim(),
                                      amount: amt ? Number(amt) : null,
                                    });
                                  }}>
                            تخلّص
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(assets.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      لا أصول مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewAssetDialog open={creating} onOpenChange={setCreating} />

      <Dialog open={Boolean(transferring)} onOpenChange={(o) => !o && setTransferring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>نقل {transferring?.asset_name}</DialogTitle>
            <DialogDescription>
              يُسجَّل النقل بمصدره ووجهته وسببه في سجل الأصل.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الفرع الجديد *</Label>
              <Select value={toBranch} onValueChange={setToBranch}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الغرفة</Label>
              <Input value={toRoom} onChange={(e) => setToRoom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السبب</Label>
              <Input value={transferReason}
                     onChange={(e) => setTransferReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!toBranch || transfer.isPending} onClick={() => transfer.mutate()}>
              نقل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewAssetDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [assetNumber, setAssetNumber] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [category, setCategory] = useState("medical_device");
  const [branchId, setBranchId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [serial, setSerial] = useState("");
  const [barcode, setBarcode] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [warrantyEnd, setWarrantyEnd] = useState("");
  const [serviceEnd, setServiceEnd] = useState("");
  const [usefulLife, setUsefulLife] = useState("");
  const [salvage, setSalvage] = useState("");
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [calInterval, setCalInterval] = useState("365");

  const branches = useQuery({
    queryKey: ["as-branches", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name")
        .eq("organization_id", organization!.id).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const resources = useQuery({
    queryKey: ["as-resources", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources").select("id, name_ar, code, resource_type, is_active")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const suppliers = useQuery({
    queryKey: ["as-suppliers", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors").select("id, name_ar, is_disabled, is_archived")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false).eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("assets").insert({
        organization_id: organization!.id,
        branch_id: branchId || null,
        asset_number: assetNumber.trim(),
        name_ar: nameAr.trim(),
        asset_category: category,
        is_medical: ["medical_device", "lab_device", "imaging_device"].includes(category),
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        serial_number: serial.trim() || null,
        barcode: barcode.trim() || null,
        // الربط بمورد الحجز هو ما يجعل إخراج الجهاز يمنع الحجز عليه
        resource_id: resourceId || null,
        distributor_id: supplierId || null,
        purchase_date: purchaseDate || null,
        purchase_cost: purchaseCost ? Number(purchaseCost) : null,
        warranty_end_date: warrantyEnd || null,
        service_contract_end: serviceEnd || null,
        // العمر الإنتاجي والقيمة التخريدية هما ما يجعل الإهلاك الشهري ممكنًا
        useful_life_years: usefulLife ? Number(usefulLife) : null,
        salvage_value: salvage ? Number(salvage) : 0,
        requires_calibration: needsCalibration,
        calibration_interval_days: needsCalibration ? Number(calInterval) || 365 : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-register", organization?.id] });
      setAssetNumber(""); setNameAr(""); setSerial(""); setBarcode("");
      setManufacturer(""); setModel(""); setPurchaseCost(""); setResourceId("");
      setServiceEnd(""); setUsefulLife(""); setSalvage("");
      onOpenChange(false);
      toast({ title: "أُضيف الأصل" });
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
          <DialogTitle>أصل جديد</DialogTitle>
          <DialogDescription>
            اربط الجهاز بمورد الحجز إن كان يُحجز عليه — عندها يمنع النظام الحجز تلقائيًّا
            متى خرج من الخدمة أو انتهت معايرته.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>رقم الأصل *</Label>
            <Input value={assetNumber} onChange={(e) => setAssetNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التصنيف</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>مورد الحجز المرتبط (اختياري)</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger><SelectValue placeholder="لا يُحجز عليه" /></SelectTrigger>
              <SelectContent>
                {(resources.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.code} — {r.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المصنّع</Label>
            <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الموديل</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرقم التسلسلي</Label>
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الباركود</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المورد</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>
                {(suppliers.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الشراء</Label>
            <Input type="date" value={purchaseDate}
                   onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>قيمة الشراء</Label>
            <Input type="number" value={purchaseCost}
                   onChange={(e) => setPurchaseCost(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>انتهاء الضمان</Label>
            <Input type="date" value={warrantyEnd}
                   onChange={(e) => setWarrantyEnd(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>انتهاء عقد الصيانة</Label>
            <Input type="date" value={serviceEnd}
                   onChange={(e) => setServiceEnd(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العمر الإنتاجي (سنوات)</Label>
            <Input type="number" min={1} value={usefulLife}
                   onChange={(e) => setUsefulLife(e.target.value)} />
            <span className="text-[10px] text-muted-foreground">
              بدونه لا يُحتسب إهلاك، فتبقى القيمة الدفترية = قيمة الشراء
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>القيمة التخريدية</Label>
            <Input type="number" min={0} value={salvage}
                   onChange={(e) => setSalvage(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={needsCalibration}
                     onChange={(e) => setNeedsCalibration(e.target.checked)} />
              يحتاج معايرة دورية
            </label>
            {needsCalibration && (
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">كل (يوم)</Label>
                <Input type="number" min={1} className="w-32" value={calInterval}
                       onChange={(e) => setCalInterval(e.target.value)} />
                <span className="text-xs text-muted-foreground">
                  الجهاز المنتهية معايرته يُمنع استخدامه تلقائيًّا
                </span>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!assetNumber.trim() || !nameAr.trim() || create.isPending}
                  onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * التنبيهات
 * ════════════════════════════════════════════════════════════════════════ */
function AlertsPanel() {
  const { organization } = useOrganizationAccess();

  const alerts = useQuery({
    queryKey: ["asset-alerts", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_asset_alerts").select("*")
        .eq("organization_id", organization!.id)
        .order("days_left", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const TYPES: Record<string, string> = {
    calibration: "معايرة", warranty: "ضمان", maintenance: "صيانة وقائية",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          تنبيهات الأصول
        </CardTitle>
        <CardDescription>
          المعايرة والضمان والصيانة الوقائية. **الجهاز الذي انتهت معايرته تُبطل نتائجه**،
          والنظام يمنع استخدامه.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {alerts.isLoading && <Skeleton className="h-32 w-full" />}
        {!alerts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead>الجهاز</TableHead>
                <TableHead>الرقم</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الأيام</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(alerts.data ?? []).map((a, i) => (
                <TableRow key={`${a.asset_id}-${a.alert_type}-${i}`}>
                  <TableCell className="text-sm">
                    <Badge variant="outline">{TYPES[a.alert_type] ?? a.alert_type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{a.asset_name}</TableCell>
                  <TableCell className="font-mono text-xs">{a.asset_number}</TableCell>
                  <TableCell className="font-mono text-xs">{a.due_date}</TableCell>
                  <TableCell className="font-mono text-xs">{a.days_left}</TableCell>
                  <TableCell>
                    <Badge variant={
                      Number(a.days_left) < 0 ? "destructive" : "default"}>
                      {a.urgency}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(alerts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا تنبيهات — كل الأجهزة ضمن مواعيدها.
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
 * الصيانة
 * ════════════════════════════════════════════════════════════════════════ */
function MaintenancePanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const assets = useAssetList(organization?.id);

  const [assetId, setAssetId] = useState("");
  const [planName, setPlanName] = useState("");
  const [frequency, setFrequency] = useState("90");
  const [closing, setClosing] = useState<any | null>(null);
  const [issuing, setIssuing] = useState<any | null>(null);
  const [lotId, setLotId] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [findings, setFindings] = useState("");
  const [actions, setActions] = useState("");
  const [returnToService, setReturnToService] = useState(true);
  const [laborCost, setLaborCost] = useState("");
  const [downtime, setDowntime] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [checklist, setChecklist] = useState("");

  const requests = useQuery({
    queryKey: ["maintenance-requests", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_requests")
        .select("*, asset:assets(asset_number, name_ar)")
        .eq("organization_id", organization!.id)
        .in("status", ["open", "assigned", "in_progress"])
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const orders = useQuery({
    queryKey: ["maintenance-history", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_maintenance_history").select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const plans = useQuery({
    queryKey: ["maintenance-plans", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_plans")
        .select("*, asset:assets(asset_number, name_ar)")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("next_due_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // قطع الغيار المتاحة فعلًا: التشغيلات غير المحجورة ولا المنتهية، بالرصيد المتاح
  // بعد المحجوز — لا تُعرض قطعة لا يمكن صرفها.
  const lots = useQuery({
    queryKey: ["maintenance-part-lots", organization?.id],
    enabled: Boolean(organization?.id) && Boolean(issuing),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_stock_on_hand_detailed").select("*")
        .eq("organization_id", organization!.id)
        .eq("lot_status", "available")
        .eq("is_expired", false)
        .gt("available_qty", 0)
        .order("item_name")
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const vendors = useQuery({
    queryKey: ["as-vendors", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors").select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false).eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["maintenance-requests", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["maintenance-part-lots", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["maintenance-history", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["maintenance-plans", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["asset-register", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const createPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("maintenance_plans").insert({
        organization_id: organization!.id,
        asset_id: assetId,
        name_ar: planName.trim(),
        frequency_days: Number(frequency) || 90,
        // قائمة الفحص تظهر للفنّي عند إغلاق أمر الخطة — سطرٌ لكل بند
        checklist: checklist.trim()
          ? checklist.split("\n").map((l) => l.trim()).filter(Boolean)
          : null,
        next_due_date: new Date(Date.now() + (Number(frequency) || 90) * 86400000)
          .toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setPlanName(""); setChecklist("");
      toast({ title: "أُضيفت خطة الصيانة الوقائية" });
    },
    onError: fail("تعذر الحفظ"),
  });

  const createOrder = useMutation({
    mutationFn: async ({ requestId, asset, planId }: {
      requestId: string | null; asset: string; planId?: string | null;
    }) => {
      const { error } = await supabase.from("maintenance_orders").insert({
        organization_id: organization!.id,
        asset_id: asset,
        maintenance_request_id: requestId,
        // الربط بالخطة هو ما يجعلها تتقدّم إلى موعدها التالي عند الإغلاق
        maintenance_plan_id: planId ?? null,
        order_type: requestId ? "corrective" : "preventive",
        status: "in_progress",
        started_at: new Date().toISOString(),
      });
      if (error) throw error;
      if (requestId) {
        await supabase.from("maintenance_requests")
          .update({ status: "in_progress" }).eq("id", requestId);
      }
    },
    onSuccess: () => { invalidate(); toast({ title: "فُتح أمر صيانة" }); },
    onError: fail("تعذر الفتح"),
  });

  const issuePart = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_issue_maintenance_part", {
        p_order_id: issuing.maintenance_order_id,
        p_lot_id: lotId,
        p_qty: Number(partQty),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setIssuing(null); setLotId(""); setPartQty("1");
      toast({ title: "صُرفت القطعة وخرجت من المخزون بحركة مسجَّلة" });
    },
    onError: fail("تعذر صرف القطعة"),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_complete_maintenance_order", {
        p_order_id: closing.maintenance_order_id,
        p_findings: findings.trim() || null,
        p_actions: actions.trim(),
        p_return_to_service: returnToService,
        p_labor_cost: laborCost ? Number(laborCost) : null,
        p_downtime_hours: downtime ? Number(downtime) : null,
        p_vendor_distributor_id: vendorId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setClosing(null); setFindings(""); setActions(""); setReturnToService(true);
      setLaborCost(""); setDowntime(""); setVendorId("");
      toast({ title: "أُغلق أمر الصيانة" });
    },
    onError: fail("تعذر الإغلاق"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            بلاغات الأعطال المفتوحة
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading && <Skeleton className="h-24 w-full" />}
          {!requests.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>العطل</TableHead>
                  <TableHead>الخطورة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {r.asset?.name_ar}
                      <span className="block text-[10px] text-muted-foreground">
                        {r.asset?.asset_number}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-sm">
                      {r.fault_description}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        r.severity === "critical" ? "destructive"
                          : r.severity === "high" ? "destructive" : "secondary"}>
                        {r.severity === "critical" ? "حرِج"
                          : r.severity === "high" ? "عالٍ"
                          : r.severity === "low" ? "منخفض" : "عادي"}
                      </Badge>
                      {r.takes_out_of_service && (
                        <Badge variant="destructive" className="ms-1">أخرجه</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(r.reported_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">{r.status}</TableCell>
                    <TableCell className="text-left">
                      {can("assets.maintenance") && (
                        <Button size="sm" variant="outline" disabled={createOrder.isPending}
                                onClick={() => createOrder.mutate({
                                  requestId: r.id, asset: r.asset_id,
                                })}>
                          فتح أمر
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(requests.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا بلاغات مفتوحة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {can("assets.manage") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">خطة صيانة وقائية</CardTitle>
            <CardDescription>
              تتقدّم تلقائيًّا إلى موعدها التالي عند إغلاق أمرها.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex w-56 flex-col gap-1.5">
              <Label>الجهاز</Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(assets.data ?? []).filter((a) => a.status !== "disposed").map((a) => (
                    <SelectItem key={a.asset_id} value={a.asset_id}>
                      {a.asset_number} — {a.asset_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-56 flex-col gap-1.5">
              <Label>اسم الخطة</Label>
              <Input value={planName} onChange={(e) => setPlanName(e.target.value)} />
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Label>كل (يوم)</Label>
              <Input type="number" min={1} value={frequency}
                     onChange={(e) => setFrequency(e.target.value)} />
            </div>
            <div className="flex w-72 flex-col gap-1.5">
              <Label>قائمة الفحص (بند في كل سطر)</Label>
              <Textarea rows={2} value={checklist}
                        onChange={(e) => setChecklist(e.target.value)} />
            </div>
            <Button disabled={!assetId || !planName.trim() || createPlan.isPending}
                    onClick={() => createPlan.mutate()}>
              إضافة
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">خطط الصيانة الوقائية</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {plans.isLoading && <Skeleton className="h-24 w-full" />}
          {!plans.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>الخطة</TableHead>
                  <TableHead>الدورية</TableHead>
                  <TableHead>آخر تنفيذ</TableHead>
                  <TableHead>الموعد القادم</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(plans.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.asset?.name_ar}</TableCell>
                    <TableCell className="text-sm">{p.name_ar}</TableCell>
                    <TableCell className="font-mono text-xs">{p.frequency_days} يومًا</TableCell>
                    <TableCell className="font-mono text-xs">{p.last_done_date ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.next_due_date ?? "—"}
                      {p.next_due_date && new Date(p.next_due_date) < new Date() && (
                        <Badge variant="destructive" className="ms-1">متأخّرة</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      {can("assets.maintenance") && (
                        <Button size="sm" variant="outline" disabled={createOrder.isPending}
                                onClick={() => createOrder.mutate({
                                  requestId: null, asset: p.asset_id, planId: p.id,
                                })}>
                          فتح أمر
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(plans.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا خطط وقائية.
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
          <CardTitle className="text-base">أوامر الصيانة</CardTitle>
          <CardDescription>
            الأمر لا يُغلق بلا إجراء متَّخذ — أمرٌ يُغلق فارغًا لا يُثبت أن الجهاز صُلح.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {orders.isLoading && <Skeleton className="h-24 w-full" />}
          {!orders.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>القطع</TableHead>
                  <TableHead>التكلفة</TableHead>
                  <TableHead>التوقّف</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>الإجراء</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders.data ?? []).map((o) => (
                  <TableRow key={o.maintenance_order_id}>
                    <TableCell className="text-sm">
                      {o.asset_name}
                      <span className="block text-[10px] text-muted-foreground">
                        {o.asset_number}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.order_type === "preventive" ? "وقائية"
                        : o.order_type === "calibration" ? "معايرة"
                        : o.order_type === "inspection" ? "فحص" : "إصلاحية"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        o.status === "completed" ? "success"
                          : o.status === "cancelled" ? "destructive" : "default"}>
                        {o.status === "completed" ? "مكتمل"
                          : o.status === "cancelled" ? "ملغى"
                          : o.status === "in_progress" ? "جارٍ" : "مجدول"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.report_date}</TableCell>
                    <TableCell className="font-mono text-xs">{o.part_count ?? 0}</TableCell>
                    <TableCell className="font-mono text-xs">{money(o.total_cost)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.downtime_hours != null ? `${o.downtime_hours} س` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{o.vendor_name ?? "داخليًّا"}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                      {o.actions_taken ?? "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      {["draft", "scheduled", "in_progress"].includes(o.status) &&
                        can("assets.maintenance") && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setIssuing(o)}>
                              صرف قطعة
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setClosing(o)}>
                              إغلاق
                            </Button>
                          </div>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
                {(orders.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                      لا أوامر صيانة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(issuing)} onOpenChange={(o) => { if (!o) { setIssuing(null); setLotId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>صرف قطعة غيار — {issuing?.asset_name}</DialogTitle>
            <DialogDescription>
              القطعة تخرج من المخزون بحركة صرفٍ حقيقية على تشغيلتها، وتُضاف
              تكلفتها إلى تكلفة أمر الصيانة.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>التشغيلة *</Label>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger><SelectValue placeholder="اختر قطعة من المخزون المتاح" /></SelectTrigger>
                <SelectContent>
                  {(lots.data ?? []).map((l) => (
                    <SelectItem key={l.lot_id} value={l.lot_id}>
                      {l.item_name} — {l.lot_number ?? "بلا رقم"} ({l.warehouse_name}) · متاح {l.available_qty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!lots.isLoading && (lots.data ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">
                  لا توجد تشغيلات متاحة غير محجورة وغير منتهية الصلاحية.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الكمية *</Label>
              <Input type="number" min="0.001" step="0.001" value={partQty}
                     onChange={(e) => setPartQty(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!lotId || !(Number(partQty) > 0) || issuePart.isPending}
                    onClick={() => issuePart.mutate()}>
              صرف القطعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closing)} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إغلاق أمر صيانة — {closing?.asset_name}</DialogTitle>
            <DialogDescription>
              **العودة للخدمة قرارٌ صريح**: أمرٌ اكتمل لا يعني بالضرورة أن الجهاز صالح.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>ما وُجد</Label>
              <Textarea rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء المتَّخذ *</Label>
              <Textarea rows={2} value={actions} onChange={(e) => setActions(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>تكلفة العمالة</Label>
                <Input type="number" min="0" value={laborCost}
                       onChange={(e) => setLaborCost(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>ساعات التوقّف</Label>
                <Input type="number" min="0" step="0.5" value={downtime}
                       onChange={(e) => setDowntime(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>جهة خارجية نفّذت الصيانة</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="داخليًّا — بلا جهة خارجية" /></SelectTrigger>
                <SelectContent>
                  {(vendors.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {Array.isArray(closing?.plan_checklist) && closing.plan_checklist.length > 0 && (
              <div className="rounded-md border p-2 text-xs">
                <span className="font-medium">قائمة فحص الخطة:</span>
                <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
                  {closing.plan_checklist.map((c: any, i: number) => (
                    <li key={i}>{String(c)}</li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={returnToService}
                     onChange={(e) => setReturnToService(e.target.checked)} />
              إعادة الجهاز للخدمة
            </label>
          </div>
          <DialogFooter>
            <Button disabled={!actions.trim() || complete.isPending}
                    onClick={() => complete.mutate()}>
              إغلاق الأمر
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * المعايرة
 * ════════════════════════════════════════════════════════════════════════ */
function CalibrationPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const assets = useAssetList(organization?.id);

  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState("passed");
  const [certificate, setCertificate] = useState("");
  const [deviation, setDeviation] = useState("");
  const [vendor, setVendor] = useState("");

  const calibrations = useQuery({
    queryKey: ["asset-calibrations", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_calibrations")
        .select("*, asset:assets(asset_number, name_ar)")
        .eq("organization_id", organization!.id)
        .order("calibration_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_record_calibration", {
        p_asset_id: assetId,
        p_date: date,
        p_result: result,
        p_certificate: certificate.trim() || null,
        p_vendor: vendor.trim() || null,
        p_note: null,
        p_deviation: deviation.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-calibrations", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["asset-register", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["asset-alerts", organization?.id] });
      setCertificate(""); setDeviation("");
      toast({
        title: "سُجّلت المعايرة",
        description: result === "failed"
          ? "الرسوب أخرج الجهاز من الخدمة — نتائجه بعده غير معتمَدة"
          : "جُدِّد الموعد القادم تلقائيًّا",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التسجيل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const RESULTS: Record<string, string> = {
    passed: "ناجحة", passed_with_adjustment: "ناجحة بعد ضبط", failed: "راسبة",
  };

  return (
    <div className="flex flex-col gap-4">
      {can("assets.calibration") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              تسجيل معايرة
            </CardTitle>
            <CardDescription>
              الموعد القادم يُحسب من دورية الجهاز. **الرسوب يُخرج الجهاز فورًا** لأن
              نتائجه بعده غير معتمَدة.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label>الجهاز *</Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(assets.data ?? [])
                    .filter((a) => a.requires_calibration && a.status !== "disposed")
                    .map((a) => (
                      <SelectItem key={a.asset_id} value={a.asset_id}>
                        {a.asset_number} — {a.asset_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>النتيجة</Label>
              <Select value={result} onValueChange={setResult}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RESULTS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم الشهادة</Label>
              <Input value={certificate} onChange={(e) => setCertificate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الانحراف المقيس</Label>
              <Input value={deviation} onChange={(e) => setDeviation(e.target.value)}
                     placeholder="مثال: ‎+0.3%‎ عند 100 kVp" />
            </div>
            <div className="flex items-end gap-2">
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)}
                     placeholder="جهة المعايرة" />
              <Button disabled={!assetId || record.isPending} onClick={() => record.mutate()}>
                تسجيل
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">سجل المعايرات</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {calibrations.isLoading && <Skeleton className="h-24 w-full" />}
          {!calibrations.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النتيجة</TableHead>
                  <TableHead>الشهادة</TableHead>
                  <TableHead>الانحراف</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>الموعد القادم</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(calibrations.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      {c.asset?.name_ar}
                      <span className="block text-[10px] text-muted-foreground">
                        {c.asset?.asset_number}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.calibration_date}</TableCell>
                    <TableCell>
                      <Badge variant={
                        c.result === "failed" ? "destructive"
                          : c.result === "passed" ? "success" : "default"}>
                        {RESULTS[c.result] ?? c.result}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.certificate_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{c.measured_deviation ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.performed_by_vendor ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.next_due_date ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(calibrations.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      لا معايرات مسجّلة.
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
 * الإهلاك — جدول القسط الثابت وسجل الترحيلات
 * ════════════════════════════════════════════════════════════════════════ */
function DepreciationPanel() {
  const { organization } = useOrganizationAccess();

  const schedule = useQuery({
    queryKey: ["asset-depreciation-schedule", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_asset_depreciation_schedule").select("*")
        .eq("organization_id", organization!.id)
        .order("asset_number");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const runs = useQuery({
    queryKey: ["asset-depreciation-runs", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_depreciation_runs").select("*")
        .eq("organization_id", organization!.id)
        .order("period_month", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">جدول الإهلاك</CardTitle>
          <CardDescription>
            القسط الثابت شهريًّا. الأصل بلا عمرٍ إنتاجيّ لا يُهلَك، فتبقى قيمته
            الدفترية = قيمة الشراء وتظهر أرباح وهمية عند التخلّص منه.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {schedule.isLoading && <Skeleton className="h-32 w-full" />}
          {!schedule.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الأصل</TableHead>
                  <TableHead>تاريخ الشراء</TableHead>
                  <TableHead>التكلفة</TableHead>
                  <TableHead>العمر</TableHead>
                  <TableHead>القسط الشهري</TableHead>
                  <TableHead>مجمّع الإهلاك</TableHead>
                  <TableHead>القيمة الدفترية</TableHead>
                  <TableHead>آخر شهر مُهلَك</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schedule.data ?? []).map((s) => (
                  <TableRow key={s.asset_id}>
                    <TableCell className="font-mono text-xs">{s.asset_number}</TableCell>
                    <TableCell className="text-sm">{s.asset_name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.purchase_date ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{money(s.purchase_cost)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.useful_life_years ? `${s.useful_life_years} سنة` : (
                        <Badge variant="secondary">بلا إهلاك</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.monthly_depreciation != null ? money(s.monthly_depreciation) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(s.accumulated_depreciation)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{money(s.net_book_value)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.last_depreciated_month ? String(s.last_depreciated_month).slice(0, 7) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(schedule.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                      لا أصول مسجّلة.
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
          <CardTitle className="text-base">ترحيلات الإهلاك</CardTitle>
          <CardDescription>
            كل شهر يُرحَّل مرّة واحدة، وقيده يُنشأ مسودّة ليعتمده المحاسب من
            شاشة الحسابات.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.isLoading && <Skeleton className="h-24 w-full" />}
          {!runs.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الشهر</TableHead>
                  <TableHead>عدد الأصول</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>القيد</TableHead>
                  <TableHead>تاريخ الترحيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {String(r.period_month).slice(0, 7)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.asset_count}</TableCell>
                    <TableCell className="font-mono text-xs">{money(r.total_amount)}</TableCell>
                    <TableCell>
                      {r.journal_entry_id
                        ? <Badge variant="success">مُنشأ</Badge>
                        : <Badge variant="secondary">بلا دليل حسابات</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(r.posted_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                  </TableRow>
                ))}
                {(runs.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      لم يُرحَّل إهلاك بعد.
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
