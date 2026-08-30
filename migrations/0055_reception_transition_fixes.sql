-- ---------------------------------------------------------------------------
-- 0055_reception_transition_fixes.sql — إصلاح دورة الاستقبال
-- ---------------------------------------------------------------------------
-- ثلاثة عيوب في `app_reception_transition` (0050) ظهرت عند تنفيذ التسلسل
-- الكامل على قاعدة حقيقية:
--
--  1) **«بدء الزيارة» لا يعمل إطلاقًا** — وهو أهم إجراء في الشاشة.
--
--     الدالة معرَّفة `returns table (appointment_id uuid, ...)`، وهذا يُنشئ
--     متغيّر PL/pgSQL ضمنيًا اسمه `appointment_id`. وفي نفس الدالة:
--
--         on conflict (appointment_id) where appointment_id is not null
--
--     فيصطدم اسم المتغيّر باسم العمود:
--         ERROR: column reference "appointment_id" is ambiguous
--
--     النتيجة: الضغط على «بدء الزيارة» يفشل دائمًا، فتتوقف الرحلة عند النداء
--     ولا تُنشأ زيارة ولا يصل الطبيب إلى السجل الطبي. لا يظهر هذا في مراجعة
--     الشيفرة لأن الخطأ لا يقع إلا وقت التنفيذ.
--
--     الإصلاح: استبدال `on conflict` بفحص صريح — أوضح، ويزيل الالتباس من
--     أصله. ولا سباق: الدالة تُمسك الموعد بـ`for update` قبله، فتتسلسل
--     الاستدعاءات المتزامنة.
--
--  2) **لا إجراء `confirm`** — التسلسل المطلوب يبدأ بـ scheduled → confirmed،
--     ولا وجود لهذا الإجراء في الدالة، فتأكيد الموعد لا يمرّ عبرها.
--
--  3) **`no_show` يقبل بلا سبب** — `nullif(trim(p_reason),'')` يكتب NULL
--     بصمت. والسبب هو الفائدة الوحيدة من تسجيل عدم الحضور: بلا سببٍ لا يمكن
--     التمييز بين من نسي ومن أُلغي موعده هاتفيًا ولم يُسجَّل.
-- ---------------------------------------------------------------------------

