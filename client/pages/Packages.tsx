import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { PatientPackageBalanceView } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";

function useItemsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["items-for-packages", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function usePackagesCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["packages-catalog", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id, code, name_ar, price, validity_days, is_active, package_items(id, quantity_included, item:items(name_ar))")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Packages() {
  const { organization } = useOrganizationAccess();
  const [createPackageOpen, setCreatePackageOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const packages = usePackagesCatalog(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الباقات</h1>
          <p className="text-sm text-muted-foreground">باقات خدمات جاهزة بسعر موحَّد، وتتبّع استهلاك كل مريض منها</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreatePackageOpen(true)}>
            <Plus className="h-4 w-4" />
            باقة جديدة
          </Button>
          <Button onClick={() => setSubscribeOpen(true)}>
            <Plus className="h-4 w-4" />
            اشتراك مريض في باقة
          </Button>
        </div>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">كتالوج الباقات</TabsTrigger>
          <TabsTrigger value="subscriptions">باقات المرضى وأرصدتها</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>الباقات المتاحة</CardTitle>
              <CardDescription>كل باقة تُباع كفاتورة مبيعات عادية بسعرها الموحَّد، وصلاحيتها تُحسَب تلقائيًا من تاريخ الشراء</CardDescription>
            </CardHeader>
            <CardContent>
              {packages.isLoading && <Skeleton className="h-40 w-full" />}
              {!packages.isLoading && (
                <div className="flex flex-col gap-3">
                  {(packages.data ?? []).map((pkg) => (
                    <div key={pkg.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          {pkg.name_ar}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant={pkg.is_active ? "success" : "secondary"}>{pkg.is_active ? "نشطة" : "معطّلة"}</Badge>
                          <span className="font-semibold">{Number(pkg.price).toLocaleString("ar-SA")} ر.س</span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pkg.validity_days ? `صلاحية ${pkg.validity_days} يومًا من تاريخ الشراء` : "بلا تاريخ انتهاء"}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                        {(pkg.package_items ?? []).map((pi) => {
                          const item = Array.isArray(pi.item) ? pi.item[0] : pi.item;
                          return (
                            <li key={pi.id} className="rounded-full bg-muted px-2.5 py-1">
                              {item?.name_ar} × {pi.quantity_included}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {(packages.data ?? []).length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">لا توجد باقات مُعرَّفة بعد.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions" className="mt-4">
          <PatientSubscriptionsTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>

      <NewPackageDialog open={createPackageOpen} onOpenChange={setCreatePackageOpen} organizationId={organization?.id} />
      <SubscribePatientDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} organizationId={organization?.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// باقة جديدة
// ---------------------------------------------------------------------------
function NewPackageDialog({
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
  const items = useItemsList(organizationId);
  const [nameAr, setNameAr] = useState("");
  const [price, setPrice] = useState("0");
  const [validityDays, setValidityDays] = useState("");
  const [lines, setLines] = useState<{ itemId: string; quantity: string }[]>([]);

  const createPackage = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const validLines = lines.filter((line) => line.itemId);
      if (validLines.length === 0) throw new Error("أضف صنفًا واحدًا على الأقل داخل الباقة");

      const { data: pkg, error: pkgError } = await supabase
        .from("packages")
        .insert({
          organization_id: organizationId,
          name_ar: nameAr.trim(),
          price: Number(price) || 0,
          validity_days: validityDays ? Number(validityDays) : null,
        })
        .select("id")
        .single();
      if (pkgError) throw pkgError;

      const { error: itemsError } = await supabase.from("package_items").insert(
        validLines.map((line) => ({
          package_id: pkg.id,
          item_id: line.itemId,
          quantity_included: Number(line.quantity) || 1,
        })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages-catalog", organizationId] });
      toast({ title: "تم حفظ الباقة" });
      setNameAr("");
      setPrice("0");
      setValidityDays("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>باقة جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الباقة *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus placeholder="باقة تنظيف أسنان ×4" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>السعر الإجمالي</Label>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>صلاحية الباقة (أيام، اختياري)</Label>
              <Input type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label>الأصناف المشمولة</Label>
            <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", quantity: "1" }])}>
              <Plus className="h-4 w-4" />
              إضافة صنف
            </Button>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={line.itemId}
                onValueChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, itemId: v } : l)))}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="اختر صنف" />
                </SelectTrigger>
                <SelectContent>
                  {(items.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                className="w-24"
                placeholder="العدد"
                value={line.quantity}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
              />
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {lines.length === 0 && <p className="text-center text-sm text-muted-foreground">أضف صنفًا واحدًا على الأقل</p>}
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || lines.length === 0 || createPackage.isPending} onClick={() => createPackage.mutate()}>
            {createPackage.isPending ? "جارٍ الحفظ..." : "حفظ الباقة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// اشتراك مريض في باقة
// ---------------------------------------------------------------------------
function SubscribePatientDialog({
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
  const packages = usePackagesCatalog(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [packageId, setPackageId] = useState("");

  const subscribe = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      if (!packageId) throw new Error("اختر باقة");
      const { error } = await supabase.from("patient_packages").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        package_id: packageId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-package-balances", organizationId] });
      toast({ title: "تم تسجيل اشتراك المريض في الباقة" });
      setPatient(null);
      setPackageId("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الاشتراك",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>اشتراك مريض في باقة</DialogTitle>
          <DialogDescription>سجّل فاتورة بيع الباقة من شاشة الفوترة بشكل منفصل — هذا فقط يربط المريض بالباقة ويبدأ حساب صلاحيتها</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض *</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="font-medium">{patient.name_ar}</span>
                <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الباقة *</Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر باقة" />
              </SelectTrigger>
              <SelectContent>
                {(packages.data ?? []).filter((p) => p.is_active).map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name_ar} — {Number(pkg.price).toLocaleString("ar-SA")} ر.س
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!patient || !packageId || subscribe.isPending} onClick={() => subscribe.mutate()}>
            {subscribe.isPending ? "جارٍ الحفظ..." : "تأكيد الاشتراك"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// باقات المرضى وأرصدتها + تسجيل استهلاك
// ---------------------------------------------------------------------------
function usePatientPackageBalances(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["patient-package-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_package_balances")
        .select("*")
        .eq("organization_id", organizationId)
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PatientPackageBalanceView[];
    },
  });
}

function PatientSubscriptionsTab({ organizationId }: { organizationId: string | undefined }) {
  const balances = usePatientPackageBalances(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const useBalance = useMutation({
    /**
     * الاستهلاك يمرّ بـ`app_consume_package_item` لا بإدراج مباشر (0075).
     * الدالة تقفل الاشتراك — فطلبان متزامنان على باقة فيها جلسة واحدة لا
     * يستهلكانها مرتين — وترفض بندًا من باقة أخرى، وتفحص ملاءمة الخدمة
     * للمريض، وتعيد الرصيد المتبقي وتنبيهات التحضير كي يراها الموظف.
     */
    mutationFn: async (row: PatientPackageBalanceView) => {
      const { data, error } = await supabase.rpc("app_consume_package_item", {
        p_patient_package_id: row.patient_package_id,
        p_package_item_id: row.package_item_id,
        p_quantity: 1,
      });
      if (error) throw error;
      return data as { quantity_remaining: number; warnings: string[] } | null;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["patient-package-balances", organizationId] });
      const warnings = result?.warnings ?? [];
      toast({
        title: `سُجّل الاستهلاك — المتبقي ${result?.quantity_remaining ?? "?"}`,
        description: warnings.length > 0 ? warnings.join(" — ") : undefined,
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل الاستهلاك",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  // تجميع الصفوف حسب الاشتراك لعرضها كبطاقة واحدة لكل باقة بدل صف مكرَّر لكل صنف
  const byPatientPackage = new Map<string, PatientPackageBalanceView[]>();
  for (const row of balances.data ?? []) {
    const list = byPatientPackage.get(row.patient_package_id) ?? [];
    list.push(row);
    byPatientPackage.set(row.patient_package_id, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>باقات المرضى النشطة</CardTitle>
        <CardDescription>الرصيد المتبقي من كل صنف داخل الباقة — الاستهلاك الفعلي يمنع تجاوز الرصيد تلقائيًا من قاعدة البيانات</CardDescription>
      </CardHeader>
      <CardContent>
        {balances.isLoading && <Skeleton className="h-40 w-full" />}
        {!balances.isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from(byPatientPackage.entries()).map(([patientPackageId, rows]) => {
              const header = rows[0];
              return (
                <div key={patientPackageId} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {header.patient_name} — {header.package_name}
                    </span>
                    <div className="flex items-center gap-2">
                      {header.status === "cancelled" && <Badge variant="destructive">ملغاة</Badge>}
                      {header.is_expired && <Badge variant="secondary">منتهية الصلاحية</Badge>}
                      {header.status === "active" && !header.is_expired && <Badge variant="success">نشطة</Badge>}
                    </div>
                  </div>
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>المتبقي</TableHead>
                        <TableHead>المستهلَك</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.package_item_id}>
                          <TableCell>{row.item_name}</TableCell>
                          <TableCell>
                            {row.quantity_remaining} / {row.quantity_included}
                          </TableCell>
                          <TableCell>{row.quantity_used}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                row.status !== "active" ||
                                row.is_expired ||
                                Number(row.quantity_remaining) <= 0 ||
                                useBalance.isPending
                              }
                              onClick={() => useBalance.mutate(row)}
                            >
                              تسجيل استخدام جلسة
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
            {byPatientPackage.size === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد اشتراكات باقات بعد.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
