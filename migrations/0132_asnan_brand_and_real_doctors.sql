begin;

do $seed$
declare
  v_org uuid;
  v_branch uuid;
  v_dental_department uuid;
  v_dermatology_department uuid;
  v_dental_clinic uuid;
  v_dermatology_clinic uuid;
  v_dermatology_service uuid;
  v_doctor record;
begin
  select id into v_org
    from public.organizations
   where name = 'مجمع زين الطبي'
   order by created_at
   limit 1;

  if v_org is null then
    raise exception 'منشأة مجمع زين الطبي غير موجودة';
  end if;

  select id into v_branch
    from public.branches
   where organization_id = v_org
     and is_main
   order by created_at
   limit 1;

  select id into v_dental_department
    from public.departments
   where organization_id = v_org
     and code = 'DEMO-DENT'
   limit 1;

  insert into public.departments (
    organization_id, code, name_ar, name_en, department_type, is_clinical, sort_order
  )
  select v_org, 'DERM', 'قسم الجلدية', 'Dermatology Department', 'clinical', true, 25
  where not exists (
    select 1 from public.departments
     where organization_id = v_org and code = 'DERM'
  );

  select id into v_dermatology_department
    from public.departments
   where organization_id = v_org
     and code = 'DERM'
   limit 1;

  select id into v_dental_clinic
    from public.clinics
   where organization_id = v_org
     and code = 'DEMO-DENTAL'
   limit 1;

  insert into public.clinics (
    organization_id, branch_id, department_id, code, name, name_en, clinic_type,
    floor, room_number, default_visit_duration, allows_walk_in,
    allows_online_booking, capacity, color, sort_order
  ) values (
    v_org, v_branch, v_dermatology_department, 'DERM', 'عيادة الجلدية',
    'Dermatology Clinic', 'clinic', 'الأول', '205', 30, true, false, 8, '#7C3AED', 25
  )
  on conflict (organization_id, code) do update set
    branch_id = excluded.branch_id,
    department_id = excluded.department_id,
    name = excluded.name,
    name_en = excluded.name_en,
    is_disabled = false;

  select id into v_dermatology_clinic
    from public.clinics
   where organization_id = v_org
     and code = 'DERM'
   limit 1;

  insert into public.items (
    organization_id, item_type, code, name_ar, name_en, unit, price,
    medical_service_type, default_clinic_id, duration_minutes, provider_role,
    requires_appointment, description_ar
  ) values (
    v_org, 'service', 'DERM-CONSULT', 'استشارة جلدية', 'Dermatology Consultation',
    'زيارة', 200, 'consultation', v_dermatology_clinic, 30, 'doctor', true,
    'فحص وتشخيص وعلاج الحالات الجلدية'
  )
  on conflict (organization_id, code) do update set
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    price = excluded.price,
    default_clinic_id = excluded.default_clinic_id,
    duration_minutes = excluded.duration_minutes,
    is_disabled = false,
    is_archived = false
  returning id into v_dermatology_service;

  insert into public.doctors (
    organization_id, clinic_id, name_ar, name_en, job_title, gender,
    default_appointment_duration_minutes, patient_waiting_minutes,
    is_enabled, disabled_from_booking, notes
  )
  select v_org, seed.clinic_id, seed.name_ar, seed.name_en, seed.job_title,
         seed.gender, seed.duration, 10, true, false, 'الفريق الطبي الفعلي للمركز'
    from (values
      (v_dental_clinic, 'أمجد', 'Amjad', 'طبيب أسنان عام', 'male', 30),
      (v_dental_clinic, 'محمد', 'Mohammed', 'تقويم أسنان', 'male', 45),
      (v_dental_clinic, 'نبيلة', 'Nabila', 'طبيبة أسنان عامة', 'female', 30),
      (v_dental_clinic, 'نجاة', 'Najat', 'طبيبة أسنان عامة', 'female', 30),
      (v_dermatology_clinic, 'نوف', 'Nouf', 'طبيبة جلدية', 'female', 30)
    ) as seed(clinic_id, name_ar, name_en, job_title, gender, duration)
   where not exists (
     select 1 from public.doctors d
      where d.organization_id = v_org
        and d.name_ar = seed.name_ar
   );

  update public.doctors d
     set clinic_id = seed.clinic_id,
         name_en = seed.name_en,
         job_title = seed.job_title,
         gender = seed.gender,
         default_appointment_duration_minutes = seed.duration,
         is_enabled = true,
         disabled_from_booking = false,
         notes = 'الفريق الطبي الفعلي للمركز'
    from (values
      (v_dental_clinic, 'أمجد', 'Amjad', 'طبيب أسنان عام', 'male', 30),
      (v_dental_clinic, 'محمد', 'Mohammed', 'تقويم أسنان', 'male', 45),
      (v_dental_clinic, 'نبيلة', 'Nabila', 'طبيبة أسنان عامة', 'female', 30),
      (v_dental_clinic, 'نجاة', 'Najat', 'طبيبة أسنان عامة', 'female', 30),
      (v_dermatology_clinic, 'نوف', 'Nouf', 'طبيبة جلدية', 'female', 30)
    ) as seed(clinic_id, name_ar, name_en, job_title, gender, duration)
   where d.organization_id = v_org
     and d.name_ar = seed.name_ar;

  update public.doctors
     set disabled_from_booking = true
   where organization_id = v_org
     and name_ar = 'د. ريم عبدالله'
     and notes = 'طبيب تجريبي لاختبار النظام';

  for v_doctor in
    select id, clinic_id, default_appointment_duration_minutes
      from public.doctors
     where organization_id = v_org
       and notes = 'الفريق الطبي الفعلي للمركز'
  loop
    insert into public.doctor_branches (organization_id, doctor_id, branch_id, is_primary)
    values (v_org, v_doctor.id, v_branch, true)
    on conflict (doctor_id, branch_id) do update set is_active = true;

    insert into public.doctor_clinics (
      organization_id, doctor_id, clinic_id, branch_id, is_primary
    ) values (
      v_org, v_doctor.id, v_doctor.clinic_id, v_branch, true
    )
    on conflict (doctor_id, clinic_id) do update set is_active = true;

    insert into public.doctor_schedules (
      organization_id, doctor_id, branch_id, clinic_id, day_of_week,
      start_time, end_time, slot_duration_minutes, capacity, effective_from,
      is_active, note
    )
    select v_org, v_doctor.id, v_branch, v_doctor.clinic_id, day_number,
           time '09:00', time '21:00', v_doctor.default_appointment_duration_minutes,
           1, current_date, true, 'دوام المركز المعتاد'
      from generate_series(1, 6) as day_number
     where not exists (
       select 1 from public.doctor_schedules schedule
        where schedule.doctor_id = v_doctor.id
          and schedule.clinic_id = v_doctor.clinic_id
          and schedule.day_of_week = day_number
          and schedule.is_active
     );
  end loop;

  insert into public.doctor_services (
    organization_id, doctor_id, item_id, branch_id, duration_minutes, is_active
  )
  select v_org, d.id, i.id, v_branch,
         coalesce(i.duration_minutes, d.default_appointment_duration_minutes, 30), true
    from public.doctors d
    join public.items i
      on i.organization_id = d.organization_id
     and i.default_clinic_id = d.clinic_id
     and i.item_type = 'service'
     and not i.is_disabled
     and not i.is_archived
   where d.organization_id = v_org
     and d.notes = 'الفريق الطبي الفعلي للمركز'
     and not exists (
       select 1 from public.doctor_services relation
        where relation.doctor_id = d.id
          and relation.item_id = i.id
          and coalesce(relation.branch_id, v_branch) = v_branch
     );
