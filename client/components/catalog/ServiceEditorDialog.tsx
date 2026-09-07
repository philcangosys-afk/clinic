import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import LookupSelect from "@/components/shared/LookupSelect";
import ServicePriceLists from "./ServicePriceLists";
import { errorMessage } from "@/lib/error-message";

export const ITEM_TYPE_LABELS: Record<string, string> = {
  service: "خدمة طبية",
  product: "منتج",
  drug: "دواء",
  lab_service: "خدمة مخبرية",
};

/** أنواع الخدمة الطبية — نفس قائمة `items_medical_service_type_check` في 0071. */
export const MEDICAL_SERVICE_TYPES: Record<string, string> = {
  consultation: "كشف / استشارة",
  follow_up: "مراجعة",
  procedure: "إجراء",
  surgery: "عملية جراحية",
  laboratory: "مختبر",
  radiology: "أشعة",
  dental: "أسنان",
  physiotherapy: "علاج طبيعي",
  vaccination: "تطعيم",
  nursing: "تمريض",
  dressing: "تضميد",
  injection: "حقن",
  screening: "فحص دوري",
  home_visit: "زيارة منزلية",
  other: "أخرى",
};

const PROVIDER_ROLES: Record<string, string> = {
  any: "أي مقدّم",
  doctor: "طبيب",
  nurse: "ممرّض",
  technician: "فني",
  pharmacist: "صيدلي",
};

const GENDER_RESTRICTIONS: Record<string, string> = {
  any: "بلا قيد",
  male: "للذكور فقط",
  female: "للإناث فقط",
};

const CODE_SYSTEMS: Record<string, string> = {
  cpt: "CPT",
  hcpcs: "HCPCS",
  icd10: "ICD-10",
  icd10am: "ICD-10-AM",
  snomed: "SNOMED",
  loinc: "LOINC",
  local: "كود داخلي",
  other: "أخرى",
};

type Draft = Record<string, any>;

const EMPTY_DRAFT: Draft = {
  code: "",
  barcode: "",
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  item_type: "service",
  medical_service_type: "consultation",
  category_value_id: "",
  default_clinic_id: "",
  duration_minutes: "",
  provider_role: "any",
  requires_appointment: false,
  price: "0",
  cost_price: "0",
  default_discount_percent: "0",
  is_vat_exempt: false,
  is_disabled: false,
  requires_fasting: false,
  fasting_hours: "",
  preparation_ar: "",
  contraindications_ar: "",
  min_age_years: "",
  max_age_years: "",
  gender_restriction: "any",
  requires_consent: false,
  requires_preauthorization: false,
  requires_referral: false,
  preauthorization_note: "",
  preparation_en: "",
  consent_note_ar: "",
  revenue_account_id: "",
  cogs_account_id: "",
};

