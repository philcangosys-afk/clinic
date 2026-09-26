-- ============================================================================
-- 0192 — جدول المواعيد: من يعمل ومتى، بتوقيت العيادة، لكلّ الأطباء دفعةً واحدة
-- ============================================================================
--
-- «حجز موعد جديد» من ملفّ المريض يفتح شبكة اليوم: عمودٌ لكلّ طبيب وصفٌّ لكلّ
-- ربع ساعة، والمتاح ظاهرٌ من غير المتاح. وهذا يحتاج شيئين من القاعدة:
--
-- ── ١) الدوام الأسبوعيّ بتوقيت الرياض لا بتوقيت الخادم ──────────────────────
--
-- `app_doctor_working_ranges` (0135) تحوّل «08:00» في الجدول الأسبوعيّ إلى
-- وقتٍ بـ`(p_date + start_time)::timestamptz` — أي **بمنطقة جلسة القاعدة**،
-- وهي UTC في Supabase ما لم تُغيَّر. فدوامٌ مكتوبٌ «08:00–16:00» يصير في
-- القاعدة 11:00–19:00 بتوقيت الرياض: يُرفض موعد التاسعة «خارج الدوام» ويُقبل
-- موعد السادسة مساءً. الآن التحويل صريح: `at time zone 'Asia/Riyadh'`، وهو
-- المنطق نفسه الذي تستعمله 0174 و0181. وإن كانت منطقة القاعدة الرياض سلفًا
-- فالنتيجة لا تتغيّر.
--
-- **ودوامٌ يعبر منتصف الليل** (16:00 → 00:00، أو 22:00 → 02:00) كان يُنتج
-- فترةً نهايتها قبل بدايتها فلا تغطّي شيئًا. الآن تنتهي في اليوم التالي.
--
-- و`app_check_doctor_availability` تأخذ تاريخ الموعد بتوقيت الرياض كذلك —
-- موعد الواحدة فجرًا كان يُحسب بتاريخ الأمس بتوقيت UTC — وتنظر في دوام
-- اليوم السابق أيضًا ليُغطّى ما بعد منتصف الليل.
--
-- ── ٢) `app_doctors_day_availability` — يومٌ كامل لكلّ الأطباء في نداء ────
--
-- ترسم الشبكة من جوابٍ واحد بالقاعدة نفسها التي يُحكم بها الحجز:
--   * `work`     — فترات الدوام (الأسبوعيّ أو الاستثنائيّ)
--   * `off`      — للطبيب جدولٌ ساري ولا دوام له هذا اليوم ⇒ لا يعمل
--   * `blocked`  — إجازة أو تدريب أو طارئ مسجَّل، أو إجازة معتمَدة من الموارد البشرية
-- والطبيب بلا جدولٍ أصلًا لا يُعاد له شيء: اليوم كلّه متاح، كما تحكم
-- `app_check_doctor_availability` بالضبط. فلا يظهر وقتٌ متاحًا ثمّ يُرفض حجزه.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) الدوام بتوقيت الرياض ────────────────────────────────────────────────
create or replace function public.app_doctor_working_ranges(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  clinic_id uuid,
  slot_duration_minutes int,
  capacity int,
  source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with custom as (
    select h.starts_at, h.ends_at, h.clinic_id,
           null::int as slot_duration_minutes, 1 as capacity, 'exception'::text as source
      from public.doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.exception_type = 'custom_hours'
       and (h.starts_at at time zone 'Asia/Riyadh')::date <= p_date
       and (h.ends_at at time zone 'Asia/Riyadh')::date >= p_date
       and (p_clinic_id is null or h.clinic_id is null or h.clinic_id = p_clinic_id)
  ),
  recurring as (
    select ((p_date + s.start_time) at time zone 'Asia/Riyadh') as starts_at,
           -- دوامٌ ينتهي بعد منتصف الليل (22:00 → 02:00) ينتهي في اليوم التالي
           ((p_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end)
              at time zone 'Asia/Riyadh') as ends_at,
           s.clinic_id,
           s.slot_duration_minutes,
           s.capacity,
           case s.recurrence_type
             when 'alternate_days' then 'alternate_days'
             else 'schedule'
           end::text as source
      from public.doctor_schedules s
     where s.doctor_id = p_doctor_id
       and s.is_active
       and s.effective_from <= p_date
       and (s.effective_to is null or s.effective_to >= p_date)
       and (p_clinic_id is null or s.clinic_id is null or s.clinic_id = p_clinic_id)
       and (
         (s.recurrence_type = 'weekly' and s.day_of_week = extract(isodow from p_date)::int)
         or (
           s.recurrence_type = 'alternate_days'
           and p_date >= s.pattern_anchor_date
           and mod(p_date - s.pattern_anchor_date, 2) = 0
         )
       )
  )
  select * from custom
  union all
  select * from recurring where not exists (select 1 from custom);
$$;

revoke all on function public.app_doctor_working_ranges(uuid, date, uuid) from public, anon;
grant execute on function public.app_doctor_working_ranges(uuid, date, uuid) to authenticated;

-- ── 2) فحص التوفّر بتاريخ الرياض ───────────────────────────────────────────
create or replace function public.app_check_doctor_availability(
  p_doctor_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor public.doctors%rowtype;
  v_block text;
  v_uncovered boolean;
  v_has_hours boolean;
  v_has_schedule boolean;
  v_leave_end date;
begin
  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null then return 'الطبيب غير موجود'; end if;

  if not public.app_is_member(v_doctor.organization_id)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings setting
           join public.clinics clinic
             on clinic.id = v_doctor.clinic_id
            and clinic.organization_id = setting.organization_id
            and clinic.branch_id = setting.branch_id
          where setting.organization_id = v_doctor.organization_id
            and setting.is_enabled
            and clinic.allows_online_booking
            and not clinic.is_disabled
       )
     ) then
    return 'لا صلاحية';
  end if;

  if not v_doctor.is_enabled then return 'الطبيب غير مفعَّل'; end if;
  if v_doctor.disabled_from_booking then return 'الطبيب موقوف عن استقبال الحجوزات'; end if;

  select case hours.exception_type
           when 'leave' then 'الطبيب في إجازة'
           when 'vacation' then 'الطبيب في إجازة سنوية'
           when 'training' then 'الطبيب في تدريب'
           when 'emergency' then 'حالة طارئة مسجَّلة على وقت الطبيب'
           else 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب'
         end
    into v_block
    from public.doctor_working_hours hours
   where hours.doctor_id = p_doctor_id
     and hours.is_blocked
     and tstzrange(hours.starts_at, hours.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1;

  if v_block is not null then return v_block; end if;

  select exists (
    select 1
      from generate_series((p_start at time zone 'Asia/Riyadh')::date, (p_end at time zone 'Asia/Riyadh')::date, interval '1 day') generated(day)
      cross join lateral public.app_doctor_working_ranges(p_doctor_id, generated.day::date, null) range
  ) into v_has_hours;

  select exists (
    select 1 from public.doctor_schedules schedule
     where schedule.doctor_id = p_doctor_id
       and schedule.is_active
       and schedule.effective_from <= (p_start at time zone 'Asia/Riyadh')::date
       and (schedule.effective_to is null or schedule.effective_to >= (p_start at time zone 'Asia/Riyadh')::date)
  ) into v_has_schedule;

  if v_has_schedule and not v_has_hours then
    return 'الطبيب لا يعمل في اليوم المختار';
  end if;

  if v_has_hours then
    select not isempty(
             tstzmultirange(tstzrange(p_start, p_end, '[)'))
             - coalesce(range_agg(tstzrange(range.starts_at, range.ends_at, '[)')), tstzmultirange())
           )
      into v_uncovered
      -- من اليوم السابق: دوامٌ يعبر منتصف الليل يغطّي أوّل ساعات اليوم التالي
      from generate_series((p_start at time zone 'Asia/Riyadh')::date - 1, (p_end at time zone 'Asia/Riyadh')::date, interval '1 day') generated(day)
      cross join lateral public.app_doctor_working_ranges(p_doctor_id, generated.day::date, null) range;

    if coalesce(v_uncovered, true) then return 'الوقت المختار خارج دوام الطبيب المسجَّل'; end if;
  end if;

  select request.end_date into v_leave_end
    from public.leave_requests request
    join public.employees employee on employee.id = request.employee_id
   where employee.user_id = v_doctor.user_id
     and employee.organization_id = v_doctor.organization_id
     and request.status = 'approved'
     and daterange(request.start_date, request.end_date, '[]')
         && daterange((p_start at time zone 'Asia/Riyadh')::date, (p_end at time zone 'Asia/Riyadh')::date, '[]')
   order by request.end_date desc
   limit 1;

  if v_leave_end is not null then
    return format('الطبيب في إجازة معتمَدة حتى %s', to_char(v_leave_end, 'YYYY-MM-DD'));
  end if;

  return null;
end;
$$;

revoke all on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz) to authenticated;

