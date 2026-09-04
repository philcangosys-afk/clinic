-- ============================================================================
-- 0138 — حلقة الأشعة المغلقة، وطلبات الطبيب إلى الاستقبال
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   دورة الأشعة اليوم مقطوعة من طرفيها. الطبيب لا يستطيع طلب صورة إلا من
--   داخل شاشة الزيارة، ومختصّ الأشعة لا يملك شاشةً يرى فيها ما طُلب منه،
--   والصورة حين تُرفع لا يعلم بها الطبيب إلا إن فتّش عنها. فالنتيجة أن
--   الورق والهاتف يسدّان الفجوة، ويضيع أثر مَن طلب ومتى ومن نفّذ.
--
--   وثلاثة أعطال قائمة في القاعدة نفسها، كشفها الفحص:
--
--     1) `app_radiology_order_auto_complete` (0014) تكتب `status='completed'`
--        وهي قيمة **حذفها القيد** في 0084 (صارت `images_ready`). فأوّل طلبٍ
--        تكتمل بنوده كلها كان يفشل بخطأ قيدٍ لا علاقة له ظاهريًّا بما فعله
--        المستخدم. المُحفِّز لم يُحدَّث في أيّ هجرة بعدها.
--
--     2) `v_radiology_unreported_orders` (0014) يرشّح على
--        `status in ('ordered','scheduled','in_progress','completed')` —
--        وثلاثٌ من حالات 0084 (`arrived`, `images_ready`, `reporting`) لا
--        يعرفها، و`completed` لم تعد موجودة. فتبويب «الطلبات الحالية» في
--        شاشة الأشعة يُخفي طلباتٍ قائمة فعلًا.
--
--     3) إنشاء طلب الأشعة من الشاشة يجري بـ`insert` مباشر على
--        `radiology_orders` بلا أيّ دالّة وسيطة، فلا فحص صلاحية `rad.*`
--        ولا قيد على الفرع ولا أثر في التدقيق.
--
-- ما يضيفه هذا الملف:
--   • إصلاح الثلاثة أعلاه.
--   • `app_create_radiology_order` — طلب أشعة بصلاحية وأثر تدقيق.
--   • `app_radiology_deliver_images` — «حفظ وإرسال» عند مختصّ الأشعة:
--     تسجّل الصور، وتنقل الحالة، وتُخطر الطبيب الطالب. عملية ذرّية واحدة.
--   • `staff_requests` — طلبات الطبيب إلى الاستقبال (استدعاء المريض،
--     تحصيل مبلغ، ملاحظة). **موعد المتابعة لا جدول له هنا**: يُكتب في
--     `appointment_requests` القائم بـ`source='doctor'` — نفس الغرض ونفس
--     شاشة المراجعة، فلا يُنشأ جدول ثانٍ لغرضٍ له جدول.
--   • عروض: صندوق الطبيب، قائمة عمل الأشعة، صور المريض في ملفه.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.** الإخطار داخليّ عبر
-- `app_notify_event` والقناة `internal` وحدها.
-- ============================================================================

do $zc_pre$
declare
  v_missing text := '';
begin
  if to_regprocedure('public.app_set_radiology_order_status(uuid,text,text)') is null then
    v_missing := v_missing || E'\n  • 0084_radiology_flow_and_resources.sql';
  end if;
  if to_regclass('public.notifications') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql';
  end if;
  if to_regclass('public.appointment_requests') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0138 — هجرات سابقة لم تُنفَّذ:%\n\nنفّذها أولًا بالترتيب الرقمي.', v_missing;
  end if;
end
$zc_pre$;

-- ===========================================================================
-- 1) الصلاحيات الجديدة
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
values
  ('rad.order',          'طلب صورة أشعة',              'radiology', 615),
  ('lab.order',          'طلب تحاليل',                 'laboratory', 615),
  ('reception.requests', 'استقبال طلبات الأطباء',      'reception', 320)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
values
  ('owner','rad.order'), ('organization_admin','rad.order'),
  ('branch_manager','rad.order'), ('doctor','rad.order'), ('nurse','rad.order'),
  ('owner','lab.order'), ('organization_admin','lab.order'),
  ('branch_manager','lab.order'), ('doctor','lab.order'), ('nurse','lab.order'),
  ('owner','reception.requests'), ('organization_admin','reception.requests'),
  ('branch_manager','reception.requests'), ('receptionist','reception.requests')
on conflict do nothing;

