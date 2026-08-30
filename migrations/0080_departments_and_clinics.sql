-- 0080_departments_and_clinics.sql
-- المرحلة الأولى: الأقسام والعيادات — الأساس الذي يقوم عليه الأطباء
-- والمواعيد والخدمات والمختبر والأشعة.
--
-- الحالة قبل هذا الملف: **لا يوجد جدول أقسام إطلاقًا**. شاشة «الأقسام
-- والعيادات» تقرأ `clinics` وتسمّيها أقسامًا، وكلّ ما تحمله العيادة عن
-- تصنيفها عمود نصّي `clinic_type` بلا قائمة ولا قيد. فلا يمكن أن يُقال
-- «كم طبيبًا في قسم الأشعة» لأن القسم غير موجود.
--
-- قراران يخالفان حرفية المواصفة عن قصد، وسببهما قاعدة «لا جداول ولا أعمدة
-- مكرّرة لنفس الغرض»:
--
--   • **`is_active` لا يُضاف إلى `clinics`.** العمود القائم `is_disabled`
--     يقول الشيء نفسه معكوسًا، ويُقرأ اليوم في تسع شاشات. إضافة علَمٍ ثانٍ
--     تعني حالتين قد تتناقضان، ولا أحد يعرف أيّهما الحقيقة. يبقى
--     `is_disabled` وحده.
--
--   • **`name_ar` لا يُضاف إلى `clinics`.** العمود `name` موجود و`not null`
--     ويحمل الاسم العربي فعليًا في كل الصفوف. يُضاف `name_en` وحده،
--     ويُوثَّق أن `name` هو الاسم العربي.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) الأقسام
-- ---------------------------------------------------------------------------
create table if not exists departments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  code                 text,
  name_ar              text not null,
  name_en              text,
  description_ar       text,
  description_en       text,
  department_type      text not null default 'clinical',
  parent_department_id uuid references departments(id) on delete set null,
  manager_user_id      uuid references auth.users(id) on delete set null,
  is_clinical          boolean not null default true,
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id),
  constraint departments_type_check check (
    department_type in ('clinical','laboratory','radiology','pharmacy','administrative','support')
  ),
  constraint departments_org_id_key unique (organization_id, id)
);

create unique index if not exists uq_departments_org_code
  on departments (organization_id, code) where code is not null;
create index if not exists idx_departments_parent on departments (parent_department_id);
create index if not exists idx_departments_org on departments (organization_id, is_active);

comment on column departments.is_clinical is
  'قسم سريري يستقبل مرضى. الأقسام الإدارية والمساندة لا تُعرض في حجز المواعيد.';

-- القسم الأب من نفس المنشأة
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_parent_tenant_fk') then
    alter table departments add constraint departments_parent_tenant_fk
      foreign key (organization_id, parent_department_id)
      references departments (organization_id, id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) منع الدورات في شجرة الأقسام
--
-- «أ أبٌ لـ ب، و ب أبٌ لـ أ» ليست خطأ إدخال نادرًا: تكفي إعادةُ تنظيمٍ
-- على مرحلتين. والنتيجة أن أي استعلام تكراري على الشجرة يدور إلى الأبد
-- ويعلّق الشاشة. الحارس هنا لا في الواجهة.
-- ---------------------------------------------------------------------------
create or replace function app_enforce_department_tree()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor uuid;
  v_depth  int := 0;
begin
  if new.parent_department_id is null then
    return new;
  end if;
  if new.parent_department_id = new.id then
    raise exception 'القسم لا يكون أبًا لنفسه';
  end if;

  v_cursor := new.parent_department_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'ربط القسم بهذا الأب يصنع دورة في الشجرة';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 20 then
      raise exception 'شجرة الأقسام أعمق من عشرين مستوى — راجع الترتيب';
    end if;
    select parent_department_id into v_cursor from departments where id = v_cursor;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_department_tree on departments;
create trigger trg_department_tree
  before insert or update of parent_department_id on departments
  for each row execute function app_enforce_department_tree();

-- ---------------------------------------------------------------------------
-- 3) توسعة العيادات
-- ---------------------------------------------------------------------------
alter table clinics
  add column if not exists department_id          uuid references departments(id) on delete set null,
  add column if not exists name_en                text,
  add column if not exists specialty_value_id     uuid references lookup_values(id) on delete set null,
  add column if not exists phone_extension        text,
  add column if not exists floor                  text,
  add column if not exists room_number            text,
  add column if not exists default_visit_duration integer,
  add column if not exists allows_walk_in         boolean not null default true,
  add column if not exists allows_online_booking  boolean not null default false,
  add column if not exists capacity               integer,
  add column if not exists color                  text,
  add column if not exists sort_order             integer not null default 0,
  add column if not exists created_by             uuid references auth.users(id),
  add column if not exists updated_by             uuid references auth.users(id);

