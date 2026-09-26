-- ============================================================================
-- 0187 — تصحيح نوع الحركة في سجلّ التدقيق: «add» لا «create»
-- ============================================================================
--
-- `audit_log.action_type` مقيَّد بقيمٍ ثابتة منذ 0025: **add / update / delete**
-- — وهي التي تكتبها مشغّلات التدقيق كلّها. وكتبتُ في 0183 و0185 القيمة
-- «create»، فكان حفظُ دورٍ جديد أو ضمُّ عضوٍ جديد يمرّ بالعمل كلّه ثمّ يسقط
-- عند السطر الأخير برسالة:
--
--   new row for relation "audit_log" violates check constraint
--   "audit_log_action_type_check"
--
-- والمعاملة تتراجع كاملةً، فيرى المستخدم «تعذّر الحفظ» ولا دورَ يُحفظ.
--
-- هنا تُعاد الدالّتان بالقيمة الصحيحة، ولا شيء غيرهما يتغيّر.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

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
  values (p_organization_id, auth.uid(), 'users', case when p_role_id is null then 'add' else 'update' end,
          v_id, format('دور: %s', trim(p_name_ar)), format('%s صلاحية', v_n));

  return v_id;
end $$;


create or replace function app_attach_member(
  p_organization_id uuid,
  p_user_id         uuid,
  p_role_key        text,
  p_custom_role_id  uuid default null,
  p_branch_id       uuid default null,
  p_display_name    text default null,
  p_member_kind     text default 'employee',
  p_employee_id     uuid default null,
  p_email           text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  text := coalesce(nullif(trim(coalesce(p_role_key, '')), ''), 'employee');
  v_kind  text := coalesce(nullif(trim(coalesce(p_member_kind, '')), ''), 'employee');
  v_base  text;
  v_name  text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if not app_has_permission(p_organization_id, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  if p_user_id is null then
    raise exception 'معرّف المستخدم مطلوب';
  end if;
  if v_kind not in ('employee','special') then
    raise exception 'نوع العضو غير معروف: %', v_kind;
  end if;

  -- **المالك لا يُصنع من هنا:** منح صفة المالك قرارُ مالكٍ قائم من شاشة
  -- الأعضاء، لا أثرٌ جانبيّ لإنشاء حساب.
  if v_role = 'owner' then
    raise exception 'لا تُنشأ صفة «مالك المنشأة» عند إنشاء الحساب';
  end if;

  if p_custom_role_id is not null then
    select base_role_key into v_base from organization_roles
     where id = p_custom_role_id and organization_id = p_organization_id
       and is_active and not is_archived;
    if v_base is null then raise exception 'الدور المخصّص غير موجود أو غير نشط'; end if;
    v_role := v_base;
  end if;

  -- تحديثٌ ثمّ إدراج، لا `on conflict`: قيد التفرّد على (المنشأة، المستخدم)
  -- ليس مضمون الاسم في كل نسخة من القاعدة، والاعتماد عليه يكسر الترقية.
  update organization_memberships
     set role_key       = v_role,
         custom_role_id = p_custom_role_id,
         branch_id      = coalesce(p_branch_id, branch_id),
         display_name   = coalesce(v_name, display_name),
         member_kind    = v_kind,
         is_active      = true
   where organization_id = p_organization_id and user_id = p_user_id;

  if not found then
    insert into organization_memberships (
      organization_id, user_id, role_key, custom_role_id, branch_id,
      display_name, member_kind, is_active
    ) values (
      p_organization_id, p_user_id, v_role, p_custom_role_id, p_branch_id,
      v_name, v_kind, true
    );
  end if;

  -- ربط ملفّ الموظّف بالحساب: به يعرف النظام أنّ هذا الداخل هو ذاك الموظّف
  if p_employee_id is not null then
    update employees
       set user_id = p_user_id,
           email   = coalesce(nullif(trim(coalesce(p_email, '')), ''), email)
     where id = p_employee_id and organization_id = p_organization_id;
    if not found then
      raise exception 'ملفّ الموظّف غير موجود في هذه المنشأة';
    end if;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'add', p_user_id,
          coalesce(v_name, 'عضو جديد'),
          format('%s — %s', case when v_kind = 'special' then 'مستخدم خاصّ' else 'موظّف' end, v_role));
end $$;


revoke all on function app_save_organization_role(uuid, uuid, text, text, text, boolean, text[]) from public, anon;
grant execute on function app_save_organization_role(uuid, uuid, text, text, text, boolean, text[]) to authenticated;

revoke all on function app_attach_member(uuid, uuid, text, uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function app_attach_member(uuid, uuid, text, uuid, uuid, text, text, uuid, text) to authenticated;

commit;
