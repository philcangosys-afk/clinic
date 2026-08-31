begin;

update public.organizations
set organization_type = 'medical_center'
where organization_type <> 'medical_center';

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'organizations'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%organization_type%'
  loop
    execute format('alter table public.organizations drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table public.organizations
  add constraint organizations_medical_center_only_check
  check (organization_type = 'medical_center');

insert into public.organization_features (organization_id, feature_key, enabled)
select organization.id, feature.feature_key, true
from public.organizations organization
cross join public.feature_catalog feature
on conflict (organization_id, feature_key)
do update set enabled = true;

create or replace function public.app_enable_all_organization_features()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.organization_features (organization_id, feature_key, enabled)
  select new.id, feature_key, true
  from public.feature_catalog
  on conflict (organization_id, feature_key)
  do update set enabled = true;

  return new;
end
$$;

revoke all on function public.app_enable_all_organization_features() from public, anon, authenticated;
grant execute on function public.app_enable_all_organization_features() to service_role;

drop trigger if exists trg_enable_all_organization_features on public.organizations;
create trigger trg_enable_all_organization_features
  after insert on public.organizations
  for each row execute function public.app_enable_all_organization_features();

commit;
