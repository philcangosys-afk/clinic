-- 0083_laboratory_catalog_and_flow.sql
-- المرحلة الثالثة: المختبر — إعداد الفحص ومكوّناته وقيمه المرجعية، ودورة
-- الطلب التسع، وتاريخ تعديل النتائج.
--
-- ---------------------------------------------------------------------------
-- قرارٌ يخالف حرفية المواصفة، وأشرحه لأنه الأهمّ في هذا الملف
-- ---------------------------------------------------------------------------
--
-- المواصفة تقول: «لا تبنِ كتالوجًا منفصلًا يعيد إنشاء الخدمات؛ فحص المختبر
-- يجب أن يكون سجلًا في `items`».
--
-- والواقع أن `lab_tests` **قائم منذ 0013**، ويحمل عمود `billing_item_id`
-- يربط كل فحص بخدمته المالية في `items`. أي أن الكتالوج المالي واحد أصلًا،
-- و`lab_tests` ليس نسخةً منه بل **امتدادٌ سريري** لما لا يستطيع `items`
-- حمله: نوع العينة وحاويتها وحجمها، ومكوّنات الفحص المركّب، والقيم المرجعية
-- المختلفة بالعمر والجنس والحمل.
--
-- ودمجُهما الآن — أي نقل كل ذلك إلى `items` وحذف `lab_tests` — يكسر سير
-- الطلبات القائم (`lab_order_items.lab_test_id`) وكل شاشة مختبر. وهو بالضبط
-- ما حذّرتَ منه بنفسك حين قلت: «الأفضل إبقاء كتالوج المختبر والأشعة
-- متخصصًا ومربوطًا بالخدمة المالية بدل دمجهما الآن».
--
-- فالتنفيذ هنا يحقّق **جوهر** المطلب لا حرفيته: كتالوج مالي واحد لا اثنان.
-- ويشدّه هذا الملف بثلاثة قيود:
--
--   1) `billing_item_id` يصير **إلزاميًا**: لا فحص مختبر بلا خدمة مالية.
--   2) الخدمة المرتبطة يجب أن تكون `medical_service_type = 'laboratory'`.
--   3) `app_save_lab_test` تُنشئ الاثنين معًا في معاملة واحدة، فلا يستطيع
--      أحد إنشاء فحص بلا خدمة ولو حاول.
--
-- إن أردت الدمج الكامل رغم ذلك، قل لي وأنفّذه في هجرة مستقلة مع نقل
-- البيانات — لكنه يستحقّ مرحلةً خاصة به لا بندًا داخل مرحلة.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 0) تصحيح قائمة أنواع الخدمة الطبية
--
-- عيبٌ شحنتُه في 0071 وكشفه اختبار هذه المرحلة: قائمة القيد في القاعدة
-- تحتوي `lab` و`home_visit` و`package` و`product`، بينما شاشة الخدمات تعرض
-- `laboratory` و`dressing` و`injection` و`screening`. أي أن اختيار «مختبر»
-- من الشاشة كان **يفشل** برسالة قيد إنجليزية، وأربعة أنواع في القاعدة لا
-- تظهر في أي شاشة.
--
-- التوحيد على قائمة الشاشة، مع ترحيل `lab` القائمة إلى `laboratory`.
-- `package` و`product` تُحذفان: `item_type` يقولهما أصلًا، ونوعُ الخدمة
-- الطبية لصنفٍ ليس خدمةً لا معنى له.
-- ---------------------------------------------------------------------------
-- **الترتيب مقصود**: يُسقَط القيد أوّلًا، ثم تُرحَّل البيانات، ثم يُركَّب
-- القيد الجديد. القيد القائم لا يعرف `laboratory`، فترحيل صفٍّ إليه قبل
-- إسقاطه يفشل بـ«violates check constraint» على قاعدةٍ فيها بيانات فعلية —
-- ولا يظهر إطلاقًا على قاعدة فارغة لأن `update` لا يطابق شيئًا.
alter table items drop constraint if exists items_medical_service_type_check;

update items set medical_service_type = 'laboratory' where medical_service_type = 'lab';
update items set medical_service_type = 'other'
 where medical_service_type in ('package','product');

alter table items add constraint items_medical_service_type_check check (
  medical_service_type is null or medical_service_type in (
    'consultation','follow_up','procedure','surgery','laboratory','radiology',
    'dental','physiotherapy','vaccination','nursing','dressing','injection',
    'screening','home_visit','other'
  )
);

