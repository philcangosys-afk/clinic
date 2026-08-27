-- ============================================================================
-- 0012_professions_seed.sql
-- المرحلة 3 (تابع) — إصلاح فجوة ثانية: لا توجد لائحة "المهن" فعلية حتى الآن
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0011 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- الفجوة المكتشفة أثناء بناء شاشة "الموظفون" في المرحلة 3.5 (الواجهات):
-- كل من patients.profession_value_id (من 0002) و employees.profession_value_id
-- (من 0008) يشيران إلى lookup_values منذ البداية، لكن — تمامًا كما حدث مع
-- التخصصات الطبية في 0011 — لم يسبق لأي ملف ترحيل أن زرع لائحة "المهن" فعليًا.
-- هذا الملف يسدّ الفجوة بلائحة مهن عامة شائعة (قابلة للتوسعة من كل مؤسسة
-- بإضافة قيمها الخاصة بنفس مفتاح الفئة 'professions').
-- ============================================================================

insert into lookup_categories (organization_id, key, name_ar, name_en) values
  (null, 'professions', 'المهن', 'Professions')
on conflict (key) where organization_id is null do nothing;

insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('موظف حكومي', 'Government Employee', 10),
  ('موظف قطاع خاص', 'Private Sector Employee', 20),
  ('طبيب', 'Physician', 30),
  ('ممرض/ممرضة', 'Nurse', 40),
  ('فني', 'Technician', 50),
  ('مدرّس/أستاذ', 'Teacher', 60),
  ('مهندس', 'Engineer', 70),
  ('محاسب', 'Accountant', 80),
  ('محامي', 'Lawyer', 90),
  ('رجل/سيدة أعمال', 'Business Owner', 100),
  ('عسكري', 'Military', 110),
  ('متقاعد', 'Retired', 120),
  ('طالب/طالبة', 'Student', 130),
  ('ربة منزل', 'Homemaker', 140),
  ('عامل حر', 'Freelancer', 150),
  ('بلا عمل', 'Unemployed', 160),
  ('أخرى', 'Other', 170)
) as v(name_ar, name_en, sort_order)
where c.key = 'professions' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- ============================================================================
-- نهاية 0012_professions_seed.sql
-- ============================================================================