comment on column clinics.name is 'الاسم العربي. لا يوجد name_ar منفصل — العمود قائم منذ 0001 ويُقرأ في كل الشاشات.';
comment on column clinics.is_disabled is 'حالة العيادة. لا يوجد is_active — علَمان لنفس المعنى يتناقضان.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_duration_check') then
    alter table clinics add constraint clinics_duration_check
      check (default_visit_duration is null
             or (default_visit_duration between 5 and 480));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_capacity_check') then
    alter table clinics add constraint clinics_capacity_check
      check (capacity is null or capacity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_color_check') then
    -- لون بصيغة #RRGGBB لا غير: نصٌّ حرّ هنا يعني شاشةً تعرض لونًا مكسورًا.
    alter table clinics add constraint clinics_color_check
      check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_department_tenant_fk') then
    alter table clinics add constraint clinics_department_tenant_fk
      foreign key (organization_id, department_id)
      references departments (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_branch_tenant_fk') then
    alter table clinics add constraint clinics_branch_tenant_fk
      foreign key (organization_id, branch_id)
      references branches (organization_id, id) not valid;
  end if;
end $$;

create index if not exists idx_clinics_department on clinics (department_id);
create index if not exists idx_clinics_branch on clinics (organization_id, branch_id);

-- ---------------------------------------------------------------------------
-- 4) الصلاحيات
-- ---------------------------------------------------------------------------
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('structure.view',   'عرض الأقسام والعيادات',  'structure', 810),
  ('structure.manage', 'إدارة الأقسام والعيادات', 'structure', 820)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'structure.view'), ('branch_manager', 'structure.manage'),
  ('receptionist',   'structure.view'),
  ('doctor',         'structure.view'),
  ('accountant',     'structure.view'),
  ('nurse',          'structure.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

alter table departments enable row level security;

drop policy if exists departments_select on departments;
create policy departments_select on departments for select to authenticated
  using (app_is_member(organization_id));

drop policy if exists departments_write on departments;
create policy departments_write on departments for all to authenticated
  using (app_has_permission(organization_id, 'structure.manage'))
  with check (app_has_permission(organization_id, 'structure.manage'));

revoke all on departments from anon;
grant select, insert, update, delete on departments to authenticated;

-- العيادات: القراءة لكل عضو، والكتابة لمن يملك `structure.manage`.
-- كانت `for all` لكل عضو، أي أن موظف الاستقبال يعيد تسمية العيادات.
drop policy if exists clinics_all_members on clinics;
drop policy if exists clinics_select on clinics;
create policy clinics_select on clinics for select to authenticated
  using (app_is_member(organization_id));

drop policy if exists clinics_write on clinics;
create policy clinics_write on clinics for all to authenticated
  using (app_has_permission(organization_id, 'structure.manage'))
  with check (app_has_permission(organization_id, 'structure.manage'));

-- ---------------------------------------------------------------------------
-- 5) تعطيل العيادة — حارسٌ لا تحذير في الواجهة
--
-- عيادة عليها مواعيد قادمة، تعطيلها يترك المرضى بمواعيد لا مكان لها.
-- الدالة تُعيد عدد المواعيد كي تعرض الشاشة رقمًا لا جملة عامّة، والمشغّل
-- يمنع التعطيل ما لم يمرّ عبر `app_disable_clinic` بسبب صريح.
-- ---------------------------------------------------------------------------
create or replace function app_clinic_future_appointments(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from appointments a
   where a.clinic_id = p_clinic_id
     and a.scheduled_start > now()
     and a.status not in ('completed','cancelled_by_patient','cancelled_by_staff','no_show')
     and app_is_member(a.organization_id);
$$;

create or replace function app_disable_clinic(
  p_clinic_id uuid,
  p_reason    text,
  p_force     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_name   text;
  v_future int;
begin
  select organization_id, name into v_org, v_name from clinics where id = p_clinic_id;
  if v_org is null then
    raise exception 'العيادة غير موجودة';
  end if;
  if not app_has_permission(v_org, 'structure.manage') then
    raise exception 'صلاحيتك لا تسمح بتعطيل العيادات';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'سبب التعطيل مطلوب';
  end if;

  v_future := app_clinic_future_appointments(p_clinic_id);
  if v_future > 0 and not p_force then
    raise exception 'للعيادة % موعدًا قادمًا — أعد جدولتها أو أكّد التعطيل صراحةً', v_future;
  end if;

  update clinics set is_disabled = true, updated_at = now(), updated_by = auth.uid()
   where id = p_clinic_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_org, auth.uid(), 'structure', 'update', p_clinic_id, v_name,
          format('تعطيل عيادة (مواعيد قادمة: %s)', v_future), btrim(p_reason));

  return jsonb_build_object('ok', true, 'future_appointments', v_future);
end;
$$;

create or replace function app_enable_clinic(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_name text;
begin
  select organization_id, name into v_org, v_name from clinics where id = p_clinic_id;
  if v_org is null then
    raise exception 'العيادة غير موجودة';
  end if;
  if not app_has_permission(v_org, 'structure.manage') then
    raise exception 'صلاحيتك لا تسمح بتفعيل العيادات';
  end if;

  update clinics set is_disabled = false, updated_at = now(), updated_by = auth.uid()
   where id = p_clinic_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_org, auth.uid(), 'structure', 'update', p_clinic_id, v_name, 'تفعيل عيادة');
end;
$$;

revoke all on function app_clinic_future_appointments(uuid) from public, anon;
revoke all on function app_disable_clinic(uuid, text, boolean) from public, anon;
revoke all on function app_enable_clinic(uuid) from public, anon;
grant execute on function app_clinic_future_appointments(uuid) to authenticated;
grant execute on function app_disable_clinic(uuid, text, boolean) to authenticated;
grant execute on function app_enable_clinic(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) القسم لا يُعطَّل وله عيادة نشطة
-- ---------------------------------------------------------------------------
create or replace function app_enforce_department_disable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active int;
begin
  if new.is_active or old.is_active = new.is_active then
    return new;
  end if;

  select count(*) into v_active
    from clinics c where c.department_id = new.id and not c.is_disabled;

  if v_active > 0 then
    raise exception 'للقسم % عيادة نشطة — عطّلها أولًا', v_active;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_department_disable on departments;
create trigger trg_department_disable
  before update of is_active on departments
  for each row execute function app_enforce_department_disable();

-- ---------------------------------------------------------------------------
-- 7) المناظير — العدّادات التي تطلبها الشاشة
--
-- تُحسب في القاعدة لا في المتصفّح: حسابها هناك يعني استعلامًا لكل صفّ.
-- ---------------------------------------------------------------------------
create or replace view v_department_summary as
select
  d.id,
  d.organization_id,
  d.code,
  d.name_ar,
  d.name_en,
  d.department_type,
  d.parent_department_id,
  p.name_ar          as parent_name,
  d.manager_user_id,
  d.is_clinical,
  d.is_active,
  d.sort_order,
  coalesce(c.clinic_count, 0)   as clinic_count,
  coalesce(c.active_clinics, 0) as active_clinic_count,
  coalesce(dr.doctor_count, 0)  as doctor_count,
  coalesce(it.service_count, 0) as service_count,
  d.created_at,
  d.updated_at
