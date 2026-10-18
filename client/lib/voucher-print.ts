import { supabase } from "@/lib/supabase";
import { printHtml } from "@/lib/document-merge";
import { loadLogoDataUrl } from "@/lib/invoice-receipt";

/**
 * الطباعة الرسمية للسندات وفاتورة الشراء (0247).
 *
 * طلب المالك: «طباعة السندات بشكلٍ رسميٍّ ومنسّق». كان سند القبض وحده يُطبع
 * (قسيمة حرارية من شاشة دفعات الفاتورة)، أمّا سند الصرف وسداد المورد والراتب
 * والإيداع فلا ورقة لها. هنا ورقة A4 واحدة لكلّ أنواع السندات:
 *   ترويسة المنشأة (الشعار، الاسم بالعربية والإنجليزية، الرقم الضريبي، السجلّ
 *   التجاري، العنوان) ← عنوان السند ورقمه وتاريخه (ميلادي وهجري) ←
 *   الطرف والمبلغ رقمًا وكتابةً والبيان وطريقة الدفع ← الفاتورة المرتبطة ←
 *   التواقيع والختم. والسند الملغى يُطبع بختم «ملغى» وسببه لا يُخفى.
 *
 * البيانات تُقرأ من القاعدة لحظة الطباعة، والنافذة تُفتح مع ضغطة المستخدم
 * قبل الانتظار — وإلّا حجبها المتصفّح.
 */

const AR_NUM = "ar-SA-u-nu-latn";

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString(AR_NUM, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (value: unknown) => Number(value ?? 0).toLocaleString(AR_NUM, { maximumFractionDigits: 3 });

function gregorian(value: string | null | undefined): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-CA");
}

function hijri(value: string | null | undefined): string {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    // الأجزاء أرقامًا لا نصًّا عربيًّا مختلطًا: «1448/05/07» تُقرأ صحيحةً في سطرٍ عربيّ
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year").replace(/\D/g, "");
    return year ? `${year}/${get("month")}/${get("day")}` : "";
  } catch {
    return "";
  }
}

/* ── المبلغ كتابةً ───────────────────────────────────────────────────────── */
const ONES = [
  "", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
  "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر",
  "ثمانية عشر", "تسعة عشر",
];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

