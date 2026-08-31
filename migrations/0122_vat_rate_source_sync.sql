begin;

update public.organizations organization
   set default_vat_rate = settings.default_vat_rate
  from public.organization_vat_settings settings
 where settings.organization_id = organization.id
   and organization.default_vat_rate is distinct from settings.default_vat_rate;

create or replace function public.app_sync_vat_rate_from_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.organizations
     set default_vat_rate = new.default_vat_rate
   where id = new.organization_id
     and default_vat_rate is distinct from new.default_vat_rate;
  return new;
end;
$$;

create or replace function public.app_sync_vat_rate_from_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.organization_vat_settings
     set default_vat_rate = new.default_vat_rate,
         updated_at = now()
   where organization_id = new.id
     and default_vat_rate is distinct from new.default_vat_rate;
  return new;
end;
$$;

revoke all on function public.app_sync_vat_rate_from_settings() from public, anon, authenticated;
revoke all on function public.app_sync_vat_rate_from_organization() from public, anon, authenticated;
grant execute on function public.app_sync_vat_rate_from_settings() to service_role;
grant execute on function public.app_sync_vat_rate_from_organization() to service_role;

drop trigger if exists trg_sync_vat_rate_from_settings on public.organization_vat_settings;
create trigger trg_sync_vat_rate_from_settings
after insert or update of default_vat_rate on public.organization_vat_settings
for each row execute function public.app_sync_vat_rate_from_settings();

drop trigger if exists trg_sync_vat_rate_from_organization on public.organizations;
create trigger trg_sync_vat_rate_from_organization
after update of default_vat_rate on public.organizations
for each row execute function public.app_sync_vat_rate_from_organization();

commit;
