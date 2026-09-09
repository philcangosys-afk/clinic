import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Pill, Plus, Printer, RefreshCw, RotateCcw, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import type { DrugDosageForm, PrescriptionRoute } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { printHtml } from "@/lib/document-merge";
import { errorMessage } from "@/lib/error-message";
import {
  formatAmount,
  formatCount,
  formatDate,
  formatDateTime,
  useLocaleSettings,
  type CalendarDisplay,
} from "@/lib/locale";
import { LookupTree, useCategorySubtree } from "@/components/shared/LookupTree";
import { TreeGridLayout } from "@/components/shell/TreeGridLayout";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";

const DOSAGE_FORM_LABELS: Record<DrugDosageForm, string> = {
  tablet: "حبوب",
  capsule: "كبسولات",
  syrup: "شراب",
  injection: "حقن",
  cream: "كريم",
  ointment: "مرهم",
  drops: "قطرات",
  inhaler: "بخاخ استنشاق",
  suppository: "لبوس",
  other: "أخرى",
};
const ROUTE_LABELS: Record<PrescriptionRoute, string> = {
  oral: "عن طريق الفم",
  topical: "موضعي",
  injection: "حقن",
  inhalation: "استنشاق",
  rectal: "شرجي",
  ophthalmic: "للعين",
  otic: "للأذن",
  nasal: "للأنف",
  other: "أخرى",
};

function useDoctorsList() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ["doctors-active-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useWarehousesList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["warehouses-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Pharmacy() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الصيدلية والأدوية والوصفات</h1>
        <p className="text-sm text-muted-foreground">كتالوج الأدوية، كتابة الوصفات الطبية، وصرفها من المخزون</p>
      </div>

      <Tabs defaultValue="dispensing">
        <TabsList>
          <TabsTrigger value="dispensing">الصرف</TabsTrigger>
          <TabsTrigger value="prescriptions">الوصفات</TabsTrigger>
          <TabsTrigger value="catalog">كتالوج الأدوية</TabsTrigger>
        </TabsList>
        <TabsContent value="dispensing" className="mt-4">
          <DispensingTab />
        </TabsContent>
        <TabsContent value="prescriptions" className="mt-4">
          <PrescriptionsTab />
        </TabsContent>
        <TabsContent value="catalog" className="mt-4">
          <DrugCatalogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// كتالوج الأدوية
//
// يقرأ `v_drug_catalog` (0088): الصنف وتفاصيله الدوائية ورصيده في نداء واحد،
// بدل `items` + علاقة مضمَّنة كانت تُرجع مصفوفة أو كائنًا حسب المزاج.
// ---------------------------------------------------------------------------
type DrugCatalogRow = {
  item_id: string;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  unit: string | null;
  price: number | null;
  cost_price: number | null;
  reorder_level: number | null;
  is_disabled: boolean;
  is_archived: boolean;
  generic_name: string | null;
  brand_name: string | null;
  dosage_form: string | null;
  strength_text: string | null;
  manufacturer: string | null;
  registration_number: string | null;
  atc_code: string | null;
  default_route: string | null;
  pack_size: number | null;
  storage_conditions: string | null;
  requires_prescription: boolean | null;
  is_controlled_substance: boolean | null;
  controlled_drug_class: string | null;
  default_dosage_instructions: string | null;
  stock_on_hand: number;
  stock_reserved: number;
  /* مُضافان في الترقية 0151 — بدونهما لا تستطيع الشجرة أن تُرشِّح */
  category_value_id: string | null;
  category_name: string | null;
};

const CONTROLLED_CLASS_LABELS: Record<string, string> = {
  narcotic: "مخدّر",
  psychotropic: "مؤثّر عقلي",
  precursor: "سليفة كيميائية",
  controlled_other: "خاضع لرقابة أخرى",
};

function useDrugCatalog(organizationId: string | undefined, includeArchived: boolean) {
  return useQuery({
    queryKey: ["drug-catalog", organizationId, includeArchived],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("v_drug_catalog")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name_ar");
      // كل قائمة اختيار تعرض النشط غير المؤرشف فقط — والمؤرشف يظهر هنا
      // بطلب صريح لأن هذه شاشة إدارة لا قائمة اختيار.
      if (!includeArchived) query = query.eq("is_archived", false);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DrugCatalogRow[];
    },
  });
}

