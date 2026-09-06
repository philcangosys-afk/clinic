/**
 * تسميات عربية مناسبة لحقول قالب الفحص الافتراضي (schema_definition من 0006) —
 * القوالب تخزّن فقط مفاتيح الحقول (مثل heart_rate، chest) بلا تسمية عرض جاهزة،
 * فهذه الخريطة تترجمها لواجهة قابلة للقراءة بدل عرض المفتاح الخام للمستخدم.
 */
export const EXAM_FIELD_LABELS: Record<string, string> = {
  heart_rate: "معدل النبض",
  blood_pressure: "ضغط الدم",
  temperature: "الحرارة",
  glucose_level: "السكر",
  height: "الطول (سم)",
  weight: "الوزن (كجم)",
  bmi: "مؤشر كتلة الجسم",
  respiratory_rate: "معدل التنفس",
  head_neck: "الرأس والرقبة",
  chest: "الصدر",
  abdomen: "البطن",
  upper_limbs: "الأطراف العلوية",
  lower_limbs: "الأطراف السفلية",
  reflection: "المنعكسات",
  heart: "القلب",
  nervous_system: "الجهاز العصبي",
  free_exam: "فحص حر",
  vision_test: "فحص النظر",
  hearing_test: "فحص السمع",
  musculoskeletal: "الجهاز العضلي الهيكلي",
};

export function examFieldLabel(key: string) {
  return EXAM_FIELD_LABELS[key] ?? key;
}

/** خيار واحد لحقل قائمة — كما يبنيه `app_rebuild_exam_schema` من `exam_field_options`. */
export type ExamFieldOptionDef = { value?: unknown; label_ar?: unknown };

/** شرط الإظهار — `{ field: مفتاح الحقل الآخر, value: القيمة المطلوبة }`. */
export type ExamFieldVisibleWhenDef = { field?: unknown; value?: unknown };

/**
 * حقل المجموعة في `schema_definition` — **شكلان لا شكل واحد**:
 *
 * - نصّ (`"heart_rate"`): القوالب النظامية المزروعة في الهجرات تحفظ المفاتيح
 *   نصوصًا بلا تسمية ولا نوع، والتسمية تُستخرج من `EXAM_FIELD_LABELS`.
 * - كائن: `app_rebuild_exam_schema` — أي كل قالب مبنيّ من شاشة النماذج — يُخرج
 *   `{key, label_ar, type, unit, required, options, visible_when}`.
 *
 * كان النوع `string[]` فقط، فمرّ الكائن إلى `<Label>{…}</Label>` وإلى مفتاح
 * `fieldValues[…]`: React ترفض الكائن كابن («Objects are not valid as a React
 * child») فتنكسر نافذة الزيارة كلها، والقيم تُخزَّن تحت المفتاح
 * `"[object Object]"` فتضيع. الشاشة يجب أن تقرأ الشكلين لأن القوالب النظامية
 * والمخصَّصة تعيشان معًا في القاعدة نفسها.
 */
export type ExamTemplateFieldDef = string | ({ key?: unknown; label_ar?: unknown; type?: unknown; unit?: unknown; required?: unknown; options?: unknown; visible_when?: unknown });

/** الشكل الموحَّد الذي تتعامل معه الواجهة بعد التطبيع. */
export type NormalizedExamField = {
  key: string;
  label_ar: string;
  type: string;
  unit?: string;
  required?: boolean;
  options?: { value: string; label_ar: string }[];
  visible_when?: { field: string; value: string | null };
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

/**
 * يوحّد حقل المجموعة — نصًّا كان أو كائنًا — إلى `NormalizedExamField`.
 *
 * دائمًا يعيد كائنًا (لا يرفع ولا يعيد `null`) حتى لا يحتاج كل موضع عرض إلى
 * فحص الشكل بنفسه؛ والحقل بلا مفتاح يُستبعَد في `normalizeExamFields` لأن
 * المفتاح هو ما تُخزَّن به الإجابة وتُقرأ به لاحقًا.
 */
export function normalizeExamField(raw: ExamTemplateFieldDef): NormalizedExamField {
  if (typeof raw === "string") {
    const key = raw.trim();
    return { key, label_ar: examFieldLabel(key), type: "text" };
  }

  const source = (raw ?? {}) as Record<string, unknown>;
  const key = text(source.key);
  const label = text(source.label_ar);
  const unit = text(source.unit);
  const type = text(source.type);

  const rawOptions = Array.isArray(source.options) ? (source.options as ExamFieldOptionDef[]) : [];
  const options = rawOptions
    .filter((option) => option && text(option.value) !== "")
    .map((option) => ({ value: text(option.value), label_ar: text(option.label_ar) || text(option.value) }));

  const visibleWhenRaw = (source.visible_when ?? null) as ExamFieldVisibleWhenDef | null;
  const visibleWhenField = visibleWhenRaw && typeof visibleWhenRaw === "object" ? text(visibleWhenRaw.field) : "";

  const normalized: NormalizedExamField = {
    key,
    // التسمية العربية أولًا، ثم خريطة التسميات القديمة، ثم المفتاح الخام كملاذ
    // أخير — فلا يُعرض للطبيب حقلٌ بلا عنوان.
    label_ar: label || examFieldLabel(key),
    type: type || "text",
  };
  if (unit) normalized.unit = unit;
  if (source.required === true) normalized.required = true;
  if (options.length > 0) normalized.options = options;
  if (visibleWhenField) {
    normalized.visible_when = {
      field: visibleWhenField,
      value: visibleWhenRaw?.value === null || visibleWhenRaw?.value === undefined ? null : text(visibleWhenRaw.value),
    };
  }
  return normalized;
}

/** يطبّع قائمة حقول قسم ويستبعد ما لا مفتاح له (لا يُخزَّن ولا يُقرأ). */
export function normalizeExamFields(fields: ExamTemplateFieldDef[] | null | undefined): NormalizedExamField[] {
  return (fields ?? []).map((field) => normalizeExamField(field)).filter((field) => field.key !== "");
}

export type ExamTemplateSectionType = "group" | "text" | "textarea" | "diagnosis";

/**
 * قسم في المخطط. `fields` اختياريّ لأن `app_rebuild_exam_schema` لا يُخرجه
 * للأقسام غير المجموعة (نصّ/نصّ طويل/تشخيص).
 */
export type ExamTemplateSection = {
  key: string;
  label_ar: string;
  type: ExamTemplateSectionType;
  fields?: ExamTemplateFieldDef[];
};

export type ExamTemplateSchema = { sections?: ExamTemplateSection[] };
