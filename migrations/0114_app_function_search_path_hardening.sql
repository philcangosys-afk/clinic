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
      and p.proname like 'app\_%' escape '\'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end
$$;

commit;
