import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Plus, ShieldCheck, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { InsuranceClaimFormType, InsuranceClaimStatus, PreauthorizationStatus } from "@/lib/database.types";
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
import PatientPicker from "@/components/shared/PatientPicker";
import NewClaimFormDialog from "@/components/insurance/NewClaimFormDialog";
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
          <TabsTrigger value="preauth">الموافقات المسبقة</TabsTrigger>
        </TabsList>
        <TabsContent value="companies">
          <CompaniesTab />
        </TabsContent>
        <TabsContent value="claims">
          <ClaimsTab />
        </TabsContent>
        <TabsContent value="preauth">
          <PreauthTab />
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
        .select("id, name_ar, phone, is_disabled, insurance_policies(id, policy_name, policy_number, default_copay_percent)")
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function CompaniesTab() {
  const { organization } = useOrganizationAccess();
  const companies = useCompanies(organization?.id);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [policyDialogFor, setPolicyDialogFor] = useState<string | null>(null);
  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);

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
              <Badge variant={company.is_disabled ? "secondary" : "success"}>
                {company.is_disabled ? "معطّلة" : "نشطة"}
              </Badge>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPolicyDialogFor(company.id)}>
              <Plus className="h-3.5 w-3.5" />
              بوليصة جديدة
            </Button>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(company.insurance_policies ?? []).map((policy: any) => (
              <Badge key={policy.id} variant="outline">
                {policy.policy_name} · خصم {policy.default_copay_percent}%
              </Badge>
            ))}
            {(company.insurance_policies ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">لا توجد بوالص لهذه الشركة بعد.</p>
            )}
          </CardContent>
        </Card>
      ))}
      {!companies.isLoading && (companies.data ?? []).length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">لا توجد شركات تأمين مسجّلة بعد.</p>
      )}

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
  const [phone, setPhone] = useState("");

  const createCompany = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase
        .from("insurance_companies")
        .insert({ organization_id: organizationId, name_ar: nameAr.trim(), phone: phone.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
      toast({ title: "تم حفظ شركة التأمين" });
      setNameAr("");
      setPhone("");
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
          <div className="flex flex-col gap-1.5">
            <Label>اسم الشركة *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم التواصل</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
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
  const [policyClass, setPolicyClass] = useState("");
  const [copay, setCopay] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");

  const createPolicy = useMutation({
    mutationFn: async () => {
      if (!organizationId || !companyId) throw new Error("بيانات غير مكتملة");
      const { error } = await supabase.from("insurance_policies").insert({
        organization_id: organizationId,
        company_id: companyId,
        policy_name: policyName.trim(),
        policy_class: policyClass.trim() || null,
        default_copay_percent: Number(copay) || 0,
        default_max_amount: maxAmount ? Number(maxAmount) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
      toast({ title: "تم حفظ البوليصة" });
      setPolicyName("");
      setPolicyClass("");
      setCopay("0");
      setMaxAmount("");
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
          <div className="flex flex-col gap-1.5">
            <Label>اسم البوليصة *</Label>
            <Input value={policyName} onChange={(e) => setPolicyName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفئة (Class)</Label>
            <Input value={policyClass} onChange={(e) => setPolicyClass(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>نسبة التحمل الافتراضية %</Label>
              <Input type="number" value={copay} onChange={(e) => setCopay(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأقصى (اختياري)</Label>
              <Input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
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

  const policies = useQuery({
    queryKey: ["insurance-policies-flat", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_policies")
        .select("id, policy_name, company:insurance_companies(name_ar)")
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "تم ربط المريض بوثيقة التأمين" });
      setPatient(null);
      setPolicyId("");
      setMembershipNumber("");
      setRelation("self");
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
          "id, form_type, status, auto_created, created_at, patient:patients(name_ar, file_number), doctor:doctors(name_ar)",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
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
      const { error } = await supabase.from("insurance_claim_forms").update({ status }).eq("id", id);
      if (error) throw error;
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
        .select("id, service_description, requested_amount, status, requested_at, patient:patients(name_ar)")
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
  const preauths = usePreauths(organization?.id);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PreauthorizationStatus }) => {
      const { error } = await supabase
        .from("insurance_preauthorizations")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
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
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={item.status === "approved" ? "success" : item.status === "rejected" ? "destructive" : "secondary"}
                >
                  {PREAUTH_STATUS_LABELS[item.status as PreauthorizationStatus]}
                </Badge>
                {item.status === "pending" && (
                  <>
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

  const createPreauth = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر مريضًا أولًا");
      const { error } = await supabase.from("insurance_preauthorizations").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        service_description: description.trim() || null,
        requested_amount: amount ? Number(amount) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-preauth"] });
      toast({ title: "تم إرسال طلب الموافقة المسبقة" });
      setPatient(null);
      setDescription("");
      setAmount("");
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
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ المطلوب</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
