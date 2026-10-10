import { supabase } from "@/lib/supabase";
import { previewReport } from "@/lib/report-preview";
import { esc } from "@/lib/patient-report";

/**
 * الوصفة الطبية — طباعة العيادة (0221).
 *
 * الطبيب يكتب الوصفة من ملفّ المريض (أو من شاشة الوصفات)، فتصل إلى الاستقبال
 * في مركز المتابعة، ومن هناك تُطبع بترويسة المجمع: الشعار والاسم والعنوان
 * والهاتف، وبيانات المريض، والطبيب المعالج وتوقيعه وختمه إن وُجدا.
 */

export const ROUTE_LABELS: Record<string, string> = {
  oral: "عن طريق الفم",
  topical: "موضعي",
  injection: "حقن",
  inhalation: "استنشاق",
  rectal: "شرجي",
  ophthalmic: "للعين",
  otic: "للأذن",
  nasal: "للأنف",
  other: "أخرى",
};

const one = <T,>(value: T | T[] | null | undefined): T | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

function ageText(birth: string | null | undefined) {
  if (!birth) return "";
  const b = new Date(birth);
  if (Number.isNaN(b.getTime())) return "";
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) years -= 1;
  return years >= 0 ? `${years} سنة` : "";
}

const PRESCRIPTION_CSS = `
@page { size: A5; margin: 10mm 9mm 12mm; }
* { box-sizing: border-box; }
body { font-family: Tahoma, Arial, sans-serif; color: #1f2937; margin: 0; font-size: 12px; }
.sheet { max-width: 720px; margin: 0 auto; }
.head { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #0f766e; padding-bottom: 8px; }
.head img { width: 64px; height: 64px; object-fit: contain; }
.head .org { flex: 1; }
.head .org h1 { margin: 0; font-size: 17px; color: #0f766e; }
.head .org p { margin: 2px 0 0; font-size: 10.5px; color: #4b5563; }
.title { display: flex; justify-content: space-between; align-items: baseline; margin: 10px 0 6px; }
.title h2 { margin: 0; font-size: 15px; }
.title span { font-size: 10.5px; color: #6b7280; }
.rx { font-family: Georgia, serif; font-size: 30px; font-weight: bold; color: #0f766e; line-height: 1; }
.patient { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 12px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 6px; padding: 7px 9px; font-size: 11px; }
.patient b { color: #134e4a; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { background: #0f766e; color: #fff; font-weight: normal; font-size: 11px; padding: 5px; text-align: right; }
td { border-bottom: 1px solid #e5e7eb; padding: 6px 5px; vertical-align: top; font-size: 11.5px; }
td.n { width: 22px; color: #6b7280; }
td .drug { font-weight: bold; font-size: 12.5px; }
td .sub { color: #4b5563; font-size: 10.5px; margin-top: 2px; }
.notes { margin-top: 10px; border: 1px dashed #9ca3af; border-radius: 6px; padding: 6px 8px; font-size: 11px; }
.sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; }
.sign .doc { text-align: center; min-width: 170px; }
.sign .doc .line { border-top: 1px solid #374151; margin-top: 4px; padding-top: 3px; font-size: 11px; }
.sign img { max-height: 54px; max-width: 120px; object-fit: contain; }
.foot { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 5px; font-size: 9.5px; color: #6b7280; text-align: center; }
`;

