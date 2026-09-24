-- ============================================================================
-- 0183 — الأدوار المخصّصة: دورٌ تصنعه المنشأة بصلاحياتٍ تختارها
-- ============================================================================
--
-- حتى الآن الدور اثنا عشر مفتاحًا ثابتًا في الشيفرة (`role_key`)، وصلاحياته
-- في `role_default_permissions` مشتركةٌ بين كلّ المنشآت. فمن أراد «كاشير»
-- يرى الفوترة ولا يرى المحاسبة لم يجد إلّا أن يمنح المستثنيات صلاحيةً صلاحيةً
-- لكلّ موظّف على حدة — عملٌ يُعاد مع كلّ موظّفٍ جديد ويُنسى نصفه.
--
-- هنا يصير الدور صفًّا في المنشأة: اسمٌ عربيّ وإنجليزيّ، ومجموعةُ صلاحيات
-- تُحرَّر من شاشة واحدة، وكلّ من يحمله يرث تعديلها فورًا.
--
-- ── ثلاث مسائل حُسمت في التصميم ────────────────────────────────────────────
--
-- **(١) الدور المخصّص لا يُلغي `role_key` بل يركب فوقه.** عشرات سياسات RLS
-- تسأل `app_has_role(org, array['receptionist', ...])` لا عن صلاحية. فلو
-- استُبدل المفتاح الثابت بدورٍ حرّ لسقطت تلك السياسات كلّها دفعةً واحدة.
-- فلكلّ دورٍ مخصّص **دورٌ أساس** (`base_role_key`) من الاثني عشر: به تُقاس
-- سياسات القاعدة، وبصلاحياته المخصّصة تُقاس الأزرار والشاشات.
--
-- **(٢) مجموعة الدور تحلّ محلّ افتراض الأساس لا تُضاف إليه.** «كاشير» مبنيٌّ
-- على «موظف استقبال» لكن بلا إلغاء المواعيد: لو جُمعت المجموعتان لبقي
-- الإلغاء. فالأسبقية: مالك/مدير ← استثناء صريح للشخص ← **مجموعة دوره
-- المخصّص إن كان له** ← افتراض دوره الأساس.
--
-- **(٣) الدور لا يُحذف ما دام يحمله أحد.** الأرشفة تُخفيه من القوائم ويبقى
-- سجلّ من حمله. وحذفُ دورٍ عليه أعضاء كان سيُسقط صلاحياتهم بلا أثرٍ مفهوم.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الدور
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists organization_roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,
  name_ar         text not null,
  name_en         text,
  -- الدور الأساس: به تُقاس سياسات RLS التي تسأل عن الصفة لا عن الصلاحية
  base_role_key   text not null default 'employee',
  is_active       boolean not null default true,
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_roles_base_role_check check (base_role_key in (
    'owner','organization_admin','branch_manager','doctor','nurse','receptionist',
    'pharmacist','lab_technician','radiology_technician','accountant','hr_manager','employee'
  ))
);

create unique index if not exists uq_organization_roles_code
  on organization_roles (organization_id, code);
create index if not exists idx_organization_roles_org
  on organization_roles (organization_id, is_archived, name_ar);

comment on table organization_roles is
  'دورٌ تصنعه المنشأة بصلاحياتٍ تختارها. base_role_key هو الدور الثابت الذي تُقاس به سياسات RLS.';

create table if not exists organization_role_permissions (
  organization_id uuid not null references organizations(id) on delete cascade,
  role_id         uuid not null references organization_roles(id) on delete cascade,
  permission_key  text not null references permission_catalog(permission_key) on delete cascade,
  primary key (role_id, permission_key)
);

