begin;

drop view if exists public.v_medical_record_access_log_detail;
create view public.v_medical_record_access_log_detail
with (security_invoker = on) as
select
  log.id,
  log.organization_id,
  log.branch_id,
  branch.name as branch_name,
  log.patient_id,
  patient.name_ar as patient_name,
  patient.file_number,
  log.user_id,
  coalesce(member.display_name, 'مستخدم غير محدد') as user_name,
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
left join public.v_organization_members_directory member
  on member.organization_id = log.organization_id
 and member.user_id = log.user_id;

grant select on public.v_medical_record_access_log_detail to authenticated;
revoke all on public.v_medical_record_access_log_detail from anon;

commit;
