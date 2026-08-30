-- ===========================================================================
-- المهمة 2 — تشخيص مركَّز (بعد أن كشفت البوابة مخالفتين لا واحدة).
-- للقراءة فقط. انسخ الناتج كاملًا وأرسله.
-- ===========================================================================

-- (1) كل موعد مخالف، وأمامه منشأة كل أطرافه — ورأيٌ آليّ في سبب الخلل
select
  a.id::text                                          as الموعد,
  a.status                                            as الحالة,
  a.scheduled_start::date::text                       as التاريخ,
  oa.name                                             as منشأة_الموعد,
  op.name                                             as منشأة_المريض,
  od.name                                             as منشأة_الطبيب,
  oc.name                                             as منشأة_العيادة,
  case
    when p.organization_id = d.organization_id
     and p.organization_id is distinct from a.organization_id
      then '⇒ المريض والطبيب معًا في منشأة واحدة أخرى: الخطأ في organization_id للموعد'
    when p.organization_id is distinct from a.organization_id
     and d.organization_id is distinct from a.organization_id
      then '⇒ المريض والطبيب في منشأتين مختلفتين: يلزم قرار يدوي'
    when p.organization_id is distinct from a.organization_id
      then '⇒ المريض وحده مخالف: الخطأ في patient_id'
    when d.organization_id is distinct from a.organization_id
      then '⇒ الطبيب وحده مخالف: الخطأ في doctor_id'
    else '—'
  end                                                 as التشخيص,
  (select count(*) from patient_visits  v where v.appointment_id = a.id) as زيارات,
  (select count(*) from sales_invoices  s where s.appointment_id = a.id) as فواتير,
  u.email                                             as أنشأه
from appointments a
left join patients      p  on p.id  = a.patient_id
left join doctors       d  on d.id  = a.doctor_id
left join clinics       c  on c.id  = a.clinic_id
left join organizations oa on oa.id = a.organization_id
left join organizations op on op.id = p.organization_id
left join organizations od on od.id = d.organization_id
left join organizations oc on oc.id = c.organization_id
left join auth.users    u  on u.id  = a.created_by
where p.organization_id is distinct from a.organization_id
   or d.organization_id is distinct from a.organization_id
   or (a.clinic_id is not null and c.organization_id is distinct from a.organization_id)
order by a.created_at;

-- (2) هل هي مواعيد متعددة أم موعد واحد يجمع المخالفتين؟
select count(*) as عدد_المواعيد_المخالفة
from appointments a
left join patients p on p.id = a.patient_id
left join doctors  d on d.id = a.doctor_id
where p.organization_id is distinct from a.organization_id
   or d.organization_id is distinct from a.organization_id;

-- (3) حجم كل منشأة — لمعرفة أيّها المنشأة "الحقيقية" وأيّها بقايا تجربة
select o.name as المنشأة, o.id::text as المعرّف,
       (select count(*) from patients     where organization_id=o.id) as مرضى,
       (select count(*) from doctors      where organization_id=o.id) as أطباء,
       (select count(*) from appointments where organization_id=o.id) as مواعيد,
       (select count(*) from sales_invoices where organization_id=o.id) as فواتير,
       (select count(*) from organization_memberships where organization_id=o.id) as أعضاء
from organizations o order by o.created_at;
