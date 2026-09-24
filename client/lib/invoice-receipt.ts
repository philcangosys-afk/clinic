import { printHtml, type PaperSize } from "@/lib/document-merge";

/**
 * إيصال الفاتورة الحراريّ (٨٠ مم) — هويّة المنشأة كاملة على الورقة.
 *
 * **ما كانت عليه:** جدولٌ أبيض بلا شعار ولا اسم قانونيّ ولا عنوان، ولا رقم
 * ضريبيّ للعميل، ولا عمر ولا جنسية ولا رقم هوية ولا رقم ملف، ولا تفصيل
 * للمدفوع بطرقه، ولا شروط المجمع. والورقة التي يأخذها المريض هي وجه المنشأة
 * عنده، وهي أيضًا وثيقةٌ قد تُراجَع.
 *
 * التخطيط منقولٌ عن إيصال العيادات الذي يعمل عليه المالك: صفٌّ من ثلاث خانات
 * — الاسم العربيّ يمينًا، والقيمة وسطًا، والإنجليزيّ يسارًا — فيقرأه المريض
 * والمراجع الضريبيّ معًا.
 *
 * **كل الأرقام تأتي من القاعدة** (`v_invoice_print` و`v_invoice_payment_methods`
 * في 0157) ولا يُحسب هنا شيء: الورقة يجب أن تطابق السجلّ حرفًا بحرف، وأيّ
 * حسابٍ في المتصفّح تعريفٌ ثانٍ يفترق عن الأول (وهو ما كسر حفظ الفواتير في
 * 0156).
 */

export type InvoicePrintHeader = {
  invoice_id: string;
  invoice_number: number | string | null;
  document_prefix: string | null;
  document_number: number | null;
  invoice_type: string;
  is_temporary: boolean;
  status: string;
  invoice_at: string;

  seller_name: string | null;
  seller_name_en: string | null;
  seller_tax_number: string | null;
  seller_cr_number: string | null;
  seller_address: string | null;

  logo_url: string | null;
  show_logo: boolean;
  footer_note: string | null;
  policy_lines: string[] | null;
  paper_size: PaperSize;

  customer_name: string | null;
  customer_file_number: number | null;
  customer_id_number: string | null;
  customer_tax_number: string | null;
  customer_nationality: string | null;
  customer_nationality_en: string | null;
  customer_mobile: string | null;
  customer_email: string | null;
  age_years: number | null;
  age_months: number | null;
  age_days: number | null;

  doctor_name: string | null;
  clinic_name: string | null;

  subtotal_amount: number | null;
  discount_amount: number | null;
  vat_amount: number | null;
  exemption_amount: number | null;
  net_amount: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  is_insurance_invoice: boolean;
  insurance_company_name: string | null;
  insurance_share_amount: number | null;
  patient_share_amount: number | null;
  note: string | null;
  zatca_qr: string | null;
};

export type InvoicePrintItem = {
  description: string | null;
  qty: number | null;
  price: number | null;
  discount_amount: number | null;
  vat_amount: number | null;
  net_amount: number | null;
};

export type InvoicePaymentMethod = {
  method_name: string | null;
  method_code: string | null;
  amount: number | null;
};

export type InvoicePrintData = {
  header: InvoicePrintHeader;
  items: InvoicePrintItem[];
  payments: InvoicePaymentMethod[];
  /** اسم المستخدم الذي يطبع — يظهر في التذييل كما في إيصال العيادات */
  printedBy?: string | null;
  /** رقمه الوظيفي (0184) — يُطبع بجانب اسمه فيُعرف من أصدر الورقة */
  printedByJobNumber?: string | null;
  /** كم مرّة طُبعت هذه الفاتورة (0186) — عدّادٌ في القاعدة لا في الجهاز */
  printCount?: number | null;
  /** شعارٌ مُحمَّل مسبقًا كـdata URI — انظر `loadLogoDataUrl` */
  logoDataUrl?: string | null;
  /** رمز ZATCA صورةً جاهزة (data URI) — يُولَّد قبل الطباعة */
  qrDataUrl?: string | null;
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;"
    : ch === "<" ? "&lt;"
    : ch === ">" ? "&gt;"
    : ch === '"' ? "&quot;"
    : "&#39;",
  );
}

