import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pill, Plus, X, Printer } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  AvailableDrugLotView,
  DrugDosageForm,
  PrescriptionPendingDispensingView,
  PrescriptionRoute,
} from "@/lib/database.types";
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
// كتالوج الأدوية — يعرض أصناف items من نوع drug + تفاصيلها من drug_details
// ---------------------------------------------------------------------------
function useDrugCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["drug-catalog", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, code, name_ar, price, is_disabled, drug_details(generic_name, dosage_form, strength_text, requires_prescription, is_controlled_substance)")
        .eq("organization_id", organizationId)
        .eq("item_type", "drug")
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function DrugCatalogTab() {
  const { organization } = useOrganizationAccess();
  const drugs = useDrugCatalog(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>كتالوج الأدوية</CardTitle>
          <CardDescription>كل دواء هو صنف بنوع "drug" في كتالوج الأصناف الموحّد، بتفاصيل دوائية إضافية</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          دواء جديد
        </Button>
      </CardHeader>
      <CardContent>
        {drugs.isLoading && <Skeleton className="h-40 w-full" />}
        {!drugs.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الاسم العلمي</TableHead>
                <TableHead>الشكل الدوائي</TableHead>
                <TableHead>التركيز</TableHead>
                <TableHead>يحتاج وصفة</TableHead>
                <TableHead>السعر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(drugs.data ?? []).map((drug) => {
                const details = Array.isArray(drug.drug_details) ? drug.drug_details[0] : drug.drug_details;
                return (
                  <TableRow key={drug.id}>
                    <TableCell className="flex items-center gap-2 font-medium">
                      <Pill className="h-4 w-4 text-muted-foreground" />
                      {drug.name_ar}
                    </TableCell>
                    <TableCell>{details?.generic_name ?? "—"}</TableCell>
                    <TableCell>{details ? DOSAGE_FORM_LABELS[details.dosage_form as DrugDosageForm] : "—"}</TableCell>
                    <TableCell>{details?.strength_text ?? "—"}</TableCell>
                    <TableCell>
                      {details?.requires_prescription === false ? (
                        <Badge variant="secondary">بلا وصفة</Badge>
                      ) : (
                        <Badge variant="warning">يحتاج وصفة</Badge>
                      )}
                    </TableCell>
                    <TableCell>{Number(drug.price).toLocaleString("ar-SA")} ر.س</TableCell>
                  </TableRow>
                );
              })}
              {(drugs.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد أدوية في الكتالوج بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewDrugDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewDrugDialog({
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
  const [nameAr, setNameAr] = useState("");
  const [genericName, setGenericName] = useState("");
  const [dosageForm, setDosageForm] = useState<DrugDosageForm>("tablet");
  const [strength, setStrength] = useState("");
  const [price, setPrice] = useState("0");
  const [requiresPrescription, setRequiresPrescription] = useState(true);
  const [isControlled, setIsControlled] = useState(false);
  const [defaultInstructions, setDefaultInstructions] = useState("");

  const createDrug = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { data: item, error: itemError } = await supabase
        .from("items")
        .insert({
          organization_id: organizationId,
          item_type: "drug",
          code: `DRG-${Date.now().toString().slice(-6)}`,
          name_ar: nameAr.trim(),
          price: Number(price) || 0,
          track_inventory: true,
        })
        .select("id")
        .single();
      if (itemError) throw itemError;

      const { error: detailsError } = await supabase.from("drug_details").insert({
        item_id: item.id,
        generic_name: genericName.trim() || null,
        dosage_form: dosageForm,
        strength_text: strength.trim() || null,
        requires_prescription: requiresPrescription,
        is_controlled_substance: isControlled,
        default_dosage_instructions: defaultInstructions.trim() || null,
      });
      if (detailsError) throw detailsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drug-catalog", organizationId] });
      toast({ title: "تم حفظ الدواء" });
      setNameAr("");
      setGenericName("");
      setDosageForm("tablet");
      setStrength("");
      setPrice("0");
      setRequiresPrescription(true);
      setIsControlled(false);
      setDefaultInstructions("");
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
          <DialogTitle>دواء جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم التجاري *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم العلمي</Label>
            <Input value={genericName} onChange={(e) => setGenericName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الشكل الدوائي</Label>
              <Select value={dosageForm} onValueChange={(v) => setDosageForm(v as DrugDosageForm)}>
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
              <Input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="500mg" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السعر</Label>
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تعليمات الجرعة الافتراضية (اختياري)</Label>
            <Textarea value={defaultInstructions} onChange={(e) => setDefaultInstructions(e.target.value)} rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresPrescription} onChange={(e) => setRequiresPrescription(e.target.checked)} />
            يحتاج وصفة طبية للصرف
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isControlled} onChange={(e) => setIsControlled(e.target.checked)} />
            دواء مخضع للرقابة (Controlled Substance)
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createDrug.isPending} onClick={() => createDrug.mutate()}>
            {createDrug.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الوصفات
// ---------------------------------------------------------------------------
function usePendingPrescriptions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["pending-prescriptions", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_prescriptions_pending_dispensing")
        .select("*")
        .eq("organization_id", organizationId)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PrescriptionPendingDispensingView[];
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
          "id, status, issued_at, notes, insurance_company_name, insurance_policy_number, is_billed, patient:patients(id, name_ar, file_number), doctor:doctors(name_ar), prescription_items(id, quantity_prescribed, dispensed_quantity, drug:items(name_ar, price))",
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
    drug: { name_ar: string; price: number | null } | null;
  }[];
};

const PRESCRIPTION_STATUS_LABELS: Record<string, string> = {
  draft: "مسوّدة",
  issued: "صادرة",
  partially_dispensed: "صرف جزئي",
  dispensed: "مصروفة",
  cancelled: "ملغاة",
};

/** إجمالي سعر الوصفة = مجموع (الكمية الموصوفة × سعر الدواء) لكل بند. */
function prescriptionTotal(row: PrescriptionListRow) {
  return (row.prescription_items ?? []).reduce((sum, line) => {
    const drug = Array.isArray(line.drug) ? line.drug[0] : line.drug;
    return sum + Number(line.quantity_prescribed ?? 0) * Number(drug?.price ?? 0);
  }, 0);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
  );
}

function printPrescriptions(rows: PrescriptionListRow[], organizationName: string) {
  const body = rows
    .map((row) => {
      const lines = (row.prescription_items ?? [])
        .map((line) => {
          const drug = Array.isArray(line.drug) ? line.drug[0] : line.drug;
          const lineTotal = Number(line.quantity_prescribed ?? 0) * Number(drug?.price ?? 0);
          return `<tr><td>${escapeHtml(drug?.name_ar ?? "—")}</td><td>${line.quantity_prescribed}</td><td>${Number(
            drug?.price ?? 0,
          ).toFixed(2)}</td><td>${lineTotal.toFixed(2)}</td></tr>`;
        })
        .join("");
      return `<section style="page-break-inside:avoid;margin-bottom:24px;border-bottom:1px solid #ccc;padding-bottom:12px">
        <h3 style="margin:0 0 6px">${escapeHtml(row.patient?.name_ar ?? "—")} — ملف ${escapeHtml(
          row.patient?.file_number ?? "—",
        )}</h3>
        <p style="margin:0 0 6px;font-size:13px">
          الطبيب: ${escapeHtml(row.doctor?.name_ar ?? "—")} ·
          التاريخ: ${new Date(row.issued_at).toLocaleDateString("ar-SA")} ·
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
          <thead><tr><th>الدواء</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <p style="margin:6px 0 0;font-size:13px;font-weight:bold">إجمالي الوصفة: ${prescriptionTotal(row).toFixed(
          2,
        )}</p>
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
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const prescriptions = usePrescriptionsList(organization?.id, statusFilter);
  const [createOpen, setCreateOpen] = useState(false);

  const toggleBilled = useMutation({
    mutationFn: async (row: PrescriptionListRow) => {
      const { data: affectedRows, error } = await supabase
        .from("prescriptions")
        .update({ is_billed: !row.is_billed })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      toast({ title: "تم تحديث حالة الفوترة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const rows = prescriptions.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>الوصفات</CardTitle>
          <CardDescription>كل الوصفات الصادرة مع حالة الصرف والفوترة وبيانات التأمين</CardDescription>
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
            onClick={() => printPrescriptions(rows, organization?.name ?? "")}
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
                <TableHead>الإجمالي</TableHead>
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
                      {new Date(row.issued_at).toLocaleDateString("ar-SA")}
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
                    <TableCell className="tabular-nums">{prescriptionTotal(row).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.insurance_company_name ?? "—"}
                      {row.insurance_policy_number ? ` · ${row.insurance_policy_number}` : ""}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant={row.is_billed ? "outline" : "ghost"} onClick={() => toggleBilled.mutate(row)}>
                        {row.is_billed ? "تمت الفوترة" : "لم تُفوتَر"}
                      </Button>
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
  const [isBilled, setIsBilled] = useState(false);
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
          is_billed: isBilled,
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
      queryClient.invalidateQueries({ queryKey: ["pending-prescriptions", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      toast({ title: "تم إصدار الوصفة" });
      setPatient(null);
      setDoctorId("");
      setInsuranceCompany("");
      setInsurancePolicy("");
      setIsBilled(false);
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إصدار الوصفة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={isBilled} onChange={(e) => setIsBilled(e.target.checked)} />
            تمت الفوترة
          </label>

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
// ---------------------------------------------------------------------------
function usePrescriptionDetails(prescriptionId: string | null) {
  return useQuery({
    queryKey: ["prescription-details", prescriptionId],
    enabled: Boolean(prescriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prescription_items")
        .select("*, drug:items(id, name_ar)")
        .eq("prescription_id", prescriptionId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useAvailableLots(itemId: string | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["available-drug-lots", itemId, organizationId],
    enabled: Boolean(itemId && organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_available_drug_lots")
        .select("*")
        .eq("item_id", itemId)
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as AvailableDrugLotView[];
    },
  });
}

function DispensingTab() {
  const { organization } = useOrganizationAccess();
  const prescriptions = usePendingPrescriptions(organization?.id);
  const [openPrescriptionId, setOpenPrescriptionId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>طابور الصرف</CardTitle>
        <CardDescription>اختر وصفة لصرف أدويتها — الكمية المتبقية تُحدَّث تلقائيًا من المخزون عند كل صرف</CardDescription>
      </CardHeader>
      <CardContent>
        {prescriptions.isLoading && <Skeleton className="h-40 w-full" />}
        {!prescriptions.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(prescriptions.data ?? []).map((pr) => (
                <TableRow key={pr.prescription_id}>
                  <TableCell className="font-medium">{pr.patient_name}</TableCell>
                  <TableCell>{pr.doctor_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={pr.status === "partially_dispensed" ? "warning" : "secondary"}>
                      {pr.status === "partially_dispensed" ? "صرف جزئي" : "لم يُصرَف"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setOpenPrescriptionId(pr.prescription_id)}>
                      صرف
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(prescriptions.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
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

function DispenseLineRow({
  item,
  organizationId,
  qty,
  lotId,
  onChangeQty,
  onChangeLot,
}: {
  item: { id: string; drug_item_id: string; quantity_prescribed: number; dispensed_quantity: number; drug?: { name_ar: string } };
  organizationId: string | undefined;
  qty: string;
  lotId: string;
  onChangeQty: (value: string) => void;
  onChangeLot: (value: string) => void;
}) {
  const lots = useAvailableLots(item.drug_item_id, organizationId);
  const remaining = Number(item.quantity_prescribed) - Number(item.dispensed_quantity);

  if (remaining <= 0) {
    return (
      <div className="flex items-center justify-between rounded-md border p-3 text-sm text-muted-foreground">
        <span>{item.drug?.name_ar}</span>
        <Badge variant="success">صُرف بالكامل</Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{item.drug?.name_ar}</span>
        <span className="text-xs text-muted-foreground">المتبقي من الوصفة: {remaining}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={lotId} onValueChange={onChangeLot}>
          <SelectTrigger>
            <SelectValue placeholder="اختر دفعة المخزون" />
          </SelectTrigger>
          <SelectContent>
            {(lots.data ?? []).map((lot) => (
              <SelectItem key={lot.lot_id} value={lot.lot_id}>
                {lot.lot_number ?? "دفعة بلا رقم"} — متبقٍ {lot.qty_remaining}
                {lot.expiry_date ? ` — ينتهي ${lot.expiry_date}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" min={0} max={remaining} placeholder="الكمية المصروفة" value={qty} onChange={(e) => onChangeQty(e.target.value)} />
      </div>
      {(lots.data ?? []).length === 0 && (
        <p className="text-xs text-amber-700">لا توجد دفعة مخزون متاحة لهذا الدواء — تحقّق من المشتريات/المخزون.</p>
      )}
    </div>
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
  const warehouses = useWarehousesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [selections, setSelections] = useState<Record<string, { qty: string; lotId: string }>>({});

  const dispense = useMutation({
    mutationFn: async () => {
      if (!organizationId || !prescriptionId) throw new Error("بيانات غير مكتملة");
      if (!warehouseId) throw new Error("اختر المستودع");

      const { data: prescription, error: prescriptionLoadError } = await supabase
        .from("prescriptions")
        .select("patient_id")
        .eq("id", prescriptionId)
        .single();
      if (prescriptionLoadError) throw prescriptionLoadError;

      const linesToDispense: Array<[string, { qty: string; lotId: string }]> = Object.keys(selections)
        .map((itemId) => [itemId, selections[itemId]] as [string, { qty: string; lotId: string }])
        .filter(([, sel]) => Number(sel.qty) > 0 && sel.lotId);
      if (linesToDispense.length === 0) throw new Error("حدّد كمية ودفعة لدواء واحد على الأقل");

      const { data: record, error: recordError } = await supabase
        .from("dispensing_records")
        .insert({
          organization_id: organizationId,
          prescription_id: prescriptionId,
          patient_id: prescription.patient_id,
          warehouse_id: warehouseId,
        })
        .select("id")
        .single();
      if (recordError) throw recordError;

      const { error: itemsError } = await supabase.from("dispensing_items").insert(
        linesToDispense.map(([itemId, sel]) => {
          const item = (details.data ?? []).find((line) => line.id === itemId);
          return {
            dispensing_record_id: record.id,
            prescription_item_id: itemId,
            drug_item_id: item?.drug_item_id,
            lot_id: sel.lotId,
            quantity_dispensed: Number(sel.qty),
            unit_price: 0,
          };
        }),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-prescriptions", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["prescription-details", prescriptionId] });
      toast({ title: "تم صرف الأدوية المحدَّدة" });
      setSelections({});
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الصرف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(prescriptionId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>صرف الوصفة</DialogTitle>
          <DialogDescription>كل دواء يُصرَف من دفعة مخزون محدَّدة — الكمية تُنقَص من المخزون فورًا بعد الصرف</DialogDescription>
        </DialogHeader>

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

        <Separator />

        {details.isLoading && <Skeleton className="h-40 w-full" />}
        {!details.isLoading && (
          <div className="flex flex-col gap-3">
            {(details.data ?? []).map((item) => (
              <DispenseLineRow
                key={item.id}
                item={item as { id: string; drug_item_id: string; quantity_prescribed: number; dispensed_quantity: number; drug?: { name_ar: string } }}
                organizationId={organizationId}
                qty={selections[item.id]?.qty ?? ""}
                lotId={selections[item.id]?.lotId ?? ""}
                onChangeQty={(value) => setSelections((s) => ({ ...s, [item.id]: { ...s[item.id], qty: value, lotId: s[item.id]?.lotId ?? "" } }))}
                onChangeLot={(value) => setSelections((s) => ({ ...s, [item.id]: { qty: s[item.id]?.qty ?? "", lotId: value } }))}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button disabled={!warehouseId || dispense.isPending} onClick={() => dispense.mutate()}>
            {dispense.isPending ? "جارٍ الصرف..." : "تأكيد الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
