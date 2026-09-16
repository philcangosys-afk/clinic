-- ---------------------------------------------------------------------------
-- 0161_queue_columns.sql — أعمدة الطابور التي تنقص الاستقبال
-- ---------------------------------------------------------------------------
-- شاشة الانتظار في نظام العيادات المرجعيّ تعرض على صفّ المريض الواحد كل ما
-- يحتاجه الموظّف ليقرّر بلا فتح ملفّ: هل عليه اتفاقية؟ هل عليه آجل؟ مَن
-- أرسله؟ أيّ نوع زيارة؟ هل عولج اليوم؟ وشاشتنا تعرض تسعة أعمدة منها اثنان
-- فقط (التأمين والفاتورة)، فيُغادر الموظّف الطابور إلى ملفّ المريض ويعود —
-- وفي أثناء غيابه يتقدّم الدور.
--
-- الأعمدة كلّها **مشتقّة من بيانات قائمة**، لا عمود جديد على `appointments`:
--
--   • `patient_name_en`  — `patients.name_en` (موجود منذ 0001)
--   • `visit_type_name`  — `appointments.visit_type_value_id` ← `lookup_values`
--   • `sent_by_email`    — `appointments.sent_by_user_id` ← `auth.users`
--   • `agreement_remaining` — مجموع متبقّي اتفاقيات المريض غير المعطَّلة
--   • `deferred_amount`  — مجموع متبقّي فواتير البيع غير الملغاة للمريض
--   • `treated_today`    — للموعد زيارةٌ أُغلقت أو وُقِّعت
--   • `service_name`     — `appointments.item_id` ← `items`
--   • `note_text`        — نسخةٌ صريحة من `note` (العمود موجود سلفًا باسم
--                          `note`؛ لا يُكرَّر — يُستعمل كما هو)
--
-- **«عولج» تعني أُغلقت الزيارة أو وُقِّعت، لا أنّ المريض دخل الغرفة.** الدخول
-- حالةٌ في الطابور (`in_progress`)، والعلاج واقعةٌ في السجلّ الطبّي. خلطهما
-- يجعل العمود يقول «عولج» لمريضٍ جالسٍ في الكرسي لم يُكتب له شيء بعد.
--
-- **ترتيب التنفيذ داخل الملفّ مقصود:** `v_reception_queue_ordered` كُتب في
-- 0065 بـ`q.*`، فعمودُه مُثبَّتٌ عند الإنشاء ولن ينمو تلقائيًا؛ ولا يمكن
-- `create or replace` له بعد اتّساع الأساس لأنّ الأعمدة الجديدة تُقحَم قبل
-- `priority_rank` فيتغيّر الترتيب. فيُحذف أوّلًا ثم يُعاد بناؤه.
-- `v_reception_queue_by_doctor` (0158) يسمّي أعمدته صراحةً فلا يتأثّر.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) إسقاط المنظور التابع قبل توسيع الأساس
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists v_reception_queue_ordered;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) منظور الطابور — أعمدة 0065 حرفيًا، والجديد مُلحَقٌ في الذيل
--
-- الأعمدة الأصلية بأسمائها وترتيبها كما هي: أيّ إزاحةٍ فيها تكسر
-- `v_reception_queue_by_doctor` وكلّ استعلامٍ في الواجهة يسمّي عمودًا.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_reception_queue as
select
  a.id                       as appointment_id,
  a.organization_id,
  a.branch_id,
  a.queue_number,
  a.status,
  a.priority,
  a.scheduled_start,
  a.checked_in_1_at          as arrived_at,
  a.checked_in_2_at          as checked_in_at,
  a.called_at,
  a.entered_at,
  a.left_at,
  a.note,
  p.id                       as patient_id,
  p.name_ar                  as patient_name,
  p.file_number,
  p.mobile_number,
  p.blood_type,
  p.insurance_company_name,
  (p.insurance_company_name is not null
     and (p.insurance_membership_expiry is null
          or p.insurance_membership_expiry >= current_date))            as insurance_valid,
  d.id                       as doctor_id,
  d.name_ar                  as doctor_name,
  c.id                       as clinic_id,
  c.name                     as clinic_name,

  (select string_agg(h.name_ar, '، ' order by h.sort_order)
     from patient_health_conditions phc
     join health_conditions h on h.id = phc.condition_id
    where phc.patient_id = p.id and phc.is_checked)                     as medical_alert,

  case
    when a.checked_in_1_at is null then null
    else floor(extract(epoch from (coalesce(a.called_at, now()) - a.checked_in_1_at)) / 60)::integer
  end                                                                   as waiting_minutes,

  inv.invoice_id,
  inv.invoice_status,
  inv.remaining_amount,

  -- ── ما بعد هذا السطر إضافة 0161 ──────────────────────────────────────────

  -- الاسم الإنجليزي: يُطبع على التذكرة ويُقرأ في المطالبات، والاستقبال يحتاجه
  -- حين يكون الاسم العربي مكرَّرًا بين مريضين.
  p.name_en                  as patient_name_en,

  -- نوع الزيارة: «كشف»، «مراجعة»، «متابعة» — يغيّر الأولوية والسعر معًا.
  vt.name_ar                 as visit_type_name,

  -- مَن أرسل المريض إلى الطبيب. العمود `sent_by_user_id` موجود منذ 0002؛
  -- الاسم غير مخزَّن في المشروع (لا جدول ملفّات مستخدمين) والبريد هو المعرّف
  -- المعروض في سجلّ التدقيق منذ 0037 — فيُعرض هو، لا اسمٌ مُختلق.
  su.email                   as sent_by_email,

  -- الاتفاقيات: متبقّي اتفاقيات المريض كلّها، لا اتفاقية هذا الموعد. الموظّف
  -- يحتاج أن يعرف أنّ على المريض التزامًا قبل أن يفتح له فاتورةً نقدية.
  coalesce(agr.remaining_total, 0)                                      as agreement_remaining,

  -- الآجل: متبقّي فواتير البيع غير الملغاة وغير المؤقّتة. عرض السعر ليس دَينًا
  -- والفاتورة الملغاة ليست دَينًا — ضمّهما يجعل العمود يتّهم مريضًا بريئًا.
  coalesce(dbt.deferred_total, 0)                                       as deferred_amount,

  -- عولج: للموعد زيارةٌ أُغلقت أو وُقِّعت. انظر ترويسة الملفّ.
  exists (
    select 1 from patient_visits pv
     where pv.appointment_id = a.id
       and (pv.closed_at is not null or pv.signed_at is not null)
  )                                                                     as treated,

  -- الخدمة المحجوزة على الموعد إن حُجزت بخدمةٍ بعينها.
  it.name_ar                 as service_name

