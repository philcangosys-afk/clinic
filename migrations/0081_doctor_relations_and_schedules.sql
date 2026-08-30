-- 0081_doctor_relations_and_schedules.sql
-- المرحلة الثانية: الأطباء — العلاقات المتعددة وجدول العمل الأسبوعي.
--
-- الحالة قبل هذا الملف: للطبيب `clinic_id` **واحد**. طبيبٌ يعمل في عيادتين،
-- أو في فرعين، لا يمكن تمثيله إطلاقًا — يُسجَّل مرتين بملفّين، فتنقسم
-- مواعيده وإحصاءاته وتقاريره بين سجلّين لا يعرف النظام أنهما شخص واحد.
--
-- وجدول العمل: `doctor_working_hours` يخزّن فترات **بتاريخ ووقت محدَّدين**،
-- أي أن دوام الطبيب لعام كامل يحتاج ٧٣٠ صفًّا يُدخلها أحدهم يدويًا. لا
-- يوجد جدول أسبوعي متكرّر.
--
-- ثلاثة قرارات في إعادة الاستعمال، سببها قاعدة «لا جداول ولا أعمدة مكرّرة»:
--
--   1) **`doctor_working_hours` يبقى ويتحوّل إلى جدول الاستثناءات.** هو
--      أصلًا يحمل `is_blocked` وفترات بتواريخ محدَّدة، وهذا تعريف الاستثناء
--      بالضبط. يُضاف إليه `exception_type` و`reason`، ويُملأ من `is_blocked`
--      القائم. الجديد هو الجدول **المتكرّر** `doctor_schedules`، وهو غرض
--      مختلف لا تكرار.
--
--   2) **لا يُضاف `default_visit_duration` ولا `allows_online_booking` ولا
--      `is_active` إلى `doctors`.** الموجود يكفي:
--      `default_appointment_duration_minutes` و`disabled_from_booking`
--      (معكوس) و`is_enabled`.
--
--   3) **لا يُضاف `doctor_code` ولا `professional_title`.** `file_number`
--      و`job_title` قائمان ويؤدّيان الغرض.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) بيانات الطبيب الناقصة فعلًا
-- ---------------------------------------------------------------------------
alter table doctors
  add column if not exists employee_id               uuid references employees(id) on delete set null,
  add column if not exists subspecialty              text,
  add column if not exists identity_type             text,
  add column if not exists license_number            text,
  add column if not exists license_authority         text,
  add column if not exists license_expiry_date       date,
  add column if not exists classification_expiry_date date,
  add column if not exists updated_by                uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'doctors_identity_type_check') then
    alter table doctors add constraint doctors_identity_type_check
      check (identity_type is null or identity_type in ('national_id','iqama','passport','gcc_id','border_number'));
  end if;
end $$;

comment on column doctors.specialty_authority is 'جهة التصنيف (الهيئة). رقمها في specialty_authority_number، وانتهاؤه في classification_expiry_date.';
comment on column doctors.default_appointment_duration_minutes is 'مدة الموعد الافتراضية للطبيب. لا يوجد default_visit_duration منفصل.';
comment on column doctors.disabled_from_booking is 'موقوف عن الحجز. لا يوجد allows_online_booking — علَمان لمعنى واحد يتناقضان.';

-- تنبيه انتهاء الترخيص: منظور يقرأ ما بقي من أيام
create or replace view v_doctor_license_status as
select
  d.id                as doctor_id,
  d.organization_id,
  d.name_ar,
  d.license_number,
  d.license_authority,
  d.license_expiry_date,
  d.specialty_authority_number as classification_number,
  d.classification_expiry_date,
  case
    when d.license_expiry_date is null then null
    else (d.license_expiry_date - current_date)
  end                 as license_days_left,
  case
    when d.classification_expiry_date is null then null
    else (d.classification_expiry_date - current_date)
  end                 as classification_days_left,
  (d.license_expiry_date is not null and d.license_expiry_date < current_date)        as license_expired,
  (d.classification_expiry_date is not null and d.classification_expiry_date < current_date) as classification_expired,
  d.is_enabled,
  d.disabled_from_booking
from doctors d;

alter view v_doctor_license_status set (security_invoker = on);
revoke all on v_doctor_license_status from anon;
grant select on v_doctor_license_status to authenticated;

