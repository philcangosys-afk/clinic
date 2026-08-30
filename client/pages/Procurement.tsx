import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Truck, Upload, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { PurchasePaymentTerm } from "@/lib/database.types";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";
import LookupSelect from "@/components/shared/LookupSelect";
import ItemPicker from "@/components/shared/ItemPicker";

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
  is_dental_lab: boolean;
  is_disabled: boolean;
};

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

export default function Procurement() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المشتريات والموردون</h1>
        <p className="text-sm text-muted-foreground">إدارة الموردين وفواتير الشراء — كل فاتورة شراء تُنشئ تلقائيًا دفعة مخزون وحركة استلام</p>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">فواتير الشراء</TabsTrigger>
          <TabsTrigger value="distributors">الموردون</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="mt-4">
          <PurchaseInvoicesTab />
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
        .select("id, file_number, name_ar, name_en, sales_rep_name, sales_rep_mobile, lab_technician_name, lab_technician_mobile, nationality_value_id, id_number, tax_number, gln_number, mobile_1, mobile_2, phone_1, phone_2, email_1, email_2, fax, city_value_id, address, note, distributor_type_value_id, is_dental_lab, is_disabled")
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
        .select("id, invoice_number, invoice_date, payment_term, net_amount, distributor:distributors(name_ar)")
        .eq("organization_id", organizationId)
        .order("invoice_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function PurchaseInvoicesTab() {
  const { organization } = useOrganizationAccess();
  const invoices = usePurchaseInvoices(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>فواتير الشراء</CardTitle>
          <CardDescription>حفظ الفاتورة يُنشئ تلقائيًا دفعة مخزون (Lot) وحركة استلام (purchase_in) لكل بند</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          فاتورة شراء جديدة
        </Button>
      </CardHeader>
      <CardContent>
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
                  </TableRow>
                );
              })}
              {(invoices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد فواتير شراء بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewPurchaseInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

/** بند فاتورة شراء — يشمل الحقول التي كانت في الجدول ولا تُدخل من الواجهة. */
type PurchaseLine = {
  itemId: string;
  name: string;
  qty: string;
  price: string;
  expiryDate: string;
  freeQty: string;
  discountPercent: string;
  salePrice: string;
  updateSalePrice: boolean;
  barcode: string;
  lotNumber: string;
};

function NewPurchaseInvoiceDialog({
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
  const distributors = useDistributors(organizationId);
  const warehouses = useWarehousesList(organizationId);
  const [distributorId, setDistributorId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentTerm, setPaymentTerm] = useState<PurchasePaymentTerm>("cash");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const { organization } = useOrganizationAccess();
  // نسبة الضريبة من إعداد المنشأة لا 15 ثابتة — منشأة معفاة تضع 0، وشاشة
  // الفوترة تقرأ هذا الإعداد فعلًا فكانت المشتريات وحدها تخالفه.
  const orgVatRate = Number(organization?.default_vat_rate ?? 15);
  const [generalDiscount, setGeneralDiscount] = useState("0");
  const [sourceDocument, setSourceDocument] = useState("");
  const [sourceNumber, setSourceNumber] = useState("");
  const [supplierTaxNumber, setSupplierTaxNumber] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);

  // الخصم العام والكمية المجانية ونسبة الخصم لكل بند كانت كلها أعمدة موجودة في
  // الجدول منذ 0003 لكن النموذج لم يكن يُدخل أيًا منها.
  const lineTotals = lines.map((line) => {
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const discountPercent = Number(line.discountPercent) || 0;
    const gross = qty * price;
    const discount = (gross * discountPercent) / 100;
    return { ...line, qty, price, discountPercent, gross, discount, taxable: gross - discount };
  });

  const subtotal = lineTotals.reduce((sum, line) => sum + line.gross, 0);
  const lineDiscounts = lineTotals.reduce((sum, line) => sum + line.discount, 0);
  const generalDiscountAmount = Number(generalDiscount) || 0;
  const afterDiscounts = Math.max(0, subtotal - lineDiscounts - generalDiscountAmount);

  /**
   * **الخصم العام يُوزَّع على البنود بالتناسب.**
   *
   * قبل الإصلاح: الرأس يحتسب الضريبة على المبلغ **بعد** الخصم العام، والبنود
   * تحتسبها على المبلغ **قبله** — ففاتورة 1000 بخصم عام 100 كان رأسها
   * ضريبة 135 وصافي 1035، بينما مجموع صوافي بنودها 1150. فرق دائم 115،
   * والصفوف المخزَّنة خاطئة لأي تدقيق أو تسوية لاحقة.
   *
   * التوزيع بالتناسب هو الطريقة الوحيدة التي تجعل مجموع البنود = الرأس مع
   * بقاء تكلفة كل صنف صحيحة (وهي ما تُبنى عليه قيمة المخزون).
   */
  const taxableBeforeGeneral = lineTotals.reduce((sum, line) => sum + line.taxable, 0);
  const allocated = lineTotals.map((line) => {
    const share = taxableBeforeGeneral > 0 ? line.taxable / taxableBeforeGeneral : 0;
    const generalShare = Math.round(generalDiscountAmount * share * 100) / 100;
    const netTaxable = Math.max(0, line.taxable - generalShare);
    const vat = Math.round(netTaxable * (orgVatRate / 100) * 100) / 100;
    return {
      ...line,
      generalShare,
      netTaxable,
      vat,
      // تكلفة الوحدة الفعلية بعد كل الخصومات — هي ما يجب أن يُخزَّن في الدفعة
      effectiveUnitCost: line.qty > 0 ? Math.round((netTaxable / line.qty) * 10000) / 10000 : 0,
    };
  });
  const vatAmount = allocated.reduce((sum, line) => sum + line.vat, 0);
  const netAmount = allocated.reduce((sum, line) => sum + line.netTaxable + line.vat, 0);

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!organizationId || !warehouseId) throw new Error("اختر المستودع");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: invoice, error: invoiceError } = await supabase
        .from("purchase_invoices")
        .insert({
          organization_id: organizationId,
          warehouse_id: warehouseId,
          distributor_id: distributorId || null,
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate || null,
          note: note.trim() || null,
          source_document: sourceDocument.trim() || null,
          source_number: sourceNumber.trim() || null,
          supplier_tax_number: supplierTaxNumber.trim() || null,
          payment_term: paymentTerm,
          subtotal_amount: subtotal,
          general_discount_amount: generalDiscountAmount,
          vat_amount: vatAmount,
          net_amount: netAmount,
        })
        .select("id")
        .single();
      if (invoiceError) throw invoiceError;

      for (const line of allocated) {
        const lineVat = line.vat;
        const freeQty = Number(line.freeQty) || 0;
        const salePrice = line.salePrice.trim() ? Number(line.salePrice) : null;

        const { data: invoiceItem, error: itemError } = await supabase
          .from("purchase_invoice_items")
          .insert({
            purchase_invoice_id: invoice.id,
            item_id: line.itemId,
            source_barcode: line.barcode.trim() || null,
            purchase_price: line.price,
            sale_price: salePrice,
            update_item_sale_price: line.updateSalePrice,
            qty: line.qty,
            free_qty: freeQty,
            discount_percent: line.discountPercent,
            // الخصم المخزَّن يشمل حصة البند من الخصم العام، وإلا لم يتطابق
            // مجموع البنود مع رأس الفاتورة.
            line_discount_amount: line.discount + line.generalShare,
            vat_rate: orgVatRate,
            vat_amount: lineVat,
            net_amount: line.netTaxable + lineVat,
            expiry_date: line.expiryDate || null,
          })
          .select("id")
          .single();
        if (itemError) throw itemError;

        // تحديث سعر بيع الصنف من شاشة الشراء عند طلب ذلك صراحةً
        if (line.updateSalePrice && salePrice != null) {
          const { data: pricedItem, error: priceError } = await supabase
            .from("items")
            .update({ price: salePrice })
            .eq("id", line.itemId)
            .select("id");
          if (priceError) throw priceError;
          // المستخدم أشّر على «تحديث سعر البيع» صراحةً. فشل صامت هنا يعني أنه
          // يظن السعر تغيَّر ويبيع بالقديم.
          if (!pricedItem || pricedItem.length === 0) {
            throw new Error("تعذّر تحديث سعر بيع الصنف — صلاحيتك لا تسمح بتعديل الأصناف");
          }
        }

        // الكمية المجانية تدخل المخزون فعليًا لكن بتكلفة صفر، فينخفض المتوسط
        // المرجَّح للتكلفة — وهو السلوك المحاسبي الصحيح لأن المنشأة لم تدفع
        // ثمنها. لذلك تُسجَّل كدفعة منفصلة لا مدموجة مع المدفوعة.
        const receivedQty = line.qty;
        const { data: lot, error: lotError } = await supabase
          .from("inventory_lots")
          .insert({
            organization_id: organizationId,
            warehouse_id: warehouseId,
            item_id: line.itemId,
            purchase_invoice_item_id: invoiceItem.id,
            lot_number: line.lotNumber.trim() || null,
            /**
             * التكلفة **بعد** الخصمين (خصم البند + حصته من الخصم العام) لا
             * السعر الإجمالي. `v_inventory_on_hand` يقيّم المخزون من هذا
             * العمود مباشرةً — فشراء 100 قطعة بـ10 وخصم 20% (التكلفة الفعلية
             * 800) كان يُقيَّم 1000، أي **تضخيم 25%** في قيمة المخزون
             * وتقليل مقابل في الربح المتوقع.
             */
            unit_cost: line.effectiveUnitCost,
            qty_received: receivedQty,
            // qty_remaining يبدأ صفرًا عمدًا: المُحفِّز app_apply_inventory_movement
            // (0003) يزيده تلقائيًا عند إدراج حركة الاستلام أدناه. تعبئته هنا
            // بالكمية كانت تُضاعف المخزون — شراء 10 قطع يُسجَّل 20.
            qty_remaining: 0,
            expiry_date: line.expiryDate || null,
          })
          .select("id")
          .single();
        if (lotError) throw lotError;

        const { error: movementError } = await supabase.from("inventory_movements").insert({
          organization_id: organizationId,
          warehouse_id: warehouseId,
          item_id: line.itemId,
          lot_id: lot.id,
          movement_type: "purchase_in",
          qty: receivedQty,
          // السعر والإجمالي على نفس الأساس: `unit_price × qty` كان لا يساوي
          // `total_amount` عند وجود خصم، فتختلف أي تسوية تشتقّ القيمة منهما.
          unit_price: line.effectiveUnitCost,
          total_amount: Math.round(line.netTaxable * 100) / 100,
          related_purchase_invoice_id: invoice.id,
        });
        if (movementError) throw movementError;

        if (freeQty > 0) {
          const { data: freeLot, error: freeLotError } = await supabase
            .from("inventory_lots")
            .insert({
              organization_id: organizationId,
              warehouse_id: warehouseId,
              item_id: line.itemId,
              purchase_invoice_item_id: invoiceItem.id,
              lot_number: line.lotNumber.trim() ? `${line.lotNumber.trim()}-FREE` : null,
              unit_cost: 0,
              qty_received: freeQty,
              qty_remaining: 0,   // يملؤه المُحفِّز من حركة الاستلام (انظر أعلاه)
              expiry_date: line.expiryDate || null,
            })
            .select("id")
            .single();
          if (freeLotError) throw freeLotError;

          const { error: freeMovementError } = await supabase.from("inventory_movements").insert({
            organization_id: organizationId,
            warehouse_id: warehouseId,
            item_id: line.itemId,
            lot_id: freeLot.id,
            movement_type: "purchase_in",
            qty: freeQty,
            unit_price: 0,
            total_amount: 0,
            note: "كمية مجانية من المورد",
            related_purchase_invoice_id: invoice.id,
          });
          if (freeMovementError) throw freeMovementError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      toast({ title: "تم حفظ فاتورة الشراء واستلام المخزون" });
      setDistributorId("");
      setWarehouseId("");
      setInvoiceNumber("");
      setNote("");
      setGeneralDiscount("0");
      setSourceDocument("");
      setSourceNumber("");
      setSupplierTaxNumber("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الفاتورة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>فاتورة شراء جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المورد</Label>
              <Select value={distributorId} onValueChange={setDistributorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختياري" />
                </SelectTrigger>
                <SelectContent>
                  {(distributors.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستودع *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المستودع" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>رقم فاتورة المورد</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>تاريخ الفاتورة</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>طريقة السداد</Label>
              <Select value={paymentTerm} onValueChange={(v) => setPaymentTerm(v as PurchasePaymentTerm)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="credit">آجل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />
          <Label>البنود</Label>
          <ItemPicker
            onSelect={(item) =>
              setLines((ls) => [
                ...ls,
                {
                  itemId: item.id,
                  name: item.name_ar,
                  qty: "1",
                  price: String(item.price),
                  expiryDate: "",
                  freeQty: "0",
                  discountPercent: "0",
                  salePrice: String(item.price),
                  updateSalePrice: false,
                  barcode: "",
                  lotNumber: "",
                },
              ])
            }
          />
          {lines.map((line, index) => {
            const patch = (changes: Partial<PurchaseLine>) =>
              setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...changes } : l)));
            return (
              <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium">{line.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">الكمية</Label>
                    <Input type="number" min={0} value={line.qty} onChange={(e) => patch({ qty: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">كمية مجانية</Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.freeQty}
                      onChange={(e) => patch({ freeQty: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">سعر الشراء</Label>
                    <Input type="number" min={0} value={line.price} onChange={(e) => patch({ price: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">خصم %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={line.discountPercent}
                      onChange={(e) => patch({ discountPercent: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">تاريخ الصلاحية</Label>
                    <Input
                      type="date"
                      value={line.expiryDate}
                      onChange={(e) => patch({ expiryDate: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">رقم الدفعة</Label>
                    <Input value={line.lotNumber} onChange={(e) => patch({ lotNumber: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">باركود المصدر</Label>
                    <Input value={line.barcode} onChange={(e) => patch({ barcode: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] font-normal text-muted-foreground">سعر البيع</Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.salePrice}
                      onChange={(e) => patch({ salePrice: e.target.value })}
                    />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={line.updateSalePrice}
                    onChange={(e) => patch({ updateSalePrice: e.target.checked })}
                  />
                  تحديث سعر بيع الصنف في الكتالوج بهذا السعر
                </label>
              </div>
            );
          })}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>خصم عام على الفاتورة</Label>
              <Input
                type="number"
                min={0}
                value={generalDiscount}
                onChange={(e) => setGeneralDiscount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ملاحظة</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المصدر</Label>
              <Input
                value={sourceDocument}
                onChange={(e) => setSourceDocument(e.target.value)}
                placeholder="أمر شراء، عقد، طلبية..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم المصدر</Label>
              <Input value={sourceNumber} onChange={(e) => setSourceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الرقم الضريبي للمورد</Label>
              <Input
                value={supplierTaxNumber}
                onChange={(e) => setSupplierTaxNumber(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-4 rounded-md border p-2 text-sm">
            <span>الإجمالي: {subtotal.toLocaleString("ar-SA")}</span>
            <span>خصم البنود: {lineDiscounts.toLocaleString("ar-SA")}</span>
            <span>خصم عام: {generalDiscountAmount.toLocaleString("ar-SA")}</span>
            <span>الضريبة: {vatAmount.toLocaleString("ar-SA")}</span>
            <span className="font-semibold">الصافي: {netAmount.toLocaleString("ar-SA")}</span>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!warehouseId || lines.length === 0 || createInvoice.isPending} onClick={() => createInvoice.mutate()}>
            {createInvoice.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة واستلام المخزون"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