-- ── 3) توفّر كلّ الأطباء في يوم ────────────────────────────────────────────
create or replace function public.app_doctors_day_availability(
  p_organization_id uuid,
  p_date            date
)
returns table (
  doctor_id uuid,
  kind      text,
  starts_at timestamptz,
  ends_at   timestamptz,
  label     text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_day_start timestamptz := (p_date::timestamp at time zone 'Asia/Riyadh');
  v_day_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Riyadh');
begin
  if not public.app_is_member(p_organization_id) then
    raise exception 'لا صلاحية على هذه المنشأة';
  end if;

  return query
  with docs as (
    select d.id, d.user_id
      from public.doctors d
     where d.organization_id = p_organization_id
       and d.is_enabled
       and not d.disabled_from_booking
  ),
  work as (
    select docs.id as doctor_id, r.starts_at, r.ends_at
      from docs
      cross join lateral public.app_doctor_working_ranges(docs.id, p_date, null) r
  )
  -- فترات الدوام
  select w.doctor_id, 'work'::text, w.starts_at, w.ends_at, null::text
    from work w
  union all
  -- له جدولٌ ساري ولا دوام اليوم ⇒ لا يعمل
  select docs.id, 'off'::text, v_day_start, v_day_end, 'لا يعمل في هذا اليوم'::text
    from docs
   where exists (select 1 from public.doctor_schedules s
                  where s.doctor_id = docs.id
                    and s.is_active
                    and s.effective_from <= p_date
                    and (s.effective_to is null or s.effective_to >= p_date))
     and not exists (select 1 from work w where w.doctor_id = docs.id)
  union all
  -- المنع المسجَّل على وقت الطبيب
  select h.doctor_id, 'blocked'::text, h.starts_at, h.ends_at,
         coalesce(nullif(btrim(h.note), ''),
                  case h.exception_type
                    when 'leave'     then 'إجازة'
                    when 'vacation'  then 'إجازة سنوية'
                    when 'training'  then 'تدريب'
                    when 'emergency' then 'طارئ'
                    else 'غير متاح'
                  end)
    from public.doctor_working_hours h
    join docs on docs.id = h.doctor_id
   where h.is_blocked
     and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(v_day_start, v_day_end, '[)')
  union all
  -- إجازة معتمَدة من الموارد البشرية لموظّف الطبيب
  select docs.id, 'blocked'::text, v_day_start, v_day_end, 'إجازة معتمَدة'::text
    from docs
    join public.employees e on e.user_id = docs.user_id and e.organization_id = p_organization_id
    join public.leave_requests lr on lr.employee_id = e.id
   where docs.user_id is not null
     and lr.status = 'approved'
     and p_date between lr.start_date and lr.end_date;
end $$;

revoke all on function public.app_doctors_day_availability(uuid, date) from public, anon;
grant execute on function public.app_doctors_day_availability(uuid, date) to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'app_doctors_day_availability') then
    raise exception 'app_doctors_day_availability لم تُنشأ';
  end if;
  raise notice '0192 ✓ الدوام بتوقيت الرياض، وتوفّر الأطباء اليوميّ جاهز';
end $$;
