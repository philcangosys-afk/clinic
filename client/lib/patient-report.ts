import { supabase } from "@/lib/supabase";

/**
 * قالب تقارير المريض المشترك (نموذج Kizen):
 * عنوانٌ بالعربية والإنجليزية، رأس المريض الموحّد مع مربّع «توقيع المريض»،
 * والتذييل في كل صفحة: اسم المنشأة · الصفحة X من Y · المستخدم · تاريخ الطباعة.
 *
 * الطباعة بـCSS على A4: رؤوس الجداول تتكرّر في كل صفحة، وكلّ قسمٍ في الملف
 * الموحّد يبدأ صفحةً جديدة. «PDF» من نافذة الطباعة نفسها (حفظ بصيغة PDF).
 */

export type ReportPatient = {
  id: string;
  name_ar: string;
  name_en: string | null;
  file_number: number | null;
  file_date: string | null;
  birth_date: string | null;
  gender: string | null;
  address: string | null;
  id_number: string | null;
  other_id_number: string | null;
  mobile_number: string | null;
  insurance_company_name: string | null;
  insurance_policy_number: string | null;
  insurance_membership_number: string | null;
  doctor_name: string | null;
  nationality: string | null;
};

export const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** نصّ متعدّد الأسطر: يُهرَّب ثمّ تصير الأسطر <br>. */
export const escLines = (value: unknown) => esc(value).replace(/\r?\n/g, "<br/>");

export const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const riyadh = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", ...opts }).format(new Date(iso));

