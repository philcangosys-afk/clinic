import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, PackageCheck, Pencil, Plus, Truck, Upload } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PurchaseCycle from "@/components/purchasing/PurchaseCycle";
import { useToast } from "@/hooks/use-toast";
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";
import LookupSelect from "@/components/shared/LookupSelect";
import { errorMessage } from "@/lib/error-message";

/** حقول المورد التي يقرأها/يكتبها النموذج (إنشاء وتعديل). */
export type DistributorEditRow = {
  id: string;
  name_ar: string;
  name_en: string | null;
  sales_rep_name: string | null;
  sales_rep_mobile: string | null;
  lab_technician_name: string | null;
  lab_technician_mobile: string | null;
  nationality_value_id: string | null;
  id_number: string | null;
  tax_number: string | null;
  gln_number: string | null;
  mobile_1: string | null;
  mobile_2: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email_1: string | null;
  email_2: string | null;
  fax: string | null;
  city_value_id: string | null;
  address: string | null;
  note: string | null;
  distributor_type_value_id: string | null;
  legal_name: string | null;
  commercial_register: string | null;
  bank_name: string | null;
  bank_iban: string | null;
  bank_account_name: string | null;
  payment_terms_days: number;
  credit_limit: number | null;
  allowed_branch_ids: string[] | null;
  is_dental_lab: boolean;
  is_disabled: boolean;
};

export default function Procurement() {
  /**
   * التبويبات مُدارة بالحالة لا `defaultValue` وحده.
   *
   * كان في الشاشة **مسارَان متوازيان يُدخلان بضاعة الشراء نفسها إلى المخزون**:
   * نافذة «فاتورة شراء جديدة» هنا كانت تكتب بنفسها `inventory_lots` و
   * `inventory_movements` من نوع `purchase_in`، بينما مستند الاستلام في «دورة
   * الشراء» يفعل ذلك عبر `app_post_goods_receipt`. أي بضاعةٍ سُجّلت في المسارين
   * تدخل المخزون **مرّتين**، ولا يرتبط استلام المسار المباشر بأمر شراء ولا
   * بتشغيلة ولا تصله التكلفة الواصلة ولا يقبل مرتجعًا.
   *
   * المسار الوحيد للاستلام صار مستند الاستلام. وحتى يكون ذلك عمليًّا لا مجرّد
   * نصّ، الزرّ في تبويب الفواتير ينقل المستخدم إلى «دورة الشراء ← أوامر الشراء
   * والاستلام» — وهذا يقتضي التحكّم في التبويب الخارجي والداخلي معًا.
   */
  const [tab, setTab] = useState("invoices");
  const [cycleTab, setCycleTab] = useState("requests");

  const goToReceiving = () => {
    setCycleTab("orders");
    setTab("cycle");
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المشتريات والموردون</h1>
        <p className="text-sm text-muted-foreground">
          إدارة الموردين والمشتريات — البضاعة تدخل المخزون بمستند استلام في «دورة الشراء»، وفاتورة
          المورد تُبنى على المستند المرحَّل
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cycle">دورة الشراء</TabsTrigger>
          <TabsTrigger value="invoices">فواتير الشراء</TabsTrigger>
          <TabsTrigger value="distributors">الموردون</TabsTrigger>
        </TabsList>
        <TabsContent value="cycle" className="mt-4">
          <PurchaseCycle tab={cycleTab} onTabChange={setCycleTab} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <PurchaseInvoicesTab onGoToReceiving={goToReceiving} />
        </TabsContent>
        <TabsContent value="distributors" className="mt-4">
          <DistributorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الموردون
// ---------------------------------------------------------------------------
function useDistributors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["distributors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, file_number, name_ar, name_en, sales_rep_name, sales_rep_mobile, lab_technician_name, lab_technician_mobile, nationality_value_id, id_number, tax_number, gln_number, mobile_1, mobile_2, phone_1, phone_2, email_1, email_2, fax, city_value_id, address, note, distributor_type_value_id, legal_name, commercial_register, bank_name, bank_iban, bank_account_name, payment_terms_days, credit_limit, allowed_branch_ids, is_dental_lab, is_disabled")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as unknown as (DistributorEditRow & { file_number: number })[];
    },
  });
}

function DistributorsTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const distributors = useDistributors(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<DistributorEditRow | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: async (row: DistributorEditRow) => {
      const { data: affectedRows, error } = await supabase
        .from("distributors")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributors", organization?.id] });
      toast({ title: "تم تحديث حالة المورد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>الموردون</CardTitle>
          <CardDescription>تشمل موزعي الأدوية ومعامل الأسنان وموردي المستلزمات</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            استيراد
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            مورد جديد
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {distributors.isLoading && <Skeleton className="h-40 w-full" />}
        {!distributors.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#الملف</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الاسم الإنجليزي</TableHead>
                <TableHead>المندوب</TableHead>
                <TableHead>الفني</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>الرقم الضريبي</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-28">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(distributors.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">#{d.file_number}</TableCell>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    {d.name_ar}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.name_en ?? "—"}</TableCell>
                  <TableCell>{d.sales_rep_name ?? "—"}</TableCell>
                  <TableCell>{d.lab_technician_name ?? "—"}</TableCell>
                  <TableCell>{d.mobile_1 ?? "—"}</TableCell>
                  <TableCell>{d.tax_number ?? "—"}</TableCell>
                  <TableCell>{d.is_dental_lab ? <Badge variant="default">معمل أسنان</Badge> : "مورد عام"}</TableCell>
                  <TableCell>
                    <Badge variant={d.is_disabled ? "secondary" : "success"}>{d.is_disabled ? "معطّل" : "نشط"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="تعديل"
                        onClick={() => {
                          setEditing(d);
                          setCreateOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleDisabled.mutate(d)}>
                        {d.is_disabled ? "تفعيل" : "تعطيل"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(distributors.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    لا يوجد موردون بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {createOpen && (
        <NewDistributorDialog
          key={editing?.id ?? "new"}
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) setEditing(null);
          }}
          organizationId={organization?.id}
          initial={editing}
        />
      )}

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        table="distributors"
        title="استيراد موردين من ملف CSV"
        invalidateKey="distributors"
        fixedValues={{ organization_id: organization?.id }}
        columns={DISTRIBUTOR_IMPORT_COLUMNS}
      />
    </Card>
  );
}

/**
 * أعمدة استيراد الموردين. `file_number` غير مشمول: قيمته من متتالية في
 * القاعدة، واستيراد أرقام يدوية يصطدم بها لاحقًا.
 */
const DISTRIBUTOR_IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name_ar", header: "الاسم", required: true },
  { key: "name_en", header: "الاسم بالإنجليزي" },
  { key: "mobile_1", header: "الجوال" },
  { key: "phone_1", header: "الهاتف" },
  { key: "email_1", header: "البريد الإلكتروني" },
  { key: "tax_number", header: "الرقم الضريبي" },
  { key: "id_number", header: "رقم الهوية/السجل" },
  { key: "address", header: "العنوان" },
  { key: "sales_rep_name", header: "اسم المندوب" },
  { key: "sales_rep_mobile", header: "جوال المندوب" },
  {
    key: "is_dental_lab",
    header: "معمل أسنان",
    parse: (raw) => {
      const value = raw.trim();
      if (["نعم", "yes", "true", "1"].includes(value.toLowerCase())) return true;
      if (["لا", "no", "false", "0"].includes(value.toLowerCase())) return false;
      throw new Error("القيمة يجب أن تكون: نعم أو لا");
    },
  },
  { key: "note", header: "ملاحظة" },
];

function NewDistributorDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** عند تمريره تتحول النافذة لوضع التعديل. */
  initial?: DistributorEditRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [salesRepName, setSalesRepName] = useState(initial?.sales_rep_name ?? "");
  const [salesRepMobile, setSalesRepMobile] = useState(initial?.sales_rep_mobile ?? "");
  // اسم الفني وجواله — عمودان في جدول distributors منذ 0003 بلا حقل إدخال،
  // فلم يكن ممكنًا تسجيل فني معمل الأسنان إطلاقًا (لقطة 53).
  const [labTechnicianName, setLabTechnicianName] = useState(initial?.lab_technician_name ?? "");
  const [labTechnicianMobile, setLabTechnicianMobile] = useState(initial?.lab_technician_mobile ?? "");
  const [nationalityId, setNationalityId] = useState(initial?.nationality_value_id ?? "");
  const [idNumber, setIdNumber] = useState(initial?.id_number ?? "");
  const [taxNumber, setTaxNumber] = useState(initial?.tax_number ?? "");
  const [glnNumber, setGlnNumber] = useState(initial?.gln_number ?? "");
  const [mobile, setMobile] = useState(initial?.mobile_1 ?? "");
  const [phone, setPhone] = useState(initial?.phone_1 ?? "");
  const [email, setEmail] = useState(initial?.email_1 ?? "");
  // أرقام واتصالات ثانية + الفاكس — أعمدة في distributors منذ 0003 بلا إدخال
  const [mobile2, setMobile2] = useState(initial?.mobile_2 ?? "");
  const [phone2, setPhone2] = useState(initial?.phone_2 ?? "");
  const [email2, setEmail2] = useState(initial?.email_2 ?? "");
  const [fax, setFax] = useState(initial?.fax ?? "");
  const [cityId, setCityId] = useState(initial?.city_value_id ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [typeValueId, setTypeValueId] = useState(initial?.distributor_type_value_id ?? "");
  const [isDentalLab, setIsDentalLab] = useState(Boolean(initial?.is_dental_lab));
  const [legalName, setLegalName] = useState(initial?.legal_name ?? "");
  const [commercialRegister, setCommercialRegister] = useState(initial?.commercial_register ?? "");
  const [bankName, setBankName] = useState(initial?.bank_name ?? "");
  const [bankIban, setBankIban] = useState(initial?.bank_iban ?? "");
  const [bankAccountName, setBankAccountName] = useState(initial?.bank_account_name ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    String(initial?.payment_terms_days ?? 0),
  );
  const [creditLimit, setCreditLimit] = useState(
    initial?.credit_limit != null ? String(initial.credit_limit) : "",
  );
  const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>(
    initial?.allowed_branch_ids ?? [],
  );
  const supplierBranches = useQuery({
    queryKey: ["supplier-branches", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name")
        .eq("organization_id", organizationId).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const resetForm = () => {
    setNameAr("");
    setNameEn("");
    setSalesRepName("");
    setSalesRepMobile("");
    setMobile2("");
    setPhone2("");
    setEmail2("");
    setFax("");
    setLabTechnicianName("");
    setLabTechnicianMobile("");
    setNationalityId("");
    setIdNumber("");
    setTaxNumber("");
    setGlnNumber("");
    setMobile("");
    setPhone("");
    setEmail("");
    setCityId("");
    setAddress("");
    setNote("");
    setTypeValueId("");
    setIsDentalLab(false);
    setLegalName("");
    setCommercialRegister("");
    setBankName("");
    setBankIban("");
    setBankAccountName("");
    setPaymentTermsDays("0");
    setCreditLimit("");
    setAllowedBranchIds([]);
  };

  const createDistributor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const payload = {
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        sales_rep_name: salesRepName.trim() || null,
        sales_rep_mobile: salesRepMobile.trim() || null,
        nationality_value_id: nationalityId || null,
        id_number: idNumber.trim() || null,
        tax_number: taxNumber.trim() || null,
        gln_number: glnNumber.trim() || null,
        mobile_1: mobile.trim() || null,
        mobile_2: mobile2.trim() || null,
        phone_1: phone.trim() || null,
        phone_2: phone2.trim() || null,
        email_1: email.trim() || null,
        email_2: email2.trim() || null,
        fax: fax.trim() || null,
        city_value_id: cityId || null,
        address: address.trim() || null,
        note: note.trim() || null,
        distributor_type_value_id: typeValueId || null,
        is_dental_lab: isDentalLab,
        lab_technician_name: labTechnicianName.trim() || null,
        lab_technician_mobile: labTechnicianMobile.trim() || null,
        legal_name: legalName.trim() || null,
        commercial_register: commercialRegister.trim() || null,
        bank_name: bankName.trim() || null,
        bank_iban: bankIban.trim() || null,
        bank_account_name: bankAccountName.trim() || null,
        // المهلة تُشتقّ منها تواريخ الاستحقاق، فلا يُحسب التأخير بالتقدير
        payment_terms_days: Number(paymentTermsDays) || 0,
        credit_limit: creditLimit ? Number(creditLimit) : null,
        allowed_branch_ids: allowedBranchIds.length > 0 ? allowedBranchIds : null,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("distributors").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("distributors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributors", organizationId] });
      toast({ title: initial ? "تم تحديث المورد" : "تم حفظ المورد" });
      if (!initial) resetForm();
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل المورد" : "مورد جديد"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الاسم بالعربية *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم القانوني</Label>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السجل التجاري</Label>
            <Input value={commercialRegister}
                   onChange={(e) => setCommercialRegister(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مهلة السداد (أيام)</Label>
            <Input type="number" min={0} value={paymentTermsDays}
                   onChange={(e) => setPaymentTermsDays(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حدّ الائتمان</Label>
            <Input type="number" min={0} value={creditLimit}
                   onChange={(e) => setCreditLimit(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البنك</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم صاحب الحساب</Label>
            <Input value={bankAccountName}
                   onChange={(e) => setBankAccountName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الآيبان</Label>
            <Input value={bankIban} onChange={(e) => setBankIban(e.target.value)}
                   placeholder="SA..." />
            <p className="text-xs text-muted-foreground">
              بيانات تحويلٍ فقط. لا تُحفظ هنا أي بيانات دخول أو مفاتيح.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الفروع التي يتعامل معها (اتركها فارغة للجميع)</Label>
            <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
              {(supplierBranches.data ?? []).map((b: any) => {
                const checked = allowedBranchIds.includes(b.id);
                return (
                  <button key={b.id} type="button"
                          onClick={() => setAllowedBranchIds((ids) =>
                            checked ? ids.filter((x) => x !== b.id) : [...ids, b.id])}>
                    <Badge variant={checked ? "success" : "outline"}>{b.name}</Badge>
                  </button>
                );
              })}
              {(supplierBranches.data ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">لا فروع مسجّلة.</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع المورد</Label>
            <LookupSelect categoryKey="distributor_types" value={typeValueId} onChange={setTypeValueId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم المندوب</Label>
            <Input value={salesRepName} onChange={(e) => setSalesRepName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>جوال المندوب</Label>
            <Input value={salesRepMobile} onChange={(e) => setSalesRepMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم الفني (لمعامل الأسنان)</Label>
            <Input value={labTechnicianName} onChange={(e) => setLabTechnicianName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>جوال الفني</Label>
            <Input value={labTechnicianMobile} onChange={(e) => setLabTechnicianMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنسية</Label>
            <LookupSelect categoryKey="nationalities" value={nationalityId} onChange={setNationalityId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهوية</Label>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الرقم الضريبي</Label>
            <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>GLN</Label>
            <Input value={glnNumber} onChange={(e) => setGlnNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>هاتف</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>جوال 2</Label>
            <Input value={mobile2} onChange={(e) => setMobile2(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>هاتف 2</Label>
            <Input value={phone2} onChange={(e) => setPhone2(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>بريد إلكتروني 2</Label>
            <Input value={email2} onChange={(e) => setEmail2(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفاكس</Label>
            <Input value={fax} onChange={(e) => setFax(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المدينة</Label>
            <LookupSelect categoryKey="cities" value={cityId} onChange={setCityId} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={isDentalLab} onChange={(e) => setIsDentalLab(e.target.checked)} />
            معمل أسنان
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createDistributor.isPending} onClick={() => createDistributor.mutate()}>
            {createDistributor.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// فواتير الشراء
// ---------------------------------------------------------------------------
function usePurchaseInvoices(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_date, payment_term, net_amount, goods_receipt_id, distributor:distributors(name_ar)")
        .eq("organization_id", organizationId)
        .order("invoice_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * تبويب فواتير الشراء — **قراءة وسجلّ، لا إدخال مخزون**.
 *
 * كان هنا زرّ «فاتورة شراء جديدة» يفتح نافذةً تكتب — بخطوات غير ذرّية من
 * المتصفّح — رأس الفاتورة وبنودها ثم `inventory_lots` و`inventory_movements`
 * من نوع `purchase_in`. وهذا مسارٌ ثانٍ لإدخال بضاعة الشراء إلى المخزون
 * موازٍ لمستند الاستلام في «دورة الشراء»:
 *
 *   • البضاعة التي تُسجَّل في المسارين تدخل المخزون **مرّتين**، وقيمة المخزون
 *     تتضخّم بمقدارها — ولا شيء في القاعدة يمنع ذلك لأن كلا المسارين «صحيح»
 *     كلٌّ على حدة.
 *   • استلام المسار المباشر لا يرتبط بأمر شراء، فلا يُنقِص «ما طُلب ولم يصل»،
 *     ولا يقبل مرتجع شراء (المرتجع يُبنى على بنود مستند استلام)، ولا تصله
 *     التكلفة الواصلة، ولا يمرّ باعتماد الاستلام الزائد.
 *   • وانقطاعُ التنفيذ في منتصف الحلقة (خطأ في بندٍ بعد ترحيل بنود قبله) كان
 *     يترك فاتورةً ببعض بنودها ومخزونًا نصفيًّا بلا أي تراجع.
 *
 * فأُزيل المسار المباشر، وصار الزرّ ينقل إلى «دورة الشراء ← أوامر الشراء
 * والاستلام». الفواتير المسجَّلة سابقًا **تبقى كما هي** ويبقى مخزونها — لا
 * يُحذف شيء، والجدول أدناه يُبيّن أيّها مبنيّ على مستند استلام وأيّها من
 * المسار المباشر القديم.
 */
function PurchaseInvoicesTab({ onGoToReceiving }: { onGoToReceiving: () => void }) {
  const { organization } = useOrganizationAccess();
  const invoices = usePurchaseInvoices(organization?.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>فواتير الشراء</CardTitle>
          <CardDescription>
            سجلّ فواتير المورد. الفاتورة تُسجَّل على <strong>مستند استلام مرحَّل</strong> من «دورة
            الشراء» — البضاعة تدخل المخزون بالاستلام لا بالفاتورة.
          </CardDescription>
        </div>
        <Button size="sm" onClick={onGoToReceiving}>
          <PackageCheck className="h-4 w-4" />
          استلام بضاعة
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">أين تُستلم البضاعة؟</p>
          <p className="mt-1">
            من تبويب <strong>«دورة الشراء» ← «أوامر الشراء والاستلام»</strong>: اختر أمر الشراء ثم
            «استلام» فيُنشأ مستند استلام بكمّياته وتشغيلاته وتواريخ صلاحيتها، ويُرحَّل فيدخل المخزون
            مرّة واحدة. ثم «تسجيل الفاتورة» على المستند المرحَّل من البطاقة نفسها.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={onGoToReceiving}>
            <PackageCheck className="h-3.5 w-3.5" />
            انتقل إلى الاستلام
          </Button>
        </div>
        {invoices.isLoading && <Skeleton className="h-40 w-full" />}
        {!invoices.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>طريقة السداد</TableHead>
                <TableHead>الصافي</TableHead>
                <TableHead>المصدر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices.data ?? []).map((inv) => {
                const distributor = Array.isArray(inv.distributor) ? inv.distributor[0] : inv.distributor;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.invoice_number ?? "—"}</TableCell>
                    <TableCell>{inv.invoice_date}</TableCell>
                    <TableCell className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {distributor?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell>{inv.payment_term === "credit" ? "آجل" : "نقدي"}</TableCell>
                    <TableCell>{Number(inv.net_amount).toLocaleString("ar-SA")} ر.س</TableCell>
                    <TableCell>
                      {/* بلا هذا العمود لا يعرف المدقّق أيّ الفواتير مخزونها من مستند
                          استلام وأيّها من المسار المباشر القديم. */}
                      {inv.goods_receipt_id ? (
                        <Badge variant="success">مستند استلام</Badge>
                      ) : (
                        <Badge variant="outline">إدخال مباشر (سابق)</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(invoices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد فواتير شراء بعد — استلم البضاعة أوّلًا ثم سجّل فاتورة المورد على مستند
                    الاستلام.
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