from departments d
left join departments p on p.id = d.parent_department_id
left join lateral (
  select count(*) as clinic_count,
         count(*) filter (where not x.is_disabled) as active_clinics
    from clinics x where x.department_id = d.id
) c on true
left join lateral (
  select count(distinct dc.id) as doctor_count
    from doctors dc
    join clinics x on x.id = dc.clinic_id
   where x.department_id = d.id
) dr on true
left join lateral (
  select count(*) as service_count
    from items i
    join clinics x on x.id = i.default_clinic_id
   where x.department_id = d.id and not i.is_archived
) it on true;

alter view v_department_summary set (security_invoker = on);
revoke all on v_department_summary from anon;
grant select on v_department_summary to authenticated;

create or replace view v_clinic_summary as
select
  c.id,
  c.organization_id,
  c.branch_id,
  b.name              as branch_name,
  c.department_id,
  d.name_ar           as department_name,
  c.parent_clinic_id,
  c.code,
  c.name              as name_ar,
  c.name_en,
  c.clinic_type,
  c.specialty_value_id,
  sp.name_ar          as specialty_name,
  c.phone_extension,
  c.floor,
  c.room_number,
  c.default_visit_duration,
  c.allows_walk_in,
  c.allows_online_booking,
  c.capacity,
  c.color,
  c.sort_order,
  c.is_disabled,
  coalesce(dr.doctor_count, 0)   as doctor_count,
  coalesce(it.service_count, 0)  as service_count,
  coalesce(rs.resource_count, 0) as resource_count,
  app_clinic_future_appointments(c.id) as future_appointment_count,
  c.created_at,
  c.updated_at
