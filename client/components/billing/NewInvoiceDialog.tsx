import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, LayoutGrid, Percent, Plus, Receipt } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { formatAmount } from "@/lib/locale";
import { useInsuranceSettings } from "@/lib/insurance-settings";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import ServiceBrowserDialog from "@/components/billing/ServiceBrowserDialog";
import { useToast } from "@/hooks/use-toast";
import { reportInvoiceToZatca, useZatcaAutoSettings } from "@/lib/zatca-auto";
import CenteredPicker from "@/components/shared/CenteredPicker";

/**
 * طرق الدفع وصناديق النقد — نسخة مستقلّة عن شاشة الفواتير.
 *
 * النافذة صارت تُفتح من ملفّ المريض كذلك، فلا يصحّ أن تعتمد على خطّافات
 * تعيش داخل صفحة الفواتير. والاستعلامان بسيطان ويتشاركان المفتاح نفسه مع
 * تلك الشاشة، فلا يتكرّر الطلب.
 */
type InvoicePaymentMethod = {
  id: string;
  name_ar: string;
  affects_drawer: boolean;
};

function useInvoicePaymentMethods() {
  return useQuery({
    // مفتاح مستقلّ: شاشة الفواتير تقرأ الأعمدة نفسها بشكل صفٍّ مختلف،
    // ومشاركة المفتاح تُسلّم أحد المستهلكَين شكل الآخر.
    queryKey: ["invoice-payment-methods"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, code, name_ar, extra, sort_order, category:lookup_categories!inner(key)")
        .eq("lookup_categories.key", "payment_methods")
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        name_ar: row.name_ar,
        affects_drawer: Boolean(row.extra?.affects_drawer),
      })) as InvoicePaymentMethod[];
    },
  });
}

function useInvoiceCashRegisters(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-cash-registers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/** سطر دفع واحد في الفاتورة — الدفع المجزّأ سطران أو أكثر. */
type PaymentDraft = { key: string; methodId: string; amount: string; registerId: string };


/**
 * نافذة إصدار الفاتورة — مكوّن مشترك لا جزء من شاشة الفواتير.
 *
 * كانت تعيش داخل `pages/Billing.tsx` فلا يمكن فتحها إلّا بالانتقال إلى تلك
 * الشاشة. وإصدار فاتورة من ملفّ المريض بالانتقال إليها يعني: تخرج من الملفّ،
 * وتنتظر تحميل شاشة كاملة، وتبحث عن المريض من جديد وأنت واقف في ملفّه — ثلاث
 * خطوات لعمليةٍ واحدة تتكرّر عشرات المرّات في اليوم.
 *
 * فأُخرجت كما هي إلى هنا: نافذة واحدة بقواعدها كاملة (التسعير، والخصم الآليّ،
 * وقوائم الأسعار، والتأمين، وبنود الزيارة والطلبات غير المفوتَرة، والاتفاقيات)
 * تفتحها شاشة الفواتير وملفّ المريض سواءً. ولم تُنسخ نسخة مصغّرة للملفّ: نسخةٌ
 * ثانية تعني قواعد فوترة ثانية تتباعد عن الأولى مع كل تعديل.
 */
/**
 * سياق فتح نافذة الفاتورة.
 *
 * يأتي من موعد (`?appointmentId=`) أو من ملف مريض مباشرةً
 * (`?patientId=` من زرّ «إصدار فاتورة» في الملف) — ولذلك `id` و`doctor_id`
 * يقبلان الفراغ: فاتورة مفتوحة من الملف بلا موعد ولا زيارة، فلا تُربط بموعد
 * غير موجود ولا يُفترض لها طبيب.
 */
export type BillingAppointmentContext = {
  id: string | null;
  patient_id: string;
  doctor_id: string | null;
  clinic_id: string | null;
  patient: { id: string; name_ar: string; insurance_company_name: string | null; insurance_policy_number: string | null; insurance_policy_category: string | null; insurance_membership_number: string | null } | { id: string; name_ar: string; insurance_company_name: string | null; insurance_policy_number: string | null; insurance_policy_category: string | null; insurance_membership_number: string | null }[] | null;
};

type DraftLine = {
  key: string;
  item_id: string | null;
  description: string;
  price: number;
  qty: number;
  discount_percent: number;
  /** النسبة التي اقترحها app_resolve_discount — للتمييز بين الآلي واليدوي. */
  auto_discount_percent: number;
  /**
   * خصمٌ بمبلغٍ إلى جانب النسبة (0167/0168).
   *
   * «الخدمة بمئة والمريض يدفع تسعين» عشرةُ ريالات لا نسبة، وتحويلها إلى نسبة
   * يُنتج كسورًا تُقرَّب فيخرج ٨٩٫٩٩ على الورقة. والقاعدة تسقفه بمجموع السطر.
   */
  discount_amount?: number;
  /** سبب الخصم — **إلزاميّ في القاعدة** متى وُجد خصم. */
  discount_reason?: string;
  /** خدمة مجانية: السطر بصفرٍ في السعر والضريبة والصافي. */
  is_complimentary?: boolean;
  /** سبب المنح — إلزاميّ في القاعدة. */
  complimentary_reason?: string;
  /** هل يُبيح الكتالوج منح هذه الخدمة مجانًا؟ (`items.allow_complimentary`) */
  allow_complimentary?: boolean;
  /** سياسة المنح المكتوبة على الصنف — تُعرض لمن يمنح. */
  complimentary_note?: string | null;
  /** العرض المُطبَّق على السطر — للعرض «قبل/بعد» لا للحساب. */
  offer_title?: string | null;
  offer_list_price?: number | null;
  offer_show_before_after?: boolean;
  /** حدّ 0159 الأدنى — لتحذير الخصم قبل أن ترفضه القاعدة. */
  min_price?: number | null;
  is_vat_exempt: boolean;
  /**
   * ربط السطر ببند اتفاقية علاجية. هذا هو المفتاح الذي يعتمد عليه المُحفِّز
   * `app_recalc_agreement_invoiced` (0003) لتحديث `treatment_agreements.invoiced_amount`
   * — وكان لا يُكتب من هذه الشاشة إطلاقًا، فبقي المبلغ المفوتَر صفرًا مهما
   * فُوترت الاتفاقية، وظهر "المتبقي" خاطئًا في كل تقرير.
   */
  agreement_item_id: string | null;
  /** رقم الاتفاقية — للعرض بجانب السطر فقط، لا يُكتب في القاعدة. */
  agreement_label: string | null;
  /**
   * سبب استبدال الكشفية بالمراجعة — للعرض بجانب السطر فقط.
   *
   * اختياريّ عمدًا: مواضع إنشاء السطور الأخرى (بنود الزيارة، الطلبات،
   * الاتفاقيات) لا تمرّ بقواعد الكشفية، وجعله إلزاميًّا كان سيفرض تعديلها
   * كلّها بلا فائدة.
   */
  follow_up_note?: string | null;
  /**
   * الخدمة المنفَّذة في الزيارة التي وُلِّد منها هذا السطر (0053).
   *
   * وجوده يجعل الفهرس الفريد في القاعدة يرفض فوترة الخدمة مرتين — فالمنع
   * ليس في هذه الشاشة بل تحتها.
   */
  visit_service_id: string | null;
  /**
   * الطلب (مختبر/أشعة/وصفة) الذي وُلِّد منه هذا السطر (0057).
   *
   * اختياري عمدًا: مواضع إنشاء السطور الأخرى لا تعرف الطلبات، وجعله إلزاميًا
   * كان سيفرض تعديلها كلها بلا فائدة.
   */
  order_source_type?: "lab" | "radiology" | "prescription" | null;
  order_id?: string | null;
};

type VisitOrderRow = {
  source_type: "lab" | "radiology" | "prescription";
  source_order_id: string;
  source_item_id: string;
  item_id: string | null;
  item_name: string;
  source_name: string;
  qty: number;
  unit_price: number;
  is_vat_exempt: boolean;
};

const ORDER_TYPE_LABELS: Record<VisitOrderRow["source_type"], string> = {
  lab: "طلب مختبر",
  radiology: "طلب أشعة",
  prescription: "وصفة",
};

/** قيمة "بدون اختيار" في قوائم Select (لا تقبل قيمة فارغة). */
const NONE = "__none__";

type AgreementItemOption = {
  itemId: string;
  agreementItemId: string;
  agreementNumber: number;
  /** عرض السعر الذي ينتمي إليه البند (0193) — `null` لبنود ما قبله. */
  quoteId: string | null;
  quoteNumber: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  discountPercent: number;
  /** الخصم بالريال على البند كلّه (0193) — المرجع إن وُجد. */
  discountAmount: number;
  invoicedQty: number;
};

/**
 * بنود الاتفاقيات العلاجية القابلة للفوترة لمريض بعينه.
 *
 * سبب وجود هذا الاستعلام: التدقيق أثبت أن `sales_invoice_items.agreement_item_id`
 * **لا يُكتب من شاشة الفوترة إطلاقًا** — يُكتب فقط من تبويب الجلسات. والمُحفِّز
 * `app_recalc_agreement_invoiced` (0003) يجمع `net_amount` لبنود الفواتير
 * المربوطة بهذا المفتاح ليحدّث `treatment_agreements.invoiced_amount`. فبلا
 * الربط تبقى الاتفاقية "غير مفوترة" أبدًا مهما صُرف عليها، ويظهر المتبقّي
 * مساويًا للإجمالي في كل تقرير.
 *
 * `invoicedQty` يُحتسب هنا لا في القاعدة: هو عدد ما فُوتر فعلًا من كل بند،
 * ويُستخدم لمنع فوترة البند مرتين — وهو الخطأ الذي يجعل `invoiced_amount`
 * يتجاوز `total_amount` فيظهر المتبقّي سالبًا.
 */
function useAgreementItemsForBilling(patientId: string | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-agreement-items", patientId, organizationId],
    enabled: Boolean(patientId && organizationId),
    queryFn: async () => {
      /**
       * المنظور الواحد (0193): بنود اتفاقياتٍ مفعّلة وعروضٍ غير ملغاة، ومفوتَرها
       * محسوبٌ في القاعدة بالقاعدة نفسها التي يفرضها حارس سطر الفاتورة. وإن لم
       * تُنفَّذ الترقية بعد يُعاد الحساب القديم أدناه كما كان.
       */
      const viewResult = await supabase
        .from("v_agreement_billable_items")
        .select(
          "agreement_item_id, agreement_number, quote_id, quote_number, item_id, description, qty, unit_price, discount_percent, discount_amount, invoiced_qty",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .order("agreement_number")
        .order("quote_number");
      if (!viewResult.error) {
        return ((viewResult.data ?? []) as any[]).map((row) => ({
          itemId: row.item_id as string,
          agreementItemId: row.agreement_item_id as string,
          agreementNumber: Number(row.agreement_number),
          quoteId: (row.quote_id as string | null) ?? null,
          quoteNumber: row.quote_number == null ? null : Number(row.quote_number),
          description: (row.description as string) ?? "بند اتفاقية",
          qty: Number(row.qty) || 1,
          unitPrice: Number(row.unit_price) || 0,
          discountPercent: Number(row.discount_percent) || 0,
          discountAmount: Number(row.discount_amount) || 0,
          invoicedQty: Number(row.invoiced_qty) || 0,
        })) as AgreementItemOption[];
      }

      const { data, error } = await supabase
        .from("treatment_agreements")
        .select(
          "id, agreement_number, treatment_agreement_items(id, item_id, description, qty, unit_price, discount_percent)",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .eq("is_disabled", false)
        .order("agreement_number");
      if (error) throw error;

      const agreements = (data ?? []) as unknown as {
        id: string;
        agreement_number: number;
        treatment_agreement_items: {
          id: string;
          item_id: string | null;
          description: string | null;
          qty: number;
          unit_price: number;
          discount_percent: number;
        }[];
      }[];

      const options: AgreementItemOption[] = [];
      for (const agreement of agreements) {
        for (const item of agreement.treatment_agreement_items ?? []) {
          if (!item.item_id) continue;
          options.push({
            itemId: item.item_id,
            agreementItemId: item.id,
            agreementNumber: agreement.agreement_number,
            description: item.description ?? "بند اتفاقية",
            qty: Number(item.qty) || 1,
            unitPrice: Number(item.unit_price) || 0,
            discountPercent: Number(item.discount_percent) || 0,
            discountAmount: 0,
            quoteId: null,
            quoteNumber: null,
            invoicedQty: 0,
          });
        }
      }
      if (options.length === 0) return options;

      /**
       * كم فُوتر من كل بند حتى الآن — استعلام واحد لكل البنود لا استعلام لكل بند.
       *
       * **الرأس يُجلب مع البند ويُصفّى به.** بلا ذلك كان عرض السعر
       * (`is_temporary = true`) والفاتورة الملغاة (`status = 'void'`) يُحسبان
       * فوترةً: يبني الموظف عرض سعر يحوي بند اتفاقية، فيُقفل البند إلى الأبد
       * ("مفوتَر بالكامل") ولا يمكن فوترته مربوطًا أبدًا — فلا يعمل المُحفِّز
       * ويبقى المتبقّي خاطئًا. أي أن الميزة كانت تُعطّل نفسها بالاستعمال.
       */
      const { data: billed, error: billedError } = await supabase
        .from("sales_invoice_items")
        .select("agreement_item_id, qty, invoice:sales_invoices!inner(is_temporary, status)")
        .in(
          "agreement_item_id",
          options.map((option) => option.agreementItemId),
        );
      if (billedError) throw billedError;

      const billedQty = new Map<string, number>();
      for (const raw of billed ?? []) {
        const row = raw as {
          agreement_item_id: string | null;
          qty: number;
          invoice: { is_temporary: boolean; status: string } | { is_temporary: boolean; status: string }[] | null;
        };
        if (!row.agreement_item_id) continue;
        const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
        if (!invoice || invoice.is_temporary || invoice.status === "void") continue;
        billedQty.set(row.agreement_item_id, (billedQty.get(row.agreement_item_id) ?? 0) + (Number(row.qty) || 0));
      }
      return options.map((option) => ({
        ...option,
        invoicedQty: billedQty.get(option.agreementItemId) ?? 0,
      }));
    },
  });
}

function useBillingDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-doctors", organizationId],
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
}

function useBillingClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // عمود العيادة اسمه `name` لا `name_ar` (0001) — الاستعلام القديم كان
      // يفشل بالكامل فتظهر قائمة العيادات فارغة دائمًا في نافذة الفاتورة.
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useBillingWarehouses(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["billing-warehouses", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/**
 * مجموعات الفوترة السريعة (لقطة 22) — أزرار تُضيف عدة أصناف دفعةً واحدة.
 * ليست عروضًا (`offers`): العرض كيان تسعيري له نسبة خصم ومدة صلاحية، وهذه
 * اختصار إدخال بلا أي أثر مالي. جداولها في 0042.
 */
function useQuickGroups(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["quick-invoice-groups", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_invoice_groups")
        .select(
          "id, name_ar, color, sort_order, quick_invoice_group_items(id, qty, item:items(id, name_ar, price, is_vat_exempt))",
        )
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as QuickGroupRow[];
    },
  });
}

type QuickGroupRow = {
  id: string;
  name_ar: string;
  color: string | null;
  sort_order: number;
  quick_invoice_group_items: {
    id: string;
    qty: number;
    item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean } | null;
  }[];
};

export default function NewInvoiceDialog({
  open,
  onOpenChange,
  organizationId,
  vatRate: fallbackVatRate,
  isQuote,
  appointment,
  agreementQuoteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /**
   * «فوترة» من عرض سعر اتفاقية (0193): تُفتح النافذة وفيها ما لم يُفوتَر بعدُ
   * من بنود ذلك العرض، بسعره وخصمه المتّفق عليهما. تُعدَّل الكمّيات لفوترة
   * جزءٍ منه، ويبقى الباقي في الاتفاقية لزيارةٍ تالية.
   */
  agreementQuoteId?: string | null;
  /**
   * نسبة المنشأة الافتراضية — **تُعرض قبل اختيار المريض فقط**.
   *
   * لم تعد مصدر الحساب: النسبة السارية تُسأل عنها القاعدة (`0156`) لأنّها
   * وحدها تعرف تفعيل الضريبة وإعفاء الجنسية.
   */
  vatRate: number;
  isQuote?: boolean;
  appointment: BillingAppointmentContext | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  /** الإبلاغ التلقائيّ لـZATCA (0200): تُبلَّغ الفاتورة فور إصدارها. */
  const zatcaAuto = useZatcaAutoSettings(organizationId);
  const { session } = useOrganizationAccess();
  const { can } = usePermissions();
  /**
   * **المجانيّ قرارُ الطبيب أو المدير، والخصم يملكه الاستقبال والمحاسبة.**
   *
   * القاعدة تفرض ذلك (0167)، وهذه الحالتان تُخفيان الزرّ عمّن لا يملكه بدل
   * أن يضغطه فيُرفض — والزرّ الذي يُرفض دائمًا أسوأ من زرٍّ غائب.
   */
  const canComplimentary = can("billing.complimentary");
  const canLineDiscount = can("billing.line_discount");
  /** السطر المفتوحة خياراته — خصمٌ ومجانيّ لا يظهران إلّا عند الطلب. */
  const [lineOptionsFor, setLineOptionsFor] = useState<string | null>(null);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [externalName, setExternalName] = useState("");
  /** هل طلب المستخدم تغيير المريض المحدَّد؟ (يُظهر صندوق البحث) */
  const [changingPatient, setChangingPatient] = useState(false);
  /**
   * دفعات الفاتورة عند الإصدار.
   *
   * كانت الفاتورة تُصدَر ثم يُفتح «تسجيل دفعة» في شاشة أخرى — خطوتان لعملية
   * واحدة، ومن نسي الثانية ترك فاتورة غير محصَّلة وهو قد قبض المال.
   */
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const paymentMethods = useInvoicePaymentMethods();
  const cashRegisters = useInvoiceCashRegisters(organizationId);
  /**
   * منتقي الخدمات المتصفَّح.
   *
   * صندوق البحث وحده يكفي من يعرف اسم الصنف؛ ومن يريد أن يرى خدمات عيادةٍ
   * بعينها، أو يبحث بالسعر الذي سمعه من المريض، لا يملك سبيلًا قبل هذه
   * النافذة.
   */
  const [browserOpen, setBrowserOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);

  // رأس الفاتورة — كانت هذه الحقول كلها موجودة في جدول sales_invoices منذ
  // 0003 لكن النافذة لم تكن تُدخل أيًا منها (8 أعمدة من 48).
  const [doctorId, setDoctorId] = useState(NONE);
  const [clinicId, setClinicId] = useState(NONE);
  const [warehouseId, setWarehouseId] = useState(NONE);
  const [idNumber, setIdNumber] = useState("");
  const [note, setNote] = useState("");

  // قسم التأمين — كان غائبًا بالكامل رغم وجود 10 أعمدة له في الجدول،
  // فلم يكن ممكنًا إصدار فاتورة تأمين صحيحة من الواجهة إطلاقًا.
  const [isInsurance, setIsInsurance] = useState(false);
  const [insCompany, setInsCompany] = useState("");
  const [insPolicy, setInsPolicy] = useState("");
  const [insClass, setInsClass] = useState("");
  const [insMembership, setInsMembership] = useState("");
  const [insCopayPercent, setInsCopayPercent] = useState("");
  const [insMaxAmount, setInsMaxAmount] = useState("");
  const [insApprovalNumber, setInsApprovalNumber] = useState("");
  /**
   * حدّ الكشفية وأهلية العلاج — عمودان في `sales_invoices` منذ 0005 لا
   * يكتبهما أحد. يمرّان في jsonb التأمين (0160) فلا يتغيّر توقيع الدالّة.
   */
  const [insConsultationLimit, setInsConsultationLimit] = useState("");
  const [insEligibility, setInsEligibility] = useState("");
  /**
   * مصدر الفاتورة وتصنيفها — عمودان قائمان لا يكتبهما أحد، وتقارير المصدر
   * والتصنيف تقرأ فراغًا أبدًا. يُهيَّآن من ملفّ المريض ويظلّان قابلَين
   * للتعديل: مريضٌ جاء هذه المرّة بإعلانٍ مختلف عن مصدره الأصليّ.
   */
  const [sourceValueId, setSourceValueId] = useState("");
  const [classificationValueId, setClassificationValueId] = useState("");
  /**
   * فاتورة أعمال (B2B) — عمود `is_b2b` موجود في `sales_invoices` ولم يكن
   * يُكتب من أي مكان، فبقي `false` دائمًا. وZATCA تفرّق بين الفاتورة
   * الضريبية (B2B: تتطلب اسم المشتري ورقمه الضريبي) والفاتورة الضريبية
   * المبسّطة (B2C) — والخلط بينهما سبب رفض شائع.
   */
  const [isB2b, setIsB2b] = useState(false);

  const doctors = useBillingDoctors(organizationId);
  const clinics = useBillingClinics(organizationId);
  const warehouses = useBillingWarehouses(organizationId);
  const quickGroups = useQuickGroups(organizationId);
  const agreementItems = useAgreementItemsForBilling(patient?.id, organizationId);
  const insuranceSettings = useInsuranceSettings(organizationId);

  /**
   * الزيارة المرتبطة بالموعد — لتخزينها في `sales_invoices.visit_id` (0052).
   *
   * بلا هذا الربط تبقى الفاتورة معلَّقة بالموعد وحده، فيتعذّر الرجوع من
   * الفاتورة إلى الزيارة التي وُلِّدت منها — وهو ما يقطع التسلسل المطلوب:
   * خدمة منفَّذة في زيارة ← بند فاتورة ← دفعة ← إغلاق مالي.
   *
   * فهرس فريد على `patient_visits(appointment_id)` يضمن زيارة واحدة لكل موعد،
   * فـ`maybeSingle` آمن هنا ولا يخفي تعدّدًا.
   */
  const appointmentVisit = useQuery({
    queryKey: ["billing-appointment-visit", organizationId, appointment?.id],
    enabled: Boolean(organizationId && appointment?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("appointment_id", appointment!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    },
  });
  const appointmentVisitId = appointmentVisit.data ?? null;

  /**
   * خدمات الزيارة التي لم تُفوتَر بعد — تُقرأ من منظور `v_visit_services_unbilled`
   * (0053) لا من الجدول: المنظور يستثني المفوتَر أصلًا، فلا يحتاج العميل أن
   * يعرف أي خدمة صدرت بها فاتورة.
   */
  const visitServices = useQuery({
    queryKey: ["billing-visit-services", organizationId, appointmentVisitId],
    enabled: Boolean(organizationId && appointmentVisitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_visit_services_unbilled")
        .select("visit_service_id, item_id, item_name, qty, unit_price, is_vat_exempt")
        .eq("organization_id", organizationId)
        .eq("visit_id", appointmentVisitId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as {
        visit_service_id: string;
        item_id: string;
        item_name: string;
        qty: number;
        unit_price: number;
        is_vat_exempt: boolean;
      }[];
    },
  });

  /**
   * إضافة خدمة زيارة كسطر فاتورة.
   *
   * لا تمرّ بـ`addLine`: سعر الخدمة هو **سعر يوم التنفيذ** المخزَّن في
   * `patient_visit_services.unit_price`، وتمريره على `app_resolve_discount`
   * كان سيعيد تسعيره بسعر اليوم وخصومات اليوم — فيختلف ما يُحاسَب عليه
   * المريض عمّا نُفِّذ له.
   */
  const addVisitServiceLine = (service: {
    visit_service_id: string;
    item_id: string;
    item_name: string;
    qty: number;
    unit_price: number;
    is_vat_exempt: boolean;
  }) => {
    if (lines.some((line) => line.visit_service_id === service.visit_service_id)) return;
    setLines((prev) => [
      ...prev,
      {
        key: `vs-${service.visit_service_id}`,
        item_id: service.item_id,
        description: service.item_name,
        price: Number(service.unit_price) || 0,
        qty: Number(service.qty) || 1,
        discount_percent: 0,
        auto_discount_percent: 0,
        is_vat_exempt: Boolean(service.is_vat_exempt),
        agreement_item_id: null,
        agreement_label: null,
        visit_service_id: service.visit_service_id,
      },
    ]);
  };

  const addAllVisitServices = () => (visitServices.data ?? []).forEach(addVisitServiceLine);

  /**
   * طلبات الزيارة غير المفوترة (0057): مختبر وأشعة ووصفة.
   *
   * قبل هذا كان المحاسب لا يرى إلا خدمات الزيارة. أما التحليل الذي طلبه
   * الطبيب والصورة التي أُخذت فلا أثر لهما في الفاتورة — فإمّا يعيد إدخالهما
   * بالاسم والسعر تخمينًا، وإمّا يسقطان. إيراد نُفِّذ ولا يُحصَّل.
   */
  const visitOrders = useQuery({
    queryKey: ["billing-visit-orders", organizationId, appointmentVisitId],
    enabled: Boolean(organizationId && appointmentVisitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_visit_orders_unbilled")
        .select(
          "source_type, source_order_id, source_item_id, item_id, item_name, source_name, qty, unit_price, is_vat_exempt",
        )
        .eq("organization_id", organizationId)
        .eq("visit_id", appointmentVisitId);
      if (error) throw error;
      return (data ?? []) as VisitOrderRow[];
    },
  });

  const visitOrderGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; type: VisitOrderRow["source_type"]; orderId: string; rows: VisitOrderRow[] }
    >();
    for (const row of visitOrders.data ?? []) {
      const key = `${row.source_type}:${row.source_order_id}`;
      if (!groups.has(key)) {
        groups.set(key, { key, type: row.source_type, orderId: row.source_order_id, rows: [] });
      }
      groups.get(key)!.rows.push(row);
    }
    return Array.from(groups.values());
  }, [visitOrders.data]);

  /**
   * الإضافة تتم **بالطلب كاملًا** لا ببنده.
   *
   * لأن `lab_orders.sales_invoice_id` يُختم على مستوى الطلب لا البند: إضافة
   * بندٍ واحد كانت ستُعلّم الطلب كله مفوترًا، فيضيع باقي بنوده بلا فاتورة.
   * الحبيبة في الواجهة تساوي الحبيبة في القاعدة، وإلا كذبت إحداهما على
   * الأخرى.
   */
  const addVisitOrderLines = (group: {
    type: VisitOrderRow["source_type"];
    orderId: string;
    rows: VisitOrderRow[];
  }) => {
    const unlinked = group.rows.filter((row) => !row.item_id);
    const usable = group.rows.filter((row) => row.item_id);
    if (usable.length === 0) {
      toast({
        variant: "destructive",
        title: "لا يمكن فوترة هذا الطلب",
        description: "بنوده غير مربوطة بأصناف فوترة — اربطها من شاشة المختبر/الأشعة أولًا",
      });
      return;
    }
    setLines((prev) => [
      ...prev,
      ...usable
        .filter((row) => !prev.some((line) => line.key === `ord-${row.source_item_id}`))
        .map((row) => ({
          key: `ord-${row.source_item_id}`,
          item_id: row.item_id as string,
          description: row.item_name,
          price: Number(row.unit_price) || 0,
          qty: Number(row.qty) || 1,
          discount_percent: 0,
          auto_discount_percent: 0,
          is_vat_exempt: Boolean(row.is_vat_exempt),
          agreement_item_id: null,
          agreement_label: null,
          visit_service_id: null,
          order_source_type: group.type,
          order_id: group.orderId,
        })),
    ]);
    if (unlinked.length > 0) {
      toast({
        variant: "destructive",
        title: "بنود بلا صنف فوترة سقطت من الفاتورة",
        description: `${unlinked.map((row) => row.source_name).join("، ")} — وسيُعلَّم الطلب مفوترًا رغم ذلك. اربطها بصنف ثم أعد الإصدار إن أردت تحصيلها.`,
      });
    }
  };

  /** معرّفات الطلبات المرتبطة بسطور الفاتورة الحالية، بلا تكرار. */
  const attachedOrderIds = (type: VisitOrderRow["source_type"]) =>
    Array.from(
      new Set(
        lines
          .filter((line) => line.order_source_type === type && line.order_id)
          .map((line) => line.order_id as string),
      ),
    );

  useEffect(() => {
    if (!open || !appointment) return;
    const appointmentPatient = Array.isArray(appointment.patient) ? appointment.patient[0] : appointment.patient;
    if (appointmentPatient) {
      setPatient({ id: appointmentPatient.id, name_ar: appointmentPatient.name_ar });
      setIsInsurance(Boolean(appointmentPatient.insurance_company_name));
      setInsCompany(appointmentPatient.insurance_company_name ?? "");
      setInsPolicy(appointmentPatient.insurance_policy_number ?? "");
      setInsClass(appointmentPatient.insurance_policy_category ?? "");
      setInsMembership(appointmentPatient.insurance_membership_number ?? "");
    }
    setChangingPatient(false);
    setPayments([]);
    setDoctorId(appointment.doctor_id || NONE);
    setClinicId(appointment.clinic_id || NONE);
  }, [appointment, open]);

  /**
   * إضافة بند اتفاقية كسطر فاتورة **حاملًا `agreement_item_id`**.
   *
   * لا يمرّ عبر `addLine`: سعر بند الاتفاقية وخصمه متفق عليهما مع المريض
   * ومكتوبان في الاتفاقية، فاحتساب خصم تلقائي جديد له عبر `app_resolve_discount`
   * كان سيغيّر المبلغ عمّا وُقّع عليه.
   */
  const addAgreementLine = (option: AgreementItemOption) => {
    const remainingQty = Math.max(option.qty - option.invoicedQty, 0);
    if (remainingQty <= 0) return;
    // منع تكرار نفس بند الاتفاقية في الفاتورة الواحدة
    if (lines.some((line) => line.agreement_item_id === option.agreementItemId)) return;
    /**
     * الخصم المتّفق عليه يُنقل بمبلغه لا بنسبته إن كان مبلغًا — مقسومًا على ما
     * يُفوتَر الآن من الكمية. والقاعدة (0167) **تشترط سببًا لكلّ خصم** على سطر
     * فاتورة: بلا سببٍ كانت فوترة أيّ بند اتفاقيةٍ بخصمٍ تُرفض بـ«سبب الخصم
     * مطلوب». فالسبب هنا مرجعُ الاتفاق نفسه.
     */
    const proratedAmount =
      option.discountAmount > 0 && option.qty > 0
        ? Math.round(((option.discountAmount * remainingQty) / option.qty) * 100) / 100
        : 0;
    const hasDiscount = proratedAmount > 0 || option.discountPercent > 0;
    setLines((prev) => [
      ...prev,
      {
        key: `agr-${option.agreementItemId}-${Date.now()}`,
        item_id: option.itemId,
        description: option.description,
        price: option.unitPrice,
        qty: remainingQty,
        discount_percent: proratedAmount > 0 ? 0 : option.discountPercent,
        auto_discount_percent: proratedAmount > 0 ? 0 : option.discountPercent,
        discount_amount: proratedAmount,
        discount_reason: hasDiscount
          ? `خصم متّفق عليه في الاتفاقية #${option.agreementNumber}${
              option.quoteNumber ? ` — عرض سعر ${option.quoteNumber}` : ""
            }`
          : undefined,
        is_vat_exempt: false,
        agreement_item_id: option.agreementItemId,
        agreement_label: `اتفاقية #${option.agreementNumber}`,
        visit_service_id: null,
      },
    ]);
  };

  /** بنود عرض السعر المطلوب فوترته تُضاف مرّةً واحدة لكلّ فتح. */
  const quotePreloadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      quotePreloadedFor.current = null;
      return;
    }
    if (!agreementQuoteId || quotePreloadedFor.current === agreementQuoteId) return;
    if (!agreementItems.data) return;
    quotePreloadedFor.current = agreementQuoteId;
    for (const option of agreementItems.data) {
      if (option.quoteId === agreementQuoteId && option.qty - option.invoicedQty > 0) {
        addAgreementLine(option);
      }
    }
  }, [open, agreementQuoteId, agreementItems.data]);

  const addLine = async (item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean }) => {
    /**
     * قواعد الكشفية (0004) بقيت مكتوبة ولا تُطبَّق حتى 0153: المريض العائد بعد
     * أسبوع كان يُفوَّتر كشفية جديدة كاملة، والشاشة تقول «تلقائيًّا» عن شيء
     * لا يقع. الآن تُسأل القاعدة عن الصنف الذي يُفوتَر فعلًا.
     *
     * الاستبدال يقع **هنا لا عند الحفظ**: الفاتورة المطبوعة يجب أن تطابق ما
     * رآه المحاسب وأقرّه، واستبدالٌ صامت في القاعدة بعد أن قرأ «كشفية ٢٠٠»
     * يُخرج ورقةً تخالف الشاشة. والحكم يبقى في القاعدة — الشاشة تسأل ولا
     * تقرّر، فلا تُستنسخ القاعدة في الواجهة ولا تُغيَّر من المتصفّح.
     */
    let billedId = item.id;
    let billedName = item.name_ar;
    let billedPrice = Number(item.price);
    let billedVatExempt = item.is_vat_exempt;
    let followUpNote: string | null = null;
    try {
      const { data, error } = await supabase.rpc("app_resolve_consultation_item", {
        p_organization_id: organizationId,
        p_patient_id: patient?.id ?? null,
        p_item_id: item.id,
        p_doctor_id: doctorId === NONE ? null : doctorId,
        p_insurance_company_name: isInsurance ? insCompany.trim() || null : null,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        | { item_id: string; item_name: string; item_price: number; item_is_vat_exempt: boolean; is_follow_up: boolean; reason: string }
        | undefined;
      if (!error && row?.is_follow_up) {
        billedId = row.item_id;
        billedName = row.item_name;
        billedPrice = Number(row.item_price) || 0;
        billedVatExempt = Boolean(row.item_is_vat_exempt);
        followUpNote = row.reason || "مراجعة";
        // سعرٌ تغيّر عمّا ضغطه المحاسب لا يُمرَّر بصمت
        toast({ title: "استُبدلت الكشفية بالمراجعة", description: followUpNote });
      }
    } catch {
      // تعذّر احتساب المراجعة لا يمنع الإضافة — يُضاف الصنف كما هو
      followUpNote = null;
    }

    // منطق أولوية الخصومات (خصم المريض ← الخصم العام ← العروض ← خصم الصنف)
    // مبنيّ في قاعدة البيانات منذ 0004 لكنه لم يكن يُستدعى من أي مكان، فبقيت
    // كل الخصومات يدوية. هنا نستدعيه ليقترح النسبة، ويبقى للمستخدم تعديلها.
    //
    // ويُحتسب على **الصنف المفوتَر** بعد الاستبدال لا قبله: عرضٌ على الكشفية
    // لا يخصّ المراجعة، والعكس.
    let autoDiscount = 0;
    try {
      const { data, error } = await supabase.rpc("app_resolve_discount", {
        p_organization_id: organizationId,
        p_patient_id: patient?.id ?? null,
        p_item_id: billedId,
      });
      if (!error && data != null) autoDiscount = Number(data) || 0;
    } catch {
      // فشل احتساب الخصم التلقائي لا يمنع إضافة البند — يُضاف بخصم صفر
      // ويستطيع المستخدم إدخاله يدويًا.
      autoDiscount = 0;
    }

    /**
     * **السعر الساري من القاعدة: العرض النشط اليوم إن وُجد.**
     *
     * `app_item_effective_price` (0167) تُعيد سعر القائمة والسعر بعد العرض
     * واسم العرض وحدّي السعر. والسؤال يقع **قبل الحفظ** كما في نسبة الضريبة
     * (0156): المحاسب يجب أن يرى على الشاشة ما سيُطبع على الورقة.
     *
     * وتعذّر السؤال لا يمنع الإضافة: `app_create_sales_invoice` (بعد 0168)
     * تُعيد تطبيق العرض في القاعدة على كلّ حال — فهذا عرضٌ مُسبَق لا حساب.
     */
    let offerTitle: string | null = null;
    let offerListPrice: number | null = null;
    let offerShowBeforeAfter = true;
    let itemMinPrice: number | null = null;
    let allowComplimentary = false;
    let complimentaryNote: string | null = null;
    try {
      const { data, error } = await supabase.rpc("app_item_effective_price", {
        p_organization_id: organizationId,
        p_item_id: billedId,
        p_on_date: new Date().toISOString().slice(0, 10),
      });
      const price = (Array.isArray(data) ? data[0] : data) as
        | {
            list_price: number;
            effective_price: number;
            offer_id: string | null;
            offer_title: string | null;
            show_before_after: boolean;
            min_price: number | null;
            max_price: number | null;
          }
        | undefined;
      if (!error && price) {
        itemMinPrice = price.min_price === null ? null : Number(price.min_price);
        if (price.offer_id) {
          offerTitle = price.offer_title;
          offerListPrice = Number(price.list_price) || null;
          offerShowBeforeAfter = Boolean(price.show_before_after);
          billedPrice = Number(price.effective_price) || 0;
          /**
           * **السعر البعديّ يُسكِت اقتراح نسبة الحملة.**
           *
           * `offers` (0004) تقترح نسبةً عبر `app_resolve_discount`، فلو
           * بقيت فوق السعر البعديّ خرج ١١٩٫٢٠ من خدمةٍ أُعلنت «بـ١٤٩»:
           * تخفيضٌ لم تُعلنه المنشأة ولا وافقت عليه. والمعلَن هو البعديّ.
           *
           * والخصم اليدويّ يبقى ممكنًا بسببٍ مكتوب — قرارٌ لا تكديسٌ صامت.
           */
          autoDiscount = 0;
        }
      }
    } catch {
      // الترقية 0167 غير منفَّذة أو تعذّر السؤال — يُضاف البند بسعره المعروف
      offerTitle = null;
    }

    // الإذن بالمنح مجانًا وسياستُه من بطاقة الصنف
    try {
      const { data, error } = await supabase
        .from("items")
        .select("allow_complimentary, complimentary_note")
        .eq("id", billedId)
        .maybeSingle();
      if (!error && data) {
        allowComplimentary = Boolean((data as any).allow_complimentary);
        complimentaryNote = (data as any).complimentary_note ?? null;
      }
    } catch {
      allowComplimentary = false;
    }

    // المفتاح يُولَّد قبل الإضافة ويُعاد للمستدعي، حتى يستطيع تعديل هذا
    // السطر بعينه بلا افتراض أنه الأخير.
    const key = `${billedId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLines((prev) => [
      ...prev,
      {
        key,
        item_id: billedId,
        description: billedName,
        price: billedPrice,
        qty: 1,
        discount_percent: autoDiscount,
        auto_discount_percent: autoDiscount,
        is_vat_exempt: billedVatExempt,
        agreement_item_id: null,
        agreement_label: null,
        visit_service_id: null,
        follow_up_note: followUpNote,
        offer_title: offerTitle,
        offer_list_price: offerListPrice,
        offer_show_before_after: offerShowBeforeAfter,
        min_price: itemMinPrice,
        allow_complimentary: allowComplimentary,
        complimentary_note: complimentaryNote,
      },
    ]);
    return key;
  };

  /**
   * إضافة مجموعة تمرّ ببنودها عبر `addLine` نفسه لا بإدراج مباشر، حتى يُحتسب
   * الخصم التلقائي لكل صنف كما لو أُضيف يدويًا — الإدراج المباشر كان سيتخطّى
   * `app_resolve_discount` فتخرج فاتورة المجموعة بأسعار مختلفة عن نفس
   * الأصناف مضافةً واحدًا واحدًا.
   */
  const addGroup = async (group: QuickGroupRow) => {
    for (const line of group.quick_invoice_group_items ?? []) {
      const item = Array.isArray(line.item) ? line.item[0] : line.item;
      if (!item) continue;
      // `addLine` يُعيد مفتاح السطر الذي أنشأه، والكمية تُطبَّق على **هذا
      // المفتاح** لا على "آخر سطر": ضغط مجموعتين بينما استدعاء الخصم لأولاهما
      // ما زال جاريًا كان يكتب كمية المجموعة الأولى على سطر المجموعة الثانية.
      const key = await addLine(item);
      const qty = Number(line.qty) || 1;
      if (qty !== 1) {
        setLines((prev) => prev.map((draft) => (draft.key === key ? { ...draft, qty } : draft)));
      }
    }
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  /**
   * **النسبة السارية من القاعدة لا من المتصفّح.**
   *
   * كان للضريبة تعريفان: هذه الشاشة تحسبها من
   * `organizations.default_vat_rate ?? 15`، و`app_create_sales_invoice` تحسبها
   * من ثلاثة مصادر لا تراها الشاشة — تفعيل الضريبة، وإعفاء الجنسية، وكون
   * النسبة الفارغة تعني صفرًا لا ١٥.
   *
   * فحين فُوتِرت مريضة سعودية معفاة: عرضت الشاشة ١٢٠ + ١٨ = ١٣٨ وأرسلت دفعةً
   * بـ١٣٨، وحسبت القاعدة ١٢٠، فردّت «المبلغ 138.00 يتجاوز المتبقّي 120.00»
   * ولم تُحفظ الفاتورة. القاعدة كانت مُحقّة — الإعفاء قرارٌ مُثبَت في
   * الإعدادات — والشاشة هي التي خمّنت.
   *
   * `app_effective_vat_rate` تُعيد ما ستطبّقه الدالّة **فعلًا**، بنفس ترتيب
   * فحوصها. فلا يبقى تعريفان يفترقان.
   */
  /**
   * مصدر المريض وتصنيفه من ملفّه — قيمتان أوّليّتان لا قيدان.
   *
   * لا تُكتبان فوق اختيارٍ يدويّ: من غيّر المصدر لهذه الفاتورة قصد ذلك،
   * وإعادة ضبطه مع كل جلب تمحو عمله أمام عينيه.
   */
  const patientContext = useQuery({
    queryKey: ["invoice-patient-context", organizationId, patient?.id ?? null],
    enabled: Boolean(organizationId && patient?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, source_value_id, customer_type_value_id, id_number")
        .eq("id", patient!.id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as
        | {
            id: string;
            source_value_id: string | null;
            customer_type_value_id: string | null;
            id_number: string | null;
          }
        | null;
    },
  });

  useEffect(() => {
    const row = patientContext.data;
    if (!row) return;
    setSourceValueId((current) => current || row.source_value_id || "");
    setClassificationValueId((current) => current || row.customer_type_value_id || "");
  }, [patientContext.data]);

  /**
   * رقم هوية المريض المختار.
   *
   * يُكتب **مرّةً لكل مريض**: اختيارُ مريضٍ يجلب هويّته، وتبديلُ المريض يجلب
   * هويّة الجديد ويمحو القديمة — وبقاؤها كان يضع هوية مريضٍ على فاتورة
   * مريضٍ آخر. أمّا ما يكتبه الموظّف يدويًّا لهذا المريض نفسه فيبقى، لأنّ
   * المرجع هو **تغيّر المريض** لا وصول البيانات.
   *
   * ولا طول مفروض على الحقل: منشآتٌ تُسجّل إقاماتٍ وجوازاتٍ تتجاوز عشرة
   * أرقام، ورفضُها يمنع فوترة مريضٍ حاضر.
   */
  const lastIdPatient = useRef<string | null>(null);
  useEffect(() => {
    const row = patientContext.data;
    if (!row) return;
    if (lastIdPatient.current === row.id) return;
    lastIdPatient.current = row.id;
    setIdNumber(row.id_number ?? "");
  }, [patientContext.data]);

  // إزالة المريض تُخلي الحقل: رقمُ هويةٍ بلا صاحبٍ على الشاشة يُحفظ على
  // أوّل مريضٍ يُختار بعده.
  useEffect(() => {
    if (patient?.id) return;
    lastIdPatient.current = null;
    setIdNumber("");
  }, [patient?.id]);

  const effectiveVat = useQuery({
    queryKey: ["effective-vat-rate", organizationId, patient?.id ?? null],
    enabled: Boolean(organizationId) && open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_effective_vat_rate", {
        p_organization_id: organizationId,
        p_patient_id: patient?.id ?? null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            vat_rate: number | string;
            patient_exempt: boolean;
            exempt_reason: string | null;
            blocked: boolean;
            block_reason: string | null;
          }
        | undefined;
      if (!row) throw new Error("تعذّر تحديد نسبة الضريبة السارية");
      return { ...row, vat_rate: Number(row.vat_rate) };
    },
  });

  /**
   * لا تخمين عند الفشل: النسبة الافتراضية تُعرض ريثما تصل الإجابة، والحفظ
   * ممنوع حتى تصل. رقمٌ مخمَّن على شاشة صرّاف أسوأ من انتظار ثانية.
   */
  const vatRate = effectiveVat.data?.vat_rate ?? fallbackVatRate;
  const vatUnresolved = !effectiveVat.isSuccess;
  const vatBlocked = Boolean(effectiveVat.data?.blocked);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let vat = 0;
    const computed = lines.map((line) => {
      /**
       * الحساب يحاكي 0168 حرفًا بحرف: المجانيّ صفرٌ، والخصم نسبةٌ ومبلغٌ
       * **مسقوفان بمجموع السطر** فلا يخرج صافٍ سالب.
       *
       * والمحاكاة مقصودة لا مُكرَّرة: القاعدة هي التي تحسب المحفوظ، وهذه
       * تُري المحاسب الرقم نفسه قبل الحفظ. واختلافهما يعني خطأً في أحدهما،
       * وهو ما يجعل الفرق ملحوظًا بدل أن يُكتشف على ورقةٍ سُلِّمت للمريض.
       */
      const complimentary = Boolean(line.is_complimentary);
      const unitPrice = complimentary ? 0 : line.price;
      const lineSubtotal = unitPrice * line.qty;
      const lineDiscount = complimentary
        ? 0
        : Math.min(
            (lineSubtotal * line.discount_percent) / 100 + (line.discount_amount ?? 0),
            lineSubtotal,
          );
      const taxable = lineSubtotal - lineDiscount;
      const lineVat = line.is_vat_exempt || complimentary ? 0 : (taxable * vatRate) / 100;
      subtotal += lineSubtotal;
      discount += lineDiscount;
      vat += lineVat;
      return { ...line, lineSubtotal, lineDiscount, lineVat, net: taxable + lineVat };
    });
    return { computed, subtotal, discount, vat, net: subtotal - discount + vat };
  }, [lines, vatRate]);

  const paymentsTotal = useMemo(
    () => payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [payments],
  );

  /**
   * ما يمنع الحفظ من جهة الدفع.
   *
   * القاعدة ترفض التجاوز والطريقة الفارغة، لكن رفضها يأتي بعد إرسال الفاتورة
   * كاملة — والمنع هنا يُظهر السبب قبل ذلك.
   */
  const paymentsInvalid =
    payments.some((row) => Number(row.amount) > 0 && !row.methodId) ||
    paymentsTotal > totals.net + 0.009;

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!patient && !externalName.trim()) throw new Error("اختر مريضًا أو أدخل اسم عميل خارجي");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      /**
       * ما ترفضه القاعدة يُمنع هنا قبل الإرسال.
       *
       * حارس 0167 يرفض المجانيّ بلا سبب أو بلا إباحة، والخصم بلا سبب، والخصم
       * الذي يهبط بالوحدة تحت الحدّ الأدنى. ورفضُه صحيح، لكنّه يأتي بعد إرسال
       * الفاتورة كاملة برسالةٍ واحدة لا تقول أيّ سطر.
       */
      for (const line of lines) {
        if (line.is_complimentary) {
          if (!line.allow_complimentary) {
            throw new Error(
              `«${line.description}» غير مؤشَّرة «تُمنَح مجانًا» في بطاقة الصنف — أشِّرها من شاشة الخدمات أوّلًا`,
            );
          }
          if (!String(line.complimentary_reason ?? "").trim()) {
            throw new Error(`اكتب سبب منح «${line.description}» مجانًا`);
          }
          continue;
        }
        const lineSubtotal = line.price * line.qty;
        const lineDiscount = Math.min(
          (lineSubtotal * line.discount_percent) / 100 + (line.discount_amount ?? 0),
          lineSubtotal,
        );
        if (lineDiscount > 0 && !String(line.discount_reason ?? "").trim()) {
          throw new Error(`اكتب سبب الخصم على «${line.description}»`);
        }
        if (
          lineDiscount > 0 &&
          line.min_price !== null &&
          line.min_price !== undefined &&
          line.qty > 0 &&
          (lineSubtotal - lineDiscount) / line.qty < line.min_price - 0.0001
        ) {
          throw new Error(
            `الخصم يُنزل «${line.description}» إلى ${((lineSubtotal - lineDiscount) / line.qty).toFixed(2)} للوحدة، وحدّها الأدنى ${line.min_price.toFixed(2)}`,
          );
        }
      }
      // حظر الفوترة في ملف المريض كان معروضًا بلا فرض — يُفرض هنا قبل إنشاء الرأس
      await assertPatientNotBlocked(patient?.id, "invoices");

      /**
       * الإنشاء عبر RPC واحد لا إدراجين.
       *
       * كان المسار: أدرج الرأس، ثم أدرج البنود، وإن فشلت البنود احذف الرأس.
       * هذا **ليس ذرّيًا**: انقطاع الشبكة بين النداءين يترك رأس فاتورة بلا
       * بنود — برقم مستهلَك من التسلسل ويظهر بصفر في كشف المبيعات — وقد يفشل
       * الحذف التعويضي هو الآخر فلا يبقى ما يصحّح الحالة.
       *
       * والأهم أن كل الحسابات كانت تجري هنا في المتصفح ثم تُرسَل جاهزة، فيكفي
       * تعديل الطلب قبل إرساله ليقبل النظام أي إجمالي. الدالة (0052) تُعيد
       * حساب السعر والخصم والضريبة وحصتي التأمين **في القاعدة** من أسعار
       * الأصناف ونسبة الضريبة المخزَّنة، وتتجاهل ما يرسله العميل من إجماليات.
       *
       * `totals` يبقى مستعملًا لعرض الإجمالي على الشاشة قبل الحفظ فقط.
       */
      const { data: newInvoiceId, error: rpcError } = await supabase.rpc("app_create_sales_invoice", {
        p_organization_id: organizationId,
        p_items: totals.computed.map((line) => ({
          item_id: line.item_id,
          description: line.description,
          qty: line.qty,
          price: line.price,
          discount_percent: line.discount_percent,
          // الخصم بمبلغ وسببه، والمجانيّ وسببه (0168). والقاعدة تُعيد حساب
          // كلّ شيء وتُسجّل المانح من `auth.uid()` — فلا يُرسَل المانح.
          discount_amount: line.discount_amount ?? 0,
          discount_reason: String(line.discount_reason ?? "").trim() || null,
          is_complimentary: Boolean(line.is_complimentary),
          complimentary_reason:
            String(line.complimentary_reason ?? "").trim() || null,
          is_vat_exempt: line.is_vat_exempt,
          agreement_item_id: line.agreement_item_id,
          visit_service_id: line.visit_service_id,
        })),
        p_patient_id: patient?.id ?? null,
        p_external_customer_name: patient ? null : externalName.trim(),
        p_appointment_id: appointment?.id ?? null,
        p_visit_id: appointmentVisitId ?? null,
        p_doctor_id: doctorId === NONE ? null : doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_warehouse_id: warehouseId === NONE ? null : warehouseId,
        p_invoice_type: "sale",
        p_is_insurance: isInsurance,
        p_insurance: isInsurance
          ? {
              company_name: insCompany.trim() || null,
              policy_number: insPolicy.trim() || null,
              class_number: insClass.trim() || null,
              membership_number: insMembership.trim() || null,
              copay_percent: insCopayPercent || null,
              max_amount: insMaxAmount || null,
              approval_number: insApprovalNumber.trim() || null,
              consultation_limit: insConsultationLimit || null,
              eligibility: insEligibility.trim() || null,
            }
          : {},
        // الجنسية لا تُرسَل: القاعدة تلتقطها من ملفّ المريض لحظة الإصدار،
        // والإعفاء الضريبيّ يُبنى عليها فتلقّيها من المتصفّح يجعله قابلًا
        // للتزوير بتعديل الطلب.
        p_source_value_id: sourceValueId || null,
        p_classification_value_id: classificationValueId || null,
        p_is_temporary: Boolean(isQuote),
        p_is_b2b: isB2b,
        p_id_number: idNumber.trim() || null,
        p_note: note.trim() || null,
        // الختم يجري داخل نفس معاملة الفاتورة (0057): إمّا فاتورة وطلبات
        // مختومة معًا، أو لا شيء.
        p_lab_order_ids: attachedOrderIds("lab").length > 0 ? attachedOrderIds("lab") : null,
        p_radiology_order_ids:
          attachedOrderIds("radiology").length > 0 ? attachedOrderIds("radiology") : null,
        p_prescription_ids:
          attachedOrderIds("prescription").length > 0 ? attachedOrderIds("prescription") : null,
        /**
         * الدفعات تُنفَّذ داخل معاملة الفاتورة نفسها (0147): سند قبضٍ لكل سطر،
         * بسقف المتبقّي، وبشرط مناوبة صندوق مفتوحة للنقد.
         */
        p_payments: payments
          .filter((row) => Number(row.amount) > 0 && row.methodId)
          .map((row) => ({
            amount: Number(row.amount),
            payment_method_value_id: row.methodId,
            cash_register_id: row.registerId === NONE ? null : row.registerId,
          })),
      });
      if (rpcError) throw rpcError;
      if (!newInvoiceId) throw new Error("لم تُنشأ الفاتورة — أعد المحاولة");
      return newInvoiceId as string;
    },
    onSuccess: (newInvoiceId) => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      /**
       * إبلاغ ZATCA فور الإصدار — في الخلفية، والنافذة تُغلق ولا تنتظر. إن
       * تعذّر يُقال للموظّف، والمُبلِّغ الخلفيّ يعيد المحاولة، والفاتورة في
       * «فواتير لم تُبلَّغ». عرض السعر ليس فاتورة ضريبية فلا يُبلَّغ.
       */
      if (!isQuote && newInvoiceId && zatcaAuto.data?.zatca_auto_report) {
        void reportInvoiceToZatca(newInvoiceId).then((result) => {
          queryClient.invalidateQueries({ queryKey: ["zatca-pending"] });
          queryClient.invalidateQueries({ queryKey: ["invoice-zatca", newInvoiceId] });
          if (!result.ok) {
            toast({
              variant: "destructive",
              title: "صدرت الفاتورة ولم تُبلَّغ ZATCA بعد",
              description: `${result.message} — ستُعاد المحاولة تلقائيًّا، وهي في «فواتير لم تُبلَّغ».`,
            });
          }
        });
      }
      // المفوتَر من الاتفاقية تغيّر بفعل المُحفِّز — بلا هذا التبطيل يبقى
      // البند معروضًا "غير مفوتر" فيُفوتر مرة ثانية.
      queryClient.invalidateQueries({ queryKey: ["billing-agreement-items"] });
      // الخدمات التي فُوترت للتوّ لم تعد ضمن غير المفوتر — بلا هذا التبطيل
      // تبقى معروضة كأنها متاحة، فيحاول المستخدم فوترتها ثانيةً وترفضه القاعدة.
      queryClient.invalidateQueries({ queryKey: ["billing-visit-services"] });
      queryClient.invalidateQueries({ queryKey: ["billing-visit-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      queryClient.invalidateQueries({ queryKey: ["radiology-orders"] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      // النافذة تُفتح من ملفّ المريض أيضًا: بلا تبطيل قوائمه يُصدر الموظف
      // الفاتورة ثم ينظر إلى تبويب «الفواتير» في الملفّ فلا يجدها، فيظنّ أنها
      // لم تُصدر ويُصدرها ثانيةً.
      queryClient.invalidateQueries({ queryKey: ["patient-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["patient-financials"] });
      queryClient.invalidateQueries({ queryKey: ["patient-wallet"] });
      // ورحلة المريض ورصيده: الفاتورة حدثٌ فيهما، والقاعدة تكتبه فورًا
      queryClient.invalidateQueries({ queryKey: ["patient-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["patient-balances"] });
      toast({ title: isQuote ? "تم إنشاء عرض السعر" : "تم إنشاء الفاتورة" });
      setPatient(null);
      setChangingPatient(false);
      setPayments([]);
      setExternalName("");
      setLines([]);
      setDoctorId(NONE);
      setClinicId(NONE);
      setWarehouseId(NONE);
      setIdNumber("");
      setNote("");
      setIsInsurance(false);
      setIsB2b(false);
      setInsCompany("");
      setInsPolicy("");
      setInsClass("");
      setInsMembership("");
      setInsCopayPercent("");
      setInsMaxAmount("");
      setInsApprovalNumber("");
      setInsConsultationLimit("");
      setInsEligibility("");
      // المصدر والتصنيف يُصفَّران أيضًا: النافذة تُفتح لمريضٍ آخر بعد قليل،
      // وبقاؤهما يُسجّل مصدر المريض السابق على فاتورة اللاحق.
      setSourceValueId("");
      setClassificationValueId("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الفاتورة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isQuote ? "عرض سعر جديد" : "فاتورة مبيعات جديدة"}</DialogTitle>
          <DialogDescription>
            {isQuote
              ? "عرض السعر لا يُعد فاتورة فعلية ولا يؤثر على المخزون أو السندات حتى يتم تحويله."
              : effectiveVat.isSuccess
                ? `الضريبة محسوبة في القاعدة بنسبة ${vatRate}%`
                : "جارٍ تحديد نسبة الضريبة السارية..."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/**
            * المريض المحدَّد يُعرض **اسمًا مثبَّتًا** لا صندوق بحث.
            *
            * كان الصندوق يظهر دائمًا وتحته سطر صغير «المحدد: فلان» — فمن فتح
            * النافذة من ملفّ مريضٍ بعينه يرى صندوق بحث فيظنّ أن عليه البحث عن
            * المريض الذي هو واقف في ملفّه. الاسم أوّلًا، والبحث خلف زرّ
            * «تغيير» لمن أراده فعلًا.
            */}
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            {patient && !changingPatient ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
                <span className="font-medium text-emerald-900">{patient.name_ar}</span>
                <Button size="sm" variant="ghost" onClick={() => setChangingPatient(true)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <PatientPicker
                onSelect={(found) => {
                  setPatient({ id: found.id, name_ar: found.name_ar });
                  setChangingPatient(false);
                }}
              />
            )}
          </div>
          {!patient && (
            <div className="flex flex-col gap-1.5">
              <Label>أو اسم عميل خارجي (بلا ملف)</Label>
              <Input value={externalName} onChange={(e) => setExternalName(e.target.value)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب المعالج</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(clinics.data ?? []).map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم الهوية</Label>
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المصدر</Label>
              <LookupSelect
                categoryKey="patient_sources"
                value={sourceValueId}
                onChange={setSourceValueId}
                allowClear
                placeholder="بدون"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التصنيف</Label>
              <LookupSelect
                categoryKey="customer_types"
                value={classificationValueId}
                onChange={setClassificationValueId}
                allowClear
                placeholder="بدون"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={isInsurance}
                onChange={(e) => setIsInsurance(e.target.checked)}
                className="h-4 w-4"
              />
              فاتورة تأمين
            </label>
            {isInsurance && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>شركة التأمين</Label>
                  <Input value={insCompany} onChange={(e) => setInsCompany(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم البوليصة</Label>
                  <Input value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم الفئة</Label>
                  <Input value={insClass} onChange={(e) => setInsClass(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم العضوية</Label>
                  <Input value={insMembership} onChange={(e) => setInsMembership(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>نسبة التحمل %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={insCopayPercent}
                    onChange={(e) => setInsCopayPercent(e.target.value)}
                  />
                </div>
                {/* `disable_patient_max_copay_field` كان يُحفَظ ولا يُنفَّذ */}
                {!insuranceSettings.data?.disable_patient_max_copay_field && (
                  <div className="flex flex-col gap-1.5">
                    <Label>أعلى مبلغ مغطّى</Label>
                    <Input
                      type="number"
                      min={0}
                      value={insMaxAmount}
                      onChange={(e) => setInsMaxAmount(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>رقم الموافقة</Label>
                  <Input
                    value={insApprovalNumber}
                    onChange={(e) => setInsApprovalNumber(e.target.value)}
                  />
                </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>حد الكشفية</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={insConsultationLimit}
                      onChange={(e) => setInsConsultationLimit(e.target.value)}
                      placeholder="بلا حدّ"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>أهلية العلاج</Label>
                    <Input
                      value={insEligibility}
                      onChange={(e) => setInsEligibility(e.target.value)}
                      placeholder="مثال: مؤهَّل — وثيقة سارية"
                    />
                  </div>
              </div>
            )}
          </div>

          {(quickGroups.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>مجموعات سريعة</Label>
              <div className="flex flex-wrap gap-2">
                {(quickGroups.data ?? []).map((group) => (
                  <Button
                    key={group.id}
                    size="sm"
                    variant="outline"
                    onClick={() => addGroup(group)}
                    style={group.color ? { borderColor: group.color, color: group.color } : undefined}
                  >
                    {group.name_ar}
                    <span className="text-[10px] text-muted-foreground">
                      ({(group.quick_invoice_group_items ?? []).length})
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={isB2b}
              onChange={(e) => setIsB2b(e.target.checked)}
            />
            <span className="flex flex-col gap-0.5">
              <span>فاتورة أعمال (B2B)</span>
              <span className="text-xs text-muted-foreground">
                فاتورة ضريبية لمنشأة لا لمستهلك — تتطلب الرقم الضريبي للمشتري. اتركها فارغة
                للفاتورة الضريبية المبسّطة (B2C).
              </span>
              {isB2b && !idNumber.trim() && (
                <span className="text-xs text-amber-600">
                  أدخل الرقم الضريبي/الهوية للمشتري في خانة «رقم الهوية» — بدونه تُرفض الفاتورة
                </span>
              )}
            </span>
          </label>

          {(visitServices.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>الخدمات المنفَّذة في الزيارة</Label>
                <Button size="sm" variant="outline" onClick={addAllVisitServices}>
                  <Plus className="h-3.5 w-3.5" />
                  إضافة الكل
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                ما سجّله الطبيب في هذه الزيارة ولم يُفوتَر بعد. السعر هو سعر يوم التنفيذ.
              </p>
              <div className="flex flex-wrap gap-2">
                {(visitServices.data ?? []).map((service) => {
                  const added = lines.some((l) => l.visit_service_id === service.visit_service_id);
                  return (
                    <Button
                      key={service.visit_service_id}
                      size="sm"
                      variant="outline"
                      disabled={added}
                      onClick={() => addVisitServiceLine(service)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">{service.item_name}</span>
                      <Badge variant="secondary">
                        {service.qty} × {formatAmount(service.unit_price)}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {visitOrderGroups.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-sky-300 bg-sky-50/60 p-3">
              <Label>طلبات الزيارة غير المفوترة</Label>
              <p className="text-xs text-muted-foreground">
                ما طلبه الطبيب في هذه الزيارة: تحاليل وأشعة وأدوية. تُضاف بالطلب كاملًا،
                ويُعلَّم الطلب مفوترًا عند الحفظ.
              </p>
              <div className="flex flex-wrap gap-2">
                {visitOrderGroups.map((group) => {
                  const addedCount = group.rows.filter((row) =>
                    lines.some((line) => line.key === `ord-${row.source_item_id}`),
                  ).length;
                  const billable = group.rows.filter((row) => row.item_id).length;
                  const total = group.rows.reduce(
                    (sum, row) => sum + Number(row.qty) * Number(row.unit_price),
                    0,
                  );
                  return (
                    <Button
                      key={group.key}
                      size="sm"
                      variant="outline"
                      disabled={addedCount > 0 && addedCount === billable}
                      onClick={() => addVisitOrderLines(group)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">
                        {ORDER_TYPE_LABELS[group.type]}: {group.rows.map((row) => row.source_name).join("، ")}
                      </span>
                      <Badge variant="secondary">{formatAmount(total)}</Badge>
                      {billable < group.rows.length && (
                        <Badge variant="destructive">{group.rows.length - billable} بلا صنف</Badge>
                      )}
                    </Button>
                  );
                })}
              </div>
              {visitOrderGroups.some((group) => {
                const added = group.rows.filter((row) =>
                  lines.some((line) => line.key === `ord-${row.source_item_id}`),
                ).length;
                const billable = group.rows.filter((row) => row.item_id).length;
                return added > 0 && added < billable;
              }) && (
                <p className="text-xs text-amber-700">
                  حذفتَ بندًا من طلب مُضاف — سيُعلَّم الطلب مفوترًا كاملًا عند الحفظ، فلن يظهر
                  البند المحذوف في فاتورة لاحقة.
                </p>
              )}
            </div>
          )}

          {patient && (agreementItems.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Label>بنود الاتفاقيات العلاجية لهذا المريض</Label>
              <p className="text-xs text-muted-foreground">
                إضافة البند من هنا تربطه بالاتفاقية، فيُحدَّث "المفوتَر" و"المتبقّي" فيها تلقائيًا.
                إضافته من "إضافة بند" العادية لا تربطه بشيء.
              </p>
              <div className="flex flex-wrap gap-2">
                {(agreementItems.data ?? []).map((option) => {
                  const remainingQty = Math.max(option.qty - option.invoicedQty, 0);
                  const alreadyAdded = lines.some(
                    (line) => line.agreement_item_id === option.agreementItemId,
                  );
                  return (
                    <Button
                      key={option.agreementItemId}
                      size="sm"
                      variant="outline"
                      disabled={remainingQty <= 0 || alreadyAdded}
                      onClick={() => addAgreementLine(option)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="truncate">{option.description}</span>
                      <Badge variant={remainingQty <= 0 ? "secondary" : "default"}>
                        {remainingQty <= 0
                          ? "مفوتَر بالكامل"
                          : `متبقٍ ${remainingQty} من ${option.qty}`}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        اتفاقية #{option.agreementNumber}
                        {option.quoteNumber ? ` · عرض ${option.quoteNumber}` : ""}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>إضافة بند</Label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ItemPicker onSelect={addLine} />
              </div>
              <Button type="button" variant="outline" onClick={() => setBrowserOpen(true)}>
                <LayoutGrid className="h-4 w-4" />
                تصفّح الخدمات
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              يُقترح الخصم تلقائيًا حسب أولوية النظام (خصم المريض ← الخصم العام ← العروض ← خصم الصنف) ويمكن تعديله يدويًا.
            </p>
          </div>

          <ServiceBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            onSelect={(item) =>
              addLine({
                id: item.id,
                name_ar: item.name_ar,
                price: item.price,
                is_vat_exempt: item.is_vat_exempt,
              })
            }
          />

          <div className="flex flex-col gap-2 rounded-lg border p-2">
            {totals.computed.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">لم تُضف بنود بعد.</p>
            )}
            {totals.computed.map((line) => (
              <div key={line.key} className="flex flex-col gap-1">
              <div className="grid grid-cols-12 items-center gap-2 text-sm">
                <span className="col-span-4 flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{line.description}</span>
                  {line.offer_title && (
                    <Badge
                      className="shrink-0 bg-emerald-600 text-[10px] hover:bg-emerald-600"
                      title={
                        line.offer_list_price
                          ? `قبل العرض ${line.offer_list_price.toFixed(2)} — بعده ${line.price.toFixed(2)}`
                          : line.offer_title
                      }
                    >
                      {line.offer_show_before_after && line.offer_list_price
                        ? `${line.offer_title}: ${line.offer_list_price.toFixed(2)} ← ${line.price.toFixed(2)}`
                        : line.offer_title}
                    </Badge>
                  )}
                  {line.is_complimentary && (
                    <Badge className="shrink-0 bg-sky-600 text-[10px] hover:bg-sky-600">
                      مجانية
                    </Badge>
                  )}
                  {line.agreement_label && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {line.agreement_label}
                    </Badge>
                  )}
                  {line.visit_service_id && (
                    <Badge className="shrink-0 bg-emerald-100 text-[10px] text-emerald-800">
                      من الزيارة
                    </Badge>
                  )}
                  {line.follow_up_note && (
                    <Badge
                      className="shrink-0 bg-amber-100 text-[10px] text-amber-900"
                      title={line.follow_up_note}
                    >
                      مراجعة
                    </Badge>
                  )}
                </span>
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  value={line.is_complimentary ? 0 : line.price}
                  disabled={Boolean(line.is_complimentary)}
                  title={
                    line.is_complimentary
                      ? "السطر المجانيّ بصفرٍ تفرضه القاعدة"
                      : line.min_price !== null && line.min_price !== undefined
                        ? `الحد الأدنى ${line.min_price.toFixed(2)}`
                        : "السعر"
                  }
                  onChange={(e) => updateLine(line.key, { price: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                />
                <Input
                  className="col-span-1 h-8"
                  type="number"
                  min={0}
                  max={100}
                  value={line.discount_percent}
                  disabled={Boolean(line.is_complimentary)}
                  onChange={(e) => updateLine(line.key, { discount_percent: Number(e.target.value) })}
                  title={
                    line.auto_discount_percent > 0
                      ? `نسبة الخصم % — اقترح النظام ${line.auto_discount_percent}%`
                      : "نسبة الخصم %"
                  }
                />
                <span className="col-span-1 text-end text-xs font-semibold">{line.net.toFixed(2)}</span>
                <div className="col-span-2 flex items-center justify-end gap-0.5">
                  {(canLineDiscount || canComplimentary) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-1.5"
                      title="خصم بمبلغ · خدمة مجانية"
                      onClick={() =>
                        setLineOptionsFor((prev) => (prev === line.key ? null : line.key))
                      }
                    >
                      {line.is_complimentary ? (
                        <Gift className="h-3.5 w-3.5" />
                      ) : (
                        <Percent className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 px-1.5" onClick={() => removeLine(line.key)}>
                    حذف
                  </Button>
                </div>
              </div>

              {/**
                * خيارات السطر — تظهر بالطلب لا دائمًا.
                *
                * إظهار أربعة حقولٍ إضافية على كل سطرٍ يجعل فاتورةً من خمسة
                * بنود جدارًا لا يُقرأ، والخصم والمجانيّ استثناءٌ لا قاعدة.
                */}
              {lineOptionsFor === line.key && (
                <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-xs sm:grid-cols-2">
                  {canLineDiscount && !line.is_complimentary && (
                    <>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">خصم بمبلغ (ريال)</Label>
                        <Input
                          className="h-8"
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.discount_amount ?? 0}
                          placeholder="مثال: 10 ليدفع 90 عن خدمة بـ100"
                          onChange={(e) =>
                            updateLine(line.key, { discount_amount: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">سبب الخصم (إلزاميّ مع أيّ خصم)</Label>
                        <Input
                          className="h-8"
                          value={line.discount_reason ?? ""}
                          placeholder="قرار الطبيب · مريض متكرّر · تسوية"
                          onChange={(e) => updateLine(line.key, { discount_reason: e.target.value })}
                        />
                      </div>
                    </>
                  )}

                  {canComplimentary && (
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <label className="flex items-center gap-2">
                        <Switch
                          checked={Boolean(line.is_complimentary)}
                          disabled={!line.allow_complimentary}
                          onCheckedChange={(value) =>
                            updateLine(line.key, {
                              is_complimentary: value,
                              // المجانيّ يُلغي الخصم: صفرٌ لا يُخصم منه
                              discount_percent: value ? 0 : line.discount_percent,
                              discount_amount: value ? 0 : (line.discount_amount ?? 0),
                              discount_reason: value ? "" : (line.discount_reason ?? ""),
                            })
                          }
                        />
                        خدمة مجانية
                        {!line.allow_complimentary && (
                          <span className="text-muted-foreground">
                            — غير مؤشَّرة «تُمنَح مجانًا» في بطاقة الصنف
                          </span>
                        )}
                      </label>
                      {line.complimentary_note && (
                        <span className="text-muted-foreground">
                          سياسة الصنف: {line.complimentary_note}
                        </span>
                      )}
                      {line.is_complimentary && (
                        <Input
                          className="h-8"
                          value={line.complimentary_reason ?? ""}
                          placeholder="سبب المنح — مثال: الجلسة الخامسة بعد أربع مدفوعة"
                          onChange={(e) =>
                            updateLine(line.key, { complimentary_reason: e.target.value })
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات الفاتورة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/**
            * الدفع مع الإصدار — طريقة واحدة أو أكثر.
            *
            * الدفع المجزّأ (جزء نقدًا وجزء شبكة) واقعٌ يوميّ، وكان يحتاج
            * إصدار الفاتورة ثم فتح شاشة التحصيل مرّتين. والسطور هنا تُنفَّذ
            * كلّها **داخل معاملة الفاتورة**: إمّا فاتورة وسنداتها معًا أو لا
            * شيء — فلا يبقى مالٌ محصَّل بلا فاتورة ولا فاتورة تدّعي تحصيلًا
            * بلا سند.
            *
            * لا يظهر القسم لعرض السعر: العرض لم يُبَع بعد.
            */}
          {!isQuote && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label>
                  الدفع (اختياري — يمكن التحصيل لاحقًا)
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPayments((prev) => [
                      ...prev,
                      {
                        key: `pay-${Date.now()}-${prev.length}`,
                        methodId: "",
                        /**
                         * كل سطر جديد يُملأ بالمتبقّي لا الأوّل وحده.
                         *
                         * الدفع المجزّأ هكذا يقع فعلًا: «عشرة نقدًا والباقي
                         * شبكة» — فالسطر الثاني مبلغه معروف سلفًا، وحسابه
                         * ذهنيًّا مع كل فاتورة مصدر أخطاء.
                         */
                        amount: Math.max(totals.net - paymentsTotal, 0).toFixed(2),
                        registerId: NONE,
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  طريقة دفع
                </Button>
              </div>

              {payments.map((row) => {
                const method = (paymentMethods.data ?? []).find((m) => m.id === row.methodId);
                return (
                  <div key={row.key} className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-[11rem] flex-1 flex-col gap-1">
                      <Label className="text-xs">الطريقة</Label>
                      <CenteredPicker
                        title="طريقة الدفع"
                        placeholder="اختر الطريقة"
                        value={row.methodId}
                        loading={paymentMethods.isLoading}
                        searchable={false}
                        onChange={(value) =>
                          setPayments((prev) =>
                            prev.map((p) => (p.key === row.key ? { ...p, methodId: value } : p)),
                          )
                        }
                        options={(paymentMethods.data ?? []).map((m) => ({
                          value: m.id,
                          label: m.name_ar,
                          hint: m.affects_drawer ? "نقد — يدخل الصندوق" : undefined,
                        }))}
                      />
                    </div>
                    <div className="flex w-32 flex-col gap-1">
                      <Label className="text-xs">المبلغ</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          dir="ltr"
                          value={row.amount}
                          onChange={(e) =>
                            setPayments((prev) =>
                              prev.map((p) =>
                                p.key === row.key ? { ...p, amount: e.target.value } : p,
                              ),
                            )
                          }
                        />
                        {/* «الباقي» يملأ هذا السطر بما لم تغطّه بقيّة السطور */}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          title="املأ بالمبلغ المتبقّي"
                          onClick={() =>
                            setPayments((prev) => {
                              const others = prev
                                .filter((p) => p.key !== row.key)
                                .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                              const rest = Math.max(totals.net - others, 0).toFixed(2);
                              return prev.map((p) =>
                                p.key === row.key ? { ...p, amount: rest } : p,
                              );
                            })
                          }
                        >
                          الباقي
                        </Button>
                      </div>
                    </div>
                    {/* الصندوق يظهر للنقد وحده: القاعدة تشترط مناوبة مفتوحة
                        للقبض النقديّ ولا تشترطها للشبكة والتحويل. */}
                    {method?.affects_drawer && (
                      <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
                        <Label className="text-xs">الصندوق</Label>
                        <Select
                          value={row.registerId}
                          onValueChange={(value) =>
                            setPayments((prev) =>
                              prev.map((p) =>
                                p.key === row.key ? { ...p, registerId: value } : p,
                              ),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر الصندوق" />
                          </SelectTrigger>
                          <SelectContent>
                            {(cashRegisters.data ?? []).map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPayments((prev) => prev.filter((p) => p.key !== row.key))
                      }
                    >
                      حذف
                    </Button>
                  </div>
                );
              })}

              {payments.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
                  <span className="tabular-nums">
                    المدفوع: {paymentsTotal.toFixed(2)} · المتبقّي:{" "}
                    {Math.max(totals.net - paymentsTotal, 0).toFixed(2)} ر.س
                  </span>
                  {/* الدفع الجزئيّ لا يمنع الحفظ: الفاتورة تُحفظ بحالة «مدفوعة
                      جزئيًا» والباقي يُحصَّل لاحقًا من شاشة الفواتير. */}
                  {paymentsTotal > 0 && paymentsTotal < totals.net - 0.009 && (
                    <span className="text-xs text-muted-foreground">
                      ستُحفظ الفاتورة مدفوعةً جزئيًا، والباقي يبقى مستحقًّا على المريض.
                    </span>
                  )}
                  {paymentsTotal > totals.net + 0.009 && (
                    <span className="text-xs text-destructive">
                      المدفوع يتجاوز صافي الفاتورة — صحّح المبالغ قبل الحفظ.
                    </span>
                  )}
                  {payments.some((row) => Number(row.amount) > 0 && !row.methodId) && (
                    <span className="text-xs text-destructive">اختر طريقة الدفع لكل مبلغ.</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* سبب الإعفاء يُقال للصرّاف: صفرٌ بلا تفسير يُقرأ خطأً في النظام */}
          {effectiveVat.isSuccess && effectiveVat.data.exempt_reason && (
            <p className="rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
              {effectiveVat.data.exempt_reason} — لا تُحتسب ضريبة على هذه الفاتورة.
            </p>
          )}

          {/* المنع يُعرض قبل الإدخال لا بعده */}
          {vatBlocked && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
              {effectiveVat.data?.block_reason}
            </p>
          )}

          {effectiveVat.isError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
              تعذّر تحديد نسبة الضريبة السارية: {errorMessage(effectiveVat.error)} — الحفظ
              متوقّف حتى تُقرأ، فالرقم المعروض قد يخالف ما تحسبه القاعدة.
            </p>
          )}

          <div className="flex flex-col items-end gap-1 text-sm">
            <span>الإجمالي الفرعي: {totals.subtotal.toFixed(2)}</span>
            <span>الخصم: {totals.discount.toFixed(2)}</span>
            <span>الضريبة: {totals.vat.toFixed(2)}</span>
            <span className="text-base font-bold">الصافي: {totals.net.toFixed(2)} ر.س</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={
              createInvoice.isPending ||
              lines.length === 0 ||
              paymentsInvalid ||
              vatUnresolved ||
              vatBlocked
            }
            onClick={() => createInvoice.mutate()}
          >
            <Receipt className="h-4 w-4" />
            {createInvoice.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
