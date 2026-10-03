import { supabase } from "@/lib/supabase";
import { code128Svg } from "@/lib/barcode";
import { buildDentalReportSection } from "@/lib/dental";
import {
  ageText,
  dateText,
  dateTimeText,
  esc,
  escLines,
  loadReportPatient,
  money,
  openPatientReport,
  patientHeaderHtml,
  timeText,
  type ReportPatient,
} from "@/lib/patient-report";

/**
 * تقارير المريض بنموذج Kizen (قائمة «تقارير المريض» والملف الموحّد).
 *
 * كلّ تقرير يقرأ من جداول ZainCare الحيّة، وما في أرشيف Kizen للمريض
 * (legacy_*) يظهر في القسم نفسه بعلامة «من النظام السابق». مريضٌ بلا بيانات
 * في قسمٍ يُطبع له القسم بجدولٍ فارغ و«الإجمالي : 0» كما يفعل Kizen.
 */

export type PatientReportKey =
  | "patient_file"
  | "invoices"
  | "statement"
  | "card"
  | "label"
  | "appointments"
  | "dental"
  | "dental_lab"
  | "visits"
  | "lab_tests"
  | "prescriptions";

export const PATIENT_REPORTS: { key: PatientReportKey; label: string; financial?: boolean; unified?: boolean }[] = [
  { key: "patient_file", label: "ملف المريض" },
  { key: "invoices", label: "كشف فواتير", financial: true, unified: true },
  { key: "statement", label: "كشف حساب المريض", financial: true, unified: true },
  { key: "card", label: "كرت المريض" },
  { key: "label", label: "لصاقة المريض" },
  { key: "appointments", label: "كشف مواعيد وزيارات", unified: true },
  { key: "dental", label: "كشف عيادات الأسنان", unified: true },
  { key: "dental_lab", label: "كشف طلبيات المعمل", unified: true },
  { key: "visits", label: "كشف زيارات المريض", unified: true },
  { key: "lab_tests", label: "كشف تحاليل المريض", unified: true },
  { key: "prescriptions", label: "كشف وصفات المريض", unified: true },
];

export type ReportFilters = {
  from?: string | null; // YYYY-MM-DD
  to?: string | null;
  doctorId?: string | null;
  /** كشف الحساب: إظهار الخدمات تحت كلّ سند */
  showWorks?: boolean;
};

type Ctx = {
  orgId: string;
  patient: ReportPatient;
  filters: ReportFilters;
  doctors: Map<string, string>;
  members: Map<string, string>;
};

type Section = { html: string; css?: string };

const LEGACY_TAG = '<span class="legacy">من النظام السابق</span>';

const SHARED_CSS = `
  .legacy { display: inline-block; font-size: 8px; border: 1px solid #b7791f; color: #92400e; border-radius: 3px; padding: 0 3px; margin-inline-start: 4px; }
  table.sub td, table.sub th { font-size: 10px; }
  tr.inv td { background: #eef2f6; font-weight: 600; }
  tr.pay td { background: #fafafa; color: #333; }
  tr.works td { background: #f3f3f3; color: #444; font-size: 10px; text-align: right; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; border: 1px solid #000; padding: 4px 8px; margin-bottom: 6px; }
  .meta b { font-weight: 600; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 28px; }
  .sign-row div { width: 40%; border-top: 1px solid #000; padding-top: 4px; text-align: center; }
  h2.sec { font-size: 12px; margin: 10px 0 4px; }
`;

/* ─────────────────────────── أدوات مشتركة ─────────────────────────── */

const inRange = (iso: string | null | undefined, f: ReportFilters) => {
  if (!iso) return true;
  const day = iso.slice(0, 10);
  return (!f.from || day >= f.from) && (!f.to || day <= f.to);
};

const fromIso = (f: ReportFilters) => (f.from ? `${f.from}T00:00:00+03:00` : null);
const toIso = (f: ReportFilters) => (f.to ? `${f.to}T23:59:59+03:00` : null);

function titleBox(ar: string, en: string, p: ReportPatient, f?: ReportFilters) {
  const range =
    f && (f.from || f.to)
      ? `<span><b>من تاريخ :</b> <span class="num">${esc(f.from ? dateText(f.from) : "—")}</span></span>
         <span><b>إلى تاريخ :</b> <span class="num">${esc(f.to ? dateText(f.to) : "—")}</span></span>`
      : `<span><b>الفترة :</b> كل الفترات <span class="en">All</span></span>`;
  return `<h1 class="rt">${esc(ar)} - <span class="en">${esc(en)}</span></h1>
    <div class="meta"><span><b>المريض :</b> ${esc(p.name_ar)}</span><span><b>الملف :</b> <span class="num">${esc(
      p.file_number ?? "—",
    )}</span></span>${range}</div>`;
}

async function lookupNames(ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  const map = new Map<string, { name: string; code: string | null; extra: any }>();
  if (unique.length === 0) return map;
  const { data } = await supabase.from("lookup_values").select("id, name_ar, code, extra").in("id", unique);
  for (const row of (data ?? []) as any[]) map.set(row.id, { name: row.name_ar, code: row.code, extra: row.extra });
  return map;
}

const isCash = (method: { code: string | null; extra: any } | undefined) =>
  Boolean(method && (method.code === "cash" || method.extra?.affects_drawer === true));

/* ═══════════════════════ 1) ملف المريض (pr01) ═══════════════════════ */

export const DEFAULT_ACKNOWLEDGMENT =
  "أقرّ أنا الموقّع أدناه بأنّ جميع البيانات والمعلومات الطبية المذكورة أعلاه صحيحة وكاملة على حدّ علمي، " +
  "وأوافق على إجراء الفحوصات والعلاجات والإجراءات التي يقرّها الطبيب المعالج بعد شرحها لي، " +
  "وأتعهّد بسداد قيمة الخدمات المقدّمة وبالالتزام بمواعيد المراجعة.\n" +
  "I, the undersigned, declare that all the medical information above is true and complete to the best of my knowledge, " +
  "consent to the examinations, treatments and procedures approved by the treating physician after they are explained to me, " +
  "and undertake to pay for the services provided and to attend the scheduled appointments.";

