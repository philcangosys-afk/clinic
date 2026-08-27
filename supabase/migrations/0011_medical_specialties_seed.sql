-- ============================================================================
-- 0011_medical_specialties_seed.sql
-- المرحلة 3 (تابع) — إصلاح فجوة: لا توجد لائحة "تخصصات طبية" فعلية حتى الآن
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0010 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- الفجوة المكتشفة أثناء بناء شاشة "الأطباء" في المرحلة 3.3 (الواجهات):
-- كل من doctors.specialty_value_id و appointment_waitlist.specialty_value_id
-- و consultation_fee_rules.specialty_value_id (من 0002/0004) تشير إلى
-- lookup_values منذ البداية، لكن لم يسبق لأي ملف ترحيل أن زرع فعليًا لائحة
-- "التخصصات الطبية" — القيم الوحيدة الموجودة كانت أكواد نصية حرة داخل
-- clinic_exam_templates.specialty_code (20 تخصصًا، من 0006) بلا أي جدول لائحة
-- فعلي يمكن للواجهة الاختيار منه عند إنشاء ملف طبيب.
--
-- هذا الملف يسدّ الفجوة بزرع نفس 20 التخصص كقيم لائحة حقيقية (lookup_values)
-- تحت مفتاح جديد 'medical_specialties'، مع تخزين specialty_code نفسه داخل
-- عمود extra (jsonb) الموجود أصلًا في lookup_values منذ 0001 — هذا يتيح للواجهة
-- أن تربط مباشرة بين تخصص الطبيب المختار وقالب الفحص الديناميكي المطابق له
-- (clinic_exam_templates) دون أي جدول ربط إضافي.
-- ============================================================================

insert into lookup_categories (organization_id, key, name_ar, name_en) values
  (null, 'medical_specialties', 'التخصصات الطبية', 'Medical Specialties')
on conflict (key) where organization_id is null do nothing;

insert into lookup_values (category_id, name_ar, name_en, sort_order, extra)
select c.id, v.name_ar, v.name_en, v.sort_order, jsonb_build_object('specialty_code', v.specialty_code)
from lookup_categories c
cross join (values
  ('الجلدية', 'Dermatology', 10, 'derma'),
  ('الطبيب العام', 'General Practitioner', 20, 'gp'),
  ('الباطنية', 'Internal Medicine', 30, 'internal'),
  ('الطوارئ', 'Emergency', 40, 'emergency'),
  ('النساء والولادة', 'Gynecology', 50, 'gynecology'),
  ('الأطفال', 'Pediatrician', 60, 'pediatrician'),
  ('العلاج الطبيعي', 'Physical Therapy', 70, 'physical_therapy'),
  ('المسالك البولية', 'Urologist', 80, 'urologist'),
  ('الأشعة', 'X-Ray', 90, 'xray'),
  ('الأسنان البسيطة', 'Simple Dental', 100, 'simple_dental'),
  ('السكر والغدد', 'Sugar & Endocrine', 110, 'endocrine'),
  ('الأنف والأذن والحنجرة', 'Ear Nose Throat', 120, 'ent'),
  ('العظمية', 'Orthopedic', 130, 'orthopedic'),
  ('الجهاز الهضمي', 'Digestive', 140, 'digestive'),
  ('التغذية', 'Nutrition', 150, 'nutrition'),
  ('المخ والأعصاب', 'Neurosurgery', 160, 'neurosurgery'),
  ('الصدرية', 'Respiratory', 170, 'respiratory'),
  ('الطب النفسي', 'Psychiatry', 180, 'psychiatry'),
  ('أمراض الكلى', 'Kidney Disease', 190, 'kidney'),
  ('العيون', 'Ophthalmologist', 200, 'ophthalmologist')
) as v(name_ar, name_en, sort_order, specialty_code)
where c.key = 'medical_specialties' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- ============================================================================
-- نهاية 0011_medical_specialties_seed.sql
-- ============================================================================