function DrugCatalogTab() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const [showArchived, setShowArchived] = useState(false);
  const drugs = useDrugCatalog(organization?.id, showArchived);
  const [editing, setEditing] = useState<DrugCatalogRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const canManage = can("pharmacy.manage_drugs");
  const all = useMemo(() => drugs.data ?? [], [drugs.data]);

  /* عدد الأدوية تحت كل فئة يُحسب من الصفوف المحمَّلة نفسها لا باستعلامٍ ثانٍ:
     الكتالوج كلّه محمَّل في هذه الشاشة أصلًا، فالعدّ في المتصفّح مطابقٌ لما
     يراه الموظّف — ورقمٌ من استعلامٍ آخر قد يخالف ما في الشبكة أمامه. */
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const drug of all) {
      if (!drug.category_value_id) continue;
      map[drug.category_value_id] = (map[drug.category_value_id] ?? 0) + 1;
    }
    return map;
  }, [all]);

  const categorySubtree = useCategorySubtree("item_categories");
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const scope = categoryId ? new Set(categorySubtree(categoryId)) : null;
    return all.filter((drug) => {
      if (scope && !(drug.category_value_id && scope.has(drug.category_value_id))) return false;
      if (!needle) return true;
      return [drug.name_ar, drug.name_en, drug.code, drug.generic_name, drug.brand_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [all, search, categoryId, categorySubtree]);

  return (
    /* الشجرة تحلّ محلّ قائمةٍ منسدلة لم تكن موجودة أصلًا: كتالوج الأدوية عند
       المالك بمئات الأصناف، والبحث بالاسم وحده لا يُعين من يريد تصفّح فئة. */
    <TreeGridLayout
      treeTitle="فئات الأدوية"
      tree={
        <LookupTree
          categoryKey="item_categories"
          value={categoryId}
          onChange={setCategoryId}
          allLabel="كل الأدوية"
          counts={counts}
          totalCount={all.length}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <ScreenToolbar
          items={[
            {
              key: "new",
              label: "دواء جديد",
              icon: Plus,
              hidden: !canManage,
              onClick: () => setCreateOpen(true),
            },
            { key: "sep1", separator: true },
            {
              key: "refresh",
              label: "تحديث",
              icon: RefreshCw,
              onClick: () => void drugs.refetch(),
            },
            {
              key: "archived",
              label: showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف",
              icon: Archive,
              title: "الأرشفة ليست حذفًا — الدواء يختفي من الصرف ويبقى تاريخه",
              onClick: () => setShowArchived((prev) => !prev),
            },
          ]}
        >
          <Input
            className="w-60"
            placeholder="بحث بالاسم أو الكود أو العلمي"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </ScreenToolbar>

        <Card>
          <CardHeader>
            <CardTitle>كتالوج الأدوية</CardTitle>
            <CardDescription>
              الدواء صنف من نوع «drug» في الكتالوج الموحّد، بتفاصيل دوائية ورصيد مخزون
            </CardDescription>
          </CardHeader>
          <CardContent>
            {drugs.isLoading && <Skeleton className="h-40 w-full" />}
            {drugs.isError && (
              <p className="py-6 text-center text-sm text-destructive">
                تعذّر تحميل الكتالوج: {errorMessage(drugs.error)}
              </p>
            )}
            {!drugs.isLoading && !drugs.isError && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>الاسم العلمي</TableHead>
                    <TableHead>الشكل والتركيز</TableHead>
                    <TableHead>الرصيد</TableHead>
                    <TableHead>الصرف</TableHead>
                    <TableHead>السعر</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((drug) => {
                    const onHand = Number(drug.stock_on_hand ?? 0);
                    const reserved = Number(drug.stock_reserved ?? 0);
                    const reorder = Number(drug.reorder_level ?? 0);
                    return (
                      <TableRow key={drug.item_id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Pill className="h-4 w-4 text-muted-foreground" />
                            <span>{drug.name_ar}</span>
                            {drug.is_controlled_substance && (
                              <Badge variant="destructive">
                                {CONTROLLED_CLASS_LABELS[drug.controlled_drug_class ?? ""] ??
                                  "خاضع للرقابة"}
                              </Badge>
                            )}
                            {drug.is_disabled && <Badge variant="secondary">معطَّل</Badge>}
                            {drug.is_archived && <Badge variant="secondary">مؤرشف</Badge>}
                          </div>
                          {drug.code && (
                            <span className="text-xs text-muted-foreground">{drug.code}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {drug.category_name ?? "—"}
                        </TableCell>
                        <TableCell>{drug.generic_name ?? "—"}</TableCell>
                        <TableCell>
                          {drug.dosage_form
                            ? DOSAGE_FORM_LABELS[drug.dosage_form as DrugDosageForm]
                            : "—"}
                          {drug.strength_text ? ` — ${drug.strength_text}` : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{formatCount(onHand)}</span>
                            {reserved > 0 && (
                              <span className="text-xs text-muted-foreground">
                                ({formatCount(reserved)} محجوز)
                              </span>
                            )}
                            {reorder > 0 && onHand <= reorder && (
                              <Badge variant="warning">دون حدّ الطلب</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {drug.requires_prescription === false ? (
                            <Badge variant="secondary">بلا وصفة</Badge>
                          ) : (
                            <Badge variant="warning">بوصفة</Badge>
                          )}
                        </TableCell>
                        <TableCell>{formatAmount(drug.price)} ر.س</TableCell>
                        {canManage && (
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(drug)}>
                              تعديل
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={canManage ? 8 : 7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {search || categoryId
                          ? "لا نتائج مطابقة."
                          : "لا توجد أدوية في الكتالوج بعد."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {!drugs.isLoading && !drugs.isError && <GridFooterCount count={rows.length} />}
        </Card>
      </div>

      <DrugDialog
        open={createOpen || Boolean(editing)}
        drug={editing}
        onOpenChange={(next) => {
          if (!next) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        organizationId={organization?.id}
      />
    </TreeGridLayout>
  );
}

/**
 * محرّر الدواء.
 *
 * يحفظ عبر `app_save_drug` (0088) في نداء واحد ذرّي بدل إدراجين متتاليين في
 * `items` ثم `drug_details`: فشل الثاني كان يترك صنفًا بلا تفاصيل دوائية،
 * فيظهر في الكتالوج بلا شكل ولا تركيز ولا اشتراط وصفة.
 *
 * الحفظ **دمجيّ**: ما لا يُرسَل لا يُمحى، فتعديل السعر وحده لا يمسح الاسم
 * العلمي ولا حدّ إعادة الطلب.
 */
function DrugDialog({
  open,
  drug,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  drug: DrugCatalogRow | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [requiresPrescription, setRequiresPrescription] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = drug?.item_id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setForm({
      code: drug?.code ?? `DRG-${Date.now().toString().slice(-6)}`,
      name_ar: drug?.name_ar ?? "",
      name_en: drug?.name_en ?? "",
      generic_name: drug?.generic_name ?? "",
      brand_name: drug?.brand_name ?? "",
      dosage_form: drug?.dosage_form ?? "tablet",
      strength_text: drug?.strength_text ?? "",
      default_route: drug?.default_route ?? "",
      manufacturer: drug?.manufacturer ?? "",
      registration_number: drug?.registration_number ?? "",
      atc_code: drug?.atc_code ?? "",
      controlled_drug_class: drug?.controlled_drug_class ?? "",
      pack_size: drug?.pack_size != null ? String(drug.pack_size) : "",
      storage_conditions: drug?.storage_conditions ?? "",
      unit: drug?.unit ?? "علبة",
      price: drug?.price != null ? String(drug.price) : "0",
      cost_price: drug?.cost_price != null ? String(drug.cost_price) : "",
      reorder_level: drug?.reorder_level != null ? String(drug.reorder_level) : "0",
      default_dosage_instructions: drug?.default_dosage_instructions ?? "",
    });
    setRequiresPrescription(drug?.requires_prescription !== false);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const payload: Record<string, unknown> = {
        code: form.code?.trim(),
        name_ar: form.name_ar?.trim(),
        name_en: form.name_en?.trim() || null,
        generic_name: form.generic_name?.trim() || null,
        brand_name: form.brand_name?.trim() || null,
        dosage_form: form.dosage_form || "tablet",
        strength_text: form.strength_text?.trim() || null,
        default_route: form.default_route || null,
        manufacturer: form.manufacturer?.trim() || null,
        registration_number: form.registration_number?.trim() || null,
        atc_code: form.atc_code?.trim() || null,
        controlled_drug_class: form.controlled_drug_class || null,
        pack_size: form.pack_size ? Number(form.pack_size) : null,
        storage_conditions: form.storage_conditions?.trim() || null,
        unit: form.unit?.trim() || "علبة",
        price: Number(form.price) || 0,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        reorder_level: Number(form.reorder_level) || 0,
        requires_prescription: requiresPrescription,
        default_dosage_instructions: form.default_dosage_instructions?.trim() || null,
      };
      const { error } = await supabase.rpc("app_save_drug", {
        p_organization_id: organizationId,
        p_item_id: drug?.item_id ?? null,
        p_payload: payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drug-catalog", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["drugs-select-list", organizationId] });
      toast({ title: drug ? "تم تحديث الدواء" : "تم حفظ الدواء" });
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
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{drug ? `تعديل: ${drug.name_ar}` : "دواء جديد"}</DialogTitle>
          <DialogDescription>
            الدواء يُتتبَّع مخزونًا وصلاحيةً تلقائيًا — بلا ذلك لا معنى لدفعة ولا لتاريخ انتهاء
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الكود *</Label>
            <Input value={form.code ?? ""} onChange={(e) => set("code", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم التجاري *</Label>
            <Input value={form.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={form.name_en ?? ""} onChange={(e) => set("name_en", e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم العلمي</Label>
            <Input value={form.generic_name ?? ""} onChange={(e) => set("generic_name", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الشكل الدوائي</Label>
            <Select value={form.dosage_form ?? "tablet"} onValueChange={(v) => set("dosage_form", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOSAGE_FORM_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التركيز</Label>
            <Input value={form.strength_text ?? ""} onChange={(e) => set("strength_text", e.target.value)} placeholder="500mg" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>طريق الإعطاء الافتراضي</Label>
            <Select value={form.default_route || "none"} onValueChange={(v) => set("default_route", v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="غير محدَّد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">غير محدَّد</SelectItem>
                {Object.entries(ROUTE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التصنيف الرقابي</Label>
            <Select
              value={form.controlled_drug_class || "none"}
              onValueChange={(v) => set("controlled_drug_class", v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="غير خاضع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">غير خاضع للرقابة</SelectItem>
                {Object.entries(CONTROLLED_CLASS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الشركة المصنّعة</Label>
            <Input value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم التسجيل</Label>
            <Input value={form.registration_number ?? ""} onChange={(e) => set("registration_number", e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رمز ATC</Label>
            <Input value={form.atc_code ?? ""} onChange={(e) => set("atc_code", e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>وحدة البيع</Label>
            <Input value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حجم العبوة</Label>
            <Input type="number" min={0} value={form.pack_size ?? ""} onChange={(e) => set("pack_size", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حدّ إعادة الطلب</Label>
            <Input type="number" min={0} value={form.reorder_level ?? "0"} onChange={(e) => set("reorder_level", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سعر البيع</Label>
            <Input type="number" min={0} value={form.price ?? "0"} onChange={(e) => set("price", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سعر التكلفة</Label>
            <Input type="number" min={0} value={form.cost_price ?? ""} onChange={(e) => set("cost_price", e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>ظروف التخزين</Label>
            <Input
              value={form.storage_conditions ?? ""}
              onChange={(e) => set("storage_conditions", e.target.value)}
              placeholder="مثال: يُحفظ بين ٢ و٨ درجات"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>تعليمات الجرعة الافتراضية</Label>
            <Textarea
              value={form.default_dosage_instructions ?? ""}
              onChange={(e) => set("default_dosage_instructions", e.target.value)}
              rows={2}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresPrescription}
              onChange={(e) => setRequiresPrescription(e.target.checked)}
            />
            يحتاج وصفة طبية للصرف
          </label>
          {form.controlled_drug_class && (
            <p className="col-span-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              التصنيف الرقابي يرفع علَم «خاضع للرقابة» تلقائيًا، ويشترط صلاحية
              <span className="font-mono"> pharmacy.dispense_controlled </span>
              عند كل صرف، ويُسجَّل باسم الدواء في سجل التدقيق.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={!form.name_ar?.trim() || !form.code?.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الوصفات
// ---------------------------------------------------------------------------
type PharmacyQueueRow = {
  prescription_id: string;
  organization_id: string;
  status: string;
  issued_at: string;
  sent_to_pharmacy_at: string | null;
  warehouse_id: string | null;
  patient_id: string;
  patient_name: string;
  file_number: string | null;
  doctor_name: string | null;
  clinic_name: string | null;
  lines_count: number;
  lines_done: number;
  qty_pending: number | null;
  has_controlled: boolean | null;
  qty_reserved: number;
  is_billed: boolean;
};

function usePendingPrescriptions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["pharmacy-queue", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pharmacy_queue")
        .select("*")
        .eq("organization_id", organizationId)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PharmacyQueueRow[];
    },
  });
}

function useDrugsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["drugs-select-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, drug_details(default_dosage_instructions)")
        .eq("organization_id", organizationId)
        .eq("item_type", "drug")
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * قائمة الوصفات الكاملة — لا `v_prescriptions_pending_dispensing` وحده.
 * العرض يقصر النتائج على الوصفات المعلّقة (`status in ('issued',
 * 'partially_dispensed')`) ولا يحمل أعمدة التأمين ولا الفوترة ولا الأسعار،
 * فكانت الوصفات المصروفة أو الملغاة غير قابلة للاستعراض أو الطباعة إطلاقًا.
 */
function usePrescriptionsList(organizationId: string | undefined, statusFilter: string) {
  return useQuery({
    queryKey: ["prescriptions-list", organizationId, statusFilter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("prescriptions")
        .select(
          "id, status, issued_at, notes, insurance_company_name, insurance_policy_number, is_billed, patient:patients(id, name_ar, file_number), doctor:doctors(name_ar), prescription_items(id, quantity_prescribed, dispensed_quantity, drug:items!prescription_items_drug_item_id_fkey(name_ar)), dispensing_records(id, status, dispensing_items(id, prescription_item_id, quantity_dispensed, unit_price))",
        )
        .eq("organization_id", organizationId)
        .order("issued_at", { ascending: false })
        .limit(300);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as PrescriptionListRow[];
    },
  });
}

type PrescriptionListRow = {
  id: string;
  status: string;
  issued_at: string;
  notes: string | null;
  insurance_company_name: string | null;
  insurance_policy_number: string | null;
  is_billed: boolean;
  patient: { id: string; name_ar: string; file_number: string | null } | null;
  doctor: { name_ar: string } | null;
  prescription_items: {
    id: string;
    quantity_prescribed: number;
    dispensed_quantity: number | null;
    drug: { name_ar: string } | null;
  }[];
  dispensing_records: {
    id: string;
    status: string;
    dispensing_items: {
      id: string;
      prescription_item_id: string | null;
      quantity_dispensed: number;
      unit_price: number | null;
    }[];
  }[];
};

const PRESCRIPTION_STATUS_LABELS: Record<string, string> = {
  draft: "مسوّدة",
  issued: "صادرة",
  partially_dispensed: "صرف جزئي",
  dispensed: "مصروفة",
  cancelled: "ملغاة",
};

/**
 * مبلغ الوصفة = قيمة **ما صُرف فعلًا** بسعر دفعته المسجَّل في `dispensing_items`.
 *
 * كان يُحسب سابقًا: الكمية الموصوفة × `items.price`. وذلك خطأ من وجهين:
 * • الصرف يُسعّر من الدفعة (`app_dispense_prescription` تكتب
 *   `unit_price = coalesce(lot.selling_price, item.price, 0)`)، فكانت الشاشة
 *   تعرض مبلغين مختلفين للوصفة نفسها: عمود «الإجمالي» وسجلّ الصرف.
 * • `items.price` ليس سعر مريض التأمين: السعر يمرّ بسُلَّم
 *   `app_resolve_item_price_v2` (تأمين ← عقد ← فرع ← أساس). فكان المؤمَّن
 *   تُطبَع له ورقة بمبلغ ليس هو ما سيُحصَّل.
 *
 * وما لم يُصرف بعد لا يُسعَّر هنا تخمينًا: سعره يُحسم عند الصرف/الفوترة، ويُعرض
 * ككمية معلّقة لا كمال. (إظهار مبلغ متوقَّع قبل الصرف يحتاج منظورًا/دالّة في
 * القاعدة تُطبّق سُلَّم الأسعار على بنود الوصفة.)
 */
function dispensedAmount(row: PrescriptionListRow) {
  return (row.dispensing_records ?? [])
    .filter((rec) => rec.status !== "cancelled")
    .reduce(
      (sum, rec) =>
        sum +
        (rec.dispensing_items ?? []).reduce(
          (lineSum, it) => lineSum + Number(it.quantity_dispensed ?? 0) * Number(it.unit_price ?? 0),
          0,
        ),
      0,
    );
}

/**
 * الكمية المصروفة فعلًا — لا الموصوفة. تُستعمل لتمييز «مصروف غير مفوتر» عن
 * «لم يُصرف»: الأول دواءٌ خرج من المخزون ويجب أن يُفوتَر، والثاني لا شيء عليه
 * بعد. (لا تُقاس بالمبلغ: دواء بسعر دفعة صفر مصروفٌ كذلك.)
 */
function dispensedQuantity(row: PrescriptionListRow) {
  return (row.dispensing_records ?? [])
    .filter((rec) => rec.status !== "cancelled")
    .reduce(
      (sum, rec) =>
        sum +
        (rec.dispensing_items ?? []).reduce(
          (lineSum, it) => lineSum + Number(it.quantity_dispensed ?? 0),
          0,
        ),
      0,
    );
}

/** الكمية الموصوفة التي لم تُصرف بعد — تُعرض ككمية لأن سعرها غير محسوم. */
function pendingQuantity(row: PrescriptionListRow) {
  return (row.prescription_items ?? []).reduce(
    (sum, line) =>
      sum + Math.max(0, Number(line.quantity_prescribed ?? 0) - Number(line.dispensed_quantity ?? 0)),
    0,
  );
}

/** الكمية المصروفة والمبلغ الفعليّ لكل بند، من `dispensing_items` لا من سعر الصنف. */
function dispensedByLine(row: PrescriptionListRow) {
  const byLine = new Map<string, { quantity: number; amount: number }>();
  for (const rec of row.dispensing_records ?? []) {
    if (rec.status === "cancelled") continue;
    for (const it of rec.dispensing_items ?? []) {
      if (!it.prescription_item_id) continue;
      const current = byLine.get(it.prescription_item_id) ?? { quantity: 0, amount: 0 };
      current.quantity += Number(it.quantity_dispensed ?? 0);
      current.amount += Number(it.quantity_dispensed ?? 0) * Number(it.unit_price ?? 0);
      byLine.set(it.prescription_item_id, current);
    }
  }
  return byLine;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
  );
}

function printPrescriptions(
  rows: PrescriptionListRow[],
  organizationName: string,
  calendar: CalendarDisplay,
) {
  const body = rows
    .map((row) => {
      const dispensed = dispensedByLine(row);
      const lines = (row.prescription_items ?? [])
        .map((line) => {
          const drug = Array.isArray(line.drug) ? line.drug[0] : line.drug;
          // المبلغ من الصرف الفعليّ فقط؛ البند غير المصروف يُطبَع بلا مبلغ بدل
          // مبلغٍ بسعر الصنف لا يُحصَّل (خاصة لمريض التأمين).
          const done = dispensed.get(line.id);
          const amount = done?.amount ?? 0;
          return `<tr><td>${escapeHtml(drug?.name_ar ?? "—")}</td><td>${line.quantity_prescribed}</td><td>${
            done?.quantity ?? 0
          }</td><td>${done && done.quantity > 0 ? amount.toFixed(2) : "لم يُصرف بعد"}</td></tr>`;
        })
        .join("");
      return `<section style="page-break-inside:avoid;margin-bottom:24px;border-bottom:1px solid #ccc;padding-bottom:12px">
        <h3 style="margin:0 0 6px">${escapeHtml(row.patient?.name_ar ?? "—")} — ملف ${escapeHtml(
          row.patient?.file_number ?? "—",
        )}</h3>
        <p style="margin:0 0 6px;font-size:13px">
          الطبيب: ${escapeHtml(row.doctor?.name_ar ?? "—")} ·
          التاريخ: ${formatDate(row.issued_at, calendar)} ·
          الحالة: ${escapeHtml(PRESCRIPTION_STATUS_LABELS[row.status] ?? row.status)}
          ${row.is_billed ? " · تمت الفوترة" : ""}
        </p>
        ${
          row.insurance_company_name
            ? `<p style="margin:0 0 6px;font-size:13px">التأمين: ${escapeHtml(
                row.insurance_company_name,
              )}${row.insurance_policy_number ? ` — بوليصة ${escapeHtml(row.insurance_policy_number)}` : ""}</p>`
            : ""
        }
        <table style="width:100%;border-collapse:collapse;font-size:13px" border="1" cellpadding="4">
          <thead><tr><th>الدواء</th><th>الموصوف</th><th>المصروف</th><th>قيمة المصروف</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <p style="margin:6px 0 0;font-size:13px;font-weight:bold">قيمة ما صُرف: ${dispensedAmount(row).toFixed(
          2,
        )}</p>
        ${
          pendingQuantity(row) > 0
            ? `<p style="margin:2px 0 0;font-size:12px">لم يُصرف بعد: ${pendingQuantity(
                row,
              )} وحدة — تُسعَّر عند الصرف حسب قائمة أسعار المريض، وهذه الورقة ليست فاتورة.</p>`
            : ""
        }
      </section>`;
    })
    .join("");
  printHtml(
    "قائمة الوصفات",
    `<h2 style="margin:0 0 4px">${escapeHtml(organizationName)}</h2>
     <p style="margin:0 0 16px;font-size:13px">قائمة الوصفات — ${rows.length} وصفة · ${new Date().toLocaleDateString(
       "ar-SA",
     )}</p>${body}`,
  );
}

function PrescriptionsTab() {
  const { calendarDisplay } = useLocaleSettings();
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [statusFilter, setStatusFilter] = useState("all");
  const prescriptions = usePrescriptionsList(organization?.id, statusFilter);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelRow, setCancelRow] = useState<PrescriptionListRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  /**
   * إلغاء الوصفة.
   *
   * الحالة `cancelled` كانت معروضة في هذه الشاشة منذ 0015 — بشارة حمراء
   * وترجمة عربية — ولا شيء في النظام كلّه يستطيع ضبطها. الزرّ هنا يصلها
   * بـ`app_set_prescription_status` (0088)، التي تُلزم بسبب، وتفكّ الحجوزات،
   * وترفض الإلغاء إن كان ثمّة صرف منفَّذ لم يُلغَ.
   */
  const cancelPrescription = useMutation({
    mutationFn: async () => {
      if (!cancelRow) throw new Error("لا وصفة محدَّدة");
      if (!cancelReason.trim()) throw new Error("اكتب سبب الإلغاء");
      const { error } = await supabase.rpc("app_set_prescription_status", {
        p_prescription_id: cancelRow.id,
        p_status: "cancelled",
        p_reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-queue", organization?.id] });
      toast({ title: "أُلغيت الوصفة وفُكّت حجوزاتها" });
      setCancelRow(null);
      setCancelReason("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإلغاء",
        description: errorMessage(error),
      }),
  });

  /**
   * **حُذف زرّ «لم تُفوتَر / تمت الفوترة»** الذي كان هنا.
   *
   * لماذا كان خطأً قاتلًا: الزرّ كان يقلب `prescriptions.is_billed` بتحديث
   * مباشر — علمٌ منطقي لا يُنشئ فاتورة ولا بندًا ولا إيرادًا ولا قيدًا. فكان
   * الصيدليّ يصرف الدواء (المخزون ينقص فعلًا)، يضغط «تمت الفوترة»، فيرى الصفّ
   * أخضر ويطمئن — ولا مال حُصِّل، ولا مستند ضريبي صدر. والأسوأ أن قلبه إلى
   * `true` كان **يُخفي** الوصفة عن قائمة «أدوية مصروفة غير مفوترة» في شاشة
   * الفوترة (وعن المنظور `v_unbilled_dispensed_prescriptions` الذي يشترط
   * `is_billed = false`) — فيمحو الأثر الوحيد الدالّ على إيراد لم يُحصَّل.
   *
   * الآن: الحالة **تُعرَض** للصيدليّ ولا تُحرَّر. و`is_billed` لا يكتبها إلا
   * `app_create_sales_invoice` داخل معاملة الفاتورة.
   */
  const rows = prescriptions.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>الوصفات</CardTitle>
          <CardDescription>
            كل الوصفات الصادرة مع حالة الصرف والفوترة وبيانات التأمين — والمبلغ هو قيمة ما صُرف فعلًا
            بسعر دفعته، لا تقديرًا بسعر الصنف
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="كل الحالات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {Object.entries(PRESCRIPTION_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => printPrescriptions(rows, organization?.name ?? "", calendarDisplay)}
          >
            <Printer className="h-4 w-4" />
            طباعة القائمة
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            وصفة جديدة
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {prescriptions.isLoading && <Skeleton className="h-40 w-full" />}
        {!prescriptions.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الأدوية</TableHead>
                <TableHead>قيمة المصروف</TableHead>
                <TableHead>التأمين</TableHead>
                <TableHead>الفوترة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const patient = Array.isArray(row.patient) ? row.patient[0] : row.patient;
                const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                const dispensed = (row.prescription_items ?? []).filter(
                  (line) => Number(line.dispensed_quantity ?? 0) >= Number(line.quantity_prescribed ?? 0),
                ).length;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.issued_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="font-medium">{patient?.name_ar ?? "—"}</TableCell>
                    <TableCell>{doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "dispensed"
                            ? "success"
                            : row.status === "cancelled"
                              ? "destructive"
                              : row.status === "partially_dispensed"
                                ? "warning"
                                : "secondary"
                        }
                      >
                        {PRESCRIPTION_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {dispensed} / {(row.prescription_items ?? []).length}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {dispensedAmount(row).toFixed(2)}
                      {pendingQuantity(row) > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          + {pendingQuantity(row)} لم تُصرف (تُسعَّر عند الصرف)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.insurance_company_name ?? "—"}
                      {row.insurance_policy_number ? ` · ${row.insurance_policy_number}` : ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {row.is_billed ? (
                          <Badge variant="success">مفوترة</Badge>
                        ) : dispensedQuantity(row) > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="warning">مصروف غير مفوتر</Badge>
                            <span className="text-[10px] text-muted-foreground">
                              يُفوتَر من شاشة الفوترة
                            </span>
                          </div>
                        ) : (
                          <Badge variant="secondary">لم يُصرف</Badge>
                        )}
                        {can("pharmacy.prescribe") &&
                          !["cancelled", "dispensed"].includes(row.status) && (
                            <Button size="sm" variant="ghost" onClick={() => setCancelRow(row)}>
                              <X className="h-4 w-4" />
                              إلغاء
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد وصفات مطابقة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewPrescriptionDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />

      <Dialog open={Boolean(cancelRow)} onOpenChange={(next) => !next && setCancelRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء الوصفة</DialogTitle>
            <DialogDescription>
              الإلغاء يفكّ ما حُجز من المخزون لهذه الوصفة، ولا يمسّ صرفًا وقع — لإبطاله يُلغى الصرف
              نفسه فتعود الكميات بحركة مسجَّلة.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>سبب الإلغاء *</Label>
            <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelPrescription.isPending}
              onClick={() => cancelPrescription.mutate()}
            >
              {cancelPrescription.isPending ? "جارٍ الإلغاء..." : "تأكيد الإلغاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewPrescriptionDialog({
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
  const doctors = useDoctorsList();
  const drugs = useDrugsList(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  /**
   * بيانات التأمين تُنسَخ إلى الوصفة لا تُقرَأ من ملف المريض وقت العرض:
   * المريض قد يغيّر شركته أو بوليصته لاحقًا، والوصفة مستند مؤرَّخ يجب أن
   * يبقى معبّرًا عن حالته يوم إصداره (0042).
   */
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  /**
   * **حُذفت خانة «تمت الفوترة»** من هذه النافذة.
   *
   * كانت تكتب `is_billed = true` على وصفة **لم تُصرف ولم تُفوتَر بعد**، فتُخرجها
   * من `v_unbilled_dispensed_prescriptions` نهائيًا: الدواء يُصرف لاحقًا وينقص
   * المخزون ولا يظهر في قائمة «أدوية مصروفة غير مفوترة» أبدًا. علمُ الفوترة
   * نتيجةُ إصدار فاتورة لا مُدخَل من مُصدِر الوصفة، وتضعه القاعدة وحدها داخل
   * معاملة `app_create_sales_invoice` — والعمود `not null default false`.
   */
  const [lines, setLines] = useState<
    { drugId: string; instructions: string; frequency: string; durationDays: string; quantity: string; route: PrescriptionRoute }[]
  >([]);

  const addLine = () =>
    setLines((ls) => [...ls, { drugId: "", instructions: "", frequency: "", durationDays: "", quantity: "1", route: "oral" }]);

  const createPrescription = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      const validLines = lines.filter((line) => line.drugId);
      if (validLines.length === 0) throw new Error("أضف دواءً واحدًا على الأقل");

      const { data: prescription, error: prescriptionError } = await supabase
        .from("prescriptions")
        .insert({
          organization_id: organizationId,
          patient_id: patient.id,
          doctor_id: doctorId || null,
          status: "issued",
          insurance_company_name: insuranceCompany.trim() || null,
          insurance_policy_number: insurancePolicy.trim() || null,
        })
        .select("id")
        .single();
      if (prescriptionError) throw prescriptionError;

      const { error: itemsError } = await supabase.from("prescription_items").insert(
        validLines.map((line) => ({
          prescription_id: prescription.id,
          drug_item_id: line.drugId,
          dosage_instructions: line.instructions.trim() || null,
          frequency: line.frequency.trim() || null,
          duration_days: line.durationDays ? Number(line.durationDays) : null,
          quantity_prescribed: Number(line.quantity) || 1,
          route: line.route,
        })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      // مفتاح طابور الصرف هو ["pharmacy-queue", …] كما في `usePendingPrescriptions`.
      // كان المفتاح المبطَّل هنا ["pending-prescriptions", …] ولا يستخدمه أي
      // استعلام، فلا تظهر الوصفة الجديدة في تبويب «الصرف» حتى تحديث الصفحة —
      // فيظنّ المُصدِر أن الحفظ فشل ويُصدر وصفة ثانية لنفس المريض.
      queryClient.invalidateQueries({ queryKey: ["pharmacy-queue", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      toast({ title: "تم إصدار الوصفة" });
      setPatient(null);
      setDoctorId("");
      setInsuranceCompany("");
      setInsurancePolicy("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إصدار الوصفة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>وصفة طبية جديدة</DialogTitle>
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
            <Label>الطبيب المعالج</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختياري" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>شركة التأمين</Label>
              <Input
                value={insuranceCompany}
                onChange={(e) => setInsuranceCompany(e.target.value)}
                placeholder="اختياري"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم البوليصة</Label>
              <Input
                value={insurancePolicy}
                onChange={(e) => setInsurancePolicy(e.target.value)}
                placeholder="اختياري"
                dir="ltr"
              />
            </div>
          </div>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            الوصفة تُصدر غير مفوترة. ما يُصرف منها يظهر في «أدوية مصروفة غير مفوترة» بشاشة
            الفوترة، ويُختَم «مفوترة» بإصدار الفاتورة من هناك.
          </p>

          <Separator />
          <div className="flex items-center justify-between">
            <Label>الأدوية</Label>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" />
              إضافة دواء
            </Button>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <Select
                  value={line.drugId}
                  onValueChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, drugId: v } : l)))}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="اختر دواء" />
                  </SelectTrigger>
                  <SelectContent>
                    {(drugs.data ?? []).map((drug) => (
                      <SelectItem key={drug.id} value={drug.id}>
                        {drug.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  placeholder="التكرار (مرتين يوميًا)"
                  value={line.frequency}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, frequency: e.target.value } : l)))}
                />
                <Input
                  type="number"
                  placeholder="عدد الأيام"
                  value={line.durationDays}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, durationDays: e.target.value } : l)))}
                />
                <Input
                  type="number"
                  placeholder="الكمية"
                  value={line.quantity}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                />
                <Select
                  value={line.route}
                  onValueChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, route: v as PrescriptionRoute } : l)))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROUTE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="تعليمات إضافية (اختياري)"
                value={line.instructions}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, instructions: e.target.value } : l)))}
              />
            </div>
          ))}
          {lines.length === 0 && <p className="text-center text-sm text-muted-foreground">أضف دواءً واحدًا على الأقل</p>}
        </div>
        <DialogFooter>
          <Button disabled={!patient || lines.length === 0 || createPrescription.isPending} onClick={() => createPrescription.mutate()}>
            {createPrescription.isPending ? "جارٍ الإصدار..." : "إصدار الوصفة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الصرف
//
// المسار القديم كان: أدرج `dispensing_records`، ثم أدرج `dispensing_items`
// بدفعة يختارها الصيدليّ من قائمة. ثلاث مشكلات في هذا: الطلبان غير ذرّيين،
// والدفعة اختيار بشريّ لا FEFO، والكمية محدودة بالموصوف لا بالمتاح — فصرف
// ١٠ من دفعة فيها ٣ كان يترك رصيدًا سالبًا في القاعدة.
//
// الآن نداء واحد: `app_dispense_prescription` يوزّع FEFO، ويرفض المنتهي
// والمؤرشف والمعطَّل، ويشترط صلاحية إضافية للرقابي، ويسعّر من الدفعة.
// ---------------------------------------------------------------------------
type PrescriptionLine = {
  id: string;
  drug_item_id: string;
  quantity_prescribed: number;
  dispensed_quantity: number;
  dosage_instructions: string | null;
  frequency: string | null;
  duration_days: number | null;
  drug?: { id: string; name_ar: string } | null;
};

function usePrescriptionDetails(prescriptionId: string | null) {
  return useQuery({
    queryKey: ["prescription-details", prescriptionId],
    enabled: Boolean(prescriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prescription_items")
        .select(
          "id, drug_item_id, quantity_prescribed, dispensed_quantity, dosage_instructions, frequency, duration_days, drug:items!prescription_items_drug_item_id_fkey(id, name_ar)",
        )
        .eq("prescription_id", prescriptionId);
      if (error) throw error;
      return (data ?? []) as unknown as PrescriptionLine[];
    },
  });
}

/**
 * المتاح فعلًا لكل دواء في مستودع.
 *
 * يقرأ `v_available_drug_lots` (0088) الذي يستبعد المنتهي وغير المتاح ويطرح
 * المحجوز — لا `inventory_lots` الخام كما كان، فقد كان المنظور القديم يعرض
 * دفعة انتهت أمس كأنها صالحة للصرف.
 */
function useAvailableStock(warehouseId: string, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["available-stock", warehouseId, organizationId],
    enabled: Boolean(warehouseId && organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_available_drug_lots")
        .select("item_id, qty_available, expiry_date, days_to_expiry, selling_price, lot_number")
        .eq("organization_id", organizationId)
        .eq("warehouse_id", warehouseId);
      if (error) throw error;
      const map: Record<string, { available: number; nearestExpiry: string | null; price: number | null }> = {};
      for (const row of (data ?? []) as {
        item_id: string;
        qty_available: number;
        expiry_date: string | null;
        selling_price: number | null;
      }[]) {
        const cur = map[row.item_id] ?? { available: 0, nearestExpiry: null, price: null };
        cur.available += Number(row.qty_available ?? 0);
        if (!cur.nearestExpiry || (row.expiry_date && row.expiry_date < cur.nearestExpiry)) {
          cur.nearestExpiry = row.expiry_date;
        }
        if (cur.price == null) cur.price = row.selling_price;
        map[row.item_id] = cur;
      }
      return map;
    },
  });
}

function useDispensingHistory(prescriptionId: string | null) {
  return useQuery({
    queryKey: ["dispensing-history", prescriptionId],
    enabled: Boolean(prescriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_records")
        .select(
          "id, status, dispensed_at, notes, dispensing_items(id, quantity_dispensed, unit_price, drug:items(name_ar))",
        )
        .eq("prescription_id", prescriptionId)
        .order("dispensed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        status: string;
        dispensed_at: string;
        notes: string | null;
        dispensing_items: {
          id: string;
          quantity_dispensed: number;
          unit_price: number;
          drug?: { name_ar: string } | null;
        }[];
      }[];
    },
  });
}

function DispensingTab() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const prescriptions = usePendingPrescriptions(organization?.id);
  const [openPrescriptionId, setOpenPrescriptionId] = useState<string | null>(null);

  const canDispense = can("pharmacy.dispense");

  return (
    <Card>
      <CardHeader>
        <CardTitle>طابور الصرف</CardTitle>
        <CardDescription>
          الصرف يوزّع الكمية على الدفعات بترتيب الأقرب انتهاءً أوّلًا، ويتجاوز المحجوز والمنتهي
        </CardDescription>
      </CardHeader>
      <CardContent>
        {prescriptions.isLoading && <Skeleton className="h-40 w-full" />}
        {!prescriptions.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الأدوية</TableHead>
                <TableHead>المتبقّي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(prescriptions.data ?? []).map((pr) => (
                <TableRow key={pr.prescription_id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{pr.patient_name}</span>
                      {pr.has_controlled && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          رقابي
                        </Badge>
                      )}
                    </div>
                    {pr.file_number && (
                      <span className="text-xs text-muted-foreground">ملف {pr.file_number}</span>
                    )}
                  </TableCell>
                  <TableCell>{pr.doctor_name ?? "—"}</TableCell>
                  <TableCell>
                    {pr.lines_done} / {pr.lines_count}
                  </TableCell>
                  <TableCell>
                    {formatCount(pr.qty_pending)}
                    {Number(pr.qty_reserved ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground"> ({pr.qty_reserved} محجوز)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        pr.status === "partially_dispensed"
                          ? "warning"
                          : pr.status === "sent_to_pharmacy"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {pr.status === "partially_dispensed"
                        ? "صرف جزئي"
                        : pr.status === "sent_to_pharmacy"
                          ? "في الصيدلية"
                          : "لم يُصرَف"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDispense}
                      title={canDispense ? undefined : "تحتاج صلاحية pharmacy.dispense"}
                      onClick={() => setOpenPrescriptionId(pr.prescription_id)}
                    >
                      صرف
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(prescriptions.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد وصفات بانتظار الصرف.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <DispenseDialog
        prescriptionId={openPrescriptionId}
        onOpenChange={() => setOpenPrescriptionId(null)}
        organizationId={organization?.id}
      />
    </Card>
  );
}

function DispenseDialog({
  prescriptionId,
  onOpenChange,
  organizationId,
}: {
  prescriptionId: string | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const details = usePrescriptionDetails(prescriptionId);
  const history = useDispensingHistory(prescriptionId);
  const { calendarDisplay } = useLocaleSettings();
  const warehouses = useWarehousesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [warehouseId, setWarehouseId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const stock = useAvailableStock(warehouseId, organizationId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pharmacy-queue", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["prescription-details", prescriptionId] });
    queryClient.invalidateQueries({ queryKey: ["dispensing-history", prescriptionId] });
    queryClient.invalidateQueries({ queryKey: ["available-stock", warehouseId, organizationId] });
    queryClient.invalidateQueries({ queryKey: ["drug-catalog", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["prescriptions-list", organizationId] });
  };

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error),
    });

  const reserve = useMutation({
    mutationFn: async () => {
      if (!prescriptionId || !warehouseId) throw new Error("اختر المستودع أوّلًا");
      const { data, error } = await supabase.rpc("app_reserve_prescription", {
        p_prescription_id: prescriptionId,
        p_warehouse_id: warehouseId,
      });
      if (error) throw error;
      return data as { reserved_lines: number; shortages: { drug: string; needed: number }[] };
    },
    onSuccess: (result) => {
      invalidate();
      const shortages = result?.shortages ?? [];
      if (shortages.length > 0) {
        toast({
          variant: "destructive",
          title: "حُجز المتاح، وبقي نقص",
          description: shortages.map((s) => `${s.drug}: ينقص ${s.needed}`).join(" — "),
        });
      } else {
        toast({ title: "تم حجز كامل الوصفة من المخزون" });
      }
    },
    onError: fail("تعذر الحجز"),
  });

  const release = useMutation({
    mutationFn: async () => {
      if (!prescriptionId) throw new Error("لا توجد وصفة");
      const { data, error } = await supabase.rpc("app_release_prescription_reservations", {
        p_prescription_id: prescriptionId,
        p_reason: "فكّ يدوي من شاشة الصرف",
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      invalidate();
      toast({ title: `فُكّ ${count ?? 0} حجزًا وعادت الكميات إلى المتاح` });
    },
    onError: fail("تعذر فكّ الحجز"),
  });

  const dispense = useMutation({
    mutationFn: async () => {
      if (!prescriptionId) throw new Error("لا توجد وصفة");
      if (!warehouseId) throw new Error("اختر المستودع");
      const lines = Object.keys(quantities)
        .map((id) => ({ prescription_item_id: id, qty: Number(quantities[id]) }))
        .filter((line) => line.qty > 0);
      if (lines.length === 0) throw new Error("حدّد كمية لدواء واحد على الأقل");

      const { error } = await supabase.rpc("app_dispense_prescription", {
        p_prescription_id: prescriptionId,
        p_warehouse_id: warehouseId,
        p_lines: lines,
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الصرف" });
      setQuantities({});
      onOpenChange();
    },
    onError: fail("تعذر الصرف"),
  });

  const cancelDispensing = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("لا سجل محدَّد");
      if (!cancelReason.trim()) throw new Error("اكتب سبب الإلغاء");
      const { error } = await supabase.rpc("app_cancel_dispensing", {
        p_record_id: cancelTarget,
        p_reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُلغي الصرف وأُعيدت الكميات إلى المخزون" });
      setCancelTarget(null);
      setCancelReason("");
    },
    onError: fail("تعذر الإلغاء"),
  });

  const canCancel = can("pharmacy.cancel_dispensing");
  const lines = details.data ?? [];
  const pending = lines.filter(
    (line) => Number(line.quantity_prescribed) - Number(line.dispensed_quantity) > 0,
  );

  return (
    <Dialog open={Boolean(prescriptionId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>صرف الوصفة</DialogTitle>
          <DialogDescription>
            اختر المستودع وحدّد الكميات — القاعدة تختار الدفعات بنفسها بترتيب الأقرب انتهاءً
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label>المستودع *</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="اختر المستودع" />
            </SelectTrigger>
            <SelectContent>
              {(warehouses.data ?? []).map((w: { id: string; name: string }) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {warehouseId && (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={release.isPending}
              onClick={() => release.mutate()}
            >
              {release.isPending ? "جارٍ الفكّ..." : "فكّ الحجز"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={reserve.isPending}
              onClick={() => reserve.mutate()}
            >
              {reserve.isPending ? "جارٍ الحجز..." : "حجز الكميات من المخزون"}
            </Button>
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-2">
          {details.isLoading && <Skeleton className="h-24 w-full" />}
          {!details.isLoading && pending.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">صُرفت كل أدوية الوصفة.</p>
          )}
          {pending.map((line) => {
            const remaining = Number(line.quantity_prescribed) - Number(line.dispensed_quantity);
            const info = stock.data?.[line.drug_item_id];
            const available = info?.available ?? 0;
            const short = warehouseId && available < remaining;
            /**
             * `available || remaining` كان يسقط الحدّ كلّه عند انعدام الرصيد:
             * الصفر قيمة كاذبة في جافاسكربت فيصير الحدّ = المتبقّي من الوصفة.
             * فيملأ زرّ «الأقصى» كميةً غير موجودة، ويرفع `app_fefo_lots` استثناءً
             * فتفشل المعاملة كلّها — بما فيها الأسطر التي لها رصيد.
             */
            const maxDispensable = warehouseId ? Math.min(remaining, available) : remaining;
            const noStock = Boolean(warehouseId) && available === 0;
            return (
              <div key={line.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{line.drug?.name_ar ?? "دواء"}</span>
                  <span className="text-xs text-muted-foreground">
                    المتبقّي من الوصفة: {remaining}
                    {warehouseId ? ` — المتاح في المستودع: ${available}` : ""}
                  </span>
                </div>
                {line.dosage_instructions && (
                  <p className="text-xs text-muted-foreground">{line.dosage_instructions}</p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={maxDispensable}
                    disabled={noStock}
                    placeholder={noStock ? "لا رصيد" : "الكمية المصروفة"}
                    value={quantities[line.id] ?? ""}
                    onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={noStock || maxDispensable <= 0}
                    onClick={() =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.id]: String(maxDispensable),
                      }))
                    }
                  >
                    الأقصى
                  </Button>
                </div>
                {short && (
                  <p className="text-xs text-amber-700">
                    المتاح أقلّ من المتبقّي — الصرف الجزئي مسموح، والباقي يبقى على الوصفة.
                  </p>
                )}
                {noStock && (
                  <p className="text-xs text-destructive">
                    لا رصيد صالح لهذا الدواء في هذا المستودع — راجع الدفعات وتواريخ الانتهاء. حقل الكمية
                    معطَّل لهذا السطر حتى لا يفشل الصرف كلّه.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {(history.data ?? []).length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">سجل الصرف</h4>
              {(history.data ?? []).map((rec) => (
                <div key={rec.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      {formatDateTime(rec.dispensed_at, calendarDisplay)}
                      {rec.status === "cancelled" && (
                        <Badge variant="secondary" className="mr-2">
                          ملغى
                        </Badge>
                      )}
                    </span>
                    {rec.status !== "cancelled" && canCancel && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelTarget(rec.id)}>
                        <RotateCcw className="h-4 w-4" />
                        إلغاء وإرجاع
                      </Button>
                    )}
                  </div>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {(rec.dispensing_items ?? []).map((it) => (
                      <li key={it.id}>
                        {it.drug?.name_ar ?? "دواء"} — {it.quantity_dispensed} ×{" "}
                        {formatAmount(it.unit_price)} ر.س
                      </li>
                    ))}
                  </ul>
                  {rec.notes && <p className="mt-1 text-xs text-muted-foreground">{rec.notes}</p>}
                </div>
              ))}
            </div>
          </>
        )}

        {cancelTarget && (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
            <Label>سبب الإلغاء *</Label>
            <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              الإلغاء يسجّل حركة إرجاع في المخزون ولا يمحو شيئًا — الكميات تعود إلى دفعاتها.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(null)}>
                تراجع
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!cancelReason.trim() || cancelDispensing.isPending}
                onClick={() => cancelDispensing.mutate()}
              >
                تأكيد الإلغاء
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!warehouseId || pending.length === 0 || dispense.isPending}
            onClick={() => dispense.mutate()}
          >
            {dispense.isPending ? "جارٍ الصرف..." : "تأكيد الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