-- ---------------------------------------------------------------------------
-- 2) فروع الطبيب وعياداته وخدماته
--
-- **غياب الصفوف يعني «كل الفروع»** — نفس اتجاه `item_branches`، وللسبب
-- نفسه: الأطباء القائمون كلهم بلا صفوف، فلو كان الغياب منعًا لتعطّل الحجز
-- كله لحظة تشغيل الهجرة.
-- ---------------------------------------------------------------------------
create table if not exists doctor_branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  doctor_id       uuid not null references doctors(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_doctor_branches on doctor_branches (doctor_id, branch_id);
-- فرع رئيسي واحد لكل طبيب: «رئيسيان» يعني أن التقارير تعدّه في فرعين.
create unique index if not exists uq_doctor_primary_branch
  on doctor_branches (doctor_id) where is_primary;

create table if not exists doctor_clinics (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  doctor_id       uuid not null references doctors(id) on delete cascade,
  clinic_id       uuid not null references clinics(id) on delete cascade,
  branch_id       uuid references branches(id) on delete set null,
  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_doctor_clinics on doctor_clinics (doctor_id, clinic_id);
create unique index if not exists uq_doctor_primary_clinic
  on doctor_clinics (doctor_id) where is_primary;
create index if not exists idx_doctor_clinics_clinic on doctor_clinics (clinic_id) where is_active;

create table if not exists doctor_services (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  doctor_id        uuid not null references doctors(id) on delete cascade,
  item_id          uuid not null references items(id) on delete cascade,
  branch_id        uuid references branches(id) on delete set null,
  duration_minutes integer,
  price_override   numeric(12,2),
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint doctor_services_duration_check
    check (duration_minutes is null or duration_minutes between 5 and 1440),
  constraint doctor_services_price_check
    check (price_override is null or price_override >= 0)
);

create unique index if not exists uq_doctor_services
  on doctor_services (doctor_id, item_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_doctor_services_item on doctor_services (item_id) where is_active;

comment on column doctor_services.price_override is
  'سعر خاص بالطبيب. لا يُطبَّق إلا إذا فعّلت المنشأة السياسة (organization_settings.allow_doctor_price_override).';

-- القيود المركّبة
do $$
declare r record;
begin
  for r in
    select * from (values
      ('doctor_branches', 'doctor_branches_doctor_tenant_fk', 'doctor_id', 'doctors'),
      ('doctor_branches', 'doctor_branches_branch_tenant_fk', 'branch_id', 'branches'),
      ('doctor_clinics',  'doctor_clinics_doctor_tenant_fk',  'doctor_id', 'doctors'),
      ('doctor_clinics',  'doctor_clinics_clinic_tenant_fk',  'clinic_id', 'clinics'),
      ('doctor_clinics',  'doctor_clinics_branch_tenant_fk',  'branch_id', 'branches'),
      ('doctor_services', 'doctor_services_doctor_tenant_fk', 'doctor_id', 'doctors'),
      ('doctor_services', 'doctor_services_item_tenant_fk',   'item_id',   'items'),
      ('doctor_services', 'doctor_services_branch_tenant_fk', 'branch_id', 'branches')
    ) as v(tbl, conname, col, ref)
  loop
    if not exists (select 1 from pg_constraint where conname = r.conname) then
      execute format(
        'alter table %I add constraint %I foreign key (organization_id, %I) references %I (organization_id, id) not valid',
        r.tbl, r.conname, r.col, r.ref);
    end if;
  end loop;
end $$;

-- العيادة والفرع على `doctor_clinics` يجب أن يتوافقا
create or replace function app_enforce_doctor_clinic_branch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic_branch uuid;
begin
  select branch_id into v_clinic_branch from clinics where id = new.clinic_id;

  -- الفرع يُشتقّ من العيادة إن لم يُمرَّر، ويُرفض إن خالفها.
  if new.branch_id is null then
    new.branch_id := v_clinic_branch;
  elsif v_clinic_branch is not null and new.branch_id <> v_clinic_branch then
    raise exception 'العيادة تتبع فرعًا آخر';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_doctor_clinic_branch on doctor_clinics;
create trigger trg_doctor_clinic_branch
  before insert or update of clinic_id, branch_id on doctor_clinics
  for each row execute function app_enforce_doctor_clinic_branch();

-- ---------------------------------------------------------------------------
-- 3) جدول العمل الأسبوعي المتكرّر
--
-- `day_of_week` بعُرف ISO: الاثنين 1 … الأحد 7. اخترته لأن `extract(isodow)`
-- يعطيه مباشرةً، فلا تحويل يدويًا في كل استعلام — وكل تحويل يدوي مكان خطأ.
-- ---------------------------------------------------------------------------
create table if not exists doctor_schedules (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  doctor_id             uuid not null references doctors(id) on delete cascade,
  branch_id             uuid references branches(id) on delete set null,
  clinic_id             uuid references clinics(id) on delete set null,
  day_of_week           smallint not null,
  start_time            time not null,
  end_time              time not null,
  slot_duration_minutes integer not null default 15,
  capacity              integer not null default 1,
  effective_from        date not null default current_date,
  effective_to          date,
  is_active             boolean not null default true,
  note                  text,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint doctor_schedules_dow_check  check (day_of_week between 1 and 7),
  constraint doctor_schedules_time_check check (end_time > start_time),
  constraint doctor_schedules_slot_check check (slot_duration_minutes between 5 and 480),
  constraint doctor_schedules_cap_check  check (capacity > 0),
  constraint doctor_schedules_range_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_doctor_schedules_doctor
  on doctor_schedules (doctor_id, day_of_week) where is_active;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('doctor_schedules', 'doctor_schedules_doctor_tenant_fk', 'doctor_id', 'doctors'),
      ('doctor_schedules', 'doctor_schedules_clinic_tenant_fk', 'clinic_id', 'clinics'),
      ('doctor_schedules', 'doctor_schedules_branch_tenant_fk', 'branch_id', 'branches')
    ) as v(tbl, conname, col, ref)
  loop
    if not exists (select 1 from pg_constraint where conname = r.conname) then
      execute format(
        'alter table %I add constraint %I foreign key (organization_id, %I) references %I (organization_id, id) not valid',
        r.tbl, r.conname, r.col, r.ref);
    end if;
  end loop;
end $$;

-- منع تداخل فترتين لنفس الطبيب في نفس اليوم ونفس فترة السريان
--
-- فترتان متداخلتان تعنيان أن حساب السعة يُضاعف بلا سبب، ويظهر للموظف
-- ضِعفُ المواعيد المتاحة.
create or replace function app_enforce_schedule_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not new.is_active then
    return new;
  end if;

  if exists (
    select 1 from doctor_schedules s
     where s.doctor_id = new.doctor_id
       and s.day_of_week = new.day_of_week
       and s.is_active
       and s.id <> new.id
       and coalesce(s.clinic_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.clinic_id, '00000000-0000-0000-0000-000000000000'::uuid)
       -- تقاطع في فترة السريان
       and daterange(s.effective_from, s.effective_to, '[]')
           && daterange(new.effective_from, new.effective_to, '[]')
       -- وتقاطع في الوقت
       and (s.start_time, s.end_time) overlaps (new.start_time, new.end_time)
  ) then
    raise exception 'تتداخل هذه الفترة مع فترة دوام أخرى لنفس الطبيب في اليوم نفسه';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_schedule_overlap on doctor_schedules;
create trigger trg_schedule_overlap
  before insert or update on doctor_schedules
  for each row execute function app_enforce_schedule_overlap();

-- ---------------------------------------------------------------------------
-- 4) الاستثناءات — توسعة `doctor_working_hours` لا جدول ثانٍ
-- ---------------------------------------------------------------------------
alter table doctor_working_hours
  add column if not exists organization_id uuid references organizations(id) on delete cascade,
  add column if not exists branch_id       uuid references branches(id) on delete set null,
  add column if not exists clinic_id       uuid references clinics(id) on delete set null,
  add column if not exists exception_type  text,
  add column if not exists reason          text,
  add column if not exists created_by      uuid references auth.users(id);

-- تعبئة المنشأة من الطبيب، والنوع من `is_blocked` القائم
update doctor_working_hours h
   set organization_id = d.organization_id
  from doctors d
 where d.id = h.doctor_id and h.organization_id is null;

update doctor_working_hours
   set exception_type = case when is_blocked then 'blocked_time' else 'custom_hours' end
 where exception_type is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dwh_exception_type_check') then
    alter table doctor_working_hours add constraint dwh_exception_type_check
      check (exception_type is null or exception_type in
        ('leave','vacation','training','blocked_time','emergency','custom_hours'));
  end if;
end $$;

-- `is_blocked` يُشتقّ من النوع، فلا يفترقان أبدًا
create or replace function app_sync_working_hours_flag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.exception_type is null then
    new.exception_type := case when new.is_blocked then 'blocked_time' else 'custom_hours' end;
  else
    new.is_blocked := new.exception_type <> 'custom_hours';
  end if;

  if new.organization_id is null then
    select organization_id into new.organization_id from doctors where id = new.doctor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_working_hours_flag on doctor_working_hours;
create trigger trg_sync_working_hours_flag
  before insert or update on doctor_working_hours
  for each row execute function app_sync_working_hours_flag();

alter table doctor_working_hours enable row level security;
drop policy if exists dwh_select on doctor_working_hours;
create policy dwh_select on doctor_working_hours for select to authenticated
  using (exists (select 1 from doctors d
                  where d.id = doctor_working_hours.doctor_id
                    and app_is_member(d.organization_id)));
drop policy if exists dwh_write on doctor_working_hours;
create policy dwh_write on doctor_working_hours for all to authenticated
  using (exists (select 1 from doctors d
                  where d.id = doctor_working_hours.doctor_id
                    and app_has_permission(d.organization_id, 'doctors.manage')))
  with check (exists (select 1 from doctors d
                       where d.id = doctor_working_hours.doctor_id
                         and app_has_permission(d.organization_id, 'doctors.manage')));

-- ---------------------------------------------------------------------------
-- 5) الصلاحيات وسياسات الجداول الجديدة
-- ---------------------------------------------------------------------------
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('doctors.view',     'عرض الأطباء',            'doctors', 830),
  ('doctors.manage',   'إدارة الأطباء وجداولهم', 'doctors', 840)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'doctors.view'), ('branch_manager', 'doctors.manage'),
  ('receptionist',   'doctors.view'),
  ('doctor',         'doctors.view'),
  ('nurse',          'doctors.view'),
  ('accountant',     'doctors.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

do $$
declare t text;
begin
  foreach t in array array['doctor_branches','doctor_clinics','doctor_services','doctor_schedules']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format($p$create policy %I on %I for select to authenticated
                     using (app_is_member(organization_id))$p$, t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format($p$create policy %I on %I for all to authenticated
                     using (app_has_permission(organization_id, 'doctors.manage'))
                     with check (app_has_permission(organization_id, 'doctors.manage'))$p$,
                   t || '_write', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- `doctors` نفسه كان مفتوحًا للكتابة لكل عضو
drop policy if exists doctors_all_members on doctors;
drop policy if exists doctors_select on doctors;
create policy doctors_select on doctors for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists doctors_write on doctors;
create policy doctors_write on doctors for all to authenticated
  using (app_has_permission(organization_id, 'doctors.manage'))
  with check (app_has_permission(organization_id, 'doctors.manage'));

-- ---------------------------------------------------------------------------
-- 6) هجرة الربط القائم: `doctors.clinic_id` → `doctor_clinics`
--
-- العمود يبقى (تقرؤه شاشات كثيرة) ويصير مشتقًّا من العيادة الرئيسية.
-- ---------------------------------------------------------------------------
insert into doctor_clinics (organization_id, doctor_id, clinic_id, branch_id, is_primary, is_active)
select d.organization_id, d.id, d.clinic_id, c.branch_id, true, d.is_enabled
  from doctors d
  join clinics c on c.id = d.clinic_id
 where d.clinic_id is not null
   and not exists (select 1 from doctor_clinics x
                    where x.doctor_id = d.id and x.clinic_id = d.clinic_id);

insert into doctor_branches (organization_id, doctor_id, branch_id, is_primary, is_active)
select distinct on (d.id) d.organization_id, d.id, c.branch_id, true, d.is_enabled
  from doctors d
  join clinics c on c.id = d.clinic_id
 where c.branch_id is not null
   and not exists (select 1 from doctor_branches x
                    where x.doctor_id = d.id and x.branch_id = c.branch_id);

-- ---------------------------------------------------------------------------
-- 7) سلسلة الحجز: فرع ← عيادة ← طبيب ← خدمة
--
-- كل دالة تُعيد ما هو **متاح فعلًا** في الخطوة التالية. الشاشة تعرض ولا
-- تقرّر، فلا يفترق ما يراه الموظف عمّا تقبله القاعدة.
-- ---------------------------------------------------------------------------
create or replace function app_clinics_for_branch(
  p_organization_id uuid,
  p_branch_id       uuid default null
)
returns table (id uuid, name text, department_name text, default_visit_duration int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, d.name_ar, c.default_visit_duration
    from clinics c
    left join departments d on d.id = c.department_id
   where c.organization_id = p_organization_id
     and not c.is_disabled
     and (p_branch_id is null or c.branch_id = p_branch_id or c.branch_id is null)
     and (d.id is null or (d.is_active and d.is_clinical))
     and app_is_member(p_organization_id)
   order by c.sort_order, c.name;
$$;

create or replace function app_doctors_for_clinic(
  p_organization_id uuid,
  p_clinic_id       uuid
)
returns table (
  id uuid, name_ar text, specialty text,
  default_duration int, license_expired boolean, is_primary boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.name_ar, sp.name_ar,
         d.default_appointment_duration_minutes,
         (d.license_expiry_date is not null and d.license_expiry_date < current_date),
         dc.is_primary
    from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    left join lookup_values sp on sp.id = d.specialty_value_id
   where dc.clinic_id = p_clinic_id
     and dc.organization_id = p_organization_id
     and dc.is_active
     and d.is_enabled
     and not d.disabled_from_booking
     and app_is_member(p_organization_id)
   order by dc.is_primary desc, d.name_ar;
$$;

create or replace function app_services_for_doctor(
  p_organization_id uuid,
  p_doctor_id       uuid,
  p_clinic_id       uuid default null,
  p_branch_id       uuid default null
)
returns table (
  id uuid, name_ar text, medical_service_type text,
  duration_minutes int, price numeric, source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- خدمات الطبيب المصرَّح بها إن وُجدت؛ وإلا خدمات العيادة.
  --
  -- الرجوع إلى خدمات العيادة مقصود: طبيبٌ لم تُسجَّل خدماته بعد يجب أن
  -- يظلّ قابلًا للحجز، وإلا تعطّل الحجز كله لحظة تشغيل الهجرة.
  select i.id, i.name_ar, i.medical_service_type,
         coalesce(ds.duration_minutes, i.duration_minutes,
                  d.default_appointment_duration_minutes, c.default_visit_duration),
         i.price,
         case when ds.id is not null then 'doctor' else 'clinic' end
    from items i
    join doctors d on d.id = p_doctor_id
    left join clinics c on c.id = p_clinic_id
    left join doctor_services ds
      on ds.item_id = i.id and ds.doctor_id = p_doctor_id and ds.is_active
         and (ds.branch_id is null or p_branch_id is null or ds.branch_id = p_branch_id)
   where i.organization_id = p_organization_id
     and i.item_type = 'service'
     and not i.is_archived and not i.is_disabled
     and app_item_available_in_branch(i.id, p_branch_id)
     and (
       ds.id is not null
       or (
         not exists (select 1 from doctor_services x
                      where x.doctor_id = p_doctor_id and x.is_active)
         and (p_clinic_id is null or i.default_clinic_id is null or i.default_clinic_id = p_clinic_id)
       )
     )
     and app_is_member(p_organization_id)
   order by i.name_ar;
$$;

revoke all on function app_clinics_for_branch(uuid, uuid) from public, anon;
revoke all on function app_doctors_for_clinic(uuid, uuid) from public, anon;
revoke all on function app_services_for_doctor(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function app_clinics_for_branch(uuid, uuid) to authenticated;
grant execute on function app_doctors_for_clinic(uuid, uuid) to authenticated;
grant execute on function app_services_for_doctor(uuid, uuid, uuid, uuid) to authenticated;

commit;