function scaled(n: number, singular: string, dual: string, plural: string): string {
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${belowThousand(n)} ${plural}`;
  return `${belowThousand(n)} ${singular}`;
}

/** عددٌ صحيح بالكلمات العربية (حتى 999,999,999). */
export function integerToArabicWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(scaled(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(scaled(thousands, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" و");
}

/** «فقط ألف وثمانمائة وخمسون ريالًا سعوديًّا وخمس وعشرون هللة لا غير». */
export function amountToArabicWords(value: unknown): string {
  const amount = Math.abs(Number(value ?? 0));
  if (!Number.isFinite(amount)) return "";
  const totalHalalas = Math.round(amount * 100);
  const riyals = Math.floor(totalHalalas / 100);
  const halalas = totalHalalas % 100;
  const parts: string[] = [];
  if (riyals > 0 || halalas === 0) parts.push(`${integerToArabicWords(riyals)} ريال سعودي`);
  if (halalas > 0) parts.push(`${integerToArabicWords(halalas)} هللة`);
  return `فقط ${parts.join(" و")} لا غير`;
}

/* ── الترويسة ────────────────────────────────────────────────────────────── */
export type Letterhead = {
  name: string;
  nameEn: string | null;
  vatNumber: string | null;
  crNumber: string | null;
  address: string | null;
  phone: string | null;
  logo: string | null;
  footerNote: string | null;
};

export async function loadLetterhead(orgId: string, branchId?: string | null): Promise<Letterhead> {
  const [org, vat, settings, branch] = await Promise.all([
    supabase.from("organizations").select("name, tax_number").eq("id", orgId).maybeSingle(),
    supabase
      .from("organization_vat_settings")
      .select("legal_name_ar, legal_name_en, vat_registration_number, cr_number, city, district, street_name")
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("print_settings")
      .select("show_logo, logo_url, invoice_address_line, footer_note")
      .eq("organization_id", orgId)
      .maybeSingle(),
    branchId
      ? supabase.from("branches").select("name, phone, address, city").eq("id", branchId).maybeSingle()
      : supabase
          .from("branches")
          .select("name, phone, address, city")
          .eq("organization_id", orgId)
          .eq("is_main", true)
          .maybeSingle(),
  ]);
  const o = (org.data ?? {}) as any;
  const v = (vat.data ?? {}) as any;
  const s = (settings.data ?? {}) as any;
  const b = (branch.data ?? {}) as any;
  const logoUrl = s.show_logo === false ? null : s.logo_url || "/brand-logo.png";
  const absolute = logoUrl ? new URL(logoUrl, window.location.origin).href : null;
  const address =
    (s.invoice_address_line && String(s.invoice_address_line).trim()) ||
    [v.city, v.district, v.street_name].filter((x: unknown) => x && String(x).trim()).join(" - ") ||
    [b.address, b.city].filter(Boolean).join("، ") ||
    null;
  return {
    name: (v.legal_name_ar && String(v.legal_name_ar).trim()) || o.name || "",
    nameEn: v.legal_name_en || null,
    vatNumber: (v.vat_registration_number && String(v.vat_registration_number).trim()) || o.tax_number || null,
    crNumber: v.cr_number || null,
    address,
    phone: b.phone || null,
    logo: absolute ? (await loadLogoDataUrl(absolute)) ?? absolute : null,
    footerNote: s.footer_note || null,
  };
}

async function memberName(orgId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("v_organization_members_directory")
    .select("display_name")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return ((data as any)?.display_name as string | undefined) ?? null;
}

const STYLES = `
  @page{size:A4;margin:12mm}
  *{box-sizing:border-box}
  body{font-family:Tahoma,Arial,sans-serif;color:#111;padding:0;margin:0;font-size:13px;line-height:1.6}
  .doc{position:relative;border:2px solid #1f3a5f;border-radius:6px;padding:14px 18px;min-height:250mm}
  .head{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid #1f3a5f;padding-bottom:8px}
  .head .org{flex:1}
  .head .org h1{margin:0;font-size:19px;color:#1f3a5f}
  .head .org .en{font-size:12px;color:#444;direction:ltr;text-align:right}
  .head .org .meta{font-size:11px;color:#333}
  .head img{max-height:70px;max-width:150px;object-fit:contain}
  .title{display:flex;align-items:stretch;justify-content:space-between;gap:10px;margin:12px 0}
  .title .name{flex:1;text-align:center;border:1.5px solid #1f3a5f;border-radius:6px;padding:6px;background:#eef3f9}
  .title .name b{display:block;font-size:20px;color:#1f3a5f}
  .title .name span{font-size:11px;letter-spacing:2px;color:#1f3a5f}
  .title .box{min-width:150px;border:1.5px solid #1f3a5f;border-radius:6px;padding:4px 8px;font-size:12px}
  .title .box div{display:flex;justify-content:space-between;gap:8px}
  .ltr{direction:ltr;unicode-bidi:embed}
  table.f{width:100%;border-collapse:collapse;margin-top:6px}
  table.f td{border:1px solid #9fb2c8;padding:7px 9px;vertical-align:top}
  table.f td.l{width:24%;background:#f3f6fa;color:#1f3a5f;font-weight:700;white-space:nowrap}
  .amount{display:flex;align-items:center;gap:12px}
  .amount .n{font-size:20px;font-weight:700;border:2px solid #1f3a5f;border-radius:4px;padding:2px 12px;white-space:nowrap}
  .amount .w{flex:1;font-weight:600}
  table.g{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
  table.g th{background:#1f3a5f;color:#fff;padding:6px 5px;border:1px solid #1f3a5f;font-weight:600}
  table.g td{border:1px solid #9fb2c8;padding:5px;text-align:center}
  table.g td.s{text-align:right}
  .totals{margin-top:8px;margin-inline-start:auto;width:46%;border-collapse:collapse}
  .totals td{border:1px solid #9fb2c8;padding:5px 8px}
  .totals td.l{background:#f3f6fa;font-weight:700;color:#1f3a5f}
  .totals tr.net td{font-size:15px;font-weight:700;background:#eef3f9}
  .section{margin-top:12px;font-weight:700;color:#1f3a5f;border-bottom:1px solid #9fb2c8;padding-bottom:2px}
  .signs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:34px;text-align:center;font-size:12px}
  .signs .sig{border-top:1px dashed #333;padding-top:4px;line-height:2.1}
  .signs .sig b{display:block;color:#1f3a5f}
  .signs .stamp{border:1.5px dashed #9fb2c8;border-radius:50%;height:92px;width:92px;margin:-18px auto 0;display:flex;align-items:center;justify-content:center;color:#9fb2c8}
  .foot{position:absolute;bottom:8px;left:18px;right:18px;display:flex;justify-content:space-between;font-size:10px;color:#666;border-top:1px solid #ddd;padding-top:4px}
  .void{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:110px;font-weight:900;color:rgba(200,0,0,.16);border:8px solid rgba(200,0,0,.16);padding:0 40px;border-radius:14px;pointer-events:none}
  .voidnote{margin-top:8px;border:1.5px solid #b00;color:#b00;border-radius:4px;padding:5px 9px;font-weight:700}
  .note{margin-top:8px;font-size:12px;border:1px dashed #9fb2c8;border-radius:4px;padding:5px 8px}
`;

function headerHtml(lh: Letterhead): string {
  const meta = [
    lh.vatNumber ? `الرقم الضريبي: <span class="ltr">${esc(lh.vatNumber)}</span>` : "",
    lh.crNumber ? `السجل التجاري: <span class="ltr">${esc(lh.crNumber)}</span>` : "",
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");
  const contact = [lh.address ? esc(lh.address) : "", lh.phone ? `هاتف: <span class="ltr">${esc(lh.phone)}</span>` : ""]
    .filter(Boolean).join(" &nbsp;|&nbsp; ");
  return `<div class="head">
    <div class="org">
      <h1>${esc(lh.name)}</h1>
      ${lh.nameEn ? `<div class="en">${esc(lh.nameEn)}</div>` : ""}
      ${meta ? `<div class="meta">${meta}</div>` : ""}
      ${contact ? `<div class="meta">${contact}</div>` : ""}
    </div>
    ${lh.logo ? `<img src="${esc(lh.logo)}" alt="" />` : ""}
  </div>`;
}

function footerHtml(lh: Letterhead, preparedBy: string | null): string {
  const printed = new Date().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
  return `<div class="foot">
    <span>${preparedBy ? `أُعدّ بواسطة: ${esc(preparedBy)} — ` : ""}طُبع في: <span class="ltr">${esc(printed)}</span></span>
    <span>${lh.footerNote ? esc(lh.footerNote) : "ZainCare"}</span>
  </div>`;
}

const row = (label: string, value: string | null | undefined) =>
  value === null || value === undefined || value === "" ? "" : `<tr><td class="l">${esc(label)}</td><td>${value}</td></tr>`;

/* ── السند ───────────────────────────────────────────────────────────────── */
const VOUCHER_TITLES: Record<string, { ar: string; en: string }> = {
  receipt: { ar: "سند قبض", en: "RECEIPT VOUCHER" },
  expense: { ar: "سند صرف", en: "PAYMENT VOUCHER" },
  salary: { ar: "سند صرف راتب", en: "SALARY PAYMENT VOUCHER" },
  bank_deposit: { ar: "سند إيداع بنكي", en: "BANK DEPOSIT VOUCHER" },
  bank_withdrawal: { ar: "سند سحب بنكي", en: "BANK WITHDRAWAL VOUCHER" },
  bank_transfer: { ar: "سند تحويل بنكي", en: "BANK TRANSFER VOUCHER" },
};

const VOUCHER_SELECT =
  "id, organization_id, branch_id, voucher_number, voucher_type, voucher_date, amount, payee_name, employee_name, " +
  "description, bank_transfer_ref, vat_amount, supplier_tax_number, expense_source_document, expense_source_number, " +
  "is_void, void_reason, created_by, created_at, related_sales_invoice_id, refund_of_voucher_id, " +
  "patient:patients(name_ar, file_number), distributor:distributors(name_ar, tax_number), " +
  "method:lookup_values!payment_method_value_id(name_ar), category:lookup_values!expense_category_value_id(name_ar), " +
  "register:cash_registers(name), doctor:doctors(name_ar), clinic:clinics(name), " +
  "sales_invoice:sales_invoices!related_sales_invoice_id(invoice_number)";

async function fetchVoucher(voucherId: string): Promise<any> {
  // الرابط بفاتورة الشراء من 0247 — إن لم تُشغَّل الترقية بعد يُطبع السند بدونه
  const withPurchase = await supabase
    .from("financial_vouchers")
    .select(
      `${VOUCHER_SELECT}, purchase_invoice:purchase_invoices!related_purchase_invoice_id(invoice_number, invoice_date, net_amount, paid_amount)`,
    )
    .eq("id", voucherId)
    .maybeSingle();
  if (!withPurchase.error) return withPurchase.data;
  const plain = await supabase.from("financial_vouchers").select(VOUCHER_SELECT).eq("id", voucherId).maybeSingle();
  if (plain.error) throw plain.error;
  return plain.data;
}

export function buildVoucherHtml(v: any, lh: Letterhead, preparedBy: string | null): string {
  const isRefund = v.voucher_type !== "receipt" && (v.related_sales_invoice_id || v.refund_of_voucher_id);
  const title = isRefund
    ? { ar: "سند استرداد", en: "REFUND VOUCHER" }
    : VOUCHER_TITLES[v.voucher_type] ?? { ar: "سند مالي", en: "VOUCHER" };
  const patient = one<any>(v.patient);
  const distributor = one<any>(v.distributor);
  const method = one<any>(v.method);
  const category = one<any>(v.category);
  const register = one<any>(v.register);
  const doctor = one<any>(v.doctor);
  const clinic = one<any>(v.clinic);
  const salesInvoice = one<any>(v.sales_invoice);
  const purchase = one<any>(v.purchase_invoice);
  const isReceipt = v.voucher_type === "receipt";

  const party =
    (isReceipt
      ? patient?.name_ar ?? v.payee_name
      : distributor?.name_ar ?? v.payee_name ?? v.employee_name ?? patient?.name_ar) ?? "—";
  const partyExtra = [
    patient?.file_number ? `ملف رقم <span class="ltr">${esc(patient.file_number)}</span>` : "",
    distributor?.tax_number ? `الرقم الضريبي <span class="ltr">${esc(distributor.tax_number)}</span>` : "",
  ].filter(Boolean).join(" — ");

  const amount = Math.abs(Number(v.amount ?? 0));
  const vat = Number(v.vat_amount ?? 0);
  const purchaseLine = purchase
    ? `فاتورة المورد رقم <b class="ltr">${esc(purchase.invoice_number)}</b> بتاريخ <span class="ltr">${esc(gregorian(purchase.invoice_date))}</span>` +
      ` — صافيها ${money(purchase.net_amount)} — المسدَّد ${money(purchase.paid_amount)}` +
      ` — المتبقّي ${money(Number(purchase.net_amount ?? 0) - Number(purchase.paid_amount ?? 0))} ر.س`
    : null;
  const source =
    v.expense_source_number ? `${esc(v.expense_source_document ?? "مستند")} <span class="ltr">${esc(v.expense_source_number)}</span>` : null;

  const signs = isReceipt
    ? ["المُسلِّم (الدافع)", "أمين الصندوق", "المحاسب"]
    : ["المستلم", "المحاسب", "المدير المعتمد"];

  return `<style>${STYLES}</style>
<div class="doc">
  ${v.is_void ? `<div class="void">ملغى</div>` : ""}
  ${headerHtml(lh)}
  <div class="title">
    <div class="box">
      <div><span>رقم السند</span><b class="ltr">${esc(v.voucher_number)}</b></div>
      <div><span>التاريخ</span><span class="ltr">${esc(gregorian(v.voucher_date))}</span></div>
      ${hijri(v.voucher_date) ? `<div><span>الموافق</span><span><span class="ltr">${esc(hijri(v.voucher_date))}</span> هـ</span></div>` : ""}
    </div>
    <div class="name"><b>${esc(title.ar)}</b><span>${esc(title.en)}</span></div>
    <div class="box">
      <div><span>المبلغ</span><b class="ltr">${money(amount)}</b></div>
      <div><span>العملة</span><span>ريال سعودي</span></div>
    </div>
  </div>
  ${v.is_void ? `<div class="voidnote">هذا السند ملغى${v.void_reason ? ` — السبب: ${esc(v.void_reason)}` : ""}</div>` : ""}
  <table class="f">
    ${row(isReceipt ? "استلمنا من" : "صُرف إلى", `<b>${esc(party)}</b>${partyExtra ? ` <span style="font-size:11px;color:#444">(${partyExtra})</span>` : ""}`)}
    <tr><td class="l">مبلغ وقدره</td><td><div class="amount"><span class="n ltr">${money(amount)}</span><span class="w">${esc(amountToArabicWords(amount))}</span></div></td></tr>
    ${row("وذلك عن", v.description ? esc(v.description) : null)}
    ${row("فاتورة الشراء", purchaseLine)}
    ${row("فاتورة المبيعات", salesInvoice?.invoice_number ? `<span class="ltr">${esc(salesInvoice.invoice_number)}</span>` : null)}
    ${row("بند المصروف", category?.name_ar ? esc(category.name_ar) : null)}
    ${row("المستند المؤيِّد", source)}
    ${vat > 0 ? row("المبلغ قبل الضريبة", `${money(amount - vat)} ر.س`) : ""}
    ${vat > 0 ? row("ضريبة القيمة المضافة", `${money(vat)} ر.س${v.supplier_tax_number ? ` — الرقم الضريبي للمورد <span class="ltr">${esc(v.supplier_tax_number)}</span>` : ""}`) : ""}
    ${row("طريقة الدفع", method?.name_ar ? esc(method.name_ar) : null)}
    ${row("الصندوق", register?.name ? esc(register.name) : null)}
    ${row("المرجع البنكي / رقم الشيك", v.bank_transfer_ref ? `<span class="ltr">${esc(v.bank_transfer_ref)}</span>` : null)}
    ${row("الطبيب", doctor?.name_ar ? esc(doctor.name_ar) : null)}
    ${row("العيادة", clinic?.name ? esc(clinic.name) : null)}
  </table>
  <div class="signs">
    ${signs.map((s) => `<div class="sig"><b>${esc(s)}</b>الاسم: ......................<br/>التوقيع: ....................</div>`).join("")}
    <div><div class="stamp">الختم</div></div>
  </div>
  ${footerHtml(lh, preparedBy)}
</div>`;
}

/**
 * يطبع سندًا ماليًّا من أيّ نوع على A4. يُستدعى مباشرةً من ضغطة الزرّ:
 * النافذة تُفتح قبل أوّل انتظار فلا يحجبها المتصفّح.
 */
export async function printVoucherById(voucherId: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.");
    return;
  }
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma;padding:24px">جارٍ تجهيز السند…</body></html>`);
  win.document.close();
  try {
    const v = await fetchVoucher(voucherId);
    if (!v) throw new Error("السند غير موجود");
    const [lh, preparedBy] = await Promise.all([
      loadLetterhead(v.organization_id, v.branch_id),
      memberName(v.organization_id, v.created_by),
    ]);
    const title = `${(VOUCHER_TITLES[v.voucher_type] ?? { ar: "سند" }).ar} ${v.voucher_number ?? ""}`;
    printHtml(title, buildVoucherHtml(v, lh, preparedBy), "a4", win);
  } catch (error) {
    win.close();
    throw error;
  }
}

/* ── فاتورة الشراء ───────────────────────────────────────────────────────── */
export async function printPurchaseInvoiceById(invoiceId: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.");
    return;
  }
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma;padding:24px">جارٍ تجهيز الفاتورة…</body></html>`);
  win.document.close();
  try {
    const { data: inv, error } = await supabase
      .from("purchase_invoices")
      .select(
        "id, organization_id, branch_id, invoice_number, invoice_date, due_date, subtotal_amount, vat_amount, net_amount, paid_amount, status, supplier_tax_number, note, cancel_reason, created_by, " +
          "distributor:distributors(name_ar, tax_number, mobile_1), warehouse:warehouses(name)",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (error) throw error;
    if (!inv) throw new Error("فاتورة الشراء غير موجودة");
    const invoice = inv as any;
    const [lines, vouchers, lh, preparedBy] = await Promise.all([
      supabase
        .from("purchase_invoice_items")
        .select("qty, free_qty, purchase_price, line_discount_amount, vat_rate, vat_amount, net_amount, lot_number, expiry_date, item:items(name_ar, unit, code)")
        .eq("purchase_invoice_id", invoiceId)
        .order("created_at"),
      supabase
        .from("financial_vouchers")
        .select("voucher_number, voucher_date, amount, is_void, method:lookup_values!payment_method_value_id(name_ar)")
        .eq("related_purchase_invoice_id", invoiceId)
        .order("voucher_number"),
      loadLetterhead(invoice.organization_id, invoice.branch_id),
      memberName(invoice.organization_id, invoice.created_by),
    ]);
    if (lines.error) throw lines.error;
    const items = (lines.data ?? []) as any[];
    const pays = vouchers.error ? [] : ((vouchers.data ?? []) as any[]);
    const distributor = one<any>(invoice.distributor);
    const warehouse = one<any>(invoice.warehouse);
    const net = Number(invoice.net_amount ?? 0);
    const paid = Number(invoice.paid_amount ?? 0);
    const sub = Number(invoice.subtotal_amount ?? 0);
    const vat = Number(invoice.vat_amount ?? 0);
    const discount = items.reduce((acc, l) => acc + Number(l.line_discount_amount ?? 0), 0);
    const cancelled = invoice.status === "cancelled";

    const body = `<style>${STYLES}</style>
<div class="doc">
  ${cancelled ? `<div class="void">ملغاة</div>` : ""}
  ${headerHtml(lh)}
  <div class="title">
    <div class="box">
      <div><span>رقم فاتورة المورد</span><b class="ltr">${esc(invoice.invoice_number)}</b></div>
      <div><span>التاريخ</span><span class="ltr">${esc(gregorian(invoice.invoice_date))}</span></div>
      ${invoice.due_date ? `<div><span>الاستحقاق</span><span class="ltr">${esc(gregorian(invoice.due_date))}</span></div>` : ""}
    </div>
    <div class="name"><b>فاتورة مشتريات</b><span>PURCHASE INVOICE</span></div>
    <div class="box">
      <div><span>المستودع</span><span>${esc(warehouse?.name ?? "—")}</span></div>
      <div><span>الحالة</span><span>${cancelled ? "ملغاة" : paid >= net - 0.001 && net > 0 ? "مسدَّدة" : paid > 0 ? "مسدَّدة جزئيًّا" : "آجلة"}</span></div>
    </div>
  </div>
  ${cancelled && invoice.cancel_reason ? `<div class="voidnote">ملغاة — ${esc(invoice.cancel_reason)}</div>` : ""}
  <table class="f">
    ${row("المورد", `<b>${esc(distributor?.name_ar ?? "—")}</b>`)}
    ${row("الرقم الضريبي للمورد", invoice.supplier_tax_number || distributor?.tax_number ? `<span class="ltr">${esc(invoice.supplier_tax_number || distributor?.tax_number)}</span>` : "بدون رقم ضريبي")}
    ${row("جوال المورد", distributor?.mobile_1 ? `<span class="ltr">${esc(distributor.mobile_1)}</span>` : null)}
  </table>
  <table class="g">
    <thead><tr>
      <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>المجاني</th><th>سعر الوحدة</th>
      <th>الخصم</th><th>الضريبة</th><th>التشغيلة / الصلاحية</th><th>الإجمالي</th>
    </tr></thead>
    <tbody>
      ${items.map((l, i) => {
        const item = one<any>(l.item);
        return `<tr>
          <td>${i + 1}</td>
          <td class="s">${esc(item?.name_ar ?? "—")}${item?.code ? ` <span style="color:#666;font-size:10px" class="ltr">${esc(item.code)}</span>` : ""}</td>
          <td>${esc(item?.unit ?? "")}</td>
          <td class="ltr">${qty(l.qty)}</td>
          <td class="ltr">${Number(l.free_qty ?? 0) ? qty(l.free_qty) : "—"}</td>
          <td class="ltr">${money(l.purchase_price)}</td>
          <td class="ltr">${Number(l.line_discount_amount ?? 0) ? money(l.line_discount_amount) : "—"}</td>
          <td class="ltr">${money(l.vat_amount)} (${qty(l.vat_rate)}%)</td>
          <td class="ltr">${esc([l.lot_number, l.expiry_date].filter(Boolean).join(" / ") || "—")}</td>
          <td class="ltr"><b>${money(l.net_amount)}</b></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <table class="totals">
    <tr><td class="l">الإجمالي قبل الخصم</td><td class="ltr">${money(sub + discount)}</td></tr>
    ${discount > 0 ? `<tr><td class="l">الخصم</td><td class="ltr">${money(discount)}</td></tr>` : ""}
    <tr><td class="l">الإجمالي قبل الضريبة</td><td class="ltr">${money(sub)}</td></tr>
    <tr><td class="l">ضريبة القيمة المضافة</td><td class="ltr">${money(vat)}</td></tr>
    <tr class="net"><td class="l">الصافي</td><td class="ltr">${money(net)} ر.س</td></tr>
    <tr><td class="l">المسدَّد</td><td class="ltr">${money(paid)}</td></tr>
    <tr><td class="l">المتبقّي للمورد</td><td class="ltr">${money(cancelled ? 0 : net - paid)}</td></tr>
  </table>
  <div class="note"><b>الصافي كتابةً:</b> ${esc(amountToArabicWords(net))}</div>
  ${pays.length ? `<div class="section">سندات السداد</div>
  <table class="g">
    <thead><tr><th>رقم السند</th><th>التاريخ</th><th>طريقة الدفع</th><th>المبلغ</th><th>الحالة</th></tr></thead>
    <tbody>${pays.map((p) => `<tr>
      <td class="ltr">${esc(p.voucher_number)}</td><td class="ltr">${esc(gregorian(p.voucher_date))}</td>
      <td>${esc(one<any>(p.method)?.name_ar ?? "—")}</td><td class="ltr">${money(p.amount)}</td>
      <td>${p.is_void ? "ملغى" : "ساري"}</td></tr>`).join("")}</tbody>
  </table>` : ""}
  ${invoice.note ? `<div class="note"><b>ملاحظة:</b> ${esc(invoice.note)}</div>` : ""}
  <div class="signs">
    ${["أعدّه", "أمين المستودع (الاستلام)", "المحاسب"].map((s) => `<div class="sig"><b>${esc(s)}</b>الاسم: ......................<br/>التوقيع: ....................</div>`).join("")}
    <div><div class="stamp">الختم</div></div>
  </div>
  ${footerHtml(lh, preparedBy)}
</div>`;
    printHtml(`فاتورة مشتريات ${invoice.invoice_number ?? ""}`, body, "a4", win);
  } catch (error) {
    win.close();
    throw error;
  }
}
