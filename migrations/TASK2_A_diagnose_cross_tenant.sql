-- ===========================================================================
-- المهمة 2 — الجزء (أ): التشخيص فقط. لا يعدّل شيئًا. آمن تمامًا.
-- شغّله في: Supabase → SQL Editor → New query → Run
-- ثم انسخ المخرجات كاملةً وأرسلها.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) الموعد المذكور: منشأته ومنشأة كل طرف مرتبط به
-- ---------------------------------------------------------------------------
select
  'الموعد'                       as البند,
  a.id::text                     as المعرّف,
  a.organization_id::text        as المنشأة,
  oa.name                        as اسم_المنشأة,
  a.status                       as الحالة,
  a.scheduled_start::text        as الموعد,
  a.created_at::text             as أنشئ_في
from appointments a
left join organizations oa on oa.id = a.organization_id
where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2';

select
  البند, المعرّف, المنشأة, اسم_المنشأة, تفاصيل,
  case when المنشأة is distinct from (select organization_id::text from appointments
                                       where id='eeca3c98-4d5f-4d3a-9930-3f44ab936bc2')
       then '❌ يخالف منشأة الموعد' else '✅ مطابق' end as النتيجة
from (
  select 'المريض' as البند, p.id::text as المعرّف, p.organization_id::text as المنشأة,
         op.name as اسم_المنشأة,
         coalesce(p.name_ar,'') || ' — ملف ' || coalesce(p.file_number::text,'—') as تفاصيل,
         1 as ترتيب
    from appointments a join patients p on p.id = a.patient_id
    left join organizations op on op.id = p.organization_id
   where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2'
  union all
  select 'الطبيب', d.id::text, d.organization_id::text, od.name, coalesce(d.name_ar,''), 2
    from appointments a join doctors d on d.id = a.doctor_id
    left join organizations od on od.id = d.organization_id
   where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2'
  union all
  select 'العيادة', c.id::text, c.organization_id::text, oc.name, coalesce(c.name,''), 3
    from appointments a join clinics c on c.id = a.clinic_id
    left join organizations oc on oc.id = c.organization_id
   where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2'
) t order by ترتيب;

-- منشئ الموعد وعضوياته: يكشف أي منشأة كان يعمل فيها وقت الإنشاء
select 'منشئ الموعد' as البند,
       u.email,
       m.organization_id::text as منشأة_العضوية,
       o.name                  as اسم_المنشأة,
       m.role_key, m.is_active
from appointments a
left join auth.users u on u.id = a.created_by
left join organization_memberships m on m.user_id = a.created_by
left join organizations o on o.id = m.organization_id
where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2';

-- ---------------------------------------------------------------------------
-- 2) هل للمريض نشاط في أيٍّ من المنشأتين؟
--    هذا ما يحسم أين ينتمي فعلًا: المنشأة التي فيها زياراته وفواتيره.
-- ---------------------------------------------------------------------------
with target as (
  select a.patient_id, a.organization_id as org_appt,
         (select organization_id from patients where id = a.patient_id) as org_patient
  from appointments a where a.id = 'eeca3c98-4d5f-4d3a-9930-3f44ab936bc2'
)
select 'نشاط المريض' as البند, x.المصدر, x.منشأة, count(*) as عدد
from target t
cross join lateral (
  select 'مواعيد' as المصدر, organization_id::text as منشأة from appointments where patient_id = t.patient_id
  union all
  select 'زيارات', organization_id::text from patient_visits where patient_id = t.patient_id
  union all
  select 'فواتير', organization_id::text from sales_invoices where patient_id = t.patient_id
) x
group by x.المصدر, x.منشأة
order by x.المصدر, عدد desc;

-- ---------------------------------------------------------------------------
-- 3) المسح الشامل: كل ارتباط عابر للمنشآت في العلاقات الستّ
--    (يجب أن تكون كل الأعداد صفرًا قبل VALIDATE)
-- ---------------------------------------------------------------------------
select 'appointments → patients'  as العلاقة, count(*) as مخالفات
  from appointments a join patients p on p.id=a.patient_id
 where p.organization_id <> a.organization_id
union all
select 'appointments → doctors', count(*)
  from appointments a join doctors d on d.id=a.doctor_id
 where d.organization_id <> a.organization_id
union all
select 'appointments → clinics', count(*)
  from appointments a join clinics c on c.id=a.clinic_id
 where c.organization_id <> a.organization_id
union all
select 'appointment_waitlist → patients', count(*)
  from appointment_waitlist w join patients p on p.id=w.patient_id
 where p.organization_id <> w.organization_id
union all
select 'appointment_waitlist → doctors', count(*)
  from appointment_waitlist w join doctors d on d.id=w.doctor_id
 where d.organization_id <> w.organization_id
union all
select 'patient_visits → patients', count(*)
  from patient_visits v join patients p on p.id=v.patient_id
 where p.organization_id <> v.organization_id
union all
select 'patient_visits → doctors', count(*)
  from patient_visits v join doctors d on d.id=v.doctor_id
 where d.organization_id <> v.organization_id
union all
select 'patient_visits → clinics', count(*)
  from patient_visits v join clinics c on c.id=v.clinic_id
 where c.organization_id <> v.organization_id
union all
select 'patient_visits → appointments', count(*)
  from patient_visits v join appointments a on a.id=v.appointment_id
 where a.organization_id <> v.organization_id
union all
select 'sales_invoices → patients', count(*)
  from sales_invoices s join patients p on p.id=s.patient_id
 where p.organization_id <> s.organization_id
union all
select 'sales_invoices → doctors', count(*)
  from sales_invoices s join doctors d on d.id=s.doctor_id
 where d.organization_id <> s.organization_id
union all
select 'sales_invoices → clinics', count(*)
  from sales_invoices s join clinics c on c.id=s.clinic_id
 where c.organization_id <> s.organization_id
union all
select 'sales_invoices → appointments', count(*)
  from sales_invoices s join appointments a on a.id=s.appointment_id
 where a.organization_id <> s.organization_id
order by مخالفات desc, العلاقة;

-- ---------------------------------------------------------------------------
-- 4) هل للموعد أبناء؟ (زيارة/فاتورة/طلب انتظار) — يحدّد أيّ إصلاح آمن
-- ---------------------------------------------------------------------------
select 'أبناء الموعد' as البند,
       (select count(*) from patient_visits      where appointment_id='eeca3c98-4d5f-4d3a-9930-3f44ab936bc2') as زيارات,
       (select count(*) from sales_invoices      where appointment_id='eeca3c98-4d5f-4d3a-9930-3f44ab936bc2') as فواتير,
       (select count(*) from appointment_waitlist where appointment_id='eeca3c98-4d5f-4d3a-9930-3f44ab936bc2') as طلبات_انتظار;
