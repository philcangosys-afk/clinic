create table if not exists public.public_booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  public_slug text not null unique,
  site_name text not null,
  branch_id uuid not null references public.branches(id),
  hero_title text not null,
  hero_subtitle text,
  phone text,
  address text,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_booking_slug_format check (public_slug ~ '^[a-z0-9][a-z0-9-]{2,62}$')
);

alter table public.public_booking_settings enable row level security;

create policy public_booking_settings_members
  on public.public_booking_settings
  for all to authenticated
  using (public.app_is_member(organization_id))
  with check (public.app_is_member(organization_id));

create table if not exists public.public_booking_rate_limits (
  id bigint generated always as identity primary key,
  booking_key text not null,
  created_at timestamptz not null default now()
);

alter table public.public_booking_rate_limits enable row level security;
create index if not exists idx_public_booking_rate_limits_key_time
  on public.public_booking_rate_limits (booking_key, created_at desc);

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
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name
      ) order by c.sort_order, c.name)
      from public.clinics c
      where c.organization_id = v_setting.organization_id
        and c.branch_id = v_setting.branch_id
        and c.allows_online_booking
        and not c.is_disabled
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name_ar,
        'job_title', d.job_title,
        'clinic_id', d.clinic_id
      ) order by d.name_ar)
      from public.doctors d
      where d.organization_id = v_setting.organization_id
        and d.is_enabled
        and not d.disabled_from_booking
        and exists (
          select 1
            from public.clinics c
           where c.id = d.clinic_id
             and c.organization_id = d.organization_id
             and c.branch_id = v_setting.branch_id
             and c.allows_online_booking
             and not c.is_disabled
        )
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'name', i.name_ar,
        'description', i.description_ar,
        'price', i.price,
        'duration_minutes', coalesce(i.duration_minutes, 30),
        'clinic_id', i.default_clinic_id
      ) order by i.name_ar)
      from public.items i
      where i.organization_id = v_setting.organization_id
        and i.item_type = 'service'
        and i.medical_service_type = 'dental'
        and not i.is_disabled
        and not i.is_archived
        and exists (
          select 1
            from public.clinics c
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

create or replace function public.app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_email text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_item_id uuid,
  p_scheduled_start timestamptz,
  p_note text default null,
  p_consent boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_mobile text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_clinic public.clinics%rowtype;
  v_doctor public.doctors%rowtype;
  v_item public.items%rowtype;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_duration integer;
  v_scheduled_end timestamptz;
  v_vat_rate numeric := 0;
  v_taxable numeric(14,2);
  v_vat numeric(14,2);
  v_net numeric(14,2);
  v_booking_key text;
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception 'تعذر إرسال الطلب';
  end if;

  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  if char_length(v_name) < 3 or char_length(v_name) > 120 then
    raise exception 'أدخل الاسم الكامل';
  end if;
  if v_mobile !~ '^\+?[0-9]{8,15}$' then
    raise exception 'رقم الجوال غير صحيح';
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'البريد الإلكتروني غير صحيح';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'اختر الجنس';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'يجب الموافقة على استخدام البيانات لإتمام الحجز';
  end if;
  if p_scheduled_start < now() + interval '1 hour'
     or p_scheduled_start > now() + interval '90 days' then
    raise exception 'اختر موعدًا خلال 90 يومًا وبفاصل ساعة على الأقل';
  end if;

  select * into v_clinic
    from public.clinics
   where id = p_clinic_id
     and organization_id = v_setting.organization_id
     and branch_id = v_setting.branch_id
     and allows_online_booking
     and not is_disabled;
  if v_clinic.id is null then raise exception 'العيادة غير متاحة للحجز الإلكتروني'; end if;

  select * into v_doctor
    from public.doctors
   where id = p_doctor_id
     and organization_id = v_setting.organization_id
     and clinic_id = v_clinic.id
     and is_enabled
     and not disabled_from_booking;
  if v_doctor.id is null then raise exception 'الطبيب غير متاح في العيادة المختارة'; end if;

  select * into v_item
    from public.items
   where id = p_item_id
     and organization_id = v_setting.organization_id
     and default_clinic_id = v_clinic.id
     and item_type = 'service'
     and medical_service_type = 'dental'
     and not is_disabled
     and not is_archived;
  if v_item.id is null then raise exception 'الخدمة غير متاحة للحجز الإلكتروني'; end if;

  v_duration := greatest(5, least(240, coalesce(v_item.duration_minutes, v_doctor.default_appointment_duration_minutes, v_clinic.default_visit_duration, 30)));
  v_scheduled_end := p_scheduled_start + make_interval(mins => v_duration);

  if exists (
    select 1 from public.appointments a
     where a.organization_id = v_setting.organization_id
       and a.doctor_id = v_doctor.id
       and a.status not in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff')
       and tstzrange(a.scheduled_start, a.scheduled_end, '[)') && tstzrange(p_scheduled_start, v_scheduled_end, '[)')
  ) then
    raise exception 'هذا الوقت محجوز، اختر وقتًا آخر';
  end if;

  v_booking_key := md5(v_setting.public_slug || ':' || v_mobile);
  if (select count(*) from public.public_booking_rate_limits
       where booking_key = v_booking_key
         and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'تم إرسال عدة حجوزات لهذا الرقم؛ حاول لاحقًا';
  end if;
  insert into public.public_booking_rate_limits (booking_key) values (v_booking_key);

  if exists (
    select 1 from public.blocked_external_contacts b
     where b.organization_id = v_setting.organization_id
       and b.is_active
       and b.block_type in ('booking', 'all')
       and regexp_replace(coalesce(b.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  select p.id into v_patient_id
    from public.patients p
   where p.organization_id = v_setting.organization_id
     and regexp_replace(coalesce(p.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
     and lower(regexp_replace(btrim(p.name_ar), '\s+', ' ', 'g')) = lower(v_name)
   order by p.created_at
   limit 1;

  if v_patient_id is not null and exists (
    select 1 from public.patients p
     where p.id = v_patient_id and p.block_appointments
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  if v_patient_id is null then
    insert into public.patients (
      organization_id, branch_id, name_ar, mobile_number, email_1,
      gender, preferred_language, treating_doctor_id, source_details,
      block_sms, block_sms_reason
    ) values (
      v_setting.organization_id, v_setting.branch_id, v_name, v_mobile, v_email,
      p_gender, 'ar', v_doctor.id, 'الموقع الإلكتروني',
      true, 'إرسال الرسائل الخارجية مؤجل'
    ) returning id into v_patient_id;
  end if;

  insert into public.appointments (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, item_id,
    scheduled_start, scheduled_end, status, priority, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_item.id, p_scheduled_start, v_scheduled_end,
    'new', 'normal', concat_ws(E'\n', 'حجز من الموقع الإلكتروني', nullif(btrim(coalesce(p_note, '')), ''))
  ) returning id into v_appointment_id;

  select case
           when i.is_vat_exempt or i.vat_category in ('zero_rated', 'exempt', 'out_of_scope') then 0
           when not coalesce(s.sales_vat_enabled, true) then 0
           else coalesce(i.vat_rate_override, o.default_vat_rate, 0)
         end
    into v_vat_rate
    from public.items i
    join public.organizations o on o.id = i.organization_id
    left join public.organization_vat_settings s on s.organization_id = i.organization_id
   where i.id = v_item.id;

  v_taxable := round(v_item.price, 2);
  v_vat := round(v_taxable * v_vat_rate / 100.0, 2);
  v_net := v_taxable + v_vat;

  insert into public.sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, appointment_id,
    invoice_type, status, document_type, subtotal_amount, vat_amount, net_amount,
    paid_amount, patient_share_amount, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_appointment_id, 'sale', 'draft', 'simplified',
    v_taxable, v_vat, v_net, 0, v_net, 'مسودة آلية مرتبطة بحجز الموقع الإلكتروني'
  ) returning id into v_invoice_id;

  insert into public.sales_invoice_items (
    invoice_id, organization_id, branch_id, patient_id, item_id, doctor_id,
    description, item_name_snapshot, qty, price, discount_percent,
    discount_amount, vat_rate, vat_amount, taxable_base, exemption_amount,
    net_amount, line_type, source_type, source_id, vat_category
  ) values (
    v_invoice_id, v_setting.organization_id, v_setting.branch_id, v_patient_id,
    v_item.id, v_doctor.id, v_item.name_ar, v_item.name_ar, 1, v_item.price,
    0, 0, v_vat_rate, v_vat, v_taxable,
    case when v_vat_rate = 0 and v_item.vat_category = 'exempt' then v_taxable else 0 end,
    v_net, 'normal', 'manual', v_appointment_id, v_item.vat_category
  );

  return jsonb_build_object(
    'booking_reference', upper(substr(replace(v_appointment_id::text, '-', ''), 1, 8)),
    'appointment_id', v_appointment_id,
    'invoice_id', v_invoice_id,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', v_scheduled_end,
    'service_name', v_item.name_ar,
    'doctor_name', v_doctor.name_ar,
    'clinic_name', v_clinic.name,
    'invoice_total', v_net,
    'currency', 'SAR'
  );
end;
$$;

revoke all on function public.app_public_booking_catalog(text) from public;
revoke all on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;
grant execute on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) to anon, authenticated;

insert into public.public_booking_settings (
  organization_id, public_slug, site_name, branch_id, hero_title, hero_subtitle,
  phone, address, is_enabled
)
select o.id, 'asnan-premium', 'مركز أسناني المميز الطبي', b.id,
       'ابتسامتك تبدأ برعاية تستحق الثقة',
       'خبرات متخصصة وتقنيات حديثة للعناية بصحة وجمال ابتسامتك في مكان واحد.',
       coalesce(b.phone, '920000000'),
       concat_ws('، ', b.address, b.city),
       true
  from public.organizations o
  join public.branches b on b.organization_id = o.id and b.is_main
 where o.name = 'مجمع زين الطبي'
on conflict (organization_id) do update set
  public_slug = excluded.public_slug,
  site_name = excluded.site_name,
  branch_id = excluded.branch_id,
  hero_title = excluded.hero_title,
  hero_subtitle = excluded.hero_subtitle,
  phone = excluded.phone,
  address = excluded.address,
  is_enabled = excluded.is_enabled,
  updated_at = now();