from appointments a
join patients p on p.id = a.patient_id
join doctors  d on d.id = a.doctor_id
left join clinics c on c.id = a.clinic_id
left join lookup_values vt on vt.id = a.visit_type_value_id
left join items it on it.id = a.item_id
left join auth.users su on su.id = a.sent_by_user_id
left join lateral (
  select s.id as invoice_id, s.status as invoice_status, s.remaining_amount
    from sales_invoices s
   where s.appointment_id = a.id and s.invoice_type = 'sale'
   order by s.created_at desc
   limit 1
) inv on true
left join lateral (
  select sum(coalesce(ta.remaining_amount, 0)) as remaining_total
    from treatment_agreements ta
   where ta.patient_id = p.id
     and coalesce(ta.is_disabled, false) = false
     and coalesce(ta.remaining_amount, 0) > 0
) agr on true
left join lateral (
  select sum(coalesce(s2.remaining_amount, 0)) as deferred_total
    from sales_invoices s2
   where s2.patient_id = p.id
     and s2.invoice_type = 'sale'
     and coalesce(s2.status, '') <> 'void'
     and coalesce(s2.is_temporary, false) = false
     and coalesce(s2.remaining_amount, 0) > 0
) dbt on true
where a.status in ('confirmed','arrived','checked_in','called','in_progress','walk_in','waiting');

alter view v_reception_queue set (security_invoker = on);
revoke all on v_reception_queue from anon;
grant select on v_reception_queue to authenticated;

comment on view v_reception_queue is
  'طابور الاستقبال: صفٌّ لكل موعدٍ حاضر، بوقت الانتظار والتنبيه الطبّي والتأمين والفاتورة، ومنذ 0161 بالاسم الإنجليزي ونوع الزيارة والمرسل ومتبقّي الاتفاقيات والآجل وهل عولج والخدمة.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) إعادة بناء المنظور المرتَّب — `q.*` يلتقط الأعمدة الجديدة الآن
-- ═══════════════════════════════════════════════════════════════════════════
create view v_reception_queue_ordered as
select q.*,
       app_queue_rank(q.priority) as priority_rank,
       coalesce(rs.waiting_warning_minutes, 20)  as warning_minutes,
       coalesce(rs.waiting_critical_minutes, 40) as critical_minutes,
       case
         when q.waiting_minutes is null then 'none'
         when q.waiting_minutes >= coalesce(rs.waiting_critical_minutes, 40) then 'critical'
         when q.waiting_minutes >= coalesce(rs.waiting_warning_minutes, 20)  then 'warning'
         else 'ok'
       end as waiting_state
from v_reception_queue q
left join reception_settings rs on rs.organization_id = q.organization_id
order by
  app_queue_rank(q.priority),
  q.arrived_at nulls last,
  q.scheduled_start;

alter view v_reception_queue_ordered set (security_invoker = on);
revoke all on v_reception_queue_ordered from anon;
grant select on v_reception_queue_ordered to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) تعديل ملاحظة الموعد من الطابور
--
-- «تعديل الملاحظة المسجلة» في قائمة الزرّ الأيمن. تُكتب دالّة بدل `update`
-- مباشر من المتصفّح لسببين: الملاحظة تُمسح بالخطأ إن أُرسل نصٌّ فارغ من حقلٍ
-- لم يُحمَّل بعد، والتعديل يجب أن يترك أثرًا في `updated_at` ليُعرف أنّه
-- تغيّر. والدالّة تتحقّق من الصلاحية بنفسها: `security definer` بلا تحقّقٍ
-- يفتح كلّ مواعيد كلّ المؤسّسات.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_set_appointment_note(
  p_appointment_id uuid,
  p_note           text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_affected integer;
begin
  select organization_id into v_org from appointments where id = p_appointment_id;
  if v_org is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا تملك الوصول إلى هذا الموعد';
  end if;
  if not app_has_permission(v_org, 'appointments.update') then
    raise exception 'لا تملك صلاحية تعديل المواعيد';
  end if;

  update appointments
     set note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_appointment_id;

  -- PostgREST لا يعدّ «لم يتغيّر أيّ صفّ» خطأً؛ الفحص هنا لا في المتصفّح.
  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'تعذّر تعديل الملاحظة — لم يتغيّر أيّ صفّ';
  end if;
end;
$$;

comment on function app_set_appointment_note(uuid, text) is
  'تعديل ملاحظة الموعد من شاشة الاستقبال، بتحقّقٍ من العضوية وصلاحية appointments.update.';

revoke all on function app_set_appointment_note(uuid, text) from public, anon;
grant execute on function app_set_appointment_note(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0161_queue_columns.sql
-- ---------------------------------------------------------------------------
