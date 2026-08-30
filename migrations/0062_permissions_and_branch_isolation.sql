-- ---------------------------------------------------------------------------
-- 0062_permissions_and_branch_isolation.sql — الصلاحيات وعزل الفروع
-- ---------------------------------------------------------------------------
-- الحالة قبل هذا الملف:
--
--   • `membership_permissions` موجود منذ 0001 — جدول صلاحيات صريحة لكل
--     مستخدم — **ولا شيء يقرؤه**. لا دالة تفحصه، ولا سياسة تستشيره، ولا
--     شاشة تكتب فيه. صلاحيات على الورق.
--
--   • الحماية كلها بـ`app_has_role`: صفة المستخدم فقط. فإمّا يملك
--     «المستقبِل» كل ما لكل مستقبِل، أو لا شيء. لا استثناء لمستخدم بعينه،
--     ولا منع إجراء واحد عنه.
--
--   • `organization_memberships.branch_id` موجود ولا يُستعمل في أي سياسة.
--     مستخدم فرعٍ يرى مواعيد الفروع كلها.
--
-- هذا الملف يبني الطبقة الناقصة: كتالوج صلاحيات، افتراضات لكل صفة، دالة فحص
-- واحدة تُستشار من القاعدة لا من الواجهة، وعزل فرعي حقيقي.
--
-- **مبدأ التوافق:** لا يفقد أحد صلاحية يملكها اليوم. عضوية بلا `branch_id`
-- تعني «كل الفروع» — وهي حال كل الأعضاء الآن — فالعزل الفرعي لا يُخفي شيئًا
-- إلا بعد أن يُسند مديرٌ فرعًا لمستخدم صراحةً.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) كتالوج الصلاحيات
--
-- جدول لا ثابت في الشيفرة: الواجهة تعرض ما فيه، فإضافة صلاحية جديدة لا
-- تحتاج نشر واجهة. و`module_key` يجمعها في الشاشة بلا ترتيب يدوي.
-- ---------------------------------------------------------------------------
create table if not exists permission_catalog (
  permission_key text primary key,
  name_ar        text not null,
  module_key     text not null,
  description_ar text,
  display_order  integer not null default 0
);

insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order) values
  ('appointments.view',       'عرض المواعيد',            'appointments', 'رؤية جدول المواعيد وتفاصيلها',                    10),
  ('appointments.create',     'إنشاء موعد',              'appointments', 'حجز موعد جديد',                                   20),
  ('appointments.update',     'تعديل موعد',              'appointments', 'تغيير بيانات موعد قائم',                          30),
  ('appointments.cancel',     'إلغاء موعد',              'appointments', 'إلغاء الموعد مع تسجيل السبب',                     40),
  ('appointments.reschedule', 'إعادة جدولة موعد',        'appointments', 'نقل الموعد إلى وقت أو طبيب آخر',                  50),
  ('reception.check_in',      'تسجيل الوصول',            'reception',    'تسجيل وصول المريض ودخوله الطابور',                60),
  ('reception.call',          'نداء المريض',             'reception',    'نداء المريض وإعادة النداء وإلغاؤه',               70),
  ('reception.start_visit',   'بدء الزيارة',             'reception',    'فتح زيارة طبية للموعد',                           80),
  ('reception.finish',        'إنهاء الزيارة',           'reception',    'إغلاق الزيارة وإنهاء الموعد',                     90),
  ('reception.transfer',      'نقل بين طبيب أو عيادة',   'reception',    'تحويل المريض إلى طبيب آخر أو عيادة أخرى',        100),
  ('reception.override',      'التراجع عن انتقال',       'reception',    'إرجاع حالة موعد إلى ما قبلها بعد خطأ',           110),
  ('patients.view',           'عرض المرضى',              'patients',     'رؤية ملفات المرضى',                              120),
  ('patients.create',         'إنشاء مريض',              'patients',     'فتح ملف مريض جديد',                              130),
  ('patients.update',         'تعديل مريض',              'patients',     'تعديل بيانات ملف قائم',                          140),
  ('patients.merge',          'دمج ملفات المرضى',        'patients',     'دمج ملفين مكرَّرين لمريض واحد',                  150),
  ('blocked_contacts.manage', 'إدارة الجهات المحجوبة',   'security',     'إضافة الحظر ورفعه',                              160),
  ('messages.resend',         'إعادة إرسال الرسائل',     'messaging',    'إعادة إرسال تذكير أو تأكيد',                     170),
  ('reports.reception',       'تقارير الاستقبال',        'reports',      'تقارير المواعيد والانتظار والإشغال',             180)
