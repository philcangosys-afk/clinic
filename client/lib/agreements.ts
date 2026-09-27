import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { printHtml } from "@/lib/document-merge";

/**
 * الاتفاقيات وعروض أسعارها (0193).
 *
 *   الاتفاقية (رأسٌ للمريض) ⟵ عروض أسعار ⟵ بنود ⟵ «فوترة» إلى فاتورة ضريبية
 *
 * الاتفاقية مستندٌ مرن للتفاوض: تُعدَّل بنودها وخصمها قبل أن يصدر شيءٌ ضريبيّ.
 * والحساب الملزِم في القاعدة (`app_save_agreement_quote`) بقاعدة الفاتورة
 * نفسها — وما هنا (`computeQuoteLine`) معاينةٌ فوريّة لما ستحفظه، بنفس
 * المعادلات حرفًا بحرف، لا مصدرٌ ثانٍ للرقم.
 */

export type AgreementListRow = {
  id: string;
  organization_id: string;
  agreement_number: number;
  patient_id: string;
  patient_name: string;
  file_number: number | string | null;
  agreement_date: string;
  created_at: string;
  doctor_id: string | null;
  doctor_name: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  registrar_id: string | null;
  registrar_name: string | null;
  note: string | null;
  agreement_text: string | null;
  is_disabled: boolean;
  disabled_reason: string | null;
  services: string | null;
  quotes_count: number;
  gross_amount: number;
  discount_amount: number;
  vat_amount: number;
  net_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
};

export type QuoteListRow = {
  id: string;
  organization_id: string;
  agreement_id: string;
  quote_number: number;
  quote_date: string;
  doctor_id: string | null;
  doctor_name: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  note: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  created_by_name: string | null;
  lines_count: number;
  gross_amount: number;
  discount_amount: number;
  taxable_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
};

export type QuoteLineRow = {
  id: string;
  agreement_id: string;
  quote_id: string;
  item_id: string | null;
  item_code: string | null;
  item_barcode: string | null;
  description: string;
  min_price: number | null;
  max_price: number | null;
  item_vat_exempt: boolean;
  qty: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  discount_percent: number;
  taxable_amount: number;
  vat_rate: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  sort_order: number;
  invoiced_qty: number;
  remaining_qty: number;
  invoiced_amount: number;
};

export type AgreementFilters = {
  patientId?: string | null;
  from?: string | null;
  to?: string | null;
  doctorId?: string | null;
  registrarId?: string | null;
  activeOnly?: boolean;
};

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function useAgreementList(organizationId: string | undefined, filters: AgreementFilters) {
  return useQuery({
    queryKey: ["agreement-list", organizationId, filters],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase.from("v_agreement_list").select("*").eq("organization_id", organizationId);
      if (filters.patientId) query = query.eq("patient_id", filters.patientId);
      if (filters.from) query = query.gte("agreement_date", filters.from);
      if (filters.to) query = query.lte("agreement_date", filters.to);
      if (filters.doctorId) query = query.eq("doctor_id", filters.doctorId);
      if (filters.registrarId) query = query.eq("registrar_id", filters.registrarId);
      if (filters.activeOnly) query = query.eq("is_disabled", false);
      const { data, error } = await query.order("agreement_number", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as AgreementListRow[];
    },
  });
}

export function useAgreement(agreementId: string | null | undefined) {
  return useQuery({
    queryKey: ["agreement", agreementId],
    enabled: Boolean(agreementId),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_agreement_list").select("*").eq("id", agreementId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as AgreementListRow | null;
    },
  });
}

export function useAgreementQuotes(agreementId: string | null | undefined) {
  return useQuery({
    queryKey: ["agreement-quotes", agreementId],
    enabled: Boolean(agreementId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agreement_quote_list")
        .select("*")
        .eq("agreement_id", agreementId)
        .order("quote_number");
      if (error) throw error;
      return (data ?? []) as QuoteListRow[];
    },
  });
}

