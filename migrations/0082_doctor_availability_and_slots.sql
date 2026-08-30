-- 0082_doctor_availability_and_slots.sql
-- التوفّر والأوقات المتاحة بعد إدخال الجدول الأسبوعي.
--
-- `app_check_doctor_availability` (0064) تعرف مصدرًا واحدًا لدوام الطبيب:
-- `doctor_working_hours` بفتراته المؤرَّخة. بعد 0081 صار الدوام الأساسي في
-- `doctor_schedules` المتكرّر — ولو تُركت الدالة كما هي لكان طبيبٌ له جدول
-- أسبوعي كامل **بلا دوام مسجَّل** في نظرها، فتقبل أي وقت في أي يوم.
--
-- هذا الملف يجعلها تقرأ المصدرين، ويضيف توليد الأوقات المتاحة.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) فترات دوام الطبيب في يوم بعينه
--
-- تُعيد الفترات الفعلية بعد دمج المصدرين:
--   • الجدول الأسبوعي المتكرّر السارية فترته على هذا التاريخ،
--   • وفترات `custom_hours` المؤرَّخة (دوام استثنائي ليوم واحد).
--
-- **الاستثناء يلغي المتكرّر في يومه.** يومٌ سُجِّل له دوام خاص يعني أن
-- الطبيب غيّر دوامه ذلك اليوم، لا أنه يعمل الدوامين معًا.
-- ---------------------------------------------------------------------------
create or replace function app_doctor_working_ranges(
  p_doctor_id uuid,
  p_date      date,
  p_clinic_id uuid default null
)
returns table (starts_at timestamptz, ends_at timestamptz, clinic_id uuid,
               slot_duration_minutes int, capacity int, source text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with custom as (
    select h.starts_at, h.ends_at, h.clinic_id,
           null::int as slot_duration_minutes, 1 as capacity, 'exception'::text as source
      from doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.exception_type = 'custom_hours'
       and h.starts_at::date <= p_date and h.ends_at::date >= p_date
       and (p_clinic_id is null or h.clinic_id is null or h.clinic_id = p_clinic_id)
  ),
  recurring as (
    select (p_date + s.start_time)::timestamptz as starts_at,
           (p_date + s.end_time)::timestamptz   as ends_at,
           s.clinic_id,
           s.slot_duration_minutes,
           s.capacity,
           'schedule'::text as source
      from doctor_schedules s
     where s.doctor_id = p_doctor_id
       and s.is_active
       and s.day_of_week = extract(isodow from p_date)::int
       and s.effective_from <= p_date
       and (s.effective_to is null or s.effective_to >= p_date)
       and (p_clinic_id is null or s.clinic_id is null or s.clinic_id = p_clinic_id)
  )
  select * from custom
  union all
  select * from recurring where not exists (select 1 from custom);
$$;

revoke all on function app_doctor_working_ranges(uuid, date, uuid) from public, anon;
grant execute on function app_doctor_working_ranges(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) فحص التوفّر — يقرأ المصدرين
--
-- تُعيد `null` عند التوفّر، ونصَّ السبب عند المنع. الاتجاه مقصود: من يستدعيها
-- يكتب `if msg is not null then reject`، وهو أوضح من قيمة منطقية لا تشرح.
-- ---------------------------------------------------------------------------
create or replace function app_check_doctor_availability(
  p_doctor_id uuid,
  p_start     timestamptz,
  p_end       timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor    doctors%rowtype;
  v_block     text;
  v_uncovered boolean;
  v_has_hours boolean;
  v_leave_end date;
begin
  select * into v_doctor from doctors where id = p_doctor_id;
  if v_doctor.id is null then
    return 'الطبيب غير موجود';
  end if;
  if not app_is_member(v_doctor.organization_id) then
    return 'لا صلاحية';
  end if;
  if not v_doctor.is_enabled then
    return 'الطبيب غير مفعَّل';
  end if;
  if v_doctor.disabled_from_booking then
    return 'الطبيب موقوف عن استقبال الحجوزات';
  end if;

  -- فترة منع صريحة (إجازة، تدريب، طارئ، حجب) تتقاطع مع الموعد
  select case h.exception_type
           when 'leave'     then 'الطبيب في إجازة'
           when 'vacation'  then 'الطبيب في إجازة سنوية'
           when 'training'  then 'الطبيب في تدريب'
           when 'emergency' then 'حالة طارئة مسجَّلة على وقت الطبيب'
           else 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب'
         end
    into v_block
    from doctor_working_hours h
   where h.doctor_id = p_doctor_id
     and h.is_blocked
     and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1;

  if v_block is not null then
    return v_block;
  end if;

  -- الدوام: من الجدول الأسبوعي والاستثناءات معًا
  --
  -- الموعد قد يعبر منتصف الليل، فتُجمع فترات اليومين. طرحُ اتحاد الفترات من
  -- مدى الموعد يكشف أي جزء غير مغطّى — والطرح لا المقارنة بفترة واحدة، لأن
  -- الدوام قد يكون صباحيًا ومسائيًا والموعد يعبر بينهما.
  select exists (
    select 1
      from generate_series(p_start::date, p_end::date, interval '1 day') g(d)
      cross join lateral app_doctor_working_ranges(p_doctor_id, g.d::date, null) r
  ) into v_has_hours;

  if v_has_hours then
    select not isempty(
             tstzmultirange(tstzrange(p_start, p_end, '[)'))
             - coalesce(range_agg(tstzrange(r.starts_at, r.ends_at, '[)')), tstzmultirange())
           )
      into v_uncovered
      from generate_series(p_start::date, p_end::date, interval '1 day') g(d)
      cross join lateral app_doctor_working_ranges(p_doctor_id, g.d::date, null) r;

    if coalesce(v_uncovered, true) then
      return 'الوقت المختار خارج دوام الطبيب المسجَّل';
    end if;
  end if;

  -- الإجازة المعتمَدة من نظام الموارد البشرية
  select l.end_date into v_leave_end
    from leave_requests l
    join employees e on e.id = l.employee_id
   where e.user_id = v_doctor.user_id
     and e.organization_id = v_doctor.organization_id
     and l.status = 'approved'
     and daterange(l.start_date, l.end_date, '[]')
         && daterange(p_start::date, p_end::date, '[]')
   order by l.end_date desc
   limit 1;

  if v_leave_end is not null then
    return format('الطبيب في إجازة معتمَدة حتى %s', to_char(v_leave_end, 'YYYY-MM-DD'));
  end if;

  return null;
end;
$$;

revoke all on function app_check_doctor_availability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app_check_doctor_availability(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) الأوقات المتاحة في يوم
--
-- تُعيد كل فتحة مع عدد المحجوز فيها وسعتها، فتقرّر الشاشة العرض. حساب
-- «متاح/غير متاح» هنا لا في المتصفّح: الحساب هناك يقرأ مواعيد قد تكون
-- تغيّرت بين التحميل والضغط.
-- ---------------------------------------------------------------------------
create or replace function app_doctor_available_slots(
  p_doctor_id uuid,
  p_date      date,
  p_clinic_id uuid default null,
  p_duration  int default null
)
returns table (
  slot_start timestamptz,
  slot_end   timestamptz,
  clinic_id  uuid,
  capacity   int,
  booked     int,
  is_free    boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from doctors where id = p_doctor_id;
  if v_org is null or not app_is_member(v_org) then
    return;
  end if;

  return query
  with ranges as (
    select * from app_doctor_working_ranges(p_doctor_id, p_date, p_clinic_id)
  ),
  slots as (
    select
      g.s as slot_start,
      g.s + make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15)) as slot_end,
      r.clinic_id,
      r.capacity
    from ranges r
    cross join lateral generate_series(
      r.starts_at,
      r.ends_at - make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15)),
      make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15))
    ) g(s)
  )
  select
    s.slot_start,
    s.slot_end,
    s.clinic_id,
    s.capacity,
    coalesce(a.taken, 0)::int,
    coalesce(a.taken, 0) < s.capacity and bl.reason is null,
    bl.reason
  from slots s
  left join lateral (
    select count(*)::int as taken
      from appointments ap
     where ap.doctor_id = p_doctor_id
       and ap.status not in ('cancelled_by_patient','cancelled_by_staff','no_show')
       and tstzrange(ap.scheduled_start, ap.scheduled_end, '[)')
           && tstzrange(s.slot_start, s.slot_end, '[)')
  ) a on true
  left join lateral (
    select case h.exception_type
             when 'leave'     then 'إجازة'
             when 'vacation'  then 'إجازة سنوية'
             when 'training'  then 'تدريب'
             when 'emergency' then 'طارئ'
             else 'محجوب'
           end as reason
      from doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.is_blocked
       and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(s.slot_start, s.slot_end, '[)')
     limit 1
  ) bl on true
  order by s.slot_start;
