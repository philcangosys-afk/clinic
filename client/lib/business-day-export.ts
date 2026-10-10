import { buildXlsx, downloadBlob, type XlsxCell, type XlsxStyle } from "@/lib/xlsx-writer";
import { importFresh } from "@/lib/stale-chunk";

/**
 * تنزيل اليومية: Excel منسّق بورقتين (الملخّص، الفواتير)، أو PDF بمقاس A4
 * يُطبع ويُسلَّم مع جرد الصندوق.
 *
 * الأرقام تُكتب في Excel أرقامًا (لا نصًّا) بتنسيق #,##0.00 فتُجمع وتُصفّى.
 * والـPDF يُقسَّم على الصفحات عند حدود الصفوف — لا يُقطع صفّ بين صفحتين —
 * ويتكرّر رأس الجدول في كل صفحة، وفي آخره خانات التوقيع.
 */

export type ExportDaySummary = {
  day_number: number;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  auto_closed?: boolean | null;
  invoices_count: number;
  gross_amount: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  collected_amount: number;
  refunded_amount: number;
  net_collected_amount: number;
  outstanding_amount: number;
};

export type ExportDayCollection = {
  method_name: string;
  affects_drawer: boolean;
  vouchers_count: number;
  amount: number;
};

export type ExportDayInvoice = {
  invoice_id?: string;
  invoice_number: number;
  created_at: string;
  status: string;
  is_temporary: boolean;
  invoice_type: string;
  net_amount: number;
  paid_amount: number;
  remaining_amount: number;
  patient_name: string | null;
  file_number: number | null;
  external_customer_name: string | null;
  doctor_name: string | null;
  /** رقم الفاتورة الضريبية كما طُبع (مثل C-10138) — إن توفّر */
  document_label?: string | null;
  discount_amount?: number | null;
  vat_amount?: number | null;
};

export type ExportDayPeople = {
  opened_by_name: string | null;
  closed_by_name: string | null;
  issuers: string | null;
};

export type ExportDayData = {
  organizationName: string;
  day: ExportDaySummary;
  collections: ExportDayCollection[];
  invoices: ExportDayInvoice[];
  people?: ExportDayPeople | null;
  /** إن حُدِّد: التقرير لإيرادات هذا الطبيب وحده، والفواتير المُمرَّرة فواتيره فقط */
  doctorName?: string | null;
  /** إن حُدِّد (0236): الفواتير المُمرَّرة هي ما أصدره هذا المستخدم وحده */
  issuerName?: string | null;
};

const STATUS_AR: Record<string, string> = {
  draft: "مسوّدة",
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة",
  partially_refunded: "مستردّة جزئيًا",
  refunded: "مستردّة",
  void: "ملغاة",
};

const num = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

const riyadhParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

/** «2026-10-01 16:34» بتوقيت الرياض */
const localTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const p = riyadhParts(iso);
  return `${p.date} ${p.time}`;
};

/** الوقت وحده إن كان في تاريخ يوم العمل، وإلّا التاريخ والوقت (يومية تتجاوز منتصف الليل). */
const invoiceTime = (iso: string, businessDate: string) => {
  const p = riyadhParts(iso);
  return p.date === businessDate ? p.time : `${p.date} ${p.time}`;
};

const customer = (row: ExportDayInvoice) => row.patient_name ?? row.external_customer_name ?? "—";
const kind = (row: ExportDayInvoice) =>
  row.is_temporary ? "عرض سعر" : row.invoice_type === "return" ? "مرتجع" : "فاتورة";
const docNumber = (row: ExportDayInvoice) => row.document_label || `#${row.invoice_number}`;
/** ما يدخل في الإجمالي: لا الملغاة ولا عروض الأسعار */
const counts = (row: ExportDayInvoice) => row.status !== "void" && !row.is_temporary;

/** التقرير مقصورٌ على طبيبٍ أو مُصدِر: مبالغه من فواتيره المُمرَّرة لا من اليومية كاملة. */
const scoped = (data: ExportDayData) => Boolean(data.doctorName || data.issuerName);