-- ===========================================================================
-- 1.2) ميزة شاشة قسم الأشعة
-- ===========================================================================
-- شاشة التنفيذ ميزةٌ مستقلّة عن «الأشعة» (الكتالوج والطلبات): المختصّ يحتاج
-- شاشته ولا يحتاج إدارة الكتالوج، والعكس. فصلُها يجعل تفعيلها لدور واحد
-- ممكنًا بدل فتح الموديول كلّه.
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'radiology_console', 'قسم الأشعة (التنفيذ)', 'Radiology Console', 'الكتالوج الطبي', false, 111
where not exists (select 1 from feature_catalog where feature_key = 'radiology_console');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'radiology_console', true from organizations o
on conflict (organization_id, feature_key) do nothing;

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
values ('radiology_console.view', 'فتح شاشة قسم الأشعة', 'radiology_console', 610)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
values ('owner','radiology_console.view'), ('organization_admin','radiology_console.view'),
       ('branch_manager','radiology_console.view'), ('radiology_technician','radiology_console.view'),
       ('doctor','radiology_console.view')
on conflict do nothing;

-- ===========================================================================
-- 1.5) قواعد التنبيه للأحداث الجديدة
-- ===========================================================================
-- `app_notify_event` تصمت إن لم تجد قاعدة للحدث في `notification_rules`.
-- فالحدث الذي لا قاعدة له لا يصل أحدًا — ولا يظهر خطأ. تُضاف قواعد الأربعة
-- إلى دالّة البذر (للمنشآت الجديدة) وتُبذَر للمنشآت القائمة.
--
-- **القناة `internal` وحدها** — لا قناة خارجية ولا SMS.
create or replace function app_seed_radiology_relay_rules(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into notification_rules (organization_id, event_key, name_ar, category,
                                  severity, target_permission, channel)
  select p_org, v.k, v.n, v.c, v.s, v.p, 'internal'
  from (values
    ('radiology_order_created', 'طلب أشعة جديد',        'clinical',   'info',    'rad.perform'),
    ('radiology_images_ready',  'صور أشعة جاهزة',       'clinical',   'info',    'rad.view'),
    ('staff_request_created',   'طلب من طبيب للاستقبال','operational','info',    'reception.requests'),
    ('followup_requested',      'طلب موعد متابعة',      'operational','info',    'reception.requests'),
    ('lab_order_created',       'طلب تحاليل جديد',      'clinical',   'info',    'lab.collect')
  ) as v(k, n, c, s, p)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- تُستدعى من دالّة البذر العامّة حتى تأخذها كل منشأة جديدة تلقائيًّا.
do $zc_seed_hook$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'app_seed_notification_rules';
  v_src := replace(v_src, chr(13), '');

  if v_src is null then
    raise exception 'app_seed_notification_rules غير موجودة — شغّل 0103 أوّلًا';
  end if;
  if position('app_seed_radiology_relay_rules' in v_src) > 0 then
    return;  -- مربوطة سلفًا
  end if;

  v_new := replace(v_src,
    E'  get diagnostics v_n = row_count;\n  return v_n;',
    E'  get diagnostics v_n = row_count;\n'
    '  v_n := v_n + app_seed_radiology_relay_rules(p_org);\n'
    '  return v_n;');

  if v_new = v_src then
    raise exception 'تعذّر ربط قواعد حلقة الأشعة بدالّة البذر — راجع 0138';
  end if;
  execute v_new;
end
$zc_seed_hook$;

-- المنشآت القائمة تأخذها الآن.
do $zc_backfill$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_radiology_relay_rules(r.id);
  end loop;
end
$zc_backfill$;

-- ===========================================================================
-- 2) إصلاح المُحفِّز الذي يكتب حالة محذوفة
-- ===========================================================================
-- كان يكتب `completed` (ممنوعة منذ 0084) فيُسقط أوّل عملية تُنجز كل البنود.
-- الآن ينقل إلى `images_ready`، وفقط من الحالات التي يجوز الانتقال منها،
-- وإلا ترك الحالة كما هي بدل أن يفشل التعديل كلّه.
create or replace function app_radiology_order_auto_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   uuid;
  v_pending int;
  v_status  text;
begin
  v_order := coalesce(new.radiology_order_id, old.radiology_order_id);

  select count(*) into v_pending
    from radiology_order_items
   where radiology_order_id = v_order and performed_at is null;

  if v_pending > 0 then
    return coalesce(new, old);
  end if;

  select status into v_status from radiology_orders where id = v_order;

  if v_status in ('ordered','scheduled','arrived','in_progress') then
    update radiology_orders
       set status = 'images_ready',
           images_ready_at = coalesce(images_ready_at, now()),
           updated_at = now()
     where id = v_order;
  end if;

  return coalesce(new, old);
end;
$$;

