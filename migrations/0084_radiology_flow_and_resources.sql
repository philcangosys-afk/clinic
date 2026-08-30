-- 0084_radiology_flow_and_resources.sql
-- المرحلة الرابعة: الأشعة — إعداد الفحص، حجز الأجهزة بلا تداخل، دورة الطلب
-- التسع، والتقرير واعتماده.
--
-- البنية نفسها المتّبعة في المختبر (0083): `radiology_exams` امتدادٌ سريري
-- لخدمة مالية في `items`، لا كتالوج ثانٍ. و`billing_item_id` يصير إلزاميًا
-- هنا أيضًا.
--
-- الجديد الذي لا مقابل له في المختبر: **حجز الأجهزة**. جهاز الرنين واحد،
-- وموعدان عليه في وقت واحد يعني مريضًا انتظر ساعةً ثم عاد. ولا يوجد في
-- المخطط ما يمنع ذلك اليوم.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) إعداد فحص الأشعة
--
-- الصيام والتحضير يبقيان على `items` (0073) حيث يقرؤهما فحص الملاءمة.
-- `preparation_instructions` القائم على `radiology_exams` يبقى للتعليمات
-- الفنية للفنّي، لا لتحضير المريض — وهذا فرق حقيقي لا تكرار.
-- ---------------------------------------------------------------------------
alter table radiology_exams
  add column if not exists laterality_required     boolean not null default false,
  add column if not exists pregnancy_check_required boolean not null default false,
  add column if not exists contrast_type           text,
  add column if not exists radiation_dose_msv      numeric(8,3),
  add column if not exists report_template_id      uuid,
  add column if not exists department_id           uuid references departments(id) on delete set null,
  add column if not exists requires_approval       boolean not null default false,
  add column if not exists sort_order              integer not null default 0,
  add column if not exists created_by              uuid references auth.users(id),
  add column if not exists updated_at              timestamptz not null default now(),
  add column if not exists updated_by              uuid references auth.users(id);

comment on column radiology_exams.preparation_instructions is
  'تعليمات فنية لمنفّذ الفحص. تحضير المريض على items.preparation_ar.';
comment on column radiology_exams.pregnancy_check_required is
  'يُسأل عن الحمل قبل التنفيذ. الأشعة السينية والمقطعية تُشعّع الجنين.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radiology_exams_item_tenant_fk') then
    alter table radiology_exams add constraint radiology_exams_item_tenant_fk
      foreign key (organization_id, billing_item_id) references items (organization_id, id) not valid;
  end if;
end $$;

-- الأشعة السينية والمقطعية تُشعّع: فحص الحمل مطلوب فيها افتراضيًا.
update radiology_exams
   set pregnancy_check_required = true
 where modality in ('xray','ct','fluoroscopy','mammography')
   and not pregnancy_check_required;

-- ---------------------------------------------------------------------------
-- 2) حجز الموارد — جدولٌ عامّ لا خاصّ بالأشعة
--
-- الغرفة والجهاز والسرير كلها `resources` (0073). فجدول الحجز واحد يخدمها
-- جميعًا، لا جدول لكل نوع: «حجز جهاز أشعة» و«حجز غرفة عمليات» مسألة واحدة.
-- ---------------------------------------------------------------------------
create table if not exists resource_bookings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  resource_id     uuid not null references resources(id) on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  booking_type    text not null default 'appointment',
  appointment_id  uuid references appointments(id) on delete cascade,
  radiology_order_id uuid references radiology_orders(id) on delete cascade,
  patient_id      uuid references patients(id) on delete set null,
  note            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint resource_bookings_time_check check (ends_at > starts_at),
  constraint resource_bookings_type_check check (
    booking_type in ('appointment','radiology','procedure','maintenance','blocked')
  )
);

create index if not exists idx_resource_bookings_resource
  on resource_bookings (resource_id, starts_at);