/** حقول رقمية اختيارية: الفراغ يعني `null` لا صفرًا — والفرق ليس تجميليًا. */
const nullableNumber = (raw: string) => {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function ServiceEditorDialog({
  open,
  onOpenChange,
  itemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` يعني خدمة جديدة. */
  itemId: string | null;
}) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [tab, setTab] = useState("basic");

  const organizationId = organization?.id;
  const isNew = !itemId;
  const canManage = can("catalog.manage");

  const set = (key: string, value: any) => setDraft((prev) => ({ ...prev, [key]: value }));

  const existing = useQuery({
    queryKey: ["service-editor", itemId],
    enabled: open && Boolean(itemId),
    queryFn: async () => {
      const [item, branches, resources] = await Promise.all([
        supabase.from("items").select("*").eq("id", itemId).single(),
        supabase.from("item_branches").select("branch_id").eq("item_id", itemId),
        supabase.from("item_resources").select("resource_id, is_required").eq("item_id", itemId),
      ]);
      if (item.error) throw item.error;
      if (branches.error) throw branches.error;
      if (resources.error) throw resources.error;
      return {
        item: item.data as any,
        branchIds: (branches.data ?? []).map((r: any) => r.branch_id),
        resourceIds: (resources.data ?? []).map((r: any) => r.resource_id),
      };
    },
  });

  // إعادة ضبط المسوّدة عند كل فتح، وإلا حملت الخدمةُ الجديدة بقايا التي قبلها.
  useEffect(() => {
    if (!open) return;
    setTab("basic");
    if (isNew) {
      setDraft(EMPTY_DRAFT);
      setBranchIds([]);
      setResourceIds([]);
      /**
       * كود قصير مقترَح للخدمة الجديدة (رقمان أو ثلاثة).
       *
       * الكود كان حقلًا إلزاميًا يُكتب يدويًا بلا نمط، فتنشأ أكواد طويلة لا
       * يحفظها الاستقبال — وهو الذي يبحث بالكود عند الفوترة. الدالّة تُعطي
       * أصغر رقم حرّ في المنشأة (تتحقّق من المنتجات كذلك لأن التفرّد على
       * المنشأة لا على النوع)، والاقتراح قابل للتعديل.
       */
      if (organizationId) {
        void (async () => {
          const { data, error } = await supabase.rpc("app_next_short_item_code", {
            p_organization_id: organizationId,
          });
          // تعذّر التوليد لا يمنع إنشاء الخدمة — يُكتب الكود يدويًا
          if (!error && data) setDraft((prev) => ({ ...prev, code: String(data) }));
        })();
      }
      return;
    }
    if (existing.data) {
      const row = existing.data.item;
      const next: Draft = { ...EMPTY_DRAFT };
      for (const key of Object.keys(EMPTY_DRAFT)) {
        const value = row[key];
        if (value === null || value === undefined) {
          next[key] = typeof EMPTY_DRAFT[key] === "boolean" ? false : "";
        } else {
          next[key] = typeof value === "boolean" ? value : String(value);
        }
      }
      setDraft(next);
      setBranchIds(existing.data.branchIds);
      setResourceIds(existing.data.resourceIds);
    }
  }, [open, isNew, existing.data, organizationId]);

  const branches = useQuery({
    queryKey: ["catalog-branches", organizationId],
    enabled: open && Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const clinics = useQuery({
    queryKey: ["catalog-clinics", organizationId],
    enabled: open && Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const resources = useQuery({
    queryKey: ["catalog-resources", organizationId],
    enabled: open && Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("id, name_ar, resource_type, branch_id, is_active")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * الحسابات المحاسبية.
   *
   * `revenue_account_id` و`cogs_account_id` أُضيفا في 0071 ولم يكن لهما حقل
   * في أي شاشة — فبقيا فارغين، وترحيلُ الفاتورة إلى الأستاذ العام يقع كله
   * على حساب الإيراد الافتراضي مهما اختلفت الخدمات.
   */
  const accounts = useQuery({
    queryKey: ["catalog-accounts", organizationId],
    enabled: open && Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name_ar, account_type")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; name_ar: string; account_type: string }[];
    },
  });

  const claimCodes = useQuery({
    queryKey: ["item-claim-codes", itemId],
    enabled: open && Boolean(itemId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_claim_codes")
        .select("id, code, code_system, description, is_primary, insurance_company_id, company:insurance_companies!item_claim_codes_insurance_company_id_fkey(name_ar)")
        .eq("item_id", itemId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const save = useMutation({
    /**
     * الحفظ عبر `app_save_service` (0077) لا بخمسة طلبات.
     *
     * قبله كان الحفظ: تعديل الصنف، ثم حذف فروعه، ثم إدراجها، ثم حذف موارده،
     * ثم إدراجها. فشلُ أيّ خطوة بعد الأولى يترك الخدمة بفروع محذوفة وموارد
     * قديمة — حالة لا يصل إليها المستخدم بأي طريق مشروع. الدالة تجعلها
     * معاملة واحدة، وتفحص الصلاحية وانتماء الفروع والموارد للمنشأة.
     */
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const name = String(draft.name_ar ?? "").trim();
      if (!name) throw new Error("الاسم العربي مطلوب");

      const minAge = nullableNumber(draft.min_age_years);
      const maxAge = nullableNumber(draft.max_age_years);
      if (minAge !== null && maxAge !== null && minAge > maxAge) {
        throw new Error("الحدّ الأدنى للعمر أكبر من الحدّ الأقصى");
      }

      // القيم تُمرَّر نصًّا والدالة تحوّلها: الفراغ يعني `null` لا صفرًا،
      // وهو تمييز يضيع لو أرسلنا أرقامًا مباشرةً.
      const text = (value: any) => {
        const raw = String(value ?? "").trim();
        return raw === "" ? null : raw;
      };

      const payload: Record<string, any> = {
        code: text(draft.code),
        barcode: text(draft.barcode),
        name_ar: name,
        name_en: text(draft.name_en),
        description_ar: text(draft.description_ar),
        description_en: text(draft.description_en),
        item_type: draft.item_type,
        medical_service_type: draft.item_type === "service" ? draft.medical_service_type : null,
        category_value_id: text(draft.category_value_id),
        default_clinic_id: text(draft.default_clinic_id),
        duration_minutes: text(draft.duration_minutes),
        provider_role: draft.provider_role || "any",
        requires_appointment: Boolean(draft.requires_appointment),
        price: text(draft.price) ?? "0",
        cost_price: text(draft.cost_price) ?? "0",
        default_discount_percent: text(draft.default_discount_percent) ?? "0",
        is_vat_exempt: Boolean(draft.is_vat_exempt),
        is_disabled: Boolean(draft.is_disabled),
        revenue_account_id: text(draft.revenue_account_id),
        cogs_account_id: text(draft.cogs_account_id),
        requires_fasting: Boolean(draft.requires_fasting),
        fasting_hours: draft.requires_fasting ? text(draft.fasting_hours) : null,
        preparation_ar: text(draft.preparation_ar),
        preparation_en: text(draft.preparation_en),
        contraindications_ar: text(draft.contraindications_ar),
        min_age_years: minAge === null ? null : String(minAge),
        max_age_years: maxAge === null ? null : String(maxAge),
        gender_restriction: draft.gender_restriction || "any",
        requires_consent: Boolean(draft.requires_consent),
        consent_note_ar: text(draft.consent_note_ar),
        requires_preauthorization: Boolean(draft.requires_preauthorization),
        requires_referral: Boolean(draft.requires_referral),
        preauthorization_note: text(draft.preauthorization_note),
      };

      const { data, error } = await supabase.rpc("app_save_service", {
        p_organization_id: organizationId,
        p_item_id: itemId,
        p_payload: payload,
        p_branch_ids: branchIds,
        p_resource_ids: resourceIds,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["service-editor", itemId] });
      toast({ title: isNew ? "تم إنشاء الخدمة" : "تم حفظ التعديلات" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description:
          errorMessage(error, "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)"),
      }),
  });

  const isService = draft.item_type === "service";

  const branchSummary = useMemo(() => {
    if (branchIds.length === 0) return "كل الفروع";
    return `${branchIds.length} فرع`;
  }, [branchIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "خدمة أو صنف جديد" : draft.name_ar || "تعديل الخدمة"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "يظهر هذا الصنف فورًا عند البحث في شاشة الفوترة"
              : "التعديل يسري على الطلبات الجديدة؛ الفواتير الصادرة لا تتغيّر"}
          </DialogDescription>
        </DialogHeader>

        {!canManage && (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            صلاحيتك تسمح بالاطّلاع فقط. الحقول معطَّلة.
          </p>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="basic">البيانات</TabsTrigger>
            <TabsTrigger value="medical">الخدمة الطبية</TabsTrigger>
            <TabsTrigger value="clinical">المتطلبات السريرية</TabsTrigger>
            <TabsTrigger value="scope">الفروع والموارد</TabsTrigger>
            <TabsTrigger value="codes" disabled={isNew}>
              أكواد المطالبات
            </TabsTrigger>
            <TabsTrigger value="pricing" disabled={isNew}>
              الأسعار
            </TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="basic" className="flex flex-col gap-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الاسم بالعربية *">
                <Input
                  value={draft.name_ar}
                  disabled={!canManage}
                  onChange={(e) => set("name_ar", e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="الاسم بالإنجليزية">
                <Input
                  value={draft.name_en}
                  dir="ltr"
                  disabled={!canManage}
                  onChange={(e) => set("name_en", e.target.value)}
                />
              </Field>
              <Field label="الكود (رقمان أو ثلاثة ليسهل حفظه)">
                <div className="flex gap-2">
                  <Input
                    value={draft.code}
                    dir="ltr"
                    disabled={!canManage}
                    onChange={(e) => set("code", e.target.value)}
                  />
                  {canManage && organizationId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title="أصغر كود قصير حرّ في المنشأة"
                      onClick={async () => {
                        const { data, error } = await supabase.rpc("app_next_short_item_code", {
                          p_organization_id: organizationId,
                        });
                        if (error) {
                          toast({
                            variant: "destructive",
                            title: "تعذر توليد كود قصير",
                            description: error.message,
                          });
                          return;
                        }
                        if (data) set("code", String(data));
                      }}
                    >
                      كود قصير
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="الباركود">
                <Input
                  value={draft.barcode}
                  dir="ltr"
                  disabled={!canManage}
                  onChange={(e) => set("barcode", e.target.value)}
                />
              </Field>
              <Field label="النوع">
                <Select
                  value={draft.item_type}
                  disabled={!canManage}
                  onValueChange={(value) => set("item_type", value)}
                >
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
              </Field>
              <Field label="الفئة">
                <LookupSelect
                  categoryKey="item_categories"
                  value={draft.category_value_id}
                  onChange={(value) => set("category_value_id", value)}
                  placeholder="بدون فئة"
                  allowClear
                  clearLabel="بدون فئة"
                />
              </Field>
            </div>

            <Field label="الوصف بالعربية">
              <Textarea
                rows={2}
                value={draft.description_ar}
                disabled={!canManage}
                onChange={(e) => set("description_ar", e.target.value)}
                placeholder="ما يراه المريض في العرض أو الإيصال"
              />
            </Field>
            <Field label="الوصف بالإنجليزية">
              <Textarea
                rows={2}
                dir="ltr"
                value={draft.description_en}
                disabled={!canManage}
                onChange={(e) => set("description_en", e.target.value)}
              />
            </Field>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="السعر الأساسي">
                <Input
                  type="number"
                  min={0}
                  value={draft.price}
                  disabled={!canManage}
                  onChange={(e) => set("price", e.target.value)}
                />
              </Field>
              <Field label="سعر التكلفة">
                <Input
                  type="number"
                  min={0}
                  value={draft.cost_price}
                  disabled={!canManage}
                  onChange={(e) => set("cost_price", e.target.value)}
                />
              </Field>
              <Field label="خصم افتراضي %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.default_discount_percent}
                  disabled={!canManage}
                  onChange={(e) => set("default_discount_percent", e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              هذا السعر قاعدةٌ أخيرة: إن وُجدت قائمة أسعار مطابقة للفرع أو التأمين فهي المقدَّمة عليه.
            </p>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="حساب الإيراد">
                <Select
                  value={draft.revenue_account_id || "none"}
                  disabled={!canManage}
                  onValueChange={(value) => set("revenue_account_id", value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">الحساب الافتراضي</SelectItem>
                    {(accounts.data ?? [])
                      .filter((account) => account.account_type === "revenue")
                      .map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.code} — {account.name_ar}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="حساب التكلفة">
                <Select
                  value={draft.cogs_account_id || "none"}
                  disabled={!canManage}
                  onValueChange={(value) => set("cogs_account_id", value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">الحساب الافتراضي</SelectItem>
                    {(accounts.data ?? [])
                      .filter((account) => account.account_type === "expense")
                      .map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.code} — {account.name_ar}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              تخصيص الحساب يفصل إيراد هذه الخدمة في الأستاذ العام بدل ضمّه إلى إيرادٍ واحد عام.
            </p>

            <div className="flex flex-wrap gap-6 pt-1">
              <Toggle
                label="معفى من ضريبة القيمة المضافة"
                checked={Boolean(draft.is_vat_exempt)}
                disabled={!canManage}
                onChange={(value) => set("is_vat_exempt", value)}
              />
              <Toggle
                label="معطَّل (لا يظهر في الفوترة)"
                checked={Boolean(draft.is_disabled)}
                disabled={!canManage}
                onChange={(value) => set("is_disabled", value)}
              />
            </div>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="medical" className="flex flex-col gap-3 pt-3">
            {!isService && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                هذه الحقول للخدمات الطبية. النوع الحالي «{ITEM_TYPE_LABELS[draft.item_type]}».
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="نوع الخدمة الطبية">
                <Select
                  value={draft.medical_service_type || "consultation"}
                  disabled={!canManage || !isService}
                  onValueChange={(value) => set("medical_service_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEDICAL_SERVICE_TYPES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="القسم / العيادة">
                <Select
                  value={draft.default_clinic_id || "none"}
                  disabled={!canManage}
                  onValueChange={(value) => set("default_clinic_id", value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون تخصيص</SelectItem>
                    {(clinics.data ?? []).map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="المدة بالدقائق">
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.duration_minutes}
                  disabled={!canManage}
                  placeholder="تُستخدم في حجز الموعد"
                  onChange={(e) => set("duration_minutes", e.target.value)}
                />
              </Field>
              <Field label="مقدّم الخدمة">
                <Select
                  value={draft.provider_role || "any"}
                  disabled={!canManage}
                  onValueChange={(value) => set("provider_role", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROVIDER_ROLES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Toggle
              label="تتطلّب حجز موعد مسبق"
              checked={Boolean(draft.requires_appointment)}
              disabled={!canManage}
              onChange={(value) => set("requires_appointment", value)}
            />
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="clinical" className="flex flex-col gap-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="أقلّ عمر (سنة)">
                <Input
                  type="number"
                  min={0}
                  value={draft.min_age_years}
                  disabled={!canManage}
                  onChange={(e) => set("min_age_years", e.target.value)}
                />
              </Field>
              <Field label="أكبر عمر (سنة)">
                <Input
                  type="number"
                  min={0}
                  value={draft.max_age_years}
                  disabled={!canManage}
                  onChange={(e) => set("max_age_years", e.target.value)}
                />
              </Field>
              <Field label="قيد الجنس">
                <Select
                  value={draft.gender_restriction || "any"}
                  disabled={!canManage}
                  onValueChange={(value) => set("gender_restriction", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GENDER_RESTRICTIONS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              العمر والجنس <strong>يمنعان</strong> إضافة الخدمة للمريض. أمّا الصيام والتحضير والموافقة
              فتُعرض تنبيهًا ويمضي الموظف.
            </p>

            <Separator />

            <div className="flex flex-wrap items-end gap-4">
              <Toggle
                label="تتطلّب صيامًا"
                checked={Boolean(draft.requires_fasting)}
                disabled={!canManage}
                onChange={(value) => set("requires_fasting", value)}
              />
              {Boolean(draft.requires_fasting) && (
                <div className="w-32">
                  <Field label="عدد الساعات">
                    <Input
                      type="number"
                      min={1}
                      max={72}
                      value={draft.fasting_hours}
                      disabled={!canManage}
                      onChange={(e) => set("fasting_hours", e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>

            <Field label="تعليمات التحضير">
              <Textarea
                rows={2}
                value={draft.preparation_ar}
                disabled={!canManage}
                placeholder="مثال: إيقاف مميّعات الدم قبل ٤٨ ساعة"
                onChange={(e) => set("preparation_ar", e.target.value)}
              />
            </Field>
            <Field label="تعليمات التحضير بالإنجليزية">
              <Textarea
                rows={2}
                dir="ltr"
                value={draft.preparation_en}
                disabled={!canManage}
                onChange={(e) => set("preparation_en", e.target.value)}
              />
            </Field>
                        <Field label="موانع الاستعمال">
              <Textarea
                rows={2}
                value={draft.contraindications_ar}
                disabled={!canManage}
                onChange={(e) => set("contraindications_ar", e.target.value)}
              />
            </Field>

            <Separator />

            <div className="flex flex-col gap-3">
              <Toggle
                label="تتطلّب موافقة موقَّعة من المريض"
                checked={Boolean(draft.requires_consent)}
                disabled={!canManage}
                onChange={(value) => set("requires_consent", value)}
              />
              <Toggle
                label="تتطلّب إحالة من طبيب"
                checked={Boolean(draft.requires_referral)}
                disabled={!canManage}
                onChange={(value) => set("requires_referral", value)}
              />
              <Toggle
                label="تتطلّب موافقة تأمين مسبقة"
                checked={Boolean(draft.requires_preauthorization)}
                disabled={!canManage}
                onChange={(value) => set("requires_preauthorization", value)}
              />
              {Boolean(draft.requires_consent) && (
                <Field label="نصّ الإقرار المطلوب">
                  <Textarea
                    rows={2}
                    value={draft.consent_note_ar}
                    disabled={!canManage}
                    placeholder="ما الذي يقرّ به المريض قبل هذه الخدمة"
                    onChange={(e) => set("consent_note_ar", e.target.value)}
                  />
                </Field>
              )}
                            {Boolean(draft.requires_preauthorization) && (
                <Field label="ملاحظة الموافقة المسبقة">
                  <Textarea
                    rows={2}
                    value={draft.preauthorization_note}
                    disabled={!canManage}
                    placeholder="ما الذي تطلبه شركات التأمين عادةً لهذه الخدمة"
                    onChange={(e) => set("preauthorization_note", e.target.value)}
                  />
                </Field>
              )}
            </div>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="scope" className="flex flex-col gap-4 pt-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Label>الفروع المتاحة</Label>
                <Badge variant="secondary">{branchSummary}</Badge>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                لا تختر شيئًا لتكون الخدمة متاحة في كل الفروع — بما فيها فروعٌ تُفتح لاحقًا.
              </p>
              <div className="flex flex-col gap-2">
                {(branches.data ?? []).map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={branchIds.includes(branch.id)}
                      onChange={(e) =>
                        setBranchIds((prev) =>
                          e.target.checked ? [...prev, branch.id] : prev.filter((id) => id !== branch.id),
                        )
                      }
                    />
                    {branch.name}
                  </label>
                ))}
                {(branches.data ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">لا توجد فروع مسجّلة.</p>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <Label>الموارد المطلوبة</Label>
              <p className="mb-2 mt-1 text-xs text-muted-foreground">
                مورد مطلوب غير متاح في فرع <strong>يمنع</strong> تقديم الخدمة فيه.
              </p>
              <div className="flex flex-col gap-2">
                {(resources.data ?? []).map((resource) => (
                  <label key={resource.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={resourceIds.includes(resource.id)}
                      onChange={(e) =>
                        setResourceIds((prev) =>
                          e.target.checked ? [...prev, resource.id] : prev.filter((id) => id !== resource.id),
                        )
                      }
                    />
                    {resource.name_ar}
                    {!resource.is_active && <Badge variant="secondary">معطَّل</Badge>}
                  </label>
                ))}
                {(resources.data ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    لا توجد موارد مسجّلة بعد — تُضاف من شاشة الموارد.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="codes" className="pt-3">
            <ClaimCodesEditor
              itemId={itemId}
              organizationId={organizationId}
              rows={claimCodes.data ?? []}
              canManage={canManage}
              onChanged={() => claimCodes.refetch()}
            />
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="pricing" className="pt-3">
            {itemId && <ServicePriceLists itemId={itemId} basePrice={Number(draft.price) || 0} />}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button
            disabled={!canManage || !String(draft.name_ar ?? "").trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ..." : isNew ? "إنشاء" : "حفظ التعديلات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

/**
 * أكواد المطالبات.
 *
 * كود عام للخدمة، وكود خاص بكل شركة تأمين يتقدّم عليه. الترتيب هذا هو الذي
 * تطبّقه `app_item_claim_code` في القاعدة، والشاشة تعرضه لا تقرّره.
 */
function ClaimCodesEditor({
  itemId,
  organizationId,
  rows,
  canManage,
  onChanged,
}: {
  itemId: string | null;
  organizationId: string | undefined;
  rows: any[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [system, setSystem] = useState("cpt");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("");

  const companies = useQuery({
    queryKey: ["catalog-insurance-companies", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!itemId || !organizationId) throw new Error("احفظ الخدمة أولًا");
      if (!code.trim()) throw new Error("الكود مطلوب");
      const { error } = await supabase.from("item_claim_codes").insert({
        organization_id: organizationId,
        item_id: itemId,
        insurance_company_id: companyId || null,
        code_system: system,
        code: code.trim(),
        description: description.trim() || null,
        is_primary: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCode("");
      setDescription("");
      onChanged();
      toast({ title: "أُضيف الكود" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description:
          errorMessage(error).includes("uq_item_claim_codes")
            ? "يوجد كود رئيسي لهذه الخدمة بنفس النطاق"
            : errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("item_claim_codes").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      onChanged();
      toast({ title: "حُذف الكود" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        يُملأ كود المطالبة تلقائيًا في نماذج التأمين. كود الشركة يتقدّم على الكود العام.
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const company = Array.isArray(row.company) ? row.company[0] : row.company;
          return (
            <div key={row.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <Badge variant="outline">{CODE_SYSTEMS[row.code_system] ?? row.code_system}</Badge>
              <span className="font-mono">{row.code}</span>
              <span className="text-muted-foreground">{row.description ?? ""}</span>
              <Badge variant={company ? "default" : "secondary"} className="ms-auto">
                {company?.name_ar ?? "عام"}
              </Badge>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                  حذف
                </Button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">لا توجد أكواد مسجّلة.</p>}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="w-36">
            <Field label="النظام">
              <Select value={system} onValueChange={setSystem}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CODE_SYSTEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="الكود">
              <Input value={code} dir="ltr" onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>
          <div className="min-w-40 flex-1">
            <Field label="الوصف">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="w-44">
            <Field label="شركة التأمين">
              <Select value={companyId || "none"} onValueChange={(v) => setCompanyId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">كود عام</SelectItem>
                  {(companies.data ?? []).map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Button disabled={!code.trim() || add.isPending} onClick={() => add.mutate()}>
            إضافة
          </Button>
        </div>
      )}
    </div>
  );
}
