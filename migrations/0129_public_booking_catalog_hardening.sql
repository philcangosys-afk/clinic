create index if not exists idx_public_booking_settings_branch
  on public.public_booking_settings (branch_id);

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