async function patientFileSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const [full, history, conditionsAll, conditionsPatient, allergies, ack] = await Promise.all([
    supabase
      .from("patients")
      .select("blood_type, marital_status, children_count, profession_value_id, participating_doctor_ids, general_note")
      .eq("id", p.id)
      .maybeSingle(),
    supabase.from("patient_medical_history").select("*").eq("patient_id", p.id).maybeSingle(),
    supabase.from("health_conditions").select("id, name_ar, name_en").eq("organization_id", ctx.orgId),
    supabase.from("patient_health_conditions").select("condition_id, is_checked, note").eq("patient_id", p.id),
    supabase
      .from("patient_allergies")
      .select("allergen_text, reaction, status, item_id")
      .eq("patient_id", p.id)
      .neq("status", "resolved"),
    supabase.rpc("app_patient_file_acknowledgment", { p_organization_id: ctx.orgId }),
  ]);
  const extra = (full.data ?? {}) as any;
  const h = (history.data ?? {}) as any;
  const profession = (await lookupNames([extra.profession_value_id])).get(extra.profession_value_id)?.name ?? "—";
  const condNames = new Map(((conditionsAll.data ?? []) as any[]).map((c) => [c.id, c.name_ar]));
  const chronic = ((conditionsPatient.data ?? []) as any[])
    .filter((c) => c.is_checked)
    .map((c) => `${condNames.get(c.condition_id) ?? "—"}${c.note ? ` (${c.note})` : ""}`);
  const allergyList = ((allergies.data ?? []) as any[]).map((a) => [a.allergen_text, a.reaction].filter(Boolean).join(" — ")).filter(Boolean);
  const participating = ((extra.participating_doctor_ids ?? []) as string[]).map((id) => ctx.doctors.get(id)).filter(Boolean);
  const MARITAL: Record<string, string> = { single: "أعزب", married: "متزوج", divorced: "مطلّق", widowed: "أرمل" };

  const row = (en: string, ar: string, value: unknown) =>
    `<tr><td class="en" style="width:24%">${esc(en)}</td><td>${escLines(value ?? "—")}</td><td style="width:24%">${esc(ar)}</td></tr>`;
  const personal = [
    row("File No.", "رقم الملف", p.file_number),
    row("Patient Name", "اسم المريض", p.name_ar),
    row("English Name", "الاسم الإنجليزي", p.name_en),
    row("Doctor", "الطبيب المعالج", p.doctor_name),
    row("Participating Doctors", "الأطباء المشاركون", participating.join("، ") || "—"),
    row("Registration Date", "تاريخ التسجيل", p.file_date ? dateText(p.file_date) : "—"),
    row("Birth Date", "تاريخ الميلاد", p.birth_date ? `${dateText(p.birth_date)} — ${ageText(p.birth_date)}` : "—"),
    row("Blood Type", "الزمرة الدموية", extra.blood_type),
    row("Gender", "الجنس", p.gender === "male" ? "ذكر" : p.gender === "female" ? "أنثى" : "—"),
    row("Nationality", "الجنسية", p.nationality),
    row("Profession", "المهنة", profession),
    row("Marital Status", "الحالة العائلية", MARITAL[extra.marital_status] ?? "—"),
    row("Children", "عدد الأطفال", extra.children_count),
    row("Insurance Company", "شركة التأمين", p.insurance_company_name),
    row("Membership No.", "رقم الضمان", p.insurance_membership_number),
    row("Policy No.", "البوليصة", p.insurance_policy_number),
  ].join("");
  const health = [
    row("Health Status", "الحالة الصحية", h.health_status_notes),
    row("Chronic Diseases", "الأمراض المزمنة", chronic.join("، ") || "لا يملك أمراض مزمنة"),
    row("Personal History", "السوابق الشخصية", h.personal_history),
    row("Family History", "السوابق العائلية", h.family_history),
    row("Treatment History", "السوابق العلاجية", h.treatment_history),
    row("Drug Allergy", "التحسس الدوائي", [h.drug_allergy, ...allergyList].filter(Boolean).join("، ") || "—"),
    row("Special Habits", "العادات الخاصة", h.special_habits),
    row("General Note", "ملاحظة عامة", extra.general_note),
  ].join("");
  const ackText = (ack.data as string | null) || DEFAULT_ACKNOWLEDGMENT;

  return {
    html: `<h1 class="rt">ملف المريض الطبي - <span class="en">Patient Medical File</span></h1>
      <table class="grid"><thead><tr><th colspan="3">البيانات الشخصية - <span class="en">Personal Information</span></th></tr></thead><tbody>${personal}</tbody></table>
      <h2 class="sec"></h2>
      <table class="grid"><thead><tr><th colspan="3">الحالة الصحية - <span class="en">Health Status</span></th></tr></thead><tbody>${health}</tbody></table>
      <p style="border:1px solid #000;padding:8px;margin-top:10px;line-height:1.7">${escLines(ackText)}</p>
      <div class="sign-row"><div>اسم المريض : ${esc(p.name_ar)}</div><div>التوقيع - <span class="en">Signature</span></div></div>`,
  };
}

/* ═══════════════════════ 2) كشف فواتير (pr02) ═══════════════════════ */

const ITEMS_HEAD =
  '<table class="grid sub" style="table-layout:fixed"><colgroup><col style="width:10%"/><col style="width:40%"/><col style="width:10%"/><col style="width:8%"/><col style="width:10%"/><col style="width:10%"/><col style="width:12%"/></colgroup>' +
  '<thead><tr><th>الكود <span class="en">Code</span></th><th>الصنف <span class="en">Work Type</span></th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th>الخصم</th><th>الصافي</th></tr></thead><tbody>';