const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, " ").trim();

const fileBase = (data: ExportDayData) =>
  `اليومية-${data.day.day_number}-${data.day.business_date}${
    data.doctorName ? `-${safeName(data.doctorName)}` : ""
  }${data.issuerName ? `-${safeName(data.issuerName)}` : ""}`;

const reportTitle = (data: ExportDayData) =>
  data.doctorName
    ? `إيرادات الطبيب ${data.doctorName}${data.issuerName ? ` من فواتير ${data.issuerName}` : ""} — اليومية رقم ${data.day.day_number}`
    : data.issuerName
      ? `فواتير ${data.issuerName} — اليومية رقم ${data.day.day_number}`
      : `تقرير اليومية رقم ${data.day.day_number}`;

const DOCTOR_COLLECTION_NOTE = "التحصيل حسب طريقة الدفع يُحسب لليومية كاملة ولا يُفصل لكل طبيب أو مستخدم.";

/** مبالغ الطبيب من فواتيره (بلا الملغاة وعروض الأسعار). */
function doctorTotals(data: ExportDayData) {
  const rows = data.invoices.filter(counts);
  const sum = (pick: (row: ExportDayInvoice) => unknown) => num(rows.reduce((s, row) => s + Number(pick(row) ?? 0), 0));
  const patients = new Set(rows.map((row) => row.file_number ?? row.patient_name ?? row.external_customer_name ?? "")).size;
  const net = sum((r) => r.net_amount);
  return {
    count: rows.length,
    patients,
    discount: sum((r) => r.discount_amount),
    vat: sum((r) => r.vat_amount),
    net,
    paid: sum((r) => r.paid_amount),
    remaining: sum((r) => r.remaining_amount),
    average: rows.length ? num(net / rows.length) : 0,
  };
}

const sortedInvoices = (data: ExportDayData) =>
  [...data.invoices].sort((a, b) => a.created_at.localeCompare(b.created_at));

function closedText(d: ExportDaySummary) {
  return d.closed_at ? `${localTime(d.closed_at)}${d.auto_closed ? " (تلقائيًا)" : ""}` : "مفتوحة";
}

function infoPairs(data: ExportDayData): [string, string][] {
  const d = data.day;
  return [
    ...(data.doctorName ? ([["الطبيب", data.doctorName]] as [string, string][]) : []),
    ...(data.issuerName ? ([["المستخدم", data.issuerName]] as [string, string][]) : []),
    ["رقم اليومية", String(d.day_number)],
    ["يوم العمل", d.business_date],
    ["فُتحت", localTime(d.opened_at)],
    ["فتحها", data.people?.opened_by_name ?? "—"],
    ["أُقفلت", closedText(d)],
    ["أقفلها", d.closed_at ? (d.auto_closed ? "تلقائيًا" : data.people?.closed_by_name ?? "—") : "—"],
    ["أصدر فواتيرها", data.people?.issuers ?? "—"],
  ];
}

type AmountRow = { label: string; value: number; kind: "int" | "money"; strong?: boolean };

function amountRows(data: ExportDayData): AmountRow[] {
  const d = data.day;
  if (scoped(data)) {
    const t = doctorTotals(data);
    return [
      { label: "عدد الفواتير", value: t.count, kind: "int" },
      { label: "عدد المرضى", value: t.patients, kind: "int" },
      { label: "الخصومات", value: t.discount, kind: "money" },
      { label: "الضريبة", value: t.vat, kind: "money" },
      { label: "صافي الفواتير (الإيراد)", value: t.net, kind: "money", strong: true },
      { label: "المحصَّل منها", value: t.paid, kind: "money", strong: true },
      { label: "غير محصَّل", value: t.remaining, kind: "money" },
      { label: "متوسط الفاتورة", value: t.average, kind: "money" },
    ];
  }
  return [
    { label: "عدد الفواتير", value: Number(d.invoices_count), kind: "int" },
    { label: "الإجمالي قبل الخصم", value: num(d.gross_amount), kind: "money" },
    { label: "الخصومات", value: num(d.discount_amount), kind: "money" },
    { label: "الضريبة", value: num(d.vat_amount), kind: "money" },
    { label: "المعفى من الضريبة", value: num(d.exemption_amount), kind: "money" },
    { label: "صافي الفواتير", value: num(d.net_amount), kind: "money", strong: true },
    { label: "المحصَّل", value: num(d.collected_amount), kind: "money" },
    { label: "المرتجع", value: num(d.refunded_amount), kind: "money" },
    { label: "صافي المحصَّل", value: num(d.net_collected_amount), kind: "money", strong: true },
    { label: "غير محصَّل", value: num(d.outstanding_amount), kind: "money" },
  ];
}

