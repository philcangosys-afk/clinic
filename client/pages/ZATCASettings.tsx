import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  FileKey2,
  Loader2,
  MonitorCog,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * إعداد الربط مع ZATCA — الفوترة الإلكترونية، المرحلة الثانية.
 *
 * منقولةٌ من الصفحة المُجرَّبة في زين ERP بتسلسلها نفسه. كل عمليةٍ تمرّ عبر
 * الدالّة الطرفية `zatca-onboarding` وحدها — لا استعلام من المتصفّح على
 * جداول ZATCA (هي للخادم أصلًا، 0178). والصفحة لا تستقبل ولا تعرض مفتاحًا
 * خاصًّا ولا CSID كاملًا ولا سرًّا: نسخة مقنّعة فقط.
 *
 * التسلسل: بيانات المنشأة ← CSR داخل الخادم ← OTP يدويّ من بوّابة فاتورة ←
 * شهادة التوافق ← اختبارات التوافق بالترتيب ← شهادة الإنتاج ← تفعيلٌ صريح
 * بعبارةٍ تُكتب حرفيًّا وتُفحص في الخادم أيضًا.
 */

type SetupStatus =
  | "identity_saved"
  | "csr_generated"
  | "compliance_ready"
  | "compliance_testing"
  | "compliance_passed"
  | "failed";

type ZatcaMode = "simulation" | "production";

type ComplianceResult = {
  caseIndex?: number;
  documentType: string;
  label: string;
  status: "pending" | "testing" | "passed" | "failed";
  message?: string;
  httpStatus?: number;
  invoiceHash?: string;
  validationResults?: {
    errorMessages?: Array<{ code?: string; message?: string }>;
    warningMessages?: Array<{ code?: string; message?: string }>;
  };
};

type SetupMetadata = {
  id: string;
  mode: ZatcaMode;
  company_name_ar: string;
  company_name_en?: string | null;
  vat_number: string;
  vat_effective_date?: string | null;
  commercial_registration: string;
  branch_name: string;
  branch_location: string;
  building_number?: string | null;
  street_name?: string | null;
  district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  additional_number?: string | null;
  short_address?: string | null;
  industry: string;
  device_manufacturer: string;
  device_model: string;
  device_serial: string;
  common_name: string;
  invoice_type: "1000" | "0100" | "1100";
  status: SetupStatus;
  compliance_request_id?: string | null;
  compliance_csid_masked?: string | null;
  compliance_issued_at?: string | null;
  production_request_id?: string | null;
  production_csid_masked?: string | null;
  production_issued_at?: string | null;
  certificate_expires_at?: string | null;
  production_status?: "not_requested" | "issued" | "failed";
  production_enabled?: boolean;
  compliance_results?: ComplianceResult[];
  last_error?: string | null;
  updated_at?: string;
};

type IdentityForm = {
  companyNameAr: string;
  companyNameEn: string;
  vatNumber: string;
  commercialRegistration: string;
  branchName: string;
  buildingNumber: string;
  streetName: string;
  district: string;
  city: string;
  postalCode: string;
  additionalNumber: string;
  shortAddress: string;
  vatEffectiveDate: string;
  industry: string;
  deviceManufacturer: string;
  deviceModel: string;
  deviceSerial: string;
  commonName: string;
  invoiceType: "1000" | "0100" | "1100";
};

type IdentityDefaults = Partial<
  Pick<
    IdentityForm,
    | "companyNameAr"
    | "companyNameEn"
    | "vatNumber"
    | "vatEffectiveDate"
    | "commercialRegistration"
    | "buildingNumber"
    | "streetName"
    | "district"
    | "city"
    | "postalCode"
    | "additionalNumber"
  >
>;

/** العبارة التي تفتح الإرسال الحقيقي — تُفحص هنا وفي الخادم معًا. */
const ACTIVATION_PHRASE = "ENABLE_REAL_ZATCA_PRODUCTION";

const blankIdentity = (branchName: string): IdentityForm => ({
  companyNameAr: "",
  companyNameEn: "",
  vatNumber: "",
  commercialRegistration: "",
  branchName: branchName || "الفرع الرئيسي",
  buildingNumber: "",
  streetName: "",
  district: "",
  city: "",
  postalCode: "",
  additionalNumber: "",
  shortAddress: "",
  vatEffectiveDate: "",
  industry: "",
  deviceManufacturer: "ZainCare",
  deviceModel: "Web EGS V1",
  deviceSerial: "ZC-EGS-001",
  commonName: "ZC-EGS-001",
  invoiceType: "1100",
});

const complianceDocuments = [
  { caseIndex: 0, scope: "standard", label: "فاتورة ضريبية معيارية B2B" },
  { caseIndex: 1, scope: "standard", label: "إشعار دائن معياري B2B" },
  { caseIndex: 2, scope: "standard", label: "إشعار مدين معياري B2B" },
  { caseIndex: 3, scope: "simplified", label: "فاتورة ضريبية مبسطة B2C" },
  { caseIndex: 4, scope: "simplified", label: "إشعار دائن مبسط B2C" },
  { caseIndex: 5, scope: "simplified", label: "إشعار مدين مبسط B2C" },
] as const;

const onboardingSteps = [
  { number: 1, label: "بيانات المنشأة", Icon: Building2 },
  { number: 2, label: "OTP وتهيئة الجهاز", Icon: FileKey2 },
  { number: 3, label: "شهادة التوافق", Icon: ShieldCheck },
  { number: 4, label: "اختبارات التوافق", Icon: MonitorCog },
  { number: 5, label: "اعتماد تشغيل المحاكاة التجريبي", Icon: ShieldCheck },
];

