import { supabase } from "@/lib/supabase";
import {
  dateText,
  esc,
  escLines,
  buildReportDocument,
  loadReportPatient,
  patientHeaderHtml,
  timeText,
} from "@/lib/patient-report";
import { previewReport } from "@/lib/report-preview";

/**
 * سجلّ إجراءات الأسنان (0211) — الأهداف، والقراءة، وطباعة «كشف عيادات
 * الأسنان» بنموذج Kizen (pr07).
 */

export type DentalTarget =
  | "full_arch"
  | "upper_arch"
  | "lower_arch"
  | "xray"
  | "ortho_upper"
  | "ortho_lower"
  | "orthodontics";

/** الأهداف التي ليست سنًّا — كما في لوحة Kizen. */
export const DENTAL_TARGETS: { key: DentalTarget; label: string; en: string }[] = [
  { key: "full_arch", label: "الفكّ كاملًا", en: "FullArch" },
  { key: "upper_arch", label: "الفكّ العلوي", en: "UpperArch" },
  { key: "lower_arch", label: "الفكّ السفلي", en: "LowerArch" },
  { key: "xray", label: "أشعة", en: "XRay" },
  { key: "ortho_upper", label: "تقويم علوي", en: "OrthoUpper" },
  { key: "ortho_lower", label: "تقويم سفلي", en: "OrthoLower" },
  { key: "orthodontics", label: "تقويم", en: "Orthodontics" },
];
export const targetLabel = (key: string) => DENTAL_TARGETS.find((t) => t.key === key)?.label ?? key;

export type DentalLogRow = {
  source: "zaincare" | "plan" | "kizen";
  id: string;
  organization_id: string;
  patient_id: string;
  visit_date: string;
  recorded_at: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  teeth: string[];
  tooth_type: "permanent" | "primary";
  targets: DentalTarget[];
  main_complaint: string | null;
  diagnosis: string | null;
  diagnosis_free_text: string | null;
  icd10_code: string | null;
  diagnosis_icd10_id: string | null;
  procedure_text: string | null;
  anesthesia: string | null;
  complications: string | null;
  antibiotics: string | null;
  education: string | null;
  next_visit: string | null;
  note: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  has_signature: boolean;
  patient_signed_at: string | null;
  visit_id: string | null;
};

export async function fetchDentalLog(patientId: string): Promise<DentalLogRow[]> {
  const { data, error } = await supabase
    .from("v_patient_dental_log")
    .select("*")
    .eq("patient_id", patientId)
    .order("visit_date", { ascending: false })
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DentalLogRow[]).map((row) => ({
    ...row,
    teeth: row.teeth ?? [],
    targets: row.targets ?? [],
  }));
}

/** ما يُلحق بالملاحظة في الطباعة والعرض — كما يفعل Kizen («التخدير : نعم»). */
export function noteExtras(row: Pick<DentalLogRow, "anesthesia" | "complications" | "antibiotics" | "education" | "next_visit">) {
  return [
    row.anesthesia ? `التخدير : ${row.anesthesia}` : null,
    row.complications ? `المضاعفات : ${row.complications}` : null,
    row.antibiotics ? `المضادات الوقائية : ${row.antibiotics}` : null,
    row.education ? `التثقيف : ${row.education}` : null,
    row.next_visit ? `الزيارة التالية : ${row.next_visit}` : null,
  ].filter(Boolean) as string[];
}

/** الأسنان المميَّزة (لها إجراء غير ملغى) والأهداف المميَّزة. */
export function markedTeeth(rows: DentalLogRow[]) {
  const teeth = new Set<string>();
  const targets = new Set<string>();
  for (const row of rows) {
    if (row.is_cancelled) continue;
    row.teeth.forEach((t) => teeth.add(t));
    row.targets.forEach((t) => targets.add(t));
  }
  return { teeth, targets };
}

/* ═══════════════════════════ الطباعة (pr07) ═══════════════════════════ */

const PERM_UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const PERM_LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const PRIM_UPPER = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
const PRIM_LOWER = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

