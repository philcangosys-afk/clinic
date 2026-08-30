import { useEffect, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, FileSignature, Plus, Printer, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  InsuranceClaimBatchStatus,
  InsuranceClaimFormType,
  InsuranceClaimStatus,
  PreauthorizationStatus,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/lib/permissions";
import PatientPicker from "@/components/shared/PatientPicker";
import NewClaimFormDialog from "@/components/insurance/NewClaimFormDialog";
import { useInsuranceSettings } from "@/lib/insurance-settings";
import { InsuranceSettingsTab } from "@/pages/OperationsSettings";
import FormRequirementsTab from "@/components/insurance/FormRequirementsTab";
import { useToast } from "@/hooks/use-toast";

/**
 * حالات المطالبة بعد 0089.
 *
 * كانت أربعًا، وكان `rejected` منها **طريقًا مسدودًا**: لا سبب رفض، ولا
 * رابط لإعادة تقديم. الأربع الجديدة تفتح الطريق: اعتماد جزئي، وإعادة تقديم،
 * ودفع، وإلغاء.
 */
const CLAIM_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  submitted: "مُرسلة",
  approved: "موافق عليها",
  partially_approved: "معتمَدة جزئيًا",
  rejected: "مرفوضة",
  resubmitted: "أُعيد تقديمها",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};
const CLAIM_STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
  partially_approved: "bg-amber-100 text-amber-800",
  rejected: "bg-rose-100 text-rose-700",
  resubmitted: "bg-violet-100 text-violet-700",
  paid: "bg-emerald-200 text-emerald-900",
  cancelled: "bg-slate-200 text-slate-600",
};
const FORM_TYPE_LABELS: Record<InsuranceClaimFormType, string> = { ucaf: "UCAF", dcaf: "DCAF", ocaf: "OCAF" };
const PREAUTH_STATUS_LABELS: Record<PreauthorizationStatus, string> = {
  pending: "قيد الانتظار",
  approved: "مقبولة",
  rejected: "مرفوضة",
  expired: "منتهية",
};