/* ═══════════════════════════════ Excel ═══════════════════════════════ */

const c = (v: string | number | null | undefined, s: XlsxStyle): XlsxCell => ({ v: v ?? "", s });

export function downloadDayXlsx(data: ExportDayData) {
  const d = data.day;
  const printedAt = localTime(new Date().toISOString());
  const subtitle = `${data.organizationName} · يوم العمل ${d.business_date} · أُعدّ في ${printedAt}`;

  /* ── الورقة الأولى: الملخّص (4 أعمدة) ── */
  const summary: XlsxCell[][] = [];
  const sMerges: string[] = ["A1:D1", "A2:D2"];
  const push = (row: XlsxCell[]) => summary.push(row);
  const mergeValue = () => sMerges.push(`B${summary.length}:D${summary.length}`);

  push([c(reportTitle(data), "title")]);
  push([c(subtitle, "subtitle")]);
  push([]);
  push([c("بيانات اليومية", "section")]);
  for (const [label, value] of infoPairs(data)) {
    push([c(label, "label"), c(value, "center"), c("", "text"), c("", "text")]);
    mergeValue();
  }
  push([]);
  push([c("المبالغ", "section")]);
  for (const row of amountRows(data)) {
    const valueStyle: XlsxStyle = row.strong ? (row.kind === "int" ? "totalInt" : "totalMoney") : row.kind;
    push([
      c(row.label, row.strong ? "totalText" : "label"),
      c(row.value, valueStyle),
      c("", row.strong ? "totalText" : "text"),
      c("", row.strong ? "totalText" : "text"),
    ]);
    mergeValue();
  }
  push([]);
  if (scoped(data)) {
    push([c(DOCTOR_COLLECTION_NOTE, "textMuted")]);
    sMerges.push(`A${summary.length}:D${summary.length}`);
  } else {
  push([c("المحصَّل حسب طريقة الدفع", "section")]);
  push([c("طريقة الدفع", "header"), c("نقد في الصندوق", "header"), c("عدد السندات", "header"), c("المبلغ", "header")]);
  if (data.collections.length === 0) {
    push([c("لا تحصيل في هذه اليومية", "text"), c("", "text"), c("", "text"), c("", "text")]);
    sMerges.push(`A${summary.length}:D${summary.length}`);
  } else {
    for (const row of data.collections) {
      push([
        c(row.method_name, "text"),
        c(row.affects_drawer ? "نعم" : "لا", "center"),
        c(Number(row.vouchers_count), "int"),
        c(num(row.amount), "money"),
      ]);
    }
    push([
      c("الإجمالي", "totalText"),
      c("", "totalText"),
      c(data.collections.reduce((sum, row) => sum + Number(row.vouchers_count), 0), "totalInt"),
      c(num(data.collections.reduce((sum, row) => sum + Number(row.amount), 0)), "totalMoney"),
    ]);
  }
  }

  /* ── الورقة الثانية: الفواتير ── */
  const invoices = sortedInvoices(data);
  const withTax = invoices.some((row) => row.vat_amount !== undefined && row.vat_amount !== null);
  const head = [
    "م",
    "رقم الفاتورة",
    "النوع",
    "الوقت",
    "العميل",
    "رقم الملف",
    "الطبيب",
    "الحالة",
    ...(withTax ? ["الخصم", "الضريبة"] : []),
    "الصافي",
    "المدفوع",
    "المتبقي",
  ];
  const lastCol = String.fromCharCode(64 + head.length);
  const list: XlsxCell[][] = [
    [c(scoped(data) ? reportTitle(data).replace("إيرادات الطبيب", "فواتير الطبيب") : `فواتير اليومية رقم ${d.day_number}`, "title")],
    [c(subtitle, "subtitle")],
    [],
    head.map((h) => c(h, "header")),
  ];
  invoices.forEach((row, index) => {
    list.push([
      c(index + 1, "int"),
      c(docNumber(row), "center"),
      c(kind(row), "center"),
      c(invoiceTime(row.created_at, d.business_date), "center"),
      c(customer(row), "text"),
      c(row.file_number ?? "", "center"),
      c(row.doctor_name ?? "", "text"),
      c(STATUS_AR[row.status] ?? row.status, "center"),
      ...(withTax ? [c(num(row.discount_amount), "money"), c(num(row.vat_amount), "money")] : []),
      c(num(row.net_amount), "money"),
      c(num(row.paid_amount), "money"),
      c(num(row.remaining_amount), "money"),
    ]);
  });
  const emptyRow = invoices.length === 0 ? list.length + 1 : null;
  if (invoices.length === 0) {
    list.push([c("لا فواتير في هذه اليومية", "center"), ...head.slice(1).map(() => c("", "text"))]);
  }
  const counted = invoices.filter(counts);
  const sum = (pick: (row: ExportDayInvoice) => unknown) => num(counted.reduce((s, row) => s + Number(pick(row) ?? 0), 0));
  list.push([
    c("الإجمالي", "totalText"),
    c(`${counted.length} فاتورة`, "totalText"),
    ...head.slice(2, 8).map(() => c("", "totalText")),
    ...(withTax ? [c(sum((r) => r.discount_amount), "totalMoney"), c(sum((r) => r.vat_amount), "totalMoney")] : []),
    c(sum((r) => r.net_amount), "totalMoney"),
    c(sum((r) => r.paid_amount), "totalMoney"),
    c(sum((r) => r.remaining_amount), "totalMoney"),
  ]);
  list.push([]);
  list.push([c("الإجمالي لا يشمل الفواتير الملغاة ولا عروض الأسعار.", "textMuted")]);

  const blob = buildXlsx([
    {
      name: "الملخّص",
      rows: summary,
      merges: sMerges,
      columnWidths: [26, 24, 14, 18],
      rowHeights: { 0: 26 },
    },
    {
      name: "الفواتير",
      rows: list,
      merges: [
        `A1:${lastCol}1`,
        `A2:${lastCol}2`,
        `A${list.length}:${lastCol}${list.length}`,
        ...(emptyRow ? [`A${emptyRow}:${lastCol}${emptyRow}`] : []),
      ],
      columnWidths: [5, 14, 9, 11, 30, 10, 18, 14, ...(withTax ? [11, 11] : []), 13, 13, 13],
      freezeRows: 4,
      printTitleRow: 3,
      landscape: true,
      rowHeights: { 0: 26, 3: 22 },
    },
  ]);
  downloadBlob(blob, `${fileBase(data)}.xlsx`);
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ltr = (value: string) => `<span dir="ltr">${esc(value)}</span>`;

const PAGE_W = 794; // A4 عند 96dpi
const PAGE_H = 1123;

const PDF_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fff;font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#0f172a;font-size:11px;width:${PAGE_W}px}
  .page{width:${PAGE_W}px;height:${PAGE_H}px;padding:34px 36px 26px;display:flex;flex-direction:column;background:#fff;overflow:hidden}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0f766e;padding-bottom:10px;margin-bottom:14px}
  .head .org{font-size:15px;font-weight:700}
  .head .title{font-size:13px;color:#0f766e;font-weight:700;margin-top:3px}
  .head .meta{text-align:left;color:#64748b;font-size:10px;line-height:1.6}
  .content{flex:1;overflow:hidden}
  .foot{display:flex;justify-content:space-between;color:#94a3b8;font-size:9px;border-top:1px solid #e2e8f0;padding-top:6px;margin-top:8px}
  h2{font-size:12px;color:#0f766e;margin:12px 0 6px;height:16px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;height:52px}
  .kpi .l{color:#64748b;font-size:10px}
  .kpi .v{font-size:15px;font-weight:700;margin-top:4px;direction:ltr;text-align:right}
  .kpi.hi{background:#e6f4f1;border-color:#99d5c9}
  .kpi.hi .v{color:#0f766e}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
  .info div{display:flex;border-bottom:1px solid #e2e8f0;height:24px;align-items:center}
  .info div:nth-last-child(-n+2){border-bottom:0}
  .info b{width:42%;background:#f8fafc;padding:0 10px;height:100%;display:flex;align-items:center;font-weight:600;color:#334155}
  .info span.v{padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{background:#0f766e;color:#fff;font-weight:700;height:24px;padding:0 5px;text-align:right;font-size:10.5px;white-space:nowrap}
  td{height:21px;padding:0 5px;border-bottom:1px solid #e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.n,th.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}
  td.c,th.c{text-align:center}
  tr.total td{background:#e6f4f1 !important;font-weight:700;border-top:2px solid #0f766e;height:24px}
  tr.void td{color:#94a3b8;text-decoration:line-through}
  .muted{color:#64748b}
  .note{color:#64748b;font-size:9.5px;margin-top:6px}
  .signs{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}
  .sign{border:1px dashed #cbd5e1;border-radius:8px;height:74px;padding:8px 10px;color:#475569;font-weight:600}
  .sign small{display:block;color:#94a3b8;font-weight:400;margin-top:30px;border-top:1px solid #e2e8f0;padding-top:3px}
`;

function pageShell(data: ExportDayData, printedAt: string) {
  const d = data.day;
  return `
    <div class="head">
      <div><div class="org">${esc(data.organizationName)}</div><div class="title">${esc(reportTitle(data))}</div></div>
      <div class="meta">يوم العمل ${ltr(d.business_date)}<br/>أُعدّ في ${ltr(printedAt)}</div>
    </div>
    <div class="content"></div>
    <div class="foot"><span>ZainCare — تقرير اليومية</span><span class="pageno"></span></div>`;
}

function kpiHtml(data: ExportDayData) {
  const d = data.day;
  const t = scoped(data) ? doctorTotals(data) : null;
  const cards: [string, string, boolean][] = t
    ? [
        ["عدد الفواتير", String(t.count), false],
        ["عدد المرضى", String(t.patients), false],
        ["الخصومات", money(t.discount), false],
        ["الضريبة", money(t.vat), false],
        ["صافي الفواتير (الإيراد)", money(t.net), true],
        ["المحصَّل منها", money(t.paid), true],
        ["غير محصَّل", money(t.remaining), false],
        ["متوسط الفاتورة", money(t.average), false],
      ]
    : [
    ["عدد الفواتير", String(Number(d.invoices_count)), false],
    ["الإجمالي قبل الخصم", money(d.gross_amount), false],
    ["الخصومات", money(d.discount_amount), false],
    ["الضريبة", money(d.vat_amount), false],
    ["المعفى من الضريبة", money(d.exemption_amount), false],
    ["صافي الفواتير", money(d.net_amount), true],
    ["صافي المحصَّل", money(d.net_collected_amount), true],
    ["غير محصَّل", money(d.outstanding_amount), false],
  ];
  return `<h2 style="margin-top:0">الملخّص</h2><div class="kpis">${cards
    .map(([l, v, hi]) => `<div class="kpi${hi ? " hi" : ""}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`)
    .join("")}</div>`;
}

function infoHtml(data: ExportDayData) {
  const pairs = infoPairs(data).filter(([label]) => label !== "رقم اليومية" && label !== "يوم العمل");
  // مبالغ اليومية كاملة لا تُعرض في تقرير الطبيب
  const extra: [string, string][] = scoped(data)
    ? []
    : [
        ["المحصَّل", money(data.day.collected_amount)],
        ["المرتجع", money(data.day.refunded_amount)],
      ];
  const all = [...pairs, ...extra];
  return `<h2>بيانات اليومية</h2><div class="info">${all
    .map(([l, v]) => `<div><b>${esc(l)}</b><span class="v">${/^[\d\-: .,()]/.test(v) && !/[؀-ۿ]/.test(v) ? ltr(v) : esc(v)}</span></div>`)
    .join("")}</div>`;
}

function collectionsHtml(data: ExportDayData) {
  const rows = data.collections.length
    ? data.collections
        .map(
          (row) =>
            `<tr><td>${esc(row.method_name)}</td><td class="c">${row.affects_drawer ? "نعم" : "لا"}</td><td class="c">${Number(row.vouchers_count)}</td><td class="n">${money(row.amount)}</td></tr>`,
        )
        .join("") +
      `<tr class="total"><td>الإجمالي</td><td></td><td class="c">${data.collections.reduce((s, r) => s + Number(r.vouchers_count), 0)}</td><td class="n">${money(
        data.collections.reduce((s, r) => s + Number(r.amount), 0),
      )}</td></tr>`
    : `<tr><td colspan="4" class="muted c">لا تحصيل في هذه اليومية</td></tr>`;
  return `<h2>المحصَّل حسب طريقة الدفع</h2><table><colgroup><col style="width:40%"/><col style="width:20%"/><col style="width:16%"/><col style="width:24%"/></colgroup>
    <thead><tr><th>طريقة الدفع</th><th class="c">نقد في الصندوق</th><th class="c">السندات</th><th class="n">المبلغ</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const INVOICE_COLS = `<colgroup><col style="width:4%"/><col style="width:10%"/><col style="width:7%"/><col style="width:7%"/><col style="width:23%"/><col style="width:7%"/><col style="width:12%"/><col style="width:10%"/><col style="width:10%"/><col style="width:10%"/></colgroup>`;
const INVOICE_HEAD = `<thead><tr><th class="c">م</th><th>رقم الفاتورة</th><th>النوع</th><th class="c">الوقت</th><th>العميل</th><th class="c">الملف</th><th>الطبيب</th><th class="n">الصافي</th><th class="n">المدفوع</th><th class="n">المتبقي</th></tr></thead>`;

function invoiceRowHtml(row: ExportDayInvoice, index: number, businessDate: string) {
  const type = row.status === "void" ? "ملغاة" : row.status === "draft" ? "مسوّدة" : kind(row);
  return `<tr class="${row.status === "void" ? "void" : ""}"><td class="c">${index + 1}</td><td>${ltr(docNumber(row))}</td><td>${esc(type)}</td><td class="c">${ltr(
    invoiceTime(row.created_at, businessDate),
  )}</td><td>${esc(customer(row))}</td><td class="c">${row.file_number ?? ""}</td><td>${esc(row.doctor_name ?? "")}</td><td class="n">${money(
    row.net_amount,
  )}</td><td class="n">${money(row.paid_amount)}</td><td class="n">${money(row.remaining_amount)}</td></tr>`;
}

function invoiceTotalHtml(rows: ExportDayInvoice[]) {
  const counted = rows.filter(counts);
  const sum = (pick: (row: ExportDayInvoice) => unknown) => counted.reduce((s, row) => s + Number(pick(row) ?? 0), 0);
  return `<tr class="total"><td colspan="7">الإجمالي — ${counted.length} فاتورة</td><td class="n">${money(sum((r) => r.net_amount))}</td><td class="n">${money(
    sum((r) => r.paid_amount),
  )}</td><td class="n">${money(sum((r) => r.remaining_amount))}</td></tr>`;
}

const SIGNS_HTML = `<div class="signs">
  <div class="sign">أعدّه<small>الاسم والتوقيع</small></div>
  <div class="sign">استلم النقد<small>الاسم والتوقيع</small></div>
  <div class="sign">اعتمده<small>الاسم والتوقيع</small></div>
</div>`;

export async function downloadDayPdf(data: ExportDayData) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    importFresh(() => import("html2canvas")),
    importFresh(() => import("jspdf")),
  ]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;border:0;`;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("تعذّر تجهيز الملفّ");
    doc.open();
    doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><style>${PDF_CSS}</style></head><body></body></html>`);
    doc.close();
    if ((doc as any).fonts?.ready) await (doc as any).fonts.ready;

    const printedAt = localTime(new Date().toISOString());
    const pages: HTMLElement[] = [];
    const newPage = () => {
      const page = doc.createElement("div");
      page.className = "page";
      page.innerHTML = pageShell(data, printedAt);
      doc.body.appendChild(page);
      pages.push(page);
      return page.querySelector(".content") as HTMLElement;
    };
    const overflows = (content: HTMLElement) => content.scrollHeight > content.clientHeight + 1;
    /** يضيف كتلةً إلى الصفحة الحالية، وينقلها إلى صفحةٍ جديدة إن لم تتّسع. */
    let content = newPage();
    const place = (html: string) => {
      const block = doc.createElement("div");
      block.innerHTML = html;
      content.appendChild(block);
      if (overflows(content) && content.children.length > 1) {
        block.remove();
        content = newPage();
        content.appendChild(block);
      }
    };

    place(kpiHtml(data));
    place(infoHtml(data));
    place(scoped(data) ? `<p class="note">${esc(DOCTOR_COLLECTION_NOTE)}</p>` : collectionsHtml(data));

    // ── جدول الفواتير: يُقسَم عند حدود الصفوف ويتكرّر رأسه
    const invoices = sortedInvoices(data);
    let tbody: HTMLElement;
    const startTable = (continued: boolean) => {
      const block = doc.createElement("div");
      block.innerHTML = `<h2>${continued ? "تابع — " : ""}فواتير اليومية (${invoices.length})</h2><table>${INVOICE_COLS}${INVOICE_HEAD}<tbody></tbody></table>`;
      content.appendChild(block);
      tbody = block.querySelector("tbody") as HTMLElement;
      // رأس الجدول مع صفٍّ واحدٍ على الأقل يجب أن يتّسعا، وإلّا تبدأ صفحة جديدة
      const probe = doc.createElement("tr");
      probe.innerHTML = `<td colspan="10">&nbsp;</td>`;
      tbody.appendChild(probe);
      const tooTight = overflows(content) && content.children.length > 1;
      probe.remove();
      if (tooTight) {
        block.remove();
        content = newPage();
        content.appendChild(block);
      }
    };
    const addRow = (html: string, continuedLabel = true) => {
      const holder = doc.createElement("tbody");
      holder.innerHTML = html;
      const tr = holder.firstElementChild as HTMLElement;
      tbody.appendChild(tr);
      if (overflows(content)) {
        tr.remove();
        content = newPage();
        startTable(continuedLabel);
        tbody.appendChild(tr);
      }
    };

    startTable(false);
    if (invoices.length === 0) {
      addRow(`<tr><td colspan="10" class="muted c">لا فواتير في هذه اليومية</td></tr>`);
    } else {
      invoices.forEach((row, index) => addRow(invoiceRowHtml(row, index, data.day.business_date)));
      addRow(invoiceTotalHtml(invoices));
    }
    place(`<p class="note">الإجمالي لا يشمل الفواتير الملغاة ولا عروض الأسعار. الأوقات بتوقيت الرياض.</p>${SIGNS_HTML}`);

    pages.forEach((page, index) => {
      const label = page.querySelector(".pageno");
      if (label) label.textContent = `صفحة ${index + 1} من ${pages.length}`;
    });
    frame.style.height = `${pages.length * PAGE_H}px`;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: "#ffffff",
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: PAGE_W,
        windowHeight: pages.length * PAGE_H,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    }
    pdf.save(`${fileBase(data)}.pdf`);
  } finally {
    frame.remove();
  }
}