on conflict (permission_key) do update
  set name_ar = excluded.name_ar,
      module_key = excluded.module_key,
      description_ar = excluded.description_ar,
      display_order = excluded.display_order;

-- ---------------------------------------------------------------------------
-- 2) الافتراضات لكل صفة
--
-- المالك ومدير المنشأة **لا يُدرجان هنا عمدًا**: الدالة تمنحهما كل شيء.
-- إدراجهما كان سيعني أن إضافة صلاحية جديدة لاحقًا تُنسى عنهما فيفقد المالك
-- التحكم في ميزة أنشأها بنفسه.
-- ---------------------------------------------------------------------------
create table if not exists role_default_permissions (
  role_key       text not null,
  permission_key text not null references permission_catalog(permission_key) on delete cascade,
  primary key (role_key, permission_key)
);

delete from role_default_permissions;
insert into role_default_permissions (role_key, permission_key) values
  -- المستقبِل: يحجز ويستقبل وينادي ويفتح الملفات. لا يدمج، ولا يتراجع عن
  -- انتقال، ولا يدير الحظر — هذه ثلاثة قرارات لا رجعة فيها بسهولة.
  ('receptionist','appointments.view'),
  ('receptionist','appointments.create'),
  ('receptionist','appointments.update'),
  ('receptionist','appointments.cancel'),
  ('receptionist','appointments.reschedule'),
  ('receptionist','reception.check_in'),
  ('receptionist','reception.call'),
  ('receptionist','reception.start_visit'),
  ('receptionist','patients.view'),
  ('receptionist','patients.create'),
  ('receptionist','patients.update'),
  ('receptionist','messages.resend'),
  ('receptionist','reports.reception'),

  -- الطبيب: يرى مواعيده، ويبدأ الزيارة ويغلقها. لا يعيد الجدولة — ذلك عمل
  -- الاستقبال ويؤثّر على طابور غيره.
  ('doctor','appointments.view'),
  ('doctor','reception.start_visit'),
  ('doctor','reception.finish'),
  ('doctor','patients.view'),

  -- الممرّض: يستقبل وينادي، ولا يفتح زيارة ولا يغلقها.
  ('nurse','appointments.view'),
  ('nurse','reception.check_in'),
  ('nurse','reception.call'),
  ('nurse','patients.view'),

  -- مدير الفرع: كل ما سبق، والنقل والتراجع. الدمج وإدارة الحظر تبقيان
  -- لمدير المنشأة: الأول يمسّ تاريخًا طبيًا، والثاني يمنع مريضًا من الخدمة.
  ('branch_manager','appointments.view'),
  ('branch_manager','appointments.create'),
  ('branch_manager','appointments.update'),
  ('branch_manager','appointments.cancel'),
  ('branch_manager','appointments.reschedule'),
  ('branch_manager','reception.check_in'),
  ('branch_manager','reception.call'),
  ('branch_manager','reception.start_visit'),
  ('branch_manager','reception.finish'),
  ('branch_manager','reception.transfer'),
  ('branch_manager','reception.override'),
  ('branch_manager','patients.view'),
  ('branch_manager','patients.create'),
  ('branch_manager','patients.update'),
  ('branch_manager','messages.resend'),
  ('branch_manager','reports.reception'),

  -- المحاسب وفنّيو المختبر والأشعة والصيدلي: قراءة فقط لما يلزم عملهم.
  ('accountant','appointments.view'),
  ('accountant','patients.view'),
  ('lab_technician','patients.view'),
  ('radiology_technician','patients.view'),
  ('pharmacist','patients.view');

