-- ============================================================================
-- 0229_reception_patient_transfer.sql — الاستقبال يحوّل المريض إلى طبيب آخر
-- ============================================================================
-- طلب المالك (05/10/2026): «افتح خاصية تحويل ملف المريض التي تظهر في ملف
-- المريض ليوزر الاستقبال».
--
-- `app_transfer_patient_to_doctor` (0223) كانت للأطباء ولإدارة المنشأة. يُضاف
-- الاستقبال إلى صفّ الإدارة: يحوّل أيّ مريض، والمحوِّل المسجَّل هو الطبيب
-- المعالج (الاستقبال لا بطاقة طبيب له). لا يتغيّر شيءٌ آخر في الدالّة.
--
-- يُرقَّع نصّ الدالّة الحيّ (pg_get_functiondef) لا نصّ الملف، وتفشل الترقية
-- صراحةً إن لم يُطابق النمط. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.app_transfer_patient_to_doctor(uuid,uuid,uuid,text)'::regprocedure)
    into v_src;
  v_src := replace(v_src, chr(13), '');

  if v_src ~ 'branch_manager'',\s*''receptionist''\]' then
    raise notice 'الاستقبال مضاف سلفًا — لا تغيير';
    return;
  end if;

  v_new := regexp_replace(v_src,
    'v_admin := app_has_role\(p_organization_id, array\[''owner'',\s*''organization_admin'',\s*''branch_manager''\]\);',
    'v_admin := app_has_role(p_organization_id, array[''owner'',''organization_admin'',''branch_manager'',''receptionist'']);');
  if v_new = v_src then
    raise exception 'تعذّر ترقيع app_transfer_patient_to_doctor — تغيّر نصّها';
  end if;

  v_new := replace(v_new, 'تحويل المريض للأطباء وإدارة المنشأة',
                          'تحويل المريض للأطباء والاستقبال وإدارة المنشأة');
  execute v_new;
end $$;

commit;

notify pgrst, 'reload schema';

select 'تحويل المريض — الاستقبال' as "البند",
       case when pg_get_functiondef('public.app_transfer_patient_to_doctor(uuid,uuid,uuid,text)'::regprocedure)
                 like '%''receptionist''%'
            then 'جاهزة' else 'مفقودة' end as "الحالة";
