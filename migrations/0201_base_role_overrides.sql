-- ============================================================================
-- 0201 — تعديل صلاحيات الصفات الجاهزة لكلّ منشأة
-- ============================================================================
--
-- الصفات الجاهزة (طبيب، ممرّض، موظّف استقبال…) تأخذ صلاحياتها من
-- `role_default_permissions` — جدولٌ عامّ لكلّ المنشآت لا يُعدَّل من الشاشة،
-- وفيه أكثر ممّا تحتاجه المنشأة (الطبيب 50 صلاحية مثلًا). والبديل كان إنشاء
-- دورٍ مخصّص وإسناده لكلّ عضوٍ على حدة.
--
-- الآن تُعدَّل الصفة نفسها **للمنشأة وحدها**:
--   * بلا جدول جديد: «تعديل الصفة» صفٌّ في `organization_roles` مُعلَّم
--     `overrides_base_role` ومعه صلاحياته في `organization_role_permissions`،
--     صفٌّ واحد لكلّ صفة في المنشأة (فهرس فريد جزئيّ).
--   * `app_has_permission` — الأسبقية بعد التعديل:
--       مالك/مدير ← استثناء صريح للعضو ← دوره المخصّص ← **تعديل الصفة في
--       منشأته** ← الافتراض العامّ للصفة.
--     فكلّ عضوٍ صفته «طبيب» بلا دورٍ مخصّص يأخذ صلاحيات «طبيب» المعدَّلة.
--   * `v_user_effective_permissions` بالحسبة نفسها (الأعمدة كما هي).
--   * `app_save_base_role_override(org, role_key, permissions)` و
--     `app_reset_base_role_override(org, role_key)` — بصلاحية
--     `users.permissions` وسطر تدقيق. الاستعادة أرشفةٌ لا حذف.
--   * `app_set_membership_custom_role` يرفض إسناد صفّ التعديل كدورٍ مخصّص.
--
-- لا يمسّ: المالك ومدير النظام (يتخطّيان الفحص)، ولا سياسات الحماية التي
-- تسأل عن الصفة نفسها (`role_key`) لا عن الصلاحية. آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

alter table organization_roles
  add column if not exists overrides_base_role boolean not null default false;

comment on column organization_roles.overrides_base_role is
  'الصفّ تعديلٌ لصلاحيات الصفة الجاهزة `base_role_key` في هذه المنشأة لا دورٌ مخصّص يُسنَد. 0201.';

create unique index if not exists uq_organization_roles_base_override
  on organization_roles (organization_id, base_role_key)
  where overrides_base_role and not is_archived;

-- ── الصلاحية — نسخة 0183 وفرع «تعديل الصفة» قبل الافتراض العامّ ─────────────
create or replace function app_has_permission(target_org_id uuid, p_permission_key text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1 from organization_memberships m
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and m.role_key in ('owner','organization_admin')
    ) then true
    when exists (
      select 1 from membership_permissions p
       where p.organization_id = target_org_id
         and p.user_id = auth.uid()
         and p.permission_key = p_permission_key
    ) then coalesce((
      select p.granted from membership_permissions p
       where p.organization_id = target_org_id
         and p.user_id = auth.uid()
         and p.permission_key = p_permission_key
    ), false)
    -- دورٌ مخصّص: مجموعته وحدها، لا يُضاف إليها افتراض الأساس
    when exists (
      select 1 from organization_memberships m
        join organization_roles r on r.id = m.custom_role_id
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and r.is_active
         and not r.is_archived
    ) then exists (
      select 1
        from organization_memberships m
        join organization_roles r on r.id = m.custom_role_id
        join organization_role_permissions rp on rp.role_id = r.id
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and r.is_active
         and not r.is_archived
         and rp.permission_key = p_permission_key
    )
    -- تعديل الصفة في هذه المنشأة (0201): يحلّ محلّ الافتراض العامّ للصفة
    when exists (
      select 1 from organization_memberships m
        join organization_roles o
          on o.organization_id = m.organization_id
         and o.base_role_key = m.role_key
         and o.overrides_base_role
         and o.is_active
         and not o.is_archived
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
    ) then exists (
      select 1
        from organization_memberships m
        join organization_roles o
          on o.organization_id = m.organization_id
         and o.base_role_key = m.role_key
         and o.overrides_base_role
         and o.is_active
         and not o.is_archived
        join organization_role_permissions rp on rp.role_id = o.id
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and rp.permission_key = p_permission_key
    )
    else exists (
      select 1
        from organization_memberships m
        join role_default_permissions d on d.role_key = m.role_key
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and d.permission_key = p_permission_key
    )
  end;
