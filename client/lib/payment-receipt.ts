import { printHtml, type PaperSize } from "@/lib/document-merge";
import { formatAmount, formatDate, type CalendarDisplay } from "@/lib/locale";

/**
 * سند الدفعة — الورقة التي تُسلَّم لمن دفع.
 *
 * **العيب الذي تعالجه:** شبكة الدفعات تعرض السند على الشاشة ولا تطبعه. من
 * دفع نقدًا ولم يأخذ ورقة لا يملك شيئًا يثبت دفعه، ومن اختلّ صندوقه آخر
 * اليوم لا يجد قسيمةً يطابق بها. وإعادة طباعة الفاتورة كلّها ليست بديلًا:
 * الفاتورة تقول «المدفوع 500» ولا تقول **أيّ** دفعةٍ كانت هذه ولا متى ولا
 * بأيّ طريقة ولا من أيّ صندوق.
 *
 * الورقة تُبنى من صفّ `v_invoice_payments` نفسه المعروض في الشبكة — لا
 * استعلامٌ ثانٍ قد يعود بقيمةٍ أخرى بين العرض والطباعة.
 */

export type PaymentReceiptRow = {
  voucher_number: number | string | null;
  voucher_date: string | null;
  movement_label: string | null;
  payment_method_name: string | null;
  register_name: string | null;
  doctor_name: string | null;
  user_name: string | null;
  device_name: string | null;
  amount: number | string | null;
  note: string | null;
  bank_transfer_ref: string | null;
  is_void?: boolean | null;
  void_reason?: string | null;
};

export type PaymentReceiptContext = {
  sellerName: string | null;
  addressLine: string | null;
  invoiceNumber: number | string | null;
  patientName: string | null;
  fileNumber: number | string | null;
  invoiceNet: number | string | null;
  invoicePaid: number | string | null;
  invoiceRemaining: number | string | null;
  calendarDisplay: CalendarDisplay;
  paper: PaperSize;
  printedByName: string | null;
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const line = (label: string, value: unknown): string => {
  const text = value === null || value === undefined || value === "" ? "—" : value;
  return `<tr><td style="color:#555">${escapeHtml(label)}</td><td style="text-align:end">${escapeHtml(text)}</td></tr>`;
};

export function buildPaymentReceiptHtml(
  row: PaymentReceiptRow,
  context: PaymentReceiptContext,
): string {
  const amount = Number(row.amount ?? 0);
  // الاسترداد يُطبع بقيمته المطلقة وعنوانه يقول إنه استرداد: علامةُ ناقصٍ
  // على ورقةٍ تُسلَّم للمريض تُقرأ خطأً أكثر ممّا تُفهم.
  const title = amount < 0 ? "سند استرداد" : "سند قبض";

  return `
<div style="text-align:center;margin-bottom:6px">
  <h1 style="margin:0">${escapeHtml(context.sellerName ?? "—")}</h1>
  ${context.addressLine ? `<div style="font-size:10px;color:#555">${escapeHtml(context.addressLine)}</div>` : ""}
  <h2 style="margin:6px 0 0">${title}</h2>
  ${row.is_void ? `<div style="color:#b00;font-weight:700">ملغى${row.void_reason ? ` — ${escapeHtml(row.void_reason)}` : ""}</div>` : ""}
</div>
<table>
  <tbody>
    ${line("رقم السند", row.voucher_number)}
    ${line("التاريخ", formatDate(row.voucher_date, context.calendarDisplay))}
    ${line("النوع", row.movement_label)}
    ${line("طريقة الدفع", row.payment_method_name)}
    ${line("الحساب / الصندوق", row.register_name)}
    ${line("المرجع البنكي", row.bank_transfer_ref)}
    ${line("الطبيب", row.doctor_name)}
    ${line("المستخدم", row.user_name)}
    ${line("اسم الجهاز", row.device_name)}
  </tbody>
</table>
<hr style="border:none;border-top:1px dashed #999;margin:6px 0" />
<table>
  <tbody>
    ${line("المريض", context.patientName)}
    ${line("رقم الملف", context.fileNumber)}
    ${line("رقم الفاتورة", context.invoiceNumber)}
    ${line("صافي الفاتورة", `${formatAmount(context.invoiceNet ?? 0)} ر.س`)}
    ${line("إجمالي المدفوع", `${formatAmount(context.invoicePaid ?? 0)} ر.س`)}
    ${line("المتبقّي بعد الدفعة", `${formatAmount(context.invoiceRemaining ?? 0)} ر.س`)}
  </tbody>
</table>
<div style="margin-top:6px;text-align:center;font-size:13px;font-weight:700">
  قيمة ${amount < 0 ? "الاسترداد" : "الدفعة"}: ${escapeHtml(formatAmount(Math.abs(amount)))} ر.س
</div>
${row.note ? `<div style="margin-top:4px;font-size:10px">ملاحظة: ${escapeHtml(row.note)}</div>` : ""}
<div style="margin-top:8px;font-size:9px;color:#666;text-align:center">
  ${context.printedByName ? `طُبع بواسطة: ${escapeHtml(context.printedByName)}` : ""}
</div>
<div style="margin-top:14px;display:flex;justify-content:space-between;font-size:10px">
  <span>توقيع المستلم: ____________</span>
  <span>توقيع المحاسب: ____________</span>
</div>`;
}

export function printPaymentReceipt(row: PaymentReceiptRow, context: PaymentReceiptContext) {
  const amount = Number(row.amount ?? 0);
  printHtml(
    `${amount < 0 ? "سند استرداد" : "سند قبض"} ${row.voucher_number ?? ""}`,
    buildPaymentReceiptHtml(row, context),
    context.paper,
  );
}