const statusLabels: Record<SetupStatus, string> = {
  identity_saved: "تم حفظ بيانات المنشأة",
  csr_generated: "CSR جاهز — بانتظار OTP",
  compliance_ready: "تم الحصول على Compliance CSID",
  compliance_testing: "جاري فحص التوافق",
  compliance_passed: "اجتاز فحص التوافق",
  failed: "آخر محاولة تهيئة لم تنجح",
};

const auditActionLabels: Record<string, string> = {
  csr_generated: "توليد CSR والمفتاح الخاص",
  compliance_csid_requested: "طلب شهادة التوافق من ZATCA",
  "compliance_test_standard-invoice": "فحص فاتورة معيارية B2B",
  "compliance_test_standard-credit": "فحص إشعار دائن معياري B2B",
  "compliance_test_standard-debit": "فحص إشعار مدين معياري B2B",
  "compliance_test_simplified-invoice": "فحص فاتورة مبسطة B2C",
  "compliance_test_simplified-credit": "فحص إشعار دائن مبسط B2C",
  "compliance_test_simplified-debit": "فحص إشعار مدين مبسط B2C",
  production_csid_requested: "طلب شهادة الإنتاج",
  branch_location_updated: "تحديث عنوان الفواتير المسجل",
  production_activated: "تفعيل الإنتاج الحقيقي يدويًا",
  production_deactivated: "تعطيل الإنتاج الحقيقي",
  onboarding_archived: "أرشفة تهيئة سابقة",
};

function getAuditDetailMessage(item: any) {
  if (item?.result !== "failed") return "";
  const details = item?.details ?? {};
  const response = details?.response ?? {};
  const errors = Array.isArray(response?.errors)
    ? response.errors.map((error: unknown) =>
        typeof error === "string" ? error : String((error as { message?: unknown })?.message ?? ""),
      )
    : [];
  return [
    details?.errorCode,
    details?.errorMessage,
    details?.code,
    details?.message,
    response?.code,
    response?.message,
    response?.dispositionMessage,
    ...errors,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" — ");
}

/** الجهاز الإنتاجي النشط يُتذكّر لكل منشأة — تفضيل عرضٍ لا أكثر. */
const activeDeviceKey = (organizationId: string) => `zatca-active-production-device:${organizationId}`;
function readActiveDevice(organizationId: string | undefined) {
  if (!organizationId) return null;
  try {
    return window.localStorage.getItem(activeDeviceKey(organizationId));
  } catch {
    return null;
  }
}
function writeActiveDevice(organizationId: string | undefined, serial: string | null) {
  if (!organizationId) return;
  try {
    if (serial) window.localStorage.setItem(activeDeviceKey(organizationId), serial);
    else window.localStorage.removeItem(activeDeviceKey(organizationId));
  } catch {
    // التخزين المحلي قد يكون محجوبًا — لا يؤثّر إلا على تذكّر الجهاز
  }
}

type Busy =
  | "prepare"
  | "address"
  | "onboard"
  | "refresh"
  | "compliance"
  | "production"
  | "activate"
  | "deactivate"
  | "reset"
  | null;