create index if not exists idx_organization_role_permissions_org
  on organization_role_permissions (organization_id, permission_key);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) العضوية: الدور المخصّص، والاسم، ونوع العضو
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `display_name` و`member_kind` لأجل **المستخدم الخاص**: محاسبٌ خارجيّ أو
-- مراجعٌ يدخل النظام وليس موظّفًا في كشف الرواتب. كان دليل الأعضاء يشتقّ
-- الاسم من `doctors` أو `employees` وحدهما، فمن ليس فيهما يظهر «مستخدم
-- 3f2a…» — اسمٌ لا يدلّ على أحد.
alter table organization_memberships
  add column if not exists custom_role_id uuid references organization_roles(id),
  add column if not exists display_name   text,
  add column if not exists member_kind    text not null default 'employee';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_memberships_member_kind_check') then
    alter table organization_memberships add constraint organization_memberships_member_kind_check
      check (member_kind in ('employee','special'));
  end if;
end $$;

create index if not exists idx_memberships_custom_role
  on organization_memberships (custom_role_id) where custom_role_id is not null;

comment on column organization_memberships.member_kind is
  'employee عضوٌ له ملفّ في الموظفين أو الأطباء، special مستخدمٌ خاصّ لا يظهر في الموظفين.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الحماية
-- ═══════════════════════════════════════════════════════════════════════════
alter table organization_roles            enable row level security;
alter table organization_role_permissions enable row level security;

-- القراءة لكلّ عضو: الشاشة تعرض اسم دور زميله، ولا سرّ في اسم الدور.
-- والكتابة بالدوالّ وحدها (`security definer`) فلا سياسة كتابة هنا.
drop policy if exists organization_roles_read on organization_roles;
create policy organization_roles_read on organization_roles
  for select using (app_is_member(organization_id));

drop policy if exists organization_role_permissions_read on organization_role_permissions;
create policy organization_role_permissions_read on organization_role_permissions
  for select using (app_is_member(organization_id));

revoke all on organization_roles            from anon;
revoke all on organization_role_permissions from anon;
grant select on organization_roles            to authenticated;
grant select on organization_role_permissions to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) الصلاحية الفعلية — طبقةٌ رابعة بين الاستثناء وافتراض الأساس
-- ═══════════════════════════════════════════════════════════════════════════
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
  'هل يملك المستخدم الحالي هذه الصلاحية؟ الأسبقية: المالك/المدير ← استثناء صريح ← مجموعة دوره المخصّص ← افتراض دوره الأساس.';

revoke all on function app_has_permission(uuid, text) from public, anon;
grant execute on function app_has_permission(uuid, text) to authenticated;

