-- ============================================================================
-- 0204 — ما يراه الطبيب: شاشاتٌ لكلٍّ منها صلاحيتها، وتعديل الطبيب بياناته
--        وجدول عمله
-- ============================================================================
--
-- ما رآه المالك بحساب الطبيب بعد ضبط صلاحياته:
--   * «تصميم شاشات العيادات» و«قوائم الأسعار» و«الموارد» ظاهرة، ولا خيار في
--     شاشة الصلاحيات لإخفائها: الأولى تُفتح بـ`medical_records.view` (التي
--     يحتاجها الطبيب لسجلّاته)، والأخريان بـ`medical_services.view` (التي
--     يحتاجها لرؤية الخدمات). فإخفاؤها كان يعني إخفاء ما يعمل به.
--   * «قسم الأشعة (التنفيذ)» ظاهر: افتراض الطبيب منذ 0138 يشمل
--     `radiology_console.view`، ومنذ 0084 كتابة تقارير الأشعة واعتمادها.
--     والمطلوب للطبيب: طلب الأشعة ورؤية صورها فقط.
--   * «الأطباء» للاطّلاع فقط، والمطلوب أن يعدّل الطبيب أوقات عمله وبياناته
--     الشخصية — وأن يكون ذلك خيارًا يُمنح ويُسحب.
--
-- ما يضيفه:
--   ١) ثلاث صلاحيات في الكتالوج (تظهر في شاشة الصفات):
--        price_lists.view   — عرض قوائم الأسعار
--        resources.view     — عرض الموارد
--        doctors.self_edit  — تعديل الطبيب بياناته الشخصية وجدول عمله
--      وشاشة «تصميم شاشات العيادات» تُفتح بـ`exam_templates.manage` (إدارة
--      نماذج الفحص) لا بعرض السجلّ الطبي — في الواجهة.
--   ٢) الافتراضات تبقى كما هي لكلّ صفة إلّا الطبيب: من كان يرى الخدمات يرى
--      قوائم الأسعار والموارد كما كان، في الافتراض العامّ وفي صفات المنشأة
--      المعدّلة والمخصّصة وفي الاستثناءات الفردية.
--   ٣) الطبيب (الافتراض، وكلّ صفةٍ للمنشأة أساسها «طبيب»): يُمنح
--      `doctors.self_edit`، ويُنزع عنه: قسم الأشعة (التنفيذ)، وكتابة تقارير
--      الأشعة واعتمادها، وإدارة نماذج الفحص. ويبقى له طلب الأشعة ورؤيتها،
--      واستعمال نماذج الفحص.
--   ٤) سياستان تسمحان للطبيب المربوط بحسابه — ومعه `doctors.self_edit` —
--      بكتابة جدول عمله وإجازاته واستثناءاته **وحدها**.
--   ٥) `app_update_my_doctor_profile` — يعدّل الطبيب بياناته الشخصية وحدها
--      (لا العيادة ولا الحالة ولا الحجز ولا الترخيص)، بسطر تدقيق.
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- ١) الكتالوج
-- ---------------------------------------------------------------------------
-- شاشتا قوائم الأسعار والموارد في نطاق «فتح الشاشات» مع أخواتها (0143)
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values
  ('price_lists.view',  'فتح شاشة: قوائم الأسعار', 'screens',
   'رؤية شاشة «قوائم الأسعار» في القائمة وفتحها. تعديل الأسعار صلاحيةٌ أخرى.', 9072),
  ('resources.view',    'فتح شاشة: الموارد',       'screens',
   'رؤية شاشة «الموارد» (الغرف والأجهزة) في القائمة وفتحها. تعديلها صلاحيةٌ أخرى.', 9074),
  ('doctors.self_edit', 'تعديل الطبيب بياناته الشخصية وجدول عمله', 'doctors',
   'للطبيب المربوط بحسابه: بياناته الشخصية، وجدول عمله، وإجازاته واستثناءاته — له وحده لا لغيره.', 835)
on conflict (permission_key) do nothing;

