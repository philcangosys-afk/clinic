-- ============================================================================
-- 0006_dynamic_exam_builder.sql
-- المرحلة 2 (تابع) — الفحص الطبي الديناميكي (تصميم العيادات) + ملحقات الملف الطبي
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0005 مباشرة (يعتمد عليها جميعًا)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) أكواد ICD10 (مرجع عالمي عام) + ربطها بتشخيصات الزيارات
--   2) قوالب الفحص الديناميكي لكل تخصص (clinic_exam_templates) — JSON Schema
--      قابل للتخصيص من لوحة الإدارة بدل صفحات ثابتة مبرمجة لكل تخصص (لقطة 15)
--   3) زيارات المريض العامة (patient_visits) بحقل exam_data JSONB مرن + canvas_type
--   4) لوحة الأسنان التفاعلية (dental_chart_entries) بترقيم FDI (لقطة 116)
--   5) مخطط الجسم التفاعلي للجلدية (body_diagram_annotations) (لقطة 117)
--   6) المؤشرات الحيوية المهيكلة (patient_vital_signs) — تُغذّي "مخططات النمو"
--   7) نماذج CBAHI (لقطة 119)
--   8) مستندات/صور ملف المريض (patient_documents) — كانت ثغرة موثّقة منذ 0002
--      (مذكورة في المراجعة، لكن لم يُبنَ لها جدول بعد)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أكواد ICD10 — مرجع عالمي عام (بلا organization_id، معيار WHO موحّد للجميع)
-- ---------------------------------------------------------------------------
create table if not exists icd10_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  diagnosis_group text,        -- مثال: Dental
  name_en text not null,
  name_ar text,
  is_disabled boolean not null default false
);
create index if not exists idx_icd10_group on icd10_codes (diagnosis_group);

-- ---------------------------------------------------------------------------
-- 2) قوالب الفحص الديناميكي لكل تخصص (لقطة 15)
-- ---------------------------------------------------------------------------
create table if not exists clinic_exam_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = قالب افتراضي عام قابل للنسخ من كل مؤسسة
  specialty_code text not null,          -- كود القسم (مثال: derma, gp, simple_dental)
  name_ar text not null,
  name_en text,
  note text,
  canvas_type text not null default 'none' check (canvas_type in ('dental_chart','body_diagram','none')),
  schema_definition jsonb not null default '{}'::jsonb,   -- تعريف الأقسام/الحقول القابلة للتخصيص
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, specialty_code)
);
create index if not exists idx_exam_templates_org on clinic_exam_templates (organization_id);

-- ---------------------------------------------------------------------------
-- 3) زيارات المريض العامة — نفس البنية الأساسية لكل التخصصات:
--    شكوى ← فحص (exam_data JSONB حسب قالب التخصص) ← تشخيص(ICD10) ← ملاحظات ← متابعة
-- ---------------------------------------------------------------------------
create table if not exists patient_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  template_id uuid references clinic_exam_templates(id) on delete set null,
  canvas_type text not null default 'none' check (canvas_type in ('dental_chart','body_diagram','none')),  -- لقطة عند وقت الزيارة (لا يتأثر بتعديل القالب لاحقًا)
  visit_date timestamptz not null default now(),
  main_complaint text,
  exam_data jsonb not null default '{}'::jsonb,     -- المؤشرات الحيوية + فحص الأجهزة + أي حقول مخصصة حسب القالب
  notes text,
  next_visit_plan text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_patient_visits_patient on patient_visits (patient_id, visit_date desc);
create index if not exists idx_patient_visits_org on patient_visits (organization_id, visit_date desc);

-- تشخيصات الزيارة (مرتبطة بـICD10) — علاقة عديد إلى عديد
create table if not exists patient_visit_diagnoses (
  visit_id uuid not null references patient_visits(id) on delete cascade,
  icd10_code_id uuid not null references icd10_codes(id) on delete restrict,
  note text,
  primary key (visit_id, icd10_code_id)
);

