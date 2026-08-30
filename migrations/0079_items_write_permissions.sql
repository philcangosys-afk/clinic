-- 0079_items_write_permissions.sql
-- من يكتب في الكتالوج.
--
-- سياسة `items` الحالية سطر واحد لكل العمليات:
--
--     items_all_members  FOR ALL  USING (app_is_member(organization_id))
--
-- أي أن **كل عضو في المنشأة يستطيع تعديل أي صنف** — موظف الاستقبال يغيّر
-- سعر خدمة، أو يمسح صنفًا مرتبطًا بفواتير. الشاشة تُخفي الأزرار عمّن لا
-- يملك `catalog.manage`، لكن إخفاء الزر ليس منعًا: من يفتح أدوات المطوّر
-- يستدعي Supabase مباشرةً. المنع الحقيقي هنا.
--
-- الأمر نفسه ينطبق على جداول الكتالوج التابعة وعلى `packages`.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) `items`: القراءة لكل عضو، والكتابة لمن يملك `catalog.manage`
--
-- القراءة تبقى مفتوحة لكل الأعضاء عن قصد: شاشة الفوترة والاستقبال والمختبر
-- كلها تبحث في الكتالوج، وتقييد القراءة بصلاحية يكسر عمل من يبيع الخدمة.
-- ---------------------------------------------------------------------------
drop policy if exists items_all_members on items;

drop policy if exists items_select on items;
create policy items_select on items
  for select to authenticated
  using (app_is_member(organization_id));

drop policy if exists items_insert on items;
create policy items_insert on items
  for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists items_update on items;
create policy items_update on items
  for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));

-- الحذف ممنوع على الجميع، ولا سياسة `for delete` إطلاقًا.
--
-- الصنف مرتبط بفواتير وزيارات وطلبات مختبر. حذفه إمّا يفشل بقيد أجنبي أو
-- ينجح فيمحو ما يفسّر فاتورةً صادرة. البديل موجود ومختبَر: `app_archive_item`
-- ترفض الأرشفة إن كانت الخدمة تنتظر الفوترة، وتُبقي التاريخ كاملًا.

-- ---------------------------------------------------------------------------
-- 2) جداول الكتالوج التابعة
--
-- `item_branches` و`item_resources` تُكتبان اليوم بسياسة `catalog.manage`
-- من 0071/0073 — يُتحقّق منهما هنا لا أكثر. الجديد `packages` و
-- `package_items`: كانتا مفتوحتين لكل عضو مثل `items`.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'packages'::regclass
                   and polname = 'packages_select') then
    execute 'drop policy if exists packages_all_members on packages';
    execute 'drop policy if exists packages_rw on packages';

    execute $p$create policy packages_select on packages for select to authenticated
              using (app_is_member(organization_id))$p$;
    execute $p$create policy packages_write on packages for all to authenticated
              using (app_has_permission(organization_id, 'catalog.manage'))
              with check (app_has_permission(organization_id, 'catalog.manage'))$p$;
  end if;
end $$;

-- `package_items` لا تحمل `organization_id`؛ صلاحيتها تُشتقّ من الباقة.
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'package_items'::regclass
                   and polname = 'package_items_select') then
    execute 'drop policy if exists package_items_all_members on package_items';

    execute $p$create policy package_items_select on package_items for select to authenticated
              using (exists (select 1 from packages pk
                              where pk.id = package_items.package_id
                                and app_is_member(pk.organization_id)))$p$;
    execute $p$create policy package_items_write on package_items for all to authenticated
              using (exists (select 1 from packages pk
                              where pk.id = package_items.package_id
                                and app_has_permission(pk.organization_id, 'catalog.manage')))
              with check (exists (select 1 from packages pk
                                   where pk.id = package_items.package_id
                                     and app_has_permission(pk.organization_id, 'catalog.manage')))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) صلاحية الكتالوج لصاحب المنشأة والمدير
--
-- `app_has_permission` تعطي المالك والمدير كل شيء ضمنيًا، لكن الصفات
-- الأخرى تحتاج منحًا صريحًا. بدون هذا تُقفل شاشة الخدمات في وجه من كان
-- يديرها أمس.
-- ---------------------------------------------------------------------------
insert into role_default_permissions (role_key, permission_key)
select r.role_key, p.permission_key
  from (values ('branch_manager'), ('accountant')) as r(role_key)
 cross join (values ('catalog.view'), ('catalog.manage')) as p(permission_key)
 where not exists (
   select 1 from role_default_permissions d
    where d.role_key = r.role_key and d.permission_key = p.permission_key);

insert into role_default_permissions (role_key, permission_key)
select 'receptionist', 'catalog.view'
 where not exists (select 1 from role_default_permissions
                    where role_key = 'receptionist' and permission_key = 'catalog.view');

insert into role_default_permissions (role_key, permission_key)
select 'doctor', 'catalog.view'
 where not exists (select 1 from role_default_permissions
                    where role_key = 'doctor' and permission_key = 'catalog.view');

-- ---------------------------------------------------------------------------
-- 4) فحصٌ صريح بعد التطبيق
--
-- يرفع خطأً إن بقيت على `items` سياسةٌ تسمح بالكتابة لكل عضو. الغرض أن
-- تفشل الهجرة هنا لا أن يُكتشف الخلل بعد شهر.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(polname, ', ') into v_bad
    from pg_policy
   where polrelid = 'items'::regclass
     and polcmd in ('*', 'w', 'a')
     and pg_get_expr(coalesce(polwithcheck, polqual), polrelid) not like '%catalog.manage%';

  if v_bad is not null then
    raise exception 'ما زالت على items سياسة كتابة بلا صلاحية: %', v_bad;
  end if;

  if exists (select 1 from pg_policy where polrelid = 'items'::regclass and polcmd = 'd') then
    raise exception 'توجد سياسة حذف على items — الحذف ممنوع، الأرشفة بديله';
  end if;

  raise notice 'كتابة الكتالوج مقصورة على catalog.manage، والحذف ممنوع';
end $$;

commit;