-- «إدارة نماذج الفحص» هي ما يفتح شاشة تصميم شاشات العيادات — يُقال ذلك في اسمها
update permission_catalog
   set name_ar = 'إدارة نماذج الفحص (شاشة «تصميم شاشات العيادات»)'
 where permission_key = 'exam_templates.manage';

-- ---------------------------------------------------------------------------
-- ٢) من كان يرى الخدمات يرى قوائم الأسعار والموارد — إلّا الطبيب
-- ---------------------------------------------------------------------------
insert into role_default_permissions (role_key, permission_key)
select d.role_key, k.key
  from role_default_permissions d
 cross join (values ('price_lists.view'), ('resources.view')) as k(key)
 where d.permission_key = 'medical_services.view'
   and d.role_key <> 'doctor'
   and not exists (select 1 from role_default_permissions x
                    where x.role_key = d.role_key and x.permission_key = k.key);

insert into organization_role_permissions (organization_id, role_id, permission_key)
select rp.organization_id, rp.role_id, k.key
  from organization_role_permissions rp
  join organization_roles r on r.id = rp.role_id
 cross join (values ('price_lists.view'), ('resources.view')) as k(key)
 where rp.permission_key = 'medical_services.view'
   and r.base_role_key <> 'doctor'
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = rp.role_id and x.permission_key = k.key);

insert into membership_permissions (organization_id, user_id, permission_key, granted)
select mp.organization_id, mp.user_id, k.key, mp.granted
  from membership_permissions mp
  join organization_memberships m
    on m.organization_id = mp.organization_id and m.user_id = mp.user_id
 cross join (values ('price_lists.view'), ('resources.view')) as k(key)
 where mp.permission_key = 'medical_services.view'
   and m.role_key <> 'doctor'
   and not exists (select 1 from membership_permissions x
                    where x.organization_id = mp.organization_id
                      and x.user_id = mp.user_id
                      and x.permission_key = k.key);

-- ---------------------------------------------------------------------------
-- ٣) الطبيب: يعدّل بياناته وجدوله، ولا ينفّذ الأشعة ولا يصمّم النماذج
-- ---------------------------------------------------------------------------
insert into role_default_permissions (role_key, permission_key)
select 'doctor', 'doctors.self_edit'
 where not exists (select 1 from role_default_permissions
                    where role_key = 'doctor' and permission_key = 'doctors.self_edit');

delete from role_default_permissions
 where role_key = 'doctor'
   and permission_key in ('radiology_console.view', 'rad.report', 'rad.verify', 'exam_templates.manage');

-- صفات المنشأة التي أساسها «طبيب» (المعدّلة من شاشة الصفات والمخصّصة)
insert into organization_role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'doctors.self_edit'
  from organization_roles r
 where r.base_role_key = 'doctor'
   and not r.is_archived
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = r.id and x.permission_key = 'doctors.self_edit');

delete from organization_role_permissions rp
 using organization_roles r
 where r.id = rp.role_id
   and r.base_role_key = 'doctor'
   and rp.permission_key in ('radiology_console.view', 'rad.report', 'rad.verify', 'exam_templates.manage');

-- ---------------------------------------------------------------------------
-- ٤) جدول عمل الطبيب وإجازاته: يكتبها هو إن مُنح `doctors.self_edit`
-- ---------------------------------------------------------------------------
-- سياستان **إضافيّتان** (سياسات RLS تُجمع بـ«أو»): سياسة الإدارة
-- (`doctors.manage`) باقية كما هي، وهذه لا تفتح إلّا صفوف الطبيب المربوط
-- بالحساب الداخل نفسه.
drop policy if exists doctor_schedules_self_write on doctor_schedules;
create policy doctor_schedules_self_write on doctor_schedules for all to authenticated
  using (exists (select 1 from doctors d
                  where d.id = doctor_schedules.doctor_id
                    and d.organization_id = doctor_schedules.organization_id
                    and d.user_id = (select auth.uid())
                    and app_has_permission(d.organization_id, 'doctors.self_edit')))
  with check (exists (select 1 from doctors d
                       where d.id = doctor_schedules.doctor_id
                         and d.organization_id = doctor_schedules.organization_id
                         and d.user_id = (select auth.uid())
                         and app_has_permission(d.organization_id, 'doctors.self_edit')));

