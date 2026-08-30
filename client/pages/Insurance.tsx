import { useEffect, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Plus, Printer, ShieldCheck, X } from "lucide-react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import PatientPicker from "@/components/shared/PatientPicker";
import NewClaimFormDialog from "@/components/insurance/NewClaimFormDialog";
import { useInsuranceSettings } from "@/lib/insurance-settings";
import { InsuranceSettingsTab } from "@/pages/OperationsSettings";
import FormRequirementsTab from "@/components/insurance/FormRequirementsTab";
import { useToast } from "@/hooks/use-toast";

const CLAIM_STATUS_LABELS: Record<InsuranceClaimStatus, string> = {
  draft: "مسودة",
  submitted: "مُرسلة",
  approved: "موافق عليها",
  rejected: "مرفوضة",
};
const CLAIM_STATUS_BADGE: Record<InsuranceClaimStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
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
          <TabsTrigger value="claims">المطالبات</TabsTrigger>
          <TabsTrigger value="batches">دفعات المطالبات</TabsTrigger>
          <TabsTrigger value="preauth">الموافقات المسبقة</TabsTrigger>
          <TabsTrigger value="form-fields">خانات النماذج</TabsTrigger>
          <TabsTrigger value="settings">إعدادات التأمين</TabsTrigger>
        </TabsList>
        <TabsContent value="companies">
          <CompaniesTab />
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
          "id, form_type, status, auto_created, created_at, form_data, patient:patients(name_ar, file_number, id_number, birth_date, insurance_company_name, insurance_policy_number, insurance_membership_number), doctor:doctors(name_ar)",
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

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: InsuranceClaimStatus }) => {
      const { data, error } = await supabase
        .from("insurance_claim_forms")
        .update({ status })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-claim-forms"] }),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر التحديث", description: error instanceof Error ? error.message : "خطأ غير متوقع" }),
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
                </p>
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
                      onClick={() => updateStatus.mutate({ id: form.id, status: "rejected" })}
                    >
                      <X className="h-3.5 w-3.5" />
                      رفض
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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
          "id, service_description, requested_amount, status, requested_at, approval_number, note, patient:patients(name_ar), doctor:doctors(name_ar), clinic:clinics(name)",
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

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PreauthorizationStatus }) => {
      const { data, error } = await supabase
        .from("insurance_preauthorizations")
        .update({
          status,
          responded_at: new Date().toISOString(),
          approval_number: status === "approved" ? approvalNumbers[id]?.trim() || null : null,
        })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر رسالة
      // نجاح كاذبة ويعود الصف لحالته عند أول تحديث للقائمة.
      if (!data || data.length === 0) throw new Error("لم تُحفَظ العملية — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-preauth"] }),
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
                  {item.service_description ?? "—"} · {Number(item.requested_amount ?? 0).toLocaleString("ar-SA")} ر.س
                  {item.doctor?.name_ar && ` · د. ${item.doctor.name_ar}`}
                  {item.clinic?.name && ` · ${item.clinic.name}`}
                  {item.approval_number && ` · رقم الموافقة: ${item.approval_number}`}
                </p>
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
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: item.id, status: "approved" })}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus.mutate({ id: item.id, status: "rejected" })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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

  const createPreauth = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر مريضًا أولًا");
      const { error } = await supabase.from("insurance_preauthorizations").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        doctor_id: doctorId || null,
        clinic_id: clinicId || null,
        service_description: description.trim() || null,
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
          <div className="flex flex-col gap-1.5">
            <Label>وصف الخدمة المطلوبة</Label>
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
          <Button disabled={!patient || createPreauth.isPending} onClick={() => createPreauth.mutate()}>
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
    // كان هذا السطر بلا فحص خطأ إطلاقًا: فشل التحديث يترك **إجمالي دفعة
    // مطالبات** خاطئًا في الشاشة وفي المطالبة المُرسَلة لشركة التأمين، بلا
    // أي إشارة. الرقم مالي، فلا يجوز أن يفشل بصمت.
    const { data: updatedBatch, error: totalError } = await supabase
      .from("insurance_claim_batches")
      .update({ total_amount: total })
      .eq("id", batch.id)
      .select("id");
    if (totalError) throw totalError;
    if (!updatedBatch || updatedBatch.length === 0) {
      throw new Error("تعذر تحديث إجمالي الدفعة — راجع صلاحيتك ثم أعد الحساب");
    }
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
