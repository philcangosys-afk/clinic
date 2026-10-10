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
import SubscriptionsPanel from "@/components/packages/SubscriptionsPanel";
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";
import { errorMessage } from "@/lib/error-message";

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
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * `v_package_catalog` يحسب سعر القائمة والوفر من البنود، فلا يُكتب وفرٌ
 * يدويًّا قد يخالف الأسعار الفعلية.
 */
function useDoctorsForPackages(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-for-packages", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, specialty_value_id")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/**
 * تخصّصات المنشأة النشطة وحدها + التخصّصات العامة.
 *
 * سياستا `lookup_values_read`/`lookup_categories_read` تسمحان بـ
 * `organization_id is null or app_is_member(organization_id)` — أي بكل منشأة
 * ينتمي إليها المستخدم لا بالنشطة وحدها. فبلا التقييد الصريح كان من يعمل في
 * منشأتين يرى تخصّصات المنشأة الأخرى مخلوطةً، فتُكتب في الباقة
 * `allowed_specialty_value_id` لا يطابقه أي طبيب هنا، وتُرفَض الباقة عند البيع
 * بـ«تخصّص الطبيب غير مشمول» بلا سبب ظاهر.
 */
function useSpecialtiesForPackages(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["specialties-for-packages", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_data")
        .select("value_id, name_ar, category_key, is_disabled, organization_id")
        .eq("category_key", "medical_specialties")
        .eq("is_disabled", false)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function usePackageCatalogView(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["package-catalog-view", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_package_catalog")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/**
 * الباقات غير المؤرشفة وحدها.
 *
 * بلا `is_archived = false` كانت الباقة المؤرشفة تبقى في الكتالوج بشارة خضراء
 * «نشطة» (الشارة مشتقّة من `is_active` وحده) وبلا شريط بياناتها — لأن
 * `usePackageCatalogView` يُرشِّح المؤرشف فيتفارق المصدران — وتبقى في قائمة
 * «الباقة *» فيختارها الموظّف ثم يرتدّ رفض `app_check_package_eligibility`
 * بـ«الباقة غير مفعّلة أو مؤرشفة» بعد أن أخبرته الشاشة أنها نشطة.
 */
function usePackagesCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["packages-catalog", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id, code, name_ar, price, validity_days, is_active, is_archived, package_items(id, quantity_included, item:items(name_ar))")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
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

  const catalogView = usePackageCatalogView(organization?.id);

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
          <TabsTrigger value="manage">إدارة الاشتراكات</TabsTrigger>
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
                          <span className="font-semibold">{Number(pkg.price).toLocaleString("ar-SA-u-nu-latn")} ر.س</span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pkg.validity_days ? `صلاحية ${pkg.validity_days} يومًا من تاريخ الشراء` : "بلا تاريخ انتهاء"}
                      </p>
                      {/* الوفر والأهلية والسياسة تُقرأ من المنظور لا من الجدول:
                          سعر القائمة محسوب من البنود، فلا يظهر وفرٌ وهميّ. */}
                      <PackageMetaRow meta={catalogView.data?.find((c) => c.id === pkg.id)} />
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

        <TabsContent value="manage" className="mt-4">
          <SubscriptionsPanel />
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
  const { session } = useOrganizationAccess();
  const items = useItemsList(organizationId);
  const [nameAr, setNameAr] = useState("");
  const [price, setPrice] = useState("0");
  const [validityDays, setValidityDays] = useState("");
  const [subscriptionType, setSubscriptionType] = useState("one_time");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [gender, setGender] = useState("any");
  const [isTransferable, setIsTransferable] = useState(false);
  const [isRefundable, setIsRefundable] = useState(true);
  const [refundPolicy, setRefundPolicy] = useState("");
  const [maxRenewals, setMaxRenewals] = useState("");
  const [allowedDoctorIds, setAllowedDoctorIds] = useState<string[]>([]);
  const [specialtyId, setSpecialtyId] = useState("any");
  const doctors = useDoctorsForPackages(organizationId);
  const specialties = useSpecialtiesForPackages(organizationId);
  const [lines, setLines] = useState<
    { itemId: string; quantity: string; maxPerVisit: string; minDays: string }[]
  >([]);

  /**
   * الإنشاء على طلبين ليس ذرّيًّا — ولا دالّة `app_save_package` في القاعدة.
   *
   * الخطر: إن فشل إدراج البنود (رفض RLS، أو صنف أُرشف بين الاختيار والحفظ، أو
   * انقطاع شبكة) تبقى الباقة منشأةً بسعرها الكامل وبلا بند واحد — تُباع للمريض
   * بفاتورة ورصيدها صفر. فلذلك تتراجع الواجهة عمّا كتبته: لا حذف نهائي لبيانات
   * مالية، فتُعطَّل الباقة وتُؤرشف حتى لا تظهر في الكتالوج ولا في قائمة البيع،
   * ويُظهر الخطأ رسالة القاعدة كما هي. الحلّ الصحيح دالّة ذرّية واحدة
   * `app_save_package(p_organization_id, p_package_id, p_payload, p_items)` على
   * نمط `app_save_service`/`app_save_drug`، ترفض باقةً بلا بنود.
   */
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
          subscription_type: subscriptionType,
          min_age_years: minAge ? Number(minAge) : null,
          max_age_years: maxAge ? Number(maxAge) : null,
          gender_restriction: gender === "any" ? null : gender,
          is_transferable: isTransferable,
          is_refundable: isRefundable,
          // سياسةٌ مكتوبة تُعرض عند الاسترداد؛ الباقة غير المستردّة تحتاج سببًا
          refund_policy: refundPolicy.trim() || null,
          max_renewals: maxRenewals ? Number(maxRenewals) : null,
          allowed_doctor_ids: allowedDoctorIds.length > 0 ? allowedDoctorIds : null,
          allowed_specialty_value_id: specialtyId === "any" ? null : specialtyId,
        })
        .select("id")
        .single();
      if (pkgError) throw pkgError;

      const { error: itemsError } = await supabase.from("package_items").insert(
        validLines.map((line) => ({
          package_id: pkg.id,
          organization_id: organizationId,
          item_id: line.itemId,
          quantity_included: Number(line.quantity) || 1,
          max_per_visit: line.maxPerVisit ? Number(line.maxPerVisit) : null,
          min_days_between_uses: line.minDays ? Number(line.minDays) : null,
        })),
      );
      if (itemsError) {
        const { data: reverted, error: revertError } = await supabase
          .from("packages")
          .update({
            is_active: false,
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by: session?.user.id ?? null,
          })
          .eq("id", pkg.id)
          .select("id");
        if (revertError || !reverted || reverted.length === 0)
          throw new Error(
            `فشل حفظ أصناف الباقة: ${itemsError.message} — وتعذّر التراجع عن الباقة نفسها` +
              `${revertError ? `: ${revertError.message}` : ""}. الباقة «${nameAr.trim()}» موجودة بلا أصناف؛ ` +
              `عطّلها أو أرشفها يدويًّا قبل أن تُباع.`,
          );
        throw new Error(
          `فشل حفظ أصناف الباقة: ${itemsError.message} — أُلغيت الباقة (عُطّلت وأُرشفت) فلن تُباع بلا أصناف. أعد المحاولة.`,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages-catalog", organizationId] });
      // شريط الوفر والأهلية يُقرأ من استعلام آخر (`v_package_catalog`)؛ بلا
      // إبطاله تظهر الباقة الجديدة بلا نوع اشتراك ولا وفر ولا شروط عمر — لأن
      // `PackageMetaRow` يُرجع null عند غياب صف المنظور — فيبدو أن ما أُدخل لم يُحفظ.
      queryClient.invalidateQueries({ queryKey: ["package-catalog-view", organizationId] });
      toast({ title: "تم حفظ الباقة" });
      setNameAr("");
      setPrice("0");
      setValidityDays("");
      setSubscriptionType("one_time");
      setMinAge("");
      setMaxAge("");
      setGender("any");
      setIsTransferable(false);
      setIsRefundable(true);
      setRefundPolicy("");
      setMaxRenewals("");
      setAllowedDoctorIds([]);
      setSpecialtyId("any");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>نوع الاشتراك</Label>
              <Select value={subscriptionType} onValueChange={setSubscriptionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">باقة لمرة واحدة</SelectItem>
                  <SelectItem value="monthly">اشتراك شهري</SelectItem>
                  <SelectItem value="quarterly">اشتراك ربع سنوي</SelectItem>
                  <SelectItem value="annual">اشتراك سنوي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>حدّ التجديدات (اختياري)</Label>
              <Input
                type="number"
                min={0}
                value={maxRenewals}
                onChange={(e) => setMaxRenewals(e.target.value)}
                placeholder="بلا حدّ"
              />
            </div>
          </div>

          <Separator />
          <Label className="text-xs text-muted-foreground">
            الأهلية — تُفحص قبل البيع، فلا تُباع باقة لمن لا يستفيد منها
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>أقل عمر</Label>
              <Input type="number" min={0} value={minAge} onChange={(e) => setMinAge(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>أكبر عمر</Label>
              <Input type="number" min={0} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الجنس</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">الجميع</SelectItem>
                  <SelectItem value="male">ذكور</SelectItem>
                  <SelectItem value="female">إناث</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>التخصّص المسموح (اختياري)</Label>
            <Select value={specialtyId} onValueChange={setSpecialtyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">كل التخصّصات</SelectItem>
                {(specialties.data ?? []).map((sp) => (
                  <SelectItem key={sp.value_id} value={sp.value_id}>{sp.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الأطباء المسموح لهم (اتركه فارغًا للجميع)</Label>
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
              {(doctors.data ?? []).map((d) => {
                const checked = allowedDoctorIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      setAllowedDoctorIds((ids) =>
                        checked ? ids.filter((x) => x !== d.id) : [...ids, d.id],
                      )
                    }
                  >
                    <Badge variant={checked ? "success" : "outline"}>{d.name_ar}</Badge>
                  </button>
                );
              })}
              {(doctors.data ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">لا أطباء نشطون.</span>
              )}
            </div>
          </div>

          <Separator />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isTransferable}
                onChange={(e) => setIsTransferable(e.target.checked)}
              />
              قابلة للنقل لمريض آخر
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isRefundable}
                onChange={(e) => setIsRefundable(e.target.checked)}
              />
              قابلة للاسترداد
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سياسة الاسترداد</Label>
            <Input
              value={refundPolicy}
              onChange={(e) => setRefundPolicy(e.target.value)}
              placeholder="تُعرض للموظّف عند الإلغاء"
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Label>الأصناف المشمولة</Label>
            <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", quantity: "1", maxPerVisit: "", minDays: "" }])}>
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
                className="w-20"
                placeholder="العدد"
                value={line.quantity}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
              />
              {/* حدّ الزيارة يمنع استهلاك باقة العشرين جلسة في يوم واحد */}
              <Input
                type="number"
                min={1}
                className="w-24"
                placeholder="حدّ/زيارة"
                title="أقصى كمية تُخصم في زيارة واحدة"
                value={line.maxPerVisit}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, maxPerVisit: e.target.value } : l)))}
              />
              <Input
                type="number"
                min={1}
                className="w-24"
                placeholder="أيام فاصلة"
                title="أقل عدد أيام بين استخدامين"
                value={line.minDays}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, minDays: e.target.value } : l)))}
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

  /**
   * البيع يمرّ بـ`app_sell_package` لا بإدراج صفٍّ مباشر (0096).
   *
   * الإدراج المباشر كان يمنح المريض رصيدًا **بلا فاتورة**: خدماتٌ تُصرف ولا
   * يقابلها دخل، ولا أثر لها في الإيراد ولا في ذمم المريض. الدالّة تُنشئ
   * الفاتورة والاشتراك في عملية واحدة، وتفحص الأهلية (العمر والجنس والفرع
   * والطبيب) قبل ذلك، وترفض باقةً ثانيةً سارية من نفس النوع.
   */
  const subscribe = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      if (!packageId) throw new Error("اختر باقة");
      const { data, error } = await supabase.rpc("app_sell_package", {
        p_package_id: packageId,
        p_patient_id: patient.id,
        p_branch_id: null,
        p_doctor_id: null,
        p_clinic_id: null,
        p_note: null,
      });
      if (error) throw error;
      return data as { patient_package_id: string; invoice_id: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["patient-package-balances", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["patient-subscriptions", organizationId] });
      toast({
        title: "بِيعت الباقة وأُنشئت فاتورتها",
        description: "الفاتورة مسوّدة — أصدرها واستلم الدفع من شاشة الفوترة",
      });
      setPatient(null);
      setPackageId("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الاشتراك",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>اشتراك مريض في باقة</DialogTitle>
          {/* الوصف بقي من مرحلة كان الاشتراك فيها إدراجًا مباشرًا بلا فاتورة. بعد
              انتقال البيع إلى `app_sell_package` (تُنشئ الفاتورة والاشتراك معًا)
              صار الوصف يدفع الموظّف إلى إنشاء فاتورة ثانية يدويًّا — فيُحصَّل ثمن
              الباقة مرّتين، ويخالف رسالة النجاح في نفس النافذة. */}
          <DialogDescription>
            الحفظ يُنشئ فاتورة مسوّدة بسعر الباقة ويبدأ حساب صلاحيتها — أصدر الفاتورة واستلم الدفع من
            شاشة الفوترة، ولا تُنشئ فاتورة أخرى لها
          </DialogDescription>
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
                    {pkg.name_ar} — {Number(pkg.price).toLocaleString("ar-SA-u-nu-latn")} ر.س
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
        description: errorMessage(error),
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


/**
 * سطر بيانات الباقة المشتقّة: الوفر وشروط الأهلية والسياسات.
 *
 * كلّها من `v_package_catalog` لأن سعر القائمة والوفر يُحسبان هناك من البنود؛
 * عرضُهما من حقلٍ مكتوب يدويًّا كان يُظهر وفرًا لا يطابق الأسعار الفعلية.
 */
function PackageMetaRow({ meta }: { meta: any | undefined }) {
  if (!meta) return null;
  const eligibility: string[] = [];
  if (meta.gender_restriction === "male") eligibility.push("ذكور فقط");
  if (meta.gender_restriction === "female") eligibility.push("إناث فقط");
  if (meta.min_age_years !== null && meta.min_age_years !== undefined)
    eligibility.push(`من ${meta.min_age_years} سنة`);
  if (meta.max_age_years !== null && meta.max_age_years !== undefined)
    eligibility.push(`حتى ${meta.max_age_years} سنة`);

  const SUBSCRIPTION: Record<string, string> = {
    one_time: "لمرة واحدة",
    monthly: "شهري",
    quarterly: "ربع سنوي",
    annual: "سنوي",
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <Badge variant="outline">{SUBSCRIPTION[meta.subscription_type] ?? meta.subscription_type}</Badge>
      {Number(meta.savings ?? 0) > 0 && (
        <Badge variant="success">
          وفر {Number(meta.savings).toLocaleString("ar-SA-u-nu-latn")} من {Number(meta.list_price ?? 0).toLocaleString("ar-SA-u-nu-latn")}
        </Badge>
      )}
      {eligibility.map((e) => (
        <Badge key={e} variant="secondary">{e}</Badge>
      ))}
      {meta.branch_name && <Badge variant="outline">فرع: {meta.branch_name}</Badge>}
      <Badge variant={meta.is_transferable ? "outline" : "secondary"}>
        {meta.is_transferable ? "قابلة للنقل" : "غير قابلة للنقل"}
      </Badge>
      <Badge variant={meta.is_refundable ? "outline" : "secondary"}>
        {meta.is_refundable ? "قابلة للاسترداد" : "غير مستردّة"}
      </Badge>
      {meta.max_renewals !== null && meta.max_renewals !== undefined && (
        <Badge variant="secondary">حدّ التجديد {meta.max_renewals}</Badge>
      )}
      {meta.refund_policy && (
        <span className="text-muted-foreground">· {meta.refund_policy}</span>
      )}
    </div>
  );
}