$$;

comment on function app_has_permission(uuid, text) is
  'هل يملك المستخدم الحالي هذه الصلاحية؟ الأسبقية: المالك/المدير ← استثناء صريح ← دوره المخصّص ← تعديل صفته في المنشأة (0201) ← الافتراض العامّ لصفته.';

revoke all on function app_has_permission(uuid, text) from public, anon;
grant execute on function app_has_permission(uuid, text) to authenticated;

-- ── المنظور — الأعمدة نفسها بترتيبها، والحسبة نفسها ─────────────────────────
create or replace view v_user_effective_permissions
with (security_invoker = on) as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  c.permission_key,
  c.name_ar        as permission_name,
  c.module_key,
  case
    when m.role_key in ('owner','organization_admin') then true
    when mp.permission_key is not null then mp.granted
    when cr.id is not null then exists (
      select 1 from organization_role_permissions rp
       where rp.role_id = cr.id and rp.permission_key = c.permission_key)
    when ob.id is not null then exists (
      select 1 from organization_role_permissions rp
       where rp.role_id = ob.id and rp.permission_key = c.permission_key)
    else exists (select 1 from role_default_permissions d
                  where d.role_key = m.role_key
                    and d.permission_key = c.permission_key)
  end              as is_allowed,
  case
    when m.role_key in ('owner','organization_admin') then 'admin'
    when mp.permission_key is not null and mp.granted then 'explicit_grant'
    when mp.permission_key is not null and not mp.granted then 'explicit_deny'
    when cr.id is not null and exists (
      select 1 from organization_role_permissions rp
       where rp.role_id = cr.id and rp.permission_key = c.permission_key) then 'custom_role'
    when cr.id is null and ob.id is not null and exists (
      select 1 from organization_role_permissions rp
       where rp.role_id = ob.id and rp.permission_key = c.permission_key) then 'role_default'
    when cr.id is null and ob.id is null and exists (select 1 from role_default_permissions d
                  where d.role_key = m.role_key
                    and d.permission_key = c.permission_key) then 'role_default'
    else 'none'
  end              as source,
  current_date     as report_date
from organization_memberships m
cross join permission_catalog c
left join membership_permissions mp
       on mp.organization_id = m.organization_id
      and mp.user_id = m.user_id
      and mp.permission_key = c.permission_key
left join organization_roles cr
       on cr.id = m.custom_role_id
      and cr.is_active
      and not cr.is_archived
left join organization_roles ob
       on ob.organization_id = m.organization_id
      and ob.base_role_key = m.role_key
      and ob.overrides_base_role
      and ob.is_active
      and not ob.is_archived
where m.is_active;

comment on view v_user_effective_permissions is
  'الصلاحية الفعلية لكل عضو ومصدرها: صفة إدارية، أو منح/منع صريح، أو دوره المخصّص، أو صفته (معدّلةً للمنشأة إن عُدّلت، 0201).';