/** أرقام لاتينية دائمًا وبخانتين — الورقة المالية لا تحتمل اختلاف الترقيم. */
function money(value: unknown): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/**
 * التاريخ والوقت بأرقام لاتينية وتقويم ميلاديّ.
 *
 * لا يمرّ عبر `formatDateTime` لأنّ ذلك يتبع إعداد التقويم في الشاشة، والورقة
 * الضريبية تحمل التاريخ الميلاديّ دائمًا.
 */
function stamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  let h = d.getHours();
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${suffix}`;
}

export function invoiceLabel(header: InvoicePrintHeader): string {
  const number = header.document_prefix
    ? `${header.document_prefix}-${header.document_number ?? header.invoice_number ?? ""}`
    : String(header.invoice_number ?? "—");
  return number;
}

function titleOf(header: InvoicePrintHeader): { ar: string; en: string } {
  if (header.invoice_type === "return") {
    return { ar: "إشعار دائن", en: "Credit Note" };
  }
  if (header.is_temporary) {
    return { ar: "عرض سعر — ليس فاتورة ضريبية", en: "Quotation — Not a Tax Invoice" };
  }
  return { ar: "فاتورة ضريبية مبسطة", en: "Simplified Tax Invoice" };
}

const STYLE = `
<style>
  .rcpt { width: 100%; font-family: Tahoma, Arial, sans-serif; }
  .rcpt * { box-sizing: border-box; }
  .rcpt .logo { text-align: center; margin: 0 0 4px; }
  .rcpt .logo img { max-width: 46mm; max-height: 22mm; }
  .rcpt table.bx { width: 100%; border-collapse: collapse; margin: 0 0 3px; }
  .rcpt table.bx th, .rcpt table.bx td {
    border: 1px solid #000; padding: 2px 3px; font-size: 10px; vertical-align: middle;
  }
  .rcpt .lbl-ar { text-align: right; white-space: nowrap; }
  .rcpt .lbl-en { text-align: left; white-space: nowrap; direction: ltr; }
  .rcpt .val { text-align: center; font-weight: 600; }
  .rcpt .seller { text-align: center; font-size: 15px; font-weight: 700; padding: 4px 3px; }
  .rcpt .addr { text-align: center; font-size: 10px; font-weight: 600; }
  .rcpt .kind { text-align: center; font-weight: 700; font-size: 11px; }
  .rcpt .num { text-align: center; font-variant-numeric: tabular-nums; }
  /* التاريخ والعمر نصٌّ لاتينيّ داخل صفحةٍ عربية: بلا عزلٍ صريح ينقلب
     ترتيبه فيصير «PM 03:23 24/09/2026» بدل «24/09/2026 03:23 PM». */
  .rcpt .ltr { direction: ltr; unicode-bidi: isolate; text-align: center; }
  .rcpt .items th { text-align: center; font-size: 9px; font-weight: 700; }
  .rcpt .items td { font-size: 10px; }
  .rcpt .items .nm { text-align: right; }
  .rcpt .policy { text-align: center; font-weight: 700; font-size: 10.5px; margin: 5px 0; line-height: 1.5; }
  .rcpt .qr { text-align: center; margin: 6px 0; }
  .rcpt .qrbox {
    display: inline-block; width: 26mm; height: 26mm; border: 1px dashed #000;
    font-size: 8px; line-height: 1.35; padding: 3mm 1mm; color: #000;
  }
  .rcpt .qrimg { width: 26mm; height: 26mm; }
  .rcpt .qrnote { font-size: 7.5px; margin-top: 2px; }
  .rcpt .foot { text-align: center; font-size: 8.5px; line-height: 1.5; margin-top: 6px; }
  .rcpt .muted { color: #333; }
</style>`;

/**
 * صفٌّ ثلاثيّ: العربيّ يمينًا، والقيمة وسطًا، والإنجليزيّ يسارًا.
 *
 * **الصفّ يبقى ولو كانت قيمته فارغة.** ورقةٌ تُسقط «رقم الهوية» حين لا يكون
 * مسجّلًا تخرج بطولٍ مختلفٍ كل مرّة، والموظّف الذي يقرأ عشرين فاتورة في
 * الساعة يعرف موضع كل حقلٍ بعينه — فالفراغ أوضح من الاختفاء، وهو أيضًا
 * يذكّر من يُدخل البيانات بما نقص.
 */
function row(ar: string, value: string, en: string): string {
  return `<tr><td class="lbl-ar">${esc(ar)}</td><td class="val">${value || "&nbsp;"}</td><td class="lbl-en">${esc(en)}</td></tr>`;
}

/** تصنيف طرق الدفع إلى خانتي الإيصال المعتمد: نقدي وصرّاف. */
function splitPayments(payments: InvoicePaymentMethod[]) {
  const CASH = /cash|نقد/i;
  const CARD = /card|mada|atm|pos|network|شبك|صراف|مدى|بطاق/i;
  let cash = 0;
  let card = 0;
  const others: { name: string; amount: number }[] = [];
  for (const p of payments) {
    const amount = Number(p.amount ?? 0);
    const key = `${p.method_code ?? ""} ${p.method_name ?? ""}`;
    if (CASH.test(key)) cash += amount;
    else if (CARD.test(key)) card += amount;
    else others.push({ name: p.method_name ?? "أخرى", amount });
  }
  return { cash, card, others };
}

export function buildInvoiceReceiptHtml(data: InvoicePrintData): string {
  const h = data.header;
  const kind = titleOf(h);
  const logo = data.logoDataUrl ?? (h.logo_url || null);

  const ageText =
    h.age_years === null || h.age_years === undefined
      ? ""
      : `${h.age_years} Year , ${h.age_months ?? 0} Month , ${h.age_days ?? 0}`;

  const infoRows = [
    row("رقم الفاتورة", esc(invoiceLabel(h)), "Invoice. N."),
    row("التاريخ", `<span class="ltr">${esc(stamp(h.invoice_at))}</span>`, "Date"),
    row("إسم الطبيب", esc(h.doctor_name ?? ""), "Doctor"),
    row("إسم العيادة", esc(h.clinic_name ?? ""), "Clinic"),
    row("إسم المريض", esc(h.customer_name ?? ""), "Patient"),
    row("الرقم الضريبي للعميل", esc(h.customer_tax_number ?? ""), "Cust. VAT"),
    row("العمر", ageText ? `<span class="ltr">${esc(ageText)}</span>` : "", "Age"),
    row("الجنسية", esc(h.customer_nationality_en || h.customer_nationality || ""), "Nat."),
    row("رقم الهوية", esc(h.customer_id_number ?? ""), "ID"),
    row(
      "رقم الملف",
      esc(h.customer_file_number === null || h.customer_file_number === undefined ? "" : h.customer_file_number),
      "File. No.",
    ),
  ].join("");

  const itemRows = data.items
    .map(
      (line) =>
        `<tr>` +
        `<td class="nm">${esc(line.description ?? "—")}</td>` +
        `<td class="num">${money(line.price)}</td>` +
        `<td class="num">${esc(line.qty ?? 1)}</td>` +
        // الصافي هنا **قبل الضريبة** كما في الإيصال المعتمد: عمود «الصافي»
        // يقابل «الصافي قبل الضريبة» في الإجماليات، والضريبة سطرٌ مستقل.
        `<td class="num">${money(Number(line.net_amount ?? 0) - Number(line.vat_amount ?? 0))}</td>` +
        `</tr>`,
    )
    .join("");

  const totalsRows = [
    row("المبلغ قبل الضريبة", `<span class="num">${money(h.subtotal_amount)}</span>`, "Amount"),
    row("إجمالي الخصم", `<span class="num">${money(h.discount_amount)}</span>`, "Discount"),
    row(
      "الصافي قبل الضريبة",
      `<span class="num">${money(Number(h.subtotal_amount ?? 0) - Number(h.discount_amount ?? 0))}</span>`,
      "Total",
    ),
    Number(h.exemption_amount ?? 0) > 0
      ? row("المبلغ المعفى", `<span class="num">${money(h.exemption_amount)}</span>`, "Exempt")
      : "",
    row("قيمة الضريبة المضافة", `<span class="num">${money(h.vat_amount)}</span>`, "VAT"),
    row("المبلغ بعد الضريبة", `<span class="num">${money(h.net_amount)}</span>`, "Net"),
    /**
     * حصّتا التأمين والمريض تُطبعان حين تكون الفاتورة تأمينية وحدها: المريض
     * المؤمَّن يستلم ورقةً تقول «الصافي ٥٠٠» بينما لا يخصّه منها إلا حصّته،
     * فرقمٌ يخيفه بلا سبب ويجعل تحصيل الاستقبال خاطئًا.
     */
    h.is_insurance_invoice
      ? row(
          `حصة التأمين${h.insurance_company_name ? ` (${h.insurance_company_name})` : ""}`,
          `<span class="num">${money(h.insurance_share_amount)}</span>`,
          "Insurer",
        )
      : "",
    h.is_insurance_invoice
      ? row(
          "حصة المريض",
          `<span class="num">${money(h.patient_share_amount ?? h.net_amount)}</span>`,
          "Patient",
        )
      : "",
  ]
    .filter(Boolean)
    .join("");

  /**
   * خانات الدفع ثابتة كما في الإيصال المعتمد: المدفوع، ثمّ نقدي، ثمّ صرّاف.
   * وما خرج عنها (تحويل، محفظة، تأمين) يُضاف خانةً إضافية — فلا يضيع مبلغ.
   */
  const split = splitPayments(data.payments);
  const payCell = (ar: string, en: string, amount: number) =>
    `<td class="val">${esc(ar)} - ${esc(en)}<br /><span class="num">${money(amount)}</span></td>`;
  const payCells =
    payCell("المدفوع", "Paid", Number(h.paid_amount ?? 0)) +
    payCell("نقدي", "Cash", split.cash) +
    payCell("صراف", "ATM", split.card) +
    split.others.map((o) => payCell(o.name, "", o.amount)).join("");
  const paySpan = 3 + split.others.length;

  const policy = (h.policy_lines ?? [])
    .map((line) => `<div class="policy">${esc(line)}</div>`)
    .join("");

  return `${STYLE}
<div class="rcpt">
  ${
    h.show_logo && logo
      ? `<div class="logo"><img src="${esc(logo)}" alt="" /></div>`
      : ""
  }

  <table class="bx">
    <tr>
      <td class="lbl-ar">الرقم الضريبي للبائع</td>
      <td class="val num">${esc(h.seller_tax_number ?? "—")}</td>
    </tr>
    <tr><td class="seller" colspan="2">${esc(h.seller_name ?? "—")}</td></tr>
    ${h.seller_address ? `<tr><td class="addr" colspan="2">العنوان : ${esc(h.seller_address)}</td></tr>` : ""}
    ${h.seller_cr_number ? `<tr><td class="addr" colspan="2">السجل التجاري : ${esc(h.seller_cr_number)}</td></tr>` : ""}
    <tr><td class="kind" colspan="2">${esc(kind.en)} &nbsp;—&nbsp; ${esc(kind.ar)}</td></tr>
  </table>

  <table class="bx">${infoRows}</table>

  <table class="bx items">
    <thead>
      <tr>
        <th>اسم الصنف<br />Item Name</th>
        <th>السعر<br />Price</th>
        <th>العدد<br />Count</th>
        <th>الصافي<br />Net</th>
      </tr>
    </thead>
    <tbody>${itemRows || `<tr><td colspan="4" class="val">لا بنود</td></tr>`}</tbody>
  </table>

  <table class="bx">${totalsRows}</table>

  <table class="bx">
    <tr>${payCells}</tr>
    <tr><td class="val" colspan="${paySpan}">المتبقّي — Remain &nbsp; <span class="num">${money(h.remaining_amount)}</span></td></tr>
  </table>

  <table class="bx">${row("ملاحظة", esc(h.note ?? ""), "Note")}</table>

  ${policy}

  <div class="qr">
    ${
      data.qrDataUrl
        ? `<img class="qrimg" src="${esc(data.qrDataUrl)}" alt="ZATCA QR" />`
        : `<div class="qrbox">رمز زاتكا<br />ZATCA QR<br /><br />يظهر بعد<br />اعتماد الفاتورة</div>`
    }
  </div>

  <div class="foot muted">
    <div class="ltr">User: ${esc(data.printedBy ?? "")}${data.printedByJobNumber ? ` - ${esc(data.printedByJobNumber)}` : ""}</div>
    <div class="ltr">Printing Date: ${esc(stamp(new Date()))}</div>
    <div class="ltr">Printed Count : ${esc(data.printCount ?? 1)}</div>
    <div>${esc(h.seller_name ?? "")}</div>
    ${h.footer_note ? `<div>${esc(h.footer_note)}</div>` : ""}
  </div>
</div>`;
}

/**
 * الشعار يُحوَّل إلى data URI قبل الطباعة.
 *
 * `printHtml` تستدعي `print()` فور كتابة المستند، وصورةٌ تُحمَّل من الشبكة قد
 * لا تصل قبلها — فتخرج الورقة بلا شعار أحيانًا وبه أحيانًا، وهو أسوأ من غيابه
 * دائمًا. والتضمين يجعلها تُطبع من أوّل مرة ويعمل بلا شبكة.
 *
 * الفشل لا يمنع الطباعة: فاتورةٌ بلا شعار خيرٌ من فاتورةٍ لا تُطبع.
 */
export async function loadLogoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 2 * 1024 * 1024) return url;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function printInvoiceReceipt(data: InvoicePrintData) {
  printHtml(
    `فاتورة ${invoiceLabel(data.header)}`,
    buildInvoiceReceiptHtml(data),
    data.header.paper_size ?? "thermal_80mm",
  );
}

/**
 * نصّ الرسالة التي تُرسل للمريض.
 *
 * ملخّصٌ لا صورة: رابط `wa.me` و`mailto` لا يحملان مرفقًا، ونصٌّ يقول الرقم
 * والتاريخ والصافي والمتبقّي يكفي المريض ليعرف ما دفع وما عليه. والورقة
 * نفسها تُطبع أو تُحفظ PDF من زرّ الطباعة وتُرفق يدويًّا.
 */
export function buildInvoiceMessage(header: InvoicePrintHeader): string {
  const lines = [
    `${header.seller_name ?? ""}`,
    "",
    `${header.invoice_type === "return" ? "إشعار دائن" : "فاتورة"} رقم: ${invoiceLabel(header)}`,
    `التاريخ: ${stamp(header.invoice_at)}`,
    header.customer_name ? `المريض: ${header.customer_name}` : "",
    header.doctor_name ? `الطبيب: ${header.doctor_name}` : "",
    "",
    `الإجمالي قبل الضريبة: ${money(header.subtotal_amount)}`,
    Number(header.discount_amount ?? 0) > 0 ? `الخصم: ${money(header.discount_amount)}` : "",
    `الضريبة: ${money(header.vat_amount)}`,
    `الصافي: ${money(header.net_amount)} ر.س`,
    header.is_insurance_invoice
      ? `حصة المريض: ${money(header.patient_share_amount ?? header.net_amount)} ر.س`
      : "",
    `المدفوع: ${money(header.paid_amount)} ر.س`,
    `المتبقّي: ${money(header.remaining_amount)} ر.س`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** رقم الجوال بصيغة دولية بلا رموز — `wa.me` لا يقبل غيرها. */
export function toWhatsAppNumber(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const digits = String(mobile).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("966")) return digits;
  // ٠٥xxxxxxxx محليّ → ٩٦٦٥xxxxxxxx
  if (digits.startsWith("0")) return `966${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `966${digits}`;
  return digits;
}
