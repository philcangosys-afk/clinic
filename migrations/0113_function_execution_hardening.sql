begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end
$$;

revoke all on function app_mark_integration_attempt(text, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function app_mark_integration_attempt(text, uuid, boolean, text)
  to service_role;

revoke all on function app_claim_pending_messages(integer)
  from public, anon, authenticated;
grant execute on function app_claim_pending_messages(integer)
  to service_role;

revoke all on function app_mark_message_sent(bigint, text)
  from public, anon, authenticated;
grant execute on function app_mark_message_sent(bigint, text)
  to service_role;

revoke all on function app_mark_message_failed(bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function app_mark_message_failed(bigint, text, boolean)
  to service_role;

commit;