-- ---------------------------------------------------------------------------
-- 4) لوحة الأسنان التفاعلية (لقطة 116) — ترقيم FDI، قد يشمل السجل أكثر من سن
--    (مثال: قوس كامل / تقويم علوي وسفلي)
-- ---------------------------------------------------------------------------
create table if not exists dental_chart_entries (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references patient_visits(id) on delete cascade,
  tooth_numbers text[] not null default '{}',     -- ترقيم FDI (18-28، 48-38 ...)
  tooth_type text not null default 'permanent' check (tooth_type in ('permanent','primary')),
  main_complaint text,
  procedure_done text,
  diagnosis_icd10_id uuid references icd10_codes(id) on delete set null,
  complications text,
  anesthesia text,
  prophylactic_antibiotics text,
  patient_family_education text,
  is_xray boolean not null default false,
  ortho_upper boolean not null default false,
  ortho_lower boolean not null default false,
  full_arch boolean not null default false,
  next_visit_plan text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dental_chart_visit on dental_chart_entries (visit_id);
create index if not exists idx_dental_chart_teeth on dental_chart_entries using gin (tooth_numbers);

-- ---------------------------------------------------------------------------
-- 5) مخطط الجسم التفاعلي للجلدية (لقطة 117) — رسم حر (نقاط/مسارات/لون) لكل زيارة
-- ---------------------------------------------------------------------------
create table if not exists body_diagram_annotations (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references patient_visits(id) on delete cascade,
  diagram_view text not null check (diagram_view in ('front','back','face')),
  annotation_data jsonb not null default '{}'::jsonb,   -- نقاط/مسارات الرسم + اللون + سمك الخط
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_body_diagram_visit on body_diagram_annotations (visit_id);

-- ---------------------------------------------------------------------------
-- 6) المؤشرات الحيوية المهيكلة — تُغذّي "مخططات النمو" (لقطات 15/118-125)
--    عمود منفصل (وليس فقط داخل exam_data JSONB) لتمكين رسم بياني زمني بسهولة
--    ولحساب BMI تلقائيًا
-- ---------------------------------------------------------------------------
create table if not exists patient_vital_signs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  heart_rate numeric(5,1),
  blood_pressure_systolic numeric(5,1),
  blood_pressure_diastolic numeric(5,1),
  temperature_celsius numeric(4,1),
  glucose_level numeric(6,1),
  height_cm numeric(5,1),
  weight_kg numeric(5,1),
  bmi numeric(5,2) generated always as (
    case when height_cm is not null and height_cm > 0 and weight_kg is not null
      then round((weight_kg / ((height_cm / 100) * (height_cm / 100)))::numeric, 2)
    else null end
  ) stored,
  respiratory_rate numeric(5,1),
  created_by uuid references auth.users(id)
);
create index if not exists idx_vitals_patient_date on patient_vital_signs (patient_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 7) نماذج CBAHI — نظام نماذج رسمي متعدد الأنواع (جودة/سلامة المريض) (لقطة 119)
-- ---------------------------------------------------------------------------
create table if not exists cbahi_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,
  form_type text not null,
  status text not null default 'draft' check (status in ('draft','completed','reviewed')),
  form_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cbahi_forms_patient on cbahi_forms (patient_id);

-- ---------------------------------------------------------------------------
-- 8) مستندات/صور ملف المريض — ثغرة موثّقة منذ مراجعة الشاشات (لقطات 41/124)،
--    لم تُبنَ في 0002 رغم توثيقها؛ يُسدّها هذا الملف. تُخزَّن الملفات فعليًا في
--    Supabase Storage، وهذا الجدول يحفظ فقط مسار التخزين والتصنيف
-- ---------------------------------------------------------------------------
create table if not exists patient_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,
  category text not null default 'document' check (category in ('image','document')),
  doc_type_value_id uuid references lookup_values(id) on delete set null,
  storage_path text not null,
  file_name text,
  note text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_documents_patient on patient_documents (patient_id, created_at desc);

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table icd10_codes enable row level security;
alter table clinic_exam_templates enable row level security;
alter table patient_visits enable row level security;
alter table patient_visit_diagnoses enable row level security;
alter table dental_chart_entries enable row level security;
alter table body_diagram_annotations enable row level security;
alter table patient_vital_signs enable row level security;
alter table cbahi_forms enable row level security;
alter table patient_documents enable row level security;

-- icd10_codes: مرجع عام عالمي، قراءة فقط لأي مستخدم موثّق (بلا كتابة من العميل)
create policy "icd10_read_authenticated" on icd10_codes
  for select using (auth.role() = 'authenticated');

create policy "exam_templates_read" on clinic_exam_templates
  for select using (organization_id is null or app_is_member(organization_id));
create policy "exam_templates_manage_admins" on clinic_exam_templates
  for insert with check (app_is_org_admin(organization_id));
create policy "exam_templates_update_admins" on clinic_exam_templates
  for update using (app_is_org_admin(organization_id));

create policy "patient_visits_all_members" on patient_visits
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "visit_diagnoses_all_members" on patient_visit_diagnoses
  for all using (exists (select 1 from patient_visits v where v.id = patient_visit_diagnoses.visit_id and app_is_member(v.organization_id)))
  with check (exists (select 1 from patient_visits v where v.id = patient_visit_diagnoses.visit_id and app_is_member(v.organization_id)));

create policy "dental_chart_all_members" on dental_chart_entries
  for all using (exists (select 1 from patient_visits v where v.id = dental_chart_entries.visit_id and app_is_member(v.organization_id)))
  with check (exists (select 1 from patient_visits v where v.id = dental_chart_entries.visit_id and app_is_member(v.organization_id)));