-- ---------------------------------------------------------------------------
-- 1) إعداد الفحص
--
-- ما يخصّ **المريض** (الصيام، التحضير) يبقى على `items` حيث وُضع في 0073
-- ويقرؤه فحص الملاءمة. وما يخصّ **العينة** يُضاف هنا. لا تكرار بينهما.
-- ---------------------------------------------------------------------------
alter table lab_tests
  add column if not exists specimen_container       text,
  add column if not exists specimen_volume_ml       numeric(6,2),
  add column if not exists collection_instructions_ar text,
  add column if not exists collection_instructions_en text,
  add column if not exists external_lab_allowed     boolean not null default false,
  add column if not exists requires_approval        boolean not null default false,
  add column if not exists is_panel                 boolean not null default false,
  add column if not exists department_id            uuid references departments(id) on delete set null,
  add column if not exists loinc_code               text,
  add column if not exists sort_order               integer not null default 0,
  add column if not exists created_by               uuid references auth.users(id),
  add column if not exists updated_at               timestamptz not null default now(),
  add column if not exists updated_by               uuid references auth.users(id);

comment on column lab_tests.turnaround_hours is 'زمن الإنجاز بالساعات. لا يوجد turnaround_minutes — وحدتان لقياس واحد تتناقضان.';
comment on column lab_tests.billing_item_id is 'الخدمة المالية في items. إلزامي — لا فحص بلا خدمة قابلة للفوترة.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lab_tests_volume_check') then
    alter table lab_tests add constraint lab_tests_volume_check
      check (specimen_volume_ml is null or specimen_volume_ml > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_tests_item_tenant_fk') then
    alter table lab_tests add constraint lab_tests_item_tenant_fk
      foreign key (organization_id, billing_item_id) references items (organization_id, id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) مكوّنات الفحص المركّب
--
-- CBC ليس نتيجةً واحدة بل ثلاثة عشر رقمًا. تخزينها نصًّا في خانة واحدة يعني
-- أن لا أحد يستطيع رسم منحنى الهيموغلوبين عبر الزمن.
-- ---------------------------------------------------------------------------
create table if not exists lab_test_components (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lab_test_id     uuid not null references lab_tests(id) on delete cascade,
  component_code  text not null,
  name_ar         text not null,
  name_en         text,
  unit            text,
  data_type       text not null default 'numeric',
  decimal_places  smallint not null default 2,
  loinc_code      text,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint lab_components_type_check check (
    data_type in ('numeric','text','select','boolean','titer')
  ),
  constraint lab_components_decimals_check check (decimal_places between 0 and 6)
);

create unique index if not exists uq_lab_components
  on lab_test_components (lab_test_id, component_code);
create index if not exists idx_lab_components_test on lab_test_components (lab_test_id) where is_active;

-- ---------------------------------------------------------------------------
-- 3) القيم المرجعية
--
-- المدى الطبيعي يختلف بالعمر والجنس والحمل. مدى واحد للجميع يعني تعليم
-- نتيجة طفل «غير طبيعية» لأنها قيست بمرجع بالغ — وهو خطأ سريري لا تجميلي.
--
-- `lab_tests.normal_range_*` القائمة تبقى **قيمةً افتراضية** حين لا يوجد
-- مدى مطابق، ولا تُحذف كي لا تفقد الفحوص القائمة مراجعها.
-- ---------------------------------------------------------------------------
create table if not exists lab_reference_ranges (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  lab_test_id      uuid not null references lab_tests(id) on delete cascade,
  component_id     uuid references lab_test_components(id) on delete cascade,
  gender           text not null default 'any',
  min_age_days     integer,
  max_age_days     integer,
  pregnancy_status text not null default 'any',
  unit             text,
  low_value        numeric(14,4),
  high_value       numeric(14,4),
  critical_low     numeric(14,4),
  critical_high    numeric(14,4),
  text_reference   text,
  note             text,
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  constraint lab_ranges_gender_check check (gender in ('any','male','female')),
  constraint lab_ranges_pregnancy_check check (pregnancy_status in ('any','pregnant','not_pregnant')),
  constraint lab_ranges_age_check
    check (min_age_days is null or max_age_days is null or min_age_days <= max_age_days),
  constraint lab_ranges_value_check
    check (low_value is null or high_value is null or low_value <= high_value),
  -- مدى بلا حدود عددية ولا نصّية لا يفيد شيئًا
  constraint lab_ranges_content_check
    check (low_value is not null or high_value is not null or text_reference is not null)
);

