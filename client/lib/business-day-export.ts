import { buildXlsx, downloadBlob } from "@/lib/xlsx-writer";

/**
 * تنزيل اليومية: Excel بثلاث أوراق (الملخّص، المحصَّل، الفواتير)، أو PDF
 * بمقاس A4 يُطبع ويُسلَّم مع جرد الصندوق.
 *
 * الأرقام تُكتب في Excel أرقامًا (لا نصًّا) فتُجمع وتُصفّى، وبأرقامٍ لاتينية.
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
};

export type ExportDayData = {
  organizationName: string;
  day: ExportDaySummary;
  collections: ExportDayCollection[];
  invoices: ExportDayInvoice[];
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
const localTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const customer = (row: ExportDayInvoice) => row.patient_name ?? row.external_customer_name ?? "—";
const kind = (row: ExportDayInvoice) =>
  row.is_temporary ? "عرض سعر" : row.invoice_type === "return" ? "مرتجع" : "فاتورة";

const fileBase = (data: ExportDayData) => `اليومية-${data.day.day_number}-${data.day.business_date}`;

function summaryRows(data: ExportDayData): [string, string | number][] {
  const d = data.day;
  return [
    ["المنشأة", data.organizationName],
    ["رقم اليومية", d.day_number],
    ["تاريخ يوم العمل", d.business_date],
    ["فُتحت", localTime(d.opened_at)],
    ["أُقفلت", d.closed_at ? `${localTime(d.closed_at)}${d.auto_closed ? " (تلقائيًا)" : ""}` : "مفتوحة"],
    ["عدد الفواتير", Number(d.invoices_count)],
    ["الإجمالي قبل الخصم", num(d.gross_amount)],
    ["الخصومات", num(d.discount_amount)],
    ["الضريبة", num(d.vat_amount)],
    ["المعفى من الضريبة", num(d.exemption_amount)],
    ["صافي الفواتير", num(d.net_amount)],
    ["المحصَّل", num(d.collected_amount)],
    ["المرتجع", num(d.refunded_amount)],
    ["صافي المحصَّل", num(d.net_collected_amount)],
    ["غير محصَّل", num(d.outstanding_amount)],
  ];
}

export function downloadDayXlsx(data: ExportDayData) {
  const summary = summaryRows(data);
  const blob = buildXlsx([
    {
      name: "الملخّص",
      rows: [["البند", "القيمة"], ...summary],
      boldRows: [0],
      columnWidths: [24, 28],
    },
    {
      name: "المحصَّل",
      rows: [
        ["طريقة الدفع", "نقد في الصندوق", "عدد السندات", "المبلغ"],
        ...data.collections.map((c) => [c.method_name, c.affects_drawer ? "نعم" : "لا", Number(c.vouchers_count), num(c.amount)]),
        ["الإجمالي", "", data.collections.reduce((s, c) => s + Number(c.vouchers_count), 0), num(data.collections.reduce((s, c) => s + Number(c.amount), 0))],
      ],
      boldRows: [0, data.collections.length + 1],
      columnWidths: [22, 14, 12, 14],
    },
    {
      name: "الفواتير",
      rows: [
        ["رقم الفاتورة", "النوع", "الوقت", "العميل", "رقم الملف", "الطبيب", "الحالة", "الصافي", "المدفوع", "المتبقي"],
        ...data.invoices.map((row) => [
          Number(row.invoice_number),
          kind(row),
          localTime(row.created_at),
          customer(row),
          row.file_number ?? "",
          row.doctor_name ?? "",
          STATUS_AR[row.status] ?? row.status,
          num(row.net_amount),
          num(row.paid_amount),
          num(row.remaining_amount),
        ]),
        [
          "الإجمالي",
          "",
          "",
          `${data.invoices.length} مستند`,
          "",
          "",
          "",
          num(data.invoices.reduce((s, r) => s + Number(r.net_amount), 0)),
          num(data.invoices.reduce((s, r) => s + Number(r.paid_amount), 0)),
          num(data.invoices.reduce((s, r) => s + Number(r.remaining_amount), 0)),
        ],
      ],
      boldRows: [0, data.invoices.length + 1],
      columnWidths: [12, 10, 18, 26, 10, 20, 14, 12, 12, 12],
    },
  ]);
  downloadBlob(blob, `${fileBase(data)}.xlsx`);
}

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dayHtml(data: ExportDayData) {
  const summary = summaryRows(data)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${typeof v === "number" && k !== "رقم اليومية" && k !== "عدد الفواتير" ? money(v) : esc(v)}</td></tr>`)
    .join("");
  const collections = data.collections.length
    ? data.collections
        .map((c) => `<tr><td>${esc(c.method_name)}${c.affects_drawer ? " — نقد" : ""}</td><td>${c.vouchers_count}</td><td>${money(c.amount)}</td></tr>`)
        .join("")
    : `<tr><td colspan="3" class="muted">لا تحصيل</td></tr>`;
  const invoices = data.invoices.length
    ? data.invoices
        .map(
          (r) =>
            `<tr><td>${r.invoice_number}</td><td>${esc(kind(r))}</td><td>${esc(localTime(r.created_at))}</td><td>${esc(customer(r))}</td><td>${esc(r.doctor_name ?? "")}</td><td>${esc(STATUS_AR[r.status] ?? r.status)}</td><td>${money(r.net_amount)}</td><td>${money(r.paid_amount)}</td><td>${money(r.remaining_amount)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="9" class="muted">لا فواتير</td></tr>`;
  return `
    <h1>${esc(data.organizationName)} — اليومية رقم ${data.day.day_number}</h1>
    <p class="muted">يوم العمل ${esc(data.day.business_date)} · طُبعت ${esc(localTime(new Date().toISOString()))}</p>
    <h2>الملخّص</h2><table class="kv">${summary}</table>
    <h2>المحصَّل بحسب طريقة الدفع</h2>
    <table><thead><tr><th>الطريقة</th><th>السندات</th><th>المبلغ</th></tr></thead><tbody>${collections}</tbody></table>
    <h2>فواتير اليومية (${data.invoices.length})</h2>
    <table><thead><tr><th>#</th><th>النوع</th><th>الوقت</th><th>العميل</th><th>الطبيب</th><th>الحالة</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${invoices}</tbody></table>`;
}

const PDF_CSS = `
  *{box-sizing:border-box} body{margin:0;padding:28px;font-family:Tahoma,Arial,sans-serif;color:#111;background:#fff;font-size:11px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px}
  .muted{color:#666} table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:4px 6px;text-align:right;vertical-align:top}
  thead th{background:#f1f5f9} table.kv th{width:40%;background:#f8fafc;font-weight:600}
`;

export async function downloadDayPdf(data: ExportDayData) {
  const widthPx = 794; // A4 عند 96dpi
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:10px;border:0;`;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("تعذّر تجهيز الملفّ");
    doc.open();
    doc.write(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><style>${PDF_CSS}</style></head><body>${dayHtml(data)}</body></html>`,
    );
    doc.close();
    if ((doc as any).fonts?.ready) await (doc as any).fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const body = doc.body;
    const heightPx = Math.max(body.scrollHeight, 10);
    frame.style.height = `${heightPx}px`;
    const canvas = await html2canvas(body, {
      scale: 2,
      backgroundColor: "#ffffff",
      width: widthPx,
      height: heightPx,
      windowWidth: widthPx,
      windowHeight: heightPx,
    });

    // تقطيع الصورة على صفحات A4
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const pxPerMm = canvas.width / pageWidthMm;
    const pageHeightPx = Math.floor(pageHeightMm * pxPerMm);
    let offset = 0;
    let first = true;
    while (offset < canvas.height) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - offset);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("تعذّر تجهيز الصفحة");
      ctx.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidthMm, sliceHeight / pxPerMm);
      first = false;
      offset += sliceHeight;
    }
    pdf.save(`${fileBase(data)}.pdf`);
  } finally {
    frame.remove();
  }
}
