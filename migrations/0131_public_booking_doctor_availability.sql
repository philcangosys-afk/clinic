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
  v_doctor doctors%rowtype;
  v_block text;
  v_uncovered boolean;
  v_has_hours boolean;
  v_leave_end date;
begin
  select * into v_doctor from doctors where id = p_doctor_id;
  if v_doctor.id is null then return 'الطبيب غير موجود'; end if;

  if not app_is_member(v_doctor.organization_id)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings s
           join public.clinics c
             on c.id = v_doctor.clinic_id
            and c.organization_id = s.organization_id
            and c.branch_id = s.branch_id
          where s.organization_id = v_doctor.organization_id
            and s.is_enabled
            and c.allows_online_booking
            and not c.is_disabled
       )
     ) then
    return 'لا صلاحية';
  end if;

  if not v_doctor.is_enabled then return 'الطبيب غير مفعَّل'; end if;
  if v_doctor.disabled_from_booking then return 'الطبيب موقوف عن استقبال الحجوزات'; end if;

  select case h.exception_type
           when 'leave' then 'الطبيب في إجازة'
           when 'vacation' then 'الطبيب في إجازة سنوية'
           when 'training' then 'الطبيب في تدريب'
           when 'emergency' then 'حالة طارئة مسجَّلة على وقت الطبيب'
           else 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب'
         end
    into v_block
    from doctor_working_hours h
   where h.doctor_id = p_doctor_id
     and h.is_blocked
     and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1;

  if v_block is not null then return v_block; end if;

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

revoke all on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz)
  to authenticated;
