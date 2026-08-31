begin;

create or replace function public.app_create_medical_center(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_branch_id uuid;
  v_feature_count integer;
  v_enabled_count integer;
begin
  if v_user_id is null then
    raise exception 'غير مسجَّل الدخول';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'اسم المركز مطلوب';
  end if;

  if length(btrim(p_name)) > 200 then
    raise exception 'اسم المركز أطول من الحد المسموح';
  end if;

  if exists (
    select 1
      from public.organization_memberships
     where user_id = v_user_id
       and is_active
  ) then
    raise exception 'لديك عضوية نشطة بالفعل';
  end if;

  insert into public.organizations (name, organization_type, created_by)
  values (btrim(p_name), 'medical_center', v_user_id)
  returning id into v_organization_id;

  select branch_id
    into v_branch_id
    from public.organization_memberships
   where organization_id = v_organization_id
     and user_id = v_user_id
     and role_key = 'owner'
     and is_active;

  if v_branch_id is null or not exists (
    select 1
      from public.branches
     where id = v_branch_id
       and organization_id = v_organization_id
       and is_main
  ) then
    raise exception 'تعذر إنشاء الفرع الرئيسي وعضوية المالك';
  end if;

  select count(*) into v_feature_count from public.feature_catalog;
  select count(*) into v_enabled_count
    from public.organization_features
   where organization_id = v_organization_id
     and enabled;

  if v_enabled_count <> v_feature_count then
    raise exception 'تعذر تفعيل جميع وحدات المركز';
  end if;

  return v_organization_id;
end;
$$;

revoke all on function public.app_create_medical_center(text) from public, anon;
grant execute on function public.app_create_medical_center(text) to authenticated;

commit;
