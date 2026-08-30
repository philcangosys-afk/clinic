-- ---------------------------------------------------------------------------
-- 0056_visit_children_integrity.sql — سلامة توابع الزيارة + تاريخ المتابعة
-- ---------------------------------------------------------------------------
-- شاشة السجل الطبي تُعدِّل زيارة قائمة (`update patient_visits`) عندما تُفتح
-- من موعد له زيارة. الخدمات وحدها كانت تُستبدل عند التعديل (0053)؛ أما بقية
-- توابع الزيارة فكانت تُدرَج **إدراجًا** في كل حفظ:
--
--   • `patient_visit_diagnoses` — مفتاحه الأساسي (visit_id, icd10_code_id).
--     إعادة الحفظ بنفس التشخيص ترفع `duplicate key value violates unique
--     constraint` خامًا. والأسوأ: الخدمات تكون قد استُبدلت قبله بالفعل، فيرى
--     الطبيب رسالة فشل بينما نصف الحفظ تمّ. هذا عطل حقيقي لا تجميل.
--
--   • `patient_vital_signs` / `dental_chart_entries` /
--     `body_diagram_annotations` / `occupational_exam_results` — لا قيد فريد
--     عليها، فكل ضغطة «حفظ» تُنشئ صفًا إضافيًا. النتيجة: منحنى الضغط يُظهر
--     ثلاث قراءات متطابقة لزيارة واحدة، وتقرير اللياقة المهنية يعطي شهادتين
--     برقمين مختلفين لنفس الفحص.
--
-- الإصلاح هنا في القاعدة (والواجهة تُصلَح معه): قيود فريدة تجعل «صف واحد لكل
-- زيارة» حقيقةً لا اتفاقًا. والقيد يمنع تكرار العيب مهما تغيّرت الواجهة.
--
-- التنظيف قبل القيد يُبقي **الأحدث** ويحذف ما قبله: الصفوف المكرَّرة نسخ من
-- عملية حفظ واحدة أُعيدت، والأحدث هو ما يراه الطبيب في النموذج.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) تاريخ المتابعة القادمة — عمود مؤرَّخ لا نصًّا حرًّا
--
-- `next_visit_plan` نصّ («يراجع بعد أسبوعين»)، ولا يُبنى عليه شيء: لا تذكير،
-- ولا قائمة «مرضى تأخّرت متابعتهم»، ولا حجز مقترح. التاريخ المهيكل هو ما
-- يجعل خطة المتابعة قابلة للتنفيذ. النصّ يبقى — أحدهما للسبب والآخر للموعد.
-- ---------------------------------------------------------------------------
alter table patient_visits add column if not exists next_visit_date date;

create index if not exists idx_patient_visits_next_visit_date
  on patient_visits (organization_id, next_visit_date)
  where next_visit_date is not null;

-- ---------------------------------------------------------------------------
-- 2) المؤشرات الحيوية — صف واحد لكل زيارة
--
-- ملاحظة مقصودة: لو لزم لاحقًا تسجيل قياسات متسلسلة داخل الزيارة الواحدة
-- (قبل الإجراء وبعده)، فالطريق هو إسقاط هذا الفهرس وإضافة `measurement_seq`
-- إلى المفتاح — لا ترك الجدول بلا قيد. القياسات المتسلسلة تحتاج ترتيبًا
-- صريحًا، وتكرار الصفوف الصامت ليس ترتيبًا.
-- ---------------------------------------------------------------------------
with ranked as (
  select ctid,
         row_number() over (partition by visit_id order by recorded_at desc, ctid desc) as rn
    from patient_vital_signs
   where visit_id is not null
)
delete from patient_vital_signs v
 using ranked r
 where v.ctid = r.ctid and r.rn > 1;

create unique index if not exists uq_patient_vital_signs_visit
  on patient_vital_signs (visit_id)
  where visit_id is not null;

-- ---------------------------------------------------------------------------
-- 3) لوحة الأسنان — سجل واحد لكل زيارة
-- ---------------------------------------------------------------------------
with ranked as (
  select ctid,
         row_number() over (partition by visit_id order by created_at desc, ctid desc) as rn
    from dental_chart_entries
)
delete from dental_chart_entries d
 using ranked r
 where d.ctid = r.ctid and r.rn > 1;

create unique index if not exists uq_dental_chart_entries_visit
  on dental_chart_entries (visit_id);

-- ---------------------------------------------------------------------------
-- 4) مخطط الجسم — رسم واحد لكل (زيارة، منظور)
--    ثلاثة مناظير مسموحة (أمامي/خلفي/وجه) لكن لا نسختان لمنظور واحد.
-- ---------------------------------------------------------------------------
with ranked as (
  select ctid,
         row_number() over (partition by visit_id, diagram_view order by created_at desc, ctid desc) as rn
    from body_diagram_annotations
)
delete from body_diagram_annotations b
 using ranked r
 where b.ctid = r.ctid and r.rn > 1;

create unique index if not exists uq_body_diagram_visit_view
  on body_diagram_annotations (visit_id, diagram_view);

-- ---------------------------------------------------------------------------
-- 5) نتيجة الفحص المهني — لا حاجة لقيد جديد، والعطل هنا في الواجهة وحدها
--
-- `occupational_exam_results.visit_id` عليه `unique` منذ 0033
-- (`occupational_exam_results_visit_id_key`). فالقاعدة سليمة، لكن الواجهة
-- تُدرج إدراجًا في كل حفظ، فإعادة حفظ زيارة فحص مهني ترفع:
--
--     duplicate key value violates unique constraint
--     "occupational_exam_results_visit_id_key"
--
-- خطأ خام بالإنجليزية أمام الطبيب، بعد أن تكون الزيارة والخدمات قد حُفظت
-- فعلًا. الإصلاح في `MedicalRecords.tsx`: استبدال لا إدراج. يُذكر هنا لأن من
-- يقرأ هذه الهجرة يبحث عن «كل توابع الزيارة»، وغياب هذا البند سيُقرأ سهوًا.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6) فهارس ربط الطلبات بالزيارة
--
-- الأعمدة `visit_id` موجودة في `lab_orders` و`radiology_orders`
-- و`prescriptions` منذ 0013/0014/0015 — وتعليق 0013 نفسه يقول «حتى يظهر
-- الطلب من داخل شاشة السجل الطبي **مستقبلًا**». ذلك المستقبل لم يأتِ: لا سطر
-- واحد في الواجهة يكتب `visit_id`، فكل طلب مختبر أو أشعة أو وصفة مفصول عن
-- الزيارة التي وُلد منها. الواجهة تُصلَح الآن، وهذه الفهارس تجعل القراءة
-- «طلبات هذه الزيارة» رخيصة.
-- ---------------------------------------------------------------------------
create index if not exists idx_lab_orders_visit on lab_orders (visit_id) where visit_id is not null;
create index if not exists idx_radiology_orders_visit on radiology_orders (visit_id) where visit_id is not null;
create index if not exists idx_prescriptions_visit on prescriptions (visit_id) where visit_id is not null;

commit;