from clinics c
left join branches b on b.id = c.branch_id
left join departments d on d.id = c.department_id
left join lookup_values sp on sp.id = c.specialty_value_id
left join lateral (
  select count(*) as doctor_count from doctors x where x.clinic_id = c.id and x.is_enabled
) dr on true
left join lateral (
  select count(*) as service_count from items i
   where i.default_clinic_id = c.id and not i.is_archived
) it on true
left join lateral (
  select count(*) as resource_count from resources r where r.clinic_id = c.id and r.is_active
) rs on true;

alter view v_clinic_summary set (security_invoker = on);
revoke all on v_clinic_summary from anon;
grant select on v_clinic_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 8) حفظ القسم والعيادة في معاملة واحدة
-- ---------------------------------------------------------------------------
create or replace function app_save_department(
  p_organization_id uuid,
  p_department_id   uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_name text;
begin
  if not app_has_permission(p_organization_id, 'structure.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأقسام';
  end if;

  -- دمج المُمرَّر فوق القائم: مفتاحٌ غائب يعني «لا تغيّره» لا «امحُه».
  if p_department_id is not null then
    select to_jsonb(d) || p_payload into p_payload
      from departments d where d.id = p_department_id and d.organization_id = p_organization_id;
    if p_payload is null then
      raise exception 'القسم غير موجود في هذه المنشأة';
    end if;
  end if;


  v_name := btrim(coalesce(p_payload ->> 'name_ar', ''));
  if v_name = '' then
    raise exception 'اسم القسم مطلوب';
  end if;

  if p_department_id is null then
    insert into departments (organization_id, code, name_ar, name_en,
                             description_ar, description_en, department_type,
                             parent_department_id, manager_user_id, is_clinical,
                             is_active, sort_order, created_by, updated_by)
    values (p_organization_id,
            nullif(btrim(coalesce(p_payload ->> 'code', '')), ''),
            v_name,
            nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'description_en', '')), ''),
            coalesce(nullif(p_payload ->> 'department_type', ''), 'clinical'),
            nullif(p_payload ->> 'parent_department_id', '')::uuid,
            nullif(p_payload ->> 'manager_user_id', '')::uuid,
            coalesce((p_payload ->> 'is_clinical')::boolean, true),
            coalesce((p_payload ->> 'is_active')::boolean, true),
            coalesce(nullif(p_payload ->> 'sort_order', '')::int, 0),
            auth.uid(), auth.uid())
    returning id into v_id;
  else
    update departments set
      code = nullif(btrim(coalesce(p_payload ->> 'code', '')), ''),
      name_ar = v_name,
      name_en = nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      description_ar = nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), ''),
      description_en = nullif(btrim(coalesce(p_payload ->> 'description_en', '')), ''),
      department_type = coalesce(nullif(p_payload ->> 'department_type', ''), department_type),
      parent_department_id = nullif(p_payload ->> 'parent_department_id', '')::uuid,
      manager_user_id = nullif(p_payload ->> 'manager_user_id', '')::uuid,
      is_clinical = coalesce((p_payload ->> 'is_clinical')::boolean, is_clinical),
      is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::int, sort_order),
      updated_at = now(), updated_by = auth.uid()
    where id = p_department_id and organization_id = p_organization_id
    returning id into v_id;

    if v_id is null then
      raise exception 'القسم غير موجود في هذه المنشأة';
    end if;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'structure',
          case when p_department_id is null then 'add' else 'update' end,
          v_id, v_name, 'قسم');

  return v_id;
end;
$$;

