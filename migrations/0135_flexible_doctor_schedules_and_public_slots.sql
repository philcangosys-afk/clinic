begin;

alter table public.doctor_schedules
  add column if not exists recurrence_type text not null default 'weekly',
  add column if not exists pattern_anchor_date date;

alter table public.doctor_schedules
  drop constraint if exists doctor_schedules_recurrence_check;
alter table public.doctor_schedules
  add constraint doctor_schedules_recurrence_check
  check (
    recurrence_type in ('weekly', 'alternate_days')
    and (recurrence_type = 'weekly' or pattern_anchor_date is not null)
  );

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
       and h.starts_at::date <= p_date
       and h.ends_at::date >= p_date
       and (p_clinic_id is null or h.clinic_id is null or h.clinic_id = p_clinic_id)
  ),
  recurring as (
    select (p_date + s.start_time)::timestamptz as starts_at,
           (p_date + s.end_time)::timestamptz as ends_at,
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

create or replace function public.app_doctor_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null,
  p_duration int default null
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  clinic_id uuid,
  capacity int,
  booked int,
  is_free boolean,
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
  select organization_id into v_org from public.doctors where id = p_doctor_id;
  if v_org is null then return; end if;

  if not public.app_is_member(v_org)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings setting
           join public.clinics clinic
             on clinic.id = p_clinic_id
            and clinic.organization_id = setting.organization_id
            and clinic.branch_id = setting.branch_id
          where setting.organization_id = v_org
            and setting.is_enabled
            and clinic.allows_online_booking
            and not clinic.is_disabled
       )
     ) then
    return;
  end if;

  return query
  with ranges as (
    select * from public.app_doctor_working_ranges(p_doctor_id, p_date, p_clinic_id)
  ),
  slots as (
    select
      generated.slot_start,
      generated.slot_start + make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15)) as slot_end,
      range.clinic_id,
      range.capacity
    from ranges range
    cross join lateral generate_series(
      range.starts_at,
      range.ends_at - make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15)),
      make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15))
    ) generated(slot_start)
  )
  select
    slot.slot_start,
    slot.slot_end,
    slot.clinic_id,
    slot.capacity,
    coalesce(appointment_count.taken, 0)::int,
    coalesce(appointment_count.taken, 0) < slot.capacity and block.reason is null,
    block.reason
  from slots slot
  left join lateral (
    select count(*)::int as taken
      from public.appointments appointment
     where appointment.doctor_id = p_doctor_id
       and appointment.status not in ('cancelled_by_patient', 'cancelled_by_staff', 'no_show')
       and tstzrange(appointment.scheduled_start, appointment.scheduled_end, '[)')
           && tstzrange(slot.slot_start, slot.slot_end, '[)')
  ) appointment_count on true
  left join lateral (
    select case hours.exception_type
             when 'leave' then 'إجازة'
             when 'vacation' then 'إجازة سنوية'
             when 'training' then 'تدريب'
             when 'emergency' then 'طارئ'
             else 'محجوب'
           end as reason
      from public.doctor_working_hours hours
     where hours.doctor_id = p_doctor_id
       and hours.is_blocked
       and tstzrange(hours.starts_at, hours.ends_at, '[)')
           && tstzrange(slot.slot_start, slot.slot_end, '[)')
     limit 1
  ) block on true
  order by slot.slot_start;
end;
$$;

revoke all on function public.app_doctor_available_slots(uuid, date, uuid, int) from public, anon;
grant execute on function public.app_doctor_available_slots(uuid, date, uuid, int) to authenticated;

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
      from generate_series(p_start::date, p_end::date, interval '1 day') generated(day)
      cross join lateral public.app_doctor_working_ranges(p_doctor_id, generated.day::date, null) range
  ) into v_has_hours;

  select exists (
    select 1 from public.doctor_schedules schedule
     where schedule.doctor_id = p_doctor_id
       and schedule.is_active
       and schedule.effective_from <= p_start::date
       and (schedule.effective_to is null or schedule.effective_to >= p_start::date)
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
      from generate_series(p_start::date, p_end::date, interval '1 day') generated(day)
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
         && daterange(p_start::date, p_end::date, '[]')
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

create or replace function public.app_public_doctor_slots(
  p_slug text,
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_item_id uuid,
  p_from date default current_date,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_duration int;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;
  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;

  select coalesce(item.duration_minutes, doctor.default_appointment_duration_minutes, clinic.default_visit_duration, 30)
    into v_duration
    from public.doctors doctor
    join public.clinics clinic
      on clinic.id = p_clinic_id
     and clinic.organization_id = doctor.organization_id
     and clinic.branch_id = v_setting.branch_id
     and clinic.allows_online_booking
     and not clinic.is_disabled
    join public.items item
      on item.id = p_item_id
     and item.organization_id = doctor.organization_id
     and item.default_clinic_id = clinic.id
     and item.item_type = 'service'
     and item.medical_service_type = 'dental'
     and not item.is_disabled
     and not item.is_archived
   where doctor.id = p_doctor_id
     and doctor.organization_id = v_setting.organization_id
     and doctor.clinic_id = clinic.id
     and doctor.is_enabled
     and not doctor.disabled_from_booking;

  if v_duration is null then raise exception 'الطبيب أو الخدمة غير متاحين للحجز'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'start', available.slot_start,
           'end', available.slot_end,
           'date', to_char(available.slot_start, 'YYYY-MM-DD')
         ) order by available.slot_start), '[]'::jsonb)
    into v_result
    from generate_series(
      greatest(p_from, current_date),
      greatest(p_from, current_date) + least(greatest(coalesce(p_days, 30), 1), 60) - 1,
      interval '1 day'
    ) generated(day)
    cross join lateral public.app_doctor_available_slots(
      p_doctor_id,
      generated.day::date,
      p_clinic_id,
      v_duration
    ) available
   where available.is_free
     and available.slot_start >= now() + interval '1 hour';

  return jsonb_build_object('duration_minutes', v_duration, 'slots', v_result);
end;
$$;

revoke all on function public.app_public_doctor_slots(text, uuid, uuid, uuid, date, int) from public;
grant execute on function public.app_public_doctor_slots(text, uuid, uuid, uuid, date, int) to anon, authenticated;

commit;