-- **منع التداخل في القاعدة لا في الواجهة.**
--
-- `exclude` مع `gist` يمنعه على مستوى المحرّك، فلا يفلت ولو تزامن طلبان —
-- وهو ما لا يضمنه أي فحص `select` قبل `insert`، لأن بين القراءة والكتابة
-- فجوةً تكفي.
create extension if not exists btree_gist;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resource_bookings_no_overlap') then
    alter table resource_bookings add constraint resource_bookings_no_overlap
      exclude using gist (
        resource_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      );
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('resource_bookings', 'resource_bookings_resource_tenant_fk', 'resource_id', 'resources'),
      ('resource_bookings', 'resource_bookings_patient_tenant_fk',  'patient_id',  'patients')
    ) as v(tbl, conname, col, ref)
  loop
    if not exists (select 1 from pg_constraint where conname = r.conname) then
      execute format(
        'alter table %I add constraint %I foreign key (organization_id, %I) references %I (organization_id, id) not valid',
        r.tbl, r.conname, r.col, r.ref);
    end if;
  end loop;
end $$;

create or replace function app_book_resource(
  p_resource_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_type        text default 'radiology',
  p_appointment_id uuid default null,
  p_radiology_order_id uuid default null,
  p_patient_id  uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_id   uuid;
  v_name text;
begin
  select organization_id, name_ar into v_org, v_name from resources where id = p_resource_id;
  if v_org is null then
    raise exception 'المورد غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا صلاحية';
  end if;
  if not (select is_active from resources where id = p_resource_id) then
    raise exception 'المورد «%» معطَّل', v_name;
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'نهاية الحجز يجب أن تكون بعد بدايته';
  end if;

  begin
    insert into resource_bookings (organization_id, resource_id, starts_at, ends_at,
                                   booking_type, appointment_id, radiology_order_id,
                                   patient_id, note, created_by)
    values (v_org, p_resource_id, p_starts_at, p_ends_at, p_type,
            p_appointment_id, p_radiology_order_id, p_patient_id,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    -- رسالة القيد إنجليزية ولا تقول أي حجزٍ تعارض معه.
    raise exception 'المورد «%» محجوز في هذا الوقت', v_name;
  end;

  return v_id;
end;
$$;

revoke all on function app_book_resource(uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function app_book_resource(uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text) to authenticated;

create or replace function app_resource_free_at(
  p_resource_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from resource_bookings b
     where b.resource_id = p_resource_id
       and app_is_member(b.organization_id)
       and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  );
$$;

revoke all on function app_resource_free_at(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app_resource_free_at(uuid, timestamptz, timestamptz) to authenticated;

alter table resource_bookings enable row level security;
drop policy if exists resource_bookings_select on resource_bookings;
create policy resource_bookings_select on resource_bookings for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists resource_bookings_write on resource_bookings;
create policy resource_bookings_write on resource_bookings for all to authenticated
  using (app_is_member(organization_id))
  with check (app_is_member(organization_id));
revoke all on resource_bookings from anon;
grant select, insert, update, delete on resource_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- 3) دورة حياة طلب الأشعة
--
--   مسودة → مطلوب → مجدول → حضر → قيد التنفيذ → الصور جاهزة
--        → قيد التقرير → مراجَع → مسلَّم
--
-- الحالتان القديمتان: `completed` → `images_ready`، و`reported` → `reporting`.
-- «مكتمل» بعد التصوير ليس اكتمالًا: التقرير لم يُكتب بعد.
-- ---------------------------------------------------------------------------
alter table radiology_orders
  add column if not exists branch_id        uuid references branches(id) on delete set null,
  add column if not exists resource_id      uuid references resources(id) on delete set null,
  add column if not exists booking_id       uuid references resource_bookings(id) on delete set null,
  add column if not exists laterality       text,
  add column if not exists pregnancy_confirmed_not boolean,
  add column if not exists pregnancy_checked_by uuid references auth.users(id),
  add column if not exists contrast_used    boolean not null default false,
  add column if not exists arrived_at       timestamptz,
  add column if not exists started_at       timestamptz,
  add column if not exists images_ready_at  timestamptz,
  add column if not exists verified_at      timestamptz,
  add column if not exists verified_by      uuid references auth.users(id),
  add column if not exists delivered_at     timestamptz,
  add column if not exists delivered_by     uuid references auth.users(id),
  add column if not exists performed_by     uuid references auth.users(id),
  add column if not exists cancel_reason    text,
  add column if not exists rejection_reason text,
  add column if not exists updated_at       timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radiology_orders_laterality_check') then
    alter table radiology_orders add constraint radiology_orders_laterality_check
      check (laterality is null or laterality in ('left','right','bilateral','not_applicable'));
  end if;
end $$;

-- إسقاط القيد ← ترحيل البيانات ← تركيب القيد الجديد. القيد القائم لا يعرف
-- `images_ready` ولا `reporting`، فالترحيل قبل إسقاطه يفشل على أيّ قاعدة
-- فيها طلبات أشعة قديمة.
alter table radiology_orders drop constraint if exists radiology_orders_status_check;

update radiology_orders set status = 'images_ready' where status = 'completed';
update radiology_orders set status = 'reporting'    where status = 'reported';

do $$
begin
  alter table radiology_orders add constraint radiology_orders_status_check check (
    status in ('draft','ordered','scheduled','arrived','in_progress','images_ready',
               'reporting','verified','delivered','rejected','cancelled')
  );
end $$;

create or replace function app_radiology_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'        then p_to in ('ordered','cancelled')
    when 'ordered'      then p_to in ('scheduled','arrived','rejected','cancelled')
    when 'scheduled'    then p_to in ('arrived','ordered','rejected','cancelled')
    when 'arrived'      then p_to in ('in_progress','rejected','cancelled')
    when 'in_progress'  then p_to in ('images_ready','rejected','cancelled')
    when 'images_ready' then p_to in ('reporting','in_progress')
    when 'reporting'    then p_to in ('verified','images_ready')
    when 'verified'     then p_to in ('delivered','reporting')
    else false   -- delivered و rejected و cancelled نهائية
  end;
$$;

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('rad.view',    'عرض الأشعة',           'radiology', 870),
  ('rad.schedule','جدولة فحوص الأشعة',    'radiology', 872),
  ('rad.perform', 'تنفيذ فحوص الأشعة',    'radiology', 874),
  ('rad.report',  'كتابة تقارير الأشعة',  'radiology', 876),
  ('rad.verify',  'اعتماد تقارير الأشعة', 'radiology', 878),
  ('rad.manage',  'إدارة كتالوج الأشعة',  'radiology', 880)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('radiology_technician', 'rad.view'), ('radiology_technician', 'rad.schedule'),
  ('radiology_technician', 'rad.perform'),
  ('branch_manager', 'rad.view'), ('branch_manager', 'rad.manage'), ('branch_manager', 'rad.schedule'),
  ('doctor',       'rad.view'), ('doctor', 'rad.report'), ('doctor', 'rad.verify'),
  ('nurse',        'rad.view'),
  ('receptionist', 'rad.view'), ('receptionist', 'rad.schedule')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ---------------------------------------------------------------------------
-- 4) الانتقال — مع فحص الحمل وحجز الجهاز
-- ---------------------------------------------------------------------------
create or replace function app_set_radiology_order_status(
  p_order_id uuid,
  p_status   text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order radiology_orders%rowtype;
  v_perm  text;
  v_needs_pregnancy boolean;
  v_gender text;
  v_open  int;
begin
  select * into v_order from radiology_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'الطلب غير موجود';
  end if;
  if not app_is_member(v_order.organization_id) then
    raise exception 'لا صلاحية';
  end if;
  if v_order.status = p_status then
    return;
  end if;
  if not app_radiology_status_allowed(v_order.status, p_status) then
    raise exception 'لا يمكن الانتقال من «%» إلى «%»', v_order.status, p_status;
  end if;

  v_perm := case p_status
    when 'scheduled'    then 'rad.schedule'
    when 'arrived'      then 'rad.schedule'
    when 'in_progress'  then 'rad.perform'
    when 'images_ready' then 'rad.perform'
    when 'reporting'    then 'rad.report'
    when 'verified'     then 'rad.verify'
    when 'delivered'    then 'rad.view'
    when 'rejected'     then 'rad.perform'
    else 'rad.view'
  end;

  if not app_has_permission(v_order.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء (%)', v_perm;
  end if;

  if p_status in ('rejected','cancelled') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'هذا الإجراء يحتاج سببًا مكتوبًا';
  end if;

  -- فحص الحمل قبل بدء التنفيذ لا قبله ولا بعده: قبل الحضور لا معنى للسؤال،
  -- وبعد التصوير فات الأوان.
  if p_status = 'in_progress' then
    select bool_or(e.pregnancy_check_required) into v_needs_pregnancy
      from radiology_order_items i
      join radiology_exams e on e.id = i.radiology_exam_id
     where i.radiology_order_id = p_order_id;

    if coalesce(v_needs_pregnancy, false) then
      select gender into v_gender from patients where id = v_order.patient_id;
      if v_gender = 'female' and v_order.pregnancy_confirmed_not is not true then
        raise exception 'هذا الفحص يُشعّع — سجّل نفي الحمل قبل البدء';
      end if;
    end if;
  end if;

  -- لا تقرير بلا انطباع مكتوب
  if p_status = 'verified' then
    select count(*) into v_open from radiology_order_items
     where radiology_order_id = p_order_id
       and (impression is null or btrim(impression) = '');
    if v_open > 0 then
      raise exception 'بقي % فحصًا بلا انطباع مكتوب', v_open;
    end if;
  end if;

  update radiology_orders set
    status = p_status,
    updated_at = now(),
    arrived_at      = case when p_status = 'arrived'      then now() else arrived_at end,
    started_at      = case when p_status = 'in_progress'  then now() else started_at end,
    performed_by    = case when p_status = 'in_progress'  then auth.uid() else performed_by end,
    images_ready_at = case when p_status = 'images_ready' then now() else images_ready_at end,
    completed_at    = case when p_status = 'images_ready' then now() else completed_at end,
    reported_at     = case when p_status = 'reporting'    then now() else reported_at end,
    reported_by     = case when p_status = 'reporting'    then auth.uid() else reported_by end,
    verified_at     = case when p_status = 'verified'     then now() else verified_at end,
    verified_by     = case when p_status = 'verified'     then auth.uid() else verified_by end,
    delivered_at    = case when p_status = 'delivered'    then now() else delivered_at end,
    delivered_by    = case when p_status = 'delivered'    then auth.uid() else delivered_by end,
    rejection_reason = case when p_status = 'rejected'  then btrim(p_reason) else rejection_reason end,
    cancel_reason    = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end
  where id = p_order_id;

  -- الإلغاء يحرّر الجهاز: حجزٌ يبقى بعد إلغاء الطلب يمنع مريضًا آخر بلا سبب.
  if p_status in ('cancelled','rejected') and v_order.booking_id is not null then
    delete from resource_bookings where id = v_order.booking_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_order.organization_id, auth.uid(), 'radiology', 'update', p_order_id,
          'طلب أشعة', format('%s ← %s', v_order.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function app_set_radiology_order_status(uuid, text, text) from public, anon;
grant execute on function app_set_radiology_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) جدولة الطلب على جهاز — الحجز والانتقال في معاملة واحدة
-- ---------------------------------------------------------------------------
create or replace function app_schedule_radiology_order(
  p_order_id    uuid,
  p_resource_id uuid,
  p_starts_at   timestamptz,
  p_duration    int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order    radiology_orders%rowtype;
  v_minutes  int;
  v_booking  uuid;
begin
  select * into v_order from radiology_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'الطلب غير موجود';
  end if;
  if not app_has_permission(v_order.organization_id, 'rad.schedule') then
    raise exception 'صلاحيتك لا تسمح بجدولة الأشعة';
  end if;

  -- المدة من الفحص نفسه إن لم تُمرَّر
  select coalesce(p_duration, max(e.estimated_duration_minutes), 30) into v_minutes
    from radiology_order_items i
    join radiology_exams e on e.id = i.radiology_exam_id
   where i.radiology_order_id = p_order_id;

  -- حجزٌ سابق لهذا الطلب يُلغى: إعادة الجدولة تنقل الموعد لا تضيف ثانيًا.
  if v_order.booking_id is not null then
    delete from resource_bookings where id = v_order.booking_id;
  end if;

  v_booking := app_book_resource(
    p_resource_id, p_starts_at, p_starts_at + make_interval(mins => v_minutes),
    'radiology', null, p_order_id, v_order.patient_id, null);

  update radiology_orders
     set resource_id = p_resource_id,
         booking_id = v_booking,
         scheduled_at = p_starts_at,
         status = case when status in ('draft','ordered') then 'scheduled' else status end,
         updated_at = now()
   where id = p_order_id;

  return v_booking;
end;
$$;

revoke all on function app_schedule_radiology_order(uuid, uuid, timestamptz, int) from public, anon;
grant execute on function app_schedule_radiology_order(uuid, uuid, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) إنشاء فحص أشعة مع خدمته المالية
-- ---------------------------------------------------------------------------
create or replace function app_save_radiology_exam(
  p_organization_id uuid,
  p_exam_id         uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_item     uuid;
  v_name     text;
  v_code     text;
  v_modality text;
  v_preg     boolean;
begin
  if not app_has_permission(p_organization_id, 'rad.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة كتالوج الأشعة';
  end if;

  if p_exam_id is not null then
    select to_jsonb(e) || p_payload into p_payload
      from radiology_exams e where e.id = p_exam_id and e.organization_id = p_organization_id;
    if p_payload is null then
      raise exception 'الفحص غير موجود في هذه المنشأة';
    end if;
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name_ar', ''));
  if v_name = '' then raise exception 'اسم الفحص مطلوب'; end if;
  v_code := nullif(btrim(coalesce(p_payload ->> 'code', '')), '');
  if v_code is null then raise exception 'كود الفحص مطلوب'; end if;

  -- **اشتراط فحص الحمل يُشتقّ من نوع الجهاز حين لا يُصرَّح به.**
  --
  -- تركُه افتراضيًا `false` يعني أن حمايةً من التشعيع تعتمد على أن يتذكّر
  -- أحدهم تعليم خانة. الأجهزة المشعّة تشترطه تلقائيًا، ومن أراد رفعه يرفعه
  -- صراحةً.
  v_modality := coalesce(nullif(p_payload ->> 'modality', ''), 'other');
  if p_payload ? 'pregnancy_check_required' then
    v_preg := (p_payload ->> 'pregnancy_check_required')::boolean;
  else
    v_preg := v_modality in ('xray','ct','fluoroscopy','mammography');
  end if;

  v_item := nullif(p_payload ->> 'billing_item_id', '')::uuid;
  if v_item is null then
    v_item := app_save_service(p_organization_id, null, jsonb_build_object(
      'name_ar', v_name,
      'name_en', p_payload ->> 'name_en',
      'code', 'RAD-' || v_code,
      'item_type', 'service',
      'medical_service_type', 'radiology',
      'price', coalesce(p_payload ->> 'price', '0'),
      'duration_minutes', p_payload ->> 'estimated_duration_minutes',
      'preparation_ar', p_payload ->> 'patient_preparation_ar'
    ));
  else
    if not exists (select 1 from items i
                    where i.id = v_item and i.organization_id = p_organization_id
                      and i.medical_service_type = 'radiology') then
      raise exception 'الخدمة المرتبطة يجب أن تكون من نوع «أشعة»';
    end if;
  end if;

  if p_exam_id is null then
    insert into radiology_exams (organization_id, billing_item_id, category_id, code,
                                 name_ar, name_en, modality, body_part, requires_contrast,
                                 contrast_type, laterality_required, pregnancy_check_required,
                                 radiation_dose_msv, preparation_instructions,
                                 estimated_duration_minutes, department_id, requires_approval,
                                 sort_order, is_active, created_by, updated_by)
    values (p_organization_id, v_item,
            nullif(p_payload ->> 'category_id', '')::uuid, v_code, v_name,
            nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
            v_modality,
            nullif(p_payload ->> 'body_part', ''),
            coalesce((p_payload ->> 'requires_contrast')::boolean, false),
            nullif(p_payload ->> 'contrast_type', ''),
            coalesce((p_payload ->> 'laterality_required')::boolean, false),
            v_preg,
            nullif(p_payload ->> 'radiation_dose_msv', '')::numeric,
            nullif(p_payload ->> 'preparation_instructions', ''),
            nullif(p_payload ->> 'estimated_duration_minutes', '')::int,
            nullif(p_payload ->> 'department_id', '')::uuid,
            coalesce((p_payload ->> 'requires_approval')::boolean, false),
            coalesce(nullif(p_payload ->> 'sort_order', '')::int, 0),
            coalesce((p_payload ->> 'is_active')::boolean, true),
            auth.uid(), auth.uid())
    returning id into v_id;
  else
    update radiology_exams set
      billing_item_id = v_item,
      category_id = nullif(p_payload ->> 'category_id', '')::uuid,
      code = v_code, name_ar = v_name,
      name_en = nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      modality = v_modality,
      body_part = nullif(p_payload ->> 'body_part', ''),
      requires_contrast = coalesce((p_payload ->> 'requires_contrast')::boolean, requires_contrast),
      contrast_type = nullif(p_payload ->> 'contrast_type', ''),
      laterality_required = coalesce((p_payload ->> 'laterality_required')::boolean, laterality_required),
      pregnancy_check_required = v_preg,
      radiation_dose_msv = nullif(p_payload ->> 'radiation_dose_msv', '')::numeric,
      preparation_instructions = nullif(p_payload ->> 'preparation_instructions', ''),
      estimated_duration_minutes = nullif(p_payload ->> 'estimated_duration_minutes', '')::int,
      department_id = nullif(p_payload ->> 'department_id', '')::uuid,
      requires_approval = coalesce((p_payload ->> 'requires_approval')::boolean, requires_approval),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::int, sort_order),
      is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
      updated_at = now(), updated_by = auth.uid()
    where id = p_exam_id and organization_id = p_organization_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function app_save_radiology_exam(uuid, uuid, jsonb) from public, anon;
grant execute on function app_save_radiology_exam(uuid, uuid, jsonb) to authenticated;

do $$
declare v_missing int;
begin
  select count(*) into v_missing from radiology_exams where billing_item_id is null;
  if v_missing > 0 then
    raise notice 'يوجد % فحص أشعة بلا خدمة مالية — أنشئ لها خدمات ثم شغّل: alter table radiology_exams alter column billing_item_id set not null;', v_missing;
  else
    alter table radiology_exams alter column billing_item_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) RLS
-- ---------------------------------------------------------------------------
drop policy if exists radiology_exams_all_members on radiology_exams;
drop policy if exists radiology_exams_select on radiology_exams;
create policy radiology_exams_select on radiology_exams for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists radiology_exams_write on radiology_exams;
create policy radiology_exams_write on radiology_exams for all to authenticated
  using (app_has_permission(organization_id, 'rad.manage'))
  with check (app_has_permission(organization_id, 'rad.manage'));

-- ---------------------------------------------------------------------------
-- 8) المناظير
-- ---------------------------------------------------------------------------
create or replace view v_radiology_worklist as
select
  o.id,
  o.organization_id,
  o.branch_id,
  o.patient_id,
  p.name_ar   as patient_name,
  p.file_number,
  p.gender,
  o.ordering_doctor_id,
  d.name_ar   as doctor_name,
  o.visit_id,
  o.clinic_id,
  o.status,
  o.priority,
  o.clinical_indication,
  o.laterality,
  o.contrast_used,
  o.pregnancy_confirmed_not,
  o.resource_id,
  r.name_ar   as resource_name,
  o.scheduled_at,
  o.ordered_at,
  o.arrived_at,
  o.started_at,
  o.images_ready_at,
  o.reported_at,
  o.verified_at,
  o.delivered_at,
  o.sales_invoice_id,
  (select count(*) from radiology_order_items i where i.radiology_order_id = o.id) as exam_count,
  (select count(*) from radiology_order_items i
    where i.radiology_order_id = o.id
      and (i.impression is null or btrim(i.impression) = ''))                      as pending_reports,
  (select bool_or(i.is_urgent_finding) from radiology_order_items i
    where i.radiology_order_id = o.id)                                             as has_urgent_finding
from radiology_orders o
join patients p on p.id = o.patient_id
left join doctors d on d.id = o.ordering_doctor_id
left join resources r on r.id = o.resource_id;

alter view v_radiology_worklist set (security_invoker = on);
revoke all on v_radiology_worklist from anon;
grant select on v_radiology_worklist to authenticated;

-- جدول الأجهزة: ما المحجوز على كل مورد
create or replace view v_resource_schedule as
select
  b.id,
  b.organization_id,
  b.resource_id,
  r.name_ar        as resource_name,
  r.resource_type,
  r.branch_id,
  b.starts_at,
  b.ends_at,
  b.booking_type,
  b.patient_id,
  p.name_ar        as patient_name,
  b.radiology_order_id,
  b.appointment_id,
  b.note
from resource_bookings b
join resources r on r.id = b.resource_id
left join patients p on p.id = b.patient_id;

alter view v_resource_schedule set (security_invoker = on);
revoke all on v_resource_schedule from anon;
grant select on v_resource_schedule to authenticated;

commit;
