/**
 * بحث المرضى الموحَّد — بالاسم أو الجوال أو الهوية.
 *
 * **العيب الذي يعالجه:** كان لكل شاشة بحثُها الخاصّ، ولكلٍّ حقولٌ مختلفة.
 * `Patients` يبحث بالجوال والملفّ والهوية، و`PatientPicker` بالجوال والملفّ
 * بلا هوية، والبحث العامّ في الشريط العلويّ بـ`file_number` و`phone_1` وحدهما،
 * و`VitalSigns` و`RadiologyConsole` بالاسم والهوية بلا جوال. فالموظّف يكتب رقم
 * هوية في شاشةٍ فيجد المريض، ويكتبه في أخرى فلا يجده — فيظنّ أنّ الملفّ غير
 * موجود ويفتح ملفًّا ثانيًا لمريضٍ له ملفّ.
 *
 * هذا الملفّ هو التعريف الواحد: نطاقات البحث، وتطبيع الأرقام، وبناء مرشّح
 * PostgREST للاستعلامات الخادمية، ومطابقة محلّية للقوائم المحمَّلة في الذاكرة.
 * النتيجة نفسها في الشاشتين، لأنّ المنطق واحد لا منسوخ.
 */

export type PatientSearchScope = "name" | "mobile" | "id";

export const PATIENT_SEARCH_SCOPES: readonly PatientSearchScope[] = ["name", "mobile", "id"] as const;

export const patientScopeLabel: Record<PatientSearchScope, string> = {
  name: "الاسم",
  mobile: "الجوال",
  id: "الهوية",
};

/**
 * الأرقام العربية-الهندية (٠١٢) والفارسية (۰۱۲) تُحوَّل إلى لاتينية.
 *
 * لوحة المفاتيح العربية في ويندوز تُدخل ٠-٩ العربية-الهندية، والقاعدة تخزّن
 * لاتينية. بدون هذا التحويل يكتب الموظّف رقم الجوال بلوحته العربية فلا يجد
 * شيئًا — ولا رسالة خطأ تشرح له السبب.
 */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** الأرقام وحدها: يتخطّى المسافات والشرطات وبادئة +966 كما يكتبها الناس. */
export function digitsOnly(value: string): string {
  return toLatinDigits(value).replace(/\D+/g, "");
}

/**
 * تنظيف القيمة قبل وضعها في `or()`.
 *
 * PostgREST يفصل شروط `or()` بالفواصل ويحصرها بالأقواس، فاسمٌ فيه فاصلة أو
 * قوس يُنتج مرشّحًا مكسورًا يردّه الخادم بـ400 — والشاشة كانت تبتلع الخطأ
 * فيظهر «لا نتائج» بدل «الاسم فيه محرف غير مدعوم».
 */
