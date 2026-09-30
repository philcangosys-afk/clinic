-- ============================================================================
-- SETUP — أنواع الزيارة ووسوم المواعيد كما في Kizen: مجمع أسناني المتميز الطبي
-- ============================================================================
--
-- ليست ترقيةً في التسلسل: بياناتُ منشأةٍ بعينها. يُنفَّذ بعد 0197.
--
-- مقارنة قوائم Kizen بما في ZainCare (مواصفات 30/09/2026):
--
--   أنواع الزيارة في Kizen: كشف جديد، مراجعة مريض، مريض انتظار، مريض تقويم،
--   مريض زراعة، جلسة تنظيف وتبييض. في ZainCare لائحةٌ عامّة لكلّ المنشآت
--   («جديد»، «مراجعة (Follow up)»، «أول زيارة») — تبقى كما هي، وتُضاف
--   أسماء Kizen الستّة في لائحةٍ خاصّة بالمنشأة، فيعرض الاختيار الاثنتين معًا
--   (`useLookupTree` و`LookupSelect` يجمعان العامّة والخاصّة).
--
--   حالات الموعد في Kizen وما يقابلها — بلا كود جديد:
--     غير مؤكد            ← «تم الحجز» / «غير مؤكد» (scheduled / unconfirmed)
--     مؤكد                ← confirmed
--     حضر الموعد          ← «وصل» (arrived)
--     لم يحضر الموعد      ← no_show
--     اعتذر عن الموعد     ← cancelled_by_patient (app_cancel_appointment، 0197)
--     في غرفة الانتظار    ← waiting
--     تم تأجيل الموعد     ← وسم «تم تأجيل الموعد» (أدناه)
--     في انتظار المعمل    ← وسم «في انتظار المعمل» (أدناه)
--   الوسمان ليسا حالتين في مسار الدور (وصل ← نداء ← دخل ← خرج)، بل علامةٌ
--   على الموعد تُختار من نافذته — فمكانهما لائحة «وسوم المواعيد» (0197).
--
-- آمنٌ لإعادة التنفيذ: ما وُجد بالاسم نفسه لا يُكرَّر، وما كان معطَّلًا يُفعَّل.
-- لا يحذف ولا يعدّل قيمةً قائمة غير ذلك.
-- ============================================================================

begin;

do $$
declare
  v_org     uuid;
  v_cat     uuid;
  v_name    text;
  v_sort    int;
  v_id      uuid;
  v_added   int := 0;
  v_enabled int := 0;
begin
  select id into v_org from public.organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1;
  if v_org is null then
    raise exception 'لم تُعثر على منشأة «مجمع أسناني المتميز الطبي»';
  end if;
  if not exists (select 1 from lookup_categories where key = 'appointment_labels' and organization_id is null) then
    raise exception 'لائحة «appointment_labels» غير موجودة — نفّذ 0197_appointments_kizen_parity.sql أوّلًا';
  end if;

  -- ── أنواع الزيارة ──────────────────────────────────────────────────────
  select id into v_cat from lookup_categories where key = 'visit_types' and organization_id = v_org;
  if v_cat is null then
    insert into lookup_categories (organization_id, key, name_ar, name_en)
    values (v_org, 'visit_types', 'أنواع الزيارة', 'Visit Types')
    returning id into v_cat;
  end if;

  for v_name, v_sort in
    select * from (values
      ('كشف جديد', 110), ('مراجعة مريض', 120), ('مريض انتظار', 130),
      ('مريض تقويم', 140), ('مريض زراعة', 150), ('جلسة تنظيف وتبييض', 160)
    ) as t(name_ar, sort_order)
  loop
    select id into v_id from lookup_values where category_id = v_cat and btrim(name_ar) = v_name;
    if v_id is null then
      insert into lookup_values (category_id, name_ar, sort_order) values (v_cat, v_name, v_sort);
      v_added := v_added + 1;
    else
      update lookup_values set is_disabled = false where id = v_id and is_disabled;
      if found then v_enabled := v_enabled + 1; end if;
    end if;
  end loop;

  -- ── وسوم المواعيد ──────────────────────────────────────────────────────
  select id into v_cat from lookup_categories where key = 'appointment_labels' and organization_id = v_org;
  if v_cat is null then
    insert into lookup_categories (organization_id, key, name_ar, name_en)
    values (v_org, 'appointment_labels', 'وسوم المواعيد', 'Appointment labels')
    returning id into v_cat;
  end if;

  for v_name, v_sort in
    select * from (values ('تم تأجيل الموعد', 10), ('في انتظار المعمل', 20)) as t(name_ar, sort_order)
  loop
    select id into v_id from lookup_values where category_id = v_cat and btrim(name_ar) = v_name;
    if v_id is null then
      insert into lookup_values (category_id, name_ar, sort_order) values (v_cat, v_name, v_sort);
      v_added := v_added + 1;
    else
      update lookup_values set is_disabled = false where id = v_id and is_disabled;
      if found then v_enabled := v_enabled + 1; end if;
    end if;
  end loop;

  raise notice 'أُضيفت % قيمة، وفُعِّلت % قيمة كانت معطَّلة.', v_added, v_enabled;
end $$;

commit;

-- ── المعاينة: ما سيراه الموظّف في القائمتين ─────────────────────────────────
select c.key as "اللائحة",
       case when c.organization_id is null then 'عامّة' else 'خاصّة بالمنشأة' end as "النطاق",
       v.name_ar as "القيمة",
       case when v.is_disabled then 'معطَّلة' else 'نشطة' end as "الحالة"
  from lookup_categories c
  join lookup_values v on v.category_id = c.id
 where c.key in ('visit_types', 'appointment_labels')
   and (c.organization_id is null
        or c.organization_id = (select id from organizations
                                 where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
                                 order by created_at limit 1))
 order by c.key, c.organization_id nulls first, v.sort_order, v.name_ar;
