import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Save, Plus, Trash2, Pencil, Star, AlertTriangle } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { BranchRow, OrganizationRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * بيانات المنشأة والفروع.
 *
 * لماذا هذه الشاشة: التدقيق الشامل للقطات الـ133 أثبت أنه **لا يوجد أي
 * `update` على جدول `organizations` في المشروع كله** — الصف يُنشأ مرة واحدة في
 * `Onboarding` باسم ونوع فقط، ثم لا سبيل لتعديله أبدًا. النتيجة العملية أن
 * `tax_number` يبقى `NULL` للأبد، فتُطبع **كل فاتورة ZATCA بلا رقم ضريبي**،
 * و`default_vat_rate` (الذي تقرأه `Billing.tsx`) يبقى على قيمته الافتراضية
 * مهما اختلف واقع المنشأة.
 *
 * سياسة `org_update_admins` موجودة منذ 0001 وتسمح بالتعديل لمدراء المنشأة —
 * أي أن القاعدة كانت جاهزة والواجهة وحدها هي الناقصة، فلا حاجة لهجرة جديدة.
 *
 * والفروع ضُمّت هنا لأن `branches` كان في الحالة نفسها: يُقرأ في
 * `OrganizationAccessContext` ويُبنى عليه ربط العضوية والتصفية، بلا أي واجهة
 * لإنشاء فرع أو تسميته — فالمنشأة متعددة الفروع تعمل بفرع واحد يتيم أنشأه
 * مُحفِّز الإنشاء.
 */

const CURRENCIES = [
  { value: "SAR", label: "ريال سعودي (SAR)" },
  { value: "AED", label: "درهم إماراتي (AED)" },
  { value: "QAR", label: "ريال قطري (QAR)" },
  { value: "KWD", label: "دينار كويتي (KWD)" },
  { value: "BHD", label: "دينار بحريني (BHD)" },
  { value: "OMR", label: "ريال عماني (OMR)" },
] as const;

// ---------------------------------------------------------------------------
// بيانات المنشأة
// ---------------------------------------------------------------------------
function OrganizationTab({ readOnly }: { readOnly: boolean }) {
  const { organization, refresh } = useOrganizationAccess();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    tax_number: "",
    currency: "SAR" as OrganizationRow["currency"],
    default_vat_rate: "15",
  });

  useEffect(() => {
    if (!organization) return;
    setForm({
      name: organization.name ?? "",
      tax_number: organization.tax_number ?? "",
      // `HealthcareOrganization.currency` معرَّف `string` في shared/api.ts لا
      // كاتحاد القيم — الإسناد المباشر خطأ ترجمة (TS2322). التحويل هنا آمن
      // لأن القاعدة تفرض القيم الست بقيد check على العمود.
      currency: organization.currency as OrganizationRow["currency"],
      default_vat_rate: String(organization.default_vat_rate ?? 15),
    });
  }, [organization]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بـ 3. التحقق هنا تحذيري لا
   * مانع (منشآت الخليج الأخرى لها صيغ مختلفة)، لكنه يمنع الخطأ الشائع: إدخال
   * رقم السجل التجاري (10 أرقام) مكان الرقم الضريبي — وهو خطأ لا يُكتشف إلا
   * عند رفض هيئة الزكاة للفاتورة.
   */
  const taxLooksWrong =
    form.currency === "SAR" &&
    form.tax_number.trim().length > 0 &&
    !/^3\d{13}3$/.test(form.tax_number.trim());

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const name = form.name.trim();
      if (!name) throw new Error("اسم المنشأة مطلوب");

      const rate = Number(form.default_vat_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100)
        throw new Error("نسبة الضريبة يجب أن تكون بين 0 و100");

      const { data, error } = await supabase
        .from("organizations")
        .update({
          name,
          tax_number: form.tax_number.trim() || null,
          currency: form.currency,
          default_vat_rate: rate,
        })
        .eq("id", organization.id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص يرى غير
      // المدير رسالة "تم الحفظ" بينما سياسة org_update_admins رفضت التعديل.
      if (!data || data.length === 0)
        throw new Error("لم يُحفظ التعديل — التعديل مقصور على المالك أو مدير المنشأة");
    },
    onSuccess: async () => {
      // السياق يحمل نسخة المنشأة التي تقرأ منها الفوترة نسبة الضريبة والرقم
      // الضريبي — بلا تحديثه تبقى الفواتير تُطبع بالقيمة القديمة حتى إعادة
      // تحميل الصفحة.
      await refresh();
      toast({ title: "تم حفظ بيانات المنشأة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  if (!organization) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">البيانات الأساسية</CardTitle>
        <CardDescription>
          تُستخدم في ترويسة كل فاتورة ومستند — والرقم الضريبي إلزامي في فاتورة ZATCA
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>اسم المنشأة</Label>
            <Input
              value={form.name}
              disabled={readOnly}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>نوع المنشأة</Label>
            <Input value="مركز طبي متكامل" disabled />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الرقم الضريبي</Label>
            <Input
              dir="ltr"
              value={form.tax_number}
              disabled={readOnly}
              placeholder="300000000000003"
              onChange={(e) => set("tax_number", e.target.value)}
            />
            {taxLooksWrong && (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بـ 3 — تأكد أنك لم تُدخل السجل التجاري
              </span>
            )}
            {!form.tax_number.trim() && (
              <span className="text-xs text-muted-foreground">
                بلا رقم ضريبي تُطبع الفواتير ناقصة ولا تُقبل كفاتورة ضريبية
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>العملة</Label>
            <Select
              value={form.currency}
              disabled={readOnly}
              onValueChange={(value) => set("currency", value as OrganizationRow["currency"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((currency) => (
                  <SelectItem key={currency.value} value={currency.value}>
                    {currency.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>نسبة الضريبة الافتراضية (%)</Label>
            <Input
              dir="ltr"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.default_vat_rate}
              disabled={readOnly}
              onChange={(e) => set("default_vat_rate", e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              تقرأها شاشة الفوترة عند حساب ضريبة كل فاتورة جديدة
            </span>
          </div>
        </div>

        {!readOnly && (
          <div className="flex justify-start">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" />
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الفروع
// ---------------------------------------------------------------------------
type BranchForm = {
  name: string;
  code: string;
  address: string;
  city: string;
  is_main: boolean;
};

const EMPTY_BRANCH: BranchForm = { name: "", code: "", address: "", city: "", is_main: false };

function BranchDialog({
  open,
  onOpenChange,
  organizationId,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  editing: BranchRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<BranchForm>(EMPTY_BRANCH);

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name ?? "",
            code: editing.code ?? "",
            address: editing.address ?? "",
            city: editing.city ?? "",
            is_main: editing.is_main,
          }
        : EMPTY_BRANCH,
    );
  }, [open, editing]);

  const set = <K extends keyof BranchForm>(key: K, value: BranchForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      if (!name) throw new Error("اسم الفرع مطلوب");

      const payload = {
        organization_id: organizationId,
        name,
        code: form.code.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        is_main: form.is_main,
      };

      // الفرع الرئيسي واحد لا أكثر: تعيين فرع رئيسيًا ينزع الصفة عن غيره في
      // نفس الخطوة، وإلا ظهر فرعان رئيسيان ولا يُعرف أيهما يُطبع في الترويسة.
      if (form.is_main) {
        const { error: clearError } = await supabase
          .from("branches")
          .update({ is_main: false })
          .eq("organization_id", organizationId)
          .eq("is_main", true);
        if (clearError) throw clearError;
      }

      if (editing) {
        const { data, error } = await supabase
          .from("branches")
          .update(payload)
          .eq("id", editing.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحفظ التعديل — راجع صلاحيتك");
      } else {
        const { error } = await supabase.from("branches").insert(payload);
        if (error) {
          // القيد الفريد (منشأة، رمز)
          if (String(error.message).includes("duplicate") || String(error.message).includes("unique"))
            throw new Error("رمز الفرع مستخدم في فرع آخر");
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches", organizationId] });
      toast({ title: editing ? "تم تعديل الفرع" : "تمت إضافة الفرع" });
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
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل فرع" : "فرع جديد"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>اسم الفرع</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرمز</Label>
            <Input dir="ltr" value={form.code} onChange={(e) => set("code", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المدينة</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.is_main}
              onChange={(e) => set("is_main", e.target.checked)}
            />
            الفرع الرئيسي
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={save.isPending || !form.name.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchesTab({ readOnly }: { readOnly: boolean }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRow | null>(null);
  const organizationId = organization?.id;

  const branches = useQuery({
    queryKey: ["branches", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, organization_id, name, code, address, city, is_main, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("is_main", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as BranchRow[];
    },
  });

  const remove = useMutation({
    mutationFn: async (branch: BranchRow) => {
      // الحذف يسقط بالقيود الأجنبية لو ارتبط بالفرع مستخدمون أو مستودعات أو
      // مواعيد — رسالة القاعدة الخام غير مفهومة، فتُترجم هنا.
      const { data, error } = await supabase
        .from("branches")
        .delete()
        .eq("id", branch.id)
        .select("id");
      if (error) {
        if (String(error.message).includes("violates foreign key"))
          throw new Error("لا يمكن حذف فرع مرتبط بمستخدمين أو مستودعات أو مواعيد — انقلها أولًا");
        throw error;
      }
      if (!data || data.length === 0) throw new Error("لم يُحذف شيء — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches", organizationId] });
      toast({ title: "تم حذف الفرع" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const rows = branches.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">الفروع</CardTitle>
          <CardDescription>
            الفروع تُربط بالمستخدمين والمستودعات والمواعيد، وتُصفّى بها التقارير
          </CardDescription>
        </div>
        {!readOnly && organizationId && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            فرع جديد
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {branches.isLoading && <Skeleton className="h-32 w-full" />}
        {!branches.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفرع</TableHead>
                <TableHead>الرمز</TableHead>
                <TableHead>المدينة</TableHead>
                <TableHead>العنوان</TableHead>
                {!readOnly && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((branch) => (
                <TableRow key={branch.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {branch.name}
                      {branch.is_main && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" />
                          رئيسي
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{branch.code ?? "—"}</TableCell>
                  <TableCell className="text-sm">{branch.city ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {branch.address ?? "—"}
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(branch);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(branch)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={readOnly ? 4 : 5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    لا توجد فروع.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {organizationId && (
        <BranchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizationId={organizationId}
          editing={editing}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
export default function OrganizationSettings() {
  const { membership } = useOrganizationAccess();
  const isAdmin =
    membership?.role_key === "owner" || membership?.role_key === "organization_admin";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">بيانات المنشأة</h1>
          <p className="text-sm text-muted-foreground">
            الاسم والرقم الضريبي والعملة ونسبة الضريبة، وإدارة الفروع
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-800">
            يمكنك استعراض هذه البيانات، لكن التعديل مقصور على "المالك" أو "مدير المنشأة" — وهو
            مطبَّق في قاعدة البيانات عبر RLS لا في الواجهة وحدها.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="organization" className="flex flex-col gap-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="organization">البيانات الأساسية</TabsTrigger>
          <TabsTrigger value="branches">الفروع</TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <OrganizationTab readOnly={!isAdmin} />
        </TabsContent>

        <TabsContent value="branches">
          <BranchesTab readOnly={!isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