-- ===========================================================================
-- 3) إصلاح العرض الذي يُخفي طلباتٍ قائمة
-- ===========================================================================
drop view if exists v_radiology_unreported_orders;
create view v_radiology_unreported_orders
with (security_invoker = on) as
-- اسم المفتاح `radiology_order_id` لا `id`: هذا عقد العرض منذ 0014 ويقرأه
-- عدّاد الشارة في `use-live-badges.ts`. تغييره هنا كان يُصمت العدّاد.
select o.id as radiology_order_id,
       o.organization_id,
       o.branch_id,
       o.patient_id,
       p.name_ar          as patient_name,
       p.id_number        as patient_id_number,
       o.ordering_doctor_id,
       d.name_ar          as doctor_name,
       o.status,
       o.priority,
       o.clinical_indication,
       o.notes,
       o.ordered_at,
       o.scheduled_at,
       o.arrived_at,
       o.images_ready_at,
       count(oi.id)                                    as item_count,
       count(oi.id) filter (where oi.performed_at is not null) as performed_count,
       count(ri.id)                                    as image_count
  from radiology_orders o
  join patients p on p.id = o.patient_id
  left join doctors d on d.id = o.ordering_doctor_id
  left join radiology_order_items oi on oi.radiology_order_id = o.id
  left join radiology_images ri on ri.radiology_order_item_id = oi.id
 where o.status in ('draft','ordered','scheduled','arrived',
                    'in_progress','images_ready','reporting')
 group by o.id, p.name_ar, p.id_number, d.name_ar;

comment on view v_radiology_unreported_orders is
  'طلبات الأشعة التي لم تُعتمد بعد. أُعيد بناؤه في 0138: كان يرشّح على حالات 0014 القديمة فيُخفي `arrived` و`images_ready` و`reporting`.';

-- ===========================================================================
-- 4) صور الأشعة: منشأة وملاحظة وحجم
-- ===========================================================================
-- `organization_id` ليس تكرارًا للطلب: بدونه كل قراءة لصور مريضٍ في ملفه
-- تمرّ بوصلتين (بند → طلب)، ولا يمكن فهرسة الصور بالمنشأة ولا تطبيق سياسة
-- مباشرة عليها.
alter table radiology_images
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists note            text,
  add column if not exists mime_type       text,
  add column if not exists size_bytes      bigint,
  add column if not exists taken_at        timestamptz;

update radiology_images ri
   set organization_id = o.organization_id
  from radiology_order_items oi
  join radiology_orders o on o.id = oi.radiology_order_id
 where oi.id = ri.radiology_order_item_id
   and ri.organization_id is null;

create index if not exists idx_radiology_images_org
  on radiology_images (organization_id, created_at desc);

comment on column radiology_images.note is
  'ملاحظة مختصّ الأشعة على الصورة — ليست تقريرًا طبيًّا؛ التقرير في radiology_order_items.findings/impression.';

-- ===========================================================================
-- 5) طلب أشعة بصلاحية وأثر
-- ===========================================================================
create or replace function app_create_radiology_order(
  p_organization_id     uuid,
  p_patient_id          uuid,
  p_doctor_id           uuid,
  p_exam_ids            uuid[],
  p_priority            text default 'routine',
  p_clinical_indication text default null,
  p_notes               text default null,
  p_visit_id            uuid default null,
  p_branch_id           uuid default null,
  p_clinic_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_exam  uuid;
  v_n     int;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'rad.order') then
    raise exception 'صلاحيتك لا تسمح بطلب صور الأشعة (rad.order)';
  end if;
  if p_exam_ids is null or array_length(p_exam_ids, 1) is null then
    raise exception 'اختر فحصًا واحدًا على الأقل';
  end if;
  if coalesce(p_priority,'routine') not in ('routine','urgent','stat') then
    raise exception 'أولوية غير صالحة';
  end if;

  -- المريض والطبيب والفحوص كلها من المنشأة نفسها — وإلا كان الطلب عابرًا
  -- للمنشآت وهو ما تمنعه القاعدة أصلًا، لكن الرسالة هنا تشرح السبب.
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if p_doctor_id is not null and not exists (
       select 1 from doctors where id = p_doctor_id
        and organization_id = p_organization_id) then
    raise exception 'الطبيب غير موجود في هذه المنشأة';
  end if;

  select count(*) into v_n from radiology_exams
   where id = any(p_exam_ids) and organization_id = p_organization_id
     and coalesce(is_active, true);
  if v_n <> array_length(p_exam_ids, 1) then
    raise exception 'فحصٌ واحد أو أكثر غير موجود أو غير مفعَّل';
  end if;

  insert into radiology_orders (organization_id, branch_id, patient_id,
                                ordering_doctor_id, visit_id, clinic_id,
                                status, priority, clinical_indication, notes)
  values (p_organization_id, p_branch_id, p_patient_id, p_doctor_id,
          p_visit_id, p_clinic_id, 'ordered', coalesce(p_priority,'routine'),
          nullif(btrim(coalesce(p_clinical_indication,'')), ''),
          nullif(btrim(coalesce(p_notes,'')), ''))
  returning id into v_order;

  foreach v_exam in array p_exam_ids loop
    insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_order, v_exam);
  end loop;

  perform app_notify_event(
    p_organization_id, 'radiology_order_created',
    'طلب أشعة جديد',
    'rad_order:' || v_order::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
      || ' — ' || v_n::text || ' فحص',
    'radiology_order', v_order, '/radiology-console', p_branch_id);

  return v_order;
