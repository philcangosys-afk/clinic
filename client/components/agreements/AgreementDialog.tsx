import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileSignature, FileText, FolderOpen, Printer, Receipt, RefreshCw, Save } from "lucide-react";
import SignatureCanvas from "@/components/shared/SignatureCanvas";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { usePermissions } from "@/lib/permissions";
import { useMemberNames } from "@/lib/member-names";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useToast } from "@/hooks/use-toast";
import { printAgreement, useAgreement, useAgreementQuotes, type AgreementListRow } from "@/lib/agreements";
import QuoteEditorDialog, { useDoctorsAndClinics } from "@/components/agreements/QuoteEditorDialog";
import NewInvoiceDialog from "@/components/billing/NewInvoiceDialog";
import PatientPicker from "@/components/shared/PatientPicker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * تفاصيل الاتفاقية — كشاشة «تفاصيل الاتفاقية» في النظام المرجعيّ.
 *
 *   الرأس: المريض ورقم ملفّه وهويّته وجنسيّته، العيادة والطبيب المعالج،
 *          مسجِّل الاتفاقية وتاريخا الإنشاء والاتفاقية، نصّها وملاحظاتها
 *   الشبكة: عروض الأسعار التابعة لها بأرقامها — كلٌّ يُفتح ويُعدَّل ويُفوتَر
 *
 * الاتفاقية نفسها لا تحمل مالًا: أرقامها مجموع عروضها غير الملغاة، والمفوتر
 * منها يحسبه النظام من الفواتير المرتبطة — لا يُكتب باليد.
 */

const NONE = "__none__";

type PatientCard = {
  id: string;
  name_ar: string;
  file_number: number | string | null;
  id_number: string | null;
  nationality_value_id: string | null;
  treating_doctor_id: string | null;
  insurance_company_name: string | null;
  insurance_policy_number: string | null;
  insurance_policy_category: string | null;
  insurance_membership_number: string | null;
};

function usePatientCard(patientId: string | null | undefined) {
  return useQuery({
    queryKey: ["agreement-patient-card", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select(
          "id, name_ar, file_number, id_number, nationality_value_id, treating_doctor_id, insurance_company_name, insurance_policy_number, insurance_policy_category, insurance_membership_number",
        )
        .eq("id", patientId)
        .single();
      if (error) throw error;
      const patient = data as PatientCard;
      let nationality: string | null = null;
      if (patient.nationality_value_id) {
        const { data: lookup } = await supabase
          .from("lookup_values")
          .select("name_ar")
          .eq("id", patient.nationality_value_id)
          .maybeSingle();
        nationality = (lookup as { name_ar?: string } | null)?.name_ar ?? null;
      }
      return { ...patient, nationality };
    },
  });
}

const todayIso = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** إبطال كلّ ما يعرض أرقام الاتفاقيات بعد أيّ تغيير فيها. */
export function invalidateAgreementQueries(queryClient: ReturnType<typeof useQueryClient>, agreementId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ["agreement-list"] });
  queryClient.invalidateQueries({ queryKey: ["agreement-quotes"] });
  queryClient.invalidateQueries({ queryKey: ["agreement-quote-lines"] });
  queryClient.invalidateQueries({ queryKey: ["billing-agreement-items"] });
  queryClient.invalidateQueries({ queryKey: ["patient-agreements-context"] });
  queryClient.invalidateQueries({ queryKey: ["patient-open-agreements"] });
  queryClient.invalidateQueries({ queryKey: ["agreement-signature"] });
  if (agreementId) queryClient.invalidateQueries({ queryKey: ["agreement", agreementId] });
  else queryClient.invalidateQueries({ queryKey: ["agreement"] });
}

/**
 * إلغاء مديونية الاتفاقية أو إعادتها — كـ«إلغاء المديونية» في Kizen (0208).
 *
 * منفصلٌ عن التعطيل: الاتفاقية تبقى ظاهرةً بعروضها وما فُوتر منها، ومتبقّيها
 * يسقط من مطالبة المريض — لا ينبّه الاستقبال ولا يُعرض للفوترة. بسببٍ مكتوب،
 * ولمن يملك `agreements.cancel_debt` (مدير الفرع افتراضًا).
 */
