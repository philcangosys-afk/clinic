/**
 * استبدال العناصر النائبة (placeholders) من نوع {{patient.name_ar}} داخل
 * نص قالب المستند (HTML) ببيانات فعلية — يُستخدم في شاشة "قوالب المستندات"
 * عند توليد مستند من قالب. البادئات المعروفة (patient/employee/organization/date)
 * تُستبدل من بيانات النظام تلقائيًا، وأي عنصر آخر (مثل {{الرقم المرجعي}})
 * يُعتبر "حقلًا حرًّا" يملؤه المستخدم يدويًا عند التوليد.
 */

import type { OccupationalExamPurpose, OccupationalFitnessStatus } from "@/lib/database.types";

export const KNOWN_TOKEN_PREFIXES = ["patient", "employee", "organization", "date", "exam"] as const;

const EXAM_PURPOSE_LABELS: Record<OccupationalExamPurpose, string> = {
  pre_employment: "ما قبل التوظيف",
  periodic: "دوري",
  return_to_work: "العودة للعمل",
  exit: "مغادرة العمل",
};
const FITNESS_STATUS_LABELS: Record<OccupationalFitnessStatus, string> = {
  fit: "لائق",
  fit_with_restrictions: "لائق بقيود",
  unfit: "غير لائق",
  pending: "قيد المراجعة",
};

const TOKEN_REGEX = /\{\{([^{}]+)\}\}/g;

/** يستخرج كل العناصر النائبة الفريدة الموجودة داخل نص القالب (بدون الأقواس). */
export function extractTemplateTokens(bodyHtml: string): string[] {
  const tokens = new Set<string>();
  for (const match of bodyHtml.matchAll(TOKEN_REGEX)) {
    const token = match[1].trim();
    if (token) tokens.add(token);
  }
  return Array.from(tokens);
}

export function isKnownToken(token: string): boolean {
  const prefix = token.split(".")[0];
  return (KNOWN_TOKEN_PREFIXES as readonly string[]).includes(prefix);
}

/** العناصر النائبة "الحرة" التي لا تطابق أي بادئة معروفة — تحتاج قيمة يدوية من المستخدم عند التوليد. */
export function extractCustomTokens(bodyHtml: string): string[] {
  return extractTemplateTokens(bodyHtml).filter((token) => !isKnownToken(token));
}

type MergeContextInput = {
  patient?: {
    name_ar?: string | null;
    name_en?: string | null;
    id_number?: string | null;
    mobile_number?: string | null;
    file_number?: number | string | null;
  } | null;
  employee?: {
    name_ar?: string | null;
    name_en?: string | null;
    national_id?: string | null;
    mobile_1?: string | null;
    file_number?: number | string | null;
    hire_date?: string | null;
  } | null;
  organization?: {
    name?: string | null;
    tax_number?: string | null;
  } | null;
  exam?: {
    exam_purpose?: OccupationalExamPurpose | null;
    fitness_status?: OccupationalFitnessStatus | null;
    employer_name?: string | null;
    restrictions_note?: string | null;
    certificate_number?: string | null;
    exam_date?: string | null;
    next_exam_due_date?: string | null;
    doctor_name?: string | null;
  } | null;
  custom?: Record<string, string>;
};

/** يبني خريطة مسطّحة (token -> قيمة نصية) من بيانات المريض/الموظف/المؤسسة الحالية. */
export function buildMergeContext({ patient, employee, organization, exam, custom }: MergeContextInput): Record<string, string> {
  const context: Record<string, string> = {
    "date.today": new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }),
    "organization.name": organization?.name ?? "",
    "organization.tax_number": organization?.tax_number ?? "",
  };
  if (patient) {
    context["patient.name_ar"] = patient.name_ar ?? "";
    context["patient.name_en"] = patient.name_en ?? "";
    context["patient.id_number"] = patient.id_number ?? "";
    context["patient.mobile_number"] = patient.mobile_number ?? "";
    context["patient.file_number"] = patient.file_number != null ? String(patient.file_number) : "";
  }
  if (employee) {
    context["employee.name_ar"] = employee.name_ar ?? "";
    context["employee.name_en"] = employee.name_en ?? "";
    context["employee.national_id"] = employee.national_id ?? "";
    context["employee.mobile_1"] = employee.mobile_1 ?? "";
    context["employee.file_number"] = employee.file_number != null ? String(employee.file_number) : "";
    context["employee.hire_date"] = employee.hire_date
      ? new Date(employee.hire_date).toLocaleDateString("ar-SA")
      : "";
  }
  if (exam) {
    context["exam.exam_purpose"] = exam.exam_purpose ? EXAM_PURPOSE_LABELS[exam.exam_purpose] : "";
    context["exam.fitness_status"] = exam.fitness_status ? FITNESS_STATUS_LABELS[exam.fitness_status] : "";
    context["exam.employer_name"] = exam.employer_name ?? "";
    context["exam.restrictions_note"] = exam.restrictions_note ?? "";
    context["exam.certificate_number"] = exam.certificate_number ?? "";
    context["exam.exam_date"] = exam.exam_date ? new Date(exam.exam_date).toLocaleDateString("ar-SA") : "";
    context["exam.next_exam_due_date"] = exam.next_exam_due_date
      ? new Date(exam.next_exam_due_date).toLocaleDateString("ar-SA")
      : "";
    context["exam.doctor_name"] = exam.doctor_name ? `د. ${exam.doctor_name}` : "";
  }
  return { ...context, ...(custom ?? {}) };
}

/** يستبدل كل العناصر النائبة الموجودة بالقيم المُعطاة؛ أي عنصر بلا قيمة يبقى ظاهرًا كما هو لتنبيه المستخدم. */
export function mergeTemplate(bodyHtml: string, context: Record<string, string>): string {
  return bodyHtml.replace(TOKEN_REGEX, (full, rawToken) => {
    const token = rawToken.trim();
    return token in context ? context[token] : full;
  });
}

/** يفتح نافذة جديدة بمحتوى HTML جاهز للطباعة — يُستخدم من أي شاشة تولّد مستندًا من قالب (قوالب المستندات، شهادة اللياقة من التقارير...). */
export function printHtml(title: string, bodyHtml: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${title}</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;line-height:1.8;}</style>
    </head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
