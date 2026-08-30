-- ===========================================================================
-- المهمة 2 — الجزء (ب): الإصلاح ثم اعتماد القيود.
--
-- ⚠️ لا تشغّله قبل الجزء (أ) وقبل أن نتفق على الخيار الصحيح.
--    اختر خيارًا واحدًا من القسم 1، واحذف الآخر، ثم شغّل الملف كاملًا.
--
-- كل شيء داخل معاملة واحدة: إمّا ينجح الإصلاح والاعتماد معًا، أو لا شيء.
-- ولا حذف لأي صف — كما طلبتَ.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) الإصلاح — فعّل خيارًا واحدًا فقط
-- ---------------------------------------------------------------------------

-- ▸ الخيار (أ): الخطأ في **الموعد** — المريض في منشأته الصحيحة، والموعد
--   أُنشئ تحت منشأة خاطئة. اختره حين يكون نشاط المريض كله (زيارات/فواتير) في
--   منشأته الحالية، والطبيب والعيادة في تلك المنشأة أيضًا.
--
--   ⚠️ لا تستعمله إن كان الطبيب أو العيادة في منشأة الموعد الحالية — لأن نقل
--   الموعد سيجعله يخالفهما بدل أن يخالف المريض، فتنتقل المشكلة لا تُحَل.
--
-- update appointments a
--    set organization_id = (select p.organization_id from patients p where p.id = a.patient_id)
--  where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2';

-- ▸ الخيار (ب): الخطأ في **ربط المريض** — الموعد والطبيب والعيادة كلهم في
--   المنشأة الصحيحة، والمريض المربوط من منشأة أخرى (اختير بالخطأ من قائمة
--   بحث لم تكن مقيَّدة بالمنشأة وقتها). الإصلاح: اربطه بالمريض المقابل في
--   منشأة الموعد، ويُطابَق بالاسم ورقم الجوال.
--
--   ⚠️ شغّل استعلام التحقق أولًا وتأكد أنه يُرجع **صفًا واحدًا** فقط. صفر صفوف
--   يعني أن المريض غير موجود في منشأة الموعد ولا بد من إنشائه أولًا؛ أكثر من
--   صف يعني تشابه أسماء ويجب اختيار المعرّف يدويًا.
--
-- select p2.id, p2.name_ar, p2.file_number, p2.mobile_number
--   from appointments a
--   join patients p1 on p1.id = a.patient_id
--   join patients p2 on p2.organization_id = a.organization_id
--                   and p2.name_ar = p1.name_ar
--                   and p2.mobile_number is not distinct from p1.mobile_number
--  where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2';
--
-- update appointments a
--    set patient_id = '<ضع هنا معرّف المريض الصحيح من الاستعلام أعلاه>'
--  where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2';

-- ---------------------------------------------------------------------------
-- 2) بوابة أمان: تتوقف المعاملة إن بقيت أي مخالفة
--
--    الاعتماد (VALIDATE) يفشل أصلًا لو بقيت مخالفة، لكن رسالته الخام تذكر
--    اسم قيد فقط. هذه البوابة تقول لك **أي علاقة** وكم صفًا، وتُرجِع كل شيء.
-- ---------------------------------------------------------------------------
do $$
declare v_total integer; v_detail text;
begin
  select coalesce(sum(n),0), string_agg(rel || ' = ' || n, ' | ' order by rel)
    into v_total, v_detail
  from (
    select 'appointments→patients' rel, count(*) n from appointments a join patients p on p.id=a.patient_id where p.organization_id<>a.organization_id
    union all select 'appointments→doctors', count(*) from appointments a join doctors d on d.id=a.doctor_id where d.organization_id<>a.organization_id
    union all select 'appointments→clinics', count(*) from appointments a join clinics c on c.id=a.clinic_id where c.organization_id<>a.organization_id
    union all select 'waitlist→patients', count(*) from appointment_waitlist w join patients p on p.id=w.patient_id where p.organization_id<>w.organization_id
    union all select 'waitlist→doctors', count(*) from appointment_waitlist w join doctors d on d.id=w.doctor_id where d.organization_id<>w.organization_id
    union all select 'visits→patients', count(*) from patient_visits v join patients p on p.id=v.patient_id where p.organization_id<>v.organization_id
    union all select 'visits→doctors', count(*) from patient_visits v join doctors d on d.id=v.doctor_id where d.organization_id<>v.organization_id
    union all select 'visits→clinics', count(*) from patient_visits v join clinics c on c.id=v.clinic_id where c.organization_id<>v.organization_id
    union all select 'visits→appointments', count(*) from patient_visits v join appointments a on a.id=v.appointment_id where a.organization_id<>v.organization_id
    union all select 'invoices→patients', count(*) from sales_invoices s join patients p on p.id=s.patient_id where p.organization_id<>s.organization_id
    union all select 'invoices→doctors', count(*) from sales_invoices s join doctors d on d.id=s.doctor_id where d.organization_id<>s.organization_id
    union all select 'invoices→clinics', count(*) from sales_invoices s join clinics c on c.id=s.clinic_id where c.organization_id<>s.organization_id
    union all select 'invoices→appointments', count(*) from sales_invoices s join appointments a on a.id=s.appointment_id where a.organization_id<>s.organization_id
  ) t;

  if v_total > 0 then
    raise exception 'ما زالت هناك % مخالفة عابرة للمنشآت — لم يُعتمد أي قيد. التفصيل: %', v_total, v_detail;
  end if;
  raise notice 'cross_tenant_patient_links = 0 ✅ — يمكن الاعتماد';
end $$;

-- ---------------------------------------------------------------------------
-- 3) اعتماد القيود الثلاثة عشر المضافة بصيغة NOT VALID في 0050
--
--    VALIDATE يمسح الجدول كاملًا مرة واحدة، لكنه يأخذ قفل SHARE UPDATE
--    EXCLUSIVE فقط — أي أن القراءة والكتابة تستمران أثناءه. بعده تصبح القاعدة
--    نفسها مانعة لأي ربط بين منشأتين، لا الواجهة وحدها.
-- ---------------------------------------------------------------------------
alter table appointments        validate constraint appointments_doctor_tenant_fk;
alter table appointments        validate constraint appointments_patient_tenant_fk;
alter table appointments        validate constraint appointments_clinic_tenant_fk;

alter table appointment_waitlist validate constraint waitlist_patient_tenant_fk;
alter table appointment_waitlist validate constraint waitlist_doctor_tenant_fk;

alter table patient_visits      validate constraint patient_visits_patient_tenant_fk;
alter table patient_visits      validate constraint patient_visits_doctor_tenant_fk;
alter table patient_visits      validate constraint patient_visits_clinic_tenant_fk;
alter table patient_visits      validate constraint patient_visits_appointment_tenant_fk;

alter table sales_invoices      validate constraint sales_invoices_patient_tenant_fk;
alter table sales_invoices      validate constraint sales_invoices_doctor_tenant_fk;
alter table sales_invoices      validate constraint sales_invoices_clinic_tenant_fk;
alter table sales_invoices      validate constraint sales_invoices_appointment_tenant_fk;

-- ---------------------------------------------------------------------------
-- 4) التأكيد النهائي: يجب أن يكون العمود `غير_معتمد` صفرًا
-- ---------------------------------------------------------------------------
select count(*) filter (where not convalidated) as غير_معتمد,
       count(*)                                 as إجمالي_قيود_العزل
from pg_constraint
where contype = 'f' and conname like '%tenant_fk';

commit;