alter table permission_catalog enable row level security;
alter table role_default_permissions enable row level security;
drop policy if exists "permission_catalog_read" on permission_catalog;
create policy "permission_catalog_read" on permission_catalog for select using (auth.uid() is not null);
drop policy if exists "role_default_permissions_read" on role_default_permissions;
create policy "role_default_permissions_read" on role_default_permissions for select using (auth.uid() is not null);
revoke all on permission_catalog from anon;
revoke all on role_default_permissions from anon;
grant select on permission_catalog to authenticated;
grant select on role_default_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- 3) دالة الفحص
--
-- ترتيب الأسبقية مقصود:
--   المالك/مدير المنشأة  →  دائمًا نعم
--   استثناء صريح للمستخدم →  يفوز على افتراض الصفة (منحًا أو منعًا)
--   افتراض الصفة        →  ما تبقّى
--
-- المنع الصريح يفوز لأن الحاجة إليه أشدّ من الحاجة إلى المنح: «مستقبِل واحد
-- لا يُلغي المواعيد» حالة واقعية، ولا تُعالج بتغيير صفته كلها.
-- ---------------------------------------------------------------------------
create or replace function app_has_permission(target_org_id uuid, p_permission_key text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1 from organization_memberships m
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and m.role_key in ('owner','organization_admin')
    ) then true
    when exists (
      select 1 from membership_permissions p
       where p.organization_id = target_org_id
         and p.user_id = auth.uid()
         and p.permission_key = p_permission_key
    ) then coalesce((
      select p.granted from membership_permissions p
       where p.organization_id = target_org_id
         and p.user_id = auth.uid()
         and p.permission_key = p_permission_key
    ), false)
    else exists (
      select 1
        from organization_memberships m
        join role_default_permissions d on d.role_key = m.role_key
       where m.organization_id = target_org_id
         and m.user_id = auth.uid()
         and m.is_active
         and d.permission_key = p_permission_key
    )
  end;
$$;

comment on function app_has_permission(uuid, text) is
  'هل يملك المستخدم الحالي هذه الصلاحية في هذه المنشأة؟ الأسبقية: المالك/المدير ← استثناء صريح في membership_permissions ← افتراض الصفة.';

revoke all on function app_has_permission(uuid, text) from public, anon;
grant execute on function app_has_permission(uuid, text) to authenticated;

-- منظور يعرض للمستخدم صلاحياته المحسوبة — تقرؤه الواجهة مرة واحدة عند
-- الدخول بدل استدعاء الدالة لكل زر.
create or replace view v_my_permissions as
select
  m.organization_id,
  c.permission_key,
  app_has_permission(m.organization_id, c.permission_key) as granted
from organization_memberships m
cross join permission_catalog c
where m.user_id = auth.uid() and m.is_active;

alter view v_my_permissions set (security_invoker = on);
revoke all on v_my_permissions from anon;
grant select on v_my_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- 4) الفرع
--
-- `branch_id` فارغ في العضوية = وصول لكل الفروع. هذا هو حال كل الأعضاء
-- اليوم، فلا يتغيّر شيء حتى يُسند مديرٌ فرعًا لمستخدم صراحةً — وهذا هو
-- المقصود: العزل يُفعَّل بقرار، لا يُفرض فجأة على نظام يعمل.
-- ---------------------------------------------------------------------------
create or replace function app_can_access_branch(target_org_id uuid, p_branch_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_memberships m
     where m.organization_id = target_org_id
       and m.user_id = auth.uid()
       and m.is_active
       and (
         m.role_key in ('owner','organization_admin')  -- كل الفروع
         or m.branch_id is null                        -- غير مقيَّد بفرع
         or p_branch_id is null                        -- سجل غير منسوب لفرع
         or m.branch_id = p_branch_id
       )
  );
