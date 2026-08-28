/**
 * تعريفات نماذج CBAHI (الجودة وسلامة المريض) — لقطة 119.
 *
 * جدول `cbahi_forms` (0006) عام: `form_type` نصّي و`form_data` jsonb. تركُه
 * نموذجًا حرًّا تمامًا كان سيجعله بلا فائدة — قوة هذه النماذج أن الدرجة
 * تُحتسب وتقود إلى تدخّل وقائي، لا أن تُكتب أرقام في حقول حرة.
 *
 * لذلك التعريفات هنا في الكود لا في القاعدة: هي مقاييس منشورة ثابتة، وتغييرها
 * لكل منشأة يفقدها معناها ويجعل مقارنة النتائج بين المنشآت بلا أساس.
 *
 * ⚠️ الدرجات والحدود أدناه تتبع المقاييس المنشورة المعروفة. تبقى **إعدادات
 * المنشأة وسياستها هي المرجع**: على لجنة الجودة اعتماد الحدود قبل التشغيل،
 * فبعض المنشآت تعتمد حدودًا أشد حسب نوع المرضى لديها.
 */

export type CbahiFieldOption = { label: string; score: number };

export type CbahiField = {
  key: string;
  label: string;
  /** خيارات مُسجَّلة بدرجات — أساس المقاييس المعيارية */
  options?: CbahiFieldOption[];
  /** حقل نصّي حر (ملاحظة، إجراء متَّخذ) */
  freeText?: boolean;
  /** رقم مباشر بمدى محدَّد (مقياس الألم مثلًا) */
  numeric?: { min: number; max: number };
};

export type CbahiBand = { max: number; label: string; tone: "success" | "warning" | "destructive" };

export type CbahiFormDefinition = {
  type: string;
  title: string;
  /** اسم المقياس المنشور الذي يتبعه النموذج — يُعرض للمستخدم بوضوح */
  instrument: string;
  description: string;
  fields: CbahiField[];
  /** الحدود مرتَّبة تصاعديًا بالدرجة؛ يُختار أول نطاق يشمل الدرجة */
  bands?: CbahiBand[];
  /** في بعض المقاييس الدرجة الأقل تعني خطرًا أعلى (برادن) */
  lowerIsWorse?: boolean;
};

const YES_NO = (yes: number): CbahiFieldOption[] => [
  { label: "لا", score: 0 },
  { label: "نعم", score: yes },
];