/** «03/10/2026» */
export const dateText = (iso: string | null | undefined) =>
  iso ? riyadh(iso.length === 10 ? `${iso}T12:00:00Z` : iso, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
/** «05:59 PM» */
export const timeText = (iso: string | null | undefined) =>
  iso ? riyadh(iso, { hour: "2-digit", minute: "2-digit", hour12: true }) : "";
/** «03/10/2026 01:33 PM» */
export const dateTimeText = (iso: string | null | undefined) => (iso ? `${dateText(iso)} ${timeText(iso)}` : "—");

/** العمر «24 Year , 4 Month , 5 Day» كما يطبعه Kizen. */
export function ageText(birthDate: string | null | undefined) {
  if (!birthDate) return "—";
  const b = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  let m = now.getMonth() - b.getMonth();
  let d = now.getDate() - b.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return `${y} Year , ${m} Month , ${d} Day`;
}

const GENDER: Record<string, string> = { male: "ذكر - Male", female: "أنثى - Female" };

export async function loadReportPatient(patientId: string): Promise<ReportPatient> {
  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, name_ar, name_en, file_number, file_date, birth_date, gender, address, id_number, other_id_number, mobile_number, insurance_company_name, insurance_policy_number, insurance_membership_number, treating_doctor_id, nationality_value_id",
    )
    .eq("id", patientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("المريض غير موجود");
  const row = data as any;
  const [doctor, nationality] = await Promise.all([
    row.treating_doctor_id
      ? supabase.from("doctors").select("name_ar").eq("id", row.treating_doctor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.nationality_value_id
      ? supabase.from("lookup_values").select("name_ar").eq("id", row.nationality_value_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    ...row,
    doctor_name: (doctor.data as { name_ar: string } | null)?.name_ar ?? null,
    nationality: (nationality.data as { name_ar: string } | null)?.name_ar ?? null,
  } as ReportPatient;
}

/** رأس المريض الموحّد + مربّع التوقيع (تقارير 7–11 في Kizen). */
export function patientHeaderHtml(p: ReportPatient, titleAr: string, titleEn: string) {
  const insurance = p.insurance_company_name
    ? `${esc(p.insurance_company_name)} — Policy No. : ${esc(p.insurance_policy_number ?? "-")} — Membership No. : ${esc(
        p.insurance_membership_number ?? "-",
      )}`
    : "—";
  return `
  <table class="ph"><tr>
    <td class="ph-main">
      <table class="kv">
        <tr><th colspan="4" class="ph-title">${esc(titleEn)} - ${esc(titleAr)}</th></tr>
        <tr><td class="l">المريض : <span class="en">Name</span></td><td>${esc(p.name_ar)}</td>
            <td class="l">الطبيب : <span class="en">Doctor</span></td><td>${esc(p.doctor_name ?? "—")}</td></tr>
        <tr><td class="l">الملف : <span class="en">File No.</span></td><td class="num">${esc(p.file_number ?? "—")}</td>
            <td class="l">العمر : <span class="en">Age</span></td><td class="num">${esc(ageText(p.birth_date))}</td></tr>
        <tr><td class="l">الجنس : <span class="en">Gender</span></td><td>${esc(GENDER[p.gender ?? ""] ?? "—")}</td>
            <td class="l">الجنسية : <span class="en">Nationality</span></td><td>${esc(p.nationality ?? "—")}</td></tr>
        <tr><td class="l">العنوان : <span class="en">Address</span></td><td>${esc(p.address ?? "—")}</td>
            <td class="l">رقم الهوية : <span class="en">ID Number</span></td><td class="num">${esc(p.id_number ?? p.other_id_number ?? "—")}</td></tr>
        <tr><td class="l">التأمين : <span class="en">Insurance</span></td><td colspan="3">${insurance}</td></tr>
      </table>
    </td>
    <td class="ph-sign"><div>توقيع المريض</div><div class="en">The patient's signature</div></td>
  </tr></table>`;
}

const REPORT_CSS = `
  @page { size: A4; margin: 12mm 10mm 16mm;
    @bottom-left { content: "Page " counter(page) " of " counter(pages); font: 9px Tahoma, Arial; color: #555; }
  }
  @page landscape { size: A4 landscape; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size: 11px; color: #111; }
  .section { break-before: page; }
  .section:first-child { break-before: auto; }
  .num, .en { direction: ltr; unicode-bidi: isolate; }
  .en { color: #444; font-size: 10px; }
  h1.rt { font-size: 15px; text-align: center; margin: 0 0 6px; border: 1px solid #000; padding: 5px; background: #f2f2f2; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr, td, th { break-inside: avoid; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; text-align: center; }
  table.grid thead th { background: #f2f2f2; font-weight: 600; }
  table.grid td.t { text-align: right; }
  tr.group td { background: #d9d9d9; font-weight: 700; text-align: right; }
  tr.total td { background: #f2f2f2; font-weight: 700; }
  .ph { margin-bottom: 8px; border: 1px solid #000; }
  .ph td { vertical-align: top; }
  .ph-main { width: 78%; border-left: 1px solid #000; }
  .ph-sign { text-align: center; padding: 6px; font-weight: 600; }
  table.kv td, table.kv th { border-bottom: 1px solid #000; padding: 3px 5px; text-align: right; }
  table.kv td.l { white-space: nowrap; color: #222; width: 1%; }
  .ph-title { text-align: center !important; font-weight: 700; background: #f2f2f2; }
  .muted { color: #666; }
  .empty { text-align: center; color: #666; padding: 8px; }
`;

export type ReportPrintOptions = {
  title: string;
  organizationName: string;
  userName: string;
  /** أقسام التقرير — كلٌّ يبدأ صفحةً جديدة إن تعدّدت (الملف الموحّد) */
  sections: string[];
  extraCss?: string;
};

/** يفتح نافذة الطباعة (ومنها «حفظ PDF»). تُفتح بضغطة المستخدم لتفادي حاجب النوافذ. */
export function openPatientReport(opts: ReportPrintOptions, target?: Window | null) {
  const win = target ?? window.open("", "_blank");
  if (!win) {
    window.alert("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.");
    return;
  }
  const printedAt = dateTimeText(new Date().toISOString());
  // التذييل في هامش كل صفحة (صناديق @page): المنشأة · المستخدم وتاريخ الطباعة · الصفحة
  const cssText = (value: string) => `"${value.replace(/["\\]/g, "")}"`;
  const footerCss = `@page { @bottom-right { content: ${cssText(opts.organizationName)}; font: 9px Tahoma, Arial; color: #555; }
    @bottom-center { content: ${cssText(`User : ${opts.userName}   Printing Date: ${printedAt}`)}; font: 9px Tahoma, Arial; color: #555; } }`;
  win.document.write(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${esc(opts.title)}</title>` +
      `<style>${REPORT_CSS}${footerCss}${opts.extraCss ?? ""}</style></head><body>` +
      opts.sections.map((html) => `<div class="section">${html}</div>`).join("") +
      `</body></html>`,
  );
  win.document.close();
  win.focus();
  // الصور (التوقيعات) تُحمَّل قبل الطباعة
  setTimeout(() => win.print(), 350);
}
