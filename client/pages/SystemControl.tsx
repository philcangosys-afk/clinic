import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ToggleLeft, Building2, Plus, Pencil, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { ALWAYS_ACCESSIBLE_FEATURES, isOrganizationAdmin } from "@/lib/organization-access";
import type { FeatureKey, OrganizationRole } from "@shared/api";
import type { ZatcaCompanyRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * التحكم بالنظام (من لقطة 82 "قائمة التحكم").
 *
 * يغطي بندين كانا معطَّلين رغم جاهزية بنيتهما:
 *
 * 1 — تفعيل/تعطيل الموديولات — جدول `organization_features` كان يُقرأ فقط في
 *    `OrganizationAccessContext` ولا يُكتب إليه من أي مكان، فلم يكن ممكنًا
 *    إخفاء موديول عن منشأة إطلاقًا.
 *
 * 2 — شركات زاتكا — جدول `zatca_companies` كان يُقرأ في شاشتَي المستودعات
 *    والعيادات عبر قوائم منسدلة، لكن لا توجد شاشة لإنشاء شركة، فكانت
 *    القائمتان تبقيان فارغتين دائمًا ويبقى الربط بلا أثر.
 */

type FeatureCatalogRow = {
  feature_key: string;
  name_ar: string;
  name_en: string;
  category_key: string;
  description_ar: string | null;
  is_core: boolean;
  display_order: number;
};

// ═══════════════════════ الموديولات ═══════════════════════

function useFeatureCatalog() {
  return useQuery({
    queryKey: ["feature-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_catalog")
        .select("*")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as FeatureCatalogRow[];
    },
  });
}

function useOrganizationFeatures(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization-features-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // بلا فلترة enabled هنا — نحتاج الصفوف المعطَّلة أيضًا لعرض حالتها
      const { data, error } = await supabase
        .from("organization_features")
        .select("feature_key, enabled")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as { feature_key: string; enabled: boolean }[];
    },
  });
}

