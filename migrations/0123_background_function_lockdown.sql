begin;

create or replace function public.app_guard_definer_grants()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_object record;
begin
  for v_object in select * from pg_event_trigger_ddl_commands()
  loop
    if v_object.object_type = 'function' and exists (
      select 1
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where procedure.oid = v_object.objid
         and namespace.nspname = 'public'
         and procedure.prosecdef
    ) then
      execute format('revoke all on function %s from public, anon', v_object.objid::regprocedure);
    end if;
  end loop;
end;
$$;

do $$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select procedure.oid::regprocedure
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname in (
         'app_guard_definer_grants',
         'app_mark_integration_attempt',
         'app_claim_pending_messages',
         'app_mark_message_sent',
         'app_mark_message_failed',
         'app_process_due_appointment_reminders',
         'app_setup_reminder_schedules',
         'app_seed_integration_rules',
         'app_seed_quality_indicators',
         'app_seed_asset_depreciation_rule',
         'app_seed_default_chart_of_accounts',
         'app_seed_gl_posting_rules'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_signature
    );
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;

commit;
