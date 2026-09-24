-- ============================================================================
-- 0185 — ضمّ حسابٍ إلى المنشأة: الموظّف والمستخدم الخاصّ
-- ============================================================================
--
-- إنشاء الحساب نفسه (بريد وكلمة مرور) يجري في الدالّة الطرفية `admin-users`
-- لأنّه يحتاج مفتاح الخدمة، ولا يجوز لمفتاح الخدمة أن يمرّ في المتصفّح.
-- وما بعد الإنشاء — العضوية والدور والاسم وربط ملفّ الموظّف — يجري هنا،
-- بصلاحية **المستخدم الطالب** لا بمفتاح الخدمة: فالفحص في القاعدة، والأثر
-- في سجلّ التدقيق باسم من فعل، لا باسم «النظام».
--
-- **المستخدم الخاصّ** (`member_kind = 'special'`): محاسبٌ أو مراجعٌ يدخل
-- النظام ولا ملفّ له في الموظفين ولا في كشف الرواتب — يحمل دورًا كأيّ عضو،
-- ويُعرَف باسمه المكتوب على عضويته (0183).
--
-- آمنة للتكرار.
-- ============================================================================

begin;

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
  values (p_organization_id, auth.uid(), 'users', 'create', p_user_id,
          coalesce(v_name, 'عضو جديد'),
          format('%s — %s', case when v_kind = 'special' then 'مستخدم خاصّ' else 'موظّف' end, v_role));
end $$;

revoke all on function app_attach_member(uuid, uuid, text, uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function app_attach_member(uuid, uuid, text, uuid, uuid, text, text, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- هل يجوز لهذا المستخدم أن يمسّ حساب ذاك؟ تفحصه الدالّة الطرفية قبل
-- تغيير كلمة مرورٍ أو بريد — فالقرار في القاعدة لا في الشيفرة الطرفية.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_can_manage_member_account(
  p_organization_id uuid,
  p_user_id         uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select app_has_permission(p_organization_id, 'users.manage')
     and exists (
       select 1 from organization_memberships m
        where m.organization_id = p_organization_id
          and m.user_id = p_user_id
     )
     -- حساب المالك لا يمسّه إلّا مالك: كلمة مرورٍ يغيّرها مديرٌ على المالك
     -- استيلاءٌ على المنشأة.
     and (
       not exists (
         select 1 from organization_memberships o
          where o.organization_id = p_organization_id
            and o.user_id = p_user_id
            and o.role_key = 'owner')
       or exists (
         select 1 from organization_memberships me
          where me.organization_id = p_organization_id
            and me.user_id = auth.uid()
            and me.role_key = 'owner'
            and me.is_active)
     );
$$;

revoke all on function app_can_manage_member_account(uuid, uuid) from public, anon;
grant execute on function app_can_manage_member_account(uuid, uuid) to authenticated;

-- سجلّ ما جرى على الحسابات — تكتبه الدالّة الطرفية بصلاحية الطالب
create or replace function app_log_account_action(
  p_organization_id uuid,
  p_user_id         uuid,
  p_title           text,
  p_details         text default null
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
  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update', p_user_id,
          coalesce(nullif(trim(coalesce(p_title, '')), ''), 'تعديل حساب'), p_details);
end $$;

revoke all on function app_log_account_action(uuid, uuid, text, text) from public, anon;
grant execute on function app_log_account_action(uuid, uuid, text, text) to authenticated;

commit;