drop policy if exists dwh_self_write on doctor_working_hours;
create policy dwh_self_write on doctor_working_hours for all to authenticated
  using (exists (select 1 from doctors d
                  where d.id = doctor_working_hours.doctor_id
                    and d.user_id = (select auth.uid())
                    and app_has_permission(d.organization_id, 'doctors.self_edit')))
  with check (exists (select 1 from doctors d
                       where d.id = doctor_working_hours.doctor_id
                         and d.user_id = (select auth.uid())
                         and app_has_permission(d.organization_id, 'doctors.self_edit')));

-- ---------------------------------------------------------------------------
-- ٥) البيانات الشخصية للطبيب — يعدّلها هو
-- ---------------------------------------------------------------------------
/**
 * يعدّل الطبيب **بياناته الشخصية وحدها**: الاسم الإنجليزيّ، والجوال، والبريد،
 * والعنوان، وتاريخ الميلاد، والجنس، والجنسية.
 *
 * لا يمرّ هنا ما يملكه المدير: الاسم العربيّ (يُطبع على الفواتير والتقارير)،
 * والعيادة، والحالة، والحجب عن الحجز، والترخيص، ومدّة الموعد. والمفتاح
 * الغائب عن الطلب لا يُمسّ؛ والفارغ يُفرغ الحقل.
 */
create or replace function app_update_my_doctor_profile(
  p_organization_id uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor doctors%rowtype;
  v_text   text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  select * into v_doctor
    from doctors
   where organization_id = p_organization_id
     and user_id = auth.uid()
   for update;
  if v_doctor.id is null then
    raise exception 'حسابك غير مربوط بسجلّ طبيب في هذه المنشأة — يربطه المدير من «الأطباء» ← حساب الدخول';
  end if;
  if not app_has_permission(p_organization_id, 'doctors.self_edit') then
    raise exception 'صلاحيتك لا تسمح بتعديل بياناتك (doctors.self_edit)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'لا بيانات للحفظ';
  end if;

  v_text := nullif(btrim(p_payload ->> 'email'), '');
  if p_payload ? 'email' and v_text is not null and v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'البريد الإلكترونيّ غير صالح';
  end if;
  v_text := nullif(regexp_replace(coalesce(p_payload ->> 'mobile_number', ''), '\s', '', 'g'), '');
  if p_payload ? 'mobile_number' and v_text is not null and v_text !~ '^\+?[0-9]{8,15}$' then
    raise exception 'رقم الجوال غير صالح';
  end if;

  update doctors set
    name_en       = case when p_payload ? 'name_en'
                         then nullif(btrim(p_payload ->> 'name_en'), '') else name_en end,
    mobile_number = case when p_payload ? 'mobile_number'
                         then nullif(regexp_replace(coalesce(p_payload ->> 'mobile_number', ''), '\s', '', 'g'), '')
                         else mobile_number end,
    email         = case when p_payload ? 'email'
                         then nullif(btrim(p_payload ->> 'email'), '') else email end,
    address       = case when p_payload ? 'address'
                         then nullif(btrim(p_payload ->> 'address'), '') else address end,
    birth_date    = case when p_payload ? 'birth_date'
                         then nullif(p_payload ->> 'birth_date', '')::date else birth_date end,
    gender        = case when p_payload ? 'gender'
                         then nullif(btrim(p_payload ->> 'gender'), '') else gender end,
    nationality_value_id = case when p_payload ? 'nationality_value_id'
                         then nullif(p_payload ->> 'nationality_value_id', '')::uuid
                         else nationality_value_id end,
    updated_by    = auth.uid(),
    updated_at    = now()
  where id = v_doctor.id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'doctors', 'update', v_doctor.id,
          'بيانات الطبيب الشخصية', format('عدّل د. %s بياناته الشخصية', v_doctor.name_ar));

  return v_doctor.id;
end;
$$;

revoke all on function app_update_my_doctor_profile(uuid, jsonb) from public, anon;
grant execute on function app_update_my_doctor_profile(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
