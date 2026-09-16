-- ---------------------------------------------------------------------------
-- 0164_doctor_patients.sql — مرضى الطبيب: من هم بالضبط
-- ---------------------------------------------------------------------------
-- الطبيب الداخل بصفته يرى **كل مرضى المنشأة**: مرضى العيادات الأخرى، ومرضى
-- زملائه، ومن لم يره قطّ. وهذا خطأ في ثلاثة وجوه معًا:
--
--   • **سريريًّا:** قائمةٌ من مئات الملفّات لا يعرف منها الطبيب ملفّه، فيفتح
--     الخطأ ويكتب فيه.
--   • **مهنيًّا:** السجلّ الطبّي ليس مشاعًا بين الأطباء؛ يُطَّلع عليه بعلاقة
--     علاجية لا بعضوية منشأة.
--   • **عمليًّا:** البحث يصير بلا معنى حين يعيد عشرين مطابقة لا تخصّ الباحث.
--
-- **تعريف «مريض الطبيب» هنا هو ما حدّده المالك نصًّا:** طبيبه المعالج، أو
-- شارك في علاجه، أو له معه موعدٌ أو زيارة. والثلاثة معًا لا واحدٌ منها:
--
--   • `treating_doctor_id` وحده يُسقط المريض الجديد الذي حُجز له موعدٌ ولم
--     يُسنَد بعد — وهو أوّل من يحتاجه الطبيب اليوم.
--   • الموعد وحده يُسقط المريض المسنَد الذي لم يُحجز له شيء بعد.
--   • والمشاركة (`participating_doctor_ids`) هي الحالة التي طلبها المالك
--     صراحةً: «لا تعرض له مرضى عيادات أخرى أو أطباء غيره **إلّا إذا كان
--     مشاركًا**».
--
-- **صفٌّ لكل زوج (طبيب، مريض) لا أكثر:** الربط يُنتج الزوج مرّةً واحدة،
-- والشروط الأربعة في `where` واحدة لا أربعة صفوف — فلا حاجة إلى `distinct`
-- على صفٍّ عريض، وهو استعلامٌ مكلف على جدول المرضى.
--
-- **هذا ليس بديلًا عن RLS.** المنظور `security_invoker` وسياسات `patients`
-- تبقى فوقه كما هي؛ وهو يحصر **ما تعرضه الشاشة** لا ما تسمح به القاعدة.
-- حصر القاعدة نفسها على العلاقة العلاجية قرارٌ آخر أوسع أثرًا (يمسّ الفوترة
-- والتقارير والاستقبال)، ولم يُطلب.
-- ---------------------------------------------------------------------------

begin;

create or replace view v_doctor_patients as
select
  d.id as doctor_id,
  p.*
from patients p
join doctors d
  on d.organization_id = p.organization_id
 and coalesce(d.is_enabled, true) = true
where
     d.id = p.treating_doctor_id
  or d.id = any (coalesce(p.participating_doctor_ids, '{}'::uuid[]))
  or exists (
       select 1 from appointments a
        where a.patient_id = p.id
          and a.doctor_id = d.id
     )
  or exists (
       select 1 from patient_visits v
        where v.patient_id = p.id
          and v.doctor_id = d.id
     );

alter view v_doctor_patients set (security_invoker = on);
revoke all on v_doctor_patients from anon;
grant select on v_doctor_patients to authenticated;

comment on view v_doctor_patients is
  'مرضى كل طبيب: من هو طبيبهم المعالج، أو شارك في علاجهم، أو له معهم موعد أو زيارة. صفٌّ لكل زوج (طبيب، مريض). يحصر ما تعرضه الشاشة لا ما تسمح به RLS.';

-- الفهارس التي يعتمد عليها الشرطان الأخيران. الأوّلان يُخدَمان بفهارس
-- `patients` القائمة، وهذان بحثٌ عكسيّ (من الطبيب إلى المريض) لم يكن مطلوبًا
-- قبل هذا المنظور.
create index if not exists idx_appointments_doctor_patient
  on appointments (doctor_id, patient_id);
create index if not exists idx_patient_visits_doctor_patient
  on patient_visits (doctor_id, patient_id);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0164_doctor_patients.sql
-- ---------------------------------------------------------------------------