end;
$$;

revoke all on function app_create_radiology_order(uuid,uuid,uuid,uuid[],text,text,text,uuid,uuid,uuid) from public, anon;
grant execute on function app_create_radiology_order(uuid,uuid,uuid,uuid[],text,text,text,uuid,uuid,uuid) to authenticated;

-- ===========================================================================
-- 5.5) طلب تحاليل — نظير طلب الأشعة
-- ===========================================================================
-- المختبر كان بلا دالّة إنشاء أصلًا (`app_create_lab_order` غير موجودة):
-- الطلب لا يُنشأ إلا من داخل `app_save_visit`. فالطبيب الذي يريد تحليلًا بلا
-- فتح زيارة كاملة لا سبيل له. هذه الدالّة تسدّ ذلك بنفس شروط الأشعة.
create or replace function app_create_lab_order(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_doctor_id       uuid,
  p_test_ids        uuid[],
  p_priority        text default 'routine',
  p_notes           text default null,
  p_visit_id        uuid default null,
  p_branch_id       uuid default null,
  p_clinic_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_test  uuid;
  v_n     int;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'lab.order') then
    raise exception 'صلاحيتك لا تسمح بطلب التحاليل (lab.order)';
  end if;
  if p_test_ids is null or array_length(p_test_ids, 1) is null then
    raise exception 'اختر تحليلًا واحدًا على الأقل';
  end if;
  if coalesce(p_priority,'routine') not in ('routine','urgent','stat') then
    raise exception 'أولوية غير صالحة';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  select count(*) into v_n from lab_tests
   where id = any(p_test_ids) and organization_id = p_organization_id
     and coalesce(is_active, true);
  if v_n <> array_length(p_test_ids, 1) then
    raise exception 'تحليلٌ واحد أو أكثر غير موجود أو غير مفعَّل';
  end if;

  insert into lab_orders (organization_id, branch_id, patient_id,
                          ordering_doctor_id, visit_id, clinic_id,
                          status, priority, notes)
  values (p_organization_id, p_branch_id, p_patient_id, p_doctor_id,
          p_visit_id, p_clinic_id, 'ordered', coalesce(p_priority,'routine'),
          nullif(btrim(coalesce(p_notes,'')), ''))
  returning id into v_order;

  foreach v_test in array p_test_ids loop
    insert into lab_order_items (lab_order_id, lab_test_id, organization_id)
    values (v_order, v_test, p_organization_id);
  end loop;

  perform app_notify_event(
    p_organization_id, 'lab_order_created', 'طلب تحاليل جديد',
    'lab_order:' || v_order::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
      || ' — ' || v_n::text || ' تحليل',
    'lab_order', v_order, '/laboratory', p_branch_id);

  return v_order;
end;
$$;

revoke all on function app_create_lab_order(uuid,uuid,uuid,uuid[],text,text,uuid,uuid,uuid) from public, anon;
grant execute on function app_create_lab_order(uuid,uuid,uuid,uuid[],text,text,uuid,uuid,uuid) to authenticated;

