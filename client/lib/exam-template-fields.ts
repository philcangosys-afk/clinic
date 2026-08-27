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

export type ExamTemplateSection =
  | { key: string; label_ar: string; type: "text" }
  | { key: string; label_ar: string; type: "textarea" }
  | { key: string; label_ar: string; type: "diagnosis" }
  | { key: string; label_ar: string; type: "group"; fields: string[] };

export type ExamTemplateSchema = { sections: ExamTemplateSection[] };