export const CBAHI_FORMS: CbahiFormDefinition[] = [
  {
    type: "fall_risk",
    title: "تقييم خطر السقوط",
    instrument: "مقياس مورس للسقوط (Morse Fall Scale)",
    description: "يُعاد التقييم عند تغيّر حالة المريض أو دوائه أو بعد أي سقوط",
    fields: [
      { key: "history_falling", label: "سقوط سابق خلال 3 أشهر", options: YES_NO(25) },
      { key: "secondary_diagnosis", label: "أكثر من تشخيص طبي", options: YES_NO(15) },
      {
        key: "ambulatory_aid",
        label: "وسيلة المساعدة على المشي",
        options: [
          { label: "لا شيء / طريح الفراش / مساعدة ممرض", score: 0 },
          { label: "عكّاز / مشّاية", score: 15 },
          { label: "يتّكئ على الأثاث", score: 30 },
        ],
      },
      { key: "iv_access", label: "قسطرة وريدية أو محبس هيبارين", options: YES_NO(20) },
      {
        key: "gait",
        label: "المشية",
        options: [
          { label: "طبيعية / طريح الفراش / كرسي متحرك", score: 0 },
          { label: "ضعيفة", score: 10 },
          { label: "مختلّة", score: 20 },
        ],
      },
      {
        key: "mental_status",
        label: "الوعي بقدراته الحركية",
        options: [
          { label: "مدرك لحدوده", score: 0 },
          { label: "يبالغ في تقدير قدرته / ينسى حدوده", score: 15 },
        ],
      },
      { key: "interventions", label: "الإجراءات الوقائية المتَّخذة", freeText: true },
    ],
    bands: [
      { max: 24, label: "خطر منخفض", tone: "success" },
      { max: 44, label: "خطر متوسط", tone: "warning" },
      { max: Number.POSITIVE_INFINITY, label: "خطر مرتفع — يستدعي خطة وقاية", tone: "destructive" },
    ],
  },
  {
    type: "pain_assessment",
    title: "تقييم الألم",
    instrument: "المقياس العددي للألم (NRS 0–10)",
    description: "يُعاد التقييم بعد كل تدخّل مسكّن للتحقق من الاستجابة",
    fields: [
      { key: "score", label: "شدة الألم (0 = لا ألم، 10 = أشد ألم)", numeric: { min: 0, max: 10 } },
      { key: "site", label: "موضع الألم", freeText: true },
      { key: "character", label: "وصف الألم (حارق، نابض، واخز...)", freeText: true },
      { key: "intervention", label: "التدخّل المتَّخذ", freeText: true },
    ],
    bands: [
      { max: 3, label: "ألم خفيف", tone: "success" },
      { max: 6, label: "ألم متوسط", tone: "warning" },
      { max: Number.POSITIVE_INFINITY, label: "ألم شديد — يستدعي تدخّلًا", tone: "destructive" },
    ],
  },
  {
    type: "pressure_ulcer_risk",
    title: "تقييم خطر قرحة الفراش",
    instrument: "مقياس برادن (Braden Scale)",
    description: "الدرجة الأقل تعني خطرًا أعلى — عكس مقياس السقوط",
    lowerIsWorse: true,
    fields: [
      {
        key: "sensory",
        label: "الإحساس",
        options: [
          { label: "محدود تمامًا", score: 1 },
          { label: "محدود جدًا", score: 2 },
          { label: "محدود قليلًا", score: 3 },
          { label: "غير محدود", score: 4 },
        ],
      },
      {
        key: "moisture",
        label: "الرطوبة",
        options: [
          { label: "رطب دائمًا", score: 1 },
          { label: "رطب غالبًا", score: 2 },
          { label: "رطب أحيانًا", score: 3 },
          { label: "نادرًا ما يكون رطبًا", score: 4 },
        ],
      },
      {
        key: "activity",
        label: "النشاط",
        options: [
          { label: "طريح الفراش", score: 1 },
          { label: "مقيَّد بالكرسي", score: 2 },
          { label: "يمشي أحيانًا", score: 3 },
          { label: "يمشي كثيرًا", score: 4 },
        ],
      },
      {
        key: "mobility",
        label: "الحركة",
        options: [
          { label: "بلا حركة", score: 1 },
          { label: "محدودة جدًا", score: 2 },
          { label: "محدودة قليلًا", score: 3 },
          { label: "غير محدودة", score: 4 },
        ],
      },
      {
        key: "nutrition",
        label: "التغذية",
        options: [
          { label: "سيئة جدًا", score: 1 },
          { label: "غير كافية", score: 2 },
          { label: "كافية", score: 3 },
          { label: "ممتازة", score: 4 },
        ],
      },
      {
        key: "friction",
        label: "الاحتكاك والانزلاق",
        options: [
          { label: "مشكلة قائمة", score: 1 },
          { label: "مشكلة محتملة", score: 2 },
          { label: "بلا مشكلة ظاهرة", score: 3 },
        ],
      },
      { key: "interventions", label: "الإجراءات الوقائية المتَّخذة", freeText: true },
    ],
    bands: [
      { max: 9, label: "خطر شديد جدًا", tone: "destructive" },
      { max: 12, label: "خطر مرتفع", tone: "destructive" },
      { max: 14, label: "خطر متوسط", tone: "warning" },
      { max: 18, label: "خطر خفيف", tone: "warning" },
      { max: Number.POSITIVE_INFINITY, label: "بلا خطر يُذكر", tone: "success" },
    ],
  },
  {
    type: "patient_education",
    title: "تثقيف المريض وأسرته",
    instrument: "سجل التثقيف الصحي",
    description: "توثيق ما شُرح للمريض ومدى استيعابه — متطلب اعتماد أساسي",
    fields: [
      { key: "topics", label: "المواضيع التي شُرحت", freeText: true },
      {
        key: "method",
        label: "أسلوب التثقيف",
        options: [
          { label: "شفهي", score: 0 },
          { label: "مطبوعات", score: 0 },
          { label: "عملي/تطبيقي", score: 0 },
        ],
      },
      {
        key: "comprehension",
        label: "مستوى الاستيعاب",
        options: [
          { label: "استوعب كاملًا", score: 0 },
          { label: "يحتاج إعادة شرح", score: 0 },
          { label: "لم يستوعب — يحتاج متابعة", score: 0 },
        ],
      },
      { key: "educated_person", label: "من تلقّى التثقيف (المريض/المرافق)", freeText: true },
      { key: "notes", label: "ملاحظات", freeText: true },
    ],
  },
];

export const CBAHI_STATUS_LABELS: Record<string, string> = {
  draft: "مسوّدة",
  completed: "مكتملة",
  reviewed: "مُراجَعة",
};

export function getFormDefinition(type: string) {
  return CBAHI_FORMS.find((form) => form.type === type);
}

/**
 * يحسب الدرجة الكلية من قيم الحقول.
 *
 * يعيد `null` إن لم يكن للنموذج أي حقل مُسجَّل بدرجات (نموذج التثقيف مثلًا
 * توثيقي لا تقييمي) — فعرض "الدرجة: 0" لنموذج بلا مقياس يوحي بنتيجة لا وجود لها.
 */
export function computeScore(
  definition: CbahiFormDefinition,
  values: Record<string, string>,
): number | null {
  const scored = definition.fields.filter((field) => field.options || field.numeric);
  if (scored.length === 0) return null;
  // نموذج التثقيف: خياراته كلها بدرجة صفر — لا معنى لدرجة كلية فيه
  const hasRealScores = definition.fields.some(
    (field) => field.numeric || (field.options ?? []).some((option) => option.score !== 0),
  );
  if (!hasRealScores) return null;

  let total = 0;
  for (const field of scored) {
    const raw = values[field.key];
    if (raw === undefined || raw === "") continue;
    if (field.numeric) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) total += parsed;
      continue;
    }
    const option = (field.options ?? []).find((candidate) => candidate.label === raw);
    if (option) total += option.score;
  }
  return total;
}

/** يعيد النطاق الذي تقع فيه الدرجة، أو `null` إن لم يكن للنموذج نطاقات. */
export function resolveBand(definition: CbahiFormDefinition, score: number | null) {
  if (score == null || !definition.bands) return null;
  return definition.bands.find((band) => score <= band.max) ?? null;
}

/** هل أُجيب عن كل الحقول المُسجَّلة بدرجات؟ الدرجة الجزئية مضلِّلة. */
export function isScoreComplete(definition: CbahiFormDefinition, values: Record<string, string>) {
  return definition.fields
    .filter((field) => field.options || field.numeric)
    .every((field) => (values[field.key] ?? "") !== "");
}