create index if not exists idx_lab_ranges_test on lab_reference_ranges (lab_test_id) where is_active;

comment on column lab_reference_ranges.min_age_days is 'بالأيام لا بالسنوات: مراجع حديثي الولادة تتغيّر خلال أسابيع.';

-- ---------------------------------------------------------------------------
-- 4) دورة حياة الطلب
--
--   مسودة → مطلوب → عينة مسحوبة → مستلمة → قيد التنفيذ → صدرت النتيجة
--        → مراجَعة → معتمدة → مسلَّمة
--   والاستثناءات: مرفوضة، ملغاة، تحتاج إعادة سحب.
--
-- الحالة القائمة `completed` تُهاجَر إلى `resulted`: الاسمان لمعنى واحد،
-- و«مكتمل» يوهم أن الطلب انتهى بينما النتيجة لم تُراجَع بعد.
-- ---------------------------------------------------------------------------
alter table lab_orders
  add column if not exists branch_id        uuid references branches(id) on delete set null,
  add column if not exists received_at      timestamptz,
  add column if not exists collected_by     uuid references auth.users(id),
  add column if not exists received_by      uuid references auth.users(id),
  add column if not exists resulted_at      timestamptz,
  add column if not exists resulted_by      uuid references auth.users(id),
  add column if not exists approved_at      timestamptz,
  add column if not exists approved_by      uuid references auth.users(id),
  add column if not exists delivered_at     timestamptz,
  add column if not exists delivered_by     uuid references auth.users(id),
  add column if not exists rejection_reason text,
  add column if not exists cancel_reason    text,
  add column if not exists external_lab_name text,
  add column if not exists updated_at       timestamptz not null default now();

-- الترتيب نفسه: إسقاط القيد ← ترحيل البيانات ← تركيب القيد الجديد.
alter table lab_orders drop constraint if exists lab_orders_status_check;

update lab_orders set status = 'resulted' where status = 'completed';

do $$
begin
  alter table lab_orders add constraint lab_orders_status_check check (
    status in ('draft','ordered','specimen_collected','received','in_progress',
               'resulted','verified','approved','delivered',
               'rejected','cancelled','recollection_required')
  );
end $$;

-- المشغّل القديم كان ينقل الطلب إلى `completed` تلقائيًا حين تُملأ كل
-- النتائج. يُعاد ربطه بـ`resulted`، ويُترك ما بعدها لقرار بشري: المراجعة
-- والاعتماد فِعلان يوقّعهما مسؤول، لا يستنتجهما النظام.
create or replace function app_lab_order_auto_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_order_id uuid;
  remaining_count int;
begin
  target_order_id := coalesce(new.lab_order_id, old.lab_order_id);

  select count(*) into remaining_count
    from lab_order_items
   where lab_order_id = target_order_id
     and result_value is null and result_numeric is null;

  if remaining_count = 0 then
    update lab_orders
       set status = 'resulted', completed_at = now(), resulted_at = now(),
           resulted_by = coalesce(resulted_by, auth.uid()), updated_at = now()
     where id = target_order_id
       and status in ('ordered','specimen_collected','received','in_progress');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) الانتقالات المسموحة
-- ---------------------------------------------------------------------------
create or replace function app_lab_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'                  then p_to in ('ordered','cancelled')
    when 'ordered'                then p_to in ('specimen_collected','rejected','cancelled')
    when 'specimen_collected'     then p_to in ('received','rejected','recollection_required','cancelled')
    when 'received'               then p_to in ('in_progress','rejected','recollection_required','cancelled')
    when 'in_progress'            then p_to in ('resulted','recollection_required','rejected','cancelled')
    when 'resulted'               then p_to in ('verified','in_progress','recollection_required')
    when 'verified'               then p_to in ('approved','resulted')
    when 'approved'               then p_to in ('delivered')
    when 'recollection_required'  then p_to in ('specimen_collected','cancelled')
    else false   -- delivered و rejected و cancelled نهائية
  end;
$$;