export default function Insurance() {
  const { organization, membership } = useOrganizationAccess();
  // نفس فحص شاشة إعدادات التشغيل: التعديل مقصور على المالك ومدير المنشأة،
  // وهو مطبَّق في RLS أيضًا لا في الواجهة وحدها.
  const isOrgAdmin =
    membership?.role_key === "owner" || membership?.role_key === "organization_admin";
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">التأمين والمطالبات</h1>
        <p className="text-sm text-muted-foreground">شركات التأمين، عضويات المرضى، ونماذج المطالبات UCAF/DCAF/OCAF</p>
      </div>

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">شركات التأمين والبوليصات</TabsTrigger>
          <TabsTrigger value="contracts">العقود والتغطية</TabsTrigger>
          <TabsTrigger value="claims">المطالبات</TabsTrigger>
          <TabsTrigger value="batches">دفعات المطالبات</TabsTrigger>
          <TabsTrigger value="preauth">الموافقات المسبقة</TabsTrigger>
          <TabsTrigger value="form-fields">خانات النماذج</TabsTrigger>
          <TabsTrigger value="settings">إعدادات التأمين</TabsTrigger>
        </TabsList>
        <TabsContent value="companies">
          <CompaniesTab />
        </TabsContent>
        <TabsContent value="contracts" className="mt-4 flex flex-col gap-4">
          <CoverageCheckCard />
          <ContractsTab />
        </TabsContent>
        <TabsContent value="claims">
          <ClaimsTab />
        </TabsContent>
        <TabsContent value="batches">
          <ClaimBatchesTab />
        </TabsContent>
        <TabsContent value="preauth">
          <PreauthTab />
        </TabsContent>
        <TabsContent value="form-fields">
          <FormRequirementsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="settings">
          <InsuranceSettingsTab organizationId={organization?.id} readOnly={!isOrgAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useCompanies(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["insurance-companies", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select(
          "id, name_ar, name_en, phone, email, tax_number, address, is_disabled, insurance_policies(id, policy_name, policy_number, default_copay_percent, is_disabled)",
        )
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function CompaniesTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const companies = useCompanies(organization?.id);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [policyDialogFor, setPolicyDialogFor] = useState<string | null>(null);
  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);

  const toggleCompanyDisabled = useMutation({
    mutationFn: async ({ id, is_disabled }: { id: string; is_disabled: boolean }) => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .update({ is_disabled })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-companies"] }),
  });

  const togglePolicyDisabled = useMutation({
    mutationFn: async ({ id, is_disabled }: { id: string; is_disabled: boolean }) => {
      const { data, error } = await supabase
        .from("insurance_policies")
        .update({ is_disabled })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-companies"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setMembershipDialogOpen(true)}>
          <ShieldCheck className="h-4 w-4" />
          ربط مريض بوثيقة تأمين
        </Button>
        <Button onClick={() => setCompanyDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          شركة تأمين جديدة
        </Button>
      </div>

      {companies.isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      )}

      {(companies.data ?? []).map((company: any) => (
        <Card key={company.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{company.name_ar}</CardTitle>
              <button
                type="button"
                onClick={() => toggleCompanyDisabled.mutate({ id: company.id, is_disabled: !company.is_disabled })}
              >
                <Badge variant={company.is_disabled ? "secondary" : "success"}>
                  {company.is_disabled ? "معطّلة" : "نشطة"}
                </Badge>
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPolicyDialogFor(company.id)}>
              <Plus className="h-3.5 w-3.5" />
              بوليصة جديدة
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(company.name_en || company.email || company.tax_number || company.address) && (
              <p className="text-xs text-muted-foreground">
                {[company.name_en, company.email, company.tax_number && `ض.ق: ${company.tax_number}`, company.address]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(company.insurance_policies ?? []).map((policy: any) => (
                <button key={policy.id} type="button" onClick={() => togglePolicyDisabled.mutate({ id: policy.id, is_disabled: !policy.is_disabled })}>
                  <Badge variant={policy.is_disabled ? "secondary" : "outline"}>
                    {policy.policy_name}
                    {policy.policy_number ? ` (${policy.policy_number})` : ""} · خصم {policy.default_copay_percent}%
                  </Badge>
                </button>
              ))}
              {(company.insurance_policies ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">لا توجد بوالص لهذه الشركة بعد.</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {!companies.isLoading && (companies.data ?? []).length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">لا توجد شركات تأمين مسجّلة بعد.</p>
      )}

      <MembershipsList organizationId={organization?.id} />

      <NewCompanyDialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen} organizationId={organization?.id} />
      <NewPolicyDialog
        companyId={policyDialogFor}
        onOpenChange={() => setPolicyDialogFor(null)}
        organizationId={organization?.id}
      />
      <AddMembershipDialog open={membershipDialogOpen} onOpenChange={setMembershipDialogOpen} organizationId={organization?.id} />
    </div>
  );
}

const ELIGIBILITY_LABELS_AR: Record<string, string> = {
  eligible: "مؤهّل",
  not_eligible: "غير مؤهّل",
  unknown: "غير معروفة",
  expired: "منتهية",
};

function MembershipsList({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const memberships = useQuery({
    queryKey: ["patient-insurance-memberships", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_insurance_memberships")
        .select(
          "id, membership_number, relation, expiry_date, eligibility_status, is_active, patient:patients(name_ar), policy:insurance_policies(policy_name, company:insurance_companies(name_ar))",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from("patient_insurance_memberships")
        .update({ is_active })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-insurance-memberships"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">عضويات المرضى في وثائق التأمين</CardTitle>
        <CardDescription>آخر 50 عضوية</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {memberships.isLoading && <Skeleton className="h-24 w-full" />}
        {!memberships.isLoading && (memberships.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد عضويات بعد.</p>
        )}
        {(memberships.data ?? []).map((m: any) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">
                {m.patient?.name_ar ?? "—"} · {m.policy?.company?.name_ar} — {m.policy?.policy_name}
              </p>
              <p className="text-xs text-muted-foreground">
                رقم العضوية: {m.membership_number}
                {m.expiry_date && ` · ينتهي: ${new Date(m.expiry_date).toLocaleDateString("ar-SA")}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{ELIGIBILITY_LABELS_AR[m.eligibility_status] ?? m.eligibility_status}</Badge>
              <button type="button" onClick={() => toggleActive.mutate({ id: m.id, is_active: !m.is_active })}>
                <Badge variant={m.is_active ? "success" : "secondary"}>{m.is_active ? "فعّالة" : "معطّلة"}</Badge>
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NewCompanyDialog({
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
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [address, setAddress] = useState("");

  const createCompany = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("insurance_companies").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        tax_number: taxNumber.trim() || null,
        address: address.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
      toast({ title: "تم حفظ شركة التأمين" });
      setNameAr("");
      setNameEn("");
      setPhone("");
      setEmail("");
      setTaxNumber("");
      setAddress("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>شركة تأمين جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>اسم الشركة (عربي) *</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>اسم الشركة (إنجليزي)</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>رقم التواصل</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>البريد الإلكتروني</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>الرقم الضريبي</Label>
              <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العنوان</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createCompany.isPending} onClick={() => createCompany.mutate()}>
            {createCompany.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPolicyDialog({
  companyId,
  onOpenChange,
  organizationId,
}: {
  companyId: string | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [policyName, setPolicyName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [policyClass, setPolicyClass] = useState("");
  const [copay, setCopay] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
  const [consultationLimit, setConsultationLimit] = useState("");
  const insuranceSettings = useInsuranceSettings(organizationId);

  const createPolicy = useMutation({
    mutationFn: async () => {
      if (!organizationId || !companyId) throw new Error("بيانات غير مكتملة");

      /**
       * `prevent_duplicate_policy_name` كان يُحفَظ ولا يُنفَّذ.
       *
       * الفحص هنا لا في القاعدة لأن القيد الفريد الموجود يشمل الفئة (Class)،
       * فبوليصتان بنفس الاسم وفئتين مختلفتين تمرّان — وهو بالضبط ما يشتكي منه
       * من فعّل هذا الإعداد: قائمة بوليصات فيها ثلاثة صفوف باسم واحد لا يفرّق
       * بينها الموظف عند ربط المريض.
       *
       * لا يُتجاوز الفحص عند فشل القراءة: الإعداد حماية من خطأ إدخال، وتخطّيه
       * صامتًا يعيد المشكلة التي فُعِّل من أجلها.
       */
      // `?.` كان يجعل الحارس يُتخطّى صامتًا بينما الاستعلام قيد التحميل أو بعد
      // فشله — وهو ما ينفيه التعليق أعلاه. `!== false` يعني: امنع ما لم يكن
      // الإعداد مُعطَّلًا صراحةً.
      if (insuranceSettings.data?.prevent_duplicate_policy_name !== false) {
        const { data: existing, error: checkError } = await supabase
          .from("insurance_policies")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("company_id", companyId)
          // `_` و`%` في اسم البوليصة محارف بدل في ilike: اسم "Class A_1" كان
          // يطابق "Class A-1" الموجود فيُمنع حفظ بوليصة مشروعة. تُهرَّب أولًا.
          .ilike("policy_name", policyName.trim().replace(/[\\%_]/g, "\\$&"))
          .limit(1);
        if (checkError) throw checkError;
        if ((existing ?? []).length > 0)
          throw new Error("توجد بوليصة بنفس الاسم لهذه الشركة — الإعداد يمنع التكرار");
      }

      const { error } = await supabase.from("insurance_policies").insert({
        organization_id: organizationId,
        company_id: companyId,
        policy_name: policyName.trim(),
        policy_number: policyNumber.trim() || null,
        policy_class: policyClass.trim() || null,
        default_copay_percent: Number(copay) || 0,
        default_max_amount: maxAmount ? Number(maxAmount) : null,
        default_consultation_limit: consultationLimit ? Number(consultationLimit) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
      toast({ title: "تم حفظ البوليصة" });
      setPolicyName("");
      setPolicyNumber("");
      setPolicyClass("");
      setCopay("0");
      setMaxAmount("");
      setConsultationLimit("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع (تأكد من عدم تكرار اسم البوليصة لنفس الفئة)",
      }),
  });

  return (
    <Dialog open={Boolean(companyId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>بوليصة جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>اسم البوليصة *</Label>
              <Input value={policyName} onChange={(e) => setPolicyName(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم البوليصة</Label>
              <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفئة (Class)</Label>
            <Input value={policyClass} onChange={(e) => setPolicyClass(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>نسبة التحمل الافتراضية %</Label>
              <Input type="number" value={copay} onChange={(e) => setCopay(e.target.value)} />
            </div>
            {/* `disable_patient_max_copay_field` كان يُحفَظ ولا يُنفَّذ */}
            {!insuranceSettings.data?.disable_patient_max_copay_field && (
              <div className="flex flex-col gap-1.5">
                <Label>الحد الأقصى (اختياري)</Label>
                <Input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>حد الكشفية (اختياري)</Label>
              <Input type="number" value={consultationLimit} onChange={(e) => setConsultationLimit(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!policyName.trim() || createPolicy.isPending} onClick={() => createPolicy.mutate()}>
            {createPolicy.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMembershipDialog({
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
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  const [relation, setRelation] = useState<"self" | "spouse" | "child" | "other">("self");
  const [expiryDate, setExpiryDate] = useState("");
  const [eligibilityStatus, setEligibilityStatus] = useState<"eligible" | "not_eligible" | "unknown" | "expired">("unknown");
  const [copayOverride, setCopayOverride] = useState("");
  const [maxAmountOverride, setMaxAmountOverride] = useState("");

  const policies = useQuery({
    queryKey: ["insurance-policies-flat", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_policies")
        .select("id, policy_name, company:insurance_companies(name_ar)")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .eq("is_disabled", false);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMembership = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !policyId || !membershipNumber.trim())
        throw new Error("أكمل كل الحقول المطلوبة");
      const { error } = await supabase.from("patient_insurance_memberships").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        policy_id: policyId,
        membership_number: membershipNumber.trim(),
        relation,
        expiry_date: expiryDate || null,
        eligibility_status: eligibilityStatus,
        copay_percent_override: copayOverride ? Number(copayOverride) : null,
        max_amount_override: maxAmountOverride ? Number(maxAmountOverride) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "تم ربط المريض بوثيقة التأمين" });
      setPatient(null);
      setPolicyId("");
      setMembershipNumber("");
      setRelation("self");
      setExpiryDate("");
      setEligibilityStatus("unknown");
      setCopayOverride("");
      setMaxAmountOverride("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع (تأكد من عدم تكرار رقم العضوية)",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ربط مريض بوثيقة تأمين</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البوليصة</Label>
            <Select value={policyId} onValueChange={setPolicyId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر البوليصة" />
              </SelectTrigger>
              <SelectContent>
                {(policies.data ?? []).map((policy: any) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.company?.name_ar} — {policy.policy_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>رقم العضوية</Label>
              <Input value={membershipNumber} onChange={(e) => setMembershipNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العلاقة</Label>
              <Select value={relation} onValueChange={(value) => setRelation(value as typeof relation)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">صاحب الوثيقة</SelectItem>
                  <SelectItem value="spouse">زوج/زوجة</SelectItem>
                  <SelectItem value="child">ابن/ابنة</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>تاريخ انتهاء الوثيقة</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>حالة الأهلية</Label>
              <Select value={eligibilityStatus} onValueChange={(v) => setEligibilityStatus(v as typeof eligibilityStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">غير معروفة</SelectItem>
                  <SelectItem value="eligible">مؤهّل</SelectItem>
                  <SelectItem value="not_eligible">غير مؤهّل</SelectItem>
                  <SelectItem value="expired">منتهية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>نسبة تحمل خاصة (تجاوز اختياري)</Label>
              <Input type="number" value={copayOverride} onChange={(e) => setCopayOverride(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>حد أقصى خاص (تجاوز اختياري)</Label>
              <Input type="number" value={maxAmountOverride} onChange={(e) => setMaxAmountOverride(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={createMembership.isPending} onClick={() => createMembership.mutate()}>
            {createMembership.isPending ? "جارٍ الحفظ..." : "حفظ الربط"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useClaimForms(organizationId: string | undefined, status: string) {
  return useQuery({
    queryKey: ["insurance-claim-forms", organizationId, status],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("insurance_claim_forms")
        .select(
          "id, form_type, status, auto_created, created_at, form_data, claimed_amount, approved_amount, rejected_amount, rejection_reason, rejection_code, resubmission_count, resubmission_of_id, submitted_at, responded_at, patient:patients(name_ar, file_number, id_number, birth_date, insurance_company_name, insurance_policy_number, insurance_membership_number), doctor:doctors(name_ar)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * طباعة نموذج المطالبة UCAF/DCAF/OCAF (لقطة 62 — موصوفة بـ⭐).
 *
 * المواصفة تطلب "مخرجات طباعة قياسية" لكل نوع. النماذج تُخزَّن كحقول حرة في
 * `form_data` (jsonb)، فالطباعة تعرض بيانات المريض والتأمين الثابتة أولًا ثم
 * كل حقول النموذج المحفوظة — بدل قالب جامد يُسقط أي حقل أضافه المستخدم.
 */
function printClaimForm(form: any) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  const patient = Array.isArray(form.patient) ? form.patient[0] : form.patient;
  const doctor = Array.isArray(form.doctor) ? form.doctor[0] : form.doctor;
  const typeLabel = FORM_TYPE_LABELS[form.form_type as InsuranceClaimFormType] ?? form.form_type;
  const esc = (v: unknown) =>
    String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // form_data قد يكون كائنًا أو مصفوفة {label,value} حسب ما حفظته الواجهة
  const raw = form.form_data ?? {};
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((f: any) => [f?.label ?? "", f?.value ?? ""])
    : Object.entries(raw as Record<string, unknown>);
  const extraRows = entries
    .filter(([label]) => String(label).trim())
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join("");

  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title>${esc(typeLabel)} — ${esc(patient?.name_ar)}</title>
    <style>
      body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;padding:28px;color:#152f33}
      h1{font-size:19px;margin:0 0 2px}
      .muted{color:#5a6b70;font-size:12px;margin:0 0 16px}
      h2{font-size:14px;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #d8e3e1}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #d8e3e1;padding:7px;text-align:right;font-size:13px}
      th{background:#f0f6f5;width:34%}
      .sign{margin-top:36px;display:flex;justify-content:space-between;font-size:13px}
    </style></head><body>
    <h1>نموذج ${esc(typeLabel)}</h1>
    <p class="muted">رقم النموذج: ${esc(form.id)} · التاريخ: ${new Date(form.created_at).toLocaleDateString("ar-SA")}</p>

    <h2>بيانات المريض</h2>
    <table>
      <tr><th>الاسم</th><td>${esc(patient?.name_ar)}</td></tr>
      <tr><th>رقم الملف</th><td>${esc(patient?.file_number)}</td></tr>
      <tr><th>رقم الهوية</th><td>${esc(patient?.id_number)}</td></tr>
      <tr><th>تاريخ الميلاد</th><td>${esc(patient?.birth_date)}</td></tr>
    </table>

    <h2>بيانات التأمين</h2>
    <table>
      <tr><th>شركة التأمين</th><td>${esc(patient?.insurance_company_name)}</td></tr>
      <tr><th>رقم الوثيقة</th><td>${esc(patient?.insurance_policy_number)}</td></tr>
      <tr><th>رقم العضوية</th><td>${esc(patient?.insurance_membership_number)}</td></tr>
      <tr><th>الطبيب المعالج</th><td>${esc(doctor?.name_ar)}</td></tr>
    </table>

    ${extraRows ? `<h2>بيانات النموذج</h2><table>${extraRows}</table>` : ""}

    <div class="sign">
      <span>توقيع الطبيب: ..............................</span>
      <span>ختم المنشأة: ..............................</span>
    </div>
  </body></html>`);
  win.document.close();
  win.print();
}

function ClaimsTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const claims = useClaimForms(organization?.id, statusFilter);

  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectCode, setRejectCode] = useState("");
  const [rejectAmount, setRejectAmount] = useState("");
  const [rejectPartial, setRejectPartial] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["insurance-claim-forms"] });

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  /**
   * كل تغيير حالة يمرّ بـ`app_set_claim_form_status` (0089) لا بتحديث مباشر.
   *
   * التحديث المباشر كان يقبل أيّ قفزة — من مسوّدة إلى «موافق عليها» دون
   * إرسال — ولا يسجّل وقت التقديم ولا وقت الردّ ولا سببًا في التدقيق.
   */
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc("app_set_claim_form_status", {
        p_form_id: id,
        p_status: status,
        p_reason: null,
        p_amount: null,
        p_code: null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: fail("تعذر التحديث"),
  });

  const rejectClaim = useMutation({
    mutationFn: async () => {
      if (!rejectTarget) throw new Error("لا مطالبة محدَّدة");
      if (!rejectReason.trim()) throw new Error("اكتب سبب الرفض");
      if (rejectPartial && !rejectAmount) throw new Error("اكتب المبلغ المعتمَد");
      const { error } = await supabase.rpc("app_set_claim_form_status", {
        p_form_id: rejectTarget.id,
        p_status: rejectPartial ? "partially_approved" : "rejected",
        p_reason: rejectReason.trim(),
        p_amount: rejectPartial ? Number(rejectAmount) : null,
        p_code: rejectCode.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: rejectPartial ? "سُجّل الاعتماد الجزئي" : "سُجّل الرفض بسببه" });
      setRejectTarget(null);
      setRejectReason("");
      setRejectCode("");
      setRejectAmount("");
      setRejectPartial(false);
    },
    onError: fail("تعذر التسجيل"),
  });

  /**
   * إعادة التقديم تُنشئ **نسخة جديدة** وتترك الأصل مرفوضًا شاهدًا عليه.
   * تاريخُ ما قُدِّم ومتى ورُدَّ بأيّ سبب هو نصف الملفّ في أيّ نزاع مع شركة
   * تأمين، فلا يُعدَّل الأصل في مكانه.
   */
  const resubmit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_resubmit_claim_form", {
        p_form_id: id,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُنشئت مطالبة جديدة بسطور الأصل — راجعها ثم أرسلها" });
    },
    onError: fail("تعذرت إعادة التقديم"),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          مطالبة جديدة
        </Button>
      </div>

      <ClaimRegisterCard />

      <Card>
        <CardHeader>
          <CardTitle>نماذج المطالبات</CardTitle>
          <CardDescription>تُنشأ تلقائيًا عند فوترة كشفية تأمين، أو يدويًا من هنا</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {claims.isLoading &&
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {!claims.isLoading && (claims.data ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد نماذج مطابقة.</p>
          )}
          {(claims.data ?? []).map((form: any) => (
            <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold">
                  {form.patient?.name_ar ?? "—"} · {FORM_TYPE_LABELS[form.form_type as InsuranceClaimFormType]}
                </p>
                <p className="text-xs text-muted-foreground">
                  د. {form.doctor?.name_ar ?? "—"} · {new Date(form.created_at).toLocaleDateString("ar-SA")}
                  {form.auto_created && " · أُنشئ تلقائيًا"}
                  {form.resubmission_count > 0 && ` · المحاولة ${form.resubmission_count + 1}`}
                </p>
                {form.rejection_reason && (
                  <p className="text-xs text-rose-700">
                    سبب الردّ: {form.rejection_reason}
                    {form.rejection_code ? ` (${form.rejection_code})` : ""}
                    {form.approved_amount != null && ` · المعتمَد ${Number(form.approved_amount).toLocaleString("ar-SA")} ر.س`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={CLAIM_STATUS_BADGE[form.status as InsuranceClaimStatus]}>
                  {CLAIM_STATUS_LABELS[form.status as InsuranceClaimStatus]}
                </Badge>
                <Button size="sm" variant="ghost" title="طباعة النموذج" onClick={() => printClaimForm(form)}>
                  <Printer className="h-3.5 w-3.5" />
                </Button>
                {form.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: form.id, status: "submitted" })}>
                    إرسال
                  </Button>
                )}
                {form.status === "submitted" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: form.id, status: "approved" })}>
                      <Check className="h-3.5 w-3.5" />
                      موافقة
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setRejectTarget(form)}
                    >
                      <X className="h-3.5 w-3.5" />
                      ردّ الشركة
                    </Button>
                  </>
                )}
                {form.status === "approved" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: form.id, status: "paid" })}>
                    تسجيل السداد
                  </Button>
                )}
                {["rejected", "partially_approved"].includes(form.status) && (
                  <Button size="sm" variant="outline" onClick={() => resubmit.mutate(form.id)}>
                    <RefreshCcw className="h-3.5 w-3.5" />
                    إعادة تقديم
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(rejectTarget)} onOpenChange={(next) => !next && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ردّ شركة التأمين</DialogTitle>
            <DialogDescription>
              الرفض بلا سبب مكتوب لا يُبنى عليه اعتراض ولا إعادة تقديم — يبقى الأثر «مرفوضة» ولا
              أحد يعرف لماذا.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rejectPartial}
                onChange={(e) => setRejectPartial(e.target.checked)}
              />
              اعتماد جزئي (اعتُمد بعض المبلغ)
            </label>
            {rejectPartial && (
              <div className="flex flex-col gap-1.5">
                <Label>المبلغ المعتمَد *</Label>
                <Input type="number" min={0} value={rejectAmount} onChange={(e) => setRejectAmount(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>سبب الردّ *</Label>
              <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>كود الرفض لدى الشركة</Label>
              <Input value={rejectCode} onChange={(e) => setRejectCode(e.target.value)} dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectClaim.isPending}
              onClick={() => rejectClaim.mutate()}
            >
              {rejectClaim.isPending ? "جارٍ التسجيل..." : "تسجيل الردّ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewClaimFormDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function usePreauths(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["insurance-preauth", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_preauthorizations")
        .select(
          "id, service_description, requested_amount, approved_amount, status, requested_at, responded_at, approval_number, rejection_reason, valid_from, valid_to, consumed_at, note, item_id, item:items(id, name_ar), patient:patients(name_ar), doctor:doctors(name_ar), clinic:clinics(name)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("requested_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function PreauthTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [approvalNumbers, setApprovalNumbers] = useState<Record<string, string>>({});
  const preauths = usePreauths(organization?.id);

  const [validTo, setValidTo] = useState<Record<string, string>>({});
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  /**
   * الاعتماد والرفض يمرّان بـ`app_set_preauth_status` (0089).
   *
   * التحديث المباشر كان يقبل اعتمادًا بلا رقم موافقة من الشركة، ورفضًا بلا
   * سبب، ويسمح بتغيير القرار بعد الردّ. والأهمّ: الموافقة كانت بلا نافذة
   * سريان، فتبقى مفتوحة تسعين يومًا لأيّ خدمة.
   */
  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const { error } = await supabase.rpc("app_set_preauth_status", {
        p_preauth_id: id,
        p_status: status,
        p_reason: reason ?? null,
        p_amount: null,
        p_approval_number: status === "approved" ? approvalNumbers[id]?.trim() || null : null,
        p_valid_to: status === "approved" ? validTo[id] || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-preauth"] });
      toast({ title: "سُجّل ردّ شركة التأمين" });
      setRejectId(null);
      setRejectReason("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          طلب موافقة مسبقة
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>طلبات الموافقة المسبقة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {preauths.isLoading &&
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {!preauths.isLoading && (preauths.data ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد طلبات موافقة مسبقة.</p>
          )}
          {(preauths.data ?? []).map((item: any) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold">{item.patient?.name_ar ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.item?.name_ar ?? item.service_description ?? "—"} ·{" "}
                  {Number(item.requested_amount ?? 0).toLocaleString("ar-SA")} ر.س
                  {item.doctor?.name_ar && ` · د. ${item.doctor.name_ar}`}
                  {item.clinic?.name && ` · ${item.clinic.name}`}
                  {item.approval_number && ` · رقم الموافقة: ${item.approval_number}`}
                </p>
                {!item.item_id && item.status === "pending" && (
                  <p className="text-xs text-amber-700">
                    بلا خدمة محدَّدة — الموافقة لن تفتح أيّ خدمة، حدّد الخدمة قبل الاعتماد.
                  </p>
                )}
                {item.status === "approved" && (
                  <p className="text-xs text-emerald-700">
                    سارية {item.valid_from ?? "—"} ← {item.valid_to ?? "—"}
                    {item.consumed_at && " · استُهلكت"}
                  </p>
                )}
                {item.rejection_reason && (
                  <p className="text-xs text-rose-700">سبب الرفض: {item.rejection_reason}</p>
                )}
                {item.note && <p className="text-xs text-muted-foreground">ملاحظة: {item.note}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={item.status === "approved" ? "success" : item.status === "rejected" ? "destructive" : "secondary"}
                >
                  {PREAUTH_STATUS_LABELS[item.status as PreauthorizationStatus]}
                </Badge>
                {item.status === "pending" && (
                  <>
                    <Input
                      className="h-8 w-28"
                      placeholder="رقم الموافقة"
                      value={approvalNumbers[item.id] ?? ""}
                      onChange={(e) => setApprovalNumbers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                    <Input
                      className="h-8 w-36"
                      type="date"
                      title="سريان الموافقة حتى (الافتراضي ٩٠ يومًا)"
                      value={validTo[item.id] ?? ""}
                      onChange={(e) => setValidTo((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      title="اعتماد"
                      onClick={() => updateStatus.mutate({ id: item.id, status: "approved" })}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" title="رفض" onClick={() => setRejectId(item.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(rejectId)} onOpenChange={(next) => !next && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض الموافقة المسبقة</DialogTitle>
            <DialogDescription>السبب يُحفظ ويظهر للطبيب وللمريض عند الاستفسار.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>سبب الرفض *</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || updateStatus.isPending}
              onClick={() =>
                rejectId && updateStatus.mutate({ id: rejectId, status: "rejected", reason: rejectReason.trim() })
              }
            >
              تسجيل الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewPreauthDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function NewPreauthDialog({
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
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [note, setNote] = useState("");
  const [item, setItem] = useState<{ id: string; name_ar: string; price: number } | null>(null);
  const [membershipId, setMembershipId] = useState("");

  // خدمات تشترط موافقة مسبقة أوّلًا — وهي سبب وجود هذه الشاشة أصلًا.
  const services = useQuery({
    queryKey: ["preauth-services", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, price, requires_preauthorization")
        .eq("organization_id", organizationId)
        .eq("item_type", "service")
        .eq("is_archived", false)
        .eq("is_disabled", false)
        .order("requires_preauthorization", { ascending: false })
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string; price: number; requires_preauthorization: boolean }[];
    },
  });

  const memberships = useQuery({
    queryKey: ["preauth-memberships", patient?.id],
    enabled: open && Boolean(patient?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_insurance_status")
        .select("membership_id, company_name, policy_name, membership_number, remaining_amount, issue")
        .eq("patient_id", patient?.id);
      if (error) throw error;
      return (data ?? []) as {
        membership_id: string;
        company_name: string;
        policy_name: string;
        membership_number: string | null;
        remaining_amount: number | null;
        issue: string | null;
      }[];
    },
  });

  const doctors = useQuery({
    queryKey: ["doctors-select-preauth", organizationId],
    enabled: open && Boolean(organizationId),
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
  const clinics = useQuery({
    queryKey: ["clinics-select-preauth", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  /**
   * الخدمة **إلزامية** الآن.
   *
   * قبل 0089 كان الطلب يحمل «وصف خدمة» نصًّا حرًّا ولا يحمل معرّف الخدمة،
   * فكانت الموافقة عليه تفتح كلّ خدمة تشترط موافقة. الحقل النصّي بقي
   * للتفاصيل، والربط صار بالمعرّف.
   */
  const createPreauth = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر مريضًا أولًا");
      if (!item) throw new Error("اختر الخدمة المطلوب الموافقة عليها");
      const { error } = await supabase.from("insurance_preauthorizations").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        membership_id: membershipId || null,
        item_id: item.id,
        doctor_id: doctorId || null,
        clinic_id: clinicId || null,
        service_description: description.trim() || item.name_ar,
        requested_amount: amount ? Number(amount) : null,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-preauth"] });
      toast({ title: "تم إرسال طلب الموافقة المسبقة" });
      setPatient(null);
      setDescription("");
      setAmount("");
      setDoctorId("");
      setClinicId("");
      setNote("");
      setItem(null);
      setMembershipId("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>طلب موافقة مسبقة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>
          {patient && (memberships.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>العضوية التأمينية</Label>
              <Select value={membershipId} onValueChange={setMembershipId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر العضوية" />
                </SelectTrigger>
                <SelectContent>
                  {(memberships.data ?? []).map((m) => (
                    <SelectItem key={m.membership_id} value={m.membership_id}>
                      {m.company_name} — {m.policy_name}
                      {m.membership_number ? ` (${m.membership_number})` : ""}
                      {m.issue ? ` — ${m.issue}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {membershipId &&
                (memberships.data ?? []).find((m) => m.membership_id === membershipId)?.issue && (
                  <p className="text-xs text-amber-700">
                    {(memberships.data ?? []).find((m) => m.membership_id === membershipId)?.issue}
                  </p>
                )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>الخدمة المطلوبة *</Label>
            <Select
              value={item?.id ?? ""}
              onValueChange={(v) => {
                const found = (services.data ?? []).find((s) => s.id === v);
                setItem(found ? { id: found.id, name_ar: found.name_ar, price: found.price } : null);
                if (found && !amount) setAmount(String(found.price ?? ""));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر الخدمة" />
              </SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name_ar}
                    {s.requires_preauthorization ? " ⚠︎" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              الموافقة تخصّ هذه الخدمة وحدها ولا تفتح غيرها.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تفاصيل إضافية</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>المبلغ المطلوب</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب (اختياري)</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر طبيبًا" />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة (اختياري)</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر عيادة" />
              </SelectTrigger>
              <SelectContent>
                {(clinics.data ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!patient || !item || createPreauth.isPending} onClick={() => createPreauth.mutate()}>
            {createPreauth.isPending ? "جارٍ الحفظ..." : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// دفعات مطالبات التأمين (Claim Batches) — تجميع فواتير تأمين مستحقة لشركة
// واحدة في دفعة واحدة قابلة للتتبع عبر مراحل الإرسال/القبول/الرفض
// ---------------------------------------------------------------------------
const BATCH_STATUS_LABELS: Record<InsuranceClaimBatchStatus, string> = {
  draft: "مسودة",
  submitted: "مُرسلة",
  accepted: "مقبولة",
  rejected: "مرفوضة",
  partially_paid: "مدفوعة جزئيًا",
};
const BATCH_STATUS_VARIANT: Record<InsuranceClaimBatchStatus, "secondary" | "default" | "success" | "destructive"> = {
  draft: "secondary",
  submitted: "default",
  accepted: "success",
  rejected: "destructive",
  partially_paid: "default",
};

function useClaimBatches(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["insurance-claim-batches", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claim_batches")
        .select("*, company:insurance_companies(name_ar)")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function ClaimBatchesTab() {
  const { organization } = useOrganizationAccess();
  const batches = useClaimBatches(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [itemsFor, setItemsFor] = useState<{ id: string; batch_number: number } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const companies = useQuery({
    queryKey: ["insurance-companies-flat", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name_ar")
        .eq("organization_id", organization?.id)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: InsuranceClaimBatchStatus }) => {
      const { data, error } = await supabase
        .from("insurance_claim_batches")
        .update({ status, submitted_at: status === "submitted" ? new Date().toISOString() : undefined })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-claim-batches"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          دفعة مطالبات جديدة
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>دفعات مطالبات التأمين</CardTitle>
          <CardDescription>كل دفعة تجمع فواتير تأمين مستحقة لشركة واحدة لتقديمها معًا</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {batches.isLoading && <Skeleton className="h-24 w-full" />}
          {!batches.isLoading && (batches.data ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد دفعات مطالبات بعد.</p>
          )}
          {(batches.data ?? []).map((b: any) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold">
                  دفعة #{b.batch_number} · {b.company?.name_ar ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {b.period_start && b.period_end ? `${b.period_start} → ${b.period_end} · ` : ""}
                  الإجمالي: {Number(b.total_amount).toLocaleString("ar-SA")} ر.س
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={BATCH_STATUS_VARIANT[b.status as InsuranceClaimBatchStatus]}>
                  {BATCH_STATUS_LABELS[b.status as InsuranceClaimBatchStatus]}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setItemsFor({ id: b.id, batch_number: b.batch_number })}>
                  الفواتير
                </Button>
                {b.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: "submitted" })}>
                    إرسال للشركة
                  </Button>
                )}
                {b.status === "submitted" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: "accepted" })}>
                      قبول كامل
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: "partially_paid" })}>
                      مدفوعة جزئيًا
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus.mutate({ id: b.id, status: "rejected" })}>
                      رفض
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <NewBatchDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} companies={companies.data ?? []} />
      <BatchItemsDialog batch={itemsFor} onOpenChange={() => setItemsFor(null)} />
    </div>
  );
}

function NewBatchDialog({
  open,
  onOpenChange,
  organizationId,
  companies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  companies: { id: string; name_ar: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !companyId) throw new Error("اختر شركة التأمين");
      const { error } = await supabase.from("insurance_claim_batches").insert({
        organization_id: organizationId,
        company_id: companyId,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-claim-batches"] });
      toast({ title: "تم إنشاء الدفعة" });
      setCompanyId("");
      setPeriodStart("");
      setPeriodEnd("");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>دفعة مطالبات جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>شركة التأمين *</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر شركة" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>من تاريخ</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى تاريخ</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!companyId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchItemsDialog({
  batch,
  onOpenChange,
}: {
  batch: { id: string; batch_number: number } | null;
  onOpenChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<any[]>([]);

  const items = useQuery({
    queryKey: ["insurance-claim-batch-items", batch?.id],
    enabled: Boolean(batch?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claim_batch_items")
        .select("*, sales_invoices(invoice_number, net_amount, patient:patients(name_ar))")
        .eq("batch_id", batch!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["insurance-claim-batch-items", batch?.id] });
    queryClient.invalidateQueries({ queryKey: ["insurance-claim-batches"] });
  };

  const recalcTotal = async () => {
    if (!batch) return;
    const { data } = await supabase.from("insurance_claim_batch_items").select("amount").eq("batch_id", batch.id);
    const total = (data ?? []).reduce((sum, row: any) => sum + Number(row.amount), 0);
    await supabase.from("insurance_claim_batches").update({ total_amount: total }).eq("id", batch.id);
  };

  const searchInvoices = async () => {
    if (!invoiceSearch.trim()) return;
    /**
     * التقييد بالمؤسسة إلزامي: `invoice_number` فريد **داخل المؤسسة** فقط،
     * وسياسة RLS تسمح بكل مؤسسة ينتمي إليها المستخدم. بدونه كان البحث عن
     * الفاتورة 1001 يُظهر فاتورتين متطابقتين المظهر من منشأتين مختلفتين،
     * وإضافة الخطأ منهما تُدرج مبلغ منشأة أخرى في دفعة مطالبات هذه المنشأة
     * ثم يُرسَل الإجمالي إلى شركة التأمين.
     */
    const { data } = await supabase
      .from("sales_invoices")
      .select("id, invoice_number, net_amount, is_insurance_invoice, patient:patients!sales_invoices_patient_tenant_fk(name_ar)")
      .eq("organization_id", organization?.id)
      .eq("invoice_number", Number(invoiceSearch) || 0)
      .limit(5);
    setInvoiceResults(data ?? []);
  };

  const addItem = useMutation({
    mutationFn: async (invoice: { id: string; net_amount: number }) => {
      if (!batch) return;
      const { error } = await supabase
        .from("insurance_claim_batch_items")
        .insert({ batch_id: batch.id, sales_invoice_id: invoice.id, amount: invoice.net_amount });
      if (error) throw error;
      await recalcTotal();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تمت إضافة الفاتورة للدفعة" });
      setInvoiceResults([]);
      setInvoiceSearch("");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذرت الإضافة", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("insurance_claim_batch_items")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
      await recalcTotal();
    },
    onSuccess: invalidate,
  });

  const setItemStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase
        .from("insurance_claim_batch_items")
        .update({ status })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: invalidate,
  });

  return (
    <Dialog open={Boolean(batch)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>فواتير دفعة #{batch?.batch_number}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            placeholder="رقم الفاتورة"
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchInvoices()}
          />
          <Button variant="outline" onClick={searchInvoices}>
            بحث
          </Button>
        </div>
        {invoiceResults.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border p-2">
            {invoiceResults.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => addItem.mutate(inv)}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>
                  #{inv.invoice_number} · {inv.patient?.name_ar ?? "—"}
                </span>
                <span>{Number(inv.net_amount).toLocaleString("ar-SA")} ر.س</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {(items.data ?? []).map((item: any) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span>
                #{item.sales_invoices?.invoice_number} · {item.sales_invoices?.patient?.name_ar ?? "—"} ·{" "}
                {Number(item.amount).toLocaleString("ar-SA")} ر.س
              </span>
              <div className="flex items-center gap-1.5">
                <Select value={item.status} onValueChange={(v) => setItemStatus.mutate({ id: item.id, status: v })}>
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">قيد الانتظار</SelectItem>
                    <SelectItem value="accepted">مقبولة</SelectItem>
                    <SelectItem value="rejected">مرفوضة</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeItem.mutate(item.id)}>
                  حذف
                </Button>
              </div>
            </div>
          ))}
          {(items.data ?? []).length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">لا توجد فواتير في هذه الدفعة بعد.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// إعدادات التأمين — المحرِّر مشترك مع شاشة إعدادات التشغيل.
//
// كانت هنا نسخة ثانية كاملة من المحرِّر بقيم افتراضية معرَّفة مرتين، وكلتاهما
// `upsert` على نفس الصف — فتعديل في شاشة يُظهِر قيمة قديمة في الأخرى، وأول
// حفظ من إحداهما قد يدهس ما ضُبط في الأخرى. المكوّن الآن مستورد لا مكرَّر،
// فيبقى مدخلا الوصول قائمَين ومصدر الحقيقة واحدًا.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// العقود والتغطية — 0089
//
// قبل هذه المرحلة لم يكن في النظام شيء يربط شركة تأمين بقائمة أسعار متفق
// عليها ولا بمدّة سريان: التسعير يقفز إلى «قائمة التأمين» بلا عقدٍ يحكمها،
// ولا شيء يقول إن خدمةً مستثناة أو أن نسبة تحمّلها تختلف.
// ---------------------------------------------------------------------------
type ContractRow = {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  network_id: string | null;
  network_name: string | null;
  contract_number: string | null;
  name_ar: string;
  price_list_id: string | null;
  price_list_name: string | null;
  discount_percent: number;
  default_copay_percent: number | null;
  payment_terms_days: number | null;
  claim_submission_days: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  is_in_effect: boolean;
  days_to_expiry: number | null;
  coverage_rules_count: number;
  notes: string | null;
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  active: "ساري",
  suspended: "موقوف",
  expired: "منتهٍ",
  terminated: "مفسوخ",
};

const COVERAGE_LABELS: Record<string, string> = {
  covered: "مغطّى",
  excluded: "مستثنى",
  requires_preauth: "يشترط موافقة مسبقة",
};

const SCOPE_LABELS: Record<string, string> = {
  item: "خدمة بعينها",
  category: "فئة",
  service_type: "نوع خدمة",
  all: "كل الخدمات",
};

function useContracts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["insurance-contracts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_insurance_contracts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractRow[];
    },
  });
}

function ContractsTab() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const contracts = useContracts(organization?.id);
  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [coverageFor, setCoverageFor] = useState<ContractRow | null>(null);

  const canManage = can("insurance.contracts");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          العقد يحكم التسعير والتغطية ونسبة التحمّل — ولا يُقبل عقدان ساريان للشركة نفسها في
          المدّة نفسها.
        </p>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            عقد جديد
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>عقود شركات التأمين</CardTitle>
        </CardHeader>
        <CardContent>
          {contracts.isLoading && <Skeleton className="h-40 w-full" />}
          {!contracts.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الشركة</TableHead>
                  <TableHead>العقد</TableHead>
                  <TableHead>قائمة الأسعار</TableHead>
                  <TableHead>التحمّل</TableHead>
                  <TableHead>السريان</TableHead>
                  <TableHead>التغطية</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contracts.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.company_name}
                      {c.network_name && (
                        <span className="block text-xs text-muted-foreground">{c.network_name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.name_ar}
                      {c.contract_number && (
                        <span className="block text-xs text-muted-foreground">{c.contract_number}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.price_list_name ?? (
                        <span className="text-xs text-amber-700">بلا قائمة — يُستعمل خصم العقد فقط</span>
                      )}
                      {Number(c.discount_percent) > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          خصم {c.discount_percent}٪
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.default_copay_percent != null ? `${c.default_copay_percent}٪` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={c.is_in_effect ? "success" : "secondary"}>
                          {CONTRACT_STATUS_LABELS[c.status] ?? c.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {c.effective_from} ← {c.effective_to ?? "مفتوح"}
                        </span>
                        {c.days_to_expiry != null && c.days_to_expiry >= 0 && c.days_to_expiry <= 60 && (
                          <span className="text-xs text-amber-700">ينتهي خلال {c.days_to_expiry} يومًا</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setCoverageFor(c)}>
                        {c.coverage_rules_count} قاعدة
                      </Button>
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          تعديل
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(contracts.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عقود بعد. بلا عقدٍ ساري يرجع التسعير إلى قائمة التأمين أو الأساس.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ContractDialog
        open={createOpen || Boolean(editing)}
        contract={editing}
        organizationId={organization?.id}
        onOpenChange={(next) => {
          if (!next) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
      />
      <CoverageRulesDialog contract={coverageFor} onClose={() => setCoverageFor(null)} />
    </div>
  );
}

function ContractDialog({
  open,
  contract,
  organizationId,
  onOpenChange,
}: {
  open: boolean;
  contract: ContractRow | null;
  organizationId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = contract?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setForm({
      company_id: contract?.company_id ?? "",
      network_id: contract?.network_id ?? "",
      name_ar: contract?.name_ar ?? "",
      contract_number: contract?.contract_number ?? "",
      price_list_id: contract?.price_list_id ?? "",
      discount_percent: String(contract?.discount_percent ?? 0),
      default_copay_percent:
        contract?.default_copay_percent != null ? String(contract.default_copay_percent) : "",
      payment_terms_days: contract?.payment_terms_days != null ? String(contract.payment_terms_days) : "",
      claim_submission_days:
        contract?.claim_submission_days != null ? String(contract.claim_submission_days) : "",
      effective_from: contract?.effective_from ?? new Date().toISOString().slice(0, 10),
      effective_to: contract?.effective_to ?? "",
      status: contract?.status ?? "active",
      termination_reason: "",
      notes: contract?.notes ?? "",
    });
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const companies = useQuery({
    queryKey: ["contract-companies", organizationId],
    enabled: open && Boolean(organizationId),
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

  const networks = useQuery({
    queryKey: ["contract-networks", form.company_id],
    enabled: open && Boolean(form.company_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_networks")
        .select("id, name_ar")
        .eq("company_id", form.company_id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const priceLists = useQuery({
    queryKey: ["contract-price-lists", organizationId, form.company_id],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, name, list_kind, insurance_company_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        list_kind: string;
        insurance_company_id: string | null;
      }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!form.company_id) throw new Error("اختر شركة التأمين");
      if (!form.name_ar?.trim()) throw new Error("اسم العقد مطلوب");

      const payload = {
        organization_id: organizationId,
        company_id: form.company_id,
        network_id: form.network_id || null,
        name_ar: form.name_ar.trim(),
        contract_number: form.contract_number?.trim() || null,
        price_list_id: form.price_list_id || null,
        discount_percent: Number(form.discount_percent) || 0,
        default_copay_percent: form.default_copay_percent ? Number(form.default_copay_percent) : null,
        payment_terms_days: form.payment_terms_days ? Number(form.payment_terms_days) : null,
        claim_submission_days: form.claim_submission_days ? Number(form.claim_submission_days) : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        status: form.status,
        termination_reason: form.termination_reason?.trim() || null,
        notes: form.notes?.trim() || null,
      };

      if (contract) {
        const { data, error } = await supabase
          .from("insurance_contracts")
          .update(payload)
          .eq("id", contract.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يُحفظ التعديل — راجع صلاحيتك");
      } else {
        const { error } = await supabase.from("insurance_contracts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-contracts", organizationId] });
      toast({ title: contract ? "حُدِّث العقد" : "حُفظ العقد" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contract ? `تعديل: ${contract.name_ar}` : "عقد تأمين جديد"}</DialogTitle>
          <DialogDescription>
            سعر العقد يسبق قائمة التأمين وقائمة الفرع وقائمة الأساس. عقدان ساريان للشركة نفسها
            مرفوضان في القاعدة.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>شركة التأمين *</Label>
            <Select value={form.company_id ?? ""} onValueChange={(v) => set("company_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الشركة" />
              </SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الشبكة</Label>
            <Select
              value={form.network_id || "none"}
              onValueChange={(v) => set("network_id", v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="كل الشبكات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">كل الشبكات</SelectItem>
                {(networks.data ?? []).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم العقد *</Label>
            <Input value={form.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم العقد</Label>
            <Input
              value={form.contract_number ?? ""}
              onChange={(e) => set("contract_number", e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>قائمة الأسعار المتفق عليها</Label>
            <Select
              value={form.price_list_id || "none"}
              onValueChange={(v) => set("price_list_id", v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="بلا قائمة خاصة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بلا قائمة خاصة — يُطبَّق خصم العقد فقط</SelectItem>
                {(priceLists.data ?? []).map((pl) => (
                  <SelectItem key={pl.id} value={pl.id}>
                    {pl.name}
                    {pl.list_kind === "insurance" ? " (تأمين)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>خصم العقد ٪</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.discount_percent ?? "0"}
              onChange={(e) => set("discount_percent", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نسبة تحمّل المريض ٪</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.default_copay_percent ?? ""}
              onChange={(e) => set("default_copay_percent", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مهلة السداد (أيام)</Label>
            <Input
              type="number"
              min={0}
              value={form.payment_terms_days ?? ""}
              onChange={(e) => set("payment_terms_days", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مهلة تقديم المطالبة (أيام)</Label>
            <Input
              type="number"
              min={0}
              value={form.claim_submission_days ?? ""}
              onChange={(e) => set("claim_submission_days", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>يسري من *</Label>
            <Input
              type="date"
              value={form.effective_from ?? ""}
              onChange={(e) => set("effective_from", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حتى</Label>
            <Input
              type="date"
              value={form.effective_to ?? ""}
              onChange={(e) => set("effective_to", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الحالة</Label>
            <Select value={form.status ?? "active"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {["terminated", "suspended"].includes(form.status ?? "") &&
            contract?.status !== form.status && (
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>سبب الفسخ أو الإيقاف *</Label>
                <Textarea
                  rows={2}
                  value={form.termination_reason ?? ""}
                  onChange={(e) => set("termination_reason", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  عقدٌ ميت بلا سبب مكتوب أوّل ما يُسأل عنه حين تعود الشركة للتفاوض.
                </p>
              </div>
            )}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!form.company_id || !form.name_ar?.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoverageRulesDialog({
  contract,
  onClose,
}: {
  contract: ContractRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [scope, setScope] = useState("item");
  const [itemId, setItemId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [coverage, setCoverage] = useState("covered");
  const [copay, setCopay] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [maxCount, setMaxCount] = useState("");
  const [waitingDays, setWaitingDays] = useState("");
  const [note, setNote] = useState("");

  const canManage = can("insurance.contracts");

  const rules = useQuery({
    queryKey: ["coverage-rules", contract?.id],
    enabled: Boolean(contract?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_coverage_rules")
        .select(
          "id, scope, coverage, copay_percent, max_amount_per_service, max_count_per_year, waiting_period_days, medical_service_type, note_ar, is_active, item:items(name_ar)",
        )
        .eq("contract_id", contract?.id)
        .eq("is_active", true)
        .order("scope");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const services = useQuery({
    queryKey: ["coverage-services", contract?.organization_id],
    enabled: Boolean(contract?.organization_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar")
        .eq("organization_id", contract?.organization_id)
        .eq("item_type", "service")
        .eq("is_archived", false)
        .order("name_ar")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const addRule = useMutation({
    mutationFn: async () => {
      if (!contract) throw new Error("لا عقد محدَّد");
      if (scope === "item" && !itemId) throw new Error("اختر الخدمة");
      if (scope === "service_type" && !serviceType) throw new Error("اختر نوع الخدمة");
      const { error } = await supabase.from("insurance_coverage_rules").insert({
        organization_id: contract.organization_id,
        contract_id: contract.id,
        scope,
        item_id: scope === "item" ? itemId : null,
        medical_service_type: scope === "service_type" ? serviceType : null,
        coverage,
        copay_percent: copay ? Number(copay) : null,
        max_amount_per_service: maxAmount ? Number(maxAmount) : null,
        max_count_per_year: maxCount ? Number(maxCount) : null,
        waiting_period_days: waitingDays ? Number(waitingDays) : null,
        note_ar: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coverage-rules", contract?.id] });
      queryClient.invalidateQueries({ queryKey: ["insurance-contracts"] });
      toast({ title: "أُضيفت قاعدة التغطية" });
      setItemId("");
      setServiceType("");
      setCopay("");
      setMaxAmount("");
      setMaxCount("");
      setWaitingDays("");
      setNote("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذرت الإضافة",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const disableRule = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("insurance_coverage_rules")
        .update({ is_active: false })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coverage-rules", contract?.id] });
      queryClient.invalidateQueries({ queryKey: ["insurance-contracts"] });
    },
  });

  return (
    <Dialog open={Boolean(contract)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تغطية العقد: {contract?.name_ar}</DialogTitle>
          <DialogDescription>
            الأخصّ يغلب: قاعدة الخدمة تسبق قاعدة الفئة، والفئة تسبق نوع الخدمة، ونوع الخدمة يسبق
            «كل الخدمات».
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>النطاق</TableHead>
              <TableHead>التغطية</TableHead>
              <TableHead>التحمّل</TableHead>
              <TableHead>السقف</TableHead>
              <TableHead>العدد سنويًا</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rules.data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {SCOPE_LABELS[r.scope] ?? r.scope}
                  <span className="block text-xs text-muted-foreground">
                    {r.item?.name_ar ?? r.medical_service_type ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={r.coverage === "excluded" ? "destructive" : "secondary"}>
                    {COVERAGE_LABELS[r.coverage] ?? r.coverage}
                  </Badge>
                  {r.note_ar && <span className="block text-xs text-muted-foreground">{r.note_ar}</span>}
                </TableCell>
                <TableCell>{r.copay_percent != null ? `${r.copay_percent}٪` : "—"}</TableCell>
                <TableCell>{r.max_amount_per_service ?? "—"}</TableCell>
                <TableCell>
                  {r.max_count_per_year ?? "—"}
                  {r.waiting_period_days ? (
                    <span className="block text-xs text-muted-foreground">
                      انتظار {r.waiting_period_days} يومًا
                    </span>
                  ) : null}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => disableRule.mutate(r.id)}>
                      تعطيل
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {(rules.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="py-6 text-center text-sm text-muted-foreground">
                  لا قواعد بعد — كل الخدمات مغطّاة بنسبة تحمّل العقد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {canManage && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <h4 className="text-sm font-medium">قاعدة جديدة</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>النطاق</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS)
                      .filter(([v]) => v !== "category")
                      .map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>التغطية</Label>
                <Select value={coverage} onValueChange={setCoverage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COVERAGE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {scope === "item" && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>الخدمة *</Label>
                  <Select value={itemId} onValueChange={setItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الخدمة" />
                    </SelectTrigger>
                    <SelectContent>
                      {(services.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {scope === "service_type" && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>نوع الخدمة *</Label>
                  <Select value={serviceType} onValueChange={setServiceType}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر النوع" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ["consultation", "كشف"],
                        ["follow_up", "مراجعة"],
                        ["procedure", "إجراء"],
                        ["surgery", "جراحة"],
                        ["laboratory", "مختبر"],
                        ["radiology", "أشعة"],
                        ["dental", "أسنان"],
                        ["physiotherapy", "علاج طبيعي"],
                        ["vaccination", "تطعيم"],
                        ["nursing", "تمريض"],
                        ["dressing", "تضميد"],
                        ["injection", "حقن"],
                        ["screening", "فحص"],
                        ["home_visit", "زيارة منزلية"],
                        ["other", "أخرى"],
                      ].map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label>نسبة التحمّل ٪</Label>
                <Input type="number" min={0} max={100} value={copay} onChange={(e) => setCopay(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>سقف الخدمة</Label>
                <Input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>العدد المسموح سنويًا</Label>
                <Input type="number" min={0} value={maxCount} onChange={(e) => setMaxCount(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>فترة انتظار (أيام)</Label>
                <Input
                  type="number"
                  min={0}
                  value={waitingDays}
                  onChange={(e) => setWaitingDays(e.target.value)}
                  title="العضوية الحديثة لا تُغطّى قبل مرور هذه المدّة"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>ملاحظة تظهر للمستخدم</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={addRule.isPending} onClick={() => addRule.mutate()}>
                <Plus className="h-4 w-4" />
                إضافة القاعدة
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// التحقّق من التغطية قبل الحجز
//
// الخطوة التي كانت مفقودة تمامًا: قبل 0089 لم يكن في النظام شيء يجيب سؤال
// موظف الاستقبال البديهيّ — «هل هذه الخدمة مغطّاة لهذا المريض، وكم يدفع؟».
// كانت الإجابة تُكتشف عند الفوترة، بعد تنفيذ الخدمة.
// ---------------------------------------------------------------------------
function CoverageCheckCard() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [itemId, setItemId] = useState("");

  const memberships = useQuery({
    queryKey: ["coverage-check-memberships", patient?.id],
    enabled: Boolean(patient?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_insurance_status")
        .select(
          "membership_id, company_id, company_name, policy_name, network_name, class_name, membership_number, annual_limit, used_amount, remaining_amount, copay_percent, contract_name, has_active_contract, expiry_date, issue",
        )
        .eq("patient_id", patient?.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const services = useQuery({
    queryKey: ["coverage-check-services", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("item_type", "service")
        .eq("is_archived", false)
        .eq("is_disabled", false)
        .order("name_ar")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const membership = (memberships.data ?? []).find((m) => m.membership_id === membershipId);

  // السعر المُطبَّق فعلًا بترتيب: عقد الشركة ← قائمة التأمين ← الفرع ← الأساس
  const price = useQuery({
    queryKey: ["coverage-check-price", organizationId, itemId, membership?.company_id],
    enabled: Boolean(organizationId && itemId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_resolve_item_price_v2", {
        p_organization_id: organizationId,
        p_item_id: itemId,
        p_branch_id: null,
        p_insurance_company_id: membership?.company_id ?? null,
        p_external_client_id: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as {
        price: number;
        discount_percent: number;
        source_kind: string;
        source_list_name: string | null;
      } | null;
    },
  });

  const coverage = useQuery({
    queryKey: ["coverage-check", membershipId, itemId, price.data?.price],
    enabled: Boolean(membershipId && itemId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_insurance_coverage", {
        p_membership_id: membershipId,
        p_item_id: itemId,
        p_amount: price.data?.price ?? null,
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        covered: boolean;
        amount: number;
        copay_percent: number;
        patient_share: number;
        insurer_share: number;
        requires_preauth: boolean;
        has_preauth: boolean;
        approval_number: string | null;
        contract_name: string | null;
        annual_remaining: number | null;
        blocks: string[];
        warnings: string[];
      };
    },
  });

  const PRICE_SOURCE_LABELS: Record<string, string> = {
    contract: "قائمة العقد",
    insurance: "قائمة التأمين",
    corporate: "قائمة جهة",
    branch: "قائمة الفرع",
    base: "قائمة الأساس",
    item: "سعر الصنف",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>التحقّق من التغطية</CardTitle>
        <CardDescription>
          قبل الحجز لا بعد التنفيذ: هل الخدمة مغطّاة لهذا المريض، وكم يدفع، وهل تحتاج موافقة مسبقة
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker
              onSelect={(found) => {
                setPatient({ id: found.id, name_ar: found.name_ar });
                setMembershipId("");
              }}
            />
            {patient && <p className="text-xs text-emerald-700">{patient.name_ar}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العضوية التأمينية</Label>
            <Select value={membershipId} onValueChange={setMembershipId} disabled={!patient}>
              <SelectTrigger>
                <SelectValue placeholder={patient ? "اختر العضوية" : "اختر مريضًا أولًا"} />
              </SelectTrigger>
              <SelectContent>
                {(memberships.data ?? []).map((m) => (
                  <SelectItem key={m.membership_id} value={m.membership_id}>
                    {m.company_name} — {m.policy_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {patient && (memberships.data ?? []).length === 0 && !memberships.isLoading && (
              <p className="text-xs text-amber-700">لا عضوية تأمينية لهذا المريض — الحالة نقدية.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الخدمة</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الخدمة" />
              </SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {membership && (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={membership.has_active_contract ? "success" : "warning"}>
                {membership.has_active_contract ? `عقد: ${membership.contract_name}` : "لا عقد ساري"}
              </Badge>
              {membership.network_name && <Badge variant="secondary">{membership.network_name}</Badge>}
              {membership.class_name && <Badge variant="secondary">{membership.class_name}</Badge>}
              {membership.issue && <Badge variant="destructive">{membership.issue}</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              العضوية {membership.membership_number ?? "—"} · تنتهي {membership.expiry_date ?? "—"} · نسبة
              التحمّل {membership.copay_percent}٪
            </p>
            {membership.annual_limit != null && (
              <p className="text-xs text-muted-foreground">
                السقف السنوي {Number(membership.annual_limit).toLocaleString("ar-SA")} · المستهلك{" "}
                {Number(membership.used_amount ?? 0).toLocaleString("ar-SA")} · المتبقّي{" "}
                {Number(membership.remaining_amount ?? 0).toLocaleString("ar-SA")} ر.س
              </p>
            )}
          </div>
        )}

        {itemId && price.data && (
          <p className="text-xs text-muted-foreground">
            السعر المُطبَّق {Number(price.data.price).toLocaleString("ar-SA")} ر.س من{" "}
            {PRICE_SOURCE_LABELS[price.data.source_kind] ?? price.data.source_kind}
            {price.data.source_list_name ? ` — ${price.data.source_list_name}` : ""}
          </p>
        )}

        {coverage.isLoading && <Skeleton className="h-24 w-full" />}
        {coverage.data && (
          <div
            className={`rounded-md border p-3 ${
              coverage.data.covered ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
            }`}
          >
            <p className="text-sm font-semibold">
              {coverage.data.covered ? "مغطّاة" : "غير مغطّاة"}
              {coverage.data.requires_preauth &&
                (coverage.data.has_preauth
                  ? ` · موافقة سارية ${coverage.data.approval_number ?? ""}`
                  : " · تحتاج موافقة مسبقة")}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <span className="block text-xs text-muted-foreground">المبلغ</span>
                {Number(coverage.data.amount).toLocaleString("ar-SA")} ر.س
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  على المريض ({coverage.data.copay_percent}٪)
                </span>
                <span className="font-semibold">
                  {Number(coverage.data.patient_share).toLocaleString("ar-SA")} ر.س
                </span>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">على الشركة</span>
                {Number(coverage.data.insurer_share).toLocaleString("ar-SA")} ر.س
              </div>
            </div>
            {(coverage.data.blocks ?? []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-rose-800">
                {coverage.data.blocks.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {(coverage.data.warnings ?? []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
                {coverage.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// سجل المطالبات — ما رُدَّ، وما يحتاج إعادة تقديم، وما ركد
// ---------------------------------------------------------------------------
function ClaimRegisterCard() {
  const { organization } = useOrganizationAccess();
  const [filter, setFilter] = useState("attention");

  const register = useQuery({
    queryKey: ["claim-register", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_claim_register")
        .select("*")
        .eq("organization_id", organization?.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = (register.data ?? []).filter((r) => {
    if (filter === "attention") return r.needs_resubmission || r.is_stale;
    if (filter === "rejected") return ["rejected", "partially_approved"].includes(r.status);
    return true;
  });

  const totals = (register.data ?? []).reduce(
    (acc, r) => {
      acc.claimed += Number(r.claimed_amount ?? 0);
      acc.approved += Number(r.approved_amount ?? 0);
      acc.rejected += Number(r.rejected_amount ?? 0);
      return acc;
    },
    { claimed: 0, approved: 0, rejected: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل المطالبات</CardTitle>
        <CardDescription>
          المطالَب {totals.claimed.toLocaleString("ar-SA")} · المعتمَد{" "}
          {totals.approved.toLocaleString("ar-SA")} · المرفوض {totals.rejected.toLocaleString("ar-SA")} ر.س
        </CardDescription>
        <div className="mt-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="attention">تحتاج عملًا</SelectItem>
              <SelectItem value="rejected">مرفوضة أو جزئية</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {register.isLoading && <Skeleton className="h-32 w-full" />}
        {!register.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>الشركة</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الملاحظة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.form_id}>
                  <TableCell className="font-medium">
                    {r.patient_name}
                    {r.file_number && (
                      <span className="block text-xs text-muted-foreground">ملف {r.file_number}</span>
                    )}
                  </TableCell>
                  <TableCell>{r.company_name ?? "—"}</TableCell>
                  <TableCell>
                    {Number(r.claimed_amount ?? 0).toLocaleString("ar-SA")}
                    {r.approved_amount != null && (
                      <span className="block text-xs text-emerald-700">
                        معتمَد {Number(r.approved_amount).toLocaleString("ar-SA")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={CLAIM_STATUS_BADGE[r.status] ?? ""}>
                      {CLAIM_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.needs_resubmission && (
                      <span className="block text-rose-700">مرفوضة ولم يُعَد تقديمها</span>
                    )}
                    {r.is_stale && <span className="block text-amber-700">راكدة أكثر من ٣٠ يومًا</span>}
                    {r.rejection_reason && (
                      <span className="block text-muted-foreground">{r.rejection_reason}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا مطالبات تحتاج عملًا.
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