async function invoicesSection(ctx: Ctx): Promise<Section> {
  const f = ctx.filters;
  let q = supabase
    .from("sales_invoices")
    .select("id, invoice_number, document_prefix, document_number, created_at, doctor_id, net_amount, paid_amount, remaining_amount, status, invoice_type, created_by")
    .eq("patient_id", ctx.patient.id)
    .eq("is_temporary", false)
    .neq("status", "draft");
  if (fromIso(f)) q = q.gte("created_at", fromIso(f)!);
  if (toIso(f)) q = q.lte("created_at", toIso(f)!);
  if (f.doctorId) q = q.eq("doctor_id", f.doctorId);
  const invoices = ((await q.order("created_at")).data ?? []) as any[];
  const ids = invoices.map((i) => i.id);

  const [items, allocs, legacy] = await Promise.all([
    ids.length
      ? supabase.from("sales_invoice_items").select("invoice_id, item_id, item_name_snapshot, description, price, qty, discount_amount, net_amount").in("invoice_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("voucher_invoice_allocations").select("voucher_id, sales_invoice_id, amount").in("sales_invoice_id", ids)
      : Promise.resolve({ data: [] }),
    f.doctorId ? Promise.resolve({ data: [] }) : supabase.from("legacy_invoices").select("*").eq("patient_id", ctx.patient.id).order("issued_at"),
  ]);
  const itemRows = (items.data ?? []) as any[];
  const codes = new Map<string, string>();
  const itemIds = Array.from(new Set(itemRows.map((r) => r.item_id).filter(Boolean)));
  if (itemIds.length) {
    const { data } = await supabase.from("items").select("id, code").in("id", itemIds);
    for (const r of (data ?? []) as any[]) codes.set(r.id, r.code ?? "");
  }
  const allocRows = (allocs.data ?? []) as any[];
  const voucherIds = Array.from(new Set(allocRows.map((a) => a.voucher_id)));
  const vouchers = new Map<string, any>();
  if (voucherIds.length) {
    const { data } = await supabase
      .from("financial_vouchers")
      .select("id, voucher_number, voucher_date, created_at, amount, payment_method_value_id, created_by, description, voucher_type, is_void")
      .in("id", voucherIds);
    for (const v of (data ?? []) as any[]) vouchers.set(v.id, v);
  }
  const methods = await lookupNames(Array.from(vouchers.values()).map((v) => v.payment_method_value_id));

  const legacyRows = ((legacy.data ?? []) as any[]).filter((l) => inRange(l.issued_at, f));
  const legacyIds = legacyRows.map((l) => l.id);
  const [legacyItems, legacyReceipts] = await Promise.all([
    legacyIds.length ? supabase.from("legacy_invoice_items").select("*").in("legacy_invoice_id", legacyIds) : Promise.resolve({ data: [] }),
    legacyIds.length ? supabase.from("legacy_receipts").select("*").in("legacy_invoice_id", legacyIds) : Promise.resolve({ data: [] }),
  ]);

  type Line = { at: string; html: string; net: number; paid: number; rem: number };
  const lines: Line[] = [];
  for (const inv of invoices) {
    const number = inv.document_number != null ? `${inv.document_prefix ? `${inv.document_prefix}-` : ""}${inv.document_number}` : `#${inv.invoice_number}`;
    const its = itemRows.filter((r) => r.invoice_id === inv.id);
    const pays = allocRows.filter((a) => a.sales_invoice_id === inv.id).map((a) => ({ a, v: vouchers.get(a.voucher_id) })).filter((x) => x.v && !x.v.is_void);
    const sign = inv.invoice_type === "return" ? -1 : 1;
    lines.push({
      at: inv.created_at,
      net: sign * Number(inv.net_amount ?? 0),
      paid: sign * Number(inv.paid_amount ?? 0),
      rem: Number(inv.remaining_amount ?? 0),
      html:
        `<tr class="inv"><td class="num">${esc(number)}${inv.invoice_type === "return" ? " (مرتجع)" : ""}${inv.status === "void" ? " (ملغاة)" : ""}</td><td>${esc(
          ctx.doctors.get(inv.doctor_id) ?? "—",
        )}</td><td class="num">${esc(dateTimeText(inv.created_at))}</td><td class="num">${money(inv.net_amount)}</td><td class="num">${money(
          inv.paid_amount,
        )}</td><td class="num">${money(inv.remaining_amount)}</td><td>${esc(ctx.members.get(inv.created_by) ?? "")}</td></tr>` +
        (its.length
          ? `<tr><td colspan="7" style="padding:0">${ITEMS_HEAD}${its
              .map(
                (it) =>
                  `<tr><td class="num">${esc(codes.get(it.item_id) ?? "")}</td><td class="t">${esc(it.item_name_snapshot ?? it.description ?? "")}</td><td class="num">${money(
                    it.price,
                  )}</td><td class="num">${esc(it.qty)}</td><td class="num">${money(Number(it.price) * Number(it.qty))}</td><td class="num">${money(
                    it.discount_amount,
                  )}</td><td class="num">${money(it.net_amount)}</td></tr>`,
              )
              .join("")}</tbody></table></td></tr>`
          : "") +
        pays
          .map(
            ({ a, v }) =>
              `<tr class="pay"><td class="num">سند ${esc(v.voucher_number)}</td><td class="num" colspan="2">${esc(dateTimeText(v.created_at ?? v.voucher_date))}</td><td class="num">${money(
                a.amount,
              )}</td><td>${esc(methods.get(v.payment_method_value_id)?.name ?? "—")}</td><td>${esc(ctx.members.get(v.created_by) ?? "")}</td><td class="t">${esc(
                v.description ?? "",
              )}</td></tr>`,
          )
          .join(""),
    });
  }
  for (const l of legacyRows) {
    const its = ((legacyItems.data ?? []) as any[]).filter((r) => r.legacy_invoice_id === l.id).sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
    const recs = ((legacyReceipts.data ?? []) as any[]).filter((r) => r.legacy_invoice_id === l.id);
    lines.push({
      at: l.issued_at,
      net: Number(l.net_amount ?? 0),
      paid: Number(l.paid_amount ?? 0),
      rem: Number(l.remaining_amount ?? 0),
      html:
        `<tr class="inv"><td class="num">${esc(l.zatca_number ?? l.legacy_number ?? "")}${LEGACY_TAG}</td><td>${esc(l.doctor_name ?? "—")}</td><td class="num">${esc(
          dateTimeText(l.issued_at),
        )}</td><td class="num">${money(l.net_amount)}</td><td class="num">${money(l.paid_amount)}</td><td class="num">${money(l.remaining_amount)}</td><td>${esc(
          l.employee_name ?? "",
        )}</td></tr>` +
        (its.length
          ? `<tr><td colspan="7" style="padding:0">${ITEMS_HEAD}${its
              .map(
                (it) =>
                  `<tr><td class="num">${esc(it.code ?? "")}</td><td class="t">${esc(it.service ?? "")}</td><td class="num">${money(it.unit_price)}</td><td class="num">${esc(
                    it.qty,
                  )}</td><td class="num">${money(it.gross_amount)}</td><td class="num">${money(it.discount_amount)}</td><td class="num">${money(it.net_amount)}</td></tr>`,
              )
              .join("")}</tbody></table></td></tr>`
          : "") +
        recs
          .map(
            (r) =>
              `<tr class="pay"><td class="num">سند ${esc(r.legacy_number ?? "")}</td><td class="num" colspan="2">${esc(dateTimeText(r.received_at))}</td><td class="num">${money(
                r.amount,
              )}</td><td>${esc(r.method ?? "—")}</td><td>${esc(r.user_name ?? "")}</td><td class="t">${esc(r.note ?? r.statement ?? "")}</td></tr>`,
          )
          .join(""),
    });
  }
  lines.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const total = lines.reduce((s, l) => ({ net: s.net + l.net, paid: s.paid + l.paid, rem: s.rem + l.rem }), { net: 0, paid: 0, rem: 0 });

  return {
    html:
      titleBox("كشف فواتير العميل", "Customer Invoices Report", ctx.patient, f) +
      `<table class="grid"><thead><tr><th>رقم الفاتورة <span class="en">Invoice No</span></th><th>الطبيب <span class="en">Doctor</span></th><th>التاريخ <span class="en">Date</span></th><th>الإجمالي <span class="en">Total</span></th><th>المدفوع <span class="en">Paid</span></th><th>المتبقي <span class="en">Remaining</span></th><th>المستخدم <span class="en">User</span></th></tr></thead>
      <tbody>${lines.map((l) => l.html).join("") || '<tr><td colspan="7" class="empty">لا فواتير</td></tr>'}
      <tr class="total"><td colspan="3" class="t">الإجمالي : ${lines.length} فاتورة</td><td class="num">${money(total.net)}</td><td class="num">${money(total.paid)}</td><td class="num">${money(
        total.rem,
      )}</td><td></td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ 3) كشف حساب المريض (pr03) ═══════════════════════ */

async function statementSection(ctx: Ctx): Promise<Section> {
  const f = ctx.filters;
  let q = supabase
    .from("financial_vouchers")
    .select("id, voucher_number, voucher_type, voucher_date, created_at, amount, vat_amount, payment_method_value_id, related_sales_invoice_id, doctor_id, created_by, refund_of_voucher_id, is_void")
    .eq("patient_id", ctx.patient.id)
    .eq("is_void", false)
    .in("voucher_type", ["receipt", "expense"]);
  if (fromIso(f)) q = q.gte("created_at", fromIso(f)!);
  if (toIso(f)) q = q.lte("created_at", toIso(f)!);
  if (f.doctorId) q = q.eq("doctor_id", f.doctorId);
  const vouchers = (((await q.order("created_at")).data ?? []) as any[]).filter(
    (v) => v.voucher_type === "receipt" || v.refund_of_voucher_id,
  );
  const invoiceIds = Array.from(new Set(vouchers.map((v) => v.related_sales_invoice_id).filter(Boolean)));
  const invoices = new Map<string, any>();
  const works = new Map<string, string[]>();
  if (invoiceIds.length) {
    const [inv, its] = await Promise.all([
      supabase.from("sales_invoices").select("id, invoice_number, document_prefix, document_number, subtotal_amount, discount_amount, net_amount, doctor_id, created_by").in("id", invoiceIds),
      supabase.from("sales_invoice_items").select("invoice_id, item_name_snapshot, description").in("invoice_id", invoiceIds),
    ]);
    for (const i of (inv.data ?? []) as any[]) invoices.set(i.id, i);
    for (const it of (its.data ?? []) as any[]) {
      const list = works.get(it.invoice_id) ?? [];
      list.push(it.item_name_snapshot ?? it.description ?? "");
      works.set(it.invoice_id, list);
    }
  }
  const methods = await lookupNames(vouchers.map((v) => v.payment_method_value_id));
  const legacy = f.doctorId
    ? []
    : (((await supabase.from("legacy_receipts").select("*").eq("patient_id", ctx.patient.id).order("received_at")).data ?? []) as any[]).filter((r) =>
        inRange(r.received_at, f),
      );

  type Row = { at: string; refund: boolean; cash: boolean; amount: number; vat: number; method: string; html: string };
  const rows: Row[] = [];
  for (const v of vouchers) {
    const inv = invoices.get(v.related_sales_invoice_id);
    const method = methods.get(v.payment_method_value_id);
    const refund = v.voucher_type === "expense";
    const amount = Number(v.amount ?? 0);
    const vat = Number(v.vat_amount ?? 0);
    const invNo = inv ? (inv.document_number != null ? `${inv.document_prefix ? `${inv.document_prefix}-` : ""}${inv.document_number}` : `#${inv.invoice_number}`) : "—";
    rows.push({
      at: v.created_at,
      refund,
      cash: isCash(method),
      amount,
      vat,
      method: method?.name ?? "—",
      html:
        `<tr${refund ? ' style="color:#b00"' : ""}><td class="num">${esc(v.voucher_number)}${refund ? " (مرتجع)" : ""}</td><td class="num">${esc(invNo)}<br/><span class="muted">${esc(
          ctx.members.get(inv?.created_by) ?? "",
        )}</span></td><td class="num">${esc(dateTimeText(v.created_at))}</td><td>${esc(ctx.doctors.get(v.doctor_id ?? inv?.doctor_id) ?? "—")}</td><td class="num">${money(
          inv?.subtotal_amount,
        )}</td><td class="num">${money(inv?.discount_amount)}</td><td class="num">${money(inv?.net_amount)}</td><td class="num">${money(
          refund ? -amount : amount,
        )}<br/><span class="muted">${esc(method?.name ?? "")}</span></td><td class="num">${money(vat)}</td></tr>` +
        (ctx.filters.showWorks !== false && works.get(v.related_sales_invoice_id)?.length
          ? `<tr class="works"><td colspan="9">${esc(works.get(v.related_sales_invoice_id)!.join("، "))}</td></tr>`
          : ""),
    });
  }
  for (const r of legacy) {
    const amount = Number(r.amount ?? 0);
    const cash = /cash|نقد/i.test(String(r.method ?? ""));
    rows.push({
      at: r.received_at,
      refund: amount < 0,
      cash,
      amount: Math.abs(amount),
      vat: 0,
      method: r.method ?? "—",
      html: `<tr><td class="num">${esc(r.legacy_number ?? "")}${LEGACY_TAG}</td><td class="num">${esc(r.zatca_number ?? r.legacy_invoice_number ?? "—")}<br/><span class="muted">${esc(
        r.user_name ?? "",
      )}</span></td><td class="num">${esc(dateTimeText(r.received_at))}</td><td>—</td><td></td><td></td><td></td><td class="num">${money(amount)}<br/><span class="muted">${esc(
        r.method ?? "",
      )}</span></td><td class="num">${money(0)}</td></tr>` + (r.statement ? `<tr class="works"><td colspan="9">${esc(r.statement)}</td></tr>` : ""),
    });
  }
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const agg = (filter: (r: Row) => boolean) => {
    const list = rows.filter(filter);
    const withVat = list.reduce((s, r) => s + r.amount, 0);
    const vat = list.reduce((s, r) => s + r.vat, 0);
    return { withVat, vat, without: withVat - vat, count: list.length };
  };
  const line = (label: string, refund: boolean) => {
    const cash = agg((r) => r.refund === refund && r.cash);
    const other = agg((r) => r.refund === refund && !r.cash);
    const all = agg((r) => r.refund === refund);
    return { label, cash, other, all };
  };
  const rev = line("الإيراد", false);
  const ret = line("مرتجع الإيراد", true);
  const net = {
    label: "الصافي بعد المرتجع",
    cash: { without: rev.cash.without - ret.cash.without, vat: rev.cash.vat - ret.cash.vat, withVat: rev.cash.withVat - ret.cash.withVat },
    other: { without: rev.other.without - ret.other.without, vat: rev.other.vat - ret.other.vat, withVat: rev.other.withVat - ret.other.withVat },
    all: { without: rev.all.without - ret.all.without, vat: rev.all.vat - ret.all.vat, withVat: rev.all.withVat - ret.all.withVat, count: rev.all.count + ret.all.count },
  };
  const closingRow = (l: { label: string; cash: any; other: any; all: any }) =>
    `<tr><td class="t">${esc(l.label)}</td>${[l.cash, l.other, l.all]
      .map((x) => `<td class="num">${money(x.without)}</td><td class="num">${money(x.vat)}</td><td class="num">${money(x.withVat)}</td>`)
      .join("")}<td class="num">${l.all.count ?? ""}</td></tr>`;

  // تفاصيل الإيرادات المنوّعة حسب الطريقة
  const otherMethods = Array.from(new Set(rows.filter((r) => !r.cash).map((r) => r.method)));
  const otherDetail = otherMethods
    .map((m) => {
      const inc = agg((r) => !r.cash && !r.refund && r.method === m);
      const back = agg((r) => !r.cash && r.refund && r.method === m);
      return `<tr><td class="t">${esc(m)}</td><td class="num">${money(inc.without)}</td><td class="num">${money(inc.vat)}</td><td class="num">${money(inc.withVat)}</td><td class="num">${money(
        back.withVat,
      )}</td><td class="num">${money(inc.withVat - back.withVat)}</td></tr>`;
    })
    .join("");

  // إحصائيات المواعيد
  let aq = supabase.from("appointments").select("status, scheduled_start").eq("patient_id", ctx.patient.id);
  if (fromIso(f)) aq = aq.gte("scheduled_start", fromIso(f)!);
  if (toIso(f)) aq = aq.lte("scheduled_start", toIso(f)!);
  const appts = ((await aq).data ?? []) as any[];
  const now = new Date().toISOString();
  const count = (fn: (a: any) => boolean) => appts.filter(fn).length;
  const stats = [
    ["كافة المواعيد", appts.length],
    ["مؤكدة", count((a) => a.status === "confirmed")],
    ["غير مؤكدة", count((a) => ["new", "scheduled", "unconfirmed"].includes(a.status))],
    ["حضرت", count((a) => ["arrived", "checked_in", "waiting", "walk_in", "called", "in_progress", "completed"].includes(a.status))],
    ["لم تحضر", count((a) => a.status === "no_show")],
    ["اعتذر", count((a) => a.status === "cancelled_by_patient")],
    ["موعد مستقبلي جديد", count((a) => a.scheduled_start > now && !String(a.status).startsWith("cancelled"))],
  ];
  const newFile = ctx.patient.file_date && inRange(ctx.patient.file_date, f) ? 1 : 0;

  return {
    html:
      titleBox("كشف حساب عميل", "Customer account statement", ctx.patient, f) +
      `<table class="grid"><thead><tr><th>السند</th><th>رقم الفاتورة / المستخدم</th><th>التاريخ</th><th>الطبيب</th><th>الإجمالي</th><th>الخصومات</th><th>الصافي</th><th>الدفعة</th><th>ضريبة الدفعة</th></tr></thead>
       <tbody>${rows.map((r) => r.html).join("") || '<tr><td colspan="9" class="empty">لا سندات</td></tr>'}</tbody></table>
       <div class="meta" style="margin-top:8px"><span><b>عدد المراجعين :</b> ${rev.all.count}</span><span><b>الملفات الجديدة :</b> ${newFile}</span></div>
       <table class="grid"><thead>
         <tr><th rowspan="2">إقفال الصندوق</th><th colspan="3">النقدي</th><th colspan="3">المنوّع (شبكة / بنك)</th><th colspan="3">الصافي</th><th rowspan="2">عدد السندات</th></tr>
         <tr><th>بدون ضريبة</th><th>الضريبة</th><th>مع الضريبة</th><th>بدون ضريبة</th><th>الضريبة</th><th>مع الضريبة</th><th>بدون ضريبة</th><th>الضريبة</th><th>مع الضريبة</th></tr>
       </thead><tbody>${closingRow(rev)}${closingRow(ret)}${closingRow(net as any)}</tbody></table>
       <h2 class="sec">تفاصيل الإيرادات المنوّعة</h2>
       <table class="grid"><thead><tr><th>الحساب</th><th>الإيداع بدون ضريبة</th><th>الضريبة</th><th>الإجمالي</th><th>المرتجع</th><th>الصافي</th></tr></thead>
       <tbody>${otherDetail || '<tr><td colspan="6" class="empty">لا إيرادات منوّعة</td></tr>'}</tbody></table>
       <h2 class="sec">إحصائيات المواعيد</h2>
       <table class="grid"><tbody><tr>${stats.map(([l]) => `<th>${esc(l)}</th>`).join("")}</tr><tr>${stats
         .map(([, n]) => `<td class="num">${n}</td>`)
         .join("")}</tr></tbody></table>
       <div class="sign-row"><div>توقيع المحاسب</div><div>توقيع العميل</div></div>`,
  };
}

/* ═══════════════════════ 4) كرت المريض (pr04) و 5) اللصاقة (pr05) ═══════════════════════ */

async function logPrint(patientId: string, report: string) {
  const { data } = await supabase.rpc("app_log_patient_print", { p_patient_id: patientId, p_report: report });
  return Number(data ?? 0) || 1;
}

async function cardSection(ctx: Ctx, organizationName: string): Promise<Section> {
  const printed = await logPrint(ctx.patient.id, "كرت المريض");
  const p = ctx.patient;
  return {
    css: `.card { width: 90mm; height: 55mm; border: 1px dashed #999; padding: 5mm; display: flex; flex-direction: column; justify-content: space-between; margin-inline-start: auto; }
          .card .n { font-size: 15px; font-weight: 700; } .card .f { font-size: 13px; }`,
    html: `<div class="card">
        <div class="muted">${esc(organizationName)}</div>
        <div><div class="n">${esc(p.name_ar)}</div><div class="f">( <span class="num">${esc(p.file_number ?? "")}</span> )</div>
        <div class="muted">تاريخ فتح الملف : <span class="num">${esc(p.file_date ? dateText(p.file_date) : "—")}</span></div></div>
        <div class="en">Printed Count : ${printed}</div>
      </div>`,
  };
}

async function labelSection(ctx: Ctx): Promise<Section> {
  const printed = await logPrint(ctx.patient.id, "لصاقة المريض");
  const p = ctx.patient;
  const file = String(p.file_number ?? "");
  return {
    css: `@page label { size: 60mm 40mm; margin: 1.5mm;
            @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
          .label { page: label; width: 57mm; height: 37mm; overflow: hidden; direction: ltr; font-size: 6.8px; line-height: 1.32; }
          .label svg { width: 100%; height: 10mm; display: block; }
          .label .fn { text-align: center; font-weight: 700; font-size: 8px; margin-bottom: 0.6mm; }
          .label .na { font-weight: 700; font-size: 7.8px; direction: rtl; text-align: left; }
          .label table { width: 100%; }
          .label td { padding: 0 0.6mm; vertical-align: top; }
          .label td.k { color: #444; white-space: nowrap; width: 1%; }
          .label .pd { font-size: 5.2px; color: #555; margin-top: 0.4mm; }`,
    html: `<div class="label">
        ${file ? code128Svg(file) : ""}
        <div class="fn">${esc(file)}</div>
        <table><tbody>
          <tr><td class="k">Name Ar</td><td colspan="3" class="na">${esc(p.name_ar)}</td></tr>
          <tr><td class="k">Name En</td><td colspan="3">${esc(p.name_en ?? "")}</td></tr>
          <tr><td class="k">Gender</td><td>${esc(p.gender === "male" ? "Male" : p.gender === "female" ? "Female" : "-")}</td>
              <td class="k">D.O.B</td><td>${esc(p.birth_date ? dateText(p.birth_date) : "-")}</td></tr>
          <tr><td class="k">Age</td><td>${esc(ageText(p.birth_date).replace(/ , \d+ Day$/, "").replace(/ , /g, " "))}</td>
              <td class="k">Nationality</td><td style="direction:rtl;text-align:left">${esc(p.nationality ?? "-")}</td></tr>
          <tr><td class="k">Identify</td><td colspan="3">${esc(p.id_number ?? p.other_id_number ?? "-")}</td></tr>
        </tbody></table>
        <div class="pd">Printed Date : ${esc(dateTimeText(new Date().toISOString()))} · Printed Count : ${printed}</div>
      </div>`,
  };
}

/* ═══════════════════════ 6) كشف مواعيد وزيارات (pr06) ═══════════════════════ */

const STATUS_AR: Record<string, string> = {
  new: "جديد", scheduled: "مجدول", unconfirmed: "غير مؤكد", confirmed: "مؤكد", arrived: "حضر", checked_in: "سجّل الحضور",
  waiting: "في الانتظار", walk_in: "بدون موعد", called: "نودي", in_progress: "عند الطبيب", completed: "مكتمل",
  no_show: "لم يحضر", cancelled_by_patient: "اعتذر", cancelled_by_staff: "ألغته المنشأة",
};

async function appointmentsSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const [appts, legacy, clinics] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, doctor_id, clinic_id, scheduled_start, scheduled_end, status, note, created_at, created_by, visit_type_value_id, checked_in_1_at, called_at, entered_at, left_at, sent_by_user_id")
      .eq("patient_id", p.id)
      .order("scheduled_start"),
    supabase.from("legacy_appointments").select("*").eq("patient_id", p.id).order("starts_at"),
    supabase.from("clinics").select("id, name").eq("organization_id", ctx.orgId),
  ]);
  const rows = ((appts.data ?? []) as any[]).filter((a) => inRange(a.scheduled_start, ctx.filters));
  const visitTypes = await lookupNames(rows.map((a) => a.visit_type_value_id));
  const clinicNames = new Map(((clinics.data ?? []) as any[]).map((c) => [c.id, c.name]));
  const { data: phones } = await supabase.from("patients").select("mobile_number, phone_1").eq("id", p.id).maybeSingle();
  const mobile = (phones as any)?.mobile_number ?? "";
  const phone = (phones as any)?.phone_1 ?? "";
  const waitMin = (a: any) =>
    a.checked_in_1_at && a.entered_at ? Math.max(0, Math.round((Date.parse(a.entered_at) - Date.parse(a.checked_in_1_at)) / 60000)) : null;

  const apptRows =
    rows
      .map(
        (a) => `<tr><td>${esc(ctx.doctors.get(a.doctor_id) ?? "—")}</td><td class="num">${esc(waitMin(a) ?? "")}</td><td class="num">${esc(
          dateTimeText(a.scheduled_start),
        )}</td><td class="num">${esc(timeText(a.scheduled_end))}</td><td class="num">${esc(mobile)}</td><td class="num">${esc(phone)}</td><td class="num">${esc(
          dateText(a.created_at),
        )}</td><td>${esc(visitTypes.get(a.visit_type_value_id)?.name ?? "")}</td><td>${esc(ctx.members.get(a.created_by) ?? "")}</td><td>${esc(
          STATUS_AR[a.status] ?? a.status,
        )}</td><td class="t">${escLines(a.note ?? "")}</td></tr>`,
      )
      .join("") +
    ((legacy.data ?? []) as any[])
      .filter((l) => inRange(l.starts_at, ctx.filters))
      .map(
        (l) => `<tr><td>${esc(l.doctor_name ?? "—")}${LEGACY_TAG}</td><td></td><td class="num">${esc(dateTimeText(l.starts_at))}</td><td class="num">${esc(
          timeText(l.ends_at),
        )}</td><td class="num">${esc(l.mobile ?? "")}</td><td></td><td class="num">${esc(dateText(l.registered_at))}</td><td></td><td>${esc(l.added_by ?? "")}</td><td>${esc(
          l.status ?? "",
        )}</td><td class="t">${escLines(l.notes ?? "")}</td></tr>`,
      )
      .join("");
  const apptCount = rows.length + ((legacy.data ?? []) as any[]).filter((l) => inRange(l.starts_at, ctx.filters)).length;

  // الدخول للعيادة (نظام الدور) — «جديد» أوّل زيارة للطبيب، و«مراجع» ما بعدها
  const entries = rows.filter((a) => a.checked_in_1_at);
  const seen = new Set<string>();
  const entryRows = entries
    .map((a) => {
      const key = a.doctor_id ?? "-";
      const kind = seen.has(key) ? "مراجع - Follow" : "جديد - New";
      seen.add(key);
      return `<tr><td class="num">${esc(dateText(a.checked_in_1_at))}</td><td class="num">${esc(timeText(a.called_at))}</td><td class="num">${esc(
        timeText(a.entered_at),
      )}</td><td class="num">${esc(timeText(a.left_at))}</td><td>${esc(kind)}</td><td>${esc(ctx.doctors.get(a.doctor_id) ?? "—")}</td><td>${esc(
        clinicNames.get(a.clinic_id) ?? "",
      )}</td><td class="t">${escLines(a.note ?? "")}</td><td>${esc(ctx.members.get(a.sent_by_user_id ?? a.created_by) ?? "")}</td></tr>`;
    })
    .join("");

  return {
    html: `<h1 class="rt">كشف مواعيد وزيارات مريض - <span class="en">Patient appointments and visits report</span></h1>
      <div class="meta"><span><b>المريض :</b> ${esc(p.name_ar)}</span><span><b>الملف :</b> <span class="num">${esc(p.file_number ?? "")}</span></span></div>
      <h2 class="sec">المواعيد - <span class="en">Appointments</span></h2>
      <table class="grid"><thead><tr><th>الطبيب</th><th>انتظار (د)</th><th>بدء الموعد</th><th>انتهاء الموعد</th><th>الجوال</th><th>الهاتف</th><th>تاريخ التسجيل</th><th>نوع الزيارة</th><th>المستخدم</th><th>حالة الموعد</th><th>الملاحظات</th></tr></thead>
      <tbody>${apptRows || '<tr><td colspan="11" class="empty">لا مواعيد</td></tr>'}<tr class="total"><td colspan="11" class="t">الإجمالي : ${apptCount}</td></tr></tbody></table>
      <h2 class="sec">الدخول للعيادة - <span class="en">Clinic entries</span></h2>
      <table class="grid"><thead><tr><th>تاريخ الدخول</th><th>وقت النداء</th><th>وقت الدخول</th><th>وقت الخروج</th><th>نوع الزيارة</th><th>الطبيب</th><th>العيادة</th><th>ملاحظة</th><th>المستخدم</th></tr></thead>
      <tbody>${entryRows || '<tr><td colspan="9" class="empty">لا دخول مسجّل</td></tr>'}<tr class="total"><td colspan="9" class="t">الإجمالي : ${entries.length}</td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ 8) طلبيات المعمل (pr08) ═══════════════════════ */

async function dentalLabSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const orders = ((await supabase.from("dental_lab_orders").select("*").eq("patient_id", p.id).order("order_date")).data ?? []) as any[];
  const list = orders.filter((o) => inRange(o.order_date, ctx.filters));
  const ids = list.map((o) => o.id);
  const [items, labs, guides, shades] = await Promise.all([
    ids.length ? supabase.from("dental_lab_order_items").select("*").in("order_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("distributors").select("id, name_ar").eq("organization_id", ctx.orgId).eq("is_dental_lab", true),
    supabase.from("tooth_shade_guides").select("id, name").eq("organization_id", ctx.orgId),
    supabase.from("tooth_shades").select("id, code"),
  ]);
  const labNames = new Map(((labs.data ?? []) as any[]).map((l) => [l.id, l.name_ar]));
  const guideNames = new Map(((guides.data ?? []) as any[]).map((g) => [g.id, g.name]));
  const shadeCodes = new Map(((shades.data ?? []) as any[]).map((s) => [s.id, s.code]));
  const itemRows = (items.data ?? []) as any[];

  const body = list
    .map((o) => {
      const its = itemRows.filter((i) => i.order_id === o.id);
      return `<table class="grid" style="margin-bottom:6px"><tbody>
        <tr class="inv"><td>تاريخ الطلبية : <span class="num">${esc(dateText(o.order_date))}</span></td><td>تاريخ التسليم : <span class="num">${esc(
          o.delivery_date ? dateText(o.delivery_date) : "—",
        )}</span></td><td>الطبيب : ${esc(ctx.doctors.get(o.doctor_id) ?? "—")}</td><td>المعمل : ${esc(labNames.get(o.distributor_id) ?? "—")}</td></tr>
        <tr><td>دليل الأسنان : ${esc(guideNames.get(o.shade_guide_id) ?? "—")}</td><td>لون الأسنان : ${esc(shadeCodes.get(o.shade_id) ?? "—")}</td><td>رقم الطلبية : <span class="num">${esc(
          o.order_number ?? "—",
        )}</span></td><td>فاتورة المعمل : <span class="num">${esc(o.lab_invoice_number ?? "—")}</span></td></tr>
        <tr><td colspan="4" class="t">الملاحظات : ${escLines(o.note ?? "")}</td></tr>
        <tr><td colspan="4" style="padding:0"><table class="grid sub"><thead><tr><th>الأعمال</th><th>اللون</th><th>أرقام الأسنان</th><th>العدد</th><th>الملاحظة</th></tr></thead><tbody>${
          its
            .map(
              (i) =>
                `<tr><td class="t">${esc(i.description ?? "")}</td><td>${esc(shadeCodes.get(i.shade_id) ?? "")}</td><td class="num">${esc(
                  (i.tooth_numbers ?? []).join(", "),
                )}</td><td class="num">${esc(i.qty)}</td><td></td></tr>`,
            )
            .join("") || '<tr><td colspan="5" class="empty">—</td></tr>'
        }</tbody></table></td></tr>
      </tbody></table>`;
    })
    .join("");

  return {
    html:
      patientHeaderHtml(p, "تقرير طلبيات معمل الأسنان الخاصة بالمريض", "Dental labs") +
      (body || '<p class="empty">لا طلبيات معمل لهذا المريض.</p>') +
      `<table class="grid"><tbody><tr class="total"><td class="t">الإجمالي : ${list.length}</td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ 9) زيارات المريض (pr09) ═══════════════════════ */

