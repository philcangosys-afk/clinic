-- =============================================================================
-- 0150_patient_directory_mobile.sql
-- إضافة رقم الجوال إلى دليل المرضى — ليعمل البحث العامّ بالجوال.
-- =============================================================================
--
-- **العيب:** البحث العامّ في الشريط العلويّ يقرأ `v_patient_directory`، والمنظور
-- يعرض `phone_1` ولا يعرض `mobile_number` إطلاقًا. و`mobile_number` هو الحقل
-- الذي تُدخله شاشة المريض وتفرض عليه عشر خانات منذ `0147`؛ أمّا `phone_1` فحقل
-- هاتفٍ ثانويّ كثيرٌ من الملفّات فارغةٌ فيه. فالموظّف يكتب رقم جوال المريض في
-- البحث العامّ فلا يجده، بينما تجده شاشة المرضى — فيظنّ الملفّ غير موجود.
--
-- **الإخفاء يتبع الصلاحية نفسها:** من لا يملك `patients.view_identity` يرى
-- الرقم مُقنَّعًا كما يرى الهوية والهاتف — ولا يستدلّ به على صاحبه، لأنّ البحث
-- يقارن القيمة المُقنَّعة فلا تُطابق. وهذا هو المقصود: من لا يرى المعرِّف لا
-- يبحث به.
--
-- **لماذا يُلحَق العمود في الآخر:** `create or replace view` لا تُدرج عمودًا في
-- الوسط ولا تُسقط عمودًا؛ تقبل الإلحاق في النهاية وحده. فبقيّة الأعمدة أُعيدت
-- كما هي حرفًا بحرف من `0095`، و`mobile_number` بعد `created_at`.
-- =============================================================================

create or replace view v_patient_directory
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.branch_id,
  p.name_ar,
  p.name_en,
  p.file_number,
  p.gender,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.id_number else app_mask_text(p.id_number) end       as id_number,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.phone_1  else app_mask_text(p.phone_1)  end         as phone_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.email_1  else app_mask_text(p.email_1, 0) end       as email_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.birth_date else null end                            as birth_date,
  -- العمر يبقى ظاهرًا لأنه ضرورة سريرية، والتاريخ الدقيق معرّف شخصي
  case when p.birth_date is not null
       then extract(year from age(p.birth_date))::int end         as age_years,
  app_has_permission(p.organization_id, 'patients.view_identity') as identity_visible,
  app_has_permission(p.organization_id, 'patients.view_medical')  as medical_visible,
  app_has_permission(p.organization_id, 'patients.view_financial') as financial_visible,
  p.created_at,
  -- مُلحَق في 0150: رقم الجوال المفروض عليه عشر خانات، بالإخفاء نفسه
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.mobile_number else app_mask_text(p.mobile_number) end as mobile_number
from patients p;

comment on view v_patient_directory is
  'دليل المرضى بإخفاءٍ حسب الدور. الإخفاء في القاعدة لا في الواجهة — ما تُخفيه الواجهة يبقى في الاستجابة.';

notify pgrst, 'reload schema';
