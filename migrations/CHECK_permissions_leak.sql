-- ============================================================================
-- CHECK_permissions_leak — لماذا يرى عضوٌ كلَّ الشاشات ودوره بلا صلاحية واحدة
-- ============================================================================
--
-- سكربت قراءةٍ فقط. لا يُعدّل شيئًا. نفّذه كاملًا واقرأ النتائج الأربع.
--
-- الجدول الرابع هو الحكم: هو جواب **القاعدة نفسها** عن كل مفتاح
-- (`v_my_permissions` ← `app_has_permission`). إن قال «ممنوح: 0» وكانت الشاشة
-- تعرض كلّ شيء، فالتسريب في المتصفّح لا في القاعدة.
-- ============================================================================

-- ── 1) هل «الوصول الكامل القديم» مرفوع على المنشأة؟ ────────────────────────
--
-- `legacy_full_access = true` كان يجعل `canAccessFeature` في الواجهة تُرجع
-- true لكلّ شاشة قبل أن تنظر إلى الدور أصلًا.
select 'المنشأة' as "الفحص",
       o.id,
       o.name,
       o.legacy_full_access as "الوصول الكامل القديم"
  from organizations o
 order by o.created_at;

-- ── 2) هل ضُبطت مزايا المنشأة؟ ─────────────────────────────────────────────
--
-- صفرٌ هنا يعني أنّ `organization_features` فارغ، وأنّ إغلاق التجاوز بلا
-- احتياطٍ كان سيُخفي كلّ شاشةٍ عن الجميع — والاحتياط مضافٌ في الشيفرة.
select 'المزايا المفعّلة' as "الفحص",
       o.name,
       count(f.*) filter (where f.enabled) as "عدد المزايا المفعّلة"
  from organizations o
  left join organization_features f on f.organization_id = o.id
 group by o.id, o.name
 order by o.name;

-- ── 3) الأعضاء: الصفة، والدور المخصّص إن أُسنِد ────────────────────────────
--
-- **انظر إلى `الدور المخصّص` بعناية:** إن كان فارغًا فالدور الذي أنشأته لم
-- يُسنَد إلى العضو أصلًا، وتبقى افتراضات صفته هي العاملة. و`مدير فرع`
-- افتراضه في القاعدة **كلّ الشاشات** (0143).
select 'الأعضاء' as "الفحص",
       m.display_name as "الاسم",
       m.role_key     as "الصفة",
       r.name_ar      as "الدور المخصّص",
       m.is_active    as "نشط",
       u.email        as "البريد"
  from organization_memberships m
  join organizations o       on o.id = m.organization_id
  left join organization_roles r on r.id = m.custom_role_id
  left join auth.users u     on u.id = m.user_id
 where o.name like '%أسناني%'
 order by case m.role_key
            when 'owner' then 0
            when 'organization_admin' then 1
            else 2
          end, m.display_name;

-- ── 4) مدخلات القرار لكلّ عضو، وأيّها يسري ─────────────────────────────────
--
-- `v_my_permissions` تقرأ `auth.uid()` ومحرّر SQL يعمل بلا مستخدم، فتُعرض هنا
-- **مدخلات** `app_has_permission` الثلاثة بدلًا منها. وأسبقيّتها معروفة:
--
--   مالك/مدير نظام  ←  استثناء صريح  ←  الدور المخصّص  ←  افتراض الصفة
--
-- والدور المخصّص **يحلّ محلّ** افتراض الصفة ولا يُضاف إليه. فعمود «ما يسري»
-- هو الجواب: «دور مخصّص: 0» يعني أنّ القاعدة تمنعه من كلّ شيء.
select 'مدخلات القرار' as "الفحص",
       m.display_name as "الاسم",
       m.role_key     as "الصفة",
       coalesce(r.name_ar, '—') as "الدور المخصّص",
       (select count(*) from organization_role_permissions rp
         where rp.role_id = m.custom_role_id)        as "صلاحيات الدور المخصّص",
       (select count(*) from role_default_permissions d
         where d.role_key = m.role_key)              as "افتراضات الصفة",
       (select count(*) from membership_permissions mp
         where mp.organization_id = m.organization_id
           and mp.user_id = m.user_id)               as "استثناءات صريحة",
       case
         when m.role_key in ('owner','organization_admin') then 'كل شيء (صفة إدارية)'
         when m.custom_role_id is not null then
           'الدور المخصّص: ' ||
           (select count(*) from organization_role_permissions rp where rp.role_id = m.custom_role_id)
         else
           'افتراض الصفة: ' ||
           (select count(*) from role_default_permissions d where d.role_key = m.role_key)
       end as "ما يسري"
  from organization_memberships m
  join organizations o on o.id = m.organization_id
  left join organization_roles r on r.id = m.custom_role_id
 where o.name like '%أسناني%'
   and m.is_active
 order by m.display_name;