function toothGlyph(n: string, upper: boolean, marked: boolean) {
  // تاجٌ وجذرٌ مبسّطان — يكفيان ليُرى أيّ سنٍّ مؤطَّر بالأحمر
  const crown = upper
    ? `<rect x="3" y="20" width="14" height="14" rx="4" fill="#efe6cf" stroke="#b9a77a"/><path d="M6 20 L8 4 L12 4 L14 20" fill="#f4eedd" stroke="#b9a77a"/>`
    : `<rect x="3" y="2" width="14" height="14" rx="4" fill="#efe6cf" stroke="#b9a77a"/><path d="M6 16 L8 32 L12 32 L14 16" fill="#f4eedd" stroke="#b9a77a"/>`;
  return `<div class="tooth${marked ? " mk" : ""}">${upper ? `<span>${n}</span>` : ""}<svg viewBox="0 0 20 36" width="20" height="36">${crown}</svg>${
    upper ? "" : `<span>${n}</span>`
  }</div>`;
}

function panelHtml(upper: string[], lower: string[], marked: Set<string>) {
  return `<div class="jaw">${upper.map((n) => toothGlyph(n, true, marked.has(n))).join("")}</div>
          <div class="jaw">${lower.map((n) => toothGlyph(n, false, marked.has(n))).join("")}</div>`;
}

/** رقم السنّ بطريقة Palmer: صليب بأربعة أرباع، ورقم الموضع في ربعه. */
function palmerHtml(teeth: string[], type: string, targets: string[]) {
  if (teeth.length === 0) {
    return `<div class="target">${esc(targets.map(targetLabel).join("، ") || "—")}</div>`;
  }
  const quad: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const t of teeth) {
    const q = Number(t[0]);
    const mapped = q > 4 ? q - 4 : q; // 5→1، 6→2، 7→3، 8→4
    quad[mapped]?.push(t[1]);
  }
  const cell = (q: number) => esc(quad[q].sort().join(" "));
  return `<table class="palmer"><tr><td class="pr">${cell(1)}</td><td class="pl">${cell(2)}</td></tr>
          <tr><td class="pr b">${cell(4)}</td><td class="pl b">${cell(3)}</td></tr></table>
          <div class="ptype">${type === "primary" ? "Deciduous" : "Permanent"}${
            targets.length ? ` · ${esc(targets.map(targetLabel).join("، "))}` : ""
          }</div>`;
}

const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const visitHeading = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `( ${AR_DAYS[d.getDay()]} - ${AR_MONTHS[d.getMonth()]} / ${dateText(iso)} )`;
};

const DENTAL_CSS = `
  .panels { display: grid; grid-template-columns: 1.6fr 1fr; border: 1px solid #000; margin-bottom: 8px; }
  .panels > div { padding: 4px; }
  .panels > div + div { border-right: 1px solid #000; }
  .panels .pt { text-align: center; font-weight: 600; border-bottom: 1px solid #000; margin: -4px -4px 4px; padding: 3px; }
  .jaw { display: flex; justify-content: center; direction: ltr; gap: 1px; }
  .tooth { display: flex; flex-direction: column; align-items: center; font-size: 8px; padding: 1px; border: 1.5px solid transparent; }
  .tooth.mk { border-color: #d00; }
  table.palmer { width: 70px; margin: 0 auto; direction: ltr; }
  table.palmer td { height: 14px; width: 50%; font-size: 10px; border: 0 !important; padding: 0 3px !important; }
  table.palmer td.pr { border-right: 1px solid #000 !important; text-align: right; }
  table.palmer td.pl { text-align: left; }
  table.palmer td.b { border-top: 1px solid #000 !important; }
  .ptype { font-size: 8px; color: #444; }
  .target { font-weight: 600; }
  .reg { white-space: nowrap; }
  .sig { max-height: 34px; display: block; margin: 2px auto 0; }
  .cancel { color: #b00; font-size: 9px; }
`;

/**
 * «كشف عيادات الأسنان» — اللوحتان (الدائمة واللبنية) بإطارٍ أحمر على كل سنّ
 * له إجراء، والإجراءات مجمّعة برقم الزيارة (تاريخ مختلف)، والإجماليان.
 * `visitDate`: طباعة زيارةٍ واحدة («طباعة كشف بالزيارة المحددة»).
 */