function examText(data: any): string {
  if (!data || typeof data !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const inner = examText(value);
      if (inner) parts.push(`${key}: ${inner}`);
    } else parts.push(`${key}: ${Array.isArray(value) ? value.join("، ") : String(value)}`);
  }
  return parts.join(" · ");
}

async function visitsSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const [visits, legacy, clinics] = await Promise.all([
    supabase
      .from("patient_visits")
      .select("id, clinic_id, doctor_id, visit_date, created_at, created_by, main_complaint, notes, exam_data, next_visit_plan, status")
      .eq("patient_id", p.id)
      .order("visit_date"),
    supabase.from("legacy_patient_records").select("*").eq("patient_id", p.id).in("kind", ["visit", "note"]).order("recorded_at"),
    supabase.from("clinics").select("id, name").eq("organization_id", ctx.orgId),
  ]);
  const clinicNames = new Map(((clinics.data ?? []) as any[]).map((c) => [c.id, c.name]));
  const list = ((visits.data ?? []) as any[]).filter((v) => v.status !== "cancelled" && inRange(v.visit_date ?? v.created_at, ctx.filters));
  const ids = list.map((v) => v.id);
  const diag = ids.length ? (((await supabase.from("patient_visit_diagnoses").select("visit_id, icd10_code_id, note").in("visit_id", ids)).data ?? []) as any[]) : [];
  const icdIds = Array.from(new Set(diag.map((d) => d.icd10_code_id).filter(Boolean)));
  const icd = new Map<string, string>();
  if (icdIds.length) {
    const { data } = await supabase.from("icd10_codes").select("id, code, name_ar, name_en").in("id", icdIds);
    for (const c of (data ?? []) as any[]) icd.set(c.id, `${c.code} ${c.name_ar ?? c.name_en}`);
  }
  let n = 0;
  const rows =
    list
      .map((v) => {
        n += 1;
        const details = [
          v.main_complaint ? `الشكوى الرئيسية: ${v.main_complaint}` : null,
          examText(v.exam_data) || null,
          diag.filter((d) => d.visit_id === v.id).map((d) => `التشخيص: ${icd.get(d.icd10_code_id) ?? ""}${d.note ? ` (${d.note})` : ""}`).join("\n") || null,
          v.notes ? `ملاحظات: ${v.notes}` : null,
          v.next_visit_plan ? `الزيارة التالية: ${v.next_visit_plan}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return `<tr><td class="num">${n}</td><td>${esc(clinicNames.get(v.clinic_id) ?? "—")}</td><td class="num">${esc(dateTimeText(v.visit_date ?? v.created_at))}</td><td>${esc(
          ctx.doctors.get(v.doctor_id) ?? ctx.members.get(v.created_by) ?? "—",
        )}</td><td class="t">${escLines(details)}</td></tr>`;
      })
      .join("") +
    ((legacy.data ?? []) as any[])
      .filter((r) => inRange(r.recorded_at, ctx.filters))
      .map((r) => {
        n += 1;
        return `<tr><td class="num">${n}</td><td>${esc(r.clinic_name ?? (r.kind === "note" ? "ملاحظة" : "—"))}${LEGACY_TAG}</td><td class="num">${esc(
          dateTimeText(r.recorded_at),
        )}</td><td>${esc(r.doctor_name ?? r.user_name ?? "—")}</td><td class="t">${escLines([r.title, r.details].filter(Boolean).join("\n"))}</td></tr>`;
      })
      .join("");

  return {
    html:
      patientHeaderHtml(p, "كشف زيارات المريض", "Patient Visits") +
      `<table class="grid"><thead><tr><th>رقم الزيارة</th><th>العيادة</th><th>تاريخ التسجيل</th><th>المسجل</th><th>تفاصيل الزيارة</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">لا زيارات</td></tr>'}<tr class="total"><td colspan="5" class="t">الإجمالي : ${n}</td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ 10) التحاليل (pr10) ═══════════════════════ */

async function labTestsSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const orders = (((await supabase.from("lab_orders").select("*").eq("patient_id", p.id).order("ordered_at")).data ?? []) as any[]).filter(
    (o) => o.status !== "cancelled" && inRange(o.ordered_at, ctx.filters),
  );
  const ids = orders.map((o) => o.id);
  const items = ids.length ? (((await supabase.from("lab_order_items").select("*").in("lab_order_id", ids)).data ?? []) as any[]) : [];
  const testIds = Array.from(new Set(items.map((i) => i.lab_test_id).filter(Boolean)));
  const compIds = Array.from(new Set(items.map((i) => i.component_id).filter(Boolean)));
  const [tests, comps] = await Promise.all([
    testIds.length ? supabase.from("lab_tests").select("id, name_ar, name_en, unit, normal_range_text, normal_range_min, normal_range_max, specimen_type").in("id", testIds) : Promise.resolve({ data: [] }),
    compIds.length ? supabase.from("lab_test_components").select("id, name_ar, name_en, unit").in("id", compIds) : Promise.resolve({ data: [] }),
  ]);
  const testMap = new Map(((tests.data ?? []) as any[]).map((t) => [t.id, t]));
  const compMap = new Map(((comps.data ?? []) as any[]).map((c) => [c.id, c]));
  const keyOf = (i: any) => `${i.lab_test_id}|${i.component_id ?? ""}`;
  const orderDate = new Map(orders.map((o) => [o.id, o.ordered_at]));
  const sorted = [...items].sort((a, b) => String(orderDate.get(a.lab_order_id)).localeCompare(String(orderDate.get(b.lab_order_id))));
  const previous = new Map<string, string>();
  const prevOf = new Map<string, string>();
  for (const i of sorted) {
    const k = keyOf(i);
    if (previous.has(k)) prevOf.set(i.id, previous.get(k)!);
    if (i.result_value != null && i.result_value !== "") previous.set(k, String(i.result_value));
  }

  const body = orders
    .map((o, index) => {
      const its = items.filter((i) => i.lab_order_id === o.id);
      const specimen = Array.from(new Set(its.map((i) => testMap.get(i.lab_test_id)?.specimen_type).filter(Boolean))).join("، ");
      return `<table class="grid" style="margin-bottom:6px"><tbody>
        <tr class="inv"><td>رقم التحليل : <span class="num">${index + 1}</span></td><td>طالب التحليل : ${esc(ctx.doctors.get(o.ordering_doctor_id) ?? "—")}</td><td>تاريخ الطلب : <span class="num">${esc(
          dateTimeText(o.ordered_at),
        )}</span></td><td>العينة : ${esc(specimen || "—")}</td></tr>
        <tr><td colspan="4" style="padding:0"><table class="grid sub"><thead><tr><th>التحليل</th><th>النتيجة</th><th>الوحدة</th><th>المعدل الطبيعي</th><th>النتيجة السابقة</th></tr></thead><tbody>${
          its
            .map((i) => {
              const t = testMap.get(i.lab_test_id);
              const c = compMap.get(i.component_id);
              const name = c ? `${t?.name_en ?? t?.name_ar ?? ""} — ${c.name_en ?? c.name_ar}` : t?.name_en ?? t?.name_ar ?? "";
              const range =
                i.reference_text ??
                (i.reference_low != null || i.reference_high != null
                  ? `${i.reference_low ?? ""} - ${i.reference_high ?? ""}`
                  : t?.normal_range_text ?? (t?.normal_range_min != null ? `${t.normal_range_min} - ${t.normal_range_max}` : ""));
              return `<tr><td class="t num">${esc(name)}</td><td class="num"${i.is_abnormal ? ' style="font-weight:700"' : ""}>${esc(i.result_value ?? "")}</td><td class="num">${esc(
                i.unit_override ?? c?.unit ?? t?.unit ?? "",
              )}</td><td class="num">${esc(range)}</td><td class="num">${esc(prevOf.get(i.id) ?? "")}</td></tr>`;
            })
            .join("") || '<tr><td colspan="5" class="empty">—</td></tr>'
        }</tbody></table></td></tr>
        <tr><td colspan="2">مدير المختبر : ${esc(ctx.members.get(o.approved_by ?? o.verified_by) ?? "—")}</td><td colspan="2" class="t">ملاحظة : ${escLines(o.notes ?? "")}</td></tr>
      </tbody></table>`;
    })
    .join("");

  return {
    html:
      patientHeaderHtml(p, "التحليل الطبي", "Medical test") +
      (body || '<p class="empty">لا تحاليل لهذا المريض.</p>') +
      `<table class="grid"><tbody><tr class="total"><td class="t">الإجمالي : ${orders.length}</td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ 11) الوصفات (pr11) ═══════════════════════ */

async function prescriptionsSection(ctx: Ctx): Promise<Section> {
  const p = ctx.patient;
  const list = (((await supabase.from("prescriptions").select("*").eq("patient_id", p.id).order("created_at")).data ?? []) as any[]).filter(
    (r) => r.status !== "cancelled" && inRange(r.issued_at ?? r.created_at, ctx.filters),
  );
  const ids = list.map((r) => r.id);
  const items = ids.length ? (((await supabase.from("prescription_items").select("*").in("prescription_id", ids)).data ?? []) as any[]) : [];
  const drugIds = Array.from(new Set(items.map((i) => i.drug_item_id).filter(Boolean)));
  const drugs = new Map<string, any>();
  if (drugIds.length) {
    const { data } = await supabase.from("items").select("id, code, name_ar, name_en").in("id", drugIds);
    for (const d of (data ?? []) as any[]) drugs.set(d.id, d);
  }
  const visitIds = Array.from(new Set(list.map((r) => r.visit_id).filter(Boolean)));
  const diagByVisit = new Map<string, string>();
  if (visitIds.length) {
    const { data } = await supabase.from("patient_visit_diagnoses").select("visit_id, icd10_code_id").in("visit_id", visitIds);
    const icdIds = Array.from(new Set(((data ?? []) as any[]).map((d) => d.icd10_code_id)));
    const icd = new Map<string, string>();
    if (icdIds.length) {
      const res = await supabase.from("icd10_codes").select("id, code, name_ar, name_en").in("id", icdIds);
      for (const c of (res.data ?? []) as any[]) icd.set(c.id, `${c.code} ${c.name_ar ?? c.name_en}`);
    }
    for (const d of (data ?? []) as any[]) {
      diagByVisit.set(d.visit_id, [diagByVisit.get(d.visit_id), icd.get(d.icd10_code_id)].filter(Boolean).join("، "));
    }
  }

  const body = list
    .map((r, index) => {
      const its = items.filter((i) => i.prescription_id === r.id);
      return `<table class="grid" style="margin-bottom:6px"><tbody>
        <tr class="inv"><td>رقم الوصفة : <span class="num">${index + 1}</span></td><td>التاريخ : <span class="num">${esc(dateTimeText(r.issued_at ?? r.created_at))}</span></td><td>الطبيب المعالج : ${esc(
          ctx.doctors.get(r.doctor_id) ?? "—",
        )}</td><td>آخر تعديل : <span class="num">${esc(dateTimeText(r.updated_at))}</span></td></tr>
        <tr><td colspan="2">عمر المريض : <span class="num">${esc(ageText(p.birth_date))}</span></td><td colspan="2">التشخيص : ${esc(diagByVisit.get(r.visit_id) ?? "—")}</td></tr>
        <tr><td colspan="4" style="padding:0"><table class="grid sub"><thead><tr><th>الكود</th><th>اسم الدواء</th><th>الاسم العلمي</th><th>الجرعة</th><th>ملاحظة</th></tr></thead><tbody>${
          its
            .map((i) => {
              const d = drugs.get(i.drug_item_id);
              const dose = [i.dosage_instructions, i.frequency, i.duration_days ? `${i.duration_days} يوم` : null, i.route].filter(Boolean).join(" · ");
              return `<tr><td class="num">${esc(d?.code ?? "")}</td><td class="t">${esc(d?.name_ar ?? "")}</td><td class="num">${esc(d?.name_en ?? "")}</td><td class="t">${esc(
                dose,
              )}</td><td class="t">${esc(i.quantity_prescribed ? `الكمية ${i.quantity_prescribed}` : "")}</td></tr>`;
            })
            .join("") || '<tr><td colspan="5" class="empty">—</td></tr>'
        }</tbody></table></td></tr>
        ${r.notes ? `<tr><td colspan="4" class="t">ملاحظات : ${escLines(r.notes)}</td></tr>` : ""}
      </tbody></table>`;
    })
    .join("");

  return {
    html:
      patientHeaderHtml(p, "تقرير وصفات الأدوية الخاصة بالمريض", "Patient Prescriptions") +
      (body || '<p class="empty">لا وصفات لهذا المريض.</p>') +
      `<table class="grid"><tbody><tr class="total"><td class="t"><span class="en">Total count is</span> : ${list.length}</td></tr></tbody></table>`,
  };
}

/* ═══════════════════════ التشغيل ═══════════════════════ */

async function loadContext(orgId: string, patientId: string, filters: ReportFilters): Promise<Ctx> {
  const [patient, doctors, members] = await Promise.all([
    loadReportPatient(patientId),
    supabase.from("doctors").select("id, name_ar").eq("organization_id", orgId),
    supabase.from("v_organization_members_directory").select("user_id, display_name").eq("organization_id", orgId),
  ]);
  return {
    orgId,
    patient,
    filters,
    doctors: new Map(((doctors.data ?? []) as any[]).map((d) => [d.id, d.name_ar])),
    members: new Map(((members.data ?? []) as any[]).map((m) => [m.user_id, m.display_name])),
  };
}

async function buildSection(key: PatientReportKey, ctx: Ctx, organizationName: string): Promise<Section> {
  switch (key) {
    case "patient_file":
      return patientFileSection(ctx);
    case "invoices":
      return invoicesSection(ctx);
    case "statement":
      return statementSection(ctx);
    case "card":
      return cardSection(ctx, organizationName);
    case "label":
      return labelSection(ctx);
    case "appointments":
      return appointmentsSection(ctx);
    case "dental": {
      const dental = await buildDentalReportSection(ctx.patient.id);
      return { html: dental.html, css: dental.css };
    }
    case "dental_lab":
      return dentalLabSection(ctx);
    case "visits":
      return visitsSection(ctx);
    case "lab_tests":
      return labTestsSection(ctx);
    case "prescriptions":
      return prescriptionsSection(ctx);
  }
}

/**
 * يطبع تقريرًا واحدًا، أو الملف الموحّد (ملف المريض أوّلًا ثمّ الأقسام المختارة
 * بالترتيب، كلٌّ في صفحةٍ جديدة، والترقيم متّصل).
 */
export async function printPatientReports(opts: {
  organizationId: string;
  organizationName: string;
  userName: string;
  patientId: string;
  keys: PatientReportKey[];
  filters?: ReportFilters;
  unified?: boolean;
}) {
  const win = window.open("", "_blank");
  if (win) win.document.write('<p style="font-family:Tahoma;padding:24px">جارٍ تجهيز التقرير…</p>');
  try {
    const ctx = await loadContext(opts.organizationId, opts.patientId, opts.filters ?? {});
    const keys = opts.unified ? (["patient_file", ...opts.keys.filter((k) => k !== "patient_file")] as PatientReportKey[]) : opts.keys;
    const sections: Section[] = [];
    for (const key of keys) sections.push(await buildSection(key, ctx, opts.organizationName));
    const label = opts.unified ? "ملف المريض الموحد" : PATIENT_REPORTS.find((r) => r.key === keys[0])?.label ?? "تقرير المريض";
    if (win) win.document.open();
    openPatientReport(
      {
        title: `${label} — ${ctx.patient.name_ar}`,
        organizationName: opts.organizationName,
        userName: opts.userName,
        sections: sections.map((s) => s.html),
        extraCss: SHARED_CSS + sections.map((s) => s.css ?? "").join("\n"),
      },
      win,
    );
  } catch (error) {
    win?.close();
    throw error;
  }
}