create or replace function app_reception_transition(
  p_appointment_id uuid,
  p_action text,
  p_reason text default null
)
returns table (appointment_id uuid, appointment_status text, visit_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v             appointments%rowtype;
  v_visit_id    uuid;
  v_next_status text;
  v_queue       integer;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_role(v.organization_id,
        array['owner','organization_admin','branch_manager','receptionist','doctor','nurse']) then
    raise exception 'لا تملك صلاحية تنفيذ إجراء الاستقبال';
  end if;

  -- (جديد) تأكيد الموعد
  if p_action = 'confirm' and v.status in ('new','scheduled','unconfirmed') then
    update appointments
       set status = 'confirmed', updated_at = now()
     where id = v.id;
    v_next_status := 'confirmed';

  elsif p_action = 'arrive' and v.status in ('new','scheduled','confirmed','unconfirmed') then
    -- رقم الدور يُمنح مرة واحدة: إعادة تسجيل الوصول لا تُقدّم المريض في
    -- الطابور على من سبقه.
    if v.queue_number is null then
      select coalesce(max(a.queue_number), 0) + 1 into v_queue
        from appointments a
       where a.organization_id = v.organization_id
         and a.scheduled_start::date = v.scheduled_start::date;
    else
      v_queue := v.queue_number;
    end if;
    update appointments
       set status = 'arrived',
           checked_in_1_at = coalesce(checked_in_1_at, now()),
           queue_number = v_queue,
           updated_at = now()
     where id = v.id;
    v_next_status := 'arrived';

  elsif p_action = 'check_in' and v.status = 'arrived' then
    update appointments
       set status = 'checked_in', checked_in_2_at = coalesce(checked_in_2_at, now()), updated_at = now()
     where id = v.id;
    v_next_status := 'checked_in';

  elsif p_action = 'call' and v.status in ('arrived','checked_in','waiting','walk_in') then
    update appointments
       set status = 'called', called_at = coalesce(called_at, now()), updated_at = now()
     where id = v.id;
    v_next_status := 'called';

  elsif p_action = 'start' and v.status in ('called','checked_in','waiting','walk_in','arrived') then
    update appointments
       set status = 'in_progress', entered_at = coalesce(entered_at, now()), updated_at = now()
     where id = v.id;

    -- فحص صريح بدل `on conflict`: يزيل التباس الاسم، ويجعل السلوك مقروءًا.
    -- العمود مؤهَّل باسم الجدول (`pv.appointment_id`) فلا يلتبس بمتغيّر
    -- الإخراج مهما تغيّر توقيع الدالة لاحقًا.
    select pv.id into v_visit_id
      from patient_visits pv
     where pv.appointment_id = v.id;

    if v_visit_id is null then
      insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id, appointment_id, created_by)
      values (v.organization_id, v.patient_id, v.doctor_id, v.clinic_id, v.id, auth.uid())
      returning id into v_visit_id;
    else
      -- الزيارة قائمة (ضغطة ثانية، أو عودة بعد إنهاء): تُحدَّث ولا تُنشأ
      -- ثانية. الفهرس الفريد `idx_patient_visits_one_per_appointment` يضمن
      -- ذلك في القاعدة أيضًا.
      update patient_visits pv
         set doctor_id = v.doctor_id, clinic_id = v.clinic_id, updated_at = now()
       where pv.id = v_visit_id;
    end if;
    v_next_status := 'in_progress';

  elsif p_action = 'finish' and v.status = 'in_progress' then
    update appointments
       set status = 'completed', left_at = coalesce(left_at, now()), updated_at = now()
     where id = v.id;
    select pv.id into v_visit_id from patient_visits pv where pv.appointment_id = v.id;
    v_next_status := 'completed';

  elsif p_action = 'no_show' and v.status in ('new','scheduled','confirmed','unconfirmed','arrived') then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'سبب عدم الحضور مطلوب';
    end if;
    update appointments
       set status = 'no_show', no_show_reason = btrim(p_reason), updated_at = now()
     where id = v.id;
    v_next_status := 'no_show';

  else
    raise exception 'الإجراء % غير مسموح للحالة %', p_action, v.status;
  end if;

  return query select v.id, v_next_status, v_visit_id;
end;
$$;

revoke all on function app_reception_transition(uuid, text, text) from public, anon;
grant execute on function app_reception_transition(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- انتقال الحالة: السماح بـ confirmed ضمن المسارات المشروعة
--
-- مُحفِّز `app_validate_appointment_status_transition` (0050) يحرس الانتقالات
-- المباشرة. يُعاد ضبط خريطته لتشمل `confirm`، وإلا رفض المُحفِّز ما تسمح به
-- الدالة — فيتناقض الحارسان.
-- ---------------------------------------------------------------------------
create or replace function app_validate_appointment_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'new'          then array['scheduled','confirmed','unconfirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'scheduled'    then array['confirmed','unconfirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'unconfirmed'  then array['scheduled','confirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'confirmed'    then array['arrived','no_show','cancelled_by_patient','cancelled_by_staff','scheduled']
    when 'walk_in'      then array['waiting','called','in_progress','completed','no_show','cancelled_by_staff']
    when 'waiting'      then array['called','in_progress','completed','no_show','cancelled_by_staff']
    when 'arrived'      then array['checked_in','called','in_progress','no_show','cancelled_by_staff']
    when 'checked_in'   then array['called','in_progress','cancelled_by_staff']
    when 'called'       then array['in_progress','no_show','checked_in','cancelled_by_staff']
    when 'in_progress'  then array['completed','cancelled_by_staff']
    -- الحالات النهائية: لا انتقال منها. تصحيح موعد مُنهى يكون بموعد جديد
    -- لا بتحريك حالة قديمة — وإلا اختفى أثر ما حدث فعلًا من سجل التدقيق.
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'انتقال حالة الموعد غير مسموح: % إلى %', old.status, new.status;
  end if;
  return new;
end;
$$;