export async function buildDentalReportSection(patientId: string, visitDate?: string | null) {
  const [patient, all] = await Promise.all([loadReportPatient(patientId), fetchDentalLog(patientId)]);
  const rows = all
    .filter((row) => !row.is_cancelled && (!visitDate || row.visit_date === visitDate))
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date) || String(a.recorded_at).localeCompare(String(b.recorded_at)));

  // التوقيعات (لصفوف السجلّ المستقلّ الموقَّعة)
  const signedIds = rows.filter((row) => row.has_signature).map((row) => row.id);
  const signatures = new Map<string, string>();
  if (signedIds.length > 0) {
    const { data } = await supabase.from("dental_chart_entries").select("id, patient_signature").in("id", signedIds);
    for (const s of (data ?? []) as { id: string; patient_signature: string | null }[]) {
      if (s.patient_signature) signatures.set(s.id, s.patient_signature);
    }
  }

  const { teeth: marked } = markedTeeth(rows);
  const dates = Array.from(new Set(rows.map((row) => row.visit_date)));

  const body = dates
    .map((date, index) => {
      const group = rows.filter((row) => row.visit_date === date);
      return (
        `<tr class="group"><td colspan="6"><span class="en">Visit Number</span> ${index + 1} &nbsp;&nbsp; ${esc(visitHeading(date))}</td></tr>` +
        group
          .map((row) => {
            const note = [row.note, ...noteExtras(row)].filter(Boolean).join("\n");
            const sig = signatures.get(row.id);
            return `<tr>
              <td class="reg">${esc(row.doctor_name ?? "—")}<br/><span class="num">${esc(timeText(row.recorded_at))}</span>${
                row.source === "kizen" ? '<br/><span class="muted">Kizen</span>' : ""
              }</td>
              <td>${palmerHtml(row.teeth, row.tooth_type, row.targets)}</td>
              <td class="t">${escLines(row.main_complaint ?? "")}</td>
              <td class="t">${escLines(row.diagnosis ?? "")}</td>
              <td class="t">${escLines(row.procedure_text ?? "")}</td>
              <td class="t">${escLines(note)}${sig ? `<img class="sig" src="${sig}" alt="توقيع المريض"/>` : ""}</td>
            </tr>`;
          })
          .join("")
      );
    })
    .join("");

  const table = `
    <table class="grid">
      <thead>
        <tr><th colspan="6">${esc("Patient's Dental Procedures Table")} - جدول بإجراءات لوحة الأسنان الخاصة بالمريض</th></tr>
        <tr><th>المسجل<br/><span class="en">Registrar</span></th><th>رقم السن<br/><span class="en">Tooth Number</span></th>
            <th>الشكوى الرئيسية<br/><span class="en">Main complaint</span></th><th>التشخيص الطبي<br/><span class="en">Medical diagnosis</span></th>
            <th>الإجراء<br/><span class="en">Procedure</span></th><th>ملاحظة<br/><span class="en">Note</span></th></tr>
      </thead>
      <tbody>
        ${body || '<tr><td colspan="6" class="empty">لا إجراءات مسجّلة</td></tr>'}
        <tr class="total"><td colspan="5" class="t">بلغ عدد إجمالي الزيارات - <span class="en">The Number Of Total Visits</span> :</td><td>${dates.length}</td></tr>
        <tr class="total"><td colspan="5" class="t">بلغ عدد إجمالي الإجراءات المسجلة في لوحة الأسنان - <span class="en">Total Number Of Registered Procedures In Dental Chart</span> :</td><td>${rows.length}</td></tr>
      </tbody>
    </table>`;

  const panels = `
    <div class="panels">
      <div><div class="pt">لوحة الأسنان الدائمة الخاصة بالمريض - <span class="en">Patient Permanent Teeth Panel</span></div>${panelHtml(PERM_UPPER, PERM_LOWER, marked)}</div>
      <div><div class="pt">لوحة الأسنان اللبنية الخاصة بالمريض - <span class="en">Patient Deciduous Teeth Panel</span></div>${panelHtml(PRIM_UPPER, PRIM_LOWER, marked)}</div>
    </div>`;

  return {
    patient,
    html: patientHeaderHtml(patient, "جدول بإجراءات لوحة الأسنان الخاصة بالمريض", "Patient's Dental Procedures Table") + panels + table,
    css: DENTAL_CSS,
  };
}

/** يعرض «كشف عيادات الأسنان» معاينةً داخل النظام، ومنها الطباعة. */
export async function printDentalReport(opts: {
  patientId: string;
  organizationName: string;
  userName: string;
  visitDate?: string | null;
}) {
  await previewReport("كشف عيادات الأسنان", async () => {
    const section = await buildDentalReportSection(opts.patientId, opts.visitDate);
    const title = `كشف عيادات الأسنان — ${section.patient.name_ar}`;
    return {
      title,
      html: buildReportDocument({
        title,
        organizationName: opts.organizationName,
        userName: opts.userName,
        sections: [section.html],
        extraCss: section.css,
      }),
    };
  });
}
