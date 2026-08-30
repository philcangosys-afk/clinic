begin;

create or replace function app_setup_reminder_schedules(
  p_functions_base_url text,
  p_secret_name text default 'reminders_cron_secret',
  p_enqueue_cron text default '*/5 * * * *',
  p_dispatch_cron text default '*/5 * * * *'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_out text;
begin
  if auth.uid() is not null and not exists (
    select 1
    from organization_memberships m
    where m.user_id = auth.uid()
      and m.is_active
      and m.role_key in ('owner', 'organization_admin')
  ) then
    raise exception 'إعداد الجدولة من صلاحية مالك المنشأة أو مديرها';
  end if;

  if coalesce(btrim(p_functions_base_url), '') = '' then
    raise exception 'عنوان دوال المشروع مطلوب';
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = p_secret_name
      and coalesce(decrypted_secret, '') <> ''
  ) then
    raise exception 'السر % غير موجود أو فارغ في Vault', p_secret_name;
  end if;

  v_url := rtrim(btrim(p_functions_base_url), '/') || '/appointment-reminders';

  begin
    perform cron.unschedule('reminders_enqueue');
  exception when others then null;
  end;

  begin
    perform cron.unschedule('reminders_dispatch');
  exception when others then null;
  end;

  perform cron.schedule(
    'reminders_enqueue',
    p_enqueue_cron,
    'select app_process_due_appointment_reminders();'
  );

  perform cron.schedule(
    'reminders_dispatch',
    p_dispatch_cron,
    format(
      $command$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = %L)
        ),
        body := '{}'::jsonb
      );$command$,
      v_url,
      p_secret_name
    )
  );

  v_out := format(
    'تمت جدولة reminders_enqueue (%s) وreminders_dispatch (%s)',
    p_enqueue_cron,
    p_dispatch_cron
  );
  return v_out;
end;
$$;

revoke all on function app_setup_reminder_schedules(text, text, text, text) from public, anon;
grant execute on function app_setup_reminder_schedules(text, text, text, text) to authenticated;

commit;