-- ===========================================================================
-- 6) «حفظ وإرسال» عند مختصّ الأشعة — عملية واحدة ذرّية
-- ===========================================================================
-- يرفع المختصّ الملفات إلى التخزين أولًا، ثم يستدعي هذه الدالّة بمساراتها.
-- هنا تُسجَّل الصور، ويُختم البند منفَّذًا، وتنتقل حالة الطلب، ويُخطر الطبيب
-- الطالب — كل ذلك في معاملة واحدة. لو فشل أيّ جزء لم يُسجَّل شيء، فلا يبقى
-- طلبٌ «جاهز» بلا صور ولا صورةٌ لا يعلم بها أحد.
--
-- `p_order_id` اختياري: المريض قد يصل الأشعة بلا طلبٍ مسبق (تحويل ورقيّ أو
-- حالة عاجلة)، فيُنشأ الطلب هنا باسم الطبيب المختار.
create or replace function app_radiology_deliver_images(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_doctor_id       uuid,
  p_exam_id         uuid,
  p_images          jsonb,          -- [{path, name, mime, size}]
  p_order_id        uuid default null,
  p_note            text default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid := p_order_id;
  v_item  uuid;
  v_img   jsonb;
  v_count int := 0;
  v_status text;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'rad.perform') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ فحوص الأشعة (rad.perform)';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array'
     or jsonb_array_length(p_images) = 0 then
    raise exception 'أرفق صورة واحدة على الأقل';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if not exists (select 1 from radiology_exams where id = p_exam_id
                  and organization_id = p_organization_id) then
    raise exception 'الفحص غير موجود في هذه المنشأة';
  end if;

  if v_order is null then
    insert into radiology_orders (organization_id, branch_id, patient_id,
                                  ordering_doctor_id, status, priority,
                                  clinical_indication, performed_by)
    values (p_organization_id, p_branch_id, p_patient_id, p_doctor_id,
            'in_progress', 'routine',
            'رفع مباشر من قسم الأشعة', auth.uid())
    returning id into v_order;
  else
    select status into v_status from radiology_orders
     where id = v_order and organization_id = p_organization_id;
    if v_status is null then
      raise exception 'الطلب غير موجود في هذه المنشأة';
    end if;
    if v_status in ('cancelled','rejected') then
      raise exception 'الطلب ملغى أو مرفوض — لا تُرفع له صور';
    end if;
    -- بدء التنفيذ يُسجَّل صراحةً: الطلب الذي رُفعت له صورة لم يعد «مطلوبًا»
    -- بل «قيد التنفيذ»، وإلّا بقي في قائمة انتظار الأشعة وقد بدأ العمل فيه.
    update radiology_orders
       set status       = case when status in ('ordered','scheduled','arrived')
                               then 'in_progress' else status end,
           performed_by = coalesce(performed_by, auth.uid()),
           started_at   = coalesce(started_at, now()),
           updated_at   = now()
     where id = v_order;
  end if;

  -- بندٌ للفحص المختار: يُعاد استعماله إن كان الطلب يحمله سلفًا، ولا يُكرَّر.
  select id into v_item from radiology_order_items
   where radiology_order_id = v_order and radiology_exam_id = p_exam_id
   limit 1;
  if v_item is null then
    insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_order, p_exam_id) returning id into v_item;
  end if;

  for v_img in select * from jsonb_array_elements(p_images) loop
    if coalesce(btrim(v_img->>'path'), '') = '' then
      raise exception 'مسار صورة فارغ';
    end if;
    insert into radiology_images (radiology_order_item_id, organization_id,
                                  file_url, file_name, mime_type, size_bytes,
                                  note, taken_at, uploaded_by)
    values (v_item, p_organization_id,
            v_img->>'path',
            coalesce(v_img->>'name', 'image'),
            v_img->>'mime',
            nullif(v_img->>'size','')::bigint,
            nullif(btrim(coalesce(p_note,'')), ''),
            now(), auth.uid());
    v_count := v_count + 1;
  end loop;

  -- ختم البند منفَّذًا يُطلق `app_radiology_order_auto_complete` المصلَحة،
  -- فتنتقل حالة الطلب إلى `images_ready` متى أُنجزت بنوده كلها.
  update radiology_order_items
     set performed_at = coalesce(performed_at, now()),
         performed_by = coalesce(performed_by, auth.uid())
   where id = v_item;

  perform app_notify_event(
    p_organization_id, 'radiology_images_ready',
    'صور أشعة جاهزة',
    'rad_images:' || v_item::text || ':' || v_count::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
      || ' — ' || v_count::text || ' صورة'
      || case when coalesce(btrim(coalesce(p_note,'')),'') <> ''
              then ' — ' || left(p_note, 120) else '' end,
    'radiology_order', v_order, '/doctor-workspace', p_branch_id);

  return v_order;
end;
$$;

revoke all on function app_radiology_deliver_images(uuid,uuid,uuid,uuid,jsonb,uuid,text,uuid) from public, anon;
grant execute on function app_radiology_deliver_images(uuid,uuid,uuid,uuid,jsonb,uuid,text,uuid) to authenticated;