export function AgreementDebtDialog({
  agreement,
  onOpenChange,
}: {
  agreement: Pick<AgreementListRow, "id" | "agreement_number" | "debt_cancelled" | "remaining_amount"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const cancelling = agreement ? !agreement.debt_cancelled : true;

  useEffect(() => {
    if (agreement) setReason("");
  }, [agreement?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!agreement) return;
      const { error } = await supabase.rpc("app_set_agreement_debt_cancelled", {
        p_agreement_id: agreement.id,
        p_cancelled: cancelling,
        p_reason: cancelling ? reason.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAgreementQueries(queryClient, agreement?.id);
      toast({ title: cancelling ? "أُلغيت مديونية الاتفاقية" : "أُعيدت مديونية الاتفاقية" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير مديونية الاتفاقية", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(agreement)} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {cancelling ? "إلغاء مديونية" : "إعادة مديونية"} الاتفاقية رقم {agreement?.agreement_number}
          </DialogTitle>
          <DialogDescription>
            {cancelling
              ? `يسقط متبقّيها (${formatAmount(agreement?.remaining_amount ?? 0)} ر.س) من مطالبة المريض: لا ينبّه الاستقبال ولا يُعرض للفوترة. الاتفاقية وما فُوتر منها باقيان.`
              : "يعود متبقّيها مطالبةً على المريض، قابلًا للفوترة."}
          </DialogDescription>
        </DialogHeader>
        {cancelling && (
          <div className="flex flex-col gap-1">
            <Label>سبب إلغاء المديونية</Label>
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button
            variant={cancelling ? "destructive" : "default"}
            disabled={mutation.isPending || (cancelling && !reason.trim())}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "جارٍ الحفظ…" : cancelling ? "إلغاء المديونية" : "إعادة المديونية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * توقيع المريض على الاتفاقية (0208) — يُرسم على الشاشة ويُحفظ صورةً، ويُطبع
 * على الاتفاقية. والتوقيع الخاطئ يُمسح ويُعاد، وكلاهما بسطر تدقيق.
 */
function AgreementSignatureDialog({
  agreement,
  canManage,
  onOpenChange,
}: {
  agreement: Pick<AgreementListRow, "id" | "agreement_number" | "patient_name" | "has_patient_signature" | "patient_signed_at"> | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drawn, setDrawn] = useState<string | null>(null);
  const existing = useQuery({
    queryKey: ["agreement-signature", agreement?.id],
    enabled: Boolean(agreement?.id && agreement?.has_patient_signature),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_agreements")
        .select("patient_signature")
        .eq("id", agreement!.id)
        .maybeSingle();
      if (error) throw error;
      return ((data as { patient_signature?: string | null } | null)?.patient_signature ?? null) || null;
    },
  });

  useEffect(() => {
    if (agreement) setDrawn(null);
  }, [agreement?.id]);

  const mutation = useMutation({
    mutationFn: async (signature: string | null) => {
      if (!agreement) return;
      const { error } = await supabase.rpc("app_sign_agreement", {
        p_agreement_id: agreement.id,
        p_signature: signature,
      });
      if (error) throw error;
    },
    onSuccess: (_data, signature) => {
      invalidateAgreementQueries(queryClient, agreement?.id);
      toast({ title: signature ? "حُفظ توقيع المريض" : "مُسح التوقيع" });
      if (signature) onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ التوقيع", description: errorMessage(error) }),
  });

  const signed = Boolean(agreement?.has_patient_signature);

  return (
    <Dialog open={Boolean(agreement)} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="w-[min(96vw,720px)] max-w-none">
        <DialogHeader>
          <DialogTitle>توقيع المريض على الاتفاقية رقم {agreement?.agreement_number}</DialogTitle>
          <DialogDescription>
            {agreement?.patient_name} — يوقّع بإصبعه أو بالقلم أو بالفأرة، ويُطبع التوقيع على الاتفاقية.
          </DialogDescription>
        </DialogHeader>
        {signed && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <span className="text-xs text-muted-foreground">
              موقّعة{agreement?.patient_signed_at ? ` — ${new Date(agreement.patient_signed_at).toLocaleString("ar-SA")}` : ""}
            </span>
            {existing.data && <img src={existing.data} alt="توقيع المريض" className="h-24 w-auto self-start bg-white" />}
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="self-start text-destructive"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(null)}
              >
                مسح التوقيع
              </Button>
            )}
          </div>
        )}
        {canManage && (
          <>
            <Label>{signed ? "توقيعٌ جديد بدل الحالي" : "التوقيع"}</Label>
            <SignatureCanvas onChange={setDrawn} />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          {canManage && (
            <Button disabled={!drawn || mutation.isPending} onClick={() => mutation.mutate(drawn)}>
              {mutation.isPending ? "جارٍ الحفظ…" : "حفظ التوقيع"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * تعطيل الاتفاقية أو تفعيلها — بسببٍ مكتوب عند التعطيل.
 *
 * المعطّلة لا تُفوتَر ولا تُعدَّل عروضها، ويبقى ما فُوتر منها كما هو.
 * ولا حذف: اتفاقيةٌ فُوتر منها أثرٌ ماليّ لا يُمحى.
 */
export function AgreementDisableDialog({
  agreement,
  onOpenChange,
}: {
  agreement: Pick<AgreementListRow, "id" | "agreement_number" | "is_disabled"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const disabling = agreement ? !agreement.is_disabled : true;

  useEffect(() => {
    if (agreement) setReason("");
  }, [agreement?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!agreement) return;
      const { error } = await supabase.rpc("app_set_agreement_disabled", {
        p_agreement_id: agreement.id,
        p_disabled: disabling,
        p_reason: disabling ? reason.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAgreementQueries(queryClient, agreement?.id);
      toast({ title: disabling ? "عُطّلت الاتفاقية" : "فُعّلت الاتفاقية" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير حالة الاتفاقية", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(agreement)} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {disabling ? "تعطيل" : "تفعيل"} الاتفاقية رقم {agreement?.agreement_number}
          </DialogTitle>
          <DialogDescription>
            {disabling
              ? "المعطّلة لا تُفوتَر ولا تُعدَّل عروضها، ويبقى ما فُوتر منها كما هو."
              : "تعود الاتفاقية قابلةً للفوترة والتعديل."}
          </DialogDescription>
        </DialogHeader>
        {disabling && (
          <div className="flex flex-col gap-1">
            <Label>سبب التعطيل</Label>
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button
            variant={disabling ? "destructive" : "default"}
            disabled={mutation.isPending || (disabling && !reason.trim())}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "جارٍ الحفظ…" : disabling ? "تعطيل" : "تفعيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AgreementDialog({
  open,
  onOpenChange,
  organizationId,
  agreementId,
  patientId: fixedPatientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** `null` = اتفاقية جديدة. */
  agreementId: string | null;
  /** مريضٌ محدَّد سلفًا (من ملفّه) — وإلّا يُختار من البحث. */
  patientId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { organization, session } = useOrganizationAccess();
  const canManage = can("agreements.manage");
  const canCancelDebt = can("agreements.cancel_debt");

  const [currentId, setCurrentId] = useState<string | null>(agreementId);
  const [pickedPatientId, setPickedPatientId] = useState<string | null>(fixedPatientId ?? null);
  const [doctorId, setDoctorId] = useState(NONE);
  const [clinicId, setClinicId] = useState(NONE);
  const [registrarId, setRegistrarId] = useState(NONE);
  const [agreementDate, setAgreementDate] = useState(todayIso());
  const [agreementText, setAgreementText] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quoteEditor, setQuoteEditor] = useState<{ open: boolean; quoteId: string | null }>({ open: false, quoteId: null });
  const [invoiceQuoteId, setInvoiceQuoteId] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<AgreementListRow | null>(null);
  const [debtTarget, setDebtTarget] = useState<AgreementListRow | null>(null);
  const [signatureTarget, setSignatureTarget] = useState<AgreementListRow | null>(null);

  const agreement = useAgreement(currentId);
  const quotes = useAgreementQuotes(currentId);
  const patientId = agreement.data?.patient_id ?? pickedPatientId;
  const patient = usePatientCard(patientId);
  const lists = useDoctorsAndClinics(organizationId);
  const members = useMemberNames(organizationId);

  useEffect(() => {
    if (open) {
      setCurrentId(agreementId);
      setPickedPatientId(fixedPatientId ?? null);
      setSelectedQuoteId(null);
      setLoadedFor(null);
    }
  }, [open, agreementId, fixedPatientId]);

  // تعبئة الرأس مرّةً لكلّ اتفاقيةٍ تُفتح
  useEffect(() => {
    if (!open) return;
    const key = currentId ?? `new:${pickedPatientId ?? ""}`;
    if (loadedFor === key) return;
    if (currentId) {
      const row = agreement.data;
      if (!row) return;
      setDoctorId(row.doctor_id ?? NONE);
      setClinicId(row.clinic_id ?? NONE);
      setRegistrarId(row.registrar_id ?? NONE);
      setAgreementDate(row.agreement_date?.slice(0, 10) ?? todayIso());
      setAgreementText(row.agreement_text ?? "");
      setNote(row.note ?? "");
    } else {
      if (pickedPatientId && !patient.data) return;
      setDoctorId(patient.data?.treating_doctor_id ?? NONE);
      setClinicId(NONE);
      setRegistrarId(session?.user?.id ?? NONE);
      setAgreementDate(todayIso());
      setAgreementText("");
      setNote("");
    }
    setDirty(false);
    setLoadedFor(key);
  }, [open, currentId, pickedPatientId, agreement.data, patient.data, loadedFor]);

  const row = agreement.data ?? null;
  const readOnly = !canManage || Boolean(row?.is_disabled);
  const quoteRows = quotes.data ?? [];
  const activeQuotes = quoteRows.filter((quote) => !quote.is_cancelled);
  const totals = activeQuotes.reduce(
    (sum, quote) => ({
      gross: sum.gross + Number(quote.gross_amount),
      discount: sum.discount + Number(quote.discount_amount),
      taxable: sum.taxable + Number(quote.taxable_amount),
      vat: sum.vat + Number(quote.vat_amount),
      net: sum.net + Number(quote.net_amount),
      invoiced: sum.invoiced + Number(quote.invoiced_amount),
      remaining: sum.remaining + Number(quote.remaining_amount),
    }),
    { gross: 0, discount: 0, taxable: 0, vat: 0, net: 0, invoiced: 0, remaining: 0 },
  );

  const memberOptions = Array.from((members.data ?? new Map<string, string>()).entries()).sort((a, b) =>
    a[1].localeCompare(b[1], "ar"),
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا منشأة نشطة");
      if (!patientId) throw new Error("اختر المريض أوّلًا");
      const { data, error } = await supabase.rpc("app_save_agreement", {
        p_organization_id: organizationId,
        p_agreement_id: currentId,
        p_patient_id: patientId,
        p_doctor_id: doctorId === NONE ? null : doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_agreement_date: agreementDate || null,
        p_agreement_text: agreementText,
        p_note: note,
        p_registrar_id: registrarId === NONE ? null : registrarId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (savedId) => {
      const wasNew = !currentId;
      setCurrentId(savedId);
      setLoadedFor(savedId);
      setDirty(false);
      invalidateAgreementQueries(queryClient, savedId);
      toast({ title: wasNew ? "أُنشئت الاتفاقية" : "حُفظت الاتفاقية" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الاتفاقية", description: errorMessage(error) }),
  });

  /** عرض سعرٍ جديد لاتفاقيةٍ لم تُحفظ: تُحفظ أوّلًا فيكون للعرض رأسٌ يتبعه. */
  const addQuote = async () => {
    if (!currentId || dirty) {
      try {
        await save.mutateAsync();
      } catch {
        return;
      }
    }
    setQuoteEditor({ open: true, quoteId: null });
  };

  const openSelectedQuote = () => {
    if (selectedQuoteId) setQuoteEditor({ open: true, quoteId: selectedQuoteId });
  };

  const refresh = () => {
    invalidateAgreementQueries(queryClient, currentId);
    patient.refetch();
  };

  const print = async () => {
    if (!row) return;
    try {
      await printAgreement(row, organization?.name ?? "");
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّرت الطباعة", description: errorMessage(error) });
    }
  };

  const createdAt = row?.created_at ? new Date(row.created_at).toLocaleString("ar-SA") : "—";
  const title = currentId ? `تفاصيل الاتفاقية رقم ${row?.agreement_number ?? "…"}` : "اتفاقية جديدة";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="max-h-[95vh] w-[min(96vw,1200px)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {title}
              {row?.is_disabled && (
                <Badge variant="secondary">معطّلة{row.disabled_reason ? ` — ${row.disabled_reason}` : ""}</Badge>
              )}
              {row?.debt_cancelled && (
                <Badge variant="outline" className="border-rose-400 text-rose-700">
                  أُلغيت مديونيتها{row.debt_cancel_reason ? ` — ${row.debt_cancel_reason}` : ""}
                </Badge>
              )}
              {row?.has_patient_signature && (
                <Badge variant="outline" className="border-emerald-400 text-emerald-700">موقّعة من المريض</Badge>
              )}
              {dirty && (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  تعديلات لم تُحفظ
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              اتفاقٌ مرن مع المريض على الخدمات وأسعارها قبل أيّ فاتورة ضريبية — يُعدَّل بعروض الأسعار التابعة له.
            </DialogDescription>
          </DialogHeader>

          {/* ── شريط الأوامر ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
            <Button size="sm" disabled={readOnly || !patientId || save.isPending} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" />
              {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
            <Button size="sm" variant="outline" disabled={readOnly || !patientId || save.isPending} onClick={() => void addQuote()}>
              <FilePlus2 className="h-4 w-4" />
              إضافة عرض سعر جديد
            </Button>
            <Button size="sm" variant="outline" disabled={!selectedQuoteId} onClick={openSelectedQuote}>
              <FolderOpen className="h-4 w-4" />
              فتح عرض السعر المحدد
            </Button>
            {patientId && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/patients/${patientId}?section=invoices`} onClick={() => onOpenChange(false)}>
                  <Receipt className="h-4 w-4" />
                  فواتير المريض
                </Link>
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!row} onClick={() => row && setSignatureTarget(row)}>
              <FileSignature className="h-4 w-4" />
              توقيع المريض
            </Button>
            <Button size="sm" variant="ghost" disabled={!currentId} onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
              تحديث
            </Button>
            <Button size="sm" variant="ghost" disabled={!row} onClick={() => void print()}>
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
          </div>

          {/* ── اختيار المريض لاتفاقيةٍ جديدة من خارج ملفّه ──────────── */}
          {!currentId && !fixedPatientId && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">المريض</Label>
              <PatientPicker
                placeholder="ابحث بالاسم أو الجوال أو رقم الملف…"
                onSelect={(picked) => {
                  setPickedPatientId(picked.id);
                  setLoadedFor(null);
                }}
              />
            </div>
          )}

          {currentId && agreement.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <div className="flex flex-col gap-1 lg:col-span-2">
                <Label className="text-xs">اسم المريض</Label>
                <Input value={patient.data?.name_ar ?? row?.patient_name ?? ""} disabled placeholder="—" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">رقم الملف</Label>
                <Input value={String(patient.data?.file_number ?? row?.file_number ?? "")} disabled dir="ltr" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">رقم الهوية</Label>
                <Input value={patient.data?.id_number ?? ""} disabled dir="ltr" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">الجنسية</Label>
                <Input value={patient.data?.nationality ?? ""} disabled />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">رقم الاتفاقية</Label>
                <Input value={row?.agreement_number ? String(row.agreement_number) : "يُرقَّم عند الحفظ"} disabled dir="ltr" />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">العيادة</Label>
                <Select value={clinicId} onValueChange={(value) => { setClinicId(value); setDirty(true); }} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— بلا عيادة —</SelectItem>
                    {(lists.data?.clinics ?? []).map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">الطبيب المعالج</Label>
                <Select value={doctorId} onValueChange={(value) => { setDoctorId(value); setDirty(true); }} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— بلا طبيب —</SelectItem>
                    {(lists.data?.doctors ?? []).map((doctor) => (
                      <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">مسجِّل الاتفاقية</Label>
                <Select value={registrarId} onValueChange={(value) => { setRegistrarId(value); setDirty(true); }} disabled={readOnly}>
                  <SelectTrigger><SelectValue placeholder={row?.registrar_name ?? "—"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{row?.registrar_name ?? "— من أنشأها —"}</SelectItem>
                    {memberOptions.map(([userId, name]) => (
                      <SelectItem key={userId} value={userId}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">تاريخ الإنشاء</Label>
                <Input value={createdAt} disabled />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">تاريخ الاتفاقية</Label>
                <Input
                  type="date"
                  value={agreementDate}
                  disabled={readOnly}
                  onChange={(event) => { setAgreementDate(event.target.value); setDirty(true); }}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Checkbox
                  id="agreement-disabled"
                  checked={Boolean(row?.is_disabled)}
                  disabled={!canManage || !row}
                  onCheckedChange={() => row && setDisableTarget(row)}
                />
                <Label htmlFor="agreement-disabled" className="text-sm">معطّلة</Label>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Checkbox
                  id="agreement-debt-cancelled"
                  checked={Boolean(row?.debt_cancelled)}
                  disabled={!canCancelDebt || !row}
                  title={canCancelDebt ? "" : "لمن يملك صلاحية «إلغاء مديونية الاتفاقية»"}
                  onCheckedChange={() => row && setDebtTarget(row)}
                />
                <Label htmlFor="agreement-debt-cancelled" className="text-sm">إلغاء المديونية</Label>
              </div>

              <div className="col-span-2 flex flex-col gap-1 md:col-span-4 lg:col-span-3">
                <Label className="text-xs">نصّ الاتفاقية</Label>
                <Textarea
                  rows={3}
                  value={agreementText}
                  disabled={readOnly}
                  placeholder="ما اتُّفق عليه مع المريض: خطة العلاج، الدفعات، الشروط…"
                  onChange={(event) => { setAgreementText(event.target.value); setDirty(true); }}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1 md:col-span-4 lg:col-span-3">
                <Label className="text-xs">ملاحظات</Label>
                <Textarea rows={3} value={note} disabled={readOnly} onChange={(event) => { setNote(event.target.value); setDirty(true); }} />
              </div>
            </div>
          )}

          {/* ── عروض الأسعار ─────────────────────────────────────── */}
          <div className="flex items-center gap-2 pt-2 text-sm font-semibold">
            <FileText className="h-4 w-4" />
            عروض الأسعار
            <span className="text-xs font-normal text-muted-foreground">— انقر صفًّا لتحديده، ومرّتين لفتحه</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1000px] text-sm [&_th]:whitespace-nowrap">
              <thead className="bg-muted/60 text-xs">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>الطبيب</th>
                  <th>العيادة</th>
                  <th>ملاحظات</th>
                  <th>الإجمالي</th>
                  <th>الخصومات</th>
                  <th>قبل الضريبة</th>
                  <th>الضريبة</th>
                  <th>الصافي</th>
                  <th>المفوتر</th>
                  <th>المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {!currentId && (
                  <tr>
                    <td colSpan={12} className="py-6 text-center text-muted-foreground">
                      احفظ الاتفاقية أو اضغط «إضافة عرض سعر جديد» — تُحفظ ثم يُفتح العرض.
                    </td>
                  </tr>
                )}
                {currentId && quotes.isLoading && (
                  <tr>
                    <td colSpan={12} className="p-2"><Skeleton className="h-16 w-full" /></td>
                  </tr>
                )}
                {currentId && !quotes.isLoading && quoteRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-6 text-center text-muted-foreground">لا عروض أسعار بعد.</td>
                  </tr>
                )}
                {quoteRows.map((quote) => (
                  <tr
                    key={quote.id}
                    className={`cursor-pointer border-t tabular-nums [&>td]:px-2 [&>td]:py-1.5 ${
                      selectedQuoteId === quote.id ? "bg-primary/10" : "hover:bg-muted/40"
                    } ${quote.is_cancelled ? "text-muted-foreground line-through" : ""}`}
                    onClick={() => setSelectedQuoteId(quote.id)}
                    onDoubleClick={() => setQuoteEditor({ open: true, quoteId: quote.id })}
                  >
                    <td className="font-mono">{quote.quote_number}</td>
                    <td className="whitespace-nowrap text-xs">{new Date(quote.quote_date).toLocaleString("ar-SA")}</td>
                    <td>{quote.doctor_name ?? "—"}</td>
                    <td>{quote.clinic_name ?? "—"}</td>
                    <td className="max-w-[12rem] truncate" title={quote.note ?? ""}>
                      {quote.is_cancelled ? `ملغى — ${quote.cancel_reason ?? ""}` : quote.note ?? ""}
                    </td>
                    <td>{formatAmount(quote.gross_amount)}</td>
                    <td className="text-rose-700">{formatAmount(quote.discount_amount)}</td>
                    <td>{formatAmount(quote.taxable_amount)}</td>
                    <td>{formatAmount(quote.vat_amount)}</td>
                    <td className="font-semibold">{formatAmount(quote.net_amount)}</td>
                    <td className="text-emerald-700">{formatAmount(quote.invoiced_amount)}</td>
                    <td className={Number(quote.remaining_amount) > 0 ? "font-semibold text-amber-700" : ""}>
                      {formatAmount(quote.remaining_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {activeQuotes.length > 0 && (
                <tfoot className="border-t bg-muted/40 font-semibold tabular-nums">
                  <tr className="[&>td]:px-2 [&>td]:py-2">
                    <td colSpan={5}>الإجمالي — {activeQuotes.length} عرض</td>
                    <td>{formatAmount(totals.gross)}</td>
                    <td className="text-rose-700">{formatAmount(totals.discount)}</td>
                    <td>{formatAmount(totals.taxable)}</td>
                    <td>{formatAmount(totals.vat)}</td>
                    <td>{formatAmount(totals.net)}</td>
                    <td className="text-emerald-700">{formatAmount(totals.invoiced)}</td>
                    <td>{formatAmount(totals.remaining)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {row && quoteEditor.open && (
        <QuoteEditorDialog
          open={quoteEditor.open}
          onOpenChange={(value) => setQuoteEditor((prev) => ({ ...prev, open: value }))}
          organizationId={organizationId}
          agreement={row}
          quoteId={quoteEditor.quoteId}
          onSaved={(savedId) => {
            setSelectedQuoteId(savedId);
            setQuoteEditor({ open: true, quoteId: savedId });
          }}
          onInvoice={(quoteId) => {
            setQuoteEditor({ open: false, quoteId });
            setInvoiceQuoteId(quoteId);
          }}
        />
      )}

      {/* «فوترة»: نافذة الفاتورة نفسها بكلّ قواعدها، وفيها ما لم يُفوتَر من العرض */}
      {row && invoiceQuoteId && patient.data && organizationId && (
        <NewInvoiceDialog
          open={Boolean(invoiceQuoteId)}
          onOpenChange={(value) => {
            if (!value) {
              setInvoiceQuoteId(null);
              invalidateAgreementQueries(queryClient, row.id);
            }
          }}
          organizationId={organizationId}
          vatRate={organization?.default_vat_rate ?? 15}
          agreementQuoteId={invoiceQuoteId}
          appointment={{
            id: null,
            patient_id: row.patient_id,
            // طبيب العرض وعيادته أولى من طبيب الاتفاقية: قد يتولّى العرضَ غيرُه
            doctor_id: quoteRows.find((quote) => quote.id === invoiceQuoteId)?.doctor_id ?? row.doctor_id,
            clinic_id: quoteRows.find((quote) => quote.id === invoiceQuoteId)?.clinic_id ?? row.clinic_id,
            patient: {
              id: patient.data.id,
              name_ar: patient.data.name_ar,
              insurance_company_name: patient.data.insurance_company_name,
              insurance_policy_number: patient.data.insurance_policy_number,
              insurance_policy_category: patient.data.insurance_policy_category,
              insurance_membership_number: patient.data.insurance_membership_number,
            },
          }}
        />
      )}

      <AgreementDisableDialog agreement={disableTarget} onOpenChange={(value) => !value && setDisableTarget(null)} />
      <AgreementDebtDialog agreement={debtTarget} onOpenChange={(value) => !value && setDebtTarget(null)} />
      <AgreementSignatureDialog
        agreement={signatureTarget}
        canManage={canManage}
        onOpenChange={(value) => !value && setSignatureTarget(null)}
      />
    </>
  );
}
