-- 0086_medical_reference_data.sql
-- المرحلة السادسة: البيانات المرجعية الطبية.
--
-- الحالة قبل هذا الملف: `lookup_categories` و`lookup_values` قائمان منذ 0001
-- ويميّزان أصلًا بين **القواميس النظامية** (`organization_id is null`)
-- و**بيانات المنشأة** — وهذا بالضبط ما تطلبه المواصفة، فلا داعي لبنية
-- جديدة. الناقص هو **القواميس الطبية نفسها**: أنواع الحساسية وشدّتها، وطرق
-- الإعطاء وأشكال الجرعات، ووحدات القياس، وأنواع العينات، وأجزاء الجسم،
-- وأسباب الإلغاء وعدم الحضور والاسترجاع، وأنواع الموافقات والإحالات.
--
-- و`icd10_codes` جدول عالمي (بلا `organization_id`) فيه ١٥٧ كودًا مبدئيًا.
-- يبقى كما هو ويُوسَّع بالاستيراد لا بالنسخ في كود الواجهة.
--
-- ---------------------------------------------------------------------------
-- قرار: أنواع العينات وأجزاء الجسم تُضاف كقواميس **بجانب** القيود القائمة
-- ---------------------------------------------------------------------------
-- `lab_tests.specimen_type` مقيَّد بقائمة ثابتة (`blood`, `urine`, …) منذ
-- 0013، و`radiology_exams.modality` كذلك. القيد الثابت أضمن للبيانات من
-- قاموس قابل للتحرير، لكنه لا يقبل التوسعة ولا يحمل أسماء عربية.
--
-- الحلّ: يبقى القيد حارسًا، ويُضاف القاموس **للعرض والترجمة والترتيب**،
-- بمفاتيح مطابقة للقيد حرفيًا. فلا يستطيع أحد إدخال قيمة يرفضها القيد،
-- ويُعرض للمستخدم اسمٌ عربي بدل مفتاح إنجليزي.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) القواميس النظامية الناقصة
--
-- تُنشأ بـ`organization_id = null`: مرجعٌ نظامي مشترك، لا يملكه أحد ولا
-- يعدّله إلا مدير النظام.
-- ---------------------------------------------------------------------------
insert into lookup_categories (organization_id, key, name_ar, name_en)
select null, v.k, v.ar, v.en
from (values
  ('allergy_types',        'أنواع الحساسية',        'Allergy Types'),
  ('allergy_severity',     'شدّة الحساسية',          'Allergy Severity'),
  ('drug_routes',          'طرق إعطاء الدواء',      'Routes of Administration'),
  ('dosage_forms',         'أشكال الجرعات',         'Dosage Forms'),
  ('measurement_units',    'وحدات القياس',          'Units of Measure'),
  ('specimen_types',       'أنواع العينات',         'Specimen Types'),
  ('body_parts',           'أجزاء الجسم',           'Body Parts'),
  ('cancellation_reasons', 'أسباب إلغاء المواعيد',  'Cancellation Reasons'),
  ('no_show_reasons',      'أسباب عدم الحضور',      'No-Show Reasons'),
  ('refund_reasons',       'أسباب الاسترجاع',       'Refund Reasons'),
  ('consent_types',        'أنواع الموافقات',       'Consent Types'),
  ('referral_types',       'أنواع الإحالات',        'Referral Types'),
  ('imaging_modalities',   'أجهزة التصوير',         'Imaging Modalities'),
  ('lab_result_flags',     'دلالات نتائج المختبر',  'Lab Result Flags')
) as v(k, ar, en)
where not exists (
  select 1 from lookup_categories c where c.key = v.k and c.organization_id is null
);

-- ---------------------------------------------------------------------------
-- 2) القيم الأولية
--
-- ليست بياناتٍ وهمية: كلها مصطلحات طبية قياسية، ومفاتيحها الإنجليزية هي ما
-- تكتبه الأنظمة الأخرى. القوائم المرتبطة بقيود قاعدة (العينات، الأجهزة)
-- مفاتيحها مطابقة للقيد حرفيًا.
-- ---------------------------------------------------------------------------
create or replace function app_seed_lookup(
  p_key text,
  p_values jsonb   -- [{code, ar, en}]
)
returns void
language plpgsql
as $$
declare
  v_cat uuid;
  r     jsonb;
  i     int := 0;
