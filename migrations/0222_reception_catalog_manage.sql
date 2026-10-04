-- ============================================================================
-- 0222_reception_catalog_manage.sql
-- ============================================================================
-- طلب المالك (04/10/2026): «في الاستقبال لا تظهر إضافة خدمة جديدة».
--
-- زرّ «إضافة خدمة جديدة للكتالوج» (0218) ومحرّر الخدمة و`app_save_service`
-- وسياسات `items` (0079) كلّها مشروطة بـ `catalog.manage`، والاستقبال لا
-- يملكها. اختار المالك: **إدارة الكتالوج كاملة للاستقبال** — إضافة الخدمات
-- وتعديلها وأسعارها، مع رؤية شاشة الخدمات (`catalog.view`).
--
-- تُمنح في ثلاثة مواضع حتى تسري على كلّ حساب استقبال:
--   • الافتراض (`role_default_permissions`)
--   • صفة الاستقبال المعدّلة في المنشأة والأدوار المخصّصة المبنيّة عليها
--     (`organization_role_permissions`)
--   • ويُرفع المنع الصريح عن حسابات الاستقبال (`membership_permissions`)
--
-- لا حذف في الكتالوج (0079 يمنعه) — يبقى التعطيل. لا يمسّ الفواتير ولا ZATCA.
-- معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

insert into role_default_permissions (role_key, permission_key)
select 'receptionist', p.permission_key
  from (values ('catalog.view'), ('catalog.manage')) as p(permission_key)
 where exists (select 1 from permission_catalog c where c.permission_key = p.permission_key)
on conflict (role_key, permission_key) do nothing;

with targets as (
  select r.organization_id, r.id as role_id, r.name_ar, p.permission_key
    from organization_roles r
    cross join (values ('catalog.view'), ('catalog.manage')) as p(permission_key)
   where r.base_role_key = 'receptionist'
     and r.is_active
     and not r.is_archived
     and exists (select 1 from permission_catalog c where c.permission_key = p.permission_key)
     and not exists (select 1 from organization_role_permissions x
                      where x.role_id = r.id and x.permission_key = p.permission_key)
),
granted as (
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select organization_id, role_id, permission_key from targets
  returning organization_id, role_id
)
insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
select t.organization_id, null, 'users', 'update', 'صلاحية إدارة الكتالوج للاستقبال',
       'مُنحت «إدارة الكتالوج» لـ: ' || string_agg(distinct coalesce(t.name_ar, 'الاستقبال'), '، ') || ' (0222)'
  from targets t
 where exists (select 1 from granted g where g.role_id = t.role_id)
 group by t.organization_id;

update membership_permissions mp
   set granted = true
 where mp.permission_key in ('catalog.view', 'catalog.manage')
   and not mp.granted
   and exists (select 1 from organization_memberships m
                where m.organization_id = mp.organization_id
                  and m.user_id = mp.user_id
                  and m.role_key = 'receptionist'
                  and m.is_active);

commit;

notify pgrst, 'reload schema';

-- ── النتيجة: حسابات الاستقبال وإضافة الخدمات ─────────────────────────────────
select app_member_user_name(e.organization_id, e.user_id) as "الموظف",
       case when e.is_allowed then 'يستطيع إضافة الخدمات وتعديلها'
            else 'لا يستطيع — راجع صلاحياته' end as "الحالة"
  from v_user_effective_permissions e
 where e.role_key = 'receptionist'
   and e.permission_key = 'catalog.manage'
 order by 2 desc, 1;