create or replace function app_save_clinic(
  p_organization_id uuid,
  p_clinic_id       uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_name   text;
  v_code   text;
  v_branch uuid;
  v_dept   uuid;
begin
  if not app_has_permission(p_organization_id, 'structure.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة العيادات';
  end if;

  -- دمج المُمرَّر فوق القائم: مفتاحٌ غائب يعني «لا تغيّره» لا «امحُه».
  if p_clinic_id is not null then
    select to_jsonb(c) || p_payload into p_payload
      from clinics c where c.id = p_clinic_id and c.organization_id = p_organization_id;
    if p_payload is null then
      raise exception 'العيادة غير موجودة في هذه المنشأة';
    end if;
  end if;


  v_name := btrim(coalesce(p_payload ->> 'name', p_payload ->> 'name_ar', ''));
  if v_name = '' then
    raise exception 'اسم العيادة مطلوب';
  end if;

  v_code := nullif(btrim(coalesce(p_payload ->> 'code', '')), '');
  if v_code is null then
    raise exception 'كود العيادة مطلوب';
  end if;

  v_branch := nullif(p_payload ->> 'branch_id', '')::uuid;
  v_dept   := nullif(p_payload ->> 'department_id', '')::uuid;

  -- اللون يُفحص هنا كي تصل رسالة عربية بدل نصّ القيد الإنجليزي.
  if nullif(btrim(coalesce(p_payload ->> 'color', '')), '') is not null
     and (p_payload ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'اللون يجب أن يكون بصيغة #RRGGBB';
  end if;

  -- الفحص هنا لا في القيد وحده: رسالة القيد بالإنجليزية ولا يفهمها المستخدم.
  if v_branch is not null and not exists (
       select 1 from branches where id = v_branch and organization_id = p_organization_id) then
    raise exception 'الفرع لا ينتمي لهذه المنشأة';
  end if;
  if v_dept is not null and not exists (
       select 1 from departments where id = v_dept and organization_id = p_organization_id) then
    raise exception 'القسم لا ينتمي لهذه المنشأة';
  end if;

  if p_clinic_id is null then
    insert into clinics (organization_id, branch_id, department_id, parent_clinic_id,
                         code, name, name_en, clinic_type, specialty_value_id,
                         phone_extension, floor, room_number, default_visit_duration,
                         allows_walk_in, allows_online_booking, capacity, color,
                         sort_order, is_disabled, created_by, updated_by)
    values (p_organization_id, v_branch, v_dept,
            nullif(p_payload ->> 'parent_clinic_id', '')::uuid,
            v_code, v_name,
            nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
            nullif(p_payload ->> 'clinic_type', ''),
            nullif(p_payload ->> 'specialty_value_id', '')::uuid,
            nullif(btrim(coalesce(p_payload ->> 'phone_extension', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'floor', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'room_number', '')), ''),
            nullif(p_payload ->> 'default_visit_duration', '')::int,
            coalesce((p_payload ->> 'allows_walk_in')::boolean, true),
            coalesce((p_payload ->> 'allows_online_booking')::boolean, false),
            nullif(p_payload ->> 'capacity', '')::int,
            nullif(btrim(coalesce(p_payload ->> 'color', '')), ''),
            coalesce(nullif(p_payload ->> 'sort_order', '')::int, 0),
            coalesce((p_payload ->> 'is_disabled')::boolean, false),
            auth.uid(), auth.uid())
    returning id into v_id;
  else
    -- التعطيل لا يمرّ من هنا: له `app_disable_clinic` بسببه وحارسه.
    update clinics set
      branch_id = v_branch,
      department_id = v_dept,
      parent_clinic_id = nullif(p_payload ->> 'parent_clinic_id', '')::uuid,
      code = v_code,
      name = v_name,
      name_en = nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      clinic_type = nullif(p_payload ->> 'clinic_type', ''),
      specialty_value_id = nullif(p_payload ->> 'specialty_value_id', '')::uuid,
      phone_extension = nullif(btrim(coalesce(p_payload ->> 'phone_extension', '')), ''),
      floor = nullif(btrim(coalesce(p_payload ->> 'floor', '')), ''),
      room_number = nullif(btrim(coalesce(p_payload ->> 'room_number', '')), ''),
      default_visit_duration = nullif(p_payload ->> 'default_visit_duration', '')::int,
      allows_walk_in = coalesce((p_payload ->> 'allows_walk_in')::boolean, allows_walk_in),
      allows_online_booking = coalesce((p_payload ->> 'allows_online_booking')::boolean, allows_online_booking),
      capacity = nullif(p_payload ->> 'capacity', '')::int,
      color = nullif(btrim(coalesce(p_payload ->> 'color', '')), ''),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::int, sort_order),
      updated_at = now(), updated_by = auth.uid()
    where id = p_clinic_id and organization_id = p_organization_id
    returning id into v_id;

    if v_id is null then
      raise exception 'العيادة غير موجودة في هذه المنشأة';
    end if;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'structure',
          case when p_clinic_id is null then 'add' else 'update' end,
          v_id, v_name, 'عيادة');

  return v_id;
end;
$$;

revoke all on function app_save_department(uuid, uuid, jsonb) from public, anon;
revoke all on function app_save_clinic(uuid, uuid, jsonb) from public, anon;
grant execute on function app_save_department(uuid, uuid, jsonb) to authenticated;
grant execute on function app_save_clinic(uuid, uuid, jsonb) to authenticated;

commit;