begin
  select id into v_cat from lookup_categories
   where key = p_key and organization_id is null;
  if v_cat is null then
    return;
  end if;

  for r in select * from jsonb_array_elements(p_values) loop
    i := i + 1;
    if not exists (select 1 from lookup_values
                    where category_id = v_cat and code = (r ->> 'code')) then
      insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
      values (v_cat, r ->> 'code', r ->> 'ar', r ->> 'en', i);
    end if;
  end loop;
end;
$$;

select app_seed_lookup('allergy_types', '[
  {"code":"drug","ar":"دواء","en":"Drug"},
  {"code":"food","ar":"طعام","en":"Food"},
  {"code":"environmental","ar":"بيئية","en":"Environmental"},
  {"code":"latex","ar":"لاتكس","en":"Latex"},
  {"code":"insect","ar":"لدغ الحشرات","en":"Insect Sting"},
  {"code":"contrast","ar":"صبغة الأشعة","en":"Contrast Media"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('allergy_severity', '[
  {"code":"mild","ar":"خفيفة","en":"Mild"},
  {"code":"moderate","ar":"متوسطة","en":"Moderate"},
  {"code":"severe","ar":"شديدة","en":"Severe"},
  {"code":"anaphylaxis","ar":"تأق (صدمة تحسسية)","en":"Anaphylaxis"}
]'::jsonb);

select app_seed_lookup('drug_routes', '[
  {"code":"oral","ar":"فموي","en":"Oral"},
  {"code":"iv","ar":"وريدي","en":"Intravenous"},
  {"code":"im","ar":"عضلي","en":"Intramuscular"},
  {"code":"sc","ar":"تحت الجلد","en":"Subcutaneous"},
  {"code":"topical","ar":"موضعي","en":"Topical"},
  {"code":"inhalation","ar":"استنشاق","en":"Inhalation"},
  {"code":"rectal","ar":"شرجي","en":"Rectal"},
  {"code":"ophthalmic","ar":"عيني","en":"Ophthalmic"},
  {"code":"otic","ar":"أذني","en":"Otic"},
  {"code":"nasal","ar":"أنفي","en":"Nasal"},
  {"code":"sublingual","ar":"تحت اللسان","en":"Sublingual"},
  {"code":"vaginal","ar":"مهبلي","en":"Vaginal"}
]'::jsonb);

select app_seed_lookup('dosage_forms', '[
  {"code":"tablet","ar":"أقراص","en":"Tablet"},
  {"code":"capsule","ar":"كبسولات","en":"Capsule"},
  {"code":"syrup","ar":"شراب","en":"Syrup"},
  {"code":"suspension","ar":"معلّق","en":"Suspension"},
  {"code":"injection","ar":"حقن","en":"Injection"},
  {"code":"cream","ar":"كريم","en":"Cream"},
  {"code":"ointment","ar":"مرهم","en":"Ointment"},
  {"code":"drops","ar":"قطرة","en":"Drops"},
  {"code":"inhaler","ar":"بخّاخ","en":"Inhaler"},
  {"code":"suppository","ar":"تحاميل","en":"Suppository"},
  {"code":"patch","ar":"لصقة","en":"Patch"},
  {"code":"powder","ar":"مسحوق","en":"Powder"}
]'::jsonb);

select app_seed_lookup('measurement_units', '[
  {"code":"mg","ar":"ملغم","en":"mg"},
  {"code":"g","ar":"غرام","en":"g"},
  {"code":"mcg","ar":"مايكروغرام","en":"mcg"},
  {"code":"ml","ar":"مل","en":"mL"},
  {"code":"l","ar":"لتر","en":"L"},
  {"code":"iu","ar":"وحدة دولية","en":"IU"},
  {"code":"mmol_l","ar":"ملي مول/لتر","en":"mmol/L"},
  {"code":"mg_dl","ar":"ملغم/دل","en":"mg/dL"},
  {"code":"g_dl","ar":"غرام/دل","en":"g/dL"},
  {"code":"cells_ul","ar":"خلية/ميكرولتر","en":"cells/µL"},
  {"code":"percent","ar":"نسبة مئوية","en":"%"},
  {"code":"cm","ar":"سم","en":"cm"},
  {"code":"kg","ar":"كغم","en":"kg"},
  {"code":"celsius","ar":"درجة مئوية","en":"°C"},
  {"code":"mmhg","ar":"ملم زئبق","en":"mmHg"},
  {"code":"bpm","ar":"نبضة/دقيقة","en":"bpm"}
]'::jsonb);

-- مفاتيح مطابقة لقيد `lab_tests_specimen_type_check` حرفيًا
select app_seed_lookup('specimen_types', '[
  {"code":"blood","ar":"دم","en":"Blood"},
  {"code":"urine","ar":"بول","en":"Urine"},
  {"code":"stool","ar":"براز","en":"Stool"},
  {"code":"swab","ar":"مسحة","en":"Swab"},
  {"code":"sputum","ar":"قشع","en":"Sputum"},
  {"code":"tissue","ar":"نسيج","en":"Tissue"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

-- مفاتيح مطابقة لقيد `radiology_exams_modality_check` حرفيًا
select app_seed_lookup('imaging_modalities', '[
  {"code":"xray","ar":"أشعة سينية","en":"X-Ray"},
  {"code":"ct","ar":"مقطعية","en":"CT"},
  {"code":"mri","ar":"رنين مغناطيسي","en":"MRI"},
  {"code":"ultrasound","ar":"موجات صوتية","en":"Ultrasound"},
  {"code":"mammography","ar":"تصوير الثدي","en":"Mammography"},
  {"code":"fluoroscopy","ar":"تنظير تألقي","en":"Fluoroscopy"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('body_parts', '[
  {"code":"head","ar":"الرأس","en":"Head"},
  {"code":"neck","ar":"الرقبة","en":"Neck"},
  {"code":"chest","ar":"الصدر","en":"Chest"},
  {"code":"abdomen","ar":"البطن","en":"Abdomen"},
  {"code":"pelvis","ar":"الحوض","en":"Pelvis"},
  {"code":"spine_cervical","ar":"العمود الرقبي","en":"Cervical Spine"},
  {"code":"spine_thoracic","ar":"العمود الصدري","en":"Thoracic Spine"},
  {"code":"spine_lumbar","ar":"العمود القطني","en":"Lumbar Spine"},
  {"code":"shoulder","ar":"الكتف","en":"Shoulder"},
  {"code":"elbow","ar":"المرفق","en":"Elbow"},
  {"code":"wrist","ar":"الرسغ","en":"Wrist"},
  {"code":"hand","ar":"اليد","en":"Hand"},
  {"code":"hip","ar":"الورك","en":"Hip"},
  {"code":"knee","ar":"الركبة","en":"Knee"},
  {"code":"ankle","ar":"الكاحل","en":"Ankle"},
  {"code":"foot","ar":"القدم","en":"Foot"}
]'::jsonb);

select app_seed_lookup('cancellation_reasons', '[
  {"code":"patient_request","ar":"طلب المريض","en":"Patient Request"},
  {"code":"patient_illness","ar":"مرض المريض","en":"Patient Illness"},
  {"code":"doctor_unavailable","ar":"عدم توفّر الطبيب","en":"Doctor Unavailable"},
  {"code":"rescheduled","ar":"أُعيدت جدولته","en":"Rescheduled"},
  {"code":"duplicate","ar":"حجز مكرّر","en":"Duplicate Booking"},
  {"code":"clinic_closed","ar":"إغلاق العيادة","en":"Clinic Closed"},
  {"code":"insurance_rejected","ar":"رفض التأمين","en":"Insurance Rejected"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('no_show_reasons', '[
  {"code":"forgot","ar":"نسي الموعد","en":"Forgot"},
  {"code":"transport","ar":"تعذّر المواصلات","en":"Transportation"},
  {"code":"work","ar":"ارتباط عمل","en":"Work Commitment"},
  {"code":"weather","ar":"الأحوال الجوية","en":"Weather"},
  {"code":"felt_better","ar":"تحسّنت حالته","en":"Felt Better"},
  {"code":"unknown","ar":"غير معروف","en":"Unknown"}
]'::jsonb);

select app_seed_lookup('refund_reasons', '[
  {"code":"service_not_provided","ar":"لم تُقدَّم الخدمة","en":"Service Not Provided"},
  {"code":"billing_error","ar":"خطأ في الفوترة","en":"Billing Error"},
  {"code":"duplicate_charge","ar":"رسم مكرّر","en":"Duplicate Charge"},
  {"code":"patient_complaint","ar":"شكوى المريض","en":"Patient Complaint"},
  {"code":"insurance_covered","ar":"غطّاها التأمين","en":"Covered by Insurance"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('consent_types', '[
  {"code":"general_treatment","ar":"موافقة علاج عامة","en":"General Treatment"},
  {"code":"surgical","ar":"موافقة جراحية","en":"Surgical"},
  {"code":"anesthesia","ar":"موافقة تخدير","en":"Anesthesia"},
  {"code":"blood_transfusion","ar":"نقل دم","en":"Blood Transfusion"},
  {"code":"contrast_media","ar":"صبغة الأشعة","en":"Contrast Media"},
  {"code":"photography","ar":"تصوير طبي","en":"Medical Photography"},
  {"code":"data_sharing","ar":"مشاركة البيانات","en":"Data Sharing"},
  {"code":"minor_guardian","ar":"موافقة وليّ أمر","en":"Guardian Consent"}
]'::jsonb);

select app_seed_lookup('referral_types', '[
  {"code":"internal","ar":"إحالة داخلية","en":"Internal"},
  {"code":"external","ar":"إحالة خارجية","en":"External"},
  {"code":"second_opinion","ar":"رأي ثانٍ","en":"Second Opinion"},
  {"code":"emergency","ar":"إحالة طارئة","en":"Emergency"},
  {"code":"lab_external","ar":"مختبر خارجي","en":"External Lab"},
  {"code":"imaging_external","ar":"أشعة خارجية","en":"External Imaging"}
]'::jsonb);

select app_seed_lookup('lab_result_flags', '[
  {"code":"normal","ar":"طبيعي","en":"Normal"},
  {"code":"low","ar":"منخفض","en":"Low"},
  {"code":"high","ar":"مرتفع","en":"High"},
  {"code":"critical_low","ar":"منخفض حرج","en":"Critical Low"},
  {"code":"critical_high","ar":"مرتفع حرج","en":"Critical High"},
  {"code":"inconclusive","ar":"غير حاسم","en":"Inconclusive"}
]'::jsonb);

drop function if exists app_seed_lookup(text, jsonb);

-- ---------------------------------------------------------------------------
-- 3) أكواد الإجراءات — جدول عالمي مثل ICD-10
--
-- كود الإجراء (CPT وما شابه) معيار لا يخصّ منشأة، فيوضع حيث وُضع ICD-10:
-- جدول عالمي بلا `organization_id`. وربطُه بالخدمة يبقى في
-- `item_claim_codes` (0073) الذي **يخصّ** المنشأة.
-- ---------------------------------------------------------------------------
create table if not exists procedure_codes (
  id            uuid primary key default gen_random_uuid(),
  code_system   text not null default 'cpt',
  code          text not null,
  name_ar       text,
  name_en       text not null,
  category      text,
  is_disabled   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint procedure_codes_system_check check (
    code_system in ('cpt','hcpcs','icd10pcs','snomed','local','other')
  )
);

create unique index if not exists uq_procedure_codes on procedure_codes (code_system, code);
create index if not exists idx_procedure_codes_search
  on procedure_codes (code) where not is_disabled;

alter table procedure_codes enable row level security;

drop policy if exists procedure_codes_read on procedure_codes;
create policy procedure_codes_read on procedure_codes for select to authenticated
  using (true);

-- الكتابة على المرجع العالمي ليست لأحد من المستخدمين: يُستورَد بمفتاح
-- الخدمة أو من محرّر SQL. سياسة كتابة مفتوحة هنا تعني أن منشأةً تعدّل
-- مرجعًا تراه كل المنشآت.
revoke all on procedure_codes from anon;
grant select on procedure_codes to authenticated;

comment on table procedure_codes is
  'مرجع عالمي لأكواد الإجراءات. لا يُكتب من التطبيق — يُستورَد. الربط بالخدمة في item_claim_codes.';

-- ---------------------------------------------------------------------------
-- 4) `icd10_codes`: البحث والحماية
-- ---------------------------------------------------------------------------
create index if not exists idx_icd10_code on icd10_codes (code) where not is_disabled;
create index if not exists idx_icd10_name_ar on icd10_codes (name_ar) where not is_disabled;

comment on table icd10_codes is
  'مرجع WHO عالمي بلا organization_id. يُوسَّع بالاستيراد لا بالنسخ في كود الواجهة.';

-- ---------------------------------------------------------------------------
-- 5) القواميس النظامية لا يعدّلها مدير المنشأة
--
-- السياسة القائمة `lookup_values_manage_admins` تفحص
-- `app_is_org_admin(c.organization_id)` — وهي تُعيد `false` حين تكون
-- المنشأة `null`، فالقواميس النظامية محميّة أصلًا. هذا الفحص يُثبّت ذلك
-- ويفشل إن تغيّر.
-- ---------------------------------------------------------------------------
do $$
declare
  v_expr text;
begin
  select pg_get_expr(polqual, polrelid) into v_expr
    from pg_policy
   where polrelid = 'lookup_values'::regclass
     and polname = 'lookup_values_manage_admins';

  if v_expr is null or v_expr not like '%app_is_org_admin%' then
    raise exception 'سياسة تعديل القواميس تغيّرت — القواميس النظامية قد تصير قابلة للتعديل';
  end if;
  raise notice 'القواميس النظامية محميّة: تعديلها يحتاج منشأةً، وهي فيها null';
end $$;

-- ---------------------------------------------------------------------------
-- 6) منظور موحّد للبيانات المرجعية
--
-- يجمع القواميس والقيم مع تمييز النظامي عن الخاص، فتقرأه شاشة واحدة بدل
-- استعلام لكل قاموس.
-- ---------------------------------------------------------------------------
create or replace view v_reference_data as
select
  c.id            as category_id,
  c.key           as category_key,
  c.name_ar       as category_name_ar,
  c.name_en       as category_name_en,
  c.organization_id,
  (c.organization_id is null) as is_system,
  v.id            as value_id,
  v.code,
  v.name_ar,
  v.name_en,
  v.parent_value_id,
  v.sort_order,
  v.is_disabled,
  v.extra
from lookup_categories c
left join lookup_values v on v.category_id = c.id;

alter view v_reference_data set (security_invoker = on);
revoke all on v_reference_data from anon;
grant select on v_reference_data to authenticated;

-- عدّاد القيم لكل قاموس — للشاشة
create or replace view v_reference_categories as
select
  c.id,
  c.key,
  c.name_ar,
  c.name_en,
  c.organization_id,
  (c.organization_id is null) as is_system,
  count(v.id)                                          as value_count,
  count(v.id) filter (where not v.is_disabled)         as active_count
from lookup_categories c
left join lookup_values v on v.category_id = c.id
group by c.id, c.key, c.name_ar, c.name_en, c.organization_id;

alter view v_reference_categories set (security_invoker = on);
revoke all on v_reference_categories from anon;
grant select on v_reference_categories to authenticated;

commit;