function FeaturesTab({ readOnly }: { readOnly: boolean }) {
  const { organization, refresh } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const catalog = useFeatureCatalog();
  const features = useOrganizationFeatures(organization?.id);

  const enabledMap = new Map((features.data ?? []).map((row) => [row.feature_key, row.enabled]));

  /**
   * الموديول الذي لا صف له في organization_features يُعتبر معطَّلًا، لأن
   * السياق يقرأ الصفوف المفعَّلة فقط (`.eq("enabled", true)`) — فغياب الصف
   * يعني غياب الموديول عن القائمة الجانبية.
   */
  const isEnabled = (key: string) => enabledMap.get(key) === true;

  /** الموديولات الأساسية لا تُعطَّل — تعطيلها يقفل النظام على مستخدمه. */
  const isLocked = (row: FeatureCatalogRow) =>
    row.is_core || ALWAYS_ACCESSIBLE_FEATURES.includes(row.feature_key as FeatureKey);

  const toggleFeature = useMutation({
    mutationFn: async ({ featureKey, next }: { featureKey: string; next: boolean }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      // upsert لا delete: لا توجد سياسة DELETE على organization_features في
      // 0001، والتعطيل يُمثَّل بـ enabled=false لا بحذف الصف.
      const { error } = await supabase
        .from("organization_features")
        .upsert(
          { organization_id: organization.id, feature_key: featureKey, enabled: next },
          { onConflict: "organization_id,feature_key" },
        );
      if (error) throw error;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["organization-features-admin"] });
      // السياق يحمّل الصلاحيات خارج react-query، فلا يكفي إبطال الاستعلام —
      // نطلب إعادة التحميل صراحةً لتتحدث القائمة الجانبية فورًا.
      await refresh();
      toast({ title: "تم تحديث حالة الموديول" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const grouped = (catalog.data ?? []).reduce<Record<string, FeatureCatalogRow[]>>((acc, row) => {
    acc[row.category_key] = [...(acc[row.category_key] ?? []), row];
    return acc;
  }, {});

  const enabledCount = (catalog.data ?? []).filter((row) => isEnabled(row.feature_key)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          تعطيل موديول يخفيه من القائمة الجانبية لكل مستخدمي المنشأة، ولا يحذف أي بيانات — إعادة تفعيله
          تُظهره ببياناته كما كانت.
        </span>
      </div>

      {catalog.isLoading || features.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {enabledCount} موديول مفعَّل من {(catalog.data ?? []).length}
          </p>

          {Object.entries(grouped).map(([category, rows]) => (
            <Card key={category}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{category}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {rows.map((row) => {
                  const locked = isLocked(row);
                  const enabled = locked || isEnabled(row.feature_key);
                  return (
                    <div
                      key={row.feature_key}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.name_ar}</p>
                        {row.description_ar && (
                          <p className="truncate text-xs text-muted-foreground">{row.description_ar}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {locked ? (
                          <Badge variant="secondary">أساسي — لا يُعطَّل</Badge>
                        ) : (
                          <>
                            <Badge variant={enabled ? "success" : "secondary"}>
                              {enabled ? "مفعَّل" : "معطَّل"}
                            </Badge>
                            {!readOnly && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={toggleFeature.isPending}
                                onClick={() =>
                                  toggleFeature.mutate({ featureKey: row.feature_key, next: !enabled })
                                }
                              >
                                {enabled ? "تعطيل" : "تفعيل"}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════ شركات زاتكا ═══════════════════════

const ENVIRONMENT_LABELS: Record<string, string> = {
  sandbox: "تجريبية (Sandbox)",
  simulation: "محاكاة (Simulation)",
  production: "إنتاج (Production)",
};

function useZatcaCompanies(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["zatca-companies-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zatca_companies")
        .select("id, organization_id, name, vat_number, environment, created_at")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ZatcaCompanyRow[];
    },
  });
}

function ZatcaFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: ZatcaCompanyRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [vatNumber, setVatNumber] = useState(initial?.vat_number ?? "");
  const [environment, setEnvironment] = useState(initial?.environment ?? "sandbox");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!name.trim()) throw new Error("اسم الشركة مطلوب");
      const vat = vatNumber.trim();
      if (!vat) throw new Error("الرقم الضريبي مطلوب");
      // الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بـ 3 — تحقّق شكلي يمنع
      // الأخطاء الشائعة قبل أن تصل للفواتير الإلكترونية.
      if (!/^\d{15}$/.test(vat)) throw new Error("الرقم الضريبي يجب أن يتكوّن من 15 رقمًا");
      if (!vat.startsWith("3") || !vat.endsWith("3"))
        throw new Error("الرقم الضريبي السعودي يبدأ وينتهي بالرقم 3");

      const payload = {
        organization_id: organizationId,
        name: name.trim(),
        vat_number: vat,
        environment,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("zatca_companies").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("zatca_companies").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zatca-companies-admin"] });
      // الشاشات التي تقرأ الشركات في قوائمها المنسدلة
      queryClient.invalidateQueries({ queryKey: ["zatca-companies"] });
      queryClient.invalidateQueries({ queryKey: ["zatca-for-clinics"] });
      toast({ title: initial ? "تم تحديث الشركة" : "تمت إضافة الشركة" });
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل شركة زاتكا" : "شركة زاتكا جديدة"}</DialogTitle>
          <DialogDescription>
            الكيان الضريبي الذي تُصدَر تحته الفواتير الإلكترونية — تُربط به المستودعات والعيادات
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الشركة *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرقم الضريبي *</Label>
            <Input
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              dir="ltr"
              placeholder="3XXXXXXXXXXXXX3"
              maxLength={15}
            />
            <p className="text-xs text-muted-foreground">15 رقمًا، يبدأ وينتهي بالرقم 3</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البيئة</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as typeof environment)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ENVIRONMENT_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ZatcaTab({ readOnly }: { readOnly: boolean }) {
  const { organization } = useOrganizationAccess();
  const companies = useZatcaCompanies(organization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ZatcaCompanyRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          تُربط هذه الشركات بالمستودعات والعيادات لتحديد الكيان الضريبي لكل فاتورة
        </p>
        {!readOnly && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            شركة جديدة
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            شركات زاتكا
          </CardTitle>
          <CardDescription>
            بيئة "الإنتاج" تُصدر فواتير رسمية — استخدم "التجريبية" أثناء الاختبار
          </CardDescription>
        </CardHeader>
        <CardContent>
          {companies.isLoading && <Skeleton className="h-32 w-full" />}
          {!companies.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الرقم الضريبي</TableHead>
                  <TableHead>البيئة</TableHead>
                  {!readOnly && <TableHead className="w-20">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(companies.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {row.vat_number}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.environment === "production" ? "success" : "secondary"}>
                        {ENVIRONMENT_LABELS[row.environment] ?? row.environment}
                      </Badge>
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(row);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {(companies.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={readOnly ? 3 : 4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      لا توجد شركات زاتكا — أضف واحدة لتظهر في قوائم المستودعات والعيادات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <ZatcaFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
    </div>
  );
}

export default function SystemControl() {
  const { membership } = useOrganizationAccess();
  const isAdmin = isOrganizationAdmin(membership?.role_key as OrganizationRole | undefined);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">التحكم بالنظام</h1>
        <p className="text-sm text-muted-foreground">
          تفعيل الموديولات لهذه المنشأة، وإدارة الكيانات الضريبية للفوترة الإلكترونية
        </p>
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          صلاحيتك الحالية تسمح بالعرض فقط — التعديل مقيّد بصفة المالك أو مدير النظام (مطبَّق في قاعدة
          البيانات عبر RLS وليس في الواجهة فقط).
        </div>
      )}

      <Tabs defaultValue="features" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="features">
            <ToggleLeft className="me-1 h-4 w-4" />
            الموديولات
          </TabsTrigger>
          <TabsTrigger value="zatca">شركات زاتكا</TabsTrigger>
        </TabsList>
        <TabsContent value="features">
          <FeaturesTab readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="zatca">
          <ZatcaTab readOnly={!isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
