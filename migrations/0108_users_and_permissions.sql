-- ============================================================================
-- 0108 — المرحلة 28: المستخدمون والصلاحيات
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- النظام يملك منذ البداية آليّة صلاحيات محكمة (`app_has_permission`: المالك
-- والأدمن كل شيء، ثم منحٌ أو منعٌ صريح للعضو، ثم افتراضات دوره). لكن ينقصها
-- ثلاثة أشياء تجعلها قابلة للحوكمة لا للاستعمال فقط:
--
--   1) **لا أحد يستطيع أن يرى ما يستطيعه مستخدمٌ فعلًا.** المنطق موزَّع على
--      ثلاث طبقات، ولا منظور يجمعها. مديرٌ لا يعرف من يملك ماذا لا يستطيع
--      ضبط شيء، وأيّ مراجعة اعتماد تبدأ بهذا السؤال بالذات.
--
--   2) **لا حماية من قفل المنشأة على نفسها.** تعطيل آخر مالكٍ نشط أو تغيير
--      دوره ممكن اليوم، وبعدها لا يبقى في المنشأة من يستطيع إعادة تعيين أحد.
--      خطأٌ من نقرةٍ واحدة لا رجعة فيه إلا من قاعدة البيانات مباشرة.
--
--   3) **لا مانع من ترقية النفس.** عضوٌ يملك إدارة المستخدمين يستطيع اليوم
--      أن يمنح نفسه أيّ صلاحية. الفصل بين من يَمنح ومن يُمنَح أساسٌ رقابيّ:
--      من أراد صلاحيةً جديدة يطلبها من غيره، ويبقى الطلب في سجلّ.
--
-- وزيادةً على ذلك: منظور **تعارض المهام** — من يملك طرفَي عمليةٍ واحدة
-- (يُنشئ ويعتمد، يُصدر ويُلغي). النظام يمنع التنفيذ المزدوج وقت العمل،
-- لكن وجود التعارض أصلًا ملاحظةٌ تُرفع للإدارة قبل أن تُستعمل.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if to_regclass('public.patient_portal_accounts') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql  (بوابة المريض)';
  end if;
  if to_regclass('public.critical_result_notifications') is null then
    v_missing := v_missing || E'\n  • 0105_doctor_workspace.sql  (مساحة الطبيب والنتائج الحرجة)';
  end if;
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if to_regclass('public.organization_policies') is null then
    v_missing := v_missing || E'\n  • 0107_organization_policies.sql  (سياسات المنشأة)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0108_users_and_permissions.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('users.view',        'عرض المستخدمين',        'users', 2100),
  ('users.manage',      'إدارة الأعضاء وأدوارهم','users', 2102),
  ('users.permissions', 'منح الصلاحيات ومنعها',  'users', 2104)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select 'branch_manager', 'users.view'
where not exists (select 1 from role_default_permissions
                   where role_key = 'branch_manager' and permission_key = 'users.view');

-- ===========================================================================
-- 2) **حماية آخر مالك**: لا تُقفل المنشأة على نفسها
-- ===========================================================================
create or replace function app_guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_user uuid; v_was_owner boolean; v_remaining int;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_user := old.user_id;
    v_was_owner := old.role_key = 'owner' and old.is_active;
  else
    v_org := new.organization_id; v_user := new.user_id;
    -- يهمّنا فقدان صفة المالك: بالتعطيل أو بتغيير الدور
    v_was_owner := old.role_key = 'owner' and old.is_active
                   and (new.role_key <> 'owner' or not new.is_active);
  end if;

  if not coalesce(v_was_owner, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into v_remaining
    from organization_memberships m
   where m.organization_id = v_org
     and m.role_key = 'owner'
     and m.is_active
     and m.user_id <> v_user;

  if v_remaining = 0 then
    raise exception 'لا يمكن إزالة آخر مالك للمنشأة — عيّن مالكًا آخر أولًا';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_last_owner on organization_memberships;
create trigger trg_guard_last_owner
  before update or delete on organization_memberships
  for each row execute function app_guard_last_owner();

-- ===========================================================================
-- 3) **لا ترقية للنفس**: من يَمنح غير من يُمنَح
-- ===========================================================================
create or replace function app_guard_self_privilege()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid; v_role_changed boolean := false;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;   -- ترحيل/نظام
  end if;

  if tg_table_name = 'membership_permissions' then
    v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    if v_user = auth.uid() then
      raise exception 'لا تُعدَّل صلاحياتك بنفسك — اطلبها من مسؤولٍ آخر';
    end if;
  else
    if tg_op = 'UPDATE' then
      v_role_changed := new.role_key is distinct from old.role_key;
      if v_role_changed and new.user_id = auth.uid() then
        raise exception 'لا تُغيّر دورك بنفسك — اطلبه من مسؤولٍ آخر';
      end if;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_self_permissions on membership_permissions;
