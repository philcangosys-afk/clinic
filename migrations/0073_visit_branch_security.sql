begin;

create or replace function app_enforce_visit_branch_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_org uuid;
  v_appointment_branch uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  if not app_can_access_branch(new.organization_id, new.branch_id) then
    raise exception 'الزيارة تتبع فرعًا لا تملك الوصول إليه';
  end if;

  if new.appointment_id is not null then
    select a.organization_id, a.branch_id
      into v_appointment_org, v_appointment_branch
      from appointments a
     where a.id = new.appointment_id;

    if not found or v_appointment_org <> new.organization_id then
      raise exception 'الموعد المحدد لا ينتمي لهذه المنشأة';
    end if;

    if not app_can_access_branch(v_appointment_org, v_appointment_branch) then
      raise exception 'الموعد يتبع فرعًا لا تملك الوصول إليه';
    end if;

    if v_appointment_branch is distinct from new.branch_id then
      raise exception 'فرع الزيارة لا يطابق فرع الموعد';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_enforce_visit_branch_access() from public, anon;

drop trigger if exists trg_zz_patient_visits_branch_access on patient_visits;
create trigger trg_zz_patient_visits_branch_access
before insert or update of organization_id, branch_id, appointment_id on patient_visits
for each row execute function app_enforce_visit_branch_access();

drop policy if exists "patient_visits_all_members" on patient_visits;
drop policy if exists "patient_visits_insert_clinical" on patient_visits;
drop policy if exists "patient_visits_update_clinical" on patient_visits;
drop policy if exists "patient_visits_delete_admins" on patient_visits;

drop policy if exists "appointments_delete_admins" on appointments;
create policy "appointments_delete_admins" on appointments
  for delete using (
    app_is_org_admin(organization_id)
    and app_can_access_branch(organization_id, branch_id)
  );

commit;
