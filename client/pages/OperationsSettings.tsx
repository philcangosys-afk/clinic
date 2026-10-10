import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Settings2, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ORG_ROLE_KEYS,
  type DiscountLimitRow,
  type ConsultationFeeSettingsRow,
  type InsuranceSettingsRow,
  type InternalMessagingSettingsRow,
  type LookupCategoryRow,
  type LookupValueRow,
  type OrganizationDiscountSettingsRow,
  type OrganizationVatSettingsRow,
  type PrintSettingsRow,
  type SmsCreditBalanceRow,
} from "@/lib/database.types";
import LookupSelect, { useLookupValues } from "@/components/shared/LookupSelect";
import { usePermissions } from "@/lib/permissions";
import ItemPicker from "@/components/shared/ItemPicker";
import { errorMessage } from "@/lib/error-message";

const ROLE_LABELS_AR: Record<string, string> = {
  owner: "المالك",
  organization_admin: "مدير المؤسسة",
  branch_manager: "مدير فرع",
  doctor: "طبيب",
  nurse: "ممرض/ة",
  receptionist: "موظف استقبال",
  pharmacist: "صيدلي",
  lab_technician: "فني مختبر",
  radiology_technician: "فني أشعة",
  accountant: "محاسب",
  hr_manager: "مدير موارد بشرية",
  employee: "موظف",
};

// جميع جداول إعدادات المؤسسة (باستثناء discount_limits) singleton بمفتاح organization_id
// وتُقرأ/تُحدَّث بنفس نمط upsert — هذا الـ hook العام يغطي الجميع بدلًا من تكرار المنطق 7 مرات
function useOrgSettingsRow<T>(
  table: string,
  organizationId: string | undefined,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: [table, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data as T | null) ?? null;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<T>) => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase
        .from(table)
        .upsert({ organization_id: organizationId, ...patch } as Record<string, unknown>);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table, organizationId] });
      toast({ title: "تم حفظ الإعدادات" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return { query, save };
}

export default function OperationsSettings() {
  const { organization, membership } = useOrganizationAccess();
  const isAdmin = membership?.role_key === "owner" || membership?.role_key === "organization_admin";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">إعدادات التشغيل</h1>
          <p className="text-sm text-muted-foreground">
            إعدادات مستوى المؤسسة — السياسات التشغيلية وأوقات العمل، والطباعة والضريبة
            والخصومات والكشفية والتأمين والمراسلة الداخلية
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-800">
            يمكنك استعراض هذه الإعدادات، لكن التعديل مقيّد بصفة "المالك" أو "مدير المؤسسة" فقط (مطبَّق فعليًا في قاعدة البيانات عبر RLS، وليس فقط في الواجهة).
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="policies" className="flex flex-col gap-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="policies">السياسات التشغيلية</TabsTrigger>
          <TabsTrigger value="locale">اللغة والبلد</TabsTrigger>
          <TabsTrigger value="print">الطباعة</TabsTrigger>
          <TabsTrigger value="vat">الضريبة</TabsTrigger>
          <TabsTrigger value="discounts">الخصومات</TabsTrigger>
          <TabsTrigger value="consultation">الكشفية</TabsTrigger>
          <TabsTrigger value="insurance">التأمين</TabsTrigger>
          <TabsTrigger value="messaging">المراسلة الداخلية</TabsTrigger>
          <TabsTrigger value="sms">رصيد SMS</TabsTrigger>
          <TabsTrigger value="quick-groups">مجموعات الفوترة السريعة</TabsTrigger>
          <TabsTrigger value="lookups">القوائم المرجعية</TabsTrigger>
        </TabsList>

        <TabsContent value="policies">
          <PoliciesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="locale">
          <LocaleTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="print">
          <PrintSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="vat">
          <VatSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="consultation">
          <ConsultationSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="insurance">
          <InsuranceSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="messaging">
          <MessagingSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="sms">
          <SmsSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="quick-groups">
          <QuickInvoiceGroupsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="lookups">
          <LookupsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}


// ---------------------------------------------------------------------------
// مجموعات الفوترة السريعة (لقطة 22) — جداولها في 0042
// ---------------------------------------------------------------------------
function QuickInvoiceGroupsTab({
  organizationId,
  readOnly,
}: {
  organizationId: string | undefined;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#2563eb");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ["quick-invoice-groups-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_invoice_groups")
        .select(
          "id, name_ar, color, sort_order, is_disabled, quick_invoice_group_items(id, qty, item_id, item:items(name_ar, price))",
        )
        .eq("organization_id", organizationId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        name_ar: string;
        color: string | null;
        sort_order: number;
        is_disabled: boolean;
        quick_invoice_group_items: {
          id: string;
          qty: number;
          item_id: string;
          item: { name_ar: string; price: number } | null;
        }[];
      }[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["quick-invoice-groups-admin", organizationId] });

  const addGroup = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!newName.trim()) throw new Error("اكتب اسم المجموعة");
      const { error } = await supabase.from("quick_invoice_groups").insert({
        organization_id: organizationId,
        name_ar: newName.trim(),
        color: newColor,
        sort_order: (groups.data?.length ?? 0) * 10 + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setNewName("");
      toast({ title: "تمت إضافة المجموعة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  const removeGroup = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("quick_invoice_groups").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف المجموعة" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حذف المجموعة", description: errorMessage(error) }),
  });

  const addItem = useMutation({
    mutationFn: async ({ groupId, itemId }: { groupId: string; itemId: string }) => {
      const { error } = await supabase
        .from("quick_invoice_group_items")
        .insert({ group_id: groupId, item_id: itemId, qty: 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () =>
      toast({
        variant: "destructive",
        title: "تعذر إضافة الصنف",
        description: "قد يكون الصنف مضافًا للمجموعة بالفعل",
      }),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("quick_invoice_group_items").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حذف البند", description: errorMessage(error) }),
  });

  const setItemQty = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      const { data: affectedRows, error } = await supabase.from("quick_invoice_group_items").update({ qty }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>مجموعات الفوترة السريعة</CardTitle>
        <CardDescription>
          أزرار جاهزة في نافذة الفاتورة تضيف عدة أصناف دفعةً واحدة. ليست عرضًا سعريًا — لا تغيّر
          الأسعار ولا الخصومات، والخصم يُحتسب لكل صنف كما لو أُضيف يدويًا.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>اسم المجموعة</Label>
              <Input className="w-56" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>اللون</Label>
              <Input
                type="color"
                className="h-10 w-16 p-1"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
            <Button disabled={addGroup.isPending || !newName.trim()} onClick={() => addGroup.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة مجموعة
            </Button>
          </div>
        )}

        {groups.isLoading && <Skeleton className="h-24 w-full" />}
        {!groups.isLoading &&
          (groups.data ?? []).map((group) => (
            <div key={group.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: group.color ?? "#94a3b8" }}
                  />
                  {group.name_ar}
                  <span className="text-xs text-muted-foreground">
                    ({(group.quick_invoice_group_items ?? []).length} صنف)
                  </span>
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExpandedId(expandedId === group.id ? null : group.id)}
                  >
                    {expandedId === group.id ? "إخفاء الأصناف" : "الأصناف"}
                  </Button>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" onClick={() => removeGroup.mutate(group.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              {expandedId === group.id && (
                <div className="mt-3 flex flex-col gap-2">
                  {(group.quick_invoice_group_items ?? []).map((line) => {
                    const item = Array.isArray(line.item) ? line.item[0] : line.item;
                    return (
                      <div key={line.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{item?.name_ar ?? "—"}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {Number(item?.price ?? 0).toFixed(2)}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          disabled={readOnly}
                          defaultValue={String(line.qty)}
                          onBlur={(e) => {
                            const qty = Number(e.target.value);
                            if (qty !== Number(line.qty)) setItemQty.mutate({ id: line.id, qty });
                          }}
                        />
                        {!readOnly && (
                          <Button size="sm" variant="ghost" onClick={() => removeItem.mutate(line.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {(group.quick_invoice_group_items ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">لا توجد أصناف في هذه المجموعة بعد.</p>
                  )}
                  {!readOnly && (
                    <ItemPicker onSelect={(item) => addItem.mutate({ groupId: group.id, itemId: item.id })} />
                  )}
                </div>
              )}
            </div>
          ))}
        {!groups.isLoading && (groups.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مجموعات بعد.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الطباعة
// ---------------------------------------------------------------------------
function PrintSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<PrintSettingsRow>("print_settings", organizationId);
  const [form, setForm] = useState<Partial<PrintSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultPrintSettings, ...form };

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الطباعة</CardTitle>
        <CardDescription>مقاس الورق لكل نوع مستند، وإظهار الشعار، وملاحظة أسفل المستند</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PaperSizeRow
          label="مقاس طباعة الفاتورة"
          value={value.invoice_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, invoice_paper_size: v }))}
        />
        <PaperSizeRow
          label="مقاس طباعة الإيصال"
          value={value.receipt_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, receipt_paper_size: v }))}
        />
        <PaperSizeRow
          label="مقاس طباعة التقارير"
          value={value.report_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, report_paper_size: v }))}
        />
        <ToggleRow
          label="إظهار الشعار في المستندات المطبوعة"
          checked={value.show_logo}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, show_logo: checked }))}
        />
        <LogoUploader
          value={value.logo_url}
          organizationId={organizationId}
          disabled={readOnly}
          onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
        />
        <div className="flex flex-col gap-1.5">
          <Label>سطر العنوان في الفاتورة</Label>
          <Input
            value={value.invoice_address_line ?? ""}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, invoice_address_line: e.target.value }))}
            placeholder="مثال: الطائف - الجفيف - طريق الملك خالد"
          />
          <span className="text-[11px] text-muted-foreground">
            يُترك فارغًا ليُركَّب تلقائيًّا من العنوان الوطنيّ في إعدادات الضريبة.
          </span>
        </div>
        <PolicyLinesEditor
          value={value.invoice_policy_lines ?? []}
          disabled={readOnly}
          onChange={(lines) => setForm((f) => ({ ...f, invoice_policy_lines: lines }))}
        />
        <div className="flex flex-col gap-1.5">
          <Label>ملاحظة أسفل المستند (اختياري)</Label>
          <Input
            value={value.footer_note ?? ""}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, footer_note: e.target.value }))}
            placeholder="مثال: شكرًا لزيارتكم عيادتنا"
          />
        </div>
        {!readOnly && (
          <Button
            className="self-start"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                ...form,
                invoice_policy_lines: (form.invoice_policy_lines ?? value.invoice_policy_lines ?? [])
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0),
              })
            }
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultPrintSettings: PrintSettingsRow = {
  organization_id: "",
  invoice_paper_size: "a4",
  receipt_paper_size: "thermal_80mm",
  report_paper_size: "a4",
  show_logo: true,
  footer_note: null,
  updated_at: "",
  logo_url: null,
  invoice_address_line: null,
  invoice_policy_lines: [],
};