$$;

revoke all on function app_can_access_branch(uuid, uuid) from public, anon;
grant execute on function app_can_access_branch(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) `branch_id` على الجداول التشغيلية
--
-- يُشتقّ من العيادة لا يُطلب من المستخدم: العيادة تعرف فرعها منذ 0001،
-- وطلبه ثانيةً باب لتناقض بين الاثنين.
-- ---------------------------------------------------------------------------
alter table appointments    add column if not exists branch_id uuid references branches(id) on delete set null;
alter table patient_visits  add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists idx_appointments_branch on appointments (organization_id, branch_id)
  where branch_id is not null;
create index if not exists idx_patient_visits_branch on patient_visits (organization_id, branch_id)
  where branch_id is not null;

create or replace function app_derive_branch_from_clinic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- لا يُلمس فرعٌ حُدِّد صراحةً: قد يُنقل موعد إلى فرع بلا عيادة محدَّدة بعد.
  if new.branch_id is null and new.clinic_id is not null then
    select c.branch_id into new.branch_id from clinics c where c.id = new.clinic_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_branch on appointments;
create trigger trg_appointments_branch
before insert or update of clinic_id, branch_id on appointments
for each row execute function app_derive_branch_from_clinic();

drop trigger if exists trg_patient_visits_branch on patient_visits;
create trigger trg_patient_visits_branch
before insert or update of clinic_id, branch_id on patient_visits
for each row execute function app_derive_branch_from_clinic();

-- تعبئة السجلات القائمة من عياداتها
update appointments a set branch_id = c.branch_id
  from clinics c where c.id = a.clinic_id and a.branch_id is null and c.branch_id is not null;
update patient_visits v set branch_id = c.branch_id
  from clinics c where c.id = v.clinic_id and v.branch_id is null and c.branch_id is not null;

-- ---------------------------------------------------------------------------
-- 6) السياسات: صلاحية + فرع، لا صفة وحدها
--
-- القراءة تُقيَّد بالفرع، والكتابة بالصلاحية **والفرع معًا**. تقييد الكتابة
-- بالصلاحية وحدها كان سيسمح لمدير فرعٍ بتعديل موعد فرعٍ آخر بمعرّفه مباشرةً
-- — وهو بالضبط ما يفحصه شرط القبول «تغيير المعرّف في الرابط لا يفتح سجلًا
-- غير مصرح به».
-- ---------------------------------------------------------------------------
drop policy if exists "appointments_read_members" on appointments;
create policy "appointments_read_members" on appointments
  for select using (
    app_is_member(organization_id)
    and app_has_permission(organization_id, 'appointments.view')
    and app_can_access_branch(organization_id, branch_id)
  );

drop policy if exists "appointments_insert_staff" on appointments;
create policy "appointments_insert_staff" on appointments
  for insert with check (
    app_has_permission(organization_id, 'appointments.create')
    and app_can_access_branch(organization_id, branch_id)
  );

drop policy if exists "appointments_update_staff" on appointments;
create policy "appointments_update_staff" on appointments
  for update using (
    app_has_permission(organization_id, 'appointments.update')
    and app_can_access_branch(organization_id, branch_id)
  );

drop policy if exists "appointments_delete_admins" on appointments;
create policy "appointments_delete_admins" on appointments
  for delete using (app_is_org_admin(organization_id));

-- الزيارات: القراءة بالفرع أيضًا. الكتابة تمرّ بـ`app_save_visit` وحدها
-- (0061) وهي تفحص الصفة بنفسها، فلا تُشدَّد هنا حتى لا يُمنع مسار قائم.
drop policy if exists "patient_visits_read_members" on patient_visits;
create policy "patient_visits_read_members" on patient_visits
  for select using (
    app_is_member(organization_id)
    and app_can_access_branch(organization_id, branch_id)
  );

commit;
