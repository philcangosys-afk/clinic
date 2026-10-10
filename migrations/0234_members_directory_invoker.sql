-- ============================================================================
-- 0234_members_directory_invoker.sql — إغلاق تنبيه «Security Definer View»
-- ============================================================================
-- تنبيه Supabase Advisor (حرِج): `public.v_organization_members_directory`
-- مُعرَّف بخاصية SECURITY DEFINER.
--
-- المنظور أُنشئ في 0026 بـ`security_invoker = on` — يُقرأ بصلاحية القارئ فتسري
-- عليه سياسات RLS، فيرى كلّ عضوٍ أعضاءَ منشأته وحدها. ثمّ أعادت 0183 كتابته بـ
-- `create or replace view` بلا الخيار، فسقط ضبطه وصار يُقرأ بصلاحية مالكه:
-- أيّ مستخدمٍ مسجَّل يقرأ أسماء وأدوار أعضاء **كلّ** المنشآت.
--
-- الإصلاح يعيد الخيار ولا يغيّر تعريف المنظور. سياسات القراءة على
-- organization_memberships وdoctors وemployees تسمح لكلّ عضوٍ بقراءة صفوف
-- منشأته، فلا يتغيّر ما يراه أحدٌ داخل منشأته. والزائر غير المسجَّل لا يقرؤه.
-- آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

alter view public.v_organization_members_directory set (security_invoker = on);
revoke all on public.v_organization_members_directory from anon;
grant select on public.v_organization_members_directory to authenticated;

commit;

notify pgrst, 'reload schema';

select 'دليل الأعضاء يُقرأ بصلاحية القارئ' as "البند",
       case when (select reloptions from pg_class where oid = 'public.v_organization_members_directory'::regclass)
                 @> array['security_invoker=on']
            then 'جاهزة' else 'مفقودة' end as "الحالة";