-- ── حفظ تعديل الصفة ─────────────────────────────────────────────────────────
create or replace function app_save_base_role_override(
  p_organization_id uuid,
  p_role_key        text,
  p_permissions     text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_unknown text;
  v_before  int;
  v_after   int;
begin
  if not app_has_permission(p_organization_id, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوار (users.permissions)';
  end if;
  if p_role_key in ('owner', 'organization_admin') then
    raise exception 'المالك ومدير النظام يملكان كلّ شيء — لا تُعدَّل صلاحياتهما';
  end if;
  if not exists (select 1 from role_default_permissions where role_key = p_role_key)
     and p_role_key not in ('branch_manager','doctor','nurse','receptionist','pharmacist',
                            'lab_technician','radiology_technician','accountant','hr_manager','employee') then
    raise exception 'صفة غير معروفة: %', p_role_key;
  end if;

  -- مفتاحٌ مجهول يُرفض ولا يُتجاهل: تجاهله يُظهر «حُفظ» وقد سقطت صلاحية
  select rp into v_unknown
    from unnest(coalesce(p_permissions, '{}')) rp
   where not exists (select 1 from permission_catalog c where c.permission_key = rp)
   limit 1;
  if v_unknown is not null then
    raise exception 'صلاحية غير معروفة: %', v_unknown;
  end if;

  select id into v_id from organization_roles
   where organization_id = p_organization_id
     and base_role_key = p_role_key
     and overrides_base_role and not is_archived
   for update;

  if v_id is null then
    insert into organization_roles (organization_id, code, name_ar, base_role_key, is_active,
                                    overrides_base_role, created_by, updated_by)
    values (p_organization_id,
            'base-' || p_role_key || '-' || substring(gen_random_uuid()::text, 1, 6),
            'تعديل الصفة: ' || p_role_key, p_role_key, true, true, auth.uid(), auth.uid())
    returning id into v_id;
    -- ما كانت تمنحه الصفة قبل التعديل — للتدقيق
    select count(*) into v_before from role_default_permissions where role_key = p_role_key;
  else
    select count(*) into v_before from organization_role_permissions where role_id = v_id;
    update organization_roles set updated_by = auth.uid(), updated_at = now(), is_active = true
     where id = v_id;
  end if;

  -- الاستبدال لا الإضافة: ما لم يُرسَل يُنزع
  delete from organization_role_permissions
   where role_id = v_id
     and permission_key <> all(coalesce(p_permissions, '{}'));
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select p_organization_id, v_id, rp from unnest(coalesce(p_permissions, '{}')) rp
  on conflict (role_id, permission_key) do nothing;

  select count(*) into v_after from organization_role_permissions where role_id = v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update', v_id,
          'تعديل صلاحيات الصفة: ' || p_role_key,
          format('%s صلاحية ← %s صلاحية', v_before, v_after));
  return v_id;
end $$;

revoke all on function app_save_base_role_override(uuid, text, text[]) from public, anon;
grant execute on function app_save_base_role_override(uuid, text, text[]) to authenticated;

-- ── استعادة الافتراض — أرشفة صفّ التعديل ───────────────────────────────────
create or replace function app_reset_base_role_override(
  p_organization_id uuid,
  p_role_key        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not app_has_permission(p_organization_id, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوار (users.permissions)';
  end if;
  update organization_roles
     set is_archived = true, archived_at = now(), is_active = false,
         updated_by = auth.uid(), updated_at = now()
   where organization_id = p_organization_id
     and base_role_key = p_role_key
     and overrides_base_role and not is_archived
  returning id into v_id;
  if v_id is null then
    raise exception 'الصفة غير معدّلة في هذه المنشأة';
  end if;
  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update', v_id,
          'استعادة الصلاحيات الافتراضية للصفة: ' || p_role_key, null);
end $$;

revoke all on function app_reset_base_role_override(uuid, text) from public, anon;
grant execute on function app_reset_base_role_override(uuid, text) to authenticated;

-- ── الدور المخصّص لا يكون صفّ تعديل صفة ─────────────────────────────────────
create or replace function app_set_membership_custom_role(
  p_organization_id uuid,
  p_user_id         uuid,
  p_role_id         uuid            -- null ⇒ يعود إلى افتراض دوره الأساس
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_base text; v_name text;
begin
  if not app_has_permission(p_organization_id, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  if not exists (select 1 from organization_memberships
                  where organization_id = p_organization_id and user_id = p_user_id) then
    raise exception 'العضو غير موجود في هذه المنشأة';
  end if;

  if p_role_id is not null then
    select base_role_key, name_ar into v_base, v_name
      from organization_roles
     where id = p_role_id and organization_id = p_organization_id
       and is_active and not is_archived and not overrides_base_role;
    if v_base is null then raise exception 'الدور غير موجود أو غير نشط'; end if;
  end if;

  -- الدور الأساس ينتقل إلى العضوية: سياسات RLS تقرأ `role_key` لا الدور المخصّص
  update organization_memberships
     set custom_role_id = p_role_id,
         role_key       = coalesce(v_base, role_key)
   where organization_id = p_organization_id and user_id = p_user_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update', p_user_id,
          'تغيير الدور المخصّص', coalesce(v_name, 'إلغاء الدور المخصّص'));
end $$;

revoke all on function app_set_membership_custom_role(uuid, uuid, uuid) from public, anon;
grant execute on function app_set_membership_custom_role(uuid, uuid, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'app_save_base_role_override')
     or not exists (select 1 from pg_proc where proname = 'app_reset_base_role_override') then
    raise exception '0201 لم تكتمل';
  end if;
end $$;