-- المنظور نفسه أعمدةً — تتغيّر الحسبة وحدها، فلا حاجة لإسقاط تابعيه
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
    when cr.id is null and exists (select 1 from role_default_permissions d
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
where m.is_active;

comment on view v_user_effective_permissions is
  'الصلاحية الفعلية لكل عضو ومصدرها: صفة إدارية، أو منح/منع صريح، أو دوره المخصّص، أو افتراض دوره الأساس.';

-- دليل الأعضاء: الاسم المكتوب على العضوية أولًا — به يظهر المستخدم الخاصّ
create or replace view v_organization_members_directory as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  coalesce(nullif(trim(m.display_name), ''), d.name_ar, e.name_ar,
           'مستخدم ' || substring(m.user_id::text, 1, 8)) as display_name
from organization_memberships m
left join doctors d on d.user_id = m.user_id and d.organization_id = m.organization_id
left join employees e on e.user_id = m.user_id and e.organization_id = m.organization_id
where m.is_active = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) حفظ الدور — الاسم والصلاحيات في معاملةٍ واحدة
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_save_organization_role(
  p_organization_id uuid,
  p_role_id         uuid,          -- null ⇒ دورٌ جديد
  p_name_ar         text,
  p_name_en         text,
  p_base_role_key   text,
  p_is_active       boolean,
  p_permissions     text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid := p_role_id;
  v_unknown text;
  v_code    text;
  v_n       int;
begin
  if not app_has_permission(p_organization_id, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوار (users.permissions)';
  end if;
  if coalesce(trim(p_name_ar), '') = '' then
    raise exception 'اسم الدور بالعربية مطلوب';
  end if;

  -- **مفتاحٌ مجهول يُرفض ولا يُتجاهل:** تجاهله يُظهر «حُفظ» وقد سقطت صلاحية.
  select rp into v_unknown
    from unnest(coalesce(p_permissions, '{}')) rp
   where not exists (select 1 from permission_catalog c where c.permission_key = rp)
   limit 1;
  if v_unknown is not null then
    raise exception 'صلاحية غير معروفة: %', v_unknown;
  end if;

  if v_id is null then
    -- رمزٌ متسلسل يقرؤه الإنسان: role-1، role-2…
    select 'role-' || (coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1)
      into v_code
      from organization_roles where organization_id = p_organization_id;
    insert into organization_roles (organization_id, code, name_ar, name_en,
                                    base_role_key, is_active, created_by, updated_by)
    values (p_organization_id, coalesce(v_code, 'role-1'), trim(p_name_ar), nullif(trim(coalesce(p_name_en, '')), ''),
            coalesce(nullif(trim(coalesce(p_base_role_key, '')), ''), 'employee'),
            coalesce(p_is_active, true), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update organization_roles
       set name_ar       = trim(p_name_ar),
           name_en       = nullif(trim(coalesce(p_name_en, '')), ''),
           base_role_key = coalesce(nullif(trim(coalesce(p_base_role_key, '')), ''), base_role_key),
           is_active     = coalesce(p_is_active, is_active),
           updated_by    = auth.uid(),
           updated_at    = now()
     where id = v_id and organization_id = p_organization_id and not is_archived;
    if not found then
      raise exception 'الدور غير موجود في هذه المنشأة أو مؤرشف';
    end if;
  end if;

  -- **الاستبدال لا الإضافة:** ما لم يُرسَل يُنزع — وإلّا لم يُمكن سحب صلاحية.
  delete from organization_role_permissions
   where role_id = v_id
     and permission_key <> all(coalesce(p_permissions, '{}'));
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select p_organization_id, v_id, rp from unnest(coalesce(p_permissions, '{}')) rp
  on conflict (role_id, permission_key) do nothing;

  select count(*) into v_n from organization_role_permissions where role_id = v_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', case when p_role_id is null then 'create' else 'update' end,
          v_id, format('دور: %s', trim(p_name_ar)), format('%s صلاحية', v_n));

  return v_id;
end $$;

revoke all on function app_save_organization_role(uuid, uuid, text, text, text, boolean, text[]) from public, anon;
grant execute on function app_save_organization_role(uuid, uuid, text, text, text, boolean, text[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) أرشفة الدور — لا حذف ما دام يحمله أحد
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_archive_organization_role(
  p_organization_id uuid,
  p_role_id         uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_holders int;
begin
  if not app_has_permission(p_organization_id, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوار (users.permissions)';
  end if;

  select name_ar into v_name from organization_roles
   where id = p_role_id and organization_id = p_organization_id;
  if v_name is null then raise exception 'الدور غير موجود في هذه المنشأة'; end if;

  select count(*) into v_holders from organization_memberships
   where organization_id = p_organization_id and custom_role_id = p_role_id and is_active;
  if v_holders > 0 then
    raise exception 'الدور يحمله % مستخدمًا — انقلهم إلى دورٍ آخر أولًا', v_holders;
  end if;

  update organization_roles
     set is_archived = true, is_active = false, archived_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = p_role_id and organization_id = p_organization_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update', p_role_id,
          format('أرشفة دور: %s', v_name), null);
end $$;

revoke all on function app_archive_organization_role(uuid, uuid) from public, anon;
grant execute on function app_archive_organization_role(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) إسناد الدور إلى عضو
-- ═══════════════════════════════════════════════════════════════════════════
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
       and is_active and not is_archived;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) اسم العضو المعروض — للمستخدم الخاصّ ولمن لا ملفّ له
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_set_member_display_name(
  p_organization_id uuid,
  p_user_id         uuid,
  p_display_name    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  update organization_memberships
     set display_name = nullif(trim(coalesce(p_display_name, '')), '')
   where organization_id = p_organization_id and user_id = p_user_id;
  if not found then raise exception 'العضو غير موجود في هذه المنشأة'; end if;
end $$;

revoke all on function app_set_member_display_name(uuid, uuid, text) from public, anon;
grant execute on function app_set_member_display_name(uuid, uuid, text) to authenticated;

commit;