create policy "body_diagram_all_members" on body_diagram_annotations
  for all using (exists (select 1 from patient_visits v where v.id = body_diagram_annotations.visit_id and app_is_member(v.organization_id)))
  with check (exists (select 1 from patient_visits v where v.id = body_diagram_annotations.visit_id and app_is_member(v.organization_id)));

create policy "vital_signs_all_members" on patient_vital_signs
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "cbahi_forms_all_members" on cbahi_forms
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "patient_documents_all_members" on patient_documents
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- تعبئة بيانات مرجعية: قوالب الفحص الافتراضية لكل تخصص (لقطة 15، 20+ تخصص)
-- organization_id = null يعني قالب افتراضي عام يظهر لكل المؤسسات ويمكن نسخه
-- وتخصيصه (schema_definition) لكل مؤسسة عبر صف جديد بنفس specialty_code.
-- ============================================================================
do $$
declare
  v_default_schema jsonb := '{
    "sections": [
      {"key": "main_complaint", "label_ar": "الشكوى الرئيسية", "type": "text"},
      {"key": "biomarkers", "label_ar": "المؤشرات الحيوية", "type": "group", "fields": [
        "heart_rate","blood_pressure","temperature","glucose_level","height","weight","bmi","respiratory_rate"
      ]},
      {"key": "body_systems", "label_ar": "فحص أجهزة الجسم", "type": "group", "fields": [
        "head_neck","chest","abdomen","upper_limbs","lower_limbs","reflection","heart","nervous_system","free_exam"
      ]},
      {"key": "diagnosis", "label_ar": "التشخيص الطبي (ICD10)", "type": "diagnosis"},
      {"key": "notes", "label_ar": "ملاحظات عامة", "type": "textarea"}
    ]
  }'::jsonb;
begin
  insert into clinic_exam_templates (organization_id, specialty_code, name_ar, name_en, canvas_type, schema_definition) values
    (null, 'derma', 'الجلدية', 'Dermatology', 'body_diagram', v_default_schema),
    (null, 'gp', 'الطبيب العام', 'General Practitioner', 'none', v_default_schema),
    (null, 'internal', 'الباطنية', 'Internal Medicine', 'none', v_default_schema),
    (null, 'emergency', 'الطوارئ', 'Emergency', 'none', v_default_schema),
    (null, 'gynecology', 'النساء والولادة', 'Gynecology', 'none', v_default_schema),
    (null, 'pediatrician', 'الأطفال', 'Pediatrician', 'none', v_default_schema),
    (null, 'physical_therapy', 'العلاج الطبيعي', 'Physical Therapy', 'none', v_default_schema),
    (null, 'urologist', 'المسالك البولية', 'Urologist', 'none', v_default_schema),
    (null, 'xray', 'الأشعة', 'X-Ray', 'none', v_default_schema),
    (null, 'simple_dental', 'الأسنان البسيطة', 'Simple Dental', 'dental_chart', v_default_schema),
    (null, 'endocrine', 'السكر والغدد', 'Sugar & Endocrine', 'none', v_default_schema),
    (null, 'ent', 'الأنف والأذن والحنجرة', 'Ear Nose Throat', 'none', v_default_schema),
    (null, 'orthopedic', 'العظمية', 'Orthopedic', 'none', v_default_schema),
    (null, 'digestive', 'الجهاز الهضمي', 'Digestive', 'none', v_default_schema),
    (null, 'nutrition', 'التغذية', 'Nutrition', 'none', v_default_schema),
    (null, 'neurosurgery', 'المخ والأعصاب', 'Neurosurgery', 'none', v_default_schema),
    (null, 'respiratory', 'الصدرية', 'Respiratory', 'none', v_default_schema),
    (null, 'psychiatry', 'الطب النفسي', 'Psychiatry', 'none', v_default_schema),
    (null, 'kidney', 'أمراض الكلى', 'Kidney Disease', 'none', v_default_schema),
    (null, 'ophthalmologist', 'العيون', 'Ophthalmologist', 'none', v_default_schema)
  on conflict (organization_id, specialty_code) do nothing;
end $$;

-- أنواع مستندات المريض القابلة للإدارة (لقطة 124)
insert into lookup_categories (organization_id, key, name_ar, name_en) values
  (null, 'patient_document_types', 'أنواع مستندات المريض', 'Patient Document Types')
on conflict (key) where organization_id is null do nothing;

insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('تقرير أشعة','Radiology Report',10),
  ('تحليل مخبري','Lab Result',20),
  ('إقرار موافقة','Consent Form',30),
  ('هوية/جواز','ID / Passport',40),
  ('أخرى','Other',50)
) as v(name_ar, name_en, sort_order)
where c.key = 'patient_document_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- ============================================================================
-- نهاية 0006_dynamic_exam_builder.sql
-- الخطوة التالية: 0007_dental_lab.sql (طلبيات معامل الأسنان، بناءً فوق distributors
--   و tooth_shade_guides من 0003، وربطها بترقيم الأسنان من dental_chart_entries)
-- ============================================================================