create trigger trg_guard_self_permissions
  before insert or update or delete on membership_permissions
  for each row execute function app_guard_self_privilege();

drop trigger if exists trg_guard_self_role on organization_memberships;
create trigger trg_guard_self_role
  before update on organization_memberships
  for each row execute function app_guard_self_privilege();

-- ===========================================================================
-- 4) الدوال التشغيلية — كلها موثَّقة في سجل التدقيق
-- ===========================================================================
create or replace function app_set_membership_role(
  p_org      uuid,
  p_user_id  uuid,
  p_role_key text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old text;
begin
  if not app_has_permission(p_org, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  select role_key into v_old from organization_memberships
   where organization_id = p_org and user_id = p_user_id;
  if v_old is null then raise exception 'العضو غير موجود في هذه المنشأة'; end if;
  if v_old = p_role_key then return; end if;

  update organization_memberships
     set role_key = p_role_key
   where organization_id = p_org and user_id = p_user_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id, 'تغيير دور عضو',
          format('%s ← %s', v_old, p_role_key), p_reason);
end $$;

create or replace function app_set_member_active(
  p_org     uuid,
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  -- **تعطيل عضو قرارٌ يُعلَّل**: يقطع وصوله لسجلات المرضى فورًا
  if not p_active and coalesce(trim(coalesce(p_reason, '')), '') = '' then
    raise exception 'سبب التعطيل مطلوب';
  end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'لا تُعطّل عضويتك بنفسك';
  end if;

  update organization_memberships
     set is_active = p_active
   where organization_id = p_org and user_id = p_user_id;
  if not found then raise exception 'العضو غير موجود في هذه المنشأة'; end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          case when p_active then 'تفعيل عضو' else 'تعطيل عضو' end, null, p_reason);
end $$;

create or replace function app_set_member_permission(
  p_org        uuid,
  p_user_id    uuid,
  p_permission text,
  p_granted    boolean,   -- true = منح صريح، false = منع صريح
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بمنح الصلاحيات (users.permissions)';
  end if;
  if not exists (select 1 from permission_catalog where permission_key = p_permission) then
    raise exception 'صلاحية غير معروفة: %', p_permission;
  end if;
  if not exists (select 1 from organization_memberships
                  where organization_id = p_org and user_id = p_user_id) then
    raise exception 'العضو غير موجود في هذه المنشأة';
  end if;

  insert into membership_permissions (organization_id, user_id, permission_key, granted)
  values (p_org, p_user_id, p_permission, p_granted)
  on conflict (organization_id, user_id, permission_key)
  do update set granted = excluded.granted;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          case when p_granted then 'منح صلاحية' else 'منع صلاحية' end,
          p_permission, p_reason);
end $$;

create or replace function app_clear_member_permission(
  p_org        uuid,
  p_user_id    uuid,
  p_permission text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بتعديل الصلاحيات (users.permissions)';
  end if;

  delete from membership_permissions
   where organization_id = p_org and user_id = p_user_id
     and permission_key = p_permission;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          'إعادة صلاحية إلى افتراض الدور', p_permission);
end $$;

-- ===========================================================================
-- 5) المناظير
-- ===========================================================================