export function useQuoteLines(quoteId: string | null | undefined) {
  return useQuery({
    queryKey: ["agreement-quote-lines", quoteId],
    enabled: Boolean(quoteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agreement_quote_lines")
        .select("*")
        .eq("quote_id", quoteId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        qty: num(row.qty),
        unit_price: num(row.unit_price),
        discount_amount: num(row.discount_amount),
        discount_percent: num(row.discount_percent),
        invoiced_qty: num(row.invoiced_qty),
        remaining_qty: num(row.remaining_qty),
      })) as QuoteLineRow[];
    },
  });
}

/**
 * نسبة الضريبة وإعفاء المريض — بالدالّة التي تسألها الفاتورة (0156).
 *
 * سؤالان لا سؤال: للمريض المُعفى تُرجع الدالّة النسبة صفرًا، والإعفاء يُعرض
 * بالنسبة الأصلية (١٥٪ من الخاضع تتحمّلها الدولة) كما في النظام المرجعيّ.
 */
export function useAgreementVat(organizationId: string | undefined, patientId: string | null | undefined) {
  return useQuery({
    queryKey: ["agreement-vat", organizationId, patientId],
    enabled: Boolean(organizationId && patientId),
    queryFn: async () => {
      const [base, patient] = await Promise.all([
        supabase.rpc("app_effective_vat_rate", { p_organization_id: organizationId, p_patient_id: null }),
        supabase.rpc("app_effective_vat_rate", { p_organization_id: organizationId, p_patient_id: patientId }),
      ]);
      if (base.error) throw base.error;
      if (patient.error) throw patient.error;
      const b = (Array.isArray(base.data) ? base.data[0] : base.data) as { vat_rate?: number } | null;
      const p = (Array.isArray(patient.data) ? patient.data[0] : patient.data) as
        | { patient_exempt?: boolean; exempt_reason?: string | null }
        | null;
      return {
        rate: num(b?.vat_rate),
        patientExempt: Boolean(p?.patient_exempt),
        exemptReason: p?.exempt_reason ?? null,
      };
    },
  });
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * حساب سطر عرض السعر — نسخةٌ حرفية من `app_save_agreement_quote` (0193).
 *
 * الخصم **واحد** بوجهين: المبلغ إن وُجد وإلّا النسبة (٣٠٪ من ٧٠٠ = ٢١٠)، لا
 * خصمان يُجمعان. والإعفاء هو الضريبة التي تتحمّلها الدولة عن المريض المُعفى.
 */
export function computeQuoteLine(
  line: { qty: number; price: number; discountAmount: number; discountPercent: number; itemVatExempt: boolean },
  vat: { rate: number; patientExempt: boolean },
) {
  const qty = Math.max(0, num(line.qty));
  const price = Math.max(0, num(line.price));
  const gross = round2(qty * price);
  let discount = Math.max(0, num(line.discountAmount));
  if (discount === 0) {
    const pct = Math.min(Math.max(num(line.discountPercent), 0), 100);
    discount = round2((gross * pct) / 100);
  }
  discount = Math.min(discount, gross);
  const percent = gross > 0 ? round2((discount / gross) * 100) : 0;
  const taxable = round2(gross - discount);
  const exempt = vat.patientExempt || line.itemVatExempt;
  const vatRate = line.itemVatExempt ? 0 : vat.rate;
  const vatAmount = exempt ? 0 : round2((taxable * vat.rate) / 100);
  const exemption = vat.patientExempt && !line.itemVatExempt ? round2((taxable * vat.rate) / 100) : 0;
  return { gross, discount, percent, taxable, vatRate, vatAmount, exemption, net: round2(taxable + vatAmount) };
}

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (value: unknown) => num(value).toFixed(2);

/**
 * طباعة الاتفاقية — A4 بنصّها وعروضها وبنودها وخانتَي التوقيع.
 *
 * تُقرأ البنود عند الضغط لا مع الشاشة: اتفاقيةٌ بعشرة عروض أسعار لا تُحمَّل
 * بنودها كلّها لأجل زرّ طباعةٍ قد لا يُضغط.
 */
export async function printAgreement(agreement: AgreementListRow, organizationName: string) {
  const [{ data: quotes, error: qError }, { data: lines, error: lError }] = await Promise.all([
    supabase
      .from("v_agreement_quote_list")
      .select("*")
      .eq("agreement_id", agreement.id)
      .eq("is_cancelled", false)
      .order("quote_number"),
    supabase.from("v_agreement_quote_lines").select("*").eq("agreement_id", agreement.id).order("sort_order"),
  ]);
  if (qError) throw qError;
  if (lError) throw lError;

  const quoteBlocks = ((quotes ?? []) as QuoteListRow[])
    .map((quote) => {
      const rows = ((lines ?? []) as QuoteLineRow[])
        .filter((line) => line.quote_id === quote.id)
        .map(
          (line) => `<tr>
            <td>${esc(line.item_code ?? "")}</td>
            <td>${esc(line.description)}</td>
            <td>${money(line.unit_price)}</td>
            <td>${num(line.qty)}</td>
            <td>${money(line.discount_amount)}</td>
            <td>${money(line.taxable_amount)}</td>
            <td>${money(line.vat_amount)}</td>
            <td>${money(line.net_amount)}</td>
            <td>${num(line.invoiced_qty)}</td>
          </tr>`,
        )
        .join("");
      return `<h3>عرض سعر رقم ${quote.quote_number} — ${esc(new Date(quote.quote_date).toLocaleDateString("ar-SA"))}
        ${quote.doctor_name ? ` — ${esc(quote.doctor_name)}` : ""}</h3>
        <table>
          <thead><tr><th>الكود</th><th>الخدمة</th><th>السعر</th><th>العدد</th><th>الخصم</th>
          <th>بلا ضريبة</th><th>الضريبة</th><th>الصافي</th><th>المفوتر</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="7">الإجمالي</th><th>${money(quote.net_amount)}</th><th></th></tr></tfoot>
        </table>`;
    })
    .join("");

  const body = `
    <h2 style="text-align:center">${esc(organizationName)}</h2>
    <h2 style="text-align:center">اتفاقية علاج رقم ${agreement.agreement_number}</h2>
    <table>
      <tr><th>المريض</th><td>${esc(agreement.patient_name)}</td><th>رقم الملف</th><td>${esc(agreement.file_number ?? "")}</td></tr>
      <tr><th>الطبيب المعالج</th><td>${esc(agreement.doctor_name ?? "")}</td><th>العيادة</th><td>${esc(agreement.clinic_name ?? "")}</td></tr>
      <tr><th>تاريخ الاتفاقية</th><td>${esc(agreement.agreement_date)}</td><th>مسجِّل الاتفاقية</th><td>${esc(agreement.registrar_name ?? "")}</td></tr>
    </table>
    ${agreement.agreement_text ? `<h3>نصّ الاتفاقية</h3><p style="white-space:pre-wrap">${esc(agreement.agreement_text)}</p>` : ""}
    ${quoteBlocks}
    <table>
      <tr><th>إجمالي الاتفاقية</th><td>${money(agreement.net_amount)}</td>
          <th>المفوتر</th><td>${money(agreement.invoiced_amount)}</td>
          <th>المتبقي</th><td>${money(agreement.remaining_amount)}</td></tr>
    </table>
    ${agreement.note ? `<p><b>ملاحظات:</b> ${esc(agreement.note)}</p>` : ""}
    <table style="margin-top:40px;border:none">
      <tr><td style="border:none;padding-top:30px">توقيع المريض: ____________________</td>
          <td style="border:none;padding-top:30px">توقيع الطبيب: ____________________</td></tr>
    </table>`;

  printHtml(`اتفاقية ${agreement.agreement_number}`, body, "a4");
}