-- الصلاحيات
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('lab.view',      'عرض المختبر',            'laboratory', 850),
  ('lab.collect',   'سحب واستلام العينات',    'laboratory', 852),
  ('lab.result',    'إدخال نتائج المختبر',    'laboratory', 854),
  ('lab.verify',    'مراجعة نتائج المختبر',   'laboratory', 856),
  ('lab.approve',   'اعتماد نتائج المختبر',   'laboratory', 858),
  ('lab.manage',    'إدارة كتالوج المختبر',   'laboratory', 860)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('lab_technician', 'lab.view'), ('lab_technician', 'lab.collect'),
  ('lab_technician', 'lab.result'),
  ('branch_manager', 'lab.view'), ('branch_manager', 'lab.manage'),
  ('branch_manager', 'lab.verify'), ('branch_manager', 'lab.approve'),
  ('doctor',         'lab.view'), ('doctor', 'lab.verify'), ('doctor', 'lab.approve'),
  ('nurse',          'lab.view'), ('nurse', 'lab.collect'),
  ('receptionist',   'lab.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

create or replace function app_set_lab_order_status(
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
  v_order lab_orders%rowtype;
  v_perm  text;
  v_open  int;
begin
  select * into v_order from lab_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'الطلب غير موجود';
  end if;
  if not app_is_member(v_order.organization_id) then
    raise exception 'لا صلاحية';
  end if;
  if v_order.status = p_status then
    return;
  end if;
  if not app_lab_status_allowed(v_order.status, p_status) then
    raise exception 'لا يمكن الانتقال من «%» إلى «%»', v_order.status, p_status;
  end if;

  -- لكل انتقال صلاحيته: من يسحب العينة ليس بالضرورة من يعتمد النتيجة.
  v_perm := case p_status
    when 'specimen_collected'    then 'lab.collect'
    when 'received'              then 'lab.collect'
    when 'recollection_required' then 'lab.result'
    when 'in_progress'           then 'lab.result'
    when 'resulted'              then 'lab.result'
    when 'verified'              then 'lab.verify'
    when 'approved'              then 'lab.approve'
    when 'delivered'             then 'lab.view'
    when 'rejected'              then 'lab.collect'
    else 'lab.view'
  end;

  if not app_has_permission(v_order.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء (%)', v_perm;
  end if;

  if p_status in ('rejected','cancelled','recollection_required')
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'هذا الإجراء يحتاج سببًا مكتوبًا';
  end if;

  -- لا تصدر نتيجة وبعض المكوّنات فارغة
  if p_status = 'resulted' then
    select count(*) into v_open from lab_order_items
     where lab_order_id = p_order_id and result_value is null and result_numeric is null;
    if v_open > 0 then
      raise exception 'بقي % فحصًا بلا نتيجة', v_open;
    end if;
  end if;

  update lab_orders set
    status = p_status,
    updated_at = now(),
    specimen_collected_at = case when p_status = 'specimen_collected' then now() else specimen_collected_at end,
    collected_by  = case when p_status = 'specimen_collected' then auth.uid() else collected_by end,
    received_at   = case when p_status = 'received'  then now() else received_at end,
    received_by   = case when p_status = 'received'  then auth.uid() else received_by end,
    resulted_at   = case when p_status = 'resulted'  then now() else resulted_at end,
    resulted_by   = case when p_status = 'resulted'  then auth.uid() else resulted_by end,
    completed_at  = case when p_status = 'resulted'  then now() else completed_at end,
    verified_at   = case when p_status = 'verified'  then now() else verified_at end,
    verified_by   = case when p_status = 'verified'  then auth.uid() else verified_by end,
    approved_at   = case when p_status = 'approved'  then now() else approved_at end,
    approved_by   = case when p_status = 'approved'  then auth.uid() else approved_by end,
    delivered_at  = case when p_status = 'delivered' then now() else delivered_at end,
    delivered_by  = case when p_status = 'delivered' then auth.uid() else delivered_by end,
    rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else rejection_reason end,
    cancel_reason    = case when p_status in ('cancelled','recollection_required')
                            then btrim(p_reason) else cancel_reason end
  where id = p_order_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_order.organization_id, auth.uid(), 'laboratory', 'update', p_order_id,
          'طلب مختبر', format('%s ← %s', v_order.status, p_status), nullif(btrim(coalesce(p_reason,'')), ''));
end;
$$;

revoke all on function app_set_lab_order_status(uuid, text, text) from public, anon;
grant execute on function app_set_lab_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) تاريخ تعديل النتائج
--
-- نتيجةٌ اعتُمدت ثم تغيّرت بلا أثر هي أخطر ما في نظام مختبر: طبيبٌ عالج
-- على القيمة القديمة، ولا شيء يُثبت أنها كانت كذلك.
-- ---------------------------------------------------------------------------
create table if not exists lab_result_amendments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  lab_order_item_id uuid not null references lab_order_items(id) on delete cascade,
  previous_value    text,
  previous_numeric  numeric(14,4),
  new_value         text,
  new_numeric       numeric(14,4),
  reason            text not null,
  amended_by        uuid references auth.users(id),
  amended_at        timestamptz not null default now()
);