/** يبني الوصفة مستندًا ويعرضها في نافذة المعاينة داخل النظام (ومنها تُطبع). */
export async function printPrescription(prescriptionId: string) {
  await previewReport("وصفة طبية", async () => {
    const { data, error } = await supabase
      .from("prescriptions")
      .select(
        "id, organization_id, branch_id, issued_at, created_at, notes, insurance_company_name, " +
          "patient:patients(name_ar, name_en, file_number, birth_date, gender, id_number, mobile_number), " +
          "doctor:doctors(name_ar, name_en, job_title, signature_url, stamp_url), clinic:clinics(name), " +
          "prescription_items(id, drug_name, dosage_instructions, frequency, duration_days, route, quantity_prescribed, created_at, " +
          "drug:items!prescription_items_drug_item_id_fkey(name_ar, name_en))",
      )
      .eq("id", prescriptionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("الوصفة غير موجودة");
    const rx = data as any;

    const [org, settings, branch] = await Promise.all([
      supabase.from("organizations").select("name, tax_number").eq("id", rx.organization_id).maybeSingle(),
      supabase
        .from("print_settings")
        .select("show_logo, logo_url, invoice_address_line, footer_note")
        .eq("organization_id", rx.organization_id)
        .maybeSingle(),
      rx.branch_id
        ? supabase.from("branches").select("name, phone, address, city").eq("id", rx.branch_id).maybeSingle()
        : supabase
            .from("branches")
            .select("name, phone, address, city")
            .eq("organization_id", rx.organization_id)
            .eq("is_main", true)
            .maybeSingle(),
    ]);

    const patient = one<any>(rx.patient) ?? {};
    const doctor = one<any>(rx.doctor) ?? {};
    const clinic = one<any>(rx.clinic);
    const s = (settings.data ?? {}) as any;
    const b = (branch.data ?? {}) as any;
    const orgName = (org.data as any)?.name ?? "";
    const logo = s.show_logo !== false ? s.logo_url || "/brand-logo.png" : null;
    const address = s.invoice_address_line || [b.address, b.city].filter(Boolean).join("، ");
    const issued = new Date(rx.issued_at ?? rx.created_at);
    const items = [...(rx.prescription_items ?? [])].sort((a: any, c: any) =>
      String(a.created_at ?? "").localeCompare(String(c.created_at ?? "")),
    );
    const gender = patient.gender === "female" ? "أنثى" : patient.gender === "male" ? "ذكر" : "";

    const rows = items
      .map((line: any, index: number) => {
        const drug = one<any>(line.drug);
        const name = drug?.name_ar ?? line.drug_name ?? "—";
        const sub = [
          line.frequency,
          line.duration_days ? `لمدّة ${line.duration_days} يوم` : null,
          line.route ? ROUTE_LABELS[line.route] ?? line.route : null,
          line.quantity_prescribed && Number(line.quantity_prescribed) !== 1 ? `الكمية ${line.quantity_prescribed}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          `<tr><td class="n">${index + 1}</td><td><div class="drug">${esc(name)}</div>` +
          (sub ? `<div class="sub">${esc(sub)}</div>` : "") +
          (line.dosage_instructions ? `<div class="sub">${esc(line.dosage_instructions)}</div>` : "") +
          `</td></tr>`
        );
      })
      .join("");

    const html =
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>وصفة طبية</title>` +
      `<style>${PRESCRIPTION_CSS}</style></head><body><div class="sheet">` +
      `<div class="head">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.style.display='none'"/>` : ""}` +
      `<div class="org"><h1>${esc(orgName)}</h1>` +
      (address ? `<p>${esc(address)}</p>` : "") +
      (b.phone ? `<p>هاتف: <span dir="ltr">${esc(b.phone)}</span></p>` : "") +
      `</div><div class="rx">℞</div></div>` +
      `<div class="title"><h2>وصفة طبية</h2><span>${esc(issued.toLocaleDateString("ar-SA-u-nu-latn"))} — ${esc(
        issued.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }),
      )}</span></div>` +
      `<div class="patient">` +
      `<div><b>المريض:</b> ${esc(patient.name_ar ?? "")}</div>` +
      `<div><b>رقم الملف:</b> ${esc(patient.file_number ?? "")}</div>` +
      `<div><b>العمر:</b> ${esc(ageText(patient.birth_date))}${gender ? ` · ${esc(gender)}` : ""}</div>` +
      (patient.id_number ? `<div><b>الهوية:</b> ${esc(patient.id_number)}</div>` : "") +
      `<div><b>الطبيب:</b> ${esc(doctor.name_ar ?? "")}</div>` +
      (clinic?.name ? `<div><b>العيادة:</b> ${esc(clinic.name)}</div>` : "") +
      (rx.insurance_company_name ? `<div><b>التأمين:</b> ${esc(rx.insurance_company_name)}</div>` : "") +
      `</div>` +
      `<table><thead><tr><th>#</th><th>الدواء وطريقة الاستعمال</th></tr></thead><tbody>${rows}</tbody></table>` +
      (rx.notes ? `<div class="notes"><b>ملاحظات:</b> ${esc(rx.notes)}</div>` : "") +
      `<div class="sign"><div>${doctor.stamp_url ? `<img src="${esc(doctor.stamp_url)}" alt=""/>` : ""}</div>` +
      `<div class="doc">${doctor.signature_url ? `<img src="${esc(doctor.signature_url)}" alt=""/>` : ""}` +
      `<div class="line">${esc(doctor.name_ar ?? "")}${doctor.job_title ? `<br/>${esc(doctor.job_title)}` : ""}</div></div></div>` +
      `<div class="foot">${esc(s.footer_note ?? orgName)}</div>` +
      `</div></body></html>`;

    return { title: `وصفة طبية — ${patient.name_ar ?? ""}`, html };
  });
}