const BRANDING_BUCKET = "clinic-branding";

/**
 * رفع شعار المنشأة.
 *
 * `show_logo` موجود في `print_settings` منذ 0010 ويُحفَظ من هذه الشاشة —
 * **ولم يكن في القاعدة شعارٌ أصلًا**: لا عمود يحمل مساره ولا دلو يخزّنه. فكان
 * الإعداد يسأل «أظهر الشعار؟» عن شيء لا وجود له، وتخرج كل فاتورة بلا هوية.
 *
 * الدلو عامّ القراءة (0157): الشعار يُعرض في نافذة طباعة وفي رسالة تصل
 * المريض، وكلاهما بلا ترويسة استيثاق. والكتابة تبقى للأعضاء وحدهم.
 */
function LogoUploader({
  value,
  organizationId,
  disabled,
  onChange,
}: {
  value: string | null;
  organizationId: string | undefined;
  disabled: boolean;
  onChange: (url: string | null) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (!organizationId) return;
    // حدٌّ معقول: الشعار يُضمَّن في كل ورقة تُطبع، وملفٌّ ضخم يُبطئ كل طباعة
    if (file.size > 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "الملفّ كبير",
        description: "اختر صورة أصغر من ميغابايت واحد — الشعار يُضمَّن في كل فاتورة.",
      });
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `${organizationId}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (error) throw error;
      const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
      toast({ title: "رُفع الشعار", description: "اضغط «حفظ» لاعتماده." });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "تعذّر رفع الشعار",
        description: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>شعار المنشأة</Label>
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          <img
            src={value}
            alt="شعار المنشأة"
            className="h-16 w-auto max-w-[10rem] rounded border bg-white object-contain p-1"
          />
        ) : (
          <span className="rounded border border-dashed px-4 py-5 text-xs text-muted-foreground">
            لا شعار
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={disabled || busy}
            className="max-w-xs"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          {value && !disabled && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange(null)}>
              إزالة الشعار
            </Button>
          )}
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground">
        PNG أو JPG أو SVG، أقلّ من ميغابايت. يظهر أعلى الفاتورة المطبوعة حين يكون
        «إظهار الشعار» مفعَّلًا.
      </span>
    </div>
  );
}

/**
 * شروط المجمع أسفل الفاتورة — بندًا بندًا لا نصًّا واحدًا.
 *
 * «للمريض الحق في المراجعة المجانية خلال ١٤ يومًا» و«الفاتورة تخضع لسياسة
 * الاسترداد» بندان يُحرَّران ويُرتَّبان ويُحذف أحدهما دون الآخر. حشرهما في
 * حقلٍ واحد يجعل تعديل بندٍ إعادةَ كتابة الجميع.
 */
function PolicyLinesEditor({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>شروط المجمع أسفل الفاتورة</Label>
      {value.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={line}
            disabled={disabled}
            onChange={(e) => {
              const next = [...value];
              next[index] = e.target.value;
              onChange(next);
            }}
            placeholder="مثال: للمريض الحق في المراجعة المجانية خلال 14 يوم من تاريخ الفاتورة"
          />
          {!disabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              حذف
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...value, ""])}>
          إضافة بند
        </Button>
      )}
      <span className="text-[11px] text-muted-foreground">
        تُطبع بخطٍّ عريض أسفل المبالغ، بترتيبها هنا. البند الفارغ يُهمَل عند الحفظ.
      </span>
    </div>
  );
}

function PaperSizeRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: "a4" | "thermal_80mm";
  disabled: boolean;
  onChange: (value: "a4" | "thermal_80mm") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as "a4" | "thermal_80mm")}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a4">A4</SelectItem>
          <SelectItem value="thermal_80mm">رول حراري 80mm</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Button
        type="button"
        size="sm"
        variant={checked ? "default" : "outline"}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked ? "مفعّل" : "معطّل"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الضريبة
// ---------------------------------------------------------------------------
function VatSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<OrganizationVatSettingsRow>("organization_vat_settings", organizationId);
  const [form, setForm] = useState<Partial<OrganizationVatSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultVatSettings, ...form };
  const toggle = (key: keyof OrganizationVatSettingsRow, label: string) => (
    <ToggleRow
      key={key}
      label={label}
      checked={Boolean(value[key])}
      disabled={readOnly}
      onChange={(checked) => setForm((f) => ({ ...f, [key]: checked }))}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الضريبة (VAT)</CardTitle>
        <CardDescription>تحكّم مركزي في تطبيق الضريبة على المبيعات والمشتريات ومعامل الأسنان والمصاريف المتنوعة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {toggle("sales_vat_enabled", "تفعيل ضريبة المبيعات")}
        {toggle("purchase_vat_enabled", "تفعيل ضريبة المشتريات")}
        {toggle("purchase_vat_editable", "السماح بتعديل نسبة ضريبة المشتريات يدويًا")}
        <Separator />
        {toggle("dental_lab_vat_enabled", "تفعيل ضريبة طلبيات معامل الأسنان")}
        {toggle("dental_lab_vat_editable", "السماح بتعديل نسبة ضريبة معامل الأسنان يدويًا")}
        <Separator />
        {toggle("misc_expenses_vat_enabled", "تفعيل ضريبة المصاريف المتنوعة")}
        {toggle("misc_expenses_require_supplier_tax_number", "إلزامية الرقم الضريبي للمورّد في المصاريف المتنوعة")}
        {toggle("misc_expenses_require_purchase_invoice_number", "إلزامية رقم فاتورة الشراء في المصاريف المتنوعة")}
        <Separator />
        {toggle("print_price_with_vat", "طباعة الأسعار شاملة الضريبة")}
        {toggle("block_invoice_without_nationality_or_id", "منع إصدار الفاتورة بلا جنسية/هوية للمريض")}
        {toggle("vat_exemption_disabled_for_customer_types", "تعطيل إعفاء الضريبة حسب نوع العميل")}
        {toggle("vat_exemption_disabled_for_items", "تعطيل إعفاء الضريبة حسب الصنف")}
        {toggle(
          "vat_exempt_requires_id",
          "اشتراط رقم الهوية لإعفاء الجنسية من الضريبة",
        )}
        <Separator />
        <ExemptNationalitiesPicker
          selected={value.vat_exempt_nationality_value_ids ?? []}
          readOnly={readOnly}
          onChange={(ids) => setForm((f) => ({ ...f, vat_exempt_nationality_value_ids: ids }))}
        />
        <Separator />
        <CategoryVatRates organizationId={organizationId} readOnly={readOnly} />
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultVatSettings: OrganizationVatSettingsRow = {
  organization_id: "",
  sales_vat_enabled: true,
  purchase_vat_enabled: true,
  purchase_vat_editable: false,
  dental_lab_vat_enabled: true,
  dental_lab_vat_editable: false,
  misc_expenses_vat_enabled: false,
  misc_expenses_require_supplier_tax_number: false,
  misc_expenses_require_purchase_invoice_number: false,
  print_price_with_vat: true,
  block_invoice_without_nationality_or_id: false,
  vat_exemption_disabled_for_customer_types: false,
  vat_exemption_disabled_for_items: false,
  vat_exempt_requires_id: true,
  vat_exempt_nationality_value_ids: [],
  updated_at: "",
};

/**
 * جنسيات معفاة من الضريبة — `vat_exempt_nationality_value_ids uuid[]` موجود في
 * `organization_vat_settings` منذ 0003 وتقرؤه `app_resolve_vat_rate` فعليًا،
 * لكن لم يكن هناك أي طريقة لتعبئته من الواجهة فبقي فارغًا دائمًا.
 */
function ExemptNationalitiesPicker({
  selected,
  readOnly,
  onChange,
}: {
  selected: string[];
  readOnly: boolean;
  onChange: (ids: string[]) => void;
}) {
  // نفس الخطّاف الذي تستعمله كل القوائم المنسدلة — يجمع الجنسيات العامة
  // وما أضافته المؤسسة، فلا تختفي جنسية أضافها المستخدم من قائمة الإعفاء.
  const nationalities = useLookupValues("nationalities");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>الجنسيات المعفاة من الضريبة</Label>
        <span className="text-xs text-muted-foreground">
          {selected.length === 0 ? "لا يوجد إعفاء" : `${selected.length} جنسية معفاة`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        يُطبَّق الإعفاء تلقائيًا على فواتير المرضى بهذه الجنسيات ما لم يكن &quot;تعطيل إعفاء الضريبة حسب نوع العميل&quot; مفعّلًا.
      </p>
      {nationalities.isLoading && <Skeleton className="h-16 w-full" />}
      <div className="flex max-h-48 flex-wrap gap-3 overflow-y-auto rounded-md border p-3">
        {(nationalities.data ?? []).map((row) => (
          <label key={row.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              disabled={readOnly}
              checked={selected.includes(row.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
              }
            />
            {row.name_ar}
          </label>
        ))}
        {!nationalities.isLoading && (nationalities.data ?? []).length === 0 && (
          <span className="text-sm text-muted-foreground">لا توجد جنسيات معرّفة في القوائم المرجعية.</span>
        )}
      </div>
    </div>
  );
}

/**
 * نِسَب الضريبة لكل فئة أصناف — تُخزَّن في `lookup_values.extra.default_vat_rate`
 * (نمط بذرة 0003: "VAT 0%" / "VAT 15%") وتقرؤها `app_resolve_vat_rate` كمستوى
 * وسيط بين نسبة الصنف ونسبة المؤسسة. لم يكن لها إدخال، فكانت النِسَب المزروعة
 * هي الوحيدة الممكنة.
 */
function CategoryVatRates({
  organizationId,
  readOnly,
}: {
  organizationId: string | undefined;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /**
   * فئات الأصناف المزروعة عامة (`organization_id is null`)، وسياسة
   * `lookup_values_manage_admins` في 0001 تمنع أي منشأة من الكتابة فيها —
   * والكتابة كانت تطابق صفرًا من الصفوف بلا خطأ فتظهر رسالة نجاح كاذبة.
   *
   * لذلك: النِسَب تُعرَض لكل الفئات، وتُحرَّر فقط في الفئات الخاصة بالمنشأة.
   * الفئة العامة تُعرض نسبتها المزروعة للقراءة، ويُوجَّه المستخدم لإنشاء فئة
   * خاصة إن أراد نسبة مختلفة — لأن تغيير نسبة فئة عامة يغيّرها لكل المنشآت.
   */
  const categories = useQuery({
    queryKey: ["lookup-values", "item_categories", "vat", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data: cats, error: catError } = await supabase
        .from("lookup_categories")
        .select("id, organization_id")
        .eq("key", "item_categories")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`);
      if (catError) throw catError;
      const ids = (cats ?? []).map((row: { id: string }) => row.id);
      const ownedIds = new Set(
        (cats ?? [])
          .filter((row: { organization_id: string | null }) => row.organization_id !== null)
          .map((row: { id: string }) => row.id),
      );
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, name_ar, extra, category_id")
        .in("category_id", ids)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as {
        id: string;
        name_ar: string;
        extra: Record<string, unknown> | null;
        category_id: string;
      }[]).map((row) => ({ ...row, editable: ownedIds.has(row.category_id) }));
    },
  });

  const saveRate = useMutation({
    mutationFn: async ({
      row,
      rate,
    }: {
      row: { id: string; extra: Record<string, unknown> | null; editable: boolean };
      rate: string;
    }) => {
      if (!row.editable)
        throw new Error(
          "هذه فئة عامة مشتركة بين كل المنشآت — أنشئ فئة خاصة بمنشأتك من القوائم المرجعية لتخصيص نسبتها",
        );
      const trimmed = rate.trim();
      const parsed = trimmed === "" ? null : Number(trimmed);
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100))
        throw new Error("النسبة يجب أن تكون بين 0 و100");
      // الدمج مع extra الحالية لا استبدالها: الحقل نفسه يحمل بيانات أخرى
      // لفئات أخرى، والاستبدال كان سيمسحها.
      const { data, error } = await supabase
        .from("lookup_values")
        .update({ extra: { ...(row.extra ?? {}), default_vat_rate: parsed } })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث بلا صفوف ليس خطأً في PostgREST — بدون هذا الفحص تظهر رسالة
      // "تم الحفظ" ولا يُحفظ شيء.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ النسبة — صلاحيتك لا تسمح بتعديل هذه الفئة");
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lookup-values", "item_categories", "vat"] });
      // مسح المسودة بعد الحفظ: بقاؤها كان يُظهر القيمة المكتوبة حتى لو لم تُحفظ
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.row.id];
        return next;
      });
      toast({ title: "تم حفظ نسبة الفئة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="flex flex-col gap-2">
      <Label>نسبة الضريبة لكل فئة أصناف</Label>
      <p className="text-xs text-muted-foreground">
        تُستخدَم عندما لا يكون للصنف نسبة خاصة. اتركها فارغة لتُطبَّق نسبة المؤسسة الافتراضية.
      </p>
      {categories.isLoading && <Skeleton className="h-24 w-full" />}
      {!categories.isLoading && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          {(categories.data ?? []).map((row) => {
            const current = (row.extra ?? {}) as Record<string, unknown>;
            const stored = current.default_vat_rate;
            const shown = drafts[row.id] ?? (stored === null || stored === undefined ? "" : String(stored));
            return (
              <div key={row.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{row.name_ar}</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-24"
                  disabled={readOnly || !row.editable}
                  value={shown}
                  placeholder="افتراضي"
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground">%</span>
                {!readOnly &&
                  (row.editable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saveRate.isPending || drafts[row.id] === undefined}
                      onClick={() => saveRate.mutate({ row, rate: drafts[row.id] ?? "" })}
                    >
                      حفظ
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">عامة</span>
                  ))}
              </div>
            );
          })}
          {(categories.data ?? []).length === 0 && (
            <span className="text-sm text-muted-foreground">لا توجد فئات أصناف معرّفة.</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// الخصومات — إعدادات عامة + قائمة حدود الخصم (متعددة الصفوف)
// ---------------------------------------------------------------------------
function DiscountSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<OrganizationDiscountSettingsRow>(
    "organization_discount_settings",
    organizationId,
  );
  const [percent, setPercent] = useState("0");

  useEffect(() => {
    if (query.data) setPercent(String(query.data.general_discount_percent));
  }, [query.data]);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>الخصم العام للمؤسسة</CardTitle>
          <CardDescription>
            يُطبَّق عند عدم وجود خصم مريض افتراضي أو عرض ساري — حسب ترتيب الأولوية الموثّق في النظام
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نسبة الخصم العام %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              className="w-40"
              value={percent}
              disabled={readOnly}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          {!readOnly && (
            <Button
              disabled={save.isPending}
              onClick={() => save.mutate({ general_discount_percent: Number(percent) || 0 })}
            >
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          )}
        </CardContent>
      </Card>

      <DiscountLimitsList organizationId={organizationId} readOnly={readOnly} />
    </div>
  );
}

function useDiscountLimits(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["discount_limits", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_limits")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DiscountLimitRow[];
    },
  });
}

