begin;

alter table public.medical_record_access_log
  add column if not exists device_name text;

drop function if exists public.app_log_record_access(uuid, text, text, text, uuid);

create function public.app_log_record_access(
  p_patient_id uuid,
  p_access_type text default 'view',
  p_context text default null,
  p_reason text default null,
  p_visit_id uuid default null,
  p_device_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_branch uuid;
  v_id uuid;
begin
  select organization_id, branch_id
    into v_org, v_branch
    from public.patients
   where id = p_patient_id;

  if v_org is null then
    raise exception 'المريض غير موجود';
  end if;
  if not public.app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if p_access_type not in ('view', 'print', 'export', 'download', 'search') then
    raise exception 'نوع الوصول غير صالح';
  end if;

  if p_visit_id is not null then
    select visit.branch_id
      into v_branch
      from public.patient_visits visit
     where visit.id = p_visit_id
       and visit.patient_id = p_patient_id
       and visit.organization_id = v_org;
    if not found then
      raise exception 'الزيارة لا تخص المريض المحدد';
    end if;
  end if;

  insert into public.medical_record_access_log (
    organization_id, branch_id, patient_id, user_id, access_type,
    context, reason, visit_id, device_name
  ) values (
    v_org, v_branch, p_patient_id, auth.uid(), p_access_type,
    nullif(trim(p_context), ''), nullif(trim(p_reason), ''), p_visit_id,
    left(nullif(trim(p_device_name), ''), 250)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.app_log_record_access(uuid, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.app_log_record_access(uuid, text, text, text, uuid, text)
  to authenticated;

create or replace view public.v_medical_record_access_log_detail as
select
  log.id,
  log.organization_id,
  log.branch_id,
  branch.name as branch_name,
  log.patient_id,
  patient.name_ar as patient_name,
  patient.file_number,
  log.user_id,
  coalesce(
    (select doctor.name_ar
       from public.doctors doctor
      where doctor.organization_id = log.organization_id
        and doctor.user_id = log.user_id
      order by doctor.created_at
      limit 1),
    (select employee.name_ar
       from public.employees employee
      where employee.organization_id = log.organization_id
        and employee.user_id = log.user_id
      order by employee.created_at
      limit 1),
    auth_user.email,
    'مستخدم غير محدد'
  ) as user_name,
  auth_user.email as user_email,
  log.access_type,
  log.context,
  log.reason,
  log.device_name,
  log.visit_id,
  log.document_id,
  log.occurred_at
from public.medical_record_access_log log
join public.patients patient on patient.id = log.patient_id
left join public.branches branch on branch.id = log.branch_id
left join auth.users auth_user on auth_user.id = log.user_id
where public.app_is_member(log.organization_id)
  and public.app_has_permission(log.organization_id, 'audit.access_log');

grant select on public.v_medical_record_access_log_detail to authenticated;
revoke all on public.v_medical_record_access_log_detail from anon;

commit;