create index if not exists idx_lab_amendments_item on lab_result_amendments (lab_order_item_id);

alter table lab_order_items
  add column if not exists organization_id uuid references organizations(id) on delete cascade,
  add column if not exists component_id    uuid references lab_test_components(id) on delete set null,
  add column if not exists reference_low   numeric(14,4),
  add column if not exists reference_high  numeric(14,4),
  add column if not exists reference_text  text,
  add column if not exists entered_by      uuid references auth.users(id),
  add column if not exists entered_at      timestamptz,
  add column if not exists updated_at      timestamptz not null default now();

update lab_order_items i
   set organization_id = o.organization_id
  from lab_orders o
 where o.id = i.lab_order_id and i.organization_id is null;

-- ---------------------------------------------------------------------------
-- 7) اختيار المدى المرجعي المناسب للمريض
-- ---------------------------------------------------------------------------
create or replace function app_lab_reference_for_patient(
  p_lab_test_id  uuid,
  p_patient_id   uuid,
  p_component_id uuid default null
)
returns table (low_value numeric, high_value numeric,
               critical_low numeric, critical_high numeric,
               text_reference text, unit text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select gender,
           case when birth_date is null then null
                else (current_date - birth_date) end as age_days
      from patients where id = p_patient_id
  )
  select r.low_value, r.high_value, r.critical_low, r.critical_high,
         r.text_reference, coalesce(r.unit, t.unit)
    from lab_reference_ranges r
    join lab_tests t on t.id = r.lab_test_id
   cross join p
   where r.lab_test_id = p_lab_test_id
     and r.is_active
     and app_is_member(r.organization_id)
     and (p_component_id is null or r.component_id is null or r.component_id = p_component_id)
     and (r.gender = 'any' or p.gender is null or r.gender = p.gender)
     and (r.min_age_days is null or p.age_days is null or p.age_days >= r.min_age_days)
     and (r.max_age_days is null or p.age_days is null or p.age_days <= r.max_age_days)
   -- الأخصّ أولًا: مدى بجنس وعمر محدَّدين يتقدّم على المدى العام
   order by (r.gender <> 'any') desc,
            (r.min_age_days is not null or r.max_age_days is not null) desc,
            (r.component_id is not null) desc
   limit 1;
$$;

