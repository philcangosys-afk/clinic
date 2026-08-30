begin;

do $$
declare
  fn record;
  authenticated_had_execute boolean;
begin
  for fn in
    select
      p.oid,
      p.oid::regprocedure as signature,
      p.prosecdef,
      p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'app\_%' escape '\'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);

    if fn.is_trigger then
      execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
    elsif fn.prosecdef then
      authenticated_had_execute := has_function_privilege('authenticated', fn.oid, 'execute');
      execute format('revoke execute on function %s from public, anon', fn.signature);
      if authenticated_had_execute then
        execute format('grant execute on function %s to authenticated', fn.signature);
      end if;
    end if;
  end loop;
end $$;

alter view v_audit_log_detail rename column user_email to user_name;

create or replace view v_audit_log_detail
with (security_invoker = on)
as
select
  a.id,
  a.organization_id,
  a.occurred_at,
  a.user_id,
  coalesce(
    (
      select d.name_ar
      from doctors d
      where d.organization_id = a.organization_id
        and d.user_id = a.user_id
      order by d.created_at
      limit 1
    ),
    (
      select e.name_ar
      from employees e
      where e.organization_id = a.organization_id
        and e.user_id = a.user_id
      order by e.created_at
      limit 1
    ),
    a.user_id::text
  )::varchar(255) as user_name,
  a.device_name,
  a.action_type,
  a.module,
  a.entity_id,
  a.entity_title,
  a.details,
  a.reason
from audit_log a;

revoke all on v_audit_log_detail from anon;
grant select on v_audit_log_detail to authenticated;

commit;
