begin;

create or replace function app_can_access_branch(target_org_id uuid, p_branch_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active
      and (
        m.role_key in ('owner', 'organization_admin')
        or m.branch_id is null
        or (p_branch_id is not null and m.branch_id = p_branch_id)
      )
  );
$$;

revoke all on function app_can_access_branch(uuid, uuid) from public, anon;
grant execute on function app_can_access_branch(uuid, uuid) to authenticated;

create or replace function app_derive_branch_from_clinic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_branch_id uuid;
begin
  if new.clinic_id is not null then
    select c.branch_id
      into v_branch_id
      from clinics c
     where c.id = new.clinic_id
       and c.organization_id = new.organization_id;

    if not found then
      raise exception 'العيادة المحددة لا تنتمي لهذه المنشأة';
    end if;

    new.branch_id := v_branch_id;
  elsif new.branch_id is not null and not exists (
    select 1
      from branches b
     where b.id = new.branch_id
       and b.organization_id = new.organization_id
  ) then
    raise exception 'الفرع المحدد لا ينتمي لهذه المنشأة';
  end if;

  return new;
end;
$$;

create or replace function app_reschedule_appointment(
  p_appointment_id uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_doctor_id uuid default null,
  p_clinic_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old appointments%rowtype;
  v_doctor uuid;
  v_clinic uuid;
  v_branch uuid;
  v_doctor_branch uuid;
  v_clinic_branch uuid;
  v_block text;
  v_old_doctor text;
  v_new_doctor text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;

  select * into v_old
    from appointments
   where id = p_appointment_id
   for update;

  if v_old.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_permission(v_old.organization_id, 'appointments.reschedule') then
    raise exception 'صلاحيتك لا تسمح بإعادة جدولة المواعيد';
  end if;
  if not app_can_access_branch(v_old.organization_id, v_old.branch_id) then
    raise exception 'الموعد يتبع فرعًا لا تملك الوصول إليه';
  end if;
  if v_old.status in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff') then
    raise exception 'لا يمكن إعادة جدولة موعد حالته «%» — أنشئ موعدًا جديدًا', v_old.status;
  end if;
  if v_old.status = 'in_progress' then
    raise exception 'الزيارة جارية الآن — لا يمكن نقل الموعد';
  end if;
  if p_scheduled_end <= p_scheduled_start then
    raise exception 'وقت النهاية يجب أن يكون بعد وقت البداية';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب إعادة الجدولة مطلوب';
  end if;

  v_doctor := coalesce(p_doctor_id, v_old.doctor_id);
  v_clinic := coalesce(p_clinic_id, v_old.clinic_id);

  select c.branch_id
    into v_doctor_branch
    from doctors d
    left join clinics c
      on c.id = d.clinic_id
     and c.organization_id = d.organization_id
   where d.id = v_doctor
     and d.organization_id = v_old.organization_id;

  if not found then
    raise exception 'الطبيب المحدد لا ينتمي لهذه المنشأة';
  end if;

  if v_clinic is not null then
    select c.branch_id
      into v_clinic_branch
      from clinics c
     where c.id = v_clinic
       and c.organization_id = v_old.organization_id;

    if not found then
      raise exception 'العيادة المحددة لا تنتمي لهذه المنشأة';
    end if;
  end if;

  if v_doctor_branch is not null
     and v_clinic_branch is not null
     and v_doctor_branch <> v_clinic_branch then
    raise exception 'الطبيب والعيادة المحددان يتبعان فرعين مختلفين';
  end if;

  v_branch := coalesce(v_clinic_branch, v_doctor_branch, v_old.branch_id);
  if not app_can_access_branch(v_old.organization_id, v_branch) then
    raise exception 'الفرع الجديد لا تملك الوصول إليه';
  end if;

  v_block := app_check_doctor_availability(v_doctor, p_scheduled_start, p_scheduled_end);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  update appointments
     set scheduled_start = p_scheduled_start,
         scheduled_end = p_scheduled_end,
         doctor_id = v_doctor,
         clinic_id = v_clinic,
         branch_id = v_branch,
         updated_at = now()
   where id = p_appointment_id;

  select name_ar into v_old_doctor from doctors where id = v_old.doctor_id;
  select name_ar into v_new_doctor from doctors where id = v_doctor;

  insert into audit_log (
    organization_id, user_id, action_type, module, entity_id,
    entity_title, details, reason
  ) values (
    v_old.organization_id,
    auth.uid(),
    'update',
    'appointments',
    p_appointment_id,
    'إعادة جدولة موعد',
    jsonb_build_object(
      'from', jsonb_build_object(
        'scheduled_start', v_old.scheduled_start,
        'scheduled_end', v_old.scheduled_end,
        'doctor', v_old_doctor,
        'clinic_id', v_old.clinic_id,
        'branch_id', v_old.branch_id
      ),
      'to', jsonb_build_object(
        'scheduled_start', p_scheduled_start,
        'scheduled_end', p_scheduled_end,
        'doctor', v_new_doctor,
        'clinic_id', v_clinic,
        'branch_id', v_branch
      )
    ),
    btrim(p_reason)
  );

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', p_scheduled_end,
    'doctor_id', v_doctor,
    'clinic_id', v_clinic,
    'branch_id', v_branch
  );
end;
$$;

revoke all on function app_reschedule_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function app_reschedule_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated;

update appointments a
   set branch_id = c.branch_id
  from clinics c
 where c.id = a.clinic_id
   and c.organization_id = a.organization_id
   and a.branch_id is distinct from c.branch_id;

update patient_visits v
   set branch_id = c.branch_id
  from clinics c
 where c.id = v.clinic_id
   and c.organization_id = v.organization_id
   and v.branch_id is distinct from c.branch_id;

commit;