function DiscountLimitsList({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const limits = useDiscountLimits(organizationId);
  const [role, setRole] = useState<string>("receptionist");
  const [minPercent, setMinPercent] = useState("0");
  const [maxPercent, setMaxPercent] = useState("10");
  // الجدول يدعم حدًّا لمستخدم بعينه (applies_to_user_id) منذ 0001، لكن الواجهة
  // كانت تدعم الصفة فقط لعدم وجود شاشة مستخدمين تُشتقّ منها القائمة.
  const [scope, setScope] = useState<"role" | "user">("role");
  const [userId, setUserId] = useState("");
  const members = useQuery({
    queryKey: ["discount-limit-members", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as { user_id: string; display_name: string }[];
    },
  });
  const memberName = (id: string | null) =>
    id ? ((members.data ?? []).find((m) => m.user_id === id)?.display_name ?? "مستخدم") : null;

  const addLimit = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (scope === "user" && !userId) throw new Error("اختر المستخدم أولًا");
      const { error } = await supabase.from("discount_limits").insert({
        organization_id: organizationId,
        applies_to_role: scope === "role" ? role : null,
        applies_to_user_id: scope === "user" ? userId : null,
        min_percent: Number(minPercent) || 0,
        max_percent: Number(maxPercent) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount_limits", organizationId] });
      toast({ title: "تمت إضافة حد الخصم" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: errorMessage(error),
      }),
  });

  const removeLimit = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("discount_limits").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discount_limits", organizationId] }),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حذف الحدّ", description: errorMessage(error) }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>حدود الخصم بحسب الصفة الوظيفية</CardTitle>
        <CardDescription>الحد الأقصى/الأدنى لنسبة الخصم الذي يمكن أن يمنحه مستخدم بصفة معينة عند إصدار فاتورة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>يُطبَّق على</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as "role" | "user")}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="role">صفة وظيفية</SelectItem>
                  <SelectItem value="user">مستخدم محدد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "role" ? (
              <div className="flex flex-col gap-1.5">
                <Label>الصفة الوظيفية</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_ROLE_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {ROLE_LABELS_AR[key] ?? key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>المستخدم</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="اختر مستخدمًا" />
                  </SelectTrigger>
                  <SelectContent>
                    {(members.data ?? []).map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأدنى %</Label>
              <Input type="number" className="w-28" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأقصى %</Label>
              <Input type="number" className="w-28" value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} />
            </div>
            <Button disabled={addLimit.isPending} onClick={() => addLimit.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        )}

        {limits.isLoading && <Skeleton className="h-24 w-full" />}
        {!limits.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>يُطبَّق على</TableHead>
                <TableHead>الحد الأدنى %</TableHead>
                <TableHead>الحد الأقصى %</TableHead>
                {!readOnly && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(limits.data ?? []).map((limit) => (
                <TableRow key={limit.id}>
                  <TableCell>
                    {limit.applies_to_user_id
                      ? `مستخدم: ${memberName(limit.applies_to_user_id)}`
                      : (ROLE_LABELS_AR[limit.applies_to_role ?? ""] ?? limit.applies_to_role ?? "—")}
                  </TableCell>
                  <TableCell>{limit.min_percent}%</TableCell>
                  <TableCell>{limit.max_percent}%</TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => removeLimit.mutate(limit.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(limits.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد حدود خصم مخصّصة — الخصم غير مقيّد حاليًا لأي صفة.
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

// ---------------------------------------------------------------------------
// الكشفية
// ---------------------------------------------------------------------------
function ConsultationSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<ConsultationFeeSettingsRow>("consultation_fee_settings", organizationId);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (query.data) setEnabled(query.data.renewal_alert_enabled);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>إعدادات الكشفية</CardTitle>
          {/*
            الوصف كان يقول إن التنبيه «يُحسَب تلقائيًا» ولا شيء يحسبه. صار
            الجدول يُقرأ فعلًا في `app_resolve_consultation_item` (0153):
            المفتاح يُشغِّل قواعد المراجعة كلّها أو يُطفئها، والتخصّصات المعفاة
            تُستثنى منها. فالنصّ هنا يقول ما يقع، لا ما كان يُنتظر.
          */}
          <CardDescription>
            المدّة التي تبقى فيها الكشفية سارية تُدار من القواعد أدناه، والمفتاح هنا يُشغّلها
            كلّها أو يُطفئها.
            <span className="mt-1 block font-medium text-emerald-700">
              حين يكون مُفعَّلًا: المريض العائد داخل مدّة التجديد تُستبدَل كشفيته بصنف «المراجعة»
              تلقائيًّا في شاشة الفوترة، مع بيان السبب على السطر. وحين يكون مُطفأً لا يقع استبدال.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleRow
            label="تفعيل قواعد المراجعة (استبدال الكشفية بالمراجعة داخل مدّة التجديد)"
            checked={enabled}
            disabled={readOnly}
            onChange={setEnabled}
          />
          {!readOnly && (
            <Button
              className="self-start"
              disabled={save.isPending}
              onClick={() => save.mutate({ renewal_alert_enabled: enabled })}
            >
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          )}
        </CardContent>
      </Card>

      <ConsultationRulesList organizationId={organizationId} readOnly={readOnly} />
    </div>
  );
}

/**
 * قواعد الكشفية لكل تخصص (لقطة 9).
 *
 * جدول `consultation_fee_rules` موجود منذ 0004 بكل حقوله (التخصص، كود
 * الكشفية، كود المراجعة، أيام التجديد، عدد المراجعات المجانية، تخصيص
 * لأطباء معينين، وضع خاص لمرضى التأمين) لكنه لم يُستخدم في أي شاشة.
 *
 * كان وصف تبويب الإعدادات يقول إن هذه القواعد "تُدار من شاشة الأطباء" —
 * وهذا غير صحيح، فلا وجود لتلك الواجهة في أي مكان. صُحِّح الوصف وبُنيت
 * الواجهة الفعلية هنا.
 */
function ConsultationRulesList({
  organizationId,
  readOnly,
}: {
  organizationId: string | undefined;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [specialtyValueId, setSpecialtyValueId] = useState("");
  const [consultationItem, setConsultationItem] = useState<{ id: string; name_ar: string } | null>(null);
  const [followUpItem, setFollowUpItem] = useState<{ id: string; name_ar: string } | null>(null);
  const [renewalDays, setRenewalDays] = useState("30");
  const [freeReviews, setFreeReviews] = useState("0");
  const [insuranceSpecific, setInsuranceSpecific] = useState(false);
  const [insuranceCompany, setInsuranceCompany] = useState("");
  /**
   * تخصيص القاعدة لأطباء بعينهم: `doctor_ids uuid[]` موجود في
   * `consultation_fee_rules` منذ 0004 (فارغ = كل الأطباء) ولم يكن له أي إدخال،
   * فكانت كل قاعدة تُطبَّق على الجميع رغم أن المواصفة تسمح بقصرها على أطباء.
   */
  const [doctorIds, setDoctorIds] = useState<string[]>([]);

  const doctors = useQuery({
    queryKey: ["consultation-rule-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // عمود التفعيل في `doctors` اسمه `is_enabled` لا `is_disabled` (0002).
        // الاستعلام القديم كان يفشل كليًا فتبقى قائمة الأطباء فارغة دائمًا.
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const doctorNameById = new Map((doctors.data ?? []).map((d) => [d.id, d.name_ar]));

  const rules = useQuery({
    queryKey: ["consultation-fee-rules", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_fee_rules")
        .select(
          "*, specialty:lookup_values!consultation_fee_rules_specialty_value_id_fkey(name_ar), consultation_item:items!consultation_fee_rules_consultation_item_id_fkey(name_ar), follow_up_item:items!consultation_fee_rules_follow_up_item_id_fkey(name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const addRule = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!consultationItem) throw new Error("اختر خدمة الكشفية");
      const days = Number(renewalDays);
      if (!Number.isFinite(days) || days <= 0) throw new Error("أيام التجديد يجب أن تكون رقمًا أكبر من صفر");
      const { error } = await supabase.from("consultation_fee_rules").insert({
        organization_id: organizationId,
        // تخصص فارغ = قاعدة عامة تنطبق على كل التخصصات
        specialty_value_id: specialtyValueId || null,
        consultation_item_id: consultationItem.id,
        follow_up_item_id: followUpItem?.id ?? null,
        renewal_days: days,
        free_reviews_count: Number(freeReviews) || 0,
        is_insurance_specific: insuranceSpecific,
        // اسم شركة التأمين لا معنى له إلا مع قاعدة تأمينية — تركه محفوظًا مع
        // قاعدة عامة يجعل القاعدة تبدو مقيّدة بشركة وهي ليست كذلك.
        insurance_company_name: insuranceSpecific ? insuranceCompany.trim() || null : null,
        doctor_ids: doctorIds,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consultation-fee-rules"] });
      toast({ title: "تمت إضافة القاعدة" });
      setConsultationItem(null);
      setFollowUpItem(null);
      setInsuranceCompany("");
      setDoctorIds([]);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: errorMessage(error),
      }),
  });

  const removeRule = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("consultation_fee_rules").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["consultation-fee-rules"] }),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حذف القاعدة", description: errorMessage(error) }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>قواعد الكشفية حسب التخصص</CardTitle>
        {/*
          صارت تُطبَّق في 0153 عبر `app_resolve_consultation_item`: مدّة التجديد
          وصنف المراجعة والأطباء والتخصّص وشركة التأمين كلّها تُقرأ. ويبقى
          `free_reviews_count` وحده بلا أثر — لم يطلبه المالك، والنصّ يقوله
          صراحةً بدل أن يوهم بأنّه يعمل.
        */}
        <CardDescription>
          تحدد خدمة الكشفية وخدمة المراجعة لكل تخصص، ومدة صلاحية الكشفية بالأيام.
          <span className="mt-1 block font-medium text-emerald-700">
            مُطبَّقة في الفوترة: عند إضافة صنف الكشفية لمريضٍ آخر كشفية له داخل مدّة التجديد،
            يُستبدَل الصنف بصنف «المراجعة» بسعره ويظهر السبب على السطر. والأخصّ يغلب: قاعدة
            الأطباء تسبق قاعدة شركة التأمين، وهي تسبق قاعدة التخصص، وهي تسبق القاعدة العامّة.
            والفاتورة الملغاة أو المؤقّتة لا تبدأ مدّة.
          </span>
          <span className="mt-1 block font-medium text-amber-700">
            «عدد المراجعات المجانية» غير مُطبَّق: الاستبدال يقع بسعر صنف المراجعة كاملًا ولا
            يُخصم من عدّاد مجانيّ. الخصم اليدويّ يبقى متاحًا على السطر.
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>التخصص</Label>
                <LookupSelect
                  categoryKey="medical_specialties"
                  value={specialtyValueId}
                  onChange={setSpecialtyValueId}
                  placeholder="كل التخصصات"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>أيام التجديد</Label>
                <Input type="number" min={1} value={renewalDays} onChange={(e) => setRenewalDays(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>خدمة الكشفية *</Label>
                {consultationItem ? (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5">
                    <span className="text-sm">{consultationItem.name_ar}</span>
                    <Button size="sm" variant="ghost" onClick={() => setConsultationItem(null)}>
                      تغيير
                    </Button>
                  </div>
                ) : (
                  <ItemPicker onSelect={(item) => setConsultationItem({ id: item.id, name_ar: item.name_ar })} />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>خدمة المراجعة</Label>
                {followUpItem ? (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5">
                    <span className="text-sm">{followUpItem.name_ar}</span>
                    <Button size="sm" variant="ghost" onClick={() => setFollowUpItem(null)}>
                      تغيير
                    </Button>
                  </div>
                ) : (
                  <ItemPicker onSelect={(item) => setFollowUpItem({ id: item.id, name_ar: item.name_ar })} />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>المراجعات المجانية</Label>
                <Input type="number" min={0} value={freeReviews} onChange={(e) => setFreeReviews(e.target.value)} />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={insuranceSpecific}
                    onChange={(e) => setInsuranceSpecific(e.target.checked)}
                    className="h-4 w-4"
                  />
                  قاعدة خاصة بمرضى التأمين
                </label>
              </div>
              {insuranceSpecific && (
                <div className="flex flex-col gap-1.5">
                  <Label>شركة التأمين (اختياري)</Label>
                  <Input
                    value={insuranceCompany}
                    onChange={(e) => setInsuranceCompany(e.target.value)}
                    placeholder="اتركه فارغًا لتنطبق على كل شركات التأمين"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>الأطباء المشمولون</Label>
                <span className="text-xs text-muted-foreground">
                  {doctorIds.length === 0 ? "كل الأطباء" : `${doctorIds.length} طبيب محدَّد`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                لا تحدد أحدًا لتنطبق القاعدة على كل الأطباء.
              </p>
              <div className="flex flex-wrap gap-3">
                {(doctors.data ?? []).map((doctor) => (
                  <label key={doctor.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={doctorIds.includes(doctor.id)}
                      onChange={(e) =>
                        setDoctorIds((prev) =>
                          e.target.checked ? [...prev, doctor.id] : prev.filter((id) => id !== doctor.id),
                        )
                      }
                    />
                    {doctor.name_ar}
                  </label>
                ))}
                {(doctors.data ?? []).length === 0 && (
                  <span className="text-sm text-muted-foreground">لا يوجد أطباء مفعّلون.</span>
                )}
              </div>
            </div>

            <Button className="self-start" disabled={addRule.isPending} onClick={() => addRule.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة قاعدة
            </Button>
          </div>
        )}

        {rules.isLoading && <Skeleton className="h-24 w-full" />}
        {!rules.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التخصص</TableHead>
                <TableHead>خدمة الكشفية</TableHead>
                <TableHead>خدمة المراجعة</TableHead>
                <TableHead>أيام التجديد</TableHead>
                <TableHead>مراجعات مجانية</TableHead>
                <TableHead>الأطباء</TableHead>
                <TableHead>النوع</TableHead>
                {!readOnly && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules.data ?? []).map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.specialty?.name_ar ?? "كل التخصصات"}</TableCell>
                  <TableCell className="font-medium">{rule.consultation_item?.name_ar ?? "—"}</TableCell>
                  <TableCell>{rule.follow_up_item?.name_ar ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{rule.renewal_days}</TableCell>
                  <TableCell className="tabular-nums">{rule.free_reviews_count}</TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-muted-foreground">
                    {(rule.doctor_ids ?? []).length === 0
                      ? "كل الأطباء"
                      : (rule.doctor_ids as string[])
                          .map((id) => doctorNameById.get(id) ?? "—")
                          .join("، ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.is_insurance_specific ? "warning" : "secondary"}>
                      {rule.is_insurance_specific ? "تأمين" : "عام"}
                      {rule.is_insurance_specific && rule.insurance_company_name
                        ? ` · ${rule.insurance_company_name}`
                        : ""}
                    </Badge>
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => removeRule.mutate(rule.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(rules.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={readOnly ? 7 : 8} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد قواعد كشفية — أضف قاعدة لتوثيق خدمة الكشفية والمراجعة ومدّة السريان
                    لكل تخصص (الاحتساب عند الفوترة يدويّ حتى الآن).
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

// ---------------------------------------------------------------------------
// التأمين
// ---------------------------------------------------------------------------
/**
 * تبويب إعدادات التأمين — **المصدر الوحيد**.
 *
 * كان لهذه الإعدادات محرِّران: هذا، ونسخة ثانية داخل `Insurance.tsx` بقيم
 * افتراضية معرَّفة مرتين. كلاهما `upsert` على نفس الصف، فتعديل في إحداهما
 * يُظهِر قيمة قديمة في الأخرى حتى التحديث، وأول حفظ من شاشة قد يدهس ما ضُبط
 * في الأخرى. شاشة التأمين تستورد هذا المكوّن الآن بدل نسختها.
 */
export function InsuranceSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<InsuranceSettingsRow>("insurance_settings", organizationId);
  const [form, setForm] = useState<Partial<InsuranceSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultInsuranceSettings, ...form };
  const toggle = (key: keyof InsuranceSettingsRow, label: string) => (
    <ToggleRow
      key={key}
      label={label}
      checked={Boolean(value[key])}
      disabled={readOnly}
      onChange={(checked) => setForm((f) => ({ ...f, [key]: checked }))}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات التأمين الطبي</CardTitle>
        <CardDescription>القوالب الافتراضية لنماذج المطالبات، وقواعد منع التكرار، والإنشاء التلقائي للنماذج</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/*
          أربعة إعدادات تُحفظ ولا يقرؤها شيء: `vat_responsibility` (الدالّة التي
          تحسب الضريبة فعلًا `app_resolve_vat_rate` لا تقرؤه، ولا يذكره أي من
          مستهلكي إعدادات التأمين في الفوترة والمطالبات)، ومفتاحا إشعار التعديل
          (لا مُحفِّز على `insurance_claim_forms` يُنشئ إشعارًا)،
          و`allow_doctor_edit_radiology_data` (لا نموذج يفحصه). كانت مبثوثة بين
          الإعدادات النافذة فتبدو مثلها — وأخطرها الضريبة لأن المالك يضبطها ثم
          تُحتسب الفواتير التأمينية كما كانت تمامًا. فجُمعت وأُعلنت صراحةً.
        */}
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="text-sm font-semibold">إعدادات تُحفظ ولا تُطبَّق بعد</p>
          <p className="text-xs">
            تُسجَّل في القاعدة ولا يقرؤها أي حساب أو إشعار اليوم. احتساب الضريبة يتبع نسبة
            المنشأة وفئات الأصناف والجنسيات المعفاة من تبويب «الضريبة».
          </p>
          <div className="flex items-center justify-between gap-4">
            <Label>الجهة التي تتحمّل الضريبة (غير مُطبَّقة)</Label>
            <Select
              value={value.vat_responsibility}
              disabled={readOnly}
              onValueChange={(v) => setForm((f) => ({ ...f, vat_responsibility: v as InsuranceSettingsRow["vat_responsibility"] }))}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">المريض</SelectItem>
                <SelectItem value="insurance_company">شركة التأمين</SelectItem>
                <SelectItem value="by_item_category">حسب فئة الصنف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {toggle("allow_doctor_edit_radiology_data", "السماح للطبيب بتعديل بيانات الأشعة في النموذج (غير مُطبَّق)")}
          {toggle("notify_treating_doctor_on_changes", "إشعار الطبيب المعالج عند أي تعديل على النموذج (لا إشعار يُرسَل)")}
          {toggle("notify_form_owner_on_changes", "إشعار منشئ النموذج عند أي تعديل (لا إشعار يُرسَل)")}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>قالب UCAF الافتراضي</Label>
            <Input
              value={value.default_ucaf_template}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, default_ucaf_template: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>قالب DCAF الافتراضي</Label>
            <Input
              value={value.default_dcaf_template}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, default_dcaf_template: e.target.value }))}
            />
          </div>
        </div>
        <Separator />
        {toggle("prevent_duplicate_policy_name", "منع تكرار اسم البوليصة لنفس الشركة")}
        {toggle("prevent_duplicate_services_in_claim_line", "منع تكرار نفس الخدمة داخل نموذج المطالبة")}
        {toggle("auto_create_forms_on_consultation_invoice", "إنشاء نموذج مطالبة تلقائيًا عند فوترة كشفية تأمين")}
        {toggle("exclude_offer_discount_invoices_from_auto_create", "استثناء فواتير العروض من الإنشاء التلقائي")}
        {toggle("disable_patient_max_copay_field", "تعطيل حقل الحد الأقصى لمشاركة المريض")}
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultInsuranceSettings: InsuranceSettingsRow = {
  organization_id: "",
  vat_responsibility: "patient",
  default_ucaf_template: "UCAF-2",
  default_dcaf_template: "DCAF-2",
  prevent_duplicate_policy_name: true,
  prevent_duplicate_services_in_claim_line: true,
  notify_treating_doctor_on_changes: true,
  notify_form_owner_on_changes: true,
  disable_patient_max_copay_field: false,
  auto_create_forms_on_consultation_invoice: true,
  exclude_offer_discount_invoices_from_auto_create: true,
  allow_doctor_edit_radiology_data: false,
  updated_at: "",
};

// ---------------------------------------------------------------------------
// المراسلة الداخلية
// ---------------------------------------------------------------------------
function MessagingSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<InternalMessagingSettingsRow>("internal_messaging_settings", organizationId);
  const [form, setForm] = useState<Partial<InternalMessagingSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultMessagingSettings, ...form };

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات المراسلة الداخلية</CardTitle>
        <CardDescription>الشات الداخلي بين فريق العمل، ونطاق الاطلاع والحذف، والإشعارات</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleRow
          label="تفعيل الشات الداخلي"
          checked={value.internal_chat_enabled}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, internal_chat_enabled: checked }))}
        />
        <p className="-mt-2 text-xs text-muted-foreground">
          إلغاء التفعيل يُخفي تبويب «الدردشة الداخلية» في شاشة الرسائل — إخفاءُ واجهة لا منعٌ في
          القاعدة: سياسات الرسائل الداخلية لا تفحص هذا المفتاح بعد.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>فترة التحديث (ثانية)</Label>
            <Input
              type="number"
              min={5}
              disabled={readOnly}
              value={value.poll_interval_seconds}
              onChange={(e) => setForm((f) => ({ ...f, poll_interval_seconds: Number(e.target.value) || 15 }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مهلة اعتبار المستخدم "متصلًا" (ثانية) — غير مُطبَّقة</Label>
            <Input
              type="number"
              min={10}
              disabled={readOnly}
              value={value.online_timeout_seconds}
              onChange={(e) => setForm((f) => ({ ...f, online_timeout_seconds: Number(e.target.value) || 60 }))}
            />
            {/* لا حالة «متصل» في النظام: لا جدول حضور ولا منظور يقرأ هذه المهلة. */}
            <span className="text-xs text-amber-700">لا تُعرض حالة «متصل» في أي شاشة بعد.</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label>من يمكنه الاطلاع على الرسائل</Label>
          <Select
            value={value.view_permission_scope}
            disabled={readOnly}
            onValueChange={(v) => setForm((f) => ({ ...f, view_permission_scope: v as "all" | "own" }))}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">رسائله فقط</SelectItem>
              <SelectItem value="all">جميع الرسائل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label>من يمكنه حذف الرسائل</Label>
          <Select
            value={value.delete_permission_scope}
            disabled={readOnly}
            onValueChange={(v) => setForm((f) => ({ ...f, delete_permission_scope: v as "all" | "own" }))}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">رسائله فقط</SelectItem>
              <SelectItem value="all">جميع الرسائل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        {/* إدراج رسالة داخلية لا يُنشئ تنبيهًا في القاعدة، فالمفتاحان بلا أثر
            حتى يُضاف مُحفِّز يستدعي `app_notify_event` بشرطهما. */}
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="text-sm font-semibold">مفتاحان يُحفظان ولا يُطبَّقان بعد</p>
          <p className="text-xs">
            لا يُنشئ النظام تنبيهًا عند وصول رسالة داخلية — عدّاد «غير المقروء» في تبويب الدردشة
            هو ما ينبّه اليوم.
          </p>
          <ToggleRow
            label="تفعيل الإشعارات"
            checked={value.notifications_enabled}
            disabled={readOnly}
            onChange={(checked) => setForm((f) => ({ ...f, notifications_enabled: checked }))}
          />
          <ToggleRow
            label="إشعار حسب الصفة الوظيفية"
            checked={value.notify_by_role}
            disabled={readOnly}
            onChange={(checked) => setForm((f) => ({ ...f, notify_by_role: checked }))}
          />
        </div>
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultMessagingSettings: InternalMessagingSettingsRow = {
  organization_id: "",
  internal_chat_enabled: true,
  poll_interval_seconds: 15,
  online_timeout_seconds: 60,
  view_permission_scope: "own",
  delete_permission_scope: "own",
  notifications_enabled: true,
  notify_by_role: true,
  updated_at: "",
};

// ---------------------------------------------------------------------------
// رصيد SMS
// ---------------------------------------------------------------------------
function SmsSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<SmsCreditBalanceRow>("sms_credit_balance", organizationId);
  const [threshold, setThreshold] = useState("50");

  useEffect(() => {
    if (query.data) setThreshold(String(query.data.low_balance_alert_threshold));
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  /**
   * لا سجلّ رصيد قبل أول تعبئة.
   *
   * دالّة إنشاء المنشأة الحيّة لا تُدرِج صفًّا في `sms_credit_balance`، والجدول
   * **لا يملك سياسة INSERT** إطلاقًا — فمحاولة `upsert` من هذا التبويب تُرفَض
   * برسالة RLS خامّة يفهم منها المالك أنه لا يملك الصلاحية، والحقيقة أن الصفّ
   * غائب. ينشئه `app_apply_sms_credit_transaction` عند أول تعبئة رصيد.
   */
  const rowMissing = !query.isError && query.data == null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>رصيد الرسائل النصية (SMS)</CardTitle>
        <CardDescription>الرصيد الحالي للمؤسسة، وحد التنبيه عند انخفاضه — الاستهلاك والتعبئة يتمّان من سجل الحركات فقط</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rowMissing && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            لا يوجد سجل رصيد لهذه المنشأة بعد، فلا يمكن حفظ حد التنبيه من هنا. يُنشأ السجل
            تلقائيًّا بأول «تعبئة رصيد» من شاشة «الرسائل والتنبيهات» ← تبويب «رصيد SMS».
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">الرصيد الحالي:</span>
          <Badge variant={((query.data?.balance ?? 0) <= Number(threshold)) ? "warning" : "secondary"} className="text-base">
            {(query.data?.balance ?? 0).toLocaleString("ar-SA-u-nu-latn")} رسالة
          </Badge>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>حد التنبيه عند انخفاض الرصيد</Label>
          <Input
            type="number"
            min={0}
            className="w-40"
            disabled={readOnly}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        {!readOnly && (
          <Button
            className="self-start"
            disabled={save.isPending || rowMissing}
            onClick={() => save.mutate({ low_balance_alert_threshold: Number(threshold) || 0 })}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// القوائم المرجعية (lookup_categories / lookup_values)
// شاشة إدارية واحدة تغطي كل القوائم المشتركة (مصادر المرضى، أنواع العملاء،
// المؤهلات العلمية، الأحياء، طرق الدفع، فئات الأصناف والمصاريف، أنواع
// المستندات...) بدل بناء شاشة CRUD مستقلة لكل قائمة — ومع إمكانية إنشاء
// قائمة جديدة خاصة بالمؤسسة لتغطية ما لم يُهيَّأ مسبقًا (صناديق البيع،
// لائحة التقارير الإضافية، إلخ).
// ---------------------------------------------------------------------------
function LookupsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const categories = useQuery({
    queryKey: ["lookup_categories", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_categories")
        .select("*")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as LookupCategoryRow[];
    },
  });

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  useEffect(() => {
    if (!selectedCategoryId && categories.data && categories.data.length > 0) {
      setSelectedCategoryId(categories.data[0].id);
    }
  }, [categories.data, selectedCategoryId]);

  const selectedCategory = categories.data?.find((c) => c.id === selectedCategoryId);

  const [newCategoryName, setNewCategoryName] = useState("");
  const addCategory = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const trimmed = newCategoryName.trim();
      if (!trimmed) throw new Error("اكتب اسم القائمة");
      const key = `custom_${trimmed
        .toLowerCase()
        .replace(/[^a-z0-9أ-ي]+/gi, "_")
        .replace(/^_+|_+$/g, "")}_${Date.now().toString(36)}`;
      const { data, error } = await supabase
        .from("lookup_categories")
        .insert({ organization_id: organizationId, key, name_ar: trimmed, name_en: trimmed })
        .select()
        .single();
      if (error) throw error;
      return data as LookupCategoryRow;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["lookup_categories", organizationId] });
      setNewCategoryName("");
      setSelectedCategoryId(created.id);
      toast({ title: "تمت إضافة القائمة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>القوائم المرجعية (البيانات الأساسية)</CardTitle>
          <CardDescription>
            إدارة موحّدة لكل القوائم المستخدمة كقوائم منسدلة في شاشات النظام — مصادر المرضى، أنواع العملاء، المؤهلات
            العلمية، الأحياء، طرق الدفع، فئات الأصناف والمصاريف، أنواع المستندات، وغيرها. يمكنك أيضًا إنشاء قائمة جديدة
            خاصة بمؤسستك لأي مفهوم غير موجود بعد.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {categories.isLoading && <Skeleton className="h-10 w-64" />}
          {!categories.isLoading && (
            <div className="flex flex-col gap-1.5">
              <Label>القائمة</Label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="اختر قائمة..." />
                </SelectTrigger>
                <SelectContent>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name_ar}
                      {c.organization_id ? " (خاصة بالمؤسسة)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1.5">
                <Label>إنشاء قائمة جديدة خاصة بمؤسستك</Label>
                <Input
                  className="w-64"
                  placeholder="مثال: صناديق البيع"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
              </div>
              <Button disabled={addCategory.isPending || !newCategoryName.trim()} onClick={() => addCategory.mutate()}>
                <Plus className="h-4 w-4" />
                إنشاء القائمة
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedCategory && (
        <LookupValuesEditor
          category={selectedCategory}
          organizationId={organizationId}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/**
 * **خلل حقيقي كان قائمًا**: كل الفئات المرجعية الـ19 المزروعة عامة
 * (`organization_id is null`)، وسياسة `lookup_values_manage_admins` في 0001
 * تشترط `app_is_org_admin(c.organization_id)` — و`app_is_org_admin(null)`
 * تُعيد `false` دائمًا. أي أن **كل** إضافة أو تعطيل أو حذف لقيمة في أي فئة
 * مزروعة كانت تطابق صفرًا من الصفوف، ولا تُعيد خطأً (تحديث بلا صفوف ليس
 * خطأً في PostgREST) — فتظهر رسالة "تمت الإضافة" ولا يُحفظ شيء.
 *
 * الإصلاح يتبع التصميم المذكور في 0003 نفسه: «المؤسسة تُخصّص بإضافة قيمها
 * الخاصة عبر لائحة جديدة بنفس المفتاح ومعرّف مؤسستها». فعند أول تعديل على
 * فئة عامة تُنشأ نسخة الفئة الخاصة بالمؤسسة تلقائيًا وتُكتَب القيمة فيها.
 *
 * القيم العامة نفسها تبقى **غير قابلة للتعديل أو الحذف** — وهي مشتركة بين كل
 * المنشآت، فتعديلها يعني تعديل بيانات منشآت أخرى. الأزرار معطّلة عليها
 * بتفسير ظاهر بدل زر يبدو عاملًا ولا يفعل شيئًا.
 */
function LookupValuesEditor({
  category,
  organizationId,
  readOnly,
}: {
  category: LookupCategoryRow;
  organizationId: string | undefined;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isGlobalCategory = category.organization_id === null;

  /**
   * تُعيد معرّف فئة المؤسسة المقابلة لهذه الفئة (تُنشئها عند أول حاجة).
   * الفئة الخاصة تحمل نفس `key` — وهو ما تعتمد عليه القوائم المنسدلة في
   * تفضيل قيم المؤسسة على العامة.
   */
  const ensureOrgCategoryId = async (): Promise<string> => {
    if (!isGlobalCategory) return category.id;
    if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
    const { data: existing, error: findError } = await supabase
      .from("lookup_categories")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("key", category.key)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id;
    const { data: created, error: createError } = await supabase
      .from("lookup_categories")
      .insert({
        organization_id: organizationId,
        key: category.key,
        name_ar: category.name_ar,
        name_en: category.name_en,
      })
      .select("id")
      .single();
    if (createError) throw createError;
    return created.id;
  };
  const isPaymentMethods = category.key === "payment_methods";
  /**
   * فئات الأصناف والمصاريف شجرة (لقطة 10 / لقطة 44): `parent_value_id` موجود في
   * `lookup_values` منذ 0001 وبذرة 0003 تُنشئ "خدمات الأسنان" كأب فعليًا، لكن
   * الواجهة لم تكن تعرض الأب ولا تسمح باختياره — فكان كل ما يُضاف يصبح جذرًا.
   */
  const isHierarchical = category.key === "item_categories" || category.key === "expense_categories";

  /**
   * تُعرَض قيم الفئة العامة **وقيم فئة المؤسسة بنفس المفتاح** معًا، لأن
   * الشاشات تقرؤهما معًا بالمفتاح. عرض العامة وحدها كان سيُخفي ما أضافته
   * المؤسسة، وعرض الخاصة وحدها كان سيُخفي القيم المزروعة.
   */
  const values = useQuery({
    queryKey: ["lookup_values", category.key, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data: cats, error: catError } = await supabase
        .from("lookup_categories")
        .select("id, organization_id")
        .eq("key", category.key)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`);
      if (catError) throw catError;
      const ids = (cats ?? []).map((row: { id: string }) => row.id);
      const ownedIds = new Set(
        (cats ?? [])
          .filter((row: { organization_id: string | null }) => row.organization_id !== null)
          .map((row: { id: string }) => row.id),
      );
      if (ids.length === 0) return [] as (LookupValueRow & { editable: boolean })[];
      const { data, error } = await supabase
        .from("lookup_values")
        .select("*")
        .in("category_id", ids)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as LookupValueRow[]).map((row) => ({
        ...row,
        // قيمة في فئة عامة لا يمكن للمنشأة تعديلها — مشتركة بين كل المنشآت
        editable: ownedIds.has(row.category_id),
      })) as (LookupValueRow & { editable: boolean })[];
    },
  });

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState("none");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [iban, setIban] = useState("");
  const [commission, setCommission] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
  const [isAtm, setIsAtm] = useState(false);

  const resetForm = () => {
    setNameAr("");
    setNameEn("");
    setCode("");
    setParentId("none");
    setBankName("");
    setAccountNumber("");
    setIban("");
    setCommission("0");
    setMaxAmount("");
    setIsAtm(false);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lookup_values"] });
    queryClient.invalidateQueries({ queryKey: ["lookup-values"] });
    queryClient.invalidateQueries({ queryKey: ["lookup_categories", organizationId] });
  };

  const addValue = useMutation({
    mutationFn: async () => {
      const trimmed = nameAr.trim();
      if (!trimmed) throw new Error("اكتب اسم القيمة");
      const extra: Record<string, unknown> = {};
      if (isPaymentMethods) {
        extra.bank_name = bankName.trim() || null;
        extra.account_number = accountNumber.trim() || null;
        extra.iban = iban || null;
        extra.commission_percent = Number(commission) || 0;
        extra.max_amount = maxAmount ? Number(maxAmount) : null;
        extra.is_atm = isAtm;
      }
      const targetCategoryId = await ensureOrgCategoryId();
      const { error } = await supabase.from("lookup_values").insert({
        category_id: targetCategoryId,
        name_ar: trimmed,
        name_en: nameEn.trim() || null,
        // `code` عمود حقيقي في lookup_values منذ 0001 — يُستخدَم في التقارير
        // والترحيل المحاسبي، وكان يُترك فارغًا دائمًا لعدم وجود حقل له.
        code: code.trim() || null,
        parent_value_id: isHierarchical && parentId !== "none" ? parentId : null,
        extra,
        sort_order: (values.data?.length ?? 0) * 10 + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      resetForm();
      toast({ title: "تمت الإضافة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: errorMessage(error),
      }),
  });

  const toggleDisabled = useMutation({
    mutationFn: async (row: LookupValueRow & { editable: boolean }) => {
      if (!row.editable) throw new Error("هذه قيمة عامة مشتركة — لا يمكن تعديلها من منشأة واحدة");
      const { data, error } = await supabase
        .from("lookup_values")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST — الفحص هنا يمنع رسالة
      // نجاح كاذبة إن منعت سياسة RLS الكتابة لسبب لم نتوقّعه.
      if (!data || data.length === 0) throw new Error("لم يُحفَظ التغيير — صلاحيتك لا تسمح بتعديل هذه القيمة");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const removeValue = useMutation({
    mutationFn: async (row: LookupValueRow & { editable: boolean }) => {
      if (!row.editable) throw new Error("هذه قيمة عامة مشتركة — لا يمكن حذفها من منشأة واحدة");
      const { data, error } = await supabase
        .from("lookup_values")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("لم يُحذَف شيء — قد تكون القيمة مستخدَمة في سجلات موجودة أو خارج صلاحيتك");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description:
          errorMessage(error, "قد تكون هذه القيمة مستخدَمة في سجلات موجودة — جرّب تعطيلها بدلًا من حذفها"),
      }),
  });

  /**
   * ترتيب شجري: كل أب يتبعه أبناؤه مباشرة. الترتيب المسطّح حسب sort_order كان
   * يفرّق الابن عن أبيه فيبدو التسلسل عشوائيًا في الفئات الهرمية.
   */
  const orderedValues = (() => {
    const rows = (values.data ?? []) as (LookupValueRow & { editable: boolean })[];
    if (!isHierarchical) return rows;
    const roots = rows.filter((row) => !row.parent_value_id);
    const out: (LookupValueRow & { editable: boolean })[] = [];
    roots.forEach((root) => {
      out.push(root);
      rows.filter((row) => row.parent_value_id === root.id).forEach((child) => out.push(child));
    });
    // أبناء بلا أب مرئي (أبٌ معطّل أو محذوف) لا يجوز أن يختفوا من القائمة
    rows.filter((row) => !out.includes(row)).forEach((row) => out.push(row));
    return out;
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>قيم قائمة: {category.name_ar}</CardTitle>
        <CardDescription>
          {isPaymentMethods
            ? "لكل طريقة دفع: اسم البنك ورقم الحساب والآيبان ونسبة العمولة والحد الأقصى، وهل هي جهاز نقطة بيع"
            : "ترتيب الظهور في كل القوائم المنسدلة المرتبطة بهذه الفئة في النظام يتبع ترتيب الإضافة"}
        </CardDescription>
        {isGlobalCategory && (
          <div className="mt-2 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              الصفوف المعلَّمة «عامة» مشتركة بين كل المنشآت فلا تُعدَّل ولا تُحذف من هنا. ما تضيفه
              أنت يُحفَظ كقيمة خاصة بمنشأتك ويظهر في القوائم المنسدلة إلى جانب العامة، ويبقى
              قابلًا للتعديل والحذف.
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>الاسم بالعربي</Label>
              <Input className="w-48" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الاسم بالإنجليزي (اختياري)</Label>
              <Input className="w-48" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الكود (اختياري)</Label>
              <Input className="w-28" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
            </div>
            {isHierarchical && (
              <div className="flex flex-col gap-1.5">
                <Label>الفئة الأب</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="بلا أب (فئة رئيسية)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بلا أب (فئة رئيسية)</SelectItem>
                    {(values.data ?? [])
                      .filter((row) => !row.parent_value_id)
                      .map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name_ar}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isPaymentMethods && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>اسم البنك</Label>
                  <Input className="w-40" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم الحساب</Label>
                  <Input className="w-40" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} dir="ltr" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم الآيبان</Label>
                  <Input className="w-48" value={iban} onChange={(e) => setIban(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>نسبة العمولة %</Label>
                  <Input type="number" className="w-24" value={commission} onChange={(e) => setCommission(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>الحد الأقصى للمبلغ</Label>
                  <Input type="number" className="w-32" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
                </div>
                <ToggleRow label="جهاز نقطة بيع (ATM/POS)" checked={isAtm} disabled={false} onChange={setIsAtm} />
              </>
            )}
            <Button disabled={addValue.isPending || !nameAr.trim()} onClick={() => addValue.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        )}

        {values.isLoading && <Skeleton className="h-24 w-full" />}
        {!values.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الكود</TableHead>
                <TableHead>الحالة</TableHead>
                {isPaymentMethods && <TableHead>تفاصيل</TableHead>}
                {!readOnly && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedValues.map((row) => {
                const extra = (row.extra ?? {}) as Record<string, unknown>;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      {/* الإزاحة منطقية (ps) لا يسارية، حتى تنعكس صحيحًا في RTL */}
                      <span className={isHierarchical && row.parent_value_id ? "ps-6 text-muted-foreground" : ""}>
                        {isHierarchical && row.parent_value_id ? "↳ " : ""}
                        {row.name_ar}
                      </span>
                      {row.name_en && <span className="text-muted-foreground"> · {row.name_en}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.code ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_disabled ? "secondary" : "success"}>
                        {row.is_disabled ? "معطّلة" : "مفعّلة"}
                      </Badge>
                    </TableCell>
                    {isPaymentMethods && (
                      <TableCell className="text-xs text-muted-foreground">
                        {extra.bank_name ? `${String(extra.bank_name)}` : ""}
                        {extra.account_number ? ` · حساب: ${String(extra.account_number)}` : ""}
                        {extra.iban ? ` · آيبان: ${String(extra.iban)}` : ""}
                        {typeof extra.commission_percent === "number" && extra.commission_percent > 0
                          ? ` · عمولة ${extra.commission_percent}%`
                          : ""}
                        {extra.is_atm ? " · ATM/POS" : ""}
                      </TableCell>
                    )}
                    {!readOnly && (
                      <TableCell>
                        {row.editable ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(row)}>
                              {row.is_disabled ? "تفعيل" : "تعطيل"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removeValue.mutate(row)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">عامة</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {(values.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={isPaymentMethods ? 5 : 4} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد قيم في هذه القائمة بعد.
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

function SettingsSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// السياسات التشغيلية وأوقات العمل — المرحلة 27
//
// كل رقم هنا كان مثبَّتًا في الشيفرة: مهلة الإقرار بالقيمة الحرجة، وحدّ طلبات
// المواعيد، ومهلة تنبيه انتهاء المستندات. صار كلٌّ منها سياسةً **تقرؤها
// الدوال نفسها** — وفحصٌ ذاتيّ في الهجرة يفشل إن أُضيفت سياسة لا يقرؤها أحد.
// ---------------------------------------------------------------------------
function PoliciesTab({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const editable = can("policies.manage");

  const [draft, setDraft] = useState<Record<string, any>>({});
  const [newDay, setNewDay] = useState("0");
  const [opens, setOpens] = useState("08:00");
  const [closes, setCloses] = useState("16:00");
  const [branchId, setBranchId] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");

  const policy = useQuery({
    queryKey: ["org-policies", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_policies").select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const branches = useQuery({
    queryKey: ["policy-branches", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name")
        .eq("organization_id", organizationId).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const schedule = useQuery({
    queryKey: ["branch-schedule", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_branch_schedule").select("*")
        .eq("organization_id", organizationId)
        .order("branch_name").order("weekday");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const holidays = useQuery({
    queryKey: ["org-holidays", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_holidays").select("*")
        .eq("organization_id", organizationId)
        .order("holiday_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive", title,
      description: errorMessage(error, "خطأ غير متوقع"),
    });

  const save = useMutation({
    mutationFn: async (changes: Record<string, any>) => {
      const { error } = await supabase.rpc("app_save_org_policies", {
        p_org: organizationId, p_changes: changes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-policies", organizationId] });
      setDraft({});
      toast({ title: "حُفظت السياسات وسرت على النظام فورًا" });
    },
    onError: fail("تعذر الحفظ"),
  });

  const addHours = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("branch_working_hours").insert({
        organization_id: organizationId,
        branch_id: branchId,
        weekday: Number(newDay),
        opens_at: opens,
        closes_at: closes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-schedule", organizationId] });
      toast({ title: "أُضيفت فترة الدوام" });
    },
    onError: fail("تعذرت الإضافة"),
  });

  const toggleHours = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("branch_working_hours").update({ is_active: active })
        .eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-schedule", organizationId] });
    },
    onError: fail("تعذر التحديث"),
  });

  const addHoliday = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organization_holidays").insert({
        organization_id: organizationId,
        branch_id: branchId || null,
        holiday_date: holidayDate,
        name_ar: holidayName.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-holidays", organizationId] });
      setHolidayDate(""); setHolidayName("");
      toast({ title: "أُضيفت العطلة" });
    },
    onError: fail("تعذرت الإضافة"),
  });

  const p = policy.data;
  const val = (key: string) => (draft[key] !== undefined ? draft[key] : p?.[key] ?? "");
  const set = (key: string, value: any) => setDraft((d) => ({ ...d, [key]: value }));

  const NUMBERS: { key: string; label: string; hint: string }[] = [
    {
      key: "critical_ack_minutes",
      label: "مهلة الإقرار بالقيمة الحرجة (دقيقة)",
      hint: "بعدها يُصعَّد البلاغ إلى من يتابع القيم الحرجة",
    },
    {
      key: "portal_open_requests_limit",
      label: "حدّ طلبات المواعيد المفتوحة لكل مريض",
      hint: "بابٌ مفتوح بلا حدّ يُغرق الاستقبال",
    },
    {
      key: "portal_cancel_cutoff_hours",
      label: "إقفال الإلغاء من البوابة قبل الموعد (ساعة)",
      hint: "صفر يعني السماح بالإلغاء حتى لحظة الموعد",
    },
    {
      key: "document_expiry_notice_days",
      label: "التنبيه قبل انتهاء المستند (يوم)",
      hint: "يُستعمل عند توليد تنبيهات الانتهاء",
    },
    {
      key: "visit_open_alert_days",
      label: "الزيارة تُعدّ متأخّرة بعد (يوم)",
      hint: "لتمييز الزيارات المفتوحة في مساحة عمل الطبيب",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">السياسات التشغيلية</CardTitle>
          <CardDescription>
            هذه الأرقام كانت مثبَّتة في الشيفرة، وصارت **تُقرأ من هنا فعليًّا**:
            تغييرها يغيّر سلوك النظام في اللحظة نفسها.
            {p && !p.is_customized && " — المنشأة تعمل الآن على الافتراضات."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {policy.isLoading && <Skeleton className="h-40 w-full" />}
          {!policy.isLoading && p && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {NUMBERS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <Label>{f.label}</Label>
                    <Input
                      type="number"
                      disabled={!editable}
                      value={val(f.key)}
                      onChange={(e) => set(f.key, Number(e.target.value))}
                    />
                    <span className="text-[10px] text-muted-foreground">{f.hint}</span>
                  </div>
                ))}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!editable}
                  checked={Boolean(val("enforce_working_hours"))}
                  onChange={(e) => set("enforce_working_hours", e.target.checked)}
                />
                فرض أوقات عمل الفروع والعطل على الحجز
              </label>
              <span className="-mt-2 text-[10px] text-muted-foreground">
                معطَّل افتراضًا: تفعيله يمنع أيّ حجز خارج جدول الفرع أو في يوم عطلة،
                فلا تفعّله قبل إدخال جداول فروعك أدناه.
              </span>

              {editable && (
                <Button
                  className="self-start"
                  disabled={Object.keys(draft).length === 0 || save.isPending}
                  onClick={() => save.mutate(draft)}
                >
                  حفظ السياسات
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">أوقات عمل الفروع</CardTitle>
          <CardDescription>
            فترة أو أكثر لكل يوم. الفرع بلا جدول لا يُقيَّد — القيد يأتي من
            جدولٍ موضوع لا من فراغه.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex w-44 flex-col gap-1.5">
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
              <div className="flex w-32 flex-col gap-1.5">
                <Label>اليوم</Label>
                <Select value={newDay} onValueChange={setNewDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]
                      .map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-28 flex-col gap-1.5">
                <Label>من</Label>
                <Input type="time" value={opens} onChange={(e) => setOpens(e.target.value)} />
              </div>
              <div className="flex w-28 flex-col gap-1.5">
                <Label>إلى</Label>
                <Input type="time" value={closes} onChange={(e) => setCloses(e.target.value)} />
              </div>
              <Button disabled={!branchId || addHours.isPending}
                      onClick={() => addHours.mutate()}>
                إضافة
              </Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفرع</TableHead>
                  <TableHead>اليوم</TableHead>
                  <TableHead>من</TableHead>
                  <TableHead>إلى</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schedule.data ?? []).map((w) => (
                  <TableRow key={w.id} className={w.is_active ? undefined : "opacity-60"}>
                    <TableCell className="text-sm">{w.branch_name}</TableCell>
                    <TableCell className="text-sm">{w.weekday_name}</TableCell>
                    <TableCell className="font-mono text-xs">{w.opens_at}</TableCell>
                    <TableCell className="font-mono text-xs">{w.closes_at}</TableCell>
                    <TableCell>
                      <Badge variant={w.is_active ? "success" : "secondary"}>
                        {w.is_active ? "نشطة" : "معطَّلة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {editable && (
                        <Button size="sm" variant="ghost" disabled={toggleHours.isPending}
                                onClick={() => toggleHours.mutate({ id: w.id, active: !w.is_active })}>
                          {w.is_active ? "تعطيل" : "تفعيل"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(schedule.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      لا جداول دوام — الفروع غير مقيَّدة بأوقات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">العطل الرسمية</CardTitle>
          <CardDescription>
            العطلة تمنع الحجز ولو كان داخل ساعات العمل (عند تفعيل الفرض).
            اتركها بلا فرع لتشمل المنشأة كلها.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex w-40 flex-col gap-1.5">
                <Label>التاريخ</Label>
                <Input type="date" value={holidayDate}
                       onChange={(e) => setHolidayDate(e.target.value)} />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label>المناسبة</Label>
                <Input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              </div>
              <Button disabled={!holidayDate || !holidayName.trim() || addHoliday.isPending}
                      onClick={() => addHoliday.mutate()}>
                إضافة
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المناسبة</TableHead>
                  <TableHead>النطاق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(holidays.data ?? []).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">{h.holiday_date}</TableCell>
                    <TableCell className="text-sm">{h.name_ar}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {h.branch_id
                        ? (branches.data ?? []).find((b) => b.id === h.branch_id)?.name ?? "فرع"
                        : "المنشأة كلها"}
                    </TableCell>
                  </TableRow>
                ))}
                {(holidays.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      لا عطل مسجّلة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// اللغة والبلد ودعم الخليج — المرحلة 29
//
// «لغة عرض البيانات» لا «لغة النظام»: ما يتغيّر هو أسماء الخدمات والفحوص
// والفروع وتنسيق التواريخ والعملة. نصوص الواجهة تبقى عربية في هذه المرحلة،
// وتسميته «لغة النظام» وعدٌ لا يُنفَّذ.
// ---------------------------------------------------------------------------
function LocaleTab({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const editable = can("policies.manage");
  const [draft, setDraft] = useState<Record<string, any>>({});

  const settings = useQuery({
    queryKey: ["locale-settings-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_locale_settings").select("*")
        .eq("organization_id", organizationId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const coverage = useQuery({
    queryKey: ["translation-coverage", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_translation_coverage").select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_save_locale_settings", {
        p_org: organizationId, p_changes: draft,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locale-settings-admin", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["locale-settings", organizationId] });
      setDraft({});
      toast({ title: "حُفظت إعدادات اللغة والبلد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const s = settings.data;
  const val = (k: string) => (draft[k] !== undefined ? draft[k] : s?.[k] ?? "");
  const set = (k: string, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  const COUNTRIES: Record<string, string> = {
    SA: "السعودية", AE: "الإمارات", KW: "الكويت",
    QA: "قطر", BH: "البحرين", OM: "عُمان",
  };
  const ENTITIES: Record<string, string> = {
    items: "الخدمات والأصناف",
    lab_tests: "فحوص المختبر",
    radiology_exams: "فحوص الأشعة",
    clinics: "العيادات",
    doctors: "الأطباء",
  };

  const totalMissing = (coverage.data ?? []).reduce(
    (sum, r) => sum + Number(r.missing_en ?? 0), 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">اللغة والبلد</CardTitle>
          <CardDescription>
            البلد يحدّد العملة ونسبة الضريبة المقترحة وصيغة رقم الهوية والهاتف.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settings.isLoading && <Skeleton className="h-32 w-full" />}
          {!settings.isLoading && s && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>الدولة</Label>
                  <Select value={String(val("country_code"))} disabled={!editable}
                          onValueChange={(v) => set("country_code", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(COUNTRIES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">
                    الضريبة المقترحة لهذه الدولة: {s.country_default_vat}% · مفتاح الهاتف{" "}
                    {s.phone_prefix}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>العملة</Label>
                  <Select value={String(val("currency_code"))} disabled={!editable}
                          onValueChange={(v) => set("currency_code", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["SAR","AED","KWD","QAR","BHD","OMR"].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>لغة عرض البيانات</Label>
                  <Select value={String(val("data_language"))} disabled={!editable}
                          onValueChange={(v) => set("data_language", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ar">العربية</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">
                    تغيّر أسماء الخدمات والفحوص والفروع وتنسيق الأرقام — **نصوص
                    الواجهة تبقى عربية في هذه المرحلة**
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>التقويم المعروض — غير مُطبَّق بعد</Label>
                  <Select value={String(val("calendar_display"))} disabled={!editable}
                          onValueChange={(v) => set("calendar_display", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gregorian">ميلادي</SelectItem>
                      <SelectItem value="hijri">هجري (أم القرى)</SelectItem>
                      <SelectItem value="both">كلاهما</SelectItem>
                    </SelectContent>
                  </Select>
                  {/*
                    `calendarDisplay` يُخرَج في `client/lib/locale.ts` ولا يستهلكه أي
                    مكوّن: كل التواريخ مكتوبة بـ `toLocaleDateString("ar-SA-u-nu-latn")` مباشرةً.
                    فاختيار «هجري» كان يُظهر رسالة نجاح ولا يغيّر تاريخًا واحدًا.
                  */}
                  <span className="text-[10px] font-medium text-amber-700">
                    الاختيار يُحفظ ولا يُطبَّق بعد: كل التواريخ في الشاشات تُعرض ميلاديًّا حتى
                    تُوحَّد دالّة عرض التاريخ في النظام.
                  </span>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" disabled={!editable}
                       checked={Boolean(val("enforce_id_validation"))}
                       onChange={(e) => set("enforce_id_validation", e.target.checked)} />
                فرض التحقّق من رقم الهوية عند فتح الملفات
              </label>
              <span className="-mt-2 text-[10px] text-muted-foreground">
                للسعودية تحقّق حقيقيّ برقم التحقّق؛ ولبقيّة الدول فحص الطول فقط.
                التفعيل يُرفض ما دامت في ملفاتك أرقام لا تجتازه — الرسالة تخبرك بعددها.
              </span>

              {editable && (
                <Button className="self-start"
                        disabled={Object.keys(draft).length === 0 || save.isPending}
                        onClick={() => save.mutate()}>
                  حفظ
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">تغطية الترجمة</CardTitle>
          <CardDescription>
            قبل تشغيل لغة عرض البيانات بالإنجليزية: ما ينقصه الاسم الإنجليزي
            يُعرض بالعربية بدل أن يظهر فارغًا.
            {totalMissing > 0 && ` — ينقص ${totalMissing} اسمًا.`}
            {/* الجدول تقريرُ تغطية صحيح، لكن الاستهلاك الفعلي محدود: اختيار
                الاسم بحسب اللغة يُستدعى في نافذة اختيار الصنف وحدها. */}
            <span className="mt-1 block font-medium text-amber-700">
              لغة عرض البيانات تُطبَّق حاليًّا على أسماء الخدمات والأصناف فقط (نافذة اختيار
              الصنف والتحليلات). العيادات والأطباء وفحوص المختبر والأشعة تُعرض بالعربية حتى
              تُوصَل بها.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {coverage.isLoading && <Skeleton className="h-24 w-full" />}
          {!coverage.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكتالوج</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>ينقصه الإنجليزي</TableHead>
                  <TableHead>التغطية</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(coverage.data ?? []).map((r) => {
                  const total = Number(r.total ?? 0);
                  const missing = Number(r.missing_en ?? 0);
                  const pct = total === 0 ? 100 : Math.round(((total - missing) / total) * 100);
                  return (
                    <TableRow key={r.entity}>
                      <TableCell className="text-sm">{ENTITIES[r.entity] ?? r.entity}</TableCell>
                      <TableCell className="font-mono text-xs">{total}</TableCell>
                      <TableCell className="font-mono text-xs">{missing}</TableCell>
                      <TableCell>
                        <Badge variant={pct === 100 ? "success" : pct >= 50 ? "default" : "destructive"}>
                          {pct}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(coverage.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      لا كتالوجات بعد.
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