revoke all on function app_lab_reference_for_patient(uuid, uuid, uuid) from public, anon;
grant execute on function app_lab_reference_for_patient(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) إدخال النتيجة — مع التعليم التلقائي وحفظ النسخة السابقة
-- ---------------------------------------------------------------------------
create or replace function app_enter_lab_result(
  p_item_id uuid,
  p_value   text,
  p_numeric numeric default null,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item   lab_order_items%rowtype;
  v_order  lab_orders%rowtype;
  v_ref    record;
  v_abn    boolean := false;
  v_crit   boolean := false;
  v_has_ref boolean := false;
  v_num    numeric;
begin
  select * into v_item from lab_order_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'سطر النتيجة غير موجود';
  end if;
  select * into v_order from lab_orders where id = v_item.lab_order_id;

  if not app_has_permission(v_order.organization_id, 'lab.result') then
    raise exception 'صلاحيتك لا تسمح بإدخال النتائج';
  end if;

  -- لا نتيجة قبل استلام العينة: النتيجة على طلبٍ لم تُسحب عينته لا معنى لها.
  if v_order.status not in ('received','in_progress','resulted','verified') then
    raise exception 'لا يمكن إدخال نتيجة والطلب في حالة «%»', v_order.status;
  end if;

  -- تعديل نتيجة مراجَعة أو معتمَدة يحتاج سببًا، وتُحفظ النسخة السابقة.
  if (v_item.result_value is not null or v_item.result_numeric is not null) then
    if v_order.status in ('verified','approved','delivered')
       and (p_reason is null or btrim(p_reason) = '') then
      raise exception 'تعديل نتيجة معتمدة يحتاج سببًا مكتوبًا';
    end if;

    insert into lab_result_amendments (organization_id, lab_order_item_id,
      previous_value, previous_numeric, new_value, new_numeric, reason, amended_by)
    values (v_order.organization_id, p_item_id,
            v_item.result_value, v_item.result_numeric, p_value, p_numeric,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'تصحيح قبل الاعتماد'),
            auth.uid());
  end if;

  v_num := coalesce(p_numeric,
                    case when p_value ~ '^-?[0-9]+(\.[0-9]+)?$' then p_value::numeric end);

  select * into v_ref from app_lab_reference_for_patient(
    v_item.lab_test_id, v_order.patient_id, v_item.component_id);
  v_has_ref := found;

  -- `v_ref is not null` **لا يصلح هنا**: في plpgsql تكون قيمة السجلّ «غير
  -- فارغة» فقط إذا كان كل حقل فيه غير فارغ. ومدى مرجعيّ بلا `text_reference`
  -- — وهو الغالب — يجعل الشرط كاذبًا، فلا تُعلَّم أي نتيجة شاذة ولا حرجة
  -- إطلاقًا. عيبٌ صامت: النتائج تُحفظ ولا يُنبَّه أحد.
  if v_num is not null and v_has_ref then
    v_abn := (v_ref.low_value  is not null and v_num < v_ref.low_value)
          or (v_ref.high_value is not null and v_num > v_ref.high_value);
    v_crit := (v_ref.critical_low  is not null and v_num <= v_ref.critical_low)
           or (v_ref.critical_high is not null and v_num >= v_ref.critical_high);
  end if;

  update lab_order_items set
    result_value   = p_value,
    result_numeric = v_num,
    is_abnormal    = v_abn or v_crit,
    is_critical    = v_crit,
    reference_low  = v_ref.low_value,
    reference_high = v_ref.high_value,
    reference_text = v_ref.text_reference,
    entered_by     = auth.uid(),
    entered_at     = now(),
    updated_at     = now()
  where id = p_item_id;

  return jsonb_build_object(
    'is_abnormal', v_abn or v_crit,
    'is_critical', v_crit,
    'reference_low', v_ref.low_value,
    'reference_high', v_ref.high_value
  );
end;
$$;

