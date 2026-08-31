begin;

create or replace function public.app_mark_all_notifications_read(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'غير مسجَّل الدخول';
  end if;

  if not public.app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;

  update public.notifications
     set read_at = now()
   where organization_id = p_org
     and user_id = auth.uid()
     and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_notify',
         'app_notify_event',
         'app_users_with_permission',
         'app_seed_notification_rules'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_signature
    );
  end loop;
end;
$$;

revoke all on function public.app_mark_all_notifications_read(uuid) from public, anon;
grant execute on function public.app_mark_all_notifications_read(uuid) to authenticated;

commit;
