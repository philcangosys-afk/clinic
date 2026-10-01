-- ============================================================================
-- 0199 — إزالة عضوٍ من المنشأة نهائيًّا (شاشة المستخدمين)
-- ============================================================================
--
-- كانت الشاشة تعطّل الدخول فقط، فيبقى العضو المعطَّل في القائمة إلى الأبد —
-- حسابٌ أُنشئ بالخطأ أو لموظّفٍ غادر لا يُزال.
--
-- `app_remove_member(org, user, reason)` تزيل **العضويّة** في معاملةٍ واحدة:
--   * صلاحيتها `app_can_manage_member_account` (0185): `users.manage`، وحساب
--     المالك لا يزيله إلّا مالك.
--   * لا يزيل المستخدم نفسه، ولا يُزال آخر مالكٍ نشط، والسبب مطلوب.
--   * تفكّ ربط الحساب بملفّ الطبيب (`doctors.user_id`) وملفّ الموظّف
--     (`employees.user_id`) في المنشأة — الملفّان يبقيان كما هما.
--   * تحذف العضويّة، ومعها استثناءات صلاحياته (`membership_permissions` تُحذف
--     بالتتالي). وسطر تدقيق بالاسم والبريد والصفة والسبب.
--
-- ما لا يُمسّ: كلّ ما سجّله العضو من مواعيد وفواتير وسندات وملفّات وسجلّ
-- تدقيق يبقى باسمه — فحساب الدخول نفسه (`auth.users`) لا يُحذف، إذ عليه تقوم
-- تلك المراجع. يفقد الوصول إلى المنشأة كلّيًّا، وإن أُضيف لاحقًا بالبريد نفسه
-- عاد عضوًا جديدًا (دالّة `admin-users` تضمّ البريد المسجَّل سلفًا).
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

create or replace function app_remove_member(
  p_organization_id uuid,
  p_user_id         uuid,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_m     organization_memberships%rowtype;
  v_email text;
  v_name  text;
begin
  if p_user_id = auth.uid() then
    raise exception 'لا يمكنك إزالة حسابك بنفسك — اطلب ذلك من مالكٍ آخر';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الإزالة مطلوب';
  end if;

  select * into v_m from organization_memberships
   where organization_id = p_organization_id and user_id = p_user_id
   for update;
  if v_m.user_id is null then
    raise exception 'العضو غير موجود في هذه المنشأة';
  end if;
  if not app_can_manage_member_account(p_organization_id, p_user_id) then
    raise exception 'صلاحيتك لا تسمح بإزالة هذا العضو — حساب المالك لا يزيله إلّا مالك (users.manage)';
  end if;
  if v_m.role_key = 'owner' and not exists (
       select 1 from organization_memberships o
        where o.organization_id = p_organization_id
          and o.user_id <> p_user_id
          and o.role_key = 'owner' and o.is_active) then
    raise exception 'لا يمكن إزالة آخر مالكٍ للمنشأة — عيّن مالكًا آخر أوّلًا';
  end if;

  select email into v_email from auth.users where id = p_user_id;
  v_name := coalesce(nullif(btrim(v_m.display_name), ''),
                     (select name_ar from employees where organization_id = p_organization_id and user_id = p_user_id limit 1),
                     (select name_ar from doctors   where organization_id = p_organization_id and user_id = p_user_id limit 1),
                     v_email, p_user_id::text);

  update doctors   set user_id = null where organization_id = p_organization_id and user_id = p_user_id;
  update employees set user_id = null where organization_id = p_organization_id and user_id = p_user_id;

  begin
    -- الاستثناءات تُحذف بالتتالي من قيدها المركّب؛ وصراحةً هنا لقاعدةٍ فاتها القيد
    delete from membership_permissions
     where organization_id = p_organization_id and user_id = p_user_id;
    delete from organization_memberships
     where organization_id = p_organization_id and user_id = p_user_id;
  exception when foreign_key_violation then
    raise exception 'تعذّرت الإزالة: العضويّة مرتبطةٌ بسجلّاتٍ لا تُحذف (%) — عطّل الدخول بدلًا منها', sqlerrm;
  end;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details, reason)
  values (p_organization_id, auth.uid(), 'users', 'delete', p_user_id,
          'إزالة عضو من المنشأة: ' || v_name,
          jsonb_build_object('email', v_email, 'role_key', v_m.role_key,
                             'was_active', v_m.is_active, 'member_kind', v_m.member_kind)::text,
          btrim(p_reason));
end $$;

revoke all on function app_remove_member(uuid, uuid, text) from public, anon;
grant execute on function app_remove_member(uuid, uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'app_remove_member') then
    raise exception '0199 لم تكتمل';
  end if;
end $$;