-- ===========================================================================
-- 7) طلبات الطبيب إلى الاستقبال
-- ===========================================================================
-- ثلاثة أنواع لا جدول لها في النظام: استدعاء المريض، تحصيل مبلغ، ملاحظة.
-- أمّا **موعد المتابعة** فله جدوله (`appointment_requests`, 0104) وشاشته،
-- فلا يُنشأ له هنا نظير — تُستعمل الدالّة أدناه بـ`source='doctor'`.
create table if not exists staff_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  request_type     text not null
                     check (request_type in ('call_patient','collect_payment','note')),
  target_role      text not null default 'receptionist',
  patient_id       uuid references patients(id),
  doctor_id        uuid references doctors(id),
  visit_id         uuid references patient_visits(id),
  body             text,
  amount           numeric,
  priority         text not null default 'routine'
                     check (priority in ('routine','urgent')),
  status           text not null default 'pending'
                     check (status in ('pending','done','cancelled')),
  requested_by     uuid references auth.users(id),
  requested_at     timestamptz not null default now(),
  resolved_by      uuid references auth.users(id),
  resolved_at      timestamptz,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table staff_requests is
  'طلبات الطبيب إلى الاستقبال: استدعاء مريض، تحصيل مبلغ، ملاحظة. موعد المتابعة ليس منها — له appointment_requests بـ source=doctor.';

create index if not exists idx_staff_requests_open
  on staff_requests (organization_id, status, requested_at desc);
create index if not exists idx_staff_requests_patient
  on staff_requests (patient_id, requested_at desc);

alter table staff_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'staff_requests'
                    and policyname = 'staff_requests_members') then
    create policy staff_requests_members on staff_requests
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
end $$;