-- 5.1 ما يستطيعه كل عضو فعلًا، ومن أين جاءت الصلاحية
-- المنظوران التاليان يعتمدان عليه، فيُسقطان قبله لتبقى الهجرة قابلة للإعادة
drop view if exists v_duty_conflicts;
drop view if exists v_members_overview;
drop view if exists v_user_effective_permissions;
create view v_user_effective_permissions
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
    else exists (select 1 from role_default_permissions d
                  where d.role_key = m.role_key
                    and d.permission_key = c.permission_key)
  end              as is_allowed,
  case
    when m.role_key in ('owner','organization_admin') then 'admin'
    when mp.permission_key is not null and mp.granted then 'explicit_grant'
    when mp.permission_key is not null and not mp.granted then 'explicit_deny'
    when exists (select 1 from role_default_permissions d
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
where m.is_active;

comment on view v_user_effective_permissions is
  'الصلاحية الفعلية لكل عضو ومصدرها: صفة إدارية، أو منح/منع صريح، أو افتراض دوره.';

-- 5.2 نظرة عامة على الأعضاء
drop view if exists v_members_overview;
create view v_members_overview
with (security_invoker = on) as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  m.is_active,
  m.branch_id,
  b.name       as branch_name,
  u.email,
  d.id         as doctor_id,
  d.name_ar    as doctor_name,
  (select count(*) from membership_permissions p
    where p.organization_id = m.organization_id and p.user_id = m.user_id
      and p.granted)                                   as explicit_grants,
  (select count(*) from membership_permissions p
    where p.organization_id = m.organization_id and p.user_id = m.user_id
      and not p.granted)                               as explicit_denies,
  (select count(*) from v_user_effective_permissions e
    where e.organization_id = m.organization_id and e.user_id = m.user_id
      and e.is_allowed)                                as allowed_count,
  m.created_at,
  m.created_at::date as report_date
from organization_memberships m
left join auth.users u on u.id = m.user_id
left join branches b on b.id = m.branch_id
left join doctors d on d.user_id = m.user_id and d.organization_id = m.organization_id;

-- 5.3 **تعارض المهام**: من يملك طرفَي العملية الواحدة
drop view if exists v_duty_conflicts;
create view v_duty_conflicts
with (security_invoker = on) as
with pairs(conflict_key, name_ar, perm_a, perm_b) as (
  values
    ('payroll',   'يحتسب الرواتب ويعتمدها',      'payroll.run',        'payroll.approve'),
    ('purchase',  'يطلب الشراء ويوافق عليه',     'purchasing.request', 'purchasing.approve'),
    ('billing',   'يُصدر الفواتير ويُلغيها',      'billing.issue',      'billing.void'),
    ('journal',   'يُنشئ القيود ويرحّلها',        'accounting.manage',  'accounting.post'),
    ('inventory', 'يجرد المخزون ويعتمد الجرد',   'inventory.count',    'inventory.count_approve'),
    ('consent',   'يسجّل الموافقات ويتجاوزها',    'consents.sign',      'consents.override')
)
select
  a.organization_id,
  a.user_id,
  a.role_key,
  p.conflict_key,
  p.name_ar        as conflict_name,
  p.perm_a,
  p.perm_b,
  current_date     as report_date
from pairs p
join v_user_effective_permissions a
  on a.permission_key = p.perm_a and a.is_allowed
join v_user_effective_permissions b
  on b.organization_id = a.organization_id and b.user_id = a.user_id
 and b.permission_key = p.perm_b and b.is_allowed;

comment on view v_duty_conflicts is
  'أعضاء يملكون طرفَي عملية واحدة. النظام يمنع التنفيذ المزدوج وقت العمل، وهذا المنظور يُظهر التعارض قبل أن يُستعمل.';

grant select on v_user_effective_permissions, v_members_overview, v_duty_conflicts
  to authenticated;

-- ===========================================================================
-- 6) الميزة وحجب الدوال
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_set_membership_role','app_set_member_active',
                         'app_set_member_permission','app_clear_member_permission',
                         'app_guard_last_owner','app_guard_self_privilege')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 7) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_set_membership_role','app_set_member_active',
                             'app_set_member_permission','app_clear_member_permission']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المستخدمين % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_last_owner') then
    raise exception 'حماية آخر مالك غير مركَّبة — المنشأة قابلة للقفل على نفسها';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_self_permissions') then
    raise exception 'منع ترقية النفس غير مركَّب';
  end if;

  foreach v_v in array array['v_user_effective_permissions','v_members_overview',
                             'v_duty_conflicts']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'المنظور % بلا security_invoker', v_v;
    end if;
  end loop;
end $$;