revoke all on function app_enter_lab_result(uuid, text, numeric, text) from public, anon;
grant execute on function app_enter_lab_result(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) إنشاء فحص مع خدمته المالية في معاملة واحدة
-- ---------------------------------------------------------------------------
create or replace function app_save_lab_test(
  p_organization_id uuid,
  p_lab_test_id     uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_item uuid;
  v_name text;
  v_code text;
begin
  if not app_has_permission(p_organization_id, 'lab.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة كتالوج المختبر';
  end if;

  if p_lab_test_id is not null then
    select to_jsonb(t) || p_payload into p_payload
      from lab_tests t where t.id = p_lab_test_id and t.organization_id = p_organization_id;
    if p_payload is null then
      raise exception 'الفحص غير موجود في هذه المنشأة';
    end if;
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name_ar', ''));
  if v_name = '' then
    raise exception 'اسم الفحص مطلوب';
  end if;
  v_code := nullif(btrim(coalesce(p_payload ->> 'code', '')), '');
  if v_code is null then
    raise exception 'كود الفحص مطلوب';
  end if;

  -- الخدمة المالية: تُنشأ مع الفحص إن لم تكن موجودة، فلا يوجد فحص بلا خدمة.
  v_item := nullif(p_payload ->> 'billing_item_id', '')::uuid;
  if v_item is null then
    v_item := app_save_service(p_organization_id, null, jsonb_build_object(
      'name_ar', v_name,
      'name_en', p_payload ->> 'name_en',
      'code', 'LAB-' || v_code,
      'item_type', 'service',
      'medical_service_type', 'laboratory',
      'price', coalesce(p_payload ->> 'price', '0'),
      'requires_fasting', coalesce(p_payload ->> 'fasting_required', 'false'),
      'fasting_hours', p_payload ->> 'fasting_hours',
      'preparation_ar', p_payload ->> 'preparation_ar'
    ));
  else
    if not exists (select 1 from items i
                    where i.id = v_item and i.organization_id = p_organization_id
                      and i.medical_service_type = 'laboratory') then
      raise exception 'الخدمة المرتبطة يجب أن تكون من نوع «مختبر»';
    end if;
  end if;

  if p_lab_test_id is null then
    insert into lab_tests (organization_id, billing_item_id, category_id, code, name_ar, name_en,
                           specimen_type, specimen_container, specimen_volume_ml, unit,
                           normal_range_text, normal_range_min, normal_range_max,
                           turnaround_hours, collection_instructions_ar, collection_instructions_en,
                           external_lab_allowed, requires_approval, is_panel, department_id,
                           loinc_code, sort_order, is_active, created_by, updated_by)
    values (p_organization_id, v_item,
            nullif(p_payload ->> 'category_id', '')::uuid, v_code, v_name,
            nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
            nullif(p_payload ->> 'specimen_type', ''),
            nullif(p_payload ->> 'specimen_container', ''),
            nullif(p_payload ->> 'specimen_volume_ml', '')::numeric,
            nullif(p_payload ->> 'unit', ''),
            nullif(p_payload ->> 'normal_range_text', ''),
            nullif(p_payload ->> 'normal_range_min', '')::numeric,
            nullif(p_payload ->> 'normal_range_max', '')::numeric,
            nullif(p_payload ->> 'turnaround_hours', '')::numeric,
            nullif(p_payload ->> 'collection_instructions_ar', ''),
            nullif(p_payload ->> 'collection_instructions_en', ''),
            coalesce((p_payload ->> 'external_lab_allowed')::boolean, false),
            coalesce((p_payload ->> 'requires_approval')::boolean, false),
            coalesce((p_payload ->> 'is_panel')::boolean, false),
            nullif(p_payload ->> 'department_id', '')::uuid,
            nullif(p_payload ->> 'loinc_code', ''),
            coalesce(nullif(p_payload ->> 'sort_order', '')::int, 0),
            coalesce((p_payload ->> 'is_active')::boolean, true),
            auth.uid(), auth.uid())
    returning id into v_id;
  else
    update lab_tests set
      billing_item_id = v_item,
      category_id = nullif(p_payload ->> 'category_id', '')::uuid,
      code = v_code, name_ar = v_name,
      name_en = nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      specimen_type = nullif(p_payload ->> 'specimen_type', ''),
      specimen_container = nullif(p_payload ->> 'specimen_container', ''),
      specimen_volume_ml = nullif(p_payload ->> 'specimen_volume_ml', '')::numeric,
      unit = nullif(p_payload ->> 'unit', ''),
      normal_range_text = nullif(p_payload ->> 'normal_range_text', ''),
      normal_range_min = nullif(p_payload ->> 'normal_range_min', '')::numeric,
      normal_range_max = nullif(p_payload ->> 'normal_range_max', '')::numeric,
      turnaround_hours = nullif(p_payload ->> 'turnaround_hours', '')::numeric,
      collection_instructions_ar = nullif(p_payload ->> 'collection_instructions_ar', ''),
      collection_instructions_en = nullif(p_payload ->> 'collection_instructions_en', ''),
      external_lab_allowed = coalesce((p_payload ->> 'external_lab_allowed')::boolean, external_lab_allowed),
      requires_approval = coalesce((p_payload ->> 'requires_approval')::boolean, requires_approval),
      is_panel = coalesce((p_payload ->> 'is_panel')::boolean, is_panel),
      department_id = nullif(p_payload ->> 'department_id', '')::uuid,
      loinc_code = nullif(p_payload ->> 'loinc_code', ''),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::int, sort_order),
      is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
      updated_at = now(), updated_by = auth.uid()
    where id = p_lab_test_id and organization_id = p_organization_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function app_save_lab_test(uuid, uuid, jsonb) from public, anon;
grant execute on function app_save_lab_test(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) `billing_item_id` إلزامي — بعد ضمان وجوده للصفوف القائمة
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing from lab_tests where billing_item_id is null;
  if v_missing > 0 then
    raise notice 'يوجد % فحص مختبر بلا خدمة مالية — أنشئ لها خدمات ثم شغّل: alter table lab_tests alter column billing_item_id set not null;', v_missing;
  else
    alter table lab_tests alter column billing_item_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11) RLS للجداول الجديدة والقائمة
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['lab_test_components','lab_reference_ranges','lab_result_amendments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format($p$create policy %I on %I for select to authenticated
                     using (app_is_member(organization_id))$p$, t || '_select', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

drop policy if exists lab_components_write on lab_test_components;
create policy lab_components_write on lab_test_components for all to authenticated
  using (app_has_permission(organization_id, 'lab.manage'))
  with check (app_has_permission(organization_id, 'lab.manage'));

drop policy if exists lab_ranges_write on lab_reference_ranges;
create policy lab_ranges_write on lab_reference_ranges for all to authenticated
  using (app_has_permission(organization_id, 'lab.manage'))
  with check (app_has_permission(organization_id, 'lab.manage'));

-- سجلّ التعديلات يُكتب ولا يُعدَّل ولا يُحذف: تاريخٌ يُمحى ليس تاريخًا.
drop policy if exists lab_amendments_insert on lab_result_amendments;
create policy lab_amendments_insert on lab_result_amendments for insert to authenticated
  with check (app_has_permission(organization_id, 'lab.result'));

drop policy if exists lab_tests_all_members on lab_tests;
drop policy if exists lab_tests_select on lab_tests;
create policy lab_tests_select on lab_tests for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists lab_tests_write on lab_tests;
create policy lab_tests_write on lab_tests for all to authenticated
  using (app_has_permission(organization_id, 'lab.manage'))
  with check (app_has_permission(organization_id, 'lab.manage'));

-- ---------------------------------------------------------------------------
-- 12) المناظير
-- ---------------------------------------------------------------------------
create or replace view v_lab_worklist as
select
  o.id,
  o.organization_id,
  o.branch_id,
  o.patient_id,
  p.name_ar        as patient_name,
  p.file_number,
  p.gender,
  p.birth_date,
  o.ordering_doctor_id,
  d.name_ar        as doctor_name,
  o.visit_id,
  o.clinic_id,
  o.status,
  o.priority,
  o.ordered_at,
  o.specimen_collected_at,
  o.received_at,
  o.resulted_at,
  o.verified_at,
  o.approved_at,
  o.delivered_at,
  o.sales_invoice_id,
  o.external_lab_name,
  (select count(*) from lab_order_items i where i.lab_order_id = o.id) as test_count,
  (select count(*) from lab_order_items i where i.lab_order_id = o.id
     and i.result_value is null and i.result_numeric is null)          as pending_count,
  (select count(*) from lab_order_items i where i.lab_order_id = o.id and i.is_critical) as critical_count,
  extract(epoch from (now() - o.ordered_at)) / 3600                    as hours_since_order