export default function ZATCASettings() {
  const { organization, branch } = useOrganizationAccess();
  const { toast } = useToast();
  const organizationId = organization?.id;

  const [identity, setIdentity] = useState<IdentityForm>(() => blankIdentity(branch?.name ?? ""));
  const [selectedMode, setSelectedMode] = useState<ZatcaMode>("simulation");
  const [setup, setSetup] = useState<SetupMetadata | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [otp, setOtp] = useState("");
  const [activationPhrase, setActivationPhrase] = useState("");
  const [legalEnglishConfirmed, setLegalEnglishConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Busy>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const invoke = async (body: Record<string, unknown>, mode: ZatcaMode = selectedMode, serial?: string) => {
    if (!organizationId) throw new Error("لا توجد منشأة نشطة");
    const { data, error } = await supabase.functions.invoke("zatca-onboarding", {
      body: {
        ...body,
        mode,
        organizationId,
        deviceSerial: serial ?? identity.deviceSerial,
      },
    });
    if (error || data?.error) {
      let payload = data;
      /**
       * **جسمُ الخطأ يُقرأ بحذر:** `FunctionsHttpError.context` استجابةٌ
       * (`Response`) في أغلب إصدارات `supabase-js`، وفي بعضها كائنٌ عاديّ.
       * واستدعاء `clone()` عليه حين لا يكون استجابةً يرمي
       * «t.clone is not a function» — فتُخفي رسالةُ المعالج رسالةَ الخطأ
       * الحقيقية القادمة من الدالّة الطرفية، وهي ما يحتاجه المستخدم.
       */
      const context: any = (error as { context?: unknown } | null)?.context;
      if (!payload && context) {
        payload = await (async () => {
          try {
            if (typeof context.clone === "function") return await context.clone().json();
            if (typeof context.json === "function") return await context.json();
            if (typeof context.text === "string") return JSON.parse(context.text);
            if (typeof context === "object") return context;
          } catch {
            return null;
          }
          return null;
        })();
      }
      const response = payload?.details?.response;
      const responseErrors = Array.isArray(response?.errors)
        ? response.errors
            .map((item: unknown) =>
              typeof item === "string" ? item : String((item as { message?: unknown })?.message ?? ""),
            )
            .filter(Boolean)
        : [];
      const messages = [payload?.error, payload?.message, response?.dispositionMessage, response?.message, ...responseErrors]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
      const safeMessage = [...new Set(messages)].join(" — ");
      throw new Error(
        safeMessage ||
          (error?.message?.includes("Failed to send")
            ? "تعذّر الوصول إلى دالّة zatca-onboarding — تأكّد من نشرها على Supabase"
            : "لم تكتمل العملية. راجع سجل التهيئة أدناه."),
      );
    }
    return data;
  };

  const applySetupToForm = (data: any, mode: ZatcaMode) => {
    const defaults: IdentityDefaults = data?.defaults ?? {};
    if (data?.setup) {
      const s: SetupMetadata = data.setup;
      if (mode === "production" && s.device_serial) writeActiveDevice(organizationId, s.device_serial);
      setIdentity({
        companyNameAr: s.company_name_ar ?? "",
        companyNameEn: s.company_name_en ?? "",
        vatNumber: s.vat_number ?? "",
        commercialRegistration: s.commercial_registration ?? "",
        branchName: s.branch_name ?? "",
        buildingNumber: s.building_number ?? "",
        streetName: s.street_name ?? "",
        district: s.district ?? "",
        city: s.city ?? "",
        postalCode: s.postal_code ?? "",
        additionalNumber: s.additional_number ?? "",
        shortAddress: s.short_address ?? "",
        vatEffectiveDate: s.vat_effective_date ?? "",
        industry: s.industry ?? "",
        deviceManufacturer: s.device_manufacturer ?? "",
        deviceModel: s.device_model ?? "",
        deviceSerial: s.device_serial ?? "",
        commonName: s.common_name ?? "",
        invoiceType: s.invoice_type ?? "1100",
      });
      // بيانات محفوظة سابقًا بعد تأكيدٍ صريح — التأكيد يبقى قائمًا ما لم يُعدَّل الاسم
      setLegalEnglishConfirmed(Boolean(s.company_name_en));
    } else {
      // لا تهيئة بعد: بيانات «إعدادات الضريبة» تُقترح، ويُطلب تأكيد الاسم الإنجليزي
      const blank = blankIdentity(branch?.name ?? "");
      const activeSerial = mode === "production" ? readActiveDevice(organizationId) : null;
      setIdentity({
        ...blank,
        ...Object.fromEntries(Object.entries(defaults).filter(([, value]) => Boolean(value))),
        ...(activeSerial ? { deviceSerial: activeSerial, commonName: activeSerial } : {}),
      });
      setLegalEnglishConfirmed(false);
    }
  };

  const loadStatus = async (quiet = false, mode: ZatcaMode = selectedMode) => {
    if (!quiet) setAction("refresh");
    try {
      const serial = mode === "production" ? readActiveDevice(organizationId) ?? identity.deviceSerial : undefined;
      const data = await invoke({ action: "status" }, mode, serial);
      setSetup(data.setup ?? null);
      setAudit(data.audit ?? []);
      applySetupToForm(data, mode);
      if (!quiet) {
        toast({
          title: "الاتصال الآمن يعمل",
          description: data.setup
            ? `حالة التهيئة: ${statusLabels[data.setup.status as SetupStatus] ?? data.setup.status}`
            : "لا توجد تهيئة سابقة. راجع البيانات ثم ولّد CSR.",
        });
      }
    } catch (error) {
      if (!quiet) {
        toast({
          title: "تعذر تحميل حالة ZATCA",
          description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
          variant: "destructive",
        });
      } else {
        setSetup(null);
        applySetupToForm(null, mode);
      }
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    void loadStatus(true);
    // المنشأة وحدها تستدعي إعادة التحميل
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const requiredComplianceDocuments = useMemo(() => {
    const invoiceType = setup?.invoice_type ?? identity.invoiceType;
    return complianceDocuments.filter((document) => {
      if (invoiceType === "1000") return document.scope === "standard";
      if (invoiceType === "0100") return document.scope === "simplified";
      return true;
    });
  }, [identity.invoiceType, setup?.invoice_type]);

  const setField = <K extends keyof IdentityForm>(key: K, value: IdentityForm[K]) =>
    setIdentity((current) => ({ ...current, [key]: value }));

  /** الخادم يعيد تجميع العنوان من هذه الحقول نفسها بصيغةٍ واحدة. */
  const addressPayload = {
    buildingNumber: identity.buildingNumber,
    streetName: identity.streetName,
    district: identity.district,
    city: identity.city,
    postalCode: identity.postalCode,
    additionalNumber: identity.additionalNumber,
    shortAddress: identity.shortAddress,
  };

  const failToast = (title: string, fallback: string) => (error: unknown) =>
    toast({
      title,
      description: error instanceof Error ? error.message : fallback,
      variant: "destructive",
    });

  const prepare = async () => {
    if (!legalEnglishConfirmed) {
      toast({
        title: "يلزم تأكيد الاسم الإنجليزي",
        description: "راجع الاسم الإنجليزي وعدّله إن لزم، ثم فعّل خانة التأكيد.",
        variant: "destructive",
      });
      return;
    }
    setAction("prepare");
    try {
      await invoke({ action: "prepare", ...identity, ...addressPayload, branchId: branch?.id ?? null });
      toast({
        title: selectedMode === "production" ? "تم إعداد CSR إنتاج منفصل" : "تم تجهيز جهاز المحاكاة",
        description:
          selectedMode === "production"
            ? "حُفظت بيانات الإنتاج وأُعدّ CSR منفصل دون طلب OTP أو تفعيل الإنتاج."
            : "حُفظت بيانات المحاكاة وأُعدّ CSR دون طلب OTP.",
      });
      if (selectedMode === "production") writeActiveDevice(organizationId, identity.deviceSerial);
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر تجهيز الجهاز", "تحقق من البيانات")(error);
    } finally {
      setAction(null);
    }
  };

  const saveBranchLocation = async () => {
    setAction("address");
    try {
      await invoke({ action: "update_branch_location", ...addressPayload });
      toast({ title: "تم حفظ العنوان", description: "تم تحديث حقول عنوان الفواتير المسجلة." });
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر حفظ العنوان", "تحقق من العنوان المسجل")(error);
    } finally {
      setAction(null);
    }
  };

  const onboard = async () => {
    if (!/^\d{6}$/.test(otp)) {
      toast({ title: "رمز غير صالح", description: "أدخل رمز OTP المكون من 6 أرقام", variant: "destructive" });
      return;
    }
    setAction("onboard");
    const code = otp;
    // الرمز لا يبقى في الواجهة لحظةً بعد الضغط
    setOtp("");
    try {
      await invoke({ action: "onboard", otp: code });
      toast({
        title: selectedMode === "production" ? "تم إصدار شهادة التوافق للإنتاج" : "نجحت تهيئة المحاكاة",
        description: "عولج رمز OTP مرة واحدة ولم يُحفظ في أي مكان.",
      });
      await loadStatus(true);
    } catch (error) {
      failToast("رفضت ZATCA طلب التهيئة", "تحقق من OTP والبيانات")(error);
      await loadStatus(true);
    } finally {
      setAction(null);
    }
  };

  const activateProduction = async () => {
    if (!setup?.production_csid_masked || activationPhrase !== ACTIVATION_PHRASE) return;
    setAction("activate");
    try {
      await invoke({ action: "activate_production", confirmation: activationPhrase });
      setActivationPhrase("");
      toast({ title: "تم تفعيل الإنتاج الحقيقي", description: "اكتمل التفعيل الصريح بعد تحقّق الخادم." });
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر تفعيل الإنتاج الحقيقي", "حدث خطأ أثناء التفعيل")(error);
    } finally {
      setAction(null);
    }
  };

  const deactivateProduction = async () => {
    setAction("deactivate");
    try {
      await invoke({ action: "deactivate_production" });
      toast({ title: "تم تعطيل الإنتاج الحقيقي", description: "أُوقف الإرسال الحقيقي لهذا الجهاز." });
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر تعطيل الإنتاج الحقيقي", "حدث خطأ أثناء التعطيل")(error);
    } finally {
      setAction(null);
    }
  };

  const requestProductionCsid = async () => {
    setAction("production");
    try {
      await invoke({ action: "request_production_csid" });
      toast({
        title: selectedMode === "production" ? "تم إصدار Production CSID الحقيقي" : "تم إصدار اعتماد تشغيل المحاكاة",
        description:
          selectedMode === "production"
            ? "حُفظ الاعتماد داخل Vault، والإرسال الحقيقي ما زال معطّلًا حتى التفعيل الصريح."
            : "هذا اعتماد تجريبي داخل المحاكاة وليس اعتماد إنتاج.",
      });
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر إصدار Production CSID", "حدث خطأ أثناء الطلب")(error);
      await loadStatus(true);
    } finally {
      setAction(null);
    }
  };

  const resetOnboarding = async () => {
    setResetOpen(false);
    setAction("reset");
    try {
      await invoke({ action: "reset_onboarding" });
      setSetup(null);
      setAudit([]);
      setOtp("");
      if (selectedMode === "production") writeActiveDevice(organizationId, null);
      toast({
        title: "تم بدء تهيئة جديدة",
        description: "أُرشفت التهيئة السابقة ومُحيت أسرارها — جهّز الجهاز من جديد.",
      });
      await loadStatus(true);
    } catch (error) {
      failToast("تعذر بدء تهيئة جديدة", "حدث خطأ أثناء إعادة التهيئة")(error);
    } finally {
      setAction(null);
    }
  };

  const runComplianceTests = async () => {
    if (!setup || !["compliance_ready", "compliance_testing", "compliance_passed"].includes(setup.status)) return;
    setAction("compliance");
    try {
      let passed = 0;
      // بالترتيب، وتتوقّف عند أول فشل: كل حالةٍ تحتاج بصمة سابقتها
      for (const document of requiredComplianceDocuments) {
        const data = await invoke({ action: "run_compliance_case", caseIndex: document.caseIndex });
        if (data.result?.status === "passed") passed += 1;
        setSetup((current) =>
          current
            ? {
                ...current,
                status: data.status as SetupStatus,
                compliance_results: [
                  ...(current.compliance_results ?? []).filter((item) => item.caseIndex !== document.caseIndex),
                  data.result as ComplianceResult,
                ].sort((a, b) => Number(a.caseIndex ?? 0) - Number(b.caseIndex ?? 0)),
              }
            : current,
        );
        if (data.result?.status !== "passed") break;
      }
      await loadStatus(true);
      toast({
        title: passed === requiredComplianceDocuments.length ? "اجتاز النظام فحص التوافق" : "اكتمل فحص التوافق",
        description: `نجح ${passed} من ${requiredComplianceDocuments.length} مستندات`,
        variant: passed === requiredComplianceDocuments.length ? "default" : "destructive",
      });
    } catch (error) {
      await loadStatus(true);
      failToast("تعذر إكمال فحص التوافق", "حدث خطأ أثناء الفحص")(error);
    } finally {
      setAction(null);
    }
  };

  const step = useMemo(() => {
    if (!setup) return 1;
    if (setup.status === "csr_generated" || setup.status === "failed") return 2;
    if (setup.status === "compliance_ready" || setup.status === "compliance_testing") return 4;
    if (setup.production_csid_masked) return 5;
    if (setup.status === "compliance_passed") return 4;
    return 1;
  }, [setup]);

  const productionCsrPrepared =
    selectedMode === "production" &&
    setup?.mode === "production" &&
    ["csr_generated", "compliance_ready", "compliance_testing", "compliance_passed", "failed"].includes(setup.status);
  const productionCsidExists = selectedMode === "production" && Boolean(setup?.production_csid_masked);
  const addressComplete = [
    identity.buildingNumber,
    identity.streetName,
    identity.district,
    identity.city,
    identity.postalCode,
    identity.additionalNumber,
    identity.shortAddress,
  ].every(Boolean);
  const busy = Boolean(action);

  const switchMode = (mode: ZatcaMode) => {
    setSelectedMode(mode);
    setSetup(null);
    setAudit([]);
    setOtp("");
    setActivationPhrase("");
    void loadStatus(false, mode);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">الفاتورة الإلكترونية — المرحلة الثانية</p>
          <h1 className="mt-1 text-2xl font-bold">إعداد الربط مع ZATCA</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            إعداد منفصل وآمن للمحاكاة أو للإنتاج الحقيقي. لا تُرسل فواتير ولا يُطلب OTP تلقائيًا، ولا تُعرض
            المفاتيح أو الأسرار أو CSID الكامل.
          </p>
        </div>
        <Button variant="outline" onClick={() => loadStatus()} disabled={busy}>
          <RefreshCw className={cn("h-4 w-4", action === "refresh" && "animate-spin")} />
          تحديث الحالة
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {[
          { mode: "simulation" as const, title: "المحاكاة", description: "تهيئة واختبارات تجريبية مع ZATCA Simulation فقط." },
          {
            mode: "production" as const,
            title: "الإنتاج الحقيقي",
            description: "اعتماد حقيقي قد يسمح بإرسال فواتير ملزمة قانونيًا بعد التفعيل الصريح.",
          },
        ].map((environment) => (
          <button
            key={environment.mode}
            type="button"
            disabled={busy}
            onClick={() => switchMode(environment.mode)}
            className={cn(
              "rounded-xl border-2 p-5 text-start transition disabled:opacity-50",
              selectedMode === environment.mode
                ? environment.mode === "production"
                  ? "border-rose-500 bg-rose-50"
                  : "border-primary bg-primary/5"
                : "border-border bg-card hover:border-muted-foreground/40",
            )}
          >
            <strong className="block text-lg">{environment.title}</strong>
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{environment.description}</span>
          </button>
        ))}
      </section>

      {selectedMode === "production" && (
        <section className="flex gap-3 rounded-xl border-2 border-rose-400 bg-rose-50 p-5 text-rose-950">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <strong className="block">تحذير: هذه بيئة الإنتاج الحقيقي</strong>
            <p className="mt-1 text-sm leading-6">
              التحضير وحده لا يفعّل الإنتاج ولا يرسل أي فاتورة. استخدم CSR وOTP واعتماد إنتاج منفصلين، ثم نفّذ
              التفعيل اليدوي فقط بعد التحقق الكامل.
            </p>
          </div>
        </section>
      )}

      {selectedMode === "simulation" && (
        <section className="grid gap-3 md:grid-cols-5">
          {onboardingSteps.map(({ number, label, Icon }) => {
            const active = step >= number;
            return (
              <div
                key={number}
                className={cn("rounded-xl border p-4", active ? "border-primary/30 bg-primary/5" : "bg-card")}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-full",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step > number ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </span>
                  <div>
                    <small className="text-muted-foreground">الخطوة {number}</small>
                    <strong className="block text-sm">{label}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {setup && (
        <section
          className={cn(
            "rounded-xl border p-4",
            setup.status === "failed" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className={setup.status === "failed" ? "text-rose-600" : "text-emerald-600"} />
              <div>
                <strong className="block">{statusLabels[setup.status]}</strong>
                <span className="text-xs text-muted-foreground">
                  البيئة: {selectedMode === "simulation" ? "المحاكاة فقط" : "الإنتاج الحقيقي"} — الجهاز{" "}
                  <span dir="ltr">{setup.device_serial}</span>
                </span>
              </div>
            </div>
            {setup.compliance_csid_masked && (
              <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold" dir="ltr">
                Compliance CSID: {setup.compliance_csid_masked}
              </span>
            )}
          </div>
          {setup.last_error && (
            <div className="mt-3 rounded-lg bg-white/70 p-3 text-sm text-rose-700">
              <strong className="block">آخر رد محفوظ من المحاولة السابقة</strong>
              <span className="mt-1 block break-words" dir="auto">
                {setup.last_error}
              </span>
              <small className="mt-1 block text-muted-foreground">
                ظهور هذه الحالة لا يعني إرسال طلب جديد أو استخدام OTP.
              </small>
            </div>
          )}
        </section>
      )}

      {/* ── 1. بيانات المنشأة ووحدة إصدار الفواتير */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="border-b bg-muted/40 px-5 py-4">
          <h2 className="font-bold">1. بيانات المنشأة ووحدة إصدار الفواتير</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            راجع البيانات القانونية والعنوان الوطني بدقة. حفظ البيانات وتحضير CSR لا يطلب OTP ولا يفعّل الربط
            ولا يرسل فواتير. القيم المبدئية من «إعدادات الضريبة» للمنشأة، وتُراجع قبل الحفظ.
          </p>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="اسم المنشأة بالعربية" value={identity.companyNameAr} onChange={(v) => setField("companyNameAr", v)} />
          <div className="flex flex-col gap-2">
            <Field
              label="اسم المنشأة بالإنجليزية"
              value={identity.companyNameEn}
              onChange={(v) => {
                setField("companyNameEn", v);
                setLegalEnglishConfirmed(false);
              }}
              dir="ltr"
            />
            <label className="flex items-start gap-2 text-xs text-amber-800">
              <Checkbox
                checked={legalEnglishConfirmed}
                onCheckedChange={(checked) => setLegalEnglishConfirmed(Boolean(checked))}
                className="mt-0.5"
              />
              راجعت الاسم الإنجليزي وأؤكد مطابقته للمستندات القانونية.
            </label>
          </div>
          <Field
            label="الرقم الضريبي — 15 رقمًا"
            value={identity.vatNumber}
            onChange={(v) => setField("vatNumber", v.replace(/\D/g, "").slice(0, 15))}
            dir="ltr"
          />
          <Field
            label="رقم السجل التجاري"
            value={identity.commercialRegistration}
            onChange={(v) => setField("commercialRegistration", v.replace(/\D/g, "").slice(0, 15))}
            dir="ltr"
          />
          <Field label="اسم الفرع" value={identity.branchName} onChange={(v) => setField("branchName", v)} />
          <Field label="نوع النشاط" value={identity.industry} onChange={(v) => setField("industry", v)} placeholder="مثال: Healthcare" />
          <Field
            label="رقم المبنى"
            value={identity.buildingNumber}
            onChange={(v) => setField("buildingNumber", v.replace(/\D/g, "").slice(0, 4))}
            dir="ltr"
          />
          <Field label="اسم الشارع" value={identity.streetName} onChange={(v) => setField("streetName", v)} />
          <Field label="الحي" value={identity.district} onChange={(v) => setField("district", v)} />
          <Field label="المدينة" value={identity.city} onChange={(v) => setField("city", v)} />
          <Field
            label="الرمز البريدي"
            value={identity.postalCode}
            onChange={(v) => setField("postalCode", v.replace(/\D/g, "").slice(0, 5))}
            dir="ltr"
          />
          <Field
            label="الرقم الإضافي"
            value={identity.additionalNumber}
            onChange={(v) => setField("additionalNumber", v.replace(/\D/g, "").slice(0, 4))}
            dir="ltr"
          />
          <Field
            label="العنوان المختصر"
            value={identity.shortAddress}
            onChange={(v) => setField("shortAddress", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
            dir="ltr"
          />
          <Field
            label="تاريخ سريان تسجيل ضريبة القيمة المضافة"
            value={identity.vatEffectiveDate}
            onChange={(v) => setField("vatEffectiveDate", v)}
            dir="ltr"
            type="date"
          />
          <Field label="مصنّع الحل التقني" value={identity.deviceManufacturer} onChange={(v) => setField("deviceManufacturer", v)} dir="ltr" />
          <Field label="طراز الجهاز / النظام" value={identity.deviceModel} onChange={(v) => setField("deviceModel", v)} dir="ltr" />
          <Field
            label="الرقم التسلسلي للوحدة"
            value={identity.deviceSerial}
            onChange={(v) => setField("deviceSerial", v.toUpperCase().replace(/[^A-Z0-9._\-/]/g, ""))}
            dir="ltr"
          />
          <Field label="الاسم الشائع للشهادة (CN)" value={identity.commonName} onChange={(v) => setField("commonName", v)} dir="ltr" />
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label className="text-xs font-bold">أنواع الفواتير التي تصدرها الوحدة</Label>
            <span className="text-xs leading-5 text-muted-foreground">
              1100 هو النوع المتعارف لوحدةٍ واحدة تصدر فواتير معيارية B2B ومبسطة B2C.
            </span>
            <select
              value={identity.invoiceType}
              onChange={(event) => setField("invoiceType", event.target.value as IdentityForm["invoiceType"])}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="1100">معيارية B2B ومبسطة B2C — 1100 (الموصى به)</option>
              <option value="1000">معيارية فقط — 1000</option>
              <option value="0100">مبسطة فقط — 0100</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end border-t bg-muted/40 px-5 py-4">
          <Button
            onClick={selectedMode === "simulation" && setup?.compliance_csid_masked ? saveBranchLocation : prepare}
            disabled={busy || !legalEnglishConfirmed || !addressComplete}
          >
            {action === "prepare" || action === "address" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileKey2 className="h-4 w-4" />
            )}
            {selectedMode === "simulation" && setup?.compliance_csid_masked
              ? "حفظ عنوان الفواتير"
              : selectedMode === "production"
                ? "حفظ البيانات وإعداد CSR إنتاج منفصل"
                : "حفظ البيانات وتوليد CSR محاكاة آمن"}
          </Button>
        </div>
      </section>

      {/* ── 2. OTP */}
      {selectedMode === "production" && !productionCsrPrepared ? (
        <section className="rounded-xl border bg-muted/40 p-5">
          <h2 className="font-bold">2. OTP الإنتاج غير متاح بعد</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            لن يظهر إدخال OTP قبل إعداد CSR مستقل للإنتاج الحقيقي من زر التحضير أعلاه.
          </p>
        </section>
      ) : (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-bold">2. إدخال رمز التفعيل OTP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            أنشئ الرمز يدويًا من {selectedMode === "simulation" ? "منصة المحاكاة" : "بوابة الإنتاج الحقيقي"} في
            «فاتورة»، ثم أدخله هنا. لا يطلب النظام OTP تلقائيًا.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Input
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              dir="ltr"
              className="h-12 w-48 text-center font-mono text-xl tracking-[0.35em]"
            />
            <Button
              onClick={onboard}
              disabled={
                busy ||
                !setup ||
                setup.mode !== selectedMode ||
                !["csr_generated", "failed"].includes(setup.status) ||
                Boolean(setup.compliance_csid_masked) ||
                otp.length !== 6
              }
              className={cn(
                "h-12",
                selectedMode === "production" ? "bg-rose-700 hover:bg-rose-800" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {action === "onboard" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {selectedMode === "production" ? "طلب اعتماد الإنتاج الحقيقي" : "تهيئة الجهاز في المحاكاة"}
            </Button>
          </div>
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <AlertCircle className="h-5 w-5 shrink-0" /> لا يُحفظ OTP، ولا يعرض النظام المفتاح الخاص أو Secret أو CSID
            الكامل في المتصفح.
          </div>
        </section>
      )}

      {/* ── جاهزية الإنتاج والتفعيل الصريح */}
      {selectedMode === "production" && (
        <section className="flex flex-col gap-5 rounded-xl border-2 border-rose-300 bg-card p-5 shadow-sm">
          <div>
            <h2 className="text-lg font-bold">قائمة جاهزية الإنتاج الحقيقي</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              اعتماد المحاكاة التجريبي لا يساوي Production CSID حقيقيًا ولا يسمح بالتفعيل هنا.
            </p>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {(
              [
                [legalEnglishConfirmed, "تأكيد الاسم القانوني الإنجليزي"],
                [addressComplete, "اكتمال حقول العنوان الوطني"],
                [Boolean(identity.deviceSerial), "وجود رقم تسلسلي ثابت لوحدة EGS"],
                [productionCsrPrepared, "إعداد CSR مستقل للإنتاج الحقيقي"],
                [setup?.status === "compliance_passed", "اجتياز كل اختبارات التوافق"],
                [productionCsidExists, "وجود Production CSID حقيقي للإنتاج"],
              ] as const
            ).map(([ready, label]) => (
              <li
                key={label}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-sm",
                  ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-muted/40 text-muted-foreground",
                )}
              >
                {ready ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {label}
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4">
            <h3 className="font-bold text-rose-950">التفعيل الصريح للإنتاج الحقيقي</h3>
            <p className="mt-1 text-sm leading-6 text-rose-900">
              لا يُسمح بالتفعيل إلا بعد وجود Production CSID حقيقي. اكتب العبارة التالية حرفيًا للتأكيد:
            </p>
            <code className="mt-2 block text-xs font-bold text-rose-950" dir="ltr">
              {ACTIVATION_PHRASE}
            </code>
            <div className="mt-4 flex flex-wrap gap-3">
              <Input
                value={activationPhrase}
                onChange={(event) => setActivationPhrase(event.target.value)}
                disabled={!productionCsidExists || Boolean(setup?.production_enabled)}
                dir="ltr"
                autoComplete="off"
                className="h-12 min-w-72 flex-1 border-rose-300 bg-white font-mono"
                placeholder="اكتب عبارة التفعيل"
              />
              {setup?.production_enabled ? (
                <Button
                  variant="outline"
                  onClick={deactivateProduction}
                  disabled={busy}
                  className="h-12 border-rose-600 text-rose-700"
                >
                  {action === "deactivate" ? "جاري التعطيل..." : "تعطيل الإنتاج الحقيقي"}
                </Button>
              ) : (
                <Button
                  onClick={activateProduction}
                  disabled={busy || !productionCsidExists || activationPhrase !== ACTIVATION_PHRASE}
                  className="h-12 bg-rose-700 hover:bg-rose-800"
                >
                  {action === "activate" ? "جاري التفعيل..." : "تفعيل الإنتاج الحقيقي"}
                </Button>
              )}
            </div>
            {setup?.production_enabled && (
              <p className="mt-3 text-sm font-semibold text-rose-900">
                الإرسال الحقيقي مفعّل لهذا الجهاز. كل فاتورة تُرسل منه ملزمة قانونيًا.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── 3. اختبارات التوافق */}
      {setup && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">3. فحص التوافق — المستندات المطلوبة</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedMode === "production"
                  ? "ينشئ الخادم مستندات التوافق ويرسلها إلى منصة ZATCA Core بشهادة التوافق، دون إرسال أي فاتورة أعمال حقيقية."
                  : "ينشئ الخادم مستندات UBL موقّعة ويرسل كل واحدٍ فعليًا إلى منصة ZATCA Simulation، بالترتيب."}
              </p>
            </div>
            <Button
              onClick={runComplianceTests}
              disabled={busy || !["compliance_ready", "compliance_testing", "compliance_passed"].includes(setup.status)}
            >
              {action === "compliance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorCog className="h-4 w-4" />}
              {action === "compliance" ? "جاري إرسال المستندات..." : "تشغيل فحص التوافق"}
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {requiredComplianceDocuments.map((document) => {
              const result = setup.compliance_results?.find((item) => item.caseIndex === document.caseIndex);
              return (
                <div
                  key={document.caseIndex}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    result?.status === "passed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : result?.status === "failed"
                        ? "border-rose-200 bg-rose-50 text-rose-800"
                        : "bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        result?.status === "passed"
                          ? "bg-emerald-500"
                          : result?.status === "failed"
                            ? "bg-rose-500"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    {document.label}
                  </div>
                  {result?.status === "failed" && result.validationResults?.errorMessages?.length ? (
                    <ul className="mt-2 flex flex-col gap-1 text-xs leading-5 opacity-80">
                      {result.validationResults.errorMessages.map((error, index) => (
                        <li key={`${error.code ?? "error"}-${index}`} dir="auto">
                          {error.code ? `[${error.code}] ` : ""}
                          {error.message || "رفضت ZATCA المستند"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs leading-5 opacity-80" dir="auto">
                      {result?.status === "passed" ? "اجتاز فحص ZATCA" : result?.message || "لم يُختبر بعد"}
                    </p>
                  )}
                  {result?.httpStatus ? <small className="mt-1 block font-mono">HTTP {result.httpStatus}</small> : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 4. شهادة الإنتاج */}
      {setup?.status === "compliance_passed" && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-indigo-950">
                {setup.production_csid_masked
                  ? selectedMode === "production"
                    ? "4. تم إصدار Production CSID الحقيقي"
                    : "4. تم إصدار اعتماد المحاكاة"
                  : selectedMode === "production"
                    ? "4. إصدار Production CSID الحقيقي"
                    : "4. إصدار Production CSID للمحاكاة — اعتماد تجريبي فقط"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-indigo-800">
                {setup.production_csid_masked
                  ? "حُفظت بيانات الاعتماد بأمان داخل Vault. لا تُرسل أي فاتورة حقيقية قبل التفعيل الصريح."
                  : selectedMode === "production"
                    ? "طلب اعتماد إنتاج حقيقي بعد اجتياز اختبارات التوافق. إصداره وحده لا يفعّل إرسال الفواتير."
                    : "هذا Production CSID داخل المحاكاة فقط — يُستخدم لتجربة إرسال الفواتير الفعلية إلى المحاكاة."}
              </p>
              {setup.production_csid_masked && (
                <div className="mt-3 grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900 sm:grid-cols-2">
                  <span dir="ltr">CSID: {setup.production_csid_masked}</span>
                  <span>
                    انتهاء الشهادة:{" "}
                    {setup.certificate_expires_at
                      ? new Date(setup.certificate_expires_at).toLocaleString("ar-SA")
                      : "يحتاج مراجعة"}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={requestProductionCsid}
                disabled={busy || Boolean(setup.production_csid_masked)}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {action === "production" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {setup.production_csid_masked
                  ? selectedMode === "production"
                    ? "تم إصدار Production CSID الحقيقي"
                    : "تم إصدار اعتماد المحاكاة"
                  : selectedMode === "production"
                    ? "إصدار Production CSID الحقيقي"
                    : "إصدار Production CSID للمحاكاة فقط"}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ── بدء تهيئة جديدة: يؤرشف الجهاز ويمحو أسراره. لا يُتاح والإرسال
          الحقيقي مفعّل — يُعطَّل أوّلًا، فلا يُؤرشف جهازٌ عاملٌ بضغطة */}
      {setup && !setup.production_enabled && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setResetOpen(true)} disabled={busy} className="border-rose-300 text-rose-700">
            {action === "reset" ? "جاري البدء..." : "بدء تهيئة جديدة لهذا الجهاز"}
          </Button>
        </div>
      )}

      {audit.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-bold">سجل التهيئة</h2>
          <div className="flex flex-col gap-2">
            {audit.map((item) => {
              const detailMessage = getAuditDetailMessage(item);
              return (
                <div key={item.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{auditActionLabels[item.action] ?? item.action}</span>
                    <span className={item.result === "success" ? "text-emerald-700" : "text-rose-700"}>
                      {item.result === "success" ? "نجح" : "فشل"}
                      {item.http_status ? ` — HTTP ${item.http_status}` : ""}
                    </span>
                    <time className="text-muted-foreground">{new Date(item.created_at).toLocaleString("ar-SA")}</time>
                  </div>
                  {detailMessage && (
                    <p className="mt-2 break-words rounded-md bg-rose-50 px-2 py-1.5 text-rose-800" dir="auto">
                      {detailMessage}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>بدء تهيئة جديدة؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستُؤرشف تهيئة {selectedMode === "production" ? "الإنتاج الحقيقي" : "المحاكاة"} الحالية لهذا الجهاز وتُمحى
              أسرارها، ويبقى سجلّها. ستحتاج OTP جديدًا من بوابة فاتورة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resetOnboarding()}>أرشفة وبدء تهيئة جديدة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/40 backdrop-blur-[1px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  dir,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dir?: "rtl" | "ltr";
  type?: "text" | "date";
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold">{label}</span>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} dir={dir} placeholder={placeholder} />
    </label>
  );
}