create or replace function app_create_staff_request(
  p_organization_id uuid,
  p_request_type    text,
  p_patient_id      uuid default null,
  p_doctor_id       uuid default null,
  p_body            text default null,
  p_amount          numeric default null,
  p_priority        text default 'routine',
  p_visit_id        uuid default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_title text;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if p_request_type not in ('call_patient','collect_payment','note') then
    raise exception 'نوع الطلب غير صالح';
  end if;
  if p_request_type = 'collect_payment'
     and (p_amount is null or p_amount <= 0) then
    raise exception 'حدّد مبلغًا موجبًا للتحصيل';
  end if;
  if p_request_type = 'note'
     and coalesce(btrim(coalesce(p_body,'')), '') = '' then
    raise exception 'اكتب نصّ الملاحظة';
  end if;
  if p_patient_id is not null and not exists (
       select 1 from patients where id = p_patient_id
        and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  insert into staff_requests (organization_id, branch_id, request_type,
                              patient_id, doctor_id, visit_id, body, amount,
                              priority, requested_by)
  values (p_organization_id, p_branch_id, p_request_type, p_patient_id,
          p_doctor_id, p_visit_id, nullif(btrim(coalesce(p_body,'')), ''),
          p_amount, coalesce(p_priority,'routine'), auth.uid())
  returning id into v_id;

  v_title := case p_request_type
               when 'call_patient'    then 'استدعاء مريض'
               when 'collect_payment' then 'طلب تحصيل'
               else 'ملاحظة إلى الاستقبال' end;

  perform app_notify_event(
    p_organization_id, 'staff_request_created', v_title,
    'staff_req:' || v_id::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'بلا مريض')
      || coalesce(' — ' || left(p_body, 120), '')
      || coalesce(' — ' || p_amount::text, ''),
    'staff_request', v_id, '/reception', p_branch_id);

  return v_id;
end;
$$;

create or replace function app_resolve_staff_request(
  p_request_id uuid,
  p_status     text default 'done',
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_cur text;
begin
  select organization_id, status into v_org, v_cur
    from staff_requests where id = p_request_id;
  if v_org is null then
    raise exception 'الطلب غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(v_org, 'reception.requests') then
    raise exception 'صلاحيتك لا تسمح بإنهاء طلبات الأطباء (reception.requests)';
  end if;
  if p_status not in ('done','cancelled') then
    raise exception 'حالة غير صالحة';
  end if;
  if v_cur <> 'pending' then
    raise exception 'الطلب مُغلق سلفًا (%)', v_cur;
  end if;

  update staff_requests
     set status = p_status,
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution_note = nullif(btrim(coalesce(p_note,'')), ''),
         updated_at = now()
   where id = p_request_id;
end;
$$;

-- موعد المتابعة: يُكتب في جدول الطلبات القائم لا في جدول جديد.
create or replace function app_doctor_request_followup(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_doctor_id       uuid,
  p_preferred_date  date,
  p_reason          text default null,
  p_preferred_period text default 'any',
  p_clinic_id       uuid default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if p_preferred_date is null or p_preferred_date < current_date then
    raise exception 'تاريخ المتابعة يجب أن يكون اليوم أو بعده';
  end if;
  if coalesce(p_preferred_period,'any') not in ('morning','evening','any') then
    raise exception 'فترة غير صالحة';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  insert into appointment_requests (organization_id, branch_id, patient_id,
                                    clinic_id, doctor_id, preferred_date,
                                    preferred_period, reason, status, source)
  values (p_organization_id, p_branch_id, p_patient_id, p_clinic_id,
          p_doctor_id, p_preferred_date, coalesce(p_preferred_period,'any'),
          nullif(btrim(coalesce(p_reason,'')), ''), 'pending', 'doctor')
  returning id into v_id;

  perform app_notify_event(
    p_organization_id, 'followup_requested', 'طلب موعد متابعة',
    'followup:' || v_id::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
      || ' — ' || p_preferred_date::text,
    'appointment_request', v_id, '/reception', p_branch_id);

  return v_id;
end;
$$;

do $$
declare v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('app_create_staff_request','app_resolve_staff_request',
                         'app_doctor_request_followup')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- ===========================================================================
-- 8) العروض
-- ===========================================================================

-- قائمة عمل مختصّ الأشعة: ما طُلب منه ولم يُرفع له صور بعد.
drop view if exists v_radiology_console_queue;
create view v_radiology_console_queue
with (security_invoker = on) as
select o.id                as order_id,
       o.organization_id,
       o.branch_id,
       o.status,
       o.priority,
       o.clinical_indication,
       o.notes,
       o.ordered_at,
       o.patient_id,
       p.name_ar           as patient_name,
       p.id_number         as patient_id_number,
       p.phone_1           as patient_phone,
       o.ordering_doctor_id,
       d.name_ar           as doctor_name,
       string_agg(distinct e.name_ar, ' • ')            as exam_names,
       string_agg(distinct e.modality, ', ')            as modalities,
       count(distinct oi.id)                            as item_count,
       count(distinct ri.id)                            as image_count
  from radiology_orders o
  join patients p on p.id = o.patient_id
  left join doctors d on d.id = o.ordering_doctor_id
  left join radiology_order_items oi on oi.radiology_order_id = o.id
  left join radiology_exams e on e.id = oi.radiology_exam_id
  left join radiology_images ri on ri.radiology_order_item_id = oi.id
 where o.status in ('ordered','scheduled','arrived','in_progress')
 group by o.id, p.name_ar, p.id_number, p.phone_1, d.name_ar;

comment on view v_radiology_console_queue is
  'ما ينتظر مختصّ الأشعة: طلبات لم تُرفع صورها بعد.';

-- صندوق الطبيب: صور وصلته، وطلباته المعلّقة.
drop view if exists v_doctor_inbox;
create view v_doctor_inbox
with (security_invoker = on) as
select o.id                       as order_id,
       o.organization_id,
       o.branch_id,
       o.ordering_doctor_id       as doctor_id,
       o.patient_id,
       p.name_ar                  as patient_name,
       p.id_number                as patient_id_number,
       o.status,
       o.priority,
       o.images_ready_at,
       max(ri.created_at)         as last_image_at,
       count(ri.id)               as image_count,
       string_agg(distinct e.name_ar, ' • ') as exam_names,
       max(ri.note)               as tech_note
  from radiology_orders o
  join patients p on p.id = o.patient_id
  join radiology_order_items oi on oi.radiology_order_id = o.id
  join radiology_images ri on ri.radiology_order_item_id = oi.id
  left join radiology_exams e on e.id = oi.radiology_exam_id
 where o.status in ('images_ready','reporting','verified','delivered')
 group by o.id, p.name_ar, p.id_number;

comment on view v_doctor_inbox is
  'ما وصل الطبيب من قسم الأشعة: الطلبات التي رُفعت لها صور فعلًا.';

-- صور المريض في ملفه — مصدرٌ واحد، لا نسخة ثانية في patient_documents.
drop view if exists v_patient_radiology_images;
create view v_patient_radiology_images
with (security_invoker = on) as
select ri.id,
       ri.organization_id,
       o.patient_id,
       o.id            as order_id,
       oi.id           as order_item_id,
       e.name_ar       as exam_name,
       e.modality,
       ri.file_url,
       ri.file_name,
       ri.mime_type,
       ri.size_bytes,
       ri.note,
       ri.taken_at,
       ri.created_at,
       ri.uploaded_by,
       o.ordering_doctor_id,
       d.name_ar       as doctor_name
  from radiology_images ri
  join radiology_order_items oi on oi.id = ri.radiology_order_item_id
  join radiology_orders o on o.id = oi.radiology_order_id
  left join radiology_exams e on e.id = oi.radiology_exam_id
  left join doctors d on d.id = o.ordering_doctor_id;

comment on view v_patient_radiology_images is
  'صور الأشعة كما تظهر في ملف المريض. المصدر radiology_images وحده — لا يُنسخ الملف إلى patient_documents.';

-- طلبات الأطباء عند الاستقبال: النوعان معًا في مكانٍ واحد للعرض.
drop view if exists v_reception_requests;
create view v_reception_requests
with (security_invoker = on) as
select sr.id,
       sr.organization_id,
       sr.branch_id,
       sr.request_type,
       sr.status,
       sr.priority,
       sr.patient_id,
       p.name_ar        as patient_name,
       p.phone_1        as patient_phone,
       sr.doctor_id,
       d.name_ar        as doctor_name,
       sr.body,
       sr.amount,
       null::date       as preferred_date,
       sr.requested_at,
       sr.resolved_at
  from staff_requests sr
  left join patients p on p.id = sr.patient_id
  left join doctors  d on d.id = sr.doctor_id
union all
select ar.id,
       ar.organization_id,
       ar.branch_id,
       'follow_up'      as request_type,
       ar.status,
       'routine'        as priority,
       ar.patient_id,
       p.name_ar,
       p.phone_1,
       ar.doctor_id,
       d.name_ar,
       ar.reason        as body,
       null::numeric    as amount,
       ar.preferred_date,
       ar.created_at    as requested_at,
       ar.decided_at    as resolved_at
  from appointment_requests ar
  left join patients p on p.id = ar.patient_id
  left join doctors  d on d.id = ar.doctor_id
 where ar.source = 'doctor';

comment on view v_reception_requests is
  'كل ما يصل الاستقبال من الأطباء: طلبات staff_requests وطلبات المتابعة من appointment_requests (source=doctor).';

-- ===========================================================================
-- 9) تحقّق فوريّ
-- ===========================================================================
-- لا يكفي أن تُنشأ الكائنات: يجب أن يكون المُحفِّز قد صار يكتب حالةً مسموحة،
-- وأن يكون العرض قد صار يعرف الحالات الجديدة، وإلّا بقي العطل قائمًا بصمت.
do $zc_verify$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.app_radiology_order_auto_complete()'::regprocedure);
  if v_def like '%''completed''%' then
    raise exception 'المُحفِّز ما زال يكتب حالة completed المحذوفة';
  end if;
  if v_def not like '%images_ready%' then
    raise exception 'المُحفِّز لا يكتب images_ready';
  end if;

  if pg_get_viewdef('public.v_radiology_unreported_orders'::regclass, true)
       not like '%images_ready%' then
    raise exception 'العرض ما زال يجهل الحالات الجديدة';
  end if;

  if to_regprocedure('public.app_create_radiology_order(uuid,uuid,uuid,uuid[],text,text,text,uuid,uuid,uuid)') is null
     or to_regprocedure('public.app_radiology_deliver_images(uuid,uuid,uuid,uuid,jsonb,uuid,text,uuid)') is null
     or to_regprocedure('public.app_create_staff_request(uuid,text,uuid,uuid,text,numeric,text,uuid,uuid)') is null
     or to_regprocedure('public.app_doctor_request_followup(uuid,uuid,uuid,date,text,text,uuid,uuid)') is null then
    raise exception 'دالّة واحدة أو أكثر لم تُنشأ بالتوقيع المتوقَّع';
  end if;

  if not exists (select 1 from permission_catalog where permission_key = 'rad.order')
     or not exists (select 1 from permission_catalog where permission_key = 'lab.order') then
    raise exception 'صلاحية rad.order أو lab.order لم تُسجَّل';
  end if;
  if to_regprocedure('public.app_create_lab_order(uuid,uuid,uuid,uuid[],text,text,uuid,uuid,uuid)') is null then
    raise exception 'app_create_lab_order لم تُنشأ بالتوقيع المتوقَّع';
  end if;
  -- ميزةٌ في القائمة بلا تسجيل = رابط لا يفتح لأحد.
  if not exists (select 1 from feature_catalog where feature_key = 'radiology_console')
     or exists (select 1 from organizations o
                 where not exists (select 1 from organization_features f
                                    where f.organization_id = o.id
                                      and f.feature_key = 'radiology_console')) then
    raise exception 'ميزة radiology_console غير مسجَّلة أو غير مفعَّلة لمنشأة';
  end if;

  -- الحدث بلا قاعدة تنبيه لا يصل أحدًا ولا يُظهر خطأ — أسوأ أنواع الصمت.
  if exists (select 1 from organizations o
              where not exists (select 1 from notification_rules r
                                 where r.organization_id = o.id
                                   and r.event_key = 'radiology_images_ready')) then
    raise exception 'منشأة واحدة أو أكثر بلا قاعدة تنبيه لصور الأشعة';
  end if;
  if pg_get_functiondef('public.app_seed_notification_rules(uuid)'::regprocedure)
       not like '%app_seed_radiology_relay_rules%' then
    raise exception 'قواعد حلقة الأشعة غير مربوطة ببذر المنشآت الجديدة';
  end if;
end
$zc_verify$;