end;
$$;

revoke all on function app_doctor_available_slots(uuid, date, uuid, int) from public, anon;
grant execute on function app_doctor_available_slots(uuid, date, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) الموعد: الطبيب يجب أن يكون مرتبطًا بالعيادة
--
-- الشاشة تفلتر الأطباء بالعيادة، لكن الفلترة عرضٌ لا منع. من يستدعي
-- PostgREST مباشرةً يحجز أي طبيب في أي عيادة، فتظهر المواعيد في عيادة لا
-- يعمل فيها الطبيب أصلًا.
-- ---------------------------------------------------------------------------
create or replace function app_enforce_doctor_clinic_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if new.clinic_id is null or new.doctor_id is null then
    return new;
  end if;
  if new.status in ('walk_in','waiting') then
    return new;
  end if;

  -- الطبيب بلا ارتباطات مسجَّلة يُقبل في أي عيادة: نفس اتجاه «الغياب يعني
  -- الكل» في الفروع والخدمات، وإلا تعطّل الحجز لحظة تشغيل الهجرة.
  if not exists (select 1 from doctor_clinics dc
                  where dc.doctor_id = new.doctor_id and dc.is_active) then
    return new;
  end if;

  if not exists (
    select 1 from doctor_clinics dc
     where dc.doctor_id = new.doctor_id
       and dc.clinic_id = new.clinic_id
       and dc.is_active
  ) then
    select name_ar into v_name from doctors where id = new.doctor_id;
    raise exception 'الطبيب % غير مرتبط بهذه العيادة', coalesce(v_name, '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_doctor_clinic_link on appointments;
create trigger trg_doctor_clinic_link
  before insert or update of doctor_id, clinic_id on appointments
  for each row execute function app_enforce_doctor_clinic_link();

-- ---------------------------------------------------------------------------
-- 5) الترخيص المنتهي — تحذير لا منع
--
-- المنع الكامل يوقف عيادةً كاملة بسبب ورقة تُجدَّد، والموظف حينها يعطّل
-- الفحص لا يحترمه. التحذير يُسجَّل ويظهر، والقرار للمنشأة.
-- ---------------------------------------------------------------------------
create or replace function app_doctor_booking_warnings(p_doctor_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(w), '{}')
    from (
      select 'ترخيص الطبيب منتهٍ منذ ' || to_char(d.license_expiry_date, 'YYYY-MM-DD') as w
        from doctors d
       where d.id = p_doctor_id and app_is_member(d.organization_id)
         and d.license_expiry_date is not null and d.license_expiry_date < current_date
      union all
      select 'ترخيص الطبيب ينتهي خلال ' || (d.license_expiry_date - current_date) || ' يومًا'
        from doctors d
       where d.id = p_doctor_id and app_is_member(d.organization_id)
         and d.license_expiry_date is not null
         and d.license_expiry_date >= current_date
         and d.license_expiry_date < current_date + 30
      union all
      select 'تصنيف الطبيب منتهٍ منذ ' || to_char(d.classification_expiry_date, 'YYYY-MM-DD')
        from doctors d
       where d.id = p_doctor_id and app_is_member(d.organization_id)
         and d.classification_expiry_date is not null
         and d.classification_expiry_date < current_date
    ) x;
$$;

revoke all on function app_doctor_booking_warnings(uuid) from public, anon;
grant execute on function app_doctor_booking_warnings(uuid) to authenticated;

commit;