from lab_orders o
join patients p on p.id = o.patient_id
left join doctors d on d.id = o.ordering_doctor_id;

alter view v_lab_worklist set (security_invoker = on);
revoke all on v_lab_worklist from anon;
grant select on v_lab_worklist to authenticated;

-- القيم الحرجة: تنبيه داخل النظام لا رسالة
create or replace view v_lab_critical_results as
select
  i.id             as lab_order_item_id,
  o.id             as lab_order_id,
  o.organization_id,
  o.patient_id,
  p.name_ar        as patient_name,
  p.file_number,
  t.name_ar        as test_name,
  c.name_ar        as component_name,
  i.result_value,
  i.result_numeric,
  coalesce(i.reference_low, t.normal_range_min)  as reference_low,
  coalesce(i.reference_high, t.normal_range_max) as reference_high,
  i.entered_at,
  i.entered_by,
  o.status,
  o.ordering_doctor_id,
  d.name_ar        as doctor_name
from lab_order_items i
join lab_orders o on o.id = i.lab_order_id
join lab_tests t on t.id = i.lab_test_id
join patients p on p.id = o.patient_id
left join lab_test_components c on c.id = i.component_id
left join doctors d on d.id = o.ordering_doctor_id
where i.is_critical
  and o.status not in ('cancelled','rejected');

alter view v_lab_critical_results set (security_invoker = on);
revoke all on v_lab_critical_results from anon;
grant select on v_lab_critical_results to authenticated;

commit;