function sanitizeForFilter(value: string): string {
  return value.replace(/[(),.*\\"']/g, " ").replace(/\s+/g, " ").trim();
}

export type PatientSearchColumns = {
  /** أعمدة الاسم — تُبحَث كلّها معًا */
  name: string[];
  /** أعمدة أرقام التواصل */
  mobile: string[];
  /** أعمدة الهوية */
  id: string[];
  /** رقم الملفّ: يدخل في البحث الشامل وحده، ومطابقةً تامّة لا جزئية */
  fileNumber?: string;
};

/** جدول `patients` كاملًا — لمن يقرأ الجدول مباشرة. */
export const PATIENTS_SEARCH_COLUMNS: PatientSearchColumns = {
  name: ["name_ar", "name_en"],
  mobile: ["mobile_number", "phone_1", "phone_2"],
  id: ["id_number"],
  fileNumber: "file_number",
};

/**
 * المنظور `v_patient_directory` — لا يعرض `phone_2`، ويُقنِّع `id_number`
 * و`phone_1` لمن لا يملك `patients.view_identity`. البحث بالهوية أو الجوال
 * لا يُطابق شيئًا عند هذا المستخدم، وهذا هو السلوك الصحيح: من لا يرى المعرّف
 * لا يستدلّ به على صاحبه.
 */
export const PATIENT_DIRECTORY_SEARCH_COLUMNS: PatientSearchColumns = {
  name: ["name_ar", "name_en"],
  mobile: ["mobile_number", "phone_1"],
  id: ["id_number"],
  fileNumber: "file_number",
};

/** لا نطاق مختار = الكلّ. هذا هو السلوك الافتراضيّ للأزرار الثلاثة. */
export function resolveScopes(scopes: PatientSearchScope[]): PatientSearchScope[] {
  return scopes.length > 0 ? scopes : [...PATIENT_SEARCH_SCOPES];
}

/**
 * مرشّح `or()` جاهز للتمرير إلى Supabase، أو `null` حين لا شيء يُبحَث به.
 *
 *     const filter = buildPatientSearchOr(term, scopes, PATIENTS_SEARCH_COLUMNS);
 *     if (filter) query = query.or(filter);
 */
export function buildPatientSearchOr(
  rawTerm: string,
  scopes: PatientSearchScope[],
  columns: PatientSearchColumns,
): string | null {
  const term = sanitizeForFilter(toLatinDigits(rawTerm));
  if (!term) return null;

  const active = resolveScopes(scopes);
  const digits = digitsOnly(term);
  const parts: string[] = [];

  if (active.includes("name")) {
    for (const column of columns.name) parts.push(`${column}.ilike.%${term}%`);
  }
  if (active.includes("mobile") && digits) {
    for (const column of columns.mobile) parts.push(`${column}.ilike.%${digits}%`);
  }
  // الهوية أرقامٌ فقط: البحث باسمٍ عربيّ لا يُطابق هويةً أبدًا، وإدخالُها في
  // المرشّح يُجبر القاعدة على حساب التقنيع لكلّ مريض (ثوانٍ لكلّ بحث، ومهلة
  // الاستعلام تُقطع — 0234). فلا يدخل عمود الهوية إلّا مع الأرقام.
  if (active.includes("id") && digits) {
    for (const column of columns.id) parts.push(`${column}.ilike.%${digits}%`);
  }
  // رقم الملفّ لا زرّ له؛ يدخل في البحث الشامل وحده وبمطابقة تامّة
  if (scopes.length === 0 && columns.fileNumber && digits && digits === term && digits.length <= 12) {
    parts.push(`${columns.fileNumber}.eq.${digits}`);
  }

  return parts.length > 0 ? parts.join(",") : null;
}

export type PatientSearchRow = {
  name_ar?: string | null;
  name_en?: string | null;
  mobile_number?: string | null;
  phone_1?: string | null;
  phone_2?: string | null;
  id_number?: string | null;
  file_number?: number | string | null;
};

/**
 * المطابقة نفسها للقوائم المحمَّلة في الذاكرة (شاشة المواعيد ترشّح محلّيًّا).
 * تُبقي السلوك واحدًا: ما يجده البحث الخادميّ يجده المحلّيّ.
 */
export function matchesPatientSearch(
  row: PatientSearchRow | null | undefined,
  rawTerm: string,
  scopes: PatientSearchScope[],
): boolean {
  const term = toLatinDigits(rawTerm).trim();
  if (!term) return true;
  if (!row) return false;

  const active = resolveScopes(scopes);
  const digits = digitsOnly(term);
  const lower = term.toLowerCase();
  const text = (value: unknown) => String(value ?? "").toLowerCase();

  if (active.includes("name") && (text(row.name_ar).includes(lower) || text(row.name_en).includes(lower))) {
    return true;
  }
  if (active.includes("mobile") && digits) {
    const phones = [row.mobile_number, row.phone_1, row.phone_2];
    if (phones.some((phone) => digitsOnly(String(phone ?? "")).includes(digits))) return true;
  }
  if (active.includes("id")) {
    const value = digits || lower;
    if (text(row.id_number).replace(/\s+/g, "").includes(value)) return true;
  }
  if (scopes.length === 0 && digits && String(row.file_number ?? "") === digits) return true;

  return false;
}

/** نصّ إرشاديّ يتبع النطاقات المختارة، فلا يَعِد الحقل بما لا يبحث فيه. */
export function patientSearchPlaceholder(scopes: PatientSearchScope[]): string {
  if (scopes.length === 0) return "بحث بالاسم أو الجوال أو الهوية أو رقم الملفّ";
  return `بحث بـ${scopes.map((scope) => patientScopeLabel[scope]).join(" أو ")}`;
}
