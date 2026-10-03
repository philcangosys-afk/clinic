-- ============================================================================
-- 0209 — صلاحيات الاتفاقيات في قسمٍ مستقلّ، وإعادتها للطبيب والاستقبال
-- ----------------------------------------------------------------------------
-- المشكلة: صلاحيات الاتفاقيات (عرض / إنشاء / إلغاء المديونية) كانت مسجّلة تحت
-- نطاق «الفوترة والمدفوعات» (module_key = 'billing'). فمن عدّل صفة «طبيب» في
-- «الأدوار والصلاحيات» وجعل الفوترة «بدون وصول» — وهو الصحيح، فالفوترة
-- للاستقبال وحده — أسقط معها «إنشاء الاتفاقيات» دون أن يقصد، فصار زرّ «إضافة»
-- في اتفاقيات المريض معطّلًا في حساب الطبيب.
--
-- ما تفعله:
--   ١) تنقل الصلاحيات الثلاث إلى نطاقٍ خاصّ بها «اتفاقيات المرضى»
--      (module_key = 'agreements') — يظهر في الشاشة سطرًا مستقلًّا عن الفوترة.
--   ٢) تمنح «عرض الاتفاقيات» و«إنشاء الاتفاقيات» لكلّ صفة منشأة أو دورٍ مخصّص
--      أساسه «طبيب» أو «استقبال» وينقصه ذلك — كقرار المالك: الطبيب يُنشئ
--      الاتفاقية ويعدّلها ويُشعر الاستقبال، والاستقبال يفوتر.
--      لا تُمنح «إلغاء المديونية» (لمدير الفرع).
--   ٣) لا تمسّ المنع الصريح لعضوٍ بعينه (membership_permissions): يُسرد في
--      النتيجة ليُراجَع من «المستخدمون».
--   ٤) سطر تدقيق لكلّ منشأة تغيّر فيها شيء.
--
-- لا يمسّ الفواتير ولا ZATCA. آمنة للتكرار.
-- ============================================================================

-- ملاحظة: محرّر Supabase ينفّذ كلّ جملةٍ في معاملتها، فلا جداول مؤقّتة هنا:
-- المنح وسطر التدقيق جملةٌ واحدة (CTE) تنجح كلّها أو لا شيء.

-- ── ١) نطاقٌ مستقلّ ──────────────────────────────────────────────────────────
update permission_catalog
   set module_key = 'agreements'
 where permission_key in ('agreements.view', 'agreements.manage', 'agreements.cancel_debt')
   and module_key is distinct from 'agreements';

-- ── ٢) إعادة الصلاحيتين لأدوار الطبيب والاستقبال في المنشآت + التدقيق ─────
with targets as (
  select r.organization_id, r.id as role_id, r.name_ar, r.base_role_key, k.permission_key
    from organization_roles r
    cross join (values ('agreements.view'), ('agreements.manage')) as k(permission_key)
   where r.base_role_key in ('doctor', 'receptionist')
     and r.is_active
     and not r.is_archived
     and not exists (select 1 from organization_role_permissions x
                      where x.role_id = r.id and x.permission_key = k.permission_key)
),
granted as (
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select organization_id, role_id, permission_key from targets
  returning organization_id, role_id
)
insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
select t.organization_id, null, 'users', 'update', 'صلاحيات الاتفاقيات',
       'أُعيد «عرض الاتفاقيات» و«إنشاء الاتفاقيات» إلى: '
       || string_agg(distinct coalesce(t.name_ar, t.base_role_key), '، ')
       || ' — ونُقلت صلاحيات الاتفاقيات إلى قسمٍ مستقلّ عن الفوترة (0209)'
  from targets t
 where exists (select 1 from granted g where g.role_id = t.role_id)
 group by t.organization_id;

-- ── النتيجة: من يستطيع إنشاء الاتفاقيات الآن من الأطباء والاستقبال ──────────
select app_member_user_name(e.organization_id, e.user_id) as "المستخدم",
       case e.role_key when 'doctor' then 'طبيب' when 'receptionist' then 'استقبال' else e.role_key end as "الصفة",
       case when e.is_allowed then 'نعم' else 'لا' end           as "ينشئ الاتفاقيات",
       case e.source
         when 'explicit_deny'  then 'ممنوع صراحةً لهذا المستخدم — يُعدَّل من «المستخدمون» ← الصلاحيات'
         when 'explicit_grant' then 'ممنوح صراحةً لهذا المستخدم'
         when 'custom_role'    then 'من دوره المخصّص'
         when 'role_default'   then 'من صفته'
         when 'admin'          then 'مالك/مدير'
         else 'غير ممنوح'
       end                                                       as "المصدر"
  from v_user_effective_permissions e
 where e.permission_key = 'agreements.manage'
   and e.role_key in ('doctor', 'receptionist')
 order by e.is_allowed, e.role_key, 1;