end
$seed$;

create or replace function public.app_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  select jsonb_build_object(
    'site_name', v_setting.site_name,
    'hero_title', v_setting.hero_title,
    'hero_subtitle', v_setting.hero_subtitle,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.clinics c
       where c.organization_id = v_setting.organization_id
         and c.branch_id = v_setting.branch_id
         and c.allows_online_booking
         and not c.is_disabled
         and exists (
           select 1 from public.items i
            where i.organization_id = c.organization_id
              and i.default_clinic_id = c.id
              and i.item_type = 'service'
              and i.medical_service_type = 'dental'
              and not i.is_disabled
              and not i.is_archived
         )
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name_ar,
        'job_title', d.job_title, 'clinic_id', d.clinic_id
      ) order by d.name_ar)
        from public.doctors d
       where d.organization_id = v_setting.organization_id
         and d.is_enabled
         and not d.disabled_from_booking
         and d.notes = 'الفريق الطبي الفعلي للمركز'
         and exists (
           select 1 from public.clinics c
            where c.id = d.clinic_id
              and c.organization_id = d.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
              and exists (
                select 1 from public.items i
                 where i.organization_id = c.organization_id
                   and i.default_clinic_id = c.id
                   and i.item_type = 'service'
                   and i.medical_service_type = 'dental'
                   and not i.is_disabled
                   and not i.is_archived
              )
         )
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name_ar,
        'job_title', d.job_title, 'clinic_id', d.clinic_id
      ) order by d.name_ar)
        from public.doctors d
       where d.organization_id = v_setting.organization_id
         and d.is_enabled
         and d.notes = 'الفريق الطبي الفعلي للمركز'
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name_ar, 'description', i.description_ar,
        'price', i.price, 'duration_minutes', coalesce(i.duration_minutes, 30),
        'clinic_id', i.default_clinic_id
      ) order by i.name_ar)
        from public.items i
       where i.organization_id = v_setting.organization_id
         and i.item_type = 'service'
         and i.medical_service_type = 'dental'
         and not i.is_disabled
         and not i.is_archived
         and exists (
           select 1 from public.clinics c
            where c.id = i.default_clinic_id
              and c.organization_id = i.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
         )
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.app_public_booking_catalog(text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;

commit;
