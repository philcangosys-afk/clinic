-- ###########################################################################
--  ZainCare — الهجرات 0083 → 0090 مجمَّعة في ملف واحد
-- ###########################################################################
--
--  الاستعمال: انسخ الملف كاملًا إلى محرّر SQL في Supabase واضغط Run.
--
--  **معاملة واحدة**: `begin` أوّله و`commit` آخره. إن فشل أيّ سطر تراجعت
--  القاعدة إلى ما كانت عليه تمامًا — فلا تبقى في حالة نصفية، وتُعيد المحاولة
--  بعد إصلاح السبب بلا خوف.
--
--  **قابل لإعادة التشغيل**: تشغيله مرّتين لا يكسر شيئًا.
--
--  **يرحّل البيانات القائمة**: في كل موضع تتغيّر فيه قائمة الحالات المسموحة
--  يُسقَط القيد أوّلًا، ثم تُرحَّل الصفوف، ثم يُركَّب القيد الجديد. الترتيب
--  المعكوس يفشل على أيّ قاعدة فيها بيانات، ولا يظهر إطلاقًا على قاعدة فارغة.
--
--  يفترض أن `0001` → `0082` مطبَّقة، ويرفض العمل إن لم تكن.
-- ###########################################################################

begin;

do $preflight$
begin
  if to_regclass('public.items') is null then
    raise exception 'القاعدة فارغة أو ناقصة: شغّل الهجرات 0001 → 0082 أوّلًا';
  end if;
  if to_regclass('public.price_lists') is null then
    raise exception 'الهجرة 0064 (قوائم الأسعار) غير مطبَّقة — أكمل حتى 0082 أوّلًا';
  end if;
  if to_regprocedure('public.app_doctor_available_slots(uuid,date,uuid,integer)') is null then
    raise exception 'الهجرة 0082 غير مطبَّقة — هذا الملف يبدأ من 0083';
  end if;
  raise notice '✔ القاعدة جاهزة: 0082 مطبَّقة — نبدأ من 0083';
end $preflight$;


-- ###########################################################################
-- ###  0083 — المختبر: الكتالوج والمكوّنات والمديات المرجعية ودورة الطلب
-- ###########################################################################
do $announce$
begin raise notice '▶ 0083 — المختبر: الكتالوج والمكوّنات والمديات المرجعية ودورة الطلب'; end;
$announce$;

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

-- [begin; أُزيلت — المعاملة موحَّدة لكل الملف]

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

-- [commit; أُزيلت — المعاملة موحَّدة لكل الملف]



-- ###########################################################################
-- ###  0084 — الأشعة: دورة الطلب وحجز الأجهزة
-- ###########################################################################
do $announce$
begin raise notice '▶ 0084 — الأشعة: دورة الطلب وحجز الأجهزة'; end;
$announce$;

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

-- [begin; أُزيلت — المعاملة موحَّدة لكل الملف]

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

-- [commit; أُزيلت — المعاملة موحَّدة لكل الملف]



-- ###########################################################################
-- ###  0085 — باني نماذج الفحص السريري
-- ###########################################################################
do $announce$
begin raise notice '▶ 0085 — باني نماذج الفحص السريري'; end;
$announce$;

-- 0085_exam_template_builder.sql
-- المرحلة الخامسة: مصمّم نماذج الفحص السريري.
--
-- الحالة قبل هذا الملف: `clinic_exam_templates` يخزّن النموذج كله في عمود
-- `schema_definition jsonb` واحد، وأنواع الحقول أربعة فقط (نصّ، نصّ طويل،
-- تشخيص، مجموعة). ولا وحدات قياس، ولا حقول إلزامية، ولا إظهار شرطي، ولا
-- إصدارات.
--
-- ونتيجة الأخيرة أخطر مما تبدو: **تعديل نموذج مستعمَل يغيّر معنى الزيارات
-- القديمة**. حقلٌ اسمه `chest` كان «فحص الصدر» فصار «ألم الصدر» — وكل زيارة
-- سابقة تُقرأ الآن بالمعنى الجديد. لا شيء في المخطط يمنع ذلك.
--
-- ---------------------------------------------------------------------------
-- قراران في إعادة الاستعمال
-- ---------------------------------------------------------------------------
--
--   1) **`clinic_exam_templates` يبقى رأسًا للنموذج** ولا يُنشأ جدول قوالب
--      ثانٍ. تُضاف إليه أعمدة الإصدار والسريان والعيادة.
--
--   2) **`schema_definition` يبقى ويصير مشتقًّا.** شاشة السجل الطبي تقرؤه
--      اليوم، وحذفه يكسرها فورًا. صار يُبنى تلقائيًا من الجداول المعيارية
--      بمشغّل، فلا يفترق التمثيلان — والشاشة تُهاجَر إلى الجداول على مهل.
-- ---------------------------------------------------------------------------

-- [begin; أُزيلت — المعاملة موحَّدة لكل الملف]

-- ---------------------------------------------------------------------------
-- 1) رأس النموذج
-- ---------------------------------------------------------------------------
alter table clinic_exam_templates
  add column if not exists specialty_value_id uuid references lookup_values(id) on delete set null,
  add column if not exists clinic_id          uuid references clinics(id) on delete set null,
  add column if not exists version            integer not null default 1,
  add column if not exists parent_template_id uuid references clinic_exam_templates(id) on delete set null,
  add column if not exists effective_from     date not null default current_date,
  add column if not exists effective_to       date,
  add column if not exists description_ar     text,
  add column if not exists created_by         uuid references auth.users(id),
  add column if not exists updated_by         uuid references auth.users(id);

comment on column clinic_exam_templates.is_disabled is 'حالة النموذج. لا يوجد is_active — علَمان لمعنى واحد يتناقضان.';
comment on column clinic_exam_templates.schema_definition is
  'يُبنى تلقائيًا من exam_template_sections/fields. لا يُحرَّر يدويًا — التحرير يفترق عن الجداول.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_templates_version_check') then
    alter table clinic_exam_templates add constraint exam_templates_version_check check (version >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exam_templates_clinic_tenant_fk') then
    alter table clinic_exam_templates add constraint exam_templates_clinic_tenant_fk
      foreign key (organization_id, clinic_id) references clinics (organization_id, id) not valid;
  end if;
end $$;

create index if not exists idx_exam_templates_specialty
  on clinic_exam_templates (organization_id, specialty_value_id) where not is_disabled;

-- **مفتاح `(organization_id, specialty_code)` الفريد يمنع الإصدارات أصلًا.**
--
-- كان يقول «نموذج واحد لكل تخصص»، وهو معنًى صحيح — لكنه بصيغته المطلقة
-- يمنع وجود نسخة ثانية من النموذج نفسه، أي يمنع الإصدارات التي تقوم عليها
-- هذه المرحلة كلها. يُستبدل بفهرس جزئي يحفظ المعنى: **نموذج مفعَّل واحد**
-- لكل تخصص، وأي عدد من النسخ المعطَّلة أو المؤرشفة.
alter table clinic_exam_templates
  drop constraint if exists clinic_exam_templates_organization_id_specialty_code_key;

create unique index if not exists uq_exam_template_active_specialty
  on clinic_exam_templates (organization_id, specialty_code)
  where not is_disabled and specialty_code is not null;

-- ---------------------------------------------------------------------------
-- 2) الأقسام والحقول والخيارات
-- ---------------------------------------------------------------------------
create table if not exists exam_template_sections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id     uuid not null references clinic_exam_templates(id) on delete cascade,
  key             text not null,
  name_ar         text not null,
  name_en         text,
  description_ar  text,
  sort_order      integer not null default 0,
  is_collapsible  boolean not null default false,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_exam_sections on exam_template_sections (template_id, key);

create table if not exists exam_template_fields (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  template_id       uuid not null references clinic_exam_templates(id) on delete cascade,
  section_id        uuid not null references exam_template_sections(id) on delete cascade,
  key               text not null,
  label_ar          text not null,
  label_en          text,
  field_type        text not null,
  unit              text,
  placeholder_ar    text,
  help_ar           text,
  is_required       boolean not null default false,
  min_value         numeric(14,4),
  max_value         numeric(14,4),
  decimal_places    smallint,
  default_value     text,
  -- الإظهار الشرطي: يظهر هذا الحقل حين تكون قيمة حقل آخر مساويةً لقيمة
  visible_when_field_id uuid references exam_template_fields(id) on delete set null,
  visible_when_value    text,
  lookup_category_key   text,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint exam_fields_type_check check (field_type in (
    'text','textarea','number','date','time','select','multi_select',
    'checkbox','radio','yes_no','measurement','clinical_code','body_map','file'
  )),
  constraint exam_fields_range_check
    check (min_value is null or max_value is null or min_value <= max_value),
  -- الإظهار الشرطي ناقصٌ لا معنى له: حقلٌ بلا قيمة، أو قيمةٌ بلا حقل.
  constraint exam_fields_conditional_check check (
    (visible_when_field_id is null and visible_when_value is null)
    or (visible_when_field_id is not null and visible_when_value is not null)
  )
);

create unique index if not exists uq_exam_fields on exam_template_fields (template_id, key);
create index if not exists idx_exam_fields_section on exam_template_fields (section_id) where is_active;

create table if not exists exam_field_options (
  id         uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  field_id   uuid not null references exam_template_fields(id) on delete cascade,
  value      text not null,
  label_ar   text not null,
  label_en   text,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

create unique index if not exists uq_exam_field_options on exam_field_options (field_id, value);

-- الحقل الشرطي يجب أن يكون من النموذج نفسه
create or replace function app_enforce_exam_field_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_section_template uuid;
  v_cond_template    uuid;
begin
  select template_id into v_section_template from exam_template_sections where id = new.section_id;
  if v_section_template is distinct from new.template_id then
    raise exception 'القسم يتبع نموذجًا آخر';
  end if;

  if new.visible_when_field_id is not null then
    select template_id into v_cond_template from exam_template_fields where id = new.visible_when_field_id;
    if v_cond_template is distinct from new.template_id then
      raise exception 'الحقل الشرطي يتبع نموذجًا آخر';
    end if;
    if new.visible_when_field_id = new.id then
      raise exception 'الحقل لا يكون شرطًا لظهور نفسه';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_exam_field_scope on exam_template_fields;
create trigger trg_exam_field_scope
  before insert or update on exam_template_fields
  for each row execute function app_enforce_exam_field_scope();

-- ---------------------------------------------------------------------------
-- 3) بناء `schema_definition` من الجداول
--
-- التمثيلان يبقيان متطابقين لأن أحدهما مشتقّ من الآخر — لا لأن أحدًا
-- يتذكّر تحديثهما معًا.
-- ---------------------------------------------------------------------------
create or replace function app_rebuild_exam_schema(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schema jsonb;
begin
  select jsonb_build_object(
           'version', (select version from clinic_exam_templates where id = p_template_id),
           'sections', coalesce(jsonb_agg(sec order by sec_order), '[]'::jsonb))
    into v_schema
    from (
      select s.sort_order as sec_order,
             jsonb_build_object(
               'key', s.key,
               'label_ar', s.name_ar,
               'type', 'group',
               'fields', coalesce(
                 (select jsonb_agg(jsonb_build_object(
                            'key', f.key,
                            'label_ar', f.label_ar,
                            'type', f.field_type,
                            'unit', f.unit,
                            'required', f.is_required,
                            'options', (select jsonb_agg(jsonb_build_object('value', o.value, 'label_ar', o.label_ar)
                                                         order by o.sort_order)
                                          from exam_field_options o
                                         where o.field_id = f.id and o.is_active),
                            'visible_when', case when f.visible_when_field_id is null then null
                              else jsonb_build_object(
                                'field', (select k.key from exam_template_fields k where k.id = f.visible_when_field_id),
                                'value', f.visible_when_value) end)
                          order by f.sort_order)
                    from exam_template_fields f
                   where f.section_id = s.id and f.is_active),
                 '[]'::jsonb)
             ) as sec
        from exam_template_sections s
       where s.template_id = p_template_id
    ) z;

  update clinic_exam_templates
     set schema_definition = coalesce(v_schema, jsonb_build_object('sections', '[]'::jsonb)),
         updated_at = now()
   where id = p_template_id;

  return v_schema;
end;
$$;

create or replace function app_touch_exam_schema()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template uuid;
begin
  -- `if` لا `case` داخل تعبير واحد: الدالة مشتركة بين ثلاثة جداول، وتعبيرٌ
  -- واحد يشير إلى `new.field_id` و`new.template_id` معًا يُصرَّف كاستعلام
  -- واحد فيفشل على الجدول الذي ينقصه أحد الحقلين.
  if tg_table_name = 'exam_field_options' then
    select template_id into v_template from exam_template_fields
     where id = coalesce(new.field_id, old.field_id);
  else
    v_template := coalesce(new.template_id, old.template_id);
  end if;

  if v_template is not null then
    perform app_rebuild_exam_schema(v_template);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_exam_sections_schema on exam_template_sections;
create trigger trg_exam_sections_schema
  after insert or update or delete on exam_template_sections
  for each row execute function app_touch_exam_schema();

drop trigger if exists trg_exam_fields_schema on exam_template_fields;
create trigger trg_exam_fields_schema
  after insert or update or delete on exam_template_fields
  for each row execute function app_touch_exam_schema();

drop trigger if exists trg_exam_options_schema on exam_field_options;
create trigger trg_exam_options_schema
  after insert or update or delete on exam_field_options
  for each row execute function app_touch_exam_schema();

-- ---------------------------------------------------------------------------
-- 4) الزيارة تحتفظ بنسخة النموذج المستعمَلة
--
-- أهمّ بند في هذه المرحلة. بدونه، تعديل نموذج اليوم يغيّر **معنى** ما كُتب
-- قبل سنة: حقلٌ حُذف تختفي إجابته من العرض، وحقلٌ أُعيدت تسميته تُقرأ إجابته
-- القديمة بالعنوان الجديد. النسخة تُلتقط مرة واحدة عند أول حفظ ولا تتغيّر.
-- ---------------------------------------------------------------------------
alter table patient_visits
  add column if not exists exam_schema_snapshot jsonb,
  add column if not exists template_version     integer;

create or replace function app_snapshot_exam_template()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.template_id is null then
    return new;
  end if;
  -- تُلتقط مرة واحدة: إعادة الالتقاط عند كل تعديل تُلغي الغرض.
  if new.exam_schema_snapshot is null then
    select schema_definition, version
      into new.exam_schema_snapshot, new.template_version
      from clinic_exam_templates where id = new.template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_exam_template on patient_visits;
create trigger trg_snapshot_exam_template
  before insert or update of template_id on patient_visits
  for each row execute function app_snapshot_exam_template();

-- ---------------------------------------------------------------------------
-- 5) إصدار نسخة جديدة بدل تعديل نموذج مستعمَل
-- ---------------------------------------------------------------------------
create or replace function app_template_usage_count(p_template_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from patient_visits v
   where v.template_id = p_template_id and app_is_member(v.organization_id);
$$;

create or replace function app_clone_exam_template(
  p_template_id uuid,
  p_name_ar     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src    clinic_exam_templates%rowtype;
  v_new    uuid;
  v_ver    int;
  r        record;
  v_map    jsonb := '{}'::jsonb;
begin
  select * into v_src from clinic_exam_templates where id = p_template_id;
  if v_src.id is null then
    raise exception 'النموذج غير موجود';
  end if;
  if not app_has_permission(v_src.organization_id, 'exam_templates.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة النماذج';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver
    from clinic_exam_templates
   where organization_id = v_src.organization_id
     and coalesce(parent_template_id, id) = coalesce(v_src.parent_template_id, v_src.id);

  insert into clinic_exam_templates (organization_id, specialty_code, specialty_value_id, clinic_id,
                                     name_ar, name_en, description_ar, note, canvas_type,
                                     schema_definition, version, parent_template_id,
                                     effective_from, is_disabled, created_by, updated_by)
  values (v_src.organization_id, v_src.specialty_code, v_src.specialty_value_id, v_src.clinic_id,
          coalesce(p_name_ar, v_src.name_ar || ' — نسخة ' || v_ver),
          v_src.name_en, v_src.description_ar, v_src.note, v_src.canvas_type,
          v_src.schema_definition, v_ver, coalesce(v_src.parent_template_id, v_src.id),
          current_date, true, auth.uid(), auth.uid())
  returning id into v_new;

  -- الأقسام أولًا، ثم الحقول (لأنها تشير إلى الأقسام)، ثم الخيارات.
  for r in select * from exam_template_sections where template_id = p_template_id loop
    insert into exam_template_sections (organization_id, template_id, key, name_ar, name_en,
                                        description_ar, sort_order, is_collapsible)
    values (v_src.organization_id, v_new, r.key, r.name_ar, r.name_en,
            r.description_ar, r.sort_order, r.is_collapsible);
  end loop;

  for r in select * from exam_template_fields where template_id = p_template_id order by sort_order loop
    insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar, label_en,
                                      field_type, unit, placeholder_ar, help_ar, is_required,
                                      min_value, max_value, decimal_places, default_value,
                                      lookup_category_key, sort_order, is_active)
    select v_src.organization_id, v_new,
           (select ns.id from exam_template_sections ns
             where ns.template_id = v_new
               and ns.key = (select os.key from exam_template_sections os where os.id = r.section_id)),
           r.key, r.label_ar, r.label_en, r.field_type, r.unit, r.placeholder_ar, r.help_ar,
           r.is_required, r.min_value, r.max_value, r.decimal_places, r.default_value,
           r.lookup_category_key, r.sort_order, r.is_active;
  end loop;

  -- الشروط تُربط بعد إنشاء كل الحقول، لأنها تشير إلى حقول قد تأتي لاحقًا.
  update exam_template_fields nf
     set visible_when_field_id = (
           select nk.id from exam_template_fields nk
            where nk.template_id = v_new
              and nk.key = (select ok.key from exam_template_fields ok
                             where ok.id = of.visible_when_field_id)),
         visible_when_value = of.visible_when_value
    from exam_template_fields of
   where of.template_id = p_template_id
     and of.visible_when_field_id is not null
     and nf.template_id = v_new
     and nf.key = of.key;

  for r in select o.*, f.key as field_key from exam_field_options o
             join exam_template_fields f on f.id = o.field_id
            where f.template_id = p_template_id loop
    insert into exam_field_options (organization_id, field_id, value, label_ar, label_en,
                                    sort_order, is_active)
    select v_src.organization_id,
           (select nf.id from exam_template_fields nf
             where nf.template_id = v_new and nf.key = r.field_key),
           r.value, r.label_ar, r.label_en, r.sort_order, r.is_active;
  end loop;

  perform app_rebuild_exam_schema(v_new);
  return v_new;
end;
$$;

-- تعديل نموذج استُعمل: تحذير في القاعدة لا منع
--
-- المنع الكامل يوقف تصحيح خطأ إملائي في عنوان حقل. والسماح الصامت يغيّر
-- معنى القديم. الحلّ: النسخة الملتقطة على الزيارة تحمي القديم، وهذا المشغّل
-- يمنع **تغيير نوع الحقل ومفتاحه** تحديدًا — وهما وحدهما ما يفسد قراءة
-- الإجابات المحفوظة.
create or replace function app_guard_used_template_field()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.key = new.key and old.field_type = new.field_type then
    return new;
  end if;
  if app_template_usage_count(new.template_id) > 0 then
    raise exception 'هذا النموذج مستعمَل في زيارات — أنشئ نسخة جديدة بدل تغيير مفتاح الحقل أو نوعه';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_used_template_field on exam_template_fields;
create trigger trg_guard_used_template_field
  before update on exam_template_fields
  for each row execute function app_guard_used_template_field();

-- ---------------------------------------------------------------------------
-- 6) الصلاحيات و RLS
-- ---------------------------------------------------------------------------
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('exam_templates.view',   'عرض نماذج الفحص',   'exam_templates', 890),
  ('exam_templates.manage', 'إدارة نماذج الفحص', 'exam_templates', 892)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'exam_templates.view'), ('branch_manager', 'exam_templates.manage'),
  ('doctor',         'exam_templates.view'), ('doctor', 'exam_templates.manage'),
  ('nurse',          'exam_templates.view'),
  ('receptionist',   'exam_templates.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

do $$
declare t text;
begin
  foreach t in array array['exam_template_sections','exam_template_fields','exam_field_options']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format($p$create policy %I on %I for select to authenticated
                     using (app_is_member(organization_id))$p$, t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format($p$create policy %I on %I for all to authenticated
                     using (app_has_permission(organization_id, 'exam_templates.manage'))
                     with check (app_has_permission(organization_id, 'exam_templates.manage'))$p$,
                   t || '_write', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

drop policy if exists clinic_exam_templates_all_members on clinic_exam_templates;
drop policy if exists exam_templates_select on clinic_exam_templates;
create policy exam_templates_select on clinic_exam_templates for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists exam_templates_write on clinic_exam_templates;
create policy exam_templates_write on clinic_exam_templates for all to authenticated
  using (app_has_permission(organization_id, 'exam_templates.manage'))
  with check (app_has_permission(organization_id, 'exam_templates.manage'));

revoke all on function app_rebuild_exam_schema(uuid) from public, anon;
revoke all on function app_template_usage_count(uuid) from public, anon;
revoke all on function app_clone_exam_template(uuid, text) from public, anon;
grant execute on function app_rebuild_exam_schema(uuid) to authenticated;
grant execute on function app_template_usage_count(uuid) to authenticated;
grant execute on function app_clone_exam_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) المنظور
-- ---------------------------------------------------------------------------
create or replace view v_exam_templates as
select
  t.id,
  t.organization_id,
  t.name_ar,
  t.name_en,
  t.specialty_code,
  t.specialty_value_id,
  sp.name_ar          as specialty_name,
  t.clinic_id,
  c.name              as clinic_name,
  t.canvas_type,
  t.version,
  t.parent_template_id,
  t.effective_from,
  t.effective_to,
  t.is_disabled,
  (select count(*) from exam_template_sections s where s.template_id = t.id) as section_count,
  (select count(*) from exam_template_fields f where f.template_id = t.id and f.is_active) as field_count,
  app_template_usage_count(t.id) as usage_count,
  t.created_at,
  t.updated_at
from clinic_exam_templates t
left join lookup_values sp on sp.id = t.specialty_value_id
left join clinics c on c.id = t.clinic_id;

alter view v_exam_templates set (security_invoker = on);
revoke all on v_exam_templates from anon;
grant select on v_exam_templates to authenticated;

-- [commit; أُزيلت — المعاملة موحَّدة لكل الملف]



-- ###########################################################################
-- ###  0086 — البيانات المرجعية والقواميس الطبية
-- ###########################################################################
do $announce$
begin raise notice '▶ 0086 — البيانات المرجعية والقواميس الطبية'; end;
$announce$;

-- 0086_medical_reference_data.sql
-- المرحلة السادسة: البيانات المرجعية الطبية.
--
-- الحالة قبل هذا الملف: `lookup_categories` و`lookup_values` قائمان منذ 0001
-- ويميّزان أصلًا بين **القواميس النظامية** (`organization_id is null`)
-- و**بيانات المنشأة** — وهذا بالضبط ما تطلبه المواصفة، فلا داعي لبنية
-- جديدة. الناقص هو **القواميس الطبية نفسها**: أنواع الحساسية وشدّتها، وطرق
-- الإعطاء وأشكال الجرعات، ووحدات القياس، وأنواع العينات، وأجزاء الجسم،
-- وأسباب الإلغاء وعدم الحضور والاسترجاع، وأنواع الموافقات والإحالات.
--
-- و`icd10_codes` جدول عالمي (بلا `organization_id`) فيه ١٥٧ كودًا مبدئيًا.
-- يبقى كما هو ويُوسَّع بالاستيراد لا بالنسخ في كود الواجهة.
--
-- ---------------------------------------------------------------------------
-- قرار: أنواع العينات وأجزاء الجسم تُضاف كقواميس **بجانب** القيود القائمة
-- ---------------------------------------------------------------------------
-- `lab_tests.specimen_type` مقيَّد بقائمة ثابتة (`blood`, `urine`, …) منذ
-- 0013، و`radiology_exams.modality` كذلك. القيد الثابت أضمن للبيانات من
-- قاموس قابل للتحرير، لكنه لا يقبل التوسعة ولا يحمل أسماء عربية.
--
-- الحلّ: يبقى القيد حارسًا، ويُضاف القاموس **للعرض والترجمة والترتيب**،
-- بمفاتيح مطابقة للقيد حرفيًا. فلا يستطيع أحد إدخال قيمة يرفضها القيد،
-- ويُعرض للمستخدم اسمٌ عربي بدل مفتاح إنجليزي.
-- ---------------------------------------------------------------------------

-- [begin; أُزيلت — المعاملة موحَّدة لكل الملف]

-- ---------------------------------------------------------------------------
-- 1) القواميس النظامية الناقصة
--
-- تُنشأ بـ`organization_id = null`: مرجعٌ نظامي مشترك، لا يملكه أحد ولا
-- يعدّله إلا مدير النظام.
-- ---------------------------------------------------------------------------
insert into lookup_categories (organization_id, key, name_ar, name_en)
select null, v.k, v.ar, v.en
from (values
  ('allergy_types',        'أنواع الحساسية',        'Allergy Types'),
  ('allergy_severity',     'شدّة الحساسية',          'Allergy Severity'),
  ('drug_routes',          'طرق إعطاء الدواء',      'Routes of Administration'),
  ('dosage_forms',         'أشكال الجرعات',         'Dosage Forms'),
  ('measurement_units',    'وحدات القياس',          'Units of Measure'),
  ('specimen_types',       'أنواع العينات',         'Specimen Types'),
  ('body_parts',           'أجزاء الجسم',           'Body Parts'),
  ('cancellation_reasons', 'أسباب إلغاء المواعيد',  'Cancellation Reasons'),
  ('no_show_reasons',      'أسباب عدم الحضور',      'No-Show Reasons'),
  ('refund_reasons',       'أسباب الاسترجاع',       'Refund Reasons'),
  ('consent_types',        'أنواع الموافقات',       'Consent Types'),
  ('referral_types',       'أنواع الإحالات',        'Referral Types'),
  ('imaging_modalities',   'أجهزة التصوير',         'Imaging Modalities'),
  ('lab_result_flags',     'دلالات نتائج المختبر',  'Lab Result Flags')
) as v(k, ar, en)
where not exists (
  select 1 from lookup_categories c where c.key = v.k and c.organization_id is null
);

-- ---------------------------------------------------------------------------
-- 2) القيم الأولية
--
-- ليست بياناتٍ وهمية: كلها مصطلحات طبية قياسية، ومفاتيحها الإنجليزية هي ما
-- تكتبه الأنظمة الأخرى. القوائم المرتبطة بقيود قاعدة (العينات، الأجهزة)
-- مفاتيحها مطابقة للقيد حرفيًا.
-- ---------------------------------------------------------------------------
create or replace function app_seed_lookup(
  p_key text,
  p_values jsonb   -- [{code, ar, en}]
)
returns void
language plpgsql
as $$
declare
  v_cat uuid;
  r     jsonb;
  i     int := 0;
begin
  select id into v_cat from lookup_categories
   where key = p_key and organization_id is null;
  if v_cat is null then
    return;
  end if;

  for r in select * from jsonb_array_elements(p_values) loop
    i := i + 1;
    if not exists (select 1 from lookup_values
                    where category_id = v_cat and code = (r ->> 'code')) then
      insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
      values (v_cat, r ->> 'code', r ->> 'ar', r ->> 'en', i);
    end if;
  end loop;
end;
$$;

select app_seed_lookup('allergy_types', '[
  {"code":"drug","ar":"دواء","en":"Drug"},
  {"code":"food","ar":"طعام","en":"Food"},
  {"code":"environmental","ar":"بيئية","en":"Environmental"},
  {"code":"latex","ar":"لاتكس","en":"Latex"},
  {"code":"insect","ar":"لدغ الحشرات","en":"Insect Sting"},
  {"code":"contrast","ar":"صبغة الأشعة","en":"Contrast Media"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('allergy_severity', '[
  {"code":"mild","ar":"خفيفة","en":"Mild"},
  {"code":"moderate","ar":"متوسطة","en":"Moderate"},
  {"code":"severe","ar":"شديدة","en":"Severe"},
  {"code":"anaphylaxis","ar":"تأق (صدمة تحسسية)","en":"Anaphylaxis"}
]'::jsonb);

select app_seed_lookup('drug_routes', '[
  {"code":"oral","ar":"فموي","en":"Oral"},
  {"code":"iv","ar":"وريدي","en":"Intravenous"},
  {"code":"im","ar":"عضلي","en":"Intramuscular"},
  {"code":"sc","ar":"تحت الجلد","en":"Subcutaneous"},
  {"code":"topical","ar":"موضعي","en":"Topical"},
  {"code":"inhalation","ar":"استنشاق","en":"Inhalation"},
  {"code":"rectal","ar":"شرجي","en":"Rectal"},
  {"code":"ophthalmic","ar":"عيني","en":"Ophthalmic"},
  {"code":"otic","ar":"أذني","en":"Otic"},
  {"code":"nasal","ar":"أنفي","en":"Nasal"},
  {"code":"sublingual","ar":"تحت اللسان","en":"Sublingual"},
  {"code":"vaginal","ar":"مهبلي","en":"Vaginal"}
]'::jsonb);

select app_seed_lookup('dosage_forms', '[
  {"code":"tablet","ar":"أقراص","en":"Tablet"},
  {"code":"capsule","ar":"كبسولات","en":"Capsule"},
  {"code":"syrup","ar":"شراب","en":"Syrup"},
  {"code":"suspension","ar":"معلّق","en":"Suspension"},
  {"code":"injection","ar":"حقن","en":"Injection"},
  {"code":"cream","ar":"كريم","en":"Cream"},
  {"code":"ointment","ar":"مرهم","en":"Ointment"},
  {"code":"drops","ar":"قطرة","en":"Drops"},
  {"code":"inhaler","ar":"بخّاخ","en":"Inhaler"},
  {"code":"suppository","ar":"تحاميل","en":"Suppository"},
  {"code":"patch","ar":"لصقة","en":"Patch"},
  {"code":"powder","ar":"مسحوق","en":"Powder"}
]'::jsonb);

select app_seed_lookup('measurement_units', '[
  {"code":"mg","ar":"ملغم","en":"mg"},
  {"code":"g","ar":"غرام","en":"g"},
  {"code":"mcg","ar":"مايكروغرام","en":"mcg"},
  {"code":"ml","ar":"مل","en":"mL"},
  {"code":"l","ar":"لتر","en":"L"},
  {"code":"iu","ar":"وحدة دولية","en":"IU"},
  {"code":"mmol_l","ar":"ملي مول/لتر","en":"mmol/L"},
  {"code":"mg_dl","ar":"ملغم/دل","en":"mg/dL"},
  {"code":"g_dl","ar":"غرام/دل","en":"g/dL"},
  {"code":"cells_ul","ar":"خلية/ميكرولتر","en":"cells/µL"},
  {"code":"percent","ar":"نسبة مئوية","en":"%"},
  {"code":"cm","ar":"سم","en":"cm"},
  {"code":"kg","ar":"كغم","en":"kg"},
  {"code":"celsius","ar":"درجة مئوية","en":"°C"},
  {"code":"mmhg","ar":"ملم زئبق","en":"mmHg"},
  {"code":"bpm","ar":"نبضة/دقيقة","en":"bpm"}
]'::jsonb);

-- مفاتيح مطابقة لقيد `lab_tests_specimen_type_check` حرفيًا
select app_seed_lookup('specimen_types', '[
  {"code":"blood","ar":"دم","en":"Blood"},
  {"code":"urine","ar":"بول","en":"Urine"},
  {"code":"stool","ar":"براز","en":"Stool"},
  {"code":"swab","ar":"مسحة","en":"Swab"},
  {"code":"sputum","ar":"قشع","en":"Sputum"},
  {"code":"tissue","ar":"نسيج","en":"Tissue"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

-- مفاتيح مطابقة لقيد `radiology_exams_modality_check` حرفيًا
select app_seed_lookup('imaging_modalities', '[
  {"code":"xray","ar":"أشعة سينية","en":"X-Ray"},
  {"code":"ct","ar":"مقطعية","en":"CT"},
  {"code":"mri","ar":"رنين مغناطيسي","en":"MRI"},
  {"code":"ultrasound","ar":"موجات صوتية","en":"Ultrasound"},
  {"code":"mammography","ar":"تصوير الثدي","en":"Mammography"},
  {"code":"fluoroscopy","ar":"تنظير تألقي","en":"Fluoroscopy"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('body_parts', '[
  {"code":"head","ar":"الرأس","en":"Head"},
  {"code":"neck","ar":"الرقبة","en":"Neck"},
  {"code":"chest","ar":"الصدر","en":"Chest"},
  {"code":"abdomen","ar":"البطن","en":"Abdomen"},
  {"code":"pelvis","ar":"الحوض","en":"Pelvis"},
  {"code":"spine_cervical","ar":"العمود الرقبي","en":"Cervical Spine"},
  {"code":"spine_thoracic","ar":"العمود الصدري","en":"Thoracic Spine"},
  {"code":"spine_lumbar","ar":"العمود القطني","en":"Lumbar Spine"},
  {"code":"shoulder","ar":"الكتف","en":"Shoulder"},
  {"code":"elbow","ar":"المرفق","en":"Elbow"},
  {"code":"wrist","ar":"الرسغ","en":"Wrist"},
  {"code":"hand","ar":"اليد","en":"Hand"},
  {"code":"hip","ar":"الورك","en":"Hip"},
  {"code":"knee","ar":"الركبة","en":"Knee"},
  {"code":"ankle","ar":"الكاحل","en":"Ankle"},
  {"code":"foot","ar":"القدم","en":"Foot"}
]'::jsonb);

select app_seed_lookup('cancellation_reasons', '[
  {"code":"patient_request","ar":"طلب المريض","en":"Patient Request"},
  {"code":"patient_illness","ar":"مرض المريض","en":"Patient Illness"},
  {"code":"doctor_unavailable","ar":"عدم توفّر الطبيب","en":"Doctor Unavailable"},
  {"code":"rescheduled","ar":"أُعيدت جدولته","en":"Rescheduled"},
  {"code":"duplicate","ar":"حجز مكرّر","en":"Duplicate Booking"},
  {"code":"clinic_closed","ar":"إغلاق العيادة","en":"Clinic Closed"},
  {"code":"insurance_rejected","ar":"رفض التأمين","en":"Insurance Rejected"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('no_show_reasons', '[
  {"code":"forgot","ar":"نسي الموعد","en":"Forgot"},
  {"code":"transport","ar":"تعذّر المواصلات","en":"Transportation"},
  {"code":"work","ar":"ارتباط عمل","en":"Work Commitment"},
  {"code":"weather","ar":"الأحوال الجوية","en":"Weather"},
  {"code":"felt_better","ar":"تحسّنت حالته","en":"Felt Better"},
  {"code":"unknown","ar":"غير معروف","en":"Unknown"}
]'::jsonb);

select app_seed_lookup('refund_reasons', '[
  {"code":"service_not_provided","ar":"لم تُقدَّم الخدمة","en":"Service Not Provided"},
  {"code":"billing_error","ar":"خطأ في الفوترة","en":"Billing Error"},
  {"code":"duplicate_charge","ar":"رسم مكرّر","en":"Duplicate Charge"},
  {"code":"patient_complaint","ar":"شكوى المريض","en":"Patient Complaint"},
  {"code":"insurance_covered","ar":"غطّاها التأمين","en":"Covered by Insurance"},
  {"code":"other","ar":"أخرى","en":"Other"}
]'::jsonb);

select app_seed_lookup('consent_types', '[
  {"code":"general_treatment","ar":"موافقة علاج عامة","en":"General Treatment"},
  {"code":"surgical","ar":"موافقة جراحية","en":"Surgical"},
  {"code":"anesthesia","ar":"موافقة تخدير","en":"Anesthesia"},
  {"code":"blood_transfusion","ar":"نقل دم","en":"Blood Transfusion"},
  {"code":"contrast_media","ar":"صبغة الأشعة","en":"Contrast Media"},
  {"code":"photography","ar":"تصوير طبي","en":"Medical Photography"},
  {"code":"data_sharing","ar":"مشاركة البيانات","en":"Data Sharing"},
  {"code":"minor_guardian","ar":"موافقة وليّ أمر","en":"Guardian Consent"}
]'::jsonb);

select app_seed_lookup('referral_types', '[
  {"code":"internal","ar":"إحالة داخلية","en":"Internal"},
  {"code":"external","ar":"إحالة خارجية","en":"External"},
  {"code":"second_opinion","ar":"رأي ثانٍ","en":"Second Opinion"},
  {"code":"emergency","ar":"إحالة طارئة","en":"Emergency"},
  {"code":"lab_external","ar":"مختبر خارجي","en":"External Lab"},
  {"code":"imaging_external","ar":"أشعة خارجية","en":"External Imaging"}
]'::jsonb);

select app_seed_lookup('lab_result_flags', '[
  {"code":"normal","ar":"طبيعي","en":"Normal"},
  {"code":"low","ar":"منخفض","en":"Low"},
  {"code":"high","ar":"مرتفع","en":"High"},
  {"code":"critical_low","ar":"منخفض حرج","en":"Critical Low"},
  {"code":"critical_high","ar":"مرتفع حرج","en":"Critical High"},
  {"code":"inconclusive","ar":"غير حاسم","en":"Inconclusive"}
]'::jsonb);

drop function if exists app_seed_lookup(text, jsonb);

-- ---------------------------------------------------------------------------
-- 3) أكواد الإجراءات — جدول عالمي مثل ICD-10
--
-- كود الإجراء (CPT وما شابه) معيار لا يخصّ منشأة، فيوضع حيث وُضع ICD-10:
-- جدول عالمي بلا `organization_id`. وربطُه بالخدمة يبقى في
-- `item_claim_codes` (0073) الذي **يخصّ** المنشأة.
-- ---------------------------------------------------------------------------
create table if not exists procedure_codes (
  id            uuid primary key default gen_random_uuid(),
  code_system   text not null default 'cpt',
  code          text not null,
  name_ar       text,
  name_en       text not null,
  category      text,
  is_disabled   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint procedure_codes_system_check check (
    code_system in ('cpt','hcpcs','icd10pcs','snomed','local','other')
  )
);

create unique index if not exists uq_procedure_codes on procedure_codes (code_system, code);
create index if not exists idx_procedure_codes_search
  on procedure_codes (code) where not is_disabled;

alter table procedure_codes enable row level security;

drop policy if exists procedure_codes_read on procedure_codes;
create policy procedure_codes_read on procedure_codes for select to authenticated
  using (true);

-- الكتابة على المرجع العالمي ليست لأحد من المستخدمين: يُستورَد بمفتاح
-- الخدمة أو من محرّر SQL. سياسة كتابة مفتوحة هنا تعني أن منشأةً تعدّل
-- مرجعًا تراه كل المنشآت.
revoke all on procedure_codes from anon;
grant select on procedure_codes to authenticated;

comment on table procedure_codes is
  'مرجع عالمي لأكواد الإجراءات. لا يُكتب من التطبيق — يُستورَد. الربط بالخدمة في item_claim_codes.';

-- ---------------------------------------------------------------------------
-- 4) `icd10_codes`: البحث والحماية
-- ---------------------------------------------------------------------------
create index if not exists idx_icd10_code on icd10_codes (code) where not is_disabled;
create index if not exists idx_icd10_name_ar on icd10_codes (name_ar) where not is_disabled;

comment on table icd10_codes is
  'مرجع WHO عالمي بلا organization_id. يُوسَّع بالاستيراد لا بالنسخ في كود الواجهة.';

-- ---------------------------------------------------------------------------
-- 5) القواميس النظامية لا يعدّلها مدير المنشأة
--
-- السياسة القائمة `lookup_values_manage_admins` تفحص
-- `app_is_org_admin(c.organization_id)` — وهي تُعيد `false` حين تكون
-- المنشأة `null`، فالقواميس النظامية محميّة أصلًا. هذا الفحص يُثبّت ذلك
-- ويفشل إن تغيّر.
-- ---------------------------------------------------------------------------
do $$
declare
  v_expr text;
begin
  select pg_get_expr(polqual, polrelid) into v_expr
    from pg_policy
   where polrelid = 'lookup_values'::regclass
     and polname = 'lookup_values_manage_admins';

  if v_expr is null or v_expr not like '%app_is_org_admin%' then
    raise exception 'سياسة تعديل القواميس تغيّرت — القواميس النظامية قد تصير قابلة للتعديل';
  end if;
  raise notice 'القواميس النظامية محميّة: تعديلها يحتاج منشأةً، وهي فيها null';
end $$;

-- ---------------------------------------------------------------------------
-- 6) منظور موحّد للبيانات المرجعية
--
-- يجمع القواميس والقيم مع تمييز النظامي عن الخاص، فتقرأه شاشة واحدة بدل
-- استعلام لكل قاموس.
-- ---------------------------------------------------------------------------
create or replace view v_reference_data as
select
  c.id            as category_id,
  c.key           as category_key,
  c.name_ar       as category_name_ar,
  c.name_en       as category_name_en,
  c.organization_id,
  (c.organization_id is null) as is_system,
  v.id            as value_id,
  v.code,
  v.name_ar,
  v.name_en,
  v.parent_value_id,
  v.sort_order,
  v.is_disabled,
  v.extra
from lookup_categories c
left join lookup_values v on v.category_id = c.id;

alter view v_reference_data set (security_invoker = on);
revoke all on v_reference_data from anon;
grant select on v_reference_data to authenticated;

-- عدّاد القيم لكل قاموس — للشاشة
create or replace view v_reference_categories as
select
  c.id,
  c.key,
  c.name_ar,
  c.name_en,
  c.organization_id,
  (c.organization_id is null) as is_system,
  count(v.id)                                          as value_count,
  count(v.id) filter (where not v.is_disabled)         as active_count
from lookup_categories c
left join lookup_values v on v.category_id = c.id
group by c.id, c.key, c.name_ar, c.name_en, c.organization_id;

alter view v_reference_categories set (security_invoker = on);
revoke all on v_reference_categories from anon;
grant select on v_reference_categories to authenticated;

-- [commit; أُزيلت — المعاملة موحَّدة لكل الملف]



-- ###########################################################################
-- ###  0087 — دورة حياة الزيارة وسجلّها
-- ###########################################################################
do $announce$
begin raise notice '▶ 0087 — دورة حياة الزيارة وسجلّها'; end;
$announce$;

-- 0087_visit_lifecycle_and_register.sql
-- المرحلة السابعة: سجل زيارات المرضى — دورة حياة الزيارة وشاشتها التشغيلية.
--
-- الحالة قبل هذا الملف: **`patient_visits` بلا عمود حالة إطلاقًا**. الزيارة
-- إمّا موجودة أو لا. فلا يُعرف أي زيارة ما زالت مفتوحة، ولا أيها وقّعها
-- الطبيب، ولا أيها أُغلق ماليًا. وشاشة «سجل الزيارات» تعرض قائمة بلا حالة
-- لأن الحالة ليست في المخطط.
--
-- ونتيجة ذلك عملية: زيارةٌ بدأها الطبيب ولم يكملها تبدو كزيارة مكتملة
-- تمامًا، ولا تقرير يكشفها.
-- ---------------------------------------------------------------------------

-- [begin; أُزيلت — المعاملة موحَّدة لكل الملف]

-- ---------------------------------------------------------------------------
-- 1) دورة حياة الزيارة
--
--   مخطَّطة → منتظرة → جارية → مكتملة → موقَّعة → مغلقة
--   والاستثناءان: ملغاة، ومعادة الفتح.
--
-- التوقيع فعلٌ سريري (الطبيب يقرّ بما كتبه)، والإغلاق فعلٌ ماليّ (لا فوترة
-- بعده). فصلُهما مقصود: زيارة موقَّعة سريريًا قد تنتظر تسوية تأمين أسابيع.
-- ---------------------------------------------------------------------------
alter table patient_visits
  add column if not exists status        text not null default 'completed',
  add column if not exists started_at    timestamptz,
  add column if not exists ended_at      timestamptz,
  add column if not exists signed_at     timestamptz,
  add column if not exists signed_by     uuid references auth.users(id),
  add column if not exists closed_at     timestamptz,
  add column if not exists closed_by     uuid references auth.users(id),
  add column if not exists reopened_at   timestamptz,
  add column if not exists reopened_by   uuid references auth.users(id),
  add column if not exists reopen_reason text,
  add column if not exists cancel_reason text,
  add column if not exists updated_by    uuid references auth.users(id);

comment on column patient_visits.status is
  'دورة الزيارة: planned مخطَّطة، waiting منتظرة، in_progress جارية، completed مكتملة، signed موقَّعة سريريًا، closed مغلقة ماليًا، cancelled ملغاة.';
comment on column patient_visits.signed_at is
  'توقيع الطبيب على محتوى الزيارة — فعل سريري.';
comment on column patient_visits.closed_at is
  'الإغلاق المالي — لا فوترة بعده. منفصل عن التوقيع عمدًا.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_status_check') then
    alter table patient_visits add constraint patient_visits_status_check check (
      status in ('planned','waiting','in_progress','completed','signed','closed','cancelled')
    );
  end if;
end $$;

create index if not exists idx_visits_status on patient_visits (organization_id, status, visit_date desc);

-- الصفوف القائمة زياراتٌ ماضية: تُعدّ **مكتملة** لا موقَّعة ولا مغلقة.
-- التوقيع والإغلاق فعلان يقوم بهما إنسان، ولا يُستنتجان بأثر رجعي.
update patient_visits set status = 'completed' where status is null;

-- ---------------------------------------------------------------------------
-- 2) الانتقالات
-- ---------------------------------------------------------------------------
create or replace function app_visit_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'planned'     then p_to in ('waiting','in_progress','cancelled')
    when 'waiting'     then p_to in ('in_progress','cancelled')
    when 'in_progress' then p_to in ('completed','cancelled')
    when 'completed'   then p_to in ('signed','in_progress')
    when 'signed'      then p_to in ('closed','in_progress')   -- الأخيرة إعادة فتح
    when 'closed'      then p_to in ('in_progress')            -- إعادة فتح فقط
    else false   -- cancelled نهائية
  end;
$$;

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('visits.view',    'عرض سجل الزيارات',   'visits', 900),
  ('visits.update',  'تعديل الزيارات',     'visits', 902),
  ('visits.sign',    'توقيع الزيارات',     'visits', 904),
  ('visits.close',   'إغلاق الزيارات',     'visits', 906),
  ('visits.reopen',  'إعادة فتح الزيارات', 'visits', 908)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'visits.view'), ('doctor', 'visits.update'), ('doctor', 'visits.sign'),
  ('nurse',          'visits.view'), ('nurse', 'visits.update'),
  ('receptionist',   'visits.view'),
  ('accountant',     'visits.view'), ('accountant', 'visits.close'),
  ('branch_manager', 'visits.view'), ('branch_manager', 'visits.update'),
  ('branch_manager', 'visits.close'), ('branch_manager', 'visits.reopen')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

create or replace function app_set_visit_status(
  p_visit_id uuid,
  p_status   text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit    patient_visits%rowtype;
  v_perm     text;
  v_reopen   boolean;
  v_unbilled int;
begin
  select * into v_visit from patient_visits where id = p_visit_id for update;
  if v_visit.id is null then
    raise exception 'الزيارة غير موجودة';
  end if;
  if not app_is_member(v_visit.organization_id) then
    raise exception 'لا صلاحية';
  end if;
  if v_visit.status = p_status then
    return;
  end if;
  if not app_visit_status_allowed(v_visit.status, p_status) then
    raise exception 'لا يمكن الانتقال من «%» إلى «%»', v_visit.status, p_status;
  end if;

  -- إعادة الفتح: الرجوع من مكتملة أو موقَّعة أو مغلقة إلى جارية.
  v_reopen := p_status = 'in_progress'
              and v_visit.status in ('completed','signed','closed');

  v_perm := case
    when v_reopen              then 'visits.reopen'
    when p_status = 'signed'   then 'visits.sign'
    when p_status = 'closed'   then 'visits.close'
    when p_status = 'cancelled' then 'visits.update'
    else 'visits.update'
  end;

  if not app_has_permission(v_visit.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء (%)', v_perm;
  end if;

  if (v_reopen or p_status = 'cancelled') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'هذا الإجراء يحتاج سببًا مكتوبًا';
  end if;

  -- لا إغلاق ماليّ وثمّة خدمة منفَّذة لم تُفوتَر: الإغلاق يعني «لا فوترة
  -- بعده»، فإغلاقه على خدمة تنتظر الفوترة إسقاطٌ صامت لإيراد.
  if p_status = 'closed' then
    select count(*) into v_unbilled
      from patient_visit_services s
     where s.visit_id = p_visit_id
       and s.status in ('draft','ordered','performed');
    if v_unbilled > 0 then
      raise exception 'بقي % خدمة منفَّذة لم تُفوتَر — فوترها أو ألغِها قبل الإغلاق', v_unbilled;
    end if;
  end if;

  -- لا إلغاء لزيارة عليها فاتورة سارية
  if p_status = 'cancelled' and exists (
       select 1 from sales_invoice_items li
       join sales_invoices i on i.id = li.invoice_id
       join patient_visit_services s on s.id = li.visit_service_id
      where s.visit_id = p_visit_id and i.status <> 'void'
     ) then
    raise exception 'للزيارة فاتورة سارية — ألغِ الفاتورة أولًا';
  end if;

  update patient_visits set
    status = p_status,
    updated_at = now(),
    updated_by = auth.uid(),
    started_at  = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
    ended_at    = case when p_status = 'completed' then now() else ended_at end,
    signed_at   = case when p_status = 'signed' then now()
                       when v_reopen then null else signed_at end,
    signed_by   = case when p_status = 'signed' then auth.uid()
                       when v_reopen then null else signed_by end,
    closed_at   = case when p_status = 'closed' then now()
                       when v_reopen then null else closed_at end,
    closed_by   = case when p_status = 'closed' then auth.uid()
                       when v_reopen then null else closed_by end,
    reopened_at = case when v_reopen then now() else reopened_at end,
    reopened_by = case when v_reopen then auth.uid() else reopened_by end,
    reopen_reason = case when v_reopen then btrim(p_reason) else reopen_reason end,
    cancel_reason = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end
  where id = p_visit_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_visit.organization_id, auth.uid(), 'visits', 'update', p_visit_id,
          'زيارة مريض',
          case when v_reopen then format('إعادة فتح: %s ← %s', v_visit.status, p_status)
               else format('%s ← %s', v_visit.status, p_status) end,
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function app_set_visit_status(uuid, text, text) from public, anon;
grant execute on function app_set_visit_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) الزيارة الموقَّعة أو المغلقة لا تُعدَّل مباشرةً
--
-- التوقيع بلا قفلٍ يليه ليس توقيعًا. من أراد التعديل يعيد الفتح بسبب
-- مسجَّل، فيبقى الأثر.
-- ---------------------------------------------------------------------------
create or replace function app_guard_signed_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status not in ('signed','closed') then
    return new;
  end if;

  -- تغيير الحالة نفسه مسموح (يمرّ بالدالة التي تفحص الصلاحية والسبب).
  if new.status is distinct from old.status then
    return new;
  end if;

  if new.main_complaint is distinct from old.main_complaint
     or new.exam_data is distinct from old.exam_data
     or new.notes is distinct from old.notes
     or new.next_visit_plan is distinct from old.next_visit_plan
     or new.doctor_id is distinct from old.doctor_id
     or new.clinic_id is distinct from old.clinic_id then
    raise exception 'الزيارة % — أعد فتحها بسبب مسجَّل قبل التعديل',
      case old.status when 'signed' then 'موقَّعة' else 'مغلقة' end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_signed_visit on patient_visits;
create trigger trg_guard_signed_visit
  before update on patient_visits
  for each row execute function app_guard_signed_visit();

-- ---------------------------------------------------------------------------
-- 4) منظور السجل التشغيلي
--
-- كل ما تعرضه الشاشة في استعلام واحد. حسابه هنا لا في المتصفّح: الشاشة
-- تعرض مئة صفّ، وحسابُ حالة الفاتورة لكل صفّ هناك مئة استعلام.
-- ---------------------------------------------------------------------------
create or replace view v_visit_register as
select
  v.id,
  v.organization_id,
  v.branch_id,
  b.name              as branch_name,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  p.mobile_number,
  v.doctor_id,
  d.name_ar           as doctor_name,
  v.clinic_id,
  c.name              as clinic_name,
  c.department_id,
  v.appointment_id,
  a.scheduled_start   as appointment_at,
  v.visit_date,
  v.started_at,
  v.ended_at,
  v.status,
  v.signed_at,
  v.signed_by,
  v.closed_at,
  v.closed_by,
  v.reopened_at,
  v.reopen_reason,
  v.main_complaint,
  dx.primary_diagnosis,
  coalesce(svc.service_count, 0)      as service_count,
  coalesce(svc.unbilled_count, 0)     as unbilled_service_count,
  coalesce(svc.total_amount, 0)       as services_amount,
  inv.invoice_id,
  inv.invoice_number,
  inv.invoice_status,
  inv.net_amount                      as invoice_amount,
  inv.remaining_amount,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  claim.claim_status,
  -- زيارة بلا فاتورة وبها خدمات: أول ما يُبحث عنه في مراجعة الإيراد
  (coalesce(svc.service_count, 0) > 0 and inv.invoice_id is null) as has_services_no_invoice,
  v.created_at,
  v.updated_at
from patient_visits v
join patients p on p.id = v.patient_id
left join doctors d on d.id = v.doctor_id
left join clinics c on c.id = v.clinic_id
left join branches b on b.id = v.branch_id
left join appointments a on a.id = v.appointment_id
left join lateral (
  select count(*) as service_count,
         count(*) filter (where s.status in ('draft','ordered','performed')) as unbilled_count,
         sum(s.qty * coalesce(s.unit_price, 0)) as total_amount
    from patient_visit_services s where s.visit_id = v.id
) svc on true
left join lateral (
  select i.id as invoice_id, i.invoice_number, i.status as invoice_status,
         i.net_amount, i.remaining_amount, i.is_insurance_invoice, i.insurance_company_name
    from sales_invoice_items li
    join sales_invoices i on i.id = li.invoice_id
    join patient_visit_services s on s.id = li.visit_service_id
   where s.visit_id = v.id and i.status <> 'void'
   order by i.created_at desc
   limit 1
) inv on true
left join lateral (
  select bi.status as claim_status
    from insurance_claim_batch_items bi
   where bi.sales_invoice_id = inv.invoice_id
   order by bi.id desc
   limit 1
) claim on true
left join lateral (
  select string_agg(coalesce(ic.name_ar, ic.name_en, ic.code), '، ') as primary_diagnosis
    from patient_visit_diagnoses vd
    left join icd10_codes ic on ic.id = vd.icd10_code_id
   where vd.visit_id = v.id
) dx on true;

alter view v_visit_register set (security_invoker = on);
revoke all on v_visit_register from anon;
grant select on v_visit_register to authenticated;

-- ---------------------------------------------------------------------------
-- 5) الزيارات غير المكتملة — ما يجب أن يراه المدير كل صباح
-- ---------------------------------------------------------------------------
create or replace view v_incomplete_visits as
select
  r.*,
  case
    when r.status = 'in_progress' and r.visit_date < current_date then 'زيارة جارية من يوم سابق'
    when r.status = 'completed' and r.visit_date < current_date - 2 then 'مكتملة ولم تُوقَّع'
    when r.has_services_no_invoice then 'خدمات بلا فاتورة'
    when r.unbilled_service_count > 0 then 'خدمات لم تُفوتَر'
    else null
  end as issue,
  (current_date - r.visit_date::date) as days_open
from v_visit_register r
where r.status not in ('closed','cancelled')
  and (
    (r.status = 'in_progress' and r.visit_date < current_date)
    or (r.status = 'completed' and r.visit_date < current_date - 2)
    or r.has_services_no_invoice
    or r.unbilled_service_count > 0
  );

alter view v_incomplete_visits set (security_invoker = on);
revoke all on v_incomplete_visits from anon;
grant select on v_incomplete_visits to authenticated;

-- [commit; أُزيلت — المعاملة موحَّدة لكل الملف]



-- ###########################################################################
-- ###  0088 — الصيدلية والمخزون
-- ###########################################################################
do $announce$
begin raise notice '▶ 0088 — الصيدلية والمخزون'; end;
$announce$;

-- ---------------------------------------------------------------------------
-- 0088 — الصيدلية والمخزون
-- ---------------------------------------------------------------------------
-- المرحلة الثامنة. لا جداول مكرّرة: `drug_details` و`inventory_lots` و
-- `inventory_movements` و`prescriptions` و`dispensing_records` موجودة منذ
-- هجرات سابقة، وهذه الهجرة تُكملها وتُحكمها.
--
-- ما كان مكسورًا قبلها — وكلّه مُثبَت بالاختبار في `e2e/sql/pharmacy-guards.test.sql`:
--
--   1) **المخزون يصير سالبًا.** `app_apply_inventory_movement` كانت تكتب
--      `qty_remaining = qty_remaining - new.qty` بلا فحص. الشاشة تحدّ الكمية
--      بالمتبقّي **من الوصفة** لا بالمتبقّي **من الدفعة**، فصرف ١٠ من دفعة
--      فيها ٣ كان يترك `-7` في القاعدة ولا أحد يعلم.
--   2) **الدواء المنتهي يُصرَف.** `v_available_drug_lots` كانت تشترط
--      `qty_remaining > 0` فقط ولا تنظر إلى `expiry_date` إطلاقًا.
--   3) **الصرف غير ذرّي.** الشاشة كانت تُدرج `dispensing_records` ثم
--      `dispensing_items` في طلبين: فشل الثاني يترك سجل صرف فارغًا، ونجاحه
--      جزئيًا ينقص المخزون لبعض الأدوية دون بعض.
--   4) **لا حجز إطلاقًا.** لا عمود `reserved_quantity` ولا جدول حجوزات: وصفتان
--      تريان الكمية نفسها متاحة.
--   5) **لا FEFO.** الصيدليّ يختار الدفعة يدويًا من قائمة، فيصرف الأبعد
--      انتهاءً ويترك الأقرب حتى ينتهي في الرفّ.
--   6) **الإلغاء لا يُرجع شيئًا.** `dispensing_records.status = 'cancelled'`
--      كان تحديثًا عاديًا لا يُعيد الكمية إلى المخزون ولا ينقص المصروف.
--   7) **الصرف مجّاني.** `unit_price: 0` مثبّتة في الشاشة، فكل حركة صرف
--      قيمتها صفر مهما كان سعر الدواء.
--   8) **لا صلاحيات.** سياسة `FOR ALL` واحدة لكل عضو: موظف الاستقبال يصرف
--      مخدّرًا ويعدّل المخزون ويحذف حركة.
--   9) **تجاوز الموصوف.** لا شيء يمنع `dispensed_quantity` من تجاوز
--      `quantity_prescribed`.
--  10) **خلط المستودعات.** الدفعة المختارة قد تكون في مستودع غير المستودع
--      المسجَّل على سجل الصرف، فتُقيَّد الحركة على مستودع لم يخرج منه شيء.
--
-- لا شيء هنا يخصّ الرسائل النصية.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) بيانات الدواء
-- ===========================================================================

alter table drug_details
  add column if not exists brand_name            text,
  add column if not exists manufacturer          text,
  add column if not exists registration_number   text,
  add column if not exists atc_code              text,
  add column if not exists controlled_drug_class text,
  add column if not exists default_route         text,
  add column if not exists pack_size             numeric,
  add column if not exists storage_conditions    text,
  add column if not exists notes                 text,
  add column if not exists updated_at            timestamptz not null default now(),
  add column if not exists updated_by            uuid references auth.users(id);

comment on column drug_details.controlled_drug_class is
  'تصنيف الرقابة: narcotic مخدّر، psychotropic مؤثّر عقلي، precursor سليفة، controlled_other خاضع لرقابة أخرى. فارغ = غير خاضع.';
-- حدّ إعادة الطلب **لا يُضاف هنا**: `items.reorder_level` موجود منذ هجرة
-- سابقة ويخدم كل الأصناف. عمودٌ ثانٍ لنفس الغرض يعني رقمين يفترقان.
comment on column drug_details.default_route is
  'طريق الإعطاء الافتراضي — يملأ سطر الوصفة، ويظل الطبيب قادرًا على تغييره.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drug_details_controlled_class_check') then
    alter table drug_details add constraint drug_details_controlled_class_check check (
      controlled_drug_class is null
      or controlled_drug_class in ('narcotic','psychotropic','precursor','controlled_other')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drug_details_default_route_check') then
    alter table drug_details add constraint drug_details_default_route_check check (
      default_route is null
      or default_route in ('oral','topical','injection','inhalation','rectal','ophthalmic','otic','nasal','other')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_reorder_level_check') then
    alter table items add constraint items_reorder_level_check
      check (reorder_level is null or reorder_level >= 0) not valid;
  end if;
end $$;

-- الدواء المصنَّف رقابيًا **هو** مخدّر: العلَمان لا يفترقان، وإلّا صار
-- التشديد رهن خانةٍ يسهل نسيانها.
create or replace function app_sync_controlled_flag()
returns trigger
language plpgsql
as $$
begin
  if new.controlled_drug_class is not null then
    new.is_controlled_substance := true;
  elsif new.is_controlled_substance and (tg_op = 'INSERT' or old.is_controlled_substance is distinct from new.is_controlled_substance) then
    -- عُلِّم مخدّرًا بلا تصنيف: يُقبل، لكن التصنيف مطلوب للتقارير الرقابية.
    null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_controlled_flag on drug_details;
create trigger trg_sync_controlled_flag
  before insert or update on drug_details
  for each row execute function app_sync_controlled_flag();

update drug_details set is_controlled_substance = true
 where controlled_drug_class is not null and not is_controlled_substance;

-- ===========================================================================
-- 2) المخزون: الحجز، والسعر، والمورّد، وحالة الدفعة
-- ===========================================================================

alter table inventory_lots
  add column if not exists reserved_quantity numeric not null default 0,
  add column if not exists selling_price     numeric,
  add column if not exists distributor_id    uuid references distributors(id),
  add column if not exists status            text not null default 'available',
  add column if not exists created_by        uuid references auth.users(id),
  add column if not exists updated_at        timestamptz not null default now();

comment on column inventory_lots.reserved_quantity is
  'كمية محجوزة لوصفات لم تُصرَف بعد. المتاح = qty_remaining − reserved_quantity.';
comment on column inventory_lots.status is
  'available متاحة، quarantined محجورة، recalled مسحوبة، expired منتهية. غير المتاحة لا تُصرَف ولا تُحجز.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_status_check') then
    alter table inventory_lots add constraint inventory_lots_status_check
      check (status in ('available','quarantined','recalled','expired'));
  end if;

  -- `not valid`: لا نلمس صفوفًا سالبة خلّفها الخلل القديم — تصحيحها قرار
  -- جردٍ بشريّ لا تخمين هجرة. الجديد كله يُفحص من الآن.
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_qty_nonneg') then
    alter table inventory_lots add constraint inventory_lots_qty_nonneg
      check (qty_remaining >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_reserved_check') then
    alter table inventory_lots add constraint inventory_lots_reserved_check
      check (reserved_quantity >= 0 and reserved_quantity <= qty_remaining) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_org_id_key') then
    alter table inventory_lots add constraint inventory_lots_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'warehouses_org_id_key') then
    alter table warehouses add constraint warehouses_org_id_key unique (organization_id, id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_warehouse_tenant_fk') then
    alter table inventory_lots add constraint inventory_lots_warehouse_tenant_fk
      foreign key (organization_id, warehouse_id) references warehouses(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_item_tenant_fk') then
    alter table inventory_lots add constraint inventory_lots_item_tenant_fk
      foreign key (organization_id, item_id) references items(organization_id, id) not valid;
  end if;
end $$;

-- المورّد وسعر البيع يُشتقّان من سطر فاتورة الشراء التي جاءت بها الدفعة، لا
-- يُكتبان يدويًا: الرابط `purchase_invoice_item_id` موجود منذ 0003 و
-- `purchase_invoice_items.sale_price` كذلك، وكلاهما كان معطَّلًا — فكانت كل
-- دفعة تُسعَّر بسعر الصنف العام مهما اختلفت تكلفتها من مورّد لآخر.
create or replace function app_fill_lot_from_purchase()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src record;
begin
  if new.purchase_invoice_item_id is not null
     and (new.distributor_id is null or new.selling_price is null) then
    select pv.distributor_id, pii.sale_price into v_src
      from purchase_invoice_items pii
      join purchase_invoices pv on pv.id = pii.purchase_invoice_id
     where pii.id = new.purchase_invoice_item_id;
    if found then
      new.distributor_id := coalesce(new.distributor_id, v_src.distributor_id);
      new.selling_price  := coalesce(new.selling_price, nullif(v_src.sale_price, 0));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_lot_from_purchase on inventory_lots;
create trigger trg_fill_lot_from_purchase
  before insert or update of purchase_invoice_item_id on inventory_lots
  for each row execute function app_fill_lot_from_purchase();

update inventory_lots l
   set distributor_id = coalesce(l.distributor_id, pv.distributor_id),
       selling_price  = coalesce(l.selling_price, nullif(pii.sale_price, 0))
  from purchase_invoice_items pii
  join purchase_invoices pv on pv.id = pii.purchase_invoice_id
 where pii.id = l.purchase_invoice_item_id
   and (l.distributor_id is null or l.selling_price is null);

create index if not exists idx_lots_fefo
  on inventory_lots (organization_id, warehouse_id, item_id, expiry_date nulls last)
  where qty_remaining > 0;

-- الدفعة المنتهية تُعلَّم منتهية مرّة واحدة عند أول لمسة، فلا يبقى صنفٌ
-- «متاح» في القاعدة وتاريخه في الماضي.
update inventory_lots
   set status = 'expired'
 where status = 'available' and expiry_date is not null and expiry_date < current_date;

-- ---------------------------------------------------------------------------
-- 2.1) الحركة لا تُنشئ رصيدًا سالبًا ولا تُخرج دواءً منتهيًا
-- ---------------------------------------------------------------------------
create or replace function app_apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lot inventory_lots%rowtype;
begin
  if new.lot_id is null then
    return new;
  end if;

  select * into v_lot from inventory_lots where id = new.lot_id for update;
  if v_lot.id is null then
    raise exception 'دفعة المخزون غير موجودة';
  end if;
  if v_lot.organization_id <> new.organization_id then
    raise exception 'الدفعة تتبع منشأة أخرى';
  end if;
  if v_lot.warehouse_id <> new.warehouse_id then
    raise exception 'الدفعة في مستودع آخر — الحركة تُقيَّد على المستودع الذي خرجت منه فعلًا';
  end if;
  if v_lot.item_id <> new.item_id then
    raise exception 'الدفعة تخصّ صنفًا آخر';
  end if;
  if new.qty <= 0 then
    raise exception 'كمية الحركة يجب أن تكون أكبر من صفر';
  end if;

  if new.movement_type in ('purchase_in','return_in','transfer_in','adjustment_in') then
    update inventory_lots
       set qty_remaining = qty_remaining + new.qty, updated_at = now()
     where id = new.lot_id;

  elsif new.movement_type in ('sale_out','return_out','transfer_out','adjustment_out','consumption_out') then
    -- المحجوز يُطرَح من كل خروج بلا استثناء. الصرف يُحرِّر حجزه **قبل** كتابة
    -- الحركة، فلا يعاقب نفسه؛ وما عداه — تسوية أو مناقلة أو بيع مباشر من
    -- شاشة المخزون — لا يستطيع أن يأكل كميةً محجوزة لوصفة مريض.
    if v_lot.qty_remaining - v_lot.reserved_quantity < new.qty then
      raise exception 'الرصيد لا يكفي: المتاح في الدفعة % (منه % محجوز) والمطلوب %',
        v_lot.qty_remaining, v_lot.reserved_quantity, new.qty;
    end if;
    -- الخروج المنتهي يُمنع إلّا إن كان إتلافًا مقصودًا (adjustment_out).
    if v_lot.expiry_date is not null and v_lot.expiry_date < current_date
       and new.movement_type <> 'adjustment_out' then
      raise exception 'الدفعة منتهية الصلاحية بتاريخ % — لا تُصرَف', v_lot.expiry_date;
    end if;
    update inventory_lots
       set qty_remaining = qty_remaining - new.qty, updated_at = now()
     where id = new.lot_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2.2) لا حذف لحركة مخزون — العكس لا المحو
-- ---------------------------------------------------------------------------
create or replace function app_block_stock_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'حركات المخزون وسجلات الصرف لا تُحذف — استخدم الإلغاء أو حركة عكسية';
end;
$$;

drop trigger if exists trg_block_movement_delete on inventory_movements;
create trigger trg_block_movement_delete before delete on inventory_movements
  for each row execute function app_block_stock_delete();

drop trigger if exists trg_block_dispensing_delete on dispensing_records;
create trigger trg_block_dispensing_delete before delete on dispensing_records
  for each row execute function app_block_stock_delete();

drop trigger if exists trg_block_dispensing_item_delete on dispensing_items;
create trigger trg_block_dispensing_item_delete before delete on dispensing_items
  for each row execute function app_block_stock_delete();

drop trigger if exists trg_block_lot_delete on inventory_lots;
create trigger trg_block_lot_delete before delete on inventory_lots
  for each row execute function app_block_stock_delete();

-- ===========================================================================
-- 3) الحجز
-- ===========================================================================

create table if not exists inventory_reservations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id),
  warehouse_id         uuid not null references warehouses(id),
  lot_id               uuid not null references inventory_lots(id),
  item_id              uuid not null references items(id),
  prescription_id      uuid references prescriptions(id),
  prescription_item_id uuid references prescription_items(id),
  qty                  numeric not null check (qty > 0),
  status               text not null default 'active'
                         check (status in ('active','consumed','released')),
  released_reason      text,
  released_at          timestamptz,
  released_by          uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id)
);

comment on table inventory_reservations is
  'حجز كمية من دفعة لوصفة لم تُصرَف بعد. وجودها يمنع وصفتين من رؤية الكمية نفسها متاحة.';

create index if not exists idx_reservations_active
  on inventory_reservations (organization_id, lot_id) where status = 'active';
create index if not exists idx_reservations_prescription
  on inventory_reservations (prescription_id) where status = 'active';

alter table inventory_reservations enable row level security;

-- `reserved_quantity` مشتقّ: يُحسب من الحجوزات النشطة ولا يُحرَّر يدويًا.
create or replace function app_sync_lot_reservation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lot uuid;
begin
  v_lot := coalesce(new.lot_id, old.lot_id);
  update inventory_lots l
     set reserved_quantity = coalesce((
           select sum(r.qty) from inventory_reservations r
            where r.lot_id = v_lot and r.status = 'active'), 0),
         updated_at = now()
   where l.id = v_lot;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_lot_reservation on inventory_reservations;
create trigger trg_sync_lot_reservation
  after insert or update or delete on inventory_reservations
  for each row execute function app_sync_lot_reservation();

-- ===========================================================================
-- 4) الوصفة: دورة حياة كاملة
-- ===========================================================================

alter table prescriptions
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists warehouse_id         uuid references warehouses(id),
  add column if not exists sent_to_pharmacy_at  timestamptz,
  add column if not exists dispensed_at         timestamptz,
  add column if not exists cancelled_at         timestamptz,
  add column if not exists cancelled_by         uuid references auth.users(id),
  add column if not exists cancel_reason        text,
  add column if not exists created_by           uuid references auth.users(id),
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists updated_by           uuid references auth.users(id);

do $$
begin
  alter table prescriptions drop constraint if exists prescriptions_status_check;
  alter table prescriptions add constraint prescriptions_status_check check (
    status in ('draft','issued','sent_to_pharmacy','partially_dispensed','dispensed','cancelled')
  );
  if not exists (select 1 from pg_constraint where conname = 'prescriptions_org_id_key') then
    alter table prescriptions add constraint prescriptions_org_id_key unique (organization_id, id);
  end if;
end $$;

create index if not exists idx_prescriptions_queue
  on prescriptions (organization_id, status, issued_at desc);

-- `prescription_items` و`dispensing_items` بلا `organization_id`: بلا هذا
-- العمود لا يمكن ربط سطرٍ بدفعةٍ داخل المنشأة نفسها بمفتاح مركّب، ويبقى
-- تسرّبٌ ممكن بين منشأتين على مستوى الجدول.
alter table prescription_items add column if not exists organization_id uuid references organizations(id);
alter table dispensing_items   add column if not exists organization_id uuid references organizations(id);

update prescription_items pi set organization_id = pr.organization_id
  from prescriptions pr where pr.id = pi.prescription_id and pi.organization_id is null;
update dispensing_items di set organization_id = dr.organization_id
  from dispensing_records dr where dr.id = di.dispensing_record_id and di.organization_id is null;

create or replace function app_fill_child_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null then
    if tg_table_name = 'prescription_items' then
      select pr.organization_id into new.organization_id
        from prescriptions pr where pr.id = new.prescription_id;
    else
      select dr.organization_id into new.organization_id
        from dispensing_records dr where dr.id = new.dispensing_record_id;
    end if;
  end if;
  if new.organization_id is null then
    raise exception 'تعذّر تحديد منشأة السطر';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_org_prescription_items on prescription_items;
create trigger trg_fill_org_prescription_items before insert on prescription_items
  for each row execute function app_fill_child_org();

drop trigger if exists trg_fill_org_dispensing_items on dispensing_items;
create trigger trg_fill_org_dispensing_items before insert on dispensing_items
  for each row execute function app_fill_child_org();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispensing_items_lot_tenant_fk') then
    alter table dispensing_items add constraint dispensing_items_lot_tenant_fk
      foreign key (organization_id, lot_id) references inventory_lots(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prescription_items_drug_tenant_fk') then
    alter table prescription_items add constraint prescription_items_drug_tenant_fk
      foreign key (organization_id, drug_item_id) references items(organization_id, id) not valid;
  end if;
end $$;

-- لا صرف يتجاوز الموصوف.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prescription_items_dispensed_check') then
    alter table prescription_items add constraint prescription_items_dispensed_check
      check (dispensed_quantity >= 0 and dispensed_quantity <= quantity_prescribed) not valid;
  end if;
end $$;

-- الحافّات الراجعة (`dispensed → partially_dispensed` وأخواتها) ليست تراجعًا
-- حرًّا: هي المسار الذي يسلكه **إلغاء صرفٍ** حين تعود كميةٌ إلى المخزون فتصير
-- الوصفة ناقصة الصرف من جديد. الإلغاء نفسه محميّ بصلاحيته وسببه.
create or replace function app_prescription_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'               then p_to in ('issued','cancelled')
    when 'issued'              then p_to in ('sent_to_pharmacy','partially_dispensed','dispensed','cancelled')
    when 'sent_to_pharmacy'    then p_to in ('partially_dispensed','dispensed','cancelled','issued')
    when 'partially_dispensed' then p_to in ('dispensed','sent_to_pharmacy','cancelled')
    when 'dispensed'           then p_to in ('partially_dispensed','sent_to_pharmacy')
    else false   -- cancelled نهائية
  end;
$$;

create or replace function app_guard_prescription_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not app_prescription_status_allowed(old.status, new.status) then
    raise exception 'لا يمكن الانتقال بالوصفة من «%» إلى «%»', old.status, new.status;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_prescription_status on prescriptions;
create trigger trg_guard_prescription_status
  before update on prescriptions
  for each row execute function app_guard_prescription_status();

-- إلغاء الوصفة: كانت الحالة `cancelled` معروضة في الشاشة منذ 0015 ولا شيء في
-- النظام كلّه يستطيع ضبطها — شارةٌ لحالةٍ لا سبيل إليها.
create or replace function app_set_prescription_status(
  p_prescription_id uuid,
  p_status          text,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pr prescriptions%rowtype;
begin
  select * into v_pr from prescriptions where id = p_prescription_id for update;
  if v_pr.id is null then raise exception 'الوصفة غير موجودة'; end if;
  if not app_has_permission(v_pr.organization_id, 'pharmacy.prescribe') then
    raise exception 'صلاحيتك لا تسمح بتغيير حالة الوصفة (pharmacy.prescribe)';
  end if;
  if v_pr.status = p_status then return; end if;
  if not app_prescription_status_allowed(v_pr.status, p_status) then
    raise exception 'لا يمكن الانتقال بالوصفة من «%» إلى «%»', v_pr.status, p_status;
  end if;

  if p_status = 'cancelled' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'إلغاء الوصفة يحتاج سببًا مكتوبًا';
    end if;
    -- الإلغاء لا يمحو صرفًا وقع: من أراد إبطاله يُلغي الصرف نفسه فتعود
    -- الكميات بحركة عكسية مسجَّلة.
    if exists (select 1 from dispensing_records r
                where r.prescription_id = p_prescription_id and r.status <> 'cancelled') then
      raise exception 'على الوصفة صرف منفَّذ — ألغِ الصرف أوّلًا لتعود الكميات إلى المخزون';
    end if;
  end if;

  update prescriptions set
    status        = p_status,
    cancelled_at  = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by  = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancel_reason = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end,
    updated_by    = auth.uid()
  where id = p_prescription_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pr.organization_id, auth.uid(), 'pharmacy', 'update', p_prescription_id,
          'وصفة طبية', format('%s ← %s', v_pr.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- ===========================================================================
-- 5) الصلاحيات
-- ===========================================================================

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('pharmacy.view',              'عرض الصيدلية والوصفات',      'pharmacy',  920),
  ('pharmacy.prescribe',         'كتابة الوصفات',              'pharmacy',  922),
  ('pharmacy.dispense',          'صرف الأدوية',                'pharmacy',  924),
  ('pharmacy.dispense_controlled','صرف الأدوية الخاضعة للرقابة','pharmacy',  926),
  ('pharmacy.cancel_dispensing', 'إلغاء صرف وإرجاع المخزون',   'pharmacy',  928),
  ('pharmacy.manage_drugs',      'إدارة بيانات الأدوية',       'pharmacy',  930),
  ('inventory.view',             'عرض المخزون',                'inventory', 940),
  ('inventory.manage',           'إدارة المخزون والدفعات',     'inventory', 942),
  ('inventory.adjust',           'تسوية المخزون',              'inventory', 944)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'pharmacy.view'), ('doctor', 'pharmacy.prescribe'),
  ('nurse',          'pharmacy.view'),
  ('pharmacist',     'pharmacy.view'), ('pharmacist', 'pharmacy.dispense'),
  ('pharmacist',     'pharmacy.dispense_controlled'), ('pharmacist', 'pharmacy.manage_drugs'),
  ('pharmacist',     'inventory.view'), ('pharmacist', 'inventory.manage'),
  ('receptionist',   'pharmacy.view'),
  ('accountant',     'inventory.view'),
  ('branch_manager', 'pharmacy.view'), ('branch_manager', 'pharmacy.cancel_dispensing'),
  ('branch_manager', 'inventory.view'), ('branch_manager', 'inventory.manage'),
  ('branch_manager', 'inventory.adjust')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- سياسة `FOR ALL` واحدة لكل عضو تعني أن موظف الاستقبال يصرف مخدّرًا ويعدّل
-- المخزون. تُستبدل بقراءةٍ للعضو وكتابةٍ بالصلاحية، وبلا سياسة حذف أصلًا.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('inventory_lots',      'inventory.view', 'inventory.manage'),
      ('inventory_movements', 'inventory.view', 'inventory.manage'),
      ('inventory_reservations','inventory.view','pharmacy.dispense'),
      ('prescriptions',       'pharmacy.view',  'pharmacy.prescribe'),
      ('dispensing_records',  'pharmacy.view',  'pharmacy.dispense')
    ) as v(t, pv, pw)
  loop
    execute format('drop policy if exists %I on %I', r.t || '_all_members', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_select', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_insert', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_update', r.t);
    execute format(
      'create policy %I on %I for select using (app_has_permission(organization_id, %L))',
      r.t || '_select', r.t, r.pv);
    execute format(
      'create policy %I on %I for insert with check (app_has_permission(organization_id, %L))',
      r.t || '_insert', r.t, r.pw);
    execute format(
      'create policy %I on %I for update using (app_has_permission(organization_id, %L)) with check (app_has_permission(organization_id, %L))',
      r.t || '_update', r.t, r.pw, r.pw);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('prescription_items', 'prescriptions',      'prescription_id',      'pharmacy.view', 'pharmacy.prescribe'),
      ('dispensing_items',   'dispensing_records', 'dispensing_record_id', 'pharmacy.view', 'pharmacy.dispense')
    ) as v(t, parent, fk, pv, pw)
  loop
    execute format('drop policy if exists %I on %I', r.t || '_all_members', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_select', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_insert', r.t);
    execute format('drop policy if exists %I on %I', r.t || '_update', r.t);
    execute format(
      'create policy %I on %I for select using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_select', r.t, r.parent, r.t, r.fk, r.pv);
    execute format(
      'create policy %I on %I for insert with check (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_insert', r.t, r.parent, r.t, r.fk, r.pw);
    execute format(
      'create policy %I on %I for update using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_update', r.t, r.parent, r.t, r.fk, r.pw);
  end loop;
end $$;

-- الإسقاط بالبحث لا بالتخمين: قائمة أسماء مكتوبة يدويًا تنسى دائمًا اسمًا،
-- وهنا نسيت `drug_details_insert` و`drug_details_update` — فيفشل تشغيل ثانٍ
-- للهجرة برسالة «السياسة موجودة» وهي رسالة تُقلق بلا سبب.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'drug_details'
  loop
    execute format('drop policy if exists %I on drug_details', pol.policyname);
  end loop;
end $$;
create policy drug_details_select on drug_details for select
  using (exists (select 1 from items i where i.id = drug_details.item_id
                   and app_has_permission(i.organization_id, 'pharmacy.view')));
create policy drug_details_insert on drug_details for insert
  with check (exists (select 1 from items i where i.id = drug_details.item_id
                   and app_has_permission(i.organization_id, 'pharmacy.manage_drugs')));
create policy drug_details_update on drug_details for update
  using (exists (select 1 from items i where i.id = drug_details.item_id
                   and app_has_permission(i.organization_id, 'pharmacy.manage_drugs')));

-- ===========================================================================
-- 6) FEFO — الأقرب انتهاءً أوّلًا
-- ===========================================================================

create or replace function app_fefo_lots(
  p_organization_id uuid,
  p_warehouse_id    uuid,
  p_item_id         uuid,
  p_qty             numeric
)
returns table (lot_id uuid, take numeric, expiry_date date, unit_cost numeric, selling_price numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_left numeric := p_qty;
  r      record;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا صلاحية';
  end if;

  for r in
    select l.id, l.qty_remaining, l.reserved_quantity, l.expiry_date, l.unit_cost, l.selling_price
      from inventory_lots l
     where l.organization_id = p_organization_id
       and l.warehouse_id    = p_warehouse_id
       and l.item_id         = p_item_id
       and l.status          = 'available'
       and l.qty_remaining > l.reserved_quantity
       and (l.expiry_date is null or l.expiry_date >= current_date)
     order by l.expiry_date nulls last, l.received_at
  loop
    exit when v_left <= 0;
    lot_id       := r.id;
    take         := least(v_left, r.qty_remaining - r.reserved_quantity);
    expiry_date  := r.expiry_date;
    unit_cost    := r.unit_cost;
    selling_price:= r.selling_price;
    v_left       := v_left - take;
    return next;
  end loop;

  if v_left > 0 then
    raise exception 'الرصيد المتاح لا يكفي: ينقص % وحدة', v_left;
  end if;
end;
$$;

comment on function app_fefo_lots(uuid, uuid, uuid, numeric) is
  'توزيع كمية على دفعات بترتيب الأقرب انتهاءً أوّلًا، متجاوزًا المحجوز والمنتهي وغير المتاح.';

-- ---------------------------------------------------------------------------
-- 6.1) الحجز عند إرسال الوصفة إلى الصيدلية
-- ---------------------------------------------------------------------------
create or replace function app_reserve_prescription(
  p_prescription_id uuid,
  p_warehouse_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pr    prescriptions%rowtype;
  v_item  record;
  v_lot   record;
  v_need  numeric;
  v_short jsonb := '[]'::jsonb;
  v_done  int := 0;
begin
  select * into v_pr from prescriptions where id = p_prescription_id for update;
  if v_pr.id is null then raise exception 'الوصفة غير موجودة'; end if;
  if not app_has_permission(v_pr.organization_id, 'pharmacy.dispense') then
    raise exception 'صلاحيتك لا تسمح بحجز المخزون (pharmacy.dispense)';
  end if;
  if v_pr.status in ('dispensed','cancelled') then
    raise exception 'الوصفة % — لا حجز عليها', v_pr.status;
  end if;
  if not exists (select 1 from warehouses w
                  where w.id = p_warehouse_id and w.organization_id = v_pr.organization_id
                    and not w.is_disabled) then
    raise exception 'المستودع غير صالح أو معطَّل';
  end if;

  for v_item in
    select pi.id, pi.drug_item_id, pi.quantity_prescribed, pi.dispensed_quantity,
           i.name_ar
      from prescription_items pi
      join items i on i.id = pi.drug_item_id
     where pi.prescription_id = p_prescription_id
  loop
    v_need := v_item.quantity_prescribed - v_item.dispensed_quantity
              - coalesce((select sum(r.qty) from inventory_reservations r
                           where r.prescription_item_id = v_item.id and r.status = 'active'), 0);
    continue when v_need <= 0;

    begin
      for v_lot in select * from app_fefo_lots(v_pr.organization_id, p_warehouse_id,
                                               v_item.drug_item_id, v_need)
      loop
        insert into inventory_reservations (
          organization_id, warehouse_id, lot_id, item_id,
          prescription_id, prescription_item_id, qty, created_by)
        values (v_pr.organization_id, p_warehouse_id, v_lot.lot_id, v_item.drug_item_id,
                p_prescription_id, v_item.id, v_lot.take, auth.uid());
        v_done := v_done + 1;
      end loop;
    exception when others then
      -- نقص دواءٍ واحد لا يُبطل حجز البقية: الصيدليّ يحتاج أن يعرف **ماذا**
      -- ينقص، لا أن يُردّ بلا شيء.
      v_short := v_short || jsonb_build_object('drug', v_item.name_ar, 'needed', v_need,
                                               'reason', sqlerrm);
    end;
  end loop;

  update prescriptions
     set status = case when status in ('draft','issued') then 'sent_to_pharmacy' else status end,
         warehouse_id = p_warehouse_id,
         sent_to_pharmacy_at = coalesce(sent_to_pharmacy_at, now()),
         updated_at = now(), updated_by = auth.uid()
   where id = p_prescription_id;

  return jsonb_build_object('reserved_lines', v_done, 'shortages', v_short);
end;
$$;

create or replace function app_release_prescription_reservations(
  p_prescription_id uuid,
  p_reason          text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_n   int;
begin
  select organization_id into v_org from prescriptions where id = p_prescription_id;
  if v_org is null then raise exception 'الوصفة غير موجودة'; end if;
  if not app_has_permission(v_org, 'pharmacy.dispense') then
    raise exception 'صلاحيتك لا تسمح بفكّ الحجز (pharmacy.dispense)';
  end if;

  update inventory_reservations
     set status = 'released', released_at = now(), released_by = auth.uid(),
         released_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where prescription_id = p_prescription_id and status = 'active';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- الوصفة الملغاة تُفكّ حجوزها فورًا. بلا هذا يبقى دواءُ مريضٍ أُلغيت وصفته
-- محجوزًا إلى الأبد، فينفد المتاح على مرضى آخرين ولا شيء يفسّر السبب.
create or replace function app_release_on_prescription_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update inventory_reservations
       set status = 'released', released_at = now(), released_by = auth.uid(),
           released_reason = 'إلغاء الوصفة'
     where prescription_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_on_prescription_cancel on prescriptions;
create trigger trg_release_on_prescription_cancel
  after update of status on prescriptions
  for each row execute function app_release_on_prescription_cancel();

-- ===========================================================================
-- 7) الصرف — عملية ذرّية واحدة
-- ===========================================================================
create or replace function app_dispense_prescription(
  p_prescription_id uuid,
  p_warehouse_id    uuid,
  p_lines           jsonb,          -- [{"prescription_item_id":"…","qty":2}]
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pr        prescriptions%rowtype;
  v_record_id uuid;
  v_line      jsonb;
  v_item      record;
  v_lot       record;
  v_qty       numeric;
  v_remaining numeric;
  v_price     numeric;
  v_ctrl      boolean := false;
  v_ctrl_names text := '';
  v_lines_n   int := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'حدّد دواءً واحدًا على الأقل وكميته';
  end if;

  select * into v_pr from prescriptions where id = p_prescription_id for update;
  if v_pr.id is null then raise exception 'الوصفة غير موجودة'; end if;
  if not app_has_permission(v_pr.organization_id, 'pharmacy.dispense') then
    raise exception 'صلاحيتك لا تسمح بالصرف (pharmacy.dispense)';
  end if;
  if v_pr.status in ('dispensed','cancelled') then
    raise exception 'الوصفة % — لا صرف عليها', v_pr.status;
  end if;
  if not exists (select 1 from warehouses w
                  where w.id = p_warehouse_id and w.organization_id = v_pr.organization_id
                    and not w.is_disabled) then
    raise exception 'المستودع غير صالح أو معطَّل';
  end if;

  insert into dispensing_records (
    organization_id, prescription_id, patient_id, warehouse_id,
    pharmacist_id, status, notes)
  values (v_pr.organization_id, p_prescription_id, v_pr.patient_id, p_warehouse_id,
          auth.uid(), 'completed', nullif(btrim(coalesce(p_notes,'')), ''))
  returning id into v_record_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    continue when v_qty <= 0;

    select pi.id, pi.drug_item_id, pi.quantity_prescribed, pi.dispensed_quantity,
           i.name_ar, i.price,
           coalesce(d.is_controlled_substance, false) as controlled,
           coalesce(d.requires_prescription, true)    as rx_only,
           i.is_archived, i.is_disabled
      into v_item
      from prescription_items pi
      join items i on i.id = pi.drug_item_id
      left join drug_details d on d.item_id = pi.drug_item_id
     where pi.id = (v_line->>'prescription_item_id')::uuid
       and pi.prescription_id = p_prescription_id;

    if v_item.id is null then
      raise exception 'سطر الوصفة غير موجود في هذه الوصفة';
    end if;
    if v_item.is_archived or v_item.is_disabled then
      raise exception 'الدواء «%» مؤرشف أو معطَّل — لا يُصرَف', v_item.name_ar;
    end if;

    v_remaining := v_item.quantity_prescribed - v_item.dispensed_quantity;
    if v_qty > v_remaining then
      raise exception 'الكمية المطلوبة من «%» (%) تتجاوز المتبقّي من الوصفة (%)',
        v_item.name_ar, v_qty, v_remaining;
    end if;

    if v_item.controlled then
      if not app_has_permission(v_pr.organization_id, 'pharmacy.dispense_controlled') then
        raise exception 'الدواء «%» خاضع للرقابة — يحتاج صلاحية pharmacy.dispense_controlled',
          v_item.name_ar;
      end if;
      v_ctrl := true;
      v_ctrl_names := v_ctrl_names || case when v_ctrl_names = '' then '' else '، ' end || v_item.name_ar;
    end if;

    -- الحجوزات النشطة لهذا السطر تُستهلك أوّلًا، فلا يُحجز شيء مرّتين.
    update inventory_reservations
       set status = 'consumed'
     where prescription_item_id = v_item.id and status = 'active';

    for v_lot in select * from app_fefo_lots(v_pr.organization_id, p_warehouse_id,
                                             v_item.drug_item_id, v_qty)
    loop
      v_price := coalesce(v_lot.selling_price, v_item.price, 0);
      insert into dispensing_items (
        organization_id, dispensing_record_id, prescription_item_id, drug_item_id,
        lot_id, quantity_dispensed, unit_price)
      values (v_pr.organization_id, v_record_id, v_item.id, v_item.drug_item_id,
              v_lot.lot_id, v_lot.take, v_price);
      v_lines_n := v_lines_n + 1;
    end loop;
  end loop;

  if v_lines_n = 0 then
    raise exception 'لم يُصرَف شيء — راجع الكميات';
  end if;

  update prescriptions
     set dispensed_at = case when (select bool_and(dispensed_quantity >= quantity_prescribed)
                                     from prescription_items where prescription_id = p_prescription_id)
                             then now() else dispensed_at end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_prescription_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_pr.organization_id, auth.uid(), 'pharmacy', 'add', v_record_id,
          'صرف أدوية',
          case when v_ctrl then format('صرف يشمل أدوية خاضعة للرقابة: %s', v_ctrl_names)
               else format('صرف %s سطرًا', v_lines_n) end);

  return v_record_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.1) الإلغاء — إرجاعٌ بحركة عكسية، لا حذف
-- ---------------------------------------------------------------------------
create or replace function app_cancel_dispensing(
  p_record_id uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec dispensing_records%rowtype;
  v_it  record;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'إلغاء الصرف يحتاج سببًا مكتوبًا';
  end if;

  select * into v_rec from dispensing_records where id = p_record_id for update;
  if v_rec.id is null then raise exception 'سجل الصرف غير موجود'; end if;
  if not app_has_permission(v_rec.organization_id, 'pharmacy.cancel_dispensing') then
    raise exception 'صلاحيتك لا تسمح بإلغاء الصرف (pharmacy.cancel_dispensing)';
  end if;
  if v_rec.status = 'cancelled' then
    raise exception 'سجل الصرف ملغى أصلًا';
  end if;
  if v_rec.sales_invoice_id is not null and exists (
       select 1 from sales_invoices i where i.id = v_rec.sales_invoice_id and i.status <> 'void') then
    raise exception 'على الصرف فاتورة سارية — ألغِ الفاتورة أولًا';
  end if;

  for v_it in select * from dispensing_items where dispensing_record_id = p_record_id
  loop
    insert into inventory_movements (
      organization_id, warehouse_id, item_id, lot_id, movement_type,
      qty, unit_price, total_amount, patient_id, note, created_by)
    values (v_rec.organization_id, v_rec.warehouse_id, v_it.drug_item_id, v_it.lot_id,
            'return_in', v_it.quantity_dispensed, v_it.unit_price,
            v_it.quantity_dispensed * v_it.unit_price, v_rec.patient_id,
            format('إرجاع صرف ملغى: %s', btrim(p_reason)), auth.uid());

    if v_it.prescription_item_id is not null then
      update prescription_items
         set dispensed_quantity = greatest(0, dispensed_quantity - v_it.quantity_dispensed)
       where id = v_it.prescription_item_id;
    end if;
  end loop;

  update dispensing_records
     set status = 'cancelled',
         notes = concat_ws(' | ', notes, 'ألغي: ' || btrim(p_reason))
   where id = p_record_id;

  if v_rec.prescription_id is not null then
    update prescriptions p
       set status = case
             when (select bool_and(dispensed_quantity >= quantity_prescribed)
                     from prescription_items where prescription_id = p.id) then 'dispensed'
             when (select bool_or(dispensed_quantity > 0)
                     from prescription_items where prescription_id = p.id) then 'partially_dispensed'
             else 'sent_to_pharmacy' end,
           dispensed_at = null,
           updated_at = now(), updated_by = auth.uid()
     where p.id = v_rec.prescription_id and p.status <> 'cancelled';
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_rec.organization_id, auth.uid(), 'pharmacy', 'update', p_record_id,
          'صرف أدوية', 'إلغاء صرف وإرجاع المخزون', btrim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.2) سجل الصرف لا يُعدَّل بعد إنشائه
-- ---------------------------------------------------------------------------
create or replace function app_guard_dispensing_item()
returns trigger
language plpgsql
as $$
begin
  raise exception 'سطور الصرف لا تُعدَّل — ألغِ الصرف وأعده';
end;
$$;

drop trigger if exists trg_guard_dispensing_item on dispensing_items;
create trigger trg_guard_dispensing_item before update on dispensing_items
  for each row execute function app_guard_dispensing_item();

-- ---------------------------------------------------------------------------
-- 7.3) تسوية المخزون — الطريق المشروع الوحيد لتغيير رصيد بلا صرف
-- ---------------------------------------------------------------------------
create or replace function app_adjust_stock(
  p_lot_id uuid,
  p_qty    numeric,               -- موجب زيادة، سالب نقص
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lot inventory_lots%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'التسوية تحتاج سببًا مكتوبًا';
  end if;
  if p_qty = 0 then
    raise exception 'كمية التسوية لا تكون صفرًا';
  end if;

  select * into v_lot from inventory_lots where id = p_lot_id for update;
  if v_lot.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if not app_has_permission(v_lot.organization_id, 'inventory.adjust') then
    raise exception 'صلاحيتك لا تسمح بالتسوية (inventory.adjust)';
  end if;
  if p_qty < 0 and v_lot.qty_remaining + p_qty < v_lot.reserved_quantity then
    raise exception 'لا يمكن النقص دون الكمية المحجوزة (%)', v_lot.reserved_quantity;
  end if;

  insert into inventory_movements (
    organization_id, warehouse_id, item_id, lot_id, movement_type,
    qty, unit_price, total_amount, note, created_by)
  values (v_lot.organization_id, v_lot.warehouse_id, v_lot.item_id, p_lot_id,
          case when p_qty > 0 then 'adjustment_in' else 'adjustment_out' end,
          abs(p_qty), v_lot.unit_cost, abs(p_qty) * v_lot.unit_cost,
          btrim(p_reason), auth.uid());

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_lot.organization_id, auth.uid(), 'inventory', 'update', p_lot_id,
          'دفعة مخزون', format('تسوية %s', p_qty), btrim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.4) حفظ بيانات دواء — الصنف وتفاصيله في نداء واحد
-- ---------------------------------------------------------------------------
create or replace function app_save_drug(
  p_organization_id uuid,
  p_item_id         uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid := p_item_id;
  v_payload jsonb := p_payload;
begin
  if not app_has_permission(p_organization_id, 'pharmacy.manage_drugs') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوية (pharmacy.manage_drugs)';
  end if;

  -- الدمج قبل التحقق: التحديث الجزئي لا يمحو ما لم يُرسَل.
  if v_id is not null then
    select to_jsonb(i) || v_payload into v_payload
      from items i where i.id = v_id and i.organization_id = p_organization_id;
    if v_payload is null then
      raise exception 'الدواء غير موجود في هذه المنشأة';
    end if;
    -- `select into` بلا صفوف **يُفرِغ الهدف**: لولا هذا الشرط لصار الدمج
    -- محوًا كاملًا لصنفٍ لا سطر تفاصيل له بعد.
    if exists (select 1 from drug_details d where d.item_id = v_id) then
      select v_payload || to_jsonb(d) || p_payload into v_payload
        from drug_details d where d.item_id = v_id;
    end if;
  end if;

  if coalesce(btrim(v_payload->>'name_ar'), '') = '' then
    raise exception 'اسم الدواء مطلوب';
  end if;
  if coalesce(btrim(v_payload->>'code'), '') = '' then
    raise exception 'كود الدواء مطلوب';
  end if;

  -- الدواء يُتتبَّع مخزونًا وصلاحيةً دائمًا: بلا ذلك لا معنى لدفعة ولا لتاريخ
  -- انتهاء، وهما جوهر صرف الدواء.
  if v_id is null then
    insert into items (organization_id, item_type, code, name_ar, name_en, unit,
                       price, cost_price, reorder_level, track_inventory, track_expiry)
    values (p_organization_id, 'drug',
            btrim(v_payload->>'code'), btrim(v_payload->>'name_ar'), v_payload->>'name_en',
            coalesce(v_payload->>'unit', 'علبة'),
            coalesce((v_payload->>'price')::numeric, 0),
            (v_payload->>'cost_price')::numeric,
            coalesce((v_payload->>'reorder_level')::numeric, 0), true, true)
    returning id into v_id;
  else
    update items set
      code    = btrim(v_payload->>'code'),
      name_ar = btrim(v_payload->>'name_ar'),
      name_en = v_payload->>'name_en',
      unit    = coalesce(v_payload->>'unit', unit),
      price   = coalesce((v_payload->>'price')::numeric, price),
      cost_price = coalesce((v_payload->>'cost_price')::numeric, cost_price),
      reorder_level = coalesce((v_payload->>'reorder_level')::numeric, reorder_level),
      track_inventory = true,
      track_expiry    = true,
      updated_at = now()
    where id = v_id and organization_id = p_organization_id;
  end if;

  insert into drug_details (
    item_id, generic_name, brand_name, dosage_form, strength_text, manufacturer,
    registration_number, atc_code, controlled_drug_class, default_route, pack_size,
    storage_conditions, requires_prescription, default_dosage_instructions,
    notes, updated_by)
  values (
    v_id, v_payload->>'generic_name', v_payload->>'brand_name',
    coalesce(v_payload->>'dosage_form', 'tablet'), v_payload->>'strength_text',
    v_payload->>'manufacturer', v_payload->>'registration_number', v_payload->>'atc_code',
    nullif(btrim(coalesce(v_payload->>'controlled_drug_class','')), ''),
    nullif(btrim(coalesce(v_payload->>'default_route','')), ''),
    (v_payload->>'pack_size')::numeric, v_payload->>'storage_conditions',
    coalesce((v_payload->>'requires_prescription')::boolean, true),
    v_payload->>'default_dosage_instructions', v_payload->>'notes', auth.uid())
  on conflict (item_id) do update set
    generic_name        = excluded.generic_name,
    brand_name          = excluded.brand_name,
    dosage_form         = excluded.dosage_form,
    strength_text       = excluded.strength_text,
    manufacturer        = excluded.manufacturer,
    registration_number = excluded.registration_number,
    atc_code            = excluded.atc_code,
    controlled_drug_class = excluded.controlled_drug_class,
    default_route       = excluded.default_route,
    pack_size           = excluded.pack_size,
    storage_conditions  = excluded.storage_conditions,
    requires_prescription = excluded.requires_prescription,
    default_dosage_instructions = excluded.default_dosage_instructions,
    notes               = excluded.notes,
    updated_by          = excluded.updated_by;

  return v_id;
end;
$$;

-- ===========================================================================
-- 8) المناظير
-- ===========================================================================

drop view if exists v_available_drug_lots;
create view v_available_drug_lots
with (security_invoker = on) as
select
  l.id                                   as lot_id,
  l.organization_id,
  l.warehouse_id,
  w.name                                 as warehouse_name,
  l.item_id,
  i.name_ar                              as drug_name,
  l.lot_number,
  l.qty_remaining,
  l.reserved_quantity,
  l.qty_remaining - l.reserved_quantity   as qty_available,
  l.expiry_date,
  case when l.expiry_date is null then null
       else (l.expiry_date - current_date) end as days_to_expiry,
  l.unit_cost,
  coalesce(l.selling_price, i.price)      as selling_price,
  l.status,
  d.is_controlled_substance,
  d.controlled_drug_class
from inventory_lots l
join items i      on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join drug_details d on d.item_id = l.item_id
where i.item_type = 'drug'
  and not i.is_archived
  and l.status = 'available'
  and l.qty_remaining > l.reserved_quantity
  and (l.expiry_date is null or l.expiry_date >= current_date)
order by l.expiry_date nulls last, l.received_at;

comment on view v_available_drug_lots is
  'الدفعات القابلة للصرف فعلًا: غير منتهية، متاحة، وبعد طرح المحجوز. مرتّبة FEFO.';

-- المنظور القديم يُرشِّح `status in ('issued','partially_dispensed')`. الحالة
-- الجديدة `sent_to_pharmacy` تقع خارجه، فلولا هذا التعديل لسقط عدّاد شارة
-- الصيدلية إلى صفر **في اللحظة التي يصل فيها العمل** — أسوأ لحظة ممكنة.
create or replace view v_prescriptions_pending_dispensing
with (security_invoker = on) as
select
  pr.id            as prescription_id,
  pr.organization_id,
  pr.patient_id,
  p.name_ar        as patient_name,
  pr.doctor_id,
  d.name_ar        as doctor_name,
  pr.status,
  pr.issued_at,
  count(pi.id)     as items_count,
  count(pi.id) filter (where pi.dispensed_quantity >= pi.quantity_prescribed)
                   as fully_dispensed_items_count
from prescriptions pr
join patients p on p.id = pr.patient_id
left join doctors d on d.id = pr.doctor_id
left join prescription_items pi on pi.prescription_id = pr.id
where pr.status in ('issued','sent_to_pharmacy','partially_dispensed')
group by pr.id, pr.organization_id, pr.patient_id, p.name_ar, pr.doctor_id,
         d.name_ar, pr.status, pr.issued_at;

drop view if exists v_pharmacy_queue;
create view v_pharmacy_queue
with (security_invoker = on) as
select
  p.id                     as prescription_id,
  p.organization_id,
  p.branch_id,
  p.status,
  p.issued_at,
  p.sent_to_pharmacy_at,
  p.warehouse_id,
  pt.id                    as patient_id,
  pt.name_ar               as patient_name,
  pt.file_number,
  doc.name_ar              as doctor_name,
  c.name                   as clinic_name,
  count(pi.id)                                                   as lines_count,
  count(pi.id) filter (where pi.dispensed_quantity >= pi.quantity_prescribed) as lines_done,
  sum(pi.quantity_prescribed - pi.dispensed_quantity)            as qty_pending,
  bool_or(coalesce(dd.is_controlled_substance, false))           as has_controlled,
  coalesce((select sum(r.qty) from inventory_reservations r
             where r.prescription_id = p.id and r.status = 'active'), 0) as qty_reserved,
  p.is_billed
from prescriptions p
join patients pt on pt.id = p.patient_id
left join doctors doc on doc.id = p.doctor_id
left join clinics c   on c.id = p.clinic_id
left join prescription_items pi on pi.prescription_id = p.id
left join drug_details dd on dd.item_id = pi.drug_item_id
where p.status in ('issued','sent_to_pharmacy','partially_dispensed')
group by p.id, pt.id, pt.name_ar, pt.file_number, doc.name_ar, c.name;

comment on view v_pharmacy_queue is
  'طابور الصيدلية: الوصفات المفتوحة مع الكمية المتبقّية والمحجوزة وعلَم الرقابة.';

drop view if exists v_stock_alerts;
create view v_stock_alerts
with (security_invoker = on) as
select
  l.organization_id,
  l.warehouse_id,
  w.name        as warehouse_name,
  l.item_id,
  i.name_ar     as item_name,
  i.code        as item_code,
  l.id          as lot_id,
  l.lot_number,
  l.qty_remaining,
  l.expiry_date,
  (l.expiry_date - current_date) as days_to_expiry,
  coalesce(i.reorder_level, 0)   as reorder_level,
  case
    when l.expiry_date is not null and l.expiry_date <  current_date then 'expired'
    when l.expiry_date is not null and l.expiry_date <= current_date + 90 then 'expiring_soon'
    else 'low_stock'
  end as alert_type,
  case
    when l.expiry_date is not null and l.expiry_date <  current_date then 'دفعة منتهية وبها رصيد'
    when l.expiry_date is not null and l.expiry_date <= current_date + 90 then 'تنتهي خلال ٩٠ يومًا'
    else 'الرصيد دون حدّ إعادة الطلب'
  end as alert_label
from inventory_lots l
join items i      on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join drug_details d on d.item_id = l.item_id
where l.qty_remaining > 0
  and not i.is_archived
  and (
    (l.expiry_date is not null and l.expiry_date <= current_date + 90)
    or (coalesce(i.reorder_level, 0) > 0 and (
          select coalesce(sum(l2.qty_remaining), 0) from inventory_lots l2
           where l2.item_id = l.item_id and l2.warehouse_id = l.warehouse_id
             and l2.status = 'available'
        ) <= i.reorder_level)
  );

comment on view v_stock_alerts is
  'تنبيهات المخزون: منتهية بها رصيد، تنتهي خلال ٩٠ يومًا، أو رصيد دون حدّ إعادة الطلب.';

drop view if exists v_drug_catalog;
create view v_drug_catalog
with (security_invoker = on) as
select
  i.id                as item_id,
  i.organization_id,
  i.code,
  i.name_ar,
  i.name_en,
  i.unit,
  i.price,
  i.cost_price,
  i.reorder_level,
  i.is_disabled,
  i.is_archived,
  d.generic_name,
  d.brand_name,
  d.dosage_form,
  d.strength_text,
  d.manufacturer,
  d.registration_number,
  d.atc_code,
  d.default_route,
  d.pack_size,
  d.storage_conditions,
  d.requires_prescription,
  d.is_controlled_substance,
  d.controlled_drug_class,
  d.default_dosage_instructions,
  coalesce((select sum(l.qty_remaining) from inventory_lots l
             where l.item_id = i.id and l.status = 'available'), 0) as stock_on_hand,
  coalesce((select sum(l.reserved_quantity) from inventory_lots l
             where l.item_id = i.id and l.status = 'available'), 0) as stock_reserved
from items i
left join drug_details d on d.item_id = i.id
where i.item_type = 'drug';

comment on view v_drug_catalog is
  'كتالوج الأدوية: الصنف وتفاصيله الدوائية ورصيده. الشاشات تُرشِّح المؤرشف بنفسها.';

-- ===========================================================================
-- 9) الأذونات
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_fefo_lots','app_reserve_prescription',
                         'app_release_prescription_reservations','app_dispense_prescription',
                         'app_cancel_dispensing','app_adjust_stock','app_save_drug',
                         'app_prescription_status_allowed','app_set_prescription_status')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

grant select on v_available_drug_lots, v_pharmacy_queue, v_stock_alerts, v_drug_catalog
  to authenticated;

-- الجداول الجديدة تحتاج منحًا صريحًا: 0078 منحت ما كان موجودًا يومها، وما
-- يُنشأ بعدها لا يرثه — فيصير الجدول محميًّا بـ«permission denied» لا بـRLS،
-- ورسالةٌ كهذه تُقرأ كعطل لا كمنع.
grant select, insert, update on inventory_reservations to authenticated;

-- ===========================================================================
-- 10) فحص ذاتي — الهجرة تُسقط نفسها إن لم تُحكم ما جاءت لتحكمه
-- ===========================================================================
do $$
declare
  v_bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where tablename in ('inventory_lots','inventory_movements','prescriptions',
                       'dispensing_records','prescription_items','dispensing_items','drug_details')
     and cmd in ('ALL','DELETE');
  if v_bad is not null then
    raise exception 'بقيت سياسة واسعة على جداول الصيدلية: %', v_bad;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_block_movement_delete') then
    raise exception 'حارس حذف حركات المخزون غير مركَّب';
  end if;

  if exists (select 1 from pg_views where schemaname = 'public'
              and viewname = 'v_available_drug_lots'
              and definition not like '%expiry_date%') then
    raise exception 'منظور الدفعات المتاحة لا يفحص الصلاحية';
  end if;
end $$;



-- ###########################################################################
-- ###  0089 — التأمين والعقود والمطالبات
-- ###########################################################################
do $announce$
begin raise notice '▶ 0089 — التأمين والعقود والمطالبات'; end;
$announce$;

-- ---------------------------------------------------------------------------
-- 0089 — التأمين والمطالبات
-- ---------------------------------------------------------------------------
-- المرحلة التاسعة. لا جداول مكرّرة: `insurance_companies` و
-- `insurance_policies` و`patient_insurance_memberships` و
-- `insurance_preauthorizations` و`insurance_claim_forms` و
-- `insurance_claim_batches` كلها موجودة منذ 0016، وهذه الهجرة تُكملها.
--
-- ما كان مكسورًا أو مفقودًا قبلها:
--
--   1) **ثقب أمني في الموافقات المسبقة.** `app_check_service_eligibility`
--      كانت تقبل **أيّ** موافقة معتمدة للمريض خلال ٩٠ يومًا، ولا تنظر إلى
--      الخدمة التي صدرت لأجلها — والجدول أصلًا **بلا عمود `item_id`**.
--      موافقةٌ واحدة على رنين مغناطيسي كانت تفتح كلّ خدمة تشترط موافقة، لأيّ
--      مبلغ، لثلاثة أشهر.
--   2) **لا عقود.** لا شيء يربط شركة تأمين بقائمة أسعار متفق عليها ولا بمدّة
--      سريان: التسعير كان يقفز مباشرةً إلى «قائمة التأمين» بلا عقدٍ يحكمها.
--   3) **لا تغطية ولا استثناءات.** لا جدول يقول إن خدمةً غير مغطّاة، أو إن
--      نسبة تحمّلها تختلف، أو إن لها سقفًا أو عددًا سنويًا.
--   4) **السقوف غير مستهلَكة.** `default_max_amount` و
--      `default_consultation_limit` و`max_amount_override` موجودة منذ 0016
--      و**لا شيء يحسب كم استُهلك منها**، فالسقف رقم مكتوب لا حدّ فعليّ.
--   5) **لا رفض ولا إعادة تقديم.** `insurance_claim_forms.status` فيه
--      `rejected` بلا `rejection_reason` ولا رابط لإعادة التقديم: المطالبة
--      المرفوضة طريق مسدود.
--   6) **السعر غير مجمَّد.** `sales_invoice_items` لا تحفظ من أين جاء السعر،
--      فتعديل قائمة الأسعار غدًا يجعل فاتورة الأمس بلا تفسير.
--
-- **NPHIES:** تُضاف الحقول التي تحتاجها المنصّة (معرّف الدافع، معرّف الطلب،
-- حالة المزامنة) ولا يُضاف أيّ تكامل ولا أيّ نداء خارجيّ. الحقول جاهزة،
-- والوصل قرار لاحق.
--
-- لا شيء هنا يخصّ الرسائل النصية.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الشبكات وفئات البوالص
-- ===========================================================================

alter table insurance_companies
  add column if not exists code             text,
  add column if not exists nphies_payer_id  text,
  add column if not exists nphies_enabled   boolean not null default false,
  add column if not exists claim_email      text,
  add column if not exists payment_terms_days integer,
  add column if not exists created_by       uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now(),
  add column if not exists updated_by       uuid references auth.users(id);

comment on column insurance_companies.nphies_payer_id is
  'معرّف الدافع في منصّة نفيس. حقل بيانات فقط — لا تكامل ولا نداء خارجيّ في هذه الهجرة.';

create table if not exists insurance_networks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  company_id      uuid not null references insurance_companies(id),
  code            text,
  name_ar         text not null,
  name_en         text,
  description_ar  text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

comment on table insurance_networks is
  'شبكة مزوّدي الخدمة داخل شركة تأمين (VIP، A، B…). البوليصة تنتمي إلى شبكة، والشبكة تحدّد أيّ المنشآت مشمولة.';

alter table insurance_networks enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_companies_org_id_key') then
    alter table insurance_companies add constraint insurance_companies_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_networks_org_id_key') then
    alter table insurance_networks add constraint insurance_networks_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_networks_company_tenant_fk') then
    alter table insurance_networks add constraint insurance_networks_company_tenant_fk
      foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_policies_org_id_key') then
    alter table insurance_policies add constraint insurance_policies_org_id_key unique (organization_id, id);
  end if;
end $$;

alter table insurance_policies
  add column if not exists network_id      uuid references insurance_networks(id),
  add column if not exists class_value_id  uuid references lookup_values(id),
  add column if not exists effective_from  date,
  add column if not exists effective_to    date,
  add column if not exists annual_limit    numeric,
  add column if not exists deductible_amount numeric,
  add column if not exists notes           text,
  add column if not exists created_by      uuid references auth.users(id),
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists updated_by      uuid references auth.users(id);

comment on column insurance_policies.annual_limit is
  'السقف السنوي للبوليصة. الاستهلاك يُحسب في v_membership_limit_usage — لا يُكتب يدويًا.';

-- فئات البوالص قائمةُ بحثٍ لا جدولٌ خاص: 0086 أنشأ نظام القوائم، وإضافة
-- جدولٍ رابع لأربع كلمات إسرافٌ يزيد التعقيد بلا مقابل.
insert into lookup_categories (organization_id, key, name_ar, name_en)
select null, 'insurance_policy_classes', 'فئات البوالص التأمينية', 'Insurance Policy Classes'
where not exists (select 1 from lookup_categories
                   where key = 'insurance_policy_classes' and organization_id is null);

insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
select c.id, v.code, v.ar, v.en, v.ord
  from lookup_categories c
  cross join (values
    ('vip', 'كبار الشخصيات', 'VIP', 10),
    ('a',   'الفئة أ', 'Class A', 20),
    ('b',   'الفئة ب', 'Class B', 30),
    ('c',   'الفئة ج', 'Class C', 40),
    ('d',   'الفئة د', 'Class D', 50)
  ) as v(code, ar, en, ord)
 where c.key = 'insurance_policy_classes' and c.organization_id is null
   and not exists (select 1 from lookup_values lv
                    where lv.category_id = c.id and lv.code = v.code);

-- ===========================================================================
-- 2) العقود
-- ===========================================================================

create table if not exists insurance_contracts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  company_id            uuid not null references insurance_companies(id),
  network_id            uuid references insurance_networks(id),
  contract_number       text,
  name_ar               text not null,
  name_en               text,
  price_list_id         uuid references price_lists(id),
  discount_percent      numeric not null default 0
                          check (discount_percent >= 0 and discount_percent <= 100),
  default_copay_percent numeric check (default_copay_percent >= 0 and default_copay_percent <= 100),
  payment_terms_days    integer,
  claim_submission_days integer,
  effective_from        date not null default current_date,
  effective_to          date,
  status                text not null default 'active'
                          check (status in ('draft','active','suspended','expired','terminated')),
  termination_reason    text,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),
  constraint insurance_contracts_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

comment on table insurance_contracts is
  'عقد المنشأة مع شركة تأمين: قائمة الأسعار المتفق عليها، والخصم، ونسبة التحمّل الافتراضية، ومدّة السريان.';

alter table insurance_contracts enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_org_id_key') then
    alter table insurance_contracts add constraint insurance_contracts_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_company_tenant_fk') then
    alter table insurance_contracts add constraint insurance_contracts_company_tenant_fk
      foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_price_list_tenant_fk') then
    alter table insurance_contracts add constraint insurance_contracts_price_list_tenant_fk
      foreign key (organization_id, price_list_id) references price_lists(organization_id, id) not valid;
  end if;

  -- عقدان ساريان للشركة نفسها في اليوم نفسه يعني سعرين لخدمة واحدة ولا قاعدة
  -- تختار بينهما. المنع في المحرّك لا في الواجهة.
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_no_overlap') then
    alter table insurance_contracts add constraint insurance_contracts_no_overlap
      exclude using gist (
        organization_id with =,
        company_id      with =,
        daterange(effective_from, effective_to, '[]') with &&
      ) where (status = 'active');
  end if;
end $$;

-- الفسخ بلا سبب مكتوب يترك عقدًا ميتًا لا أحد يعرف لماذا مات — وهو أوّل ما
-- يُسأل عنه حين تعود الشركة للتفاوض.
create or replace function app_guard_contract_status()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('terminated','suspended')
     and old.status is distinct from new.status
     and coalesce(btrim(new.termination_reason), '') = '' then
    raise exception 'فسخ العقد أو إيقافه يحتاج سببًا مكتوبًا';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_contract_status on insurance_contracts;
create trigger trg_guard_contract_status
  before update on insurance_contracts
  for each row execute function app_guard_contract_status();

create index if not exists idx_contracts_active
  on insurance_contracts (organization_id, company_id, effective_from desc)
  where status = 'active';

-- ===========================================================================
-- 3) التغطية والاستثناءات
-- ===========================================================================

create table if not exists insurance_coverage_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id),
  contract_id         uuid references insurance_contracts(id),
  policy_id           uuid references insurance_policies(id),
  scope               text not null check (scope in ('item','category','service_type','all')),
  item_id             uuid references items(id),
  category_value_id   uuid references lookup_values(id),
  medical_service_type text,
  coverage            text not null default 'covered'
                        check (coverage in ('covered','excluded','requires_preauth')),
  copay_percent       numeric check (copay_percent >= 0 and copay_percent <= 100),
  max_amount_per_service numeric,
  max_count_per_year  integer,
  waiting_period_days integer,
  note_ar             text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  -- كل نطاق ومفتاحه: قاعدةٌ نطاقها «صنف» بلا صنف قاعدةٌ لا تنطبق على شيء.
  constraint coverage_scope_key_check check (
    (scope = 'item'         and item_id is not null)
    or (scope = 'category'  and category_value_id is not null)
    or (scope = 'service_type' and medical_service_type is not null)
    or (scope = 'all')
  ),
  -- والقاعدة تتبع عقدًا أو بوليصة، لا شيئًا معلّقًا في الهواء.
  constraint coverage_owner_check check (contract_id is not null or policy_id is not null)
);

comment on table insurance_coverage_rules is
  'تغطية العقد أو البوليصة: مغطّى، مستثنى، أو يشترط موافقة مسبقة — مع نسبة تحمّل وسقف وعدد سنويّ.';

alter table insurance_coverage_rules enable row level security;

create index if not exists idx_coverage_contract
  on insurance_coverage_rules (organization_id, contract_id) where is_active;
create index if not exists idx_coverage_policy
  on insurance_coverage_rules (organization_id, policy_id) where is_active;

-- ===========================================================================
-- 4) الموافقات المسبقة — إغلاق الثقب
-- ===========================================================================

alter table insurance_preauthorizations
  add column if not exists item_id           uuid references items(id),
  add column if not exists visit_id          uuid references patient_visits(id),
  add column if not exists contract_id       uuid references insurance_contracts(id),
  add column if not exists qty               numeric not null default 1 check (qty > 0),
  add column if not exists approved_amount   numeric,
  add column if not exists valid_from        date,
  add column if not exists valid_to          date,
  add column if not exists rejection_reason  text,
  add column if not exists consumed_at       timestamptz,
  add column if not exists consumed_invoice_id uuid references sales_invoices(id),
  add column if not exists reference_number  text,
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists updated_by        uuid references auth.users(id);

comment on column insurance_preauthorizations.item_id is
  'الخدمة التي صدرت الموافقة لأجلها. غيابه كان يعني أن أيّ موافقة تفتح كلّ خدمة.';
comment on column insurance_preauthorizations.valid_to is
  'نهاية سريان الموافقة. الفارغ يعني ٩٠ يومًا من الاعتماد — لا «إلى الأبد».';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_preauthorizations_org_id_key') then
    alter table insurance_preauthorizations add constraint insurance_preauthorizations_org_id_key
      unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'preauth_item_tenant_fk') then
    alter table insurance_preauthorizations add constraint preauth_item_tenant_fk
      foreign key (organization_id, item_id) references items(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'preauth_dates_check') then
    alter table insurance_preauthorizations add constraint preauth_dates_check
      check (valid_to is null or valid_from is null or valid_to >= valid_from) not valid;
  end if;
end $$;

create index if not exists idx_preauth_lookup
  on insurance_preauthorizations (organization_id, patient_id, item_id, status);

/**
 * الموافقة السارية لخدمةٍ بعينها.
 *
 * هذه هي الدالة التي تُغلق الثقب: تطابق **الصنف**، وتحترم نافذة السريان،
 * وتتجاهل الموافقة المستهلَكة. الفارغ يعني: لا موافقة.
 */
create or replace function app_active_preauthorization(
  p_patient_id uuid,
  p_item_id    uuid,
  p_as_of      date default current_date
)
returns insurance_preauthorizations
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
    from insurance_preauthorizations p
   where p.patient_id = p_patient_id
     and p.item_id    = p_item_id
     and p.status     = 'approved'
     and p.consumed_at is null
     and coalesce(p.valid_from, p.responded_at::date, p.requested_at::date) <= p_as_of
     and coalesce(p.valid_to,
                  coalesce(p.responded_at, p.requested_at)::date + 90) >= p_as_of
     and app_is_member(p.organization_id)
   order by coalesce(p.responded_at, p.requested_at) desc
   limit 1;
$$;

create or replace function app_set_preauth_status(
  p_preauth_id uuid,
  p_status     text,
  p_reason     text default null,
  p_amount     numeric default null,
  p_approval_number text default null,
  p_valid_to   date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pa insurance_preauthorizations%rowtype;
begin
  select * into v_pa from insurance_preauthorizations where id = p_preauth_id for update;
  if v_pa.id is null then raise exception 'الموافقة غير موجودة'; end if;
  if not app_has_permission(v_pa.organization_id, 'insurance.preauth') then
    raise exception 'صلاحيتك لا تسمح بإدارة الموافقات المسبقة (insurance.preauth)';
  end if;
  if v_pa.status <> 'pending' then
    raise exception 'الموافقة % — لا تُغيَّر بعد الردّ', v_pa.status;
  end if;
  if p_status not in ('approved','rejected','expired') then
    raise exception 'حالة غير مقبولة: %', p_status;
  end if;
  if p_status = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'الرفض يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'approved' and coalesce(btrim(p_approval_number), '') = '' then
    raise exception 'الاعتماد يحتاج رقم موافقة من شركة التأمين';
  end if;

  update insurance_preauthorizations set
    status           = p_status,
    responded_at     = now(),
    approval_number  = case when p_status = 'approved' then btrim(p_approval_number) else approval_number end,
    approved_amount  = case when p_status = 'approved' then coalesce(p_amount, requested_amount) else approved_amount end,
    valid_from       = case when p_status = 'approved' then coalesce(valid_from, current_date) else valid_from end,
    valid_to         = case when p_status = 'approved' then coalesce(p_valid_to, valid_to, current_date + 90) else valid_to end,
    rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else rejection_reason end,
    updated_at       = now(),
    updated_by       = auth.uid()
  where id = p_preauth_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pa.organization_id, auth.uid(), 'insurance', 'update', p_preauth_id,
          'موافقة مسبقة', format('%s ← %s', v_pa.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- ===========================================================================
-- 5) استهلاك السقوف
-- ===========================================================================

create or replace view v_membership_limit_usage
with (security_invoker = on) as
select
  m.id                     as membership_id,
  m.organization_id,
  m.patient_id,
  m.policy_id,
  p.company_id,
  coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) as annual_limit,
  coalesce(m.copay_percent_override, p.default_copay_percent, 0)        as copay_percent,
  p.default_consultation_limit,
  m.expiry_date,
  m.eligibility_status,
  m.is_active,
  coalesce(used.amount, 0)  as used_amount,
  case when coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) is null then null
       else coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) - coalesce(used.amount, 0)
  end                       as remaining_amount,
  coalesce(used.invoices, 0) as used_invoice_count
from patient_insurance_memberships m
join insurance_policies p on p.id = m.policy_id
left join lateral (
  select sum(i.insurance_share_amount) as amount, count(*) as invoices
    from sales_invoices i
   where i.organization_id = m.organization_id
     and i.patient_id      = m.patient_id
     and i.is_insurance_invoice
     and i.status <> 'void'
     -- السنة التأمينية تُحسب من بداية العام الميلادي ما لم يحدّد العقد غير
     -- ذلك: تقريبٌ صريح خيرٌ من سقفٍ لا يُستهلك أبدًا.
     and i.created_at >= date_trunc('year', current_date)
) used on true;

comment on view v_membership_limit_usage is
  'السقف السنوي للعضوية وما استُهلك منه فعلًا. قبل هذا كان السقف رقمًا مكتوبًا لا حدًّا.';

-- ===========================================================================
-- 6) تسوية التغطية — الدالة التي تجيب: أيُغطَّى؟ وكم يدفع المريض؟
-- ===========================================================================

create or replace function app_active_insurance_contract(
  p_organization_id uuid,
  p_company_id      uuid,
  p_as_of           date default current_date
)
returns insurance_contracts
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.* from insurance_contracts c
   where c.organization_id = p_organization_id
     and c.company_id      = p_company_id
     and c.status          = 'active'
     and c.effective_from <= p_as_of
     and (c.effective_to is null or c.effective_to >= p_as_of)
     and app_is_member(p_organization_id)
   order by c.effective_from desc
   limit 1;
$$;

/**
 * تغطية خدمةٍ لعضوية مريض.
 *
 * ترتيب الخصوصية في قواعد التغطية: **الصنف** ثم **الفئة** ثم **نوع الخدمة**
 * ثم **الكل**، وقاعدة العقد تسبق قاعدة البوليصة عند التساوي — لأن العقد أخصّ
 * بهذه المنشأة من بوليصةٍ عامة.
 *
 * تُعيد jsonb فيه: `covered`، `reason`، `copay_percent`، `patient_share`،
 * `insurer_share`، `requires_preauth`، `has_preauth`، `blocks`، `warnings`.
 */
create or replace function app_insurance_coverage(
  p_membership_id uuid,
  p_item_id       uuid,
  p_amount        numeric default null,
  p_as_of         date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m        patient_insurance_memberships%rowtype;
  v_policy   insurance_policies%rowtype;
  v_contract insurance_contracts%rowtype;
  v_item     items%rowtype;
  v_rule     insurance_coverage_rules%rowtype;
  v_usage    record;
  v_amount   numeric;
  v_copay    numeric;
  v_patient  numeric;
  v_insurer  numeric;
  v_blocks   text[] := '{}';
  v_warn     text[] := '{}';
  v_preauth  insurance_preauthorizations%rowtype;
  v_needs_pa boolean := false;
  v_used_cnt integer;
begin
  select * into v_m from patient_insurance_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'العضوية التأمينية غير موجودة'; end if;
  if not app_is_member(v_m.organization_id) then raise exception 'لا صلاحية'; end if;

  select * into v_policy from insurance_policies where id = v_m.policy_id;
  select * into v_item   from items where id = p_item_id and organization_id = v_m.organization_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة في هذه المنشأة'; end if;

  v_contract := app_active_insurance_contract(v_m.organization_id, v_policy.company_id, p_as_of);

  -- ── العضوية نفسها
  if not v_m.is_active then
    v_blocks := array_append(v_blocks, 'العضوية التأمينية غير نشطة');
  end if;
  if v_m.expiry_date is not null and v_m.expiry_date < p_as_of then
    v_blocks := array_append(v_blocks, format('العضوية منتهية بتاريخ %s', v_m.expiry_date));
  end if;
  if v_m.eligibility_status = 'not_eligible' then
    v_blocks := array_append(v_blocks, 'المريض غير مؤهَّل لدى شركة التأمين');
  elsif v_m.eligibility_status in ('unknown', 'expired') then
    v_warn := array_append(v_warn, 'أهلية المريض غير محدَّثة — تحقّق قبل التنفيذ');
  end if;
  if v_contract.id is null then
    v_warn := array_append(v_warn,
      'لا عقد ساري مع شركة التأمين في هذا التاريخ — التسعير سيرجع إلى قائمة التأمين أو الأساس');
  end if;

  -- ── قاعدة التغطية الأخصّ
  select * into v_rule
    from insurance_coverage_rules r
   where r.organization_id = v_m.organization_id
     and r.is_active
     and (r.contract_id = v_contract.id or r.policy_id = v_m.policy_id)
     and (
          (r.scope = 'item'         and r.item_id = p_item_id)
       or (r.scope = 'category'     and r.category_value_id = v_item.category_value_id)
       or (r.scope = 'service_type' and r.medical_service_type = v_item.medical_service_type)
       or (r.scope = 'all')
     )
   order by case r.scope when 'item' then 1 when 'category' then 2
                         when 'service_type' then 3 else 4 end,
            case when r.contract_id is not null then 1 else 2 end
   limit 1;

  if v_rule.id is not null and v_rule.coverage = 'excluded' then
    v_blocks := array_append(v_blocks,
      coalesce(nullif(btrim(v_rule.note_ar), ''), 'الخدمة مستثناة من التغطية'));
  end if;

  -- ── الموافقة المسبقة: من القاعدة أو من الصنف
  v_needs_pa := coalesce(v_rule.coverage = 'requires_preauth', false)
                or coalesce(v_item.requires_preauthorization, false);
  if v_needs_pa then
    v_preauth := app_active_preauthorization(v_m.patient_id, p_item_id, p_as_of);
    if v_preauth.id is null then
      v_blocks := array_append(v_blocks, 'تتطلّب موافقة تأمين مسبقة لهذه الخدمة، ولا توجد موافقة سارية');
    end if;
  end if;

  -- ── فترة الانتظار: العضوية الحديثة لا تُغطّى قبل مرورها
  if v_rule.waiting_period_days is not null and v_rule.waiting_period_days > 0 then
    if v_m.created_at::date + v_rule.waiting_period_days > p_as_of then
      v_blocks := array_append(v_blocks,
        format('فترة الانتظار %s يومًا لم تنتهِ بعد (تنتهي %s)',
               v_rule.waiting_period_days,
               v_m.created_at::date + v_rule.waiting_period_days));
    end if;
  end if;

  -- ── العدد السنوي
  if v_rule.max_count_per_year is not null then
    select count(*) into v_used_cnt
      from sales_invoice_items li
      join sales_invoices inv on inv.id = li.invoice_id
     where li.item_id = p_item_id
       and inv.patient_id = v_m.patient_id
       and inv.organization_id = v_m.organization_id
       and inv.is_insurance_invoice
       and inv.status <> 'void'
       and inv.created_at >= date_trunc('year', p_as_of::timestamptz);
    if v_used_cnt >= v_rule.max_count_per_year then
      v_blocks := array_append(v_blocks,
        format('استُهلك العدد المسموح سنويًا لهذه الخدمة (%s)', v_rule.max_count_per_year));
    end if;
  end if;

  -- ── المبلغ ونسبة التحمّل
  v_amount := coalesce(p_amount, (select price from app_resolve_item_price(
                 v_m.organization_id, p_item_id, null, v_policy.company_id, null, p_as_of)), 0);

  if v_rule.max_amount_per_service is not null and v_amount > v_rule.max_amount_per_service then
    v_warn := array_append(v_warn,
      format('سقف الخدمة %s والمبلغ %s — الفرق على المريض',
             v_rule.max_amount_per_service, v_amount));
  end if;

  v_copay := coalesce(v_rule.copay_percent, v_m.copay_percent_override,
                      v_contract.default_copay_percent, v_policy.default_copay_percent, 0);

  select * into v_usage from v_membership_limit_usage where membership_id = p_membership_id;
  if v_usage.remaining_amount is not null and v_usage.remaining_amount <= 0 then
    v_blocks := array_append(v_blocks, 'استُهلك السقف السنوي للعضوية بالكامل');
  elsif v_usage.remaining_amount is not null and v_usage.remaining_amount < v_amount then
    v_warn := array_append(v_warn,
      format('المتبقّي من السقف السنوي %s والمبلغ %s — الفرق على المريض',
             round(v_usage.remaining_amount, 2), v_amount));
  end if;

  v_insurer := round(v_amount * (100 - v_copay) / 100, 2);
  if v_rule.max_amount_per_service is not null then
    v_insurer := least(v_insurer, v_rule.max_amount_per_service);
  end if;
  if v_usage.remaining_amount is not null then
    v_insurer := least(v_insurer, greatest(v_usage.remaining_amount, 0));
  end if;
  if cardinality(v_blocks) > 0 then
    v_insurer := 0;
  end if;
  v_patient := round(v_amount - v_insurer, 2);

  return jsonb_build_object(
    'ok',              cardinality(v_blocks) = 0,
    'covered',         cardinality(v_blocks) = 0,
    'amount',          v_amount,
    'copay_percent',   v_copay,
    'patient_share',   v_patient,
    'insurer_share',   v_insurer,
    'requires_preauth', v_needs_pa,
    'has_preauth',     v_preauth.id is not null,
    'approval_number', v_preauth.approval_number,
    'contract_id',     v_contract.id,
    'contract_name',   v_contract.name_ar,
    'rule_scope',      v_rule.scope,
    'annual_remaining', v_usage.remaining_amount,
    'blocks',          to_jsonb(v_blocks),
    'warnings',        to_jsonb(v_warn)
  );
end;
$$;

-- ===========================================================================
-- 7) التسعير: العقد فوق قائمة التأمين، والسعر يُجمَّد على الفاتورة
-- ===========================================================================

/**
 * ترتيب التسعير الكامل: **عقد الشركة** ← قائمة التأمين ← قائمة الفرع ←
 * قائمة الأساس ← سعر الصنف.
 *
 * العقد يسبق لأنه اتفاقٌ موقَّع بين هذه المنشأة وهذه الشركة، وقائمة التأمين
 * العامة قد تكون أقدم منه أو موضوعة لشركة أخرى من المجموعة نفسها.
 */
create or replace function app_resolve_item_price_v2(
  p_organization_id uuid,
  p_item_id         uuid,
  p_branch_id       uuid default null,
  p_insurance_company_id uuid default null,
  p_external_client_id   uuid default null,
  p_as_of           date default current_date
)
returns table (
  price numeric, discount_percent numeric, source_kind text,
  source_list_id uuid, source_list_name text, contract_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract insurance_contracts%rowtype;
  v_row      record;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا صلاحية';
  end if;

  if p_insurance_company_id is not null then
    v_contract := app_active_insurance_contract(p_organization_id, p_insurance_company_id, p_as_of);
  end if;

  -- قائمة العقد أولًا
  if v_contract.price_list_id is not null then
    select pli.price, coalesce(pli.discount_percent, v_contract.discount_percent),
           'contract'::text, pl.id, pl.name
      into v_row
      from price_list_items pli
      join price_lists pl on pl.id = pli.price_list_id
     where pli.item_id = p_item_id
       and pl.id = v_contract.price_list_id
       and pl.is_active
       and pli.effective_from <= p_as_of
       and (pli.effective_to is null or pli.effective_to >= p_as_of)
     limit 1;
    if found then
      price := v_row.price; discount_percent := v_row.coalesce;
      source_kind := 'contract'; source_list_id := v_row.id; source_list_name := v_row.name;
      contract_id := v_contract.id;
      return next;
      return;
    end if;
  end if;

  -- ثم السُّلَّم القائم منذ 0064
  for v_row in
    select * from app_resolve_item_price(p_organization_id, p_item_id, p_branch_id,
                                         p_insurance_company_id, p_external_client_id, p_as_of)
  loop
    price := v_row.price;
    -- خصم العقد يُطبَّق فوق قائمةٍ أدنى إن لم يكن للعقد قائمة خاصة
    discount_percent := greatest(coalesce(v_row.discount_percent, 0),
                                 coalesce(v_contract.discount_percent, 0));
    source_kind      := v_row.source_kind;
    source_list_id   := v_row.source_list_id;
    source_list_name := v_row.source_list_name;
    contract_id      := v_contract.id;
    return next;
  end loop;
end;
$$;

-- السعر يُجمَّد على السطر: بلا هذا تصير فاتورة الأمس بلا تفسير بعد تعديل
-- قائمة الأسعار اليوم.
alter table sales_invoice_items
  add column if not exists price_source_kind    text,
  add column if not exists price_source_list_id uuid references price_lists(id),
  add column if not exists contract_id          uuid references insurance_contracts(id),
  add column if not exists list_price           numeric,
  add column if not exists covered_amount       numeric,
  add column if not exists patient_share        numeric,
  add column if not exists insurer_share        numeric,
  add column if not exists preauthorization_id  uuid references insurance_preauthorizations(id);

comment on column sales_invoice_items.price_source_kind is
  'من أين جاء السعر لحظة الفوترة: contract أو insurance أو corporate أو branch أو base أو item. مجمَّد ولا يُعاد حسابه.';

-- ===========================================================================
-- 8) المطالبات: الرفض وإعادة التقديم
-- ===========================================================================

alter table insurance_claim_forms
  add column if not exists batch_id            uuid references insurance_claim_batches(id),
  add column if not exists membership_snapshot jsonb,
  add column if not exists claimed_amount      numeric,
  add column if not exists approved_amount     numeric,
  add column if not exists rejected_amount     numeric,
  add column if not exists rejection_code      text,
  add column if not exists rejection_reason    text,
  add column if not exists resubmission_of_id  uuid references insurance_claim_forms(id),
  add column if not exists resubmission_count  integer not null default 0,
  add column if not exists submitted_at        timestamptz,
  add column if not exists responded_at        timestamptz,
  add column if not exists paid_at             timestamptz,
  add column if not exists nphies_request_id   text,
  add column if not exists nphies_status       text,
  add column if not exists nphies_last_sync_at timestamptz,
  add column if not exists updated_by          uuid references auth.users(id);

comment on column insurance_claim_forms.nphies_request_id is
  'معرّف الطلب في نفيس. حقل بيانات فقط — لا تكامل في هذه الهجرة، ولا نداء خارجيّ.';
comment on column insurance_claim_forms.resubmission_of_id is
  'المطالبة الأصلية التي أُعيد تقديم هذه بدلًا عنها. الرفض ليس طريقًا مسدودًا.';

do $$
begin
  alter table insurance_claim_forms drop constraint if exists insurance_claim_forms_status_check;
  alter table insurance_claim_forms add constraint insurance_claim_forms_status_check check (
    status in ('draft','submitted','approved','partially_approved','rejected','resubmitted','paid','cancelled')
  );
  if not exists (select 1 from pg_constraint where conname = 'insurance_claim_forms_org_id_key') then
    alter table insurance_claim_forms add constraint insurance_claim_forms_org_id_key
      unique (organization_id, id);
  end if;
end $$;

alter table insurance_claim_batches
  add column if not exists contract_id     uuid references insurance_contracts(id),
  add column if not exists approved_amount numeric,
  add column if not exists rejected_amount numeric,
  add column if not exists paid_amount     numeric,
  add column if not exists paid_at         timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists responded_at    timestamptz,
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists updated_by      uuid references auth.users(id);

create or replace function app_claim_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'              then p_to in ('submitted','cancelled')
    when 'submitted'          then p_to in ('approved','partially_approved','rejected','cancelled')
    when 'approved'           then p_to in ('paid','rejected')
    when 'partially_approved' then p_to in ('paid','resubmitted','rejected')
    when 'rejected'           then p_to in ('resubmitted','cancelled')
    else false   -- paid و resubmitted و cancelled نهائية
  end;
$$;

create or replace function app_set_claim_form_status(
  p_form_id  uuid,
  p_status   text,
  p_reason   text default null,
  p_amount   numeric default null,
  p_code     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f insurance_claim_forms%rowtype;
begin
  select * into v_f from insurance_claim_forms where id = p_form_id for update;
  if v_f.id is null then raise exception 'المطالبة غير موجودة'; end if;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإدارة المطالبات (insurance.claims)';
  end if;
  if v_f.status = p_status then return; end if;
  if not app_claim_status_allowed(v_f.status, p_status) then
    raise exception 'لا يمكن الانتقال بالمطالبة من «%» إلى «%»', v_f.status, p_status;
  end if;

  -- الرفض والاعتماد الجزئي بلا سبب مكتوب لا يُبنى عليهما اعتراض ولا إعادة
  -- تقديم: يبقى الأثر «مرفوضة» ولا أحد يعرف لماذا.
  if p_status in ('rejected','partially_approved')
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'الرفض أو الاعتماد الجزئي يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'partially_approved' and p_amount is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ المعتمَد';
  end if;

  update insurance_claim_forms set
    status          = p_status,
    submitted_at    = case when p_status = 'submitted' then now() else submitted_at end,
    responded_at    = case when p_status in ('approved','partially_approved','rejected')
                           then now() else responded_at end,
    paid_at         = case when p_status = 'paid' then now() else paid_at end,
    approved_amount = case when p_status = 'approved' then coalesce(p_amount, claimed_amount)
                           when p_status = 'partially_approved' then p_amount
                           else approved_amount end,
    rejected_amount = case when p_status = 'rejected' then claimed_amount
                           when p_status = 'partially_approved'
                             then greatest(coalesce(claimed_amount, 0) - coalesce(p_amount, 0), 0)
                           else rejected_amount end,
    rejection_reason = case when p_status in ('rejected','partially_approved')
                            then btrim(p_reason) else rejection_reason end,
    rejection_code  = case when p_status in ('rejected','partially_approved')
                           then nullif(btrim(coalesce(p_code, '')), '') else rejection_code end,
    updated_at      = now(),
    updated_by      = auth.uid()
  where id = p_form_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'update', p_form_id,
          'مطالبة تأمين', format('%s ← %s', v_f.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

/**
 * إعادة تقديم مطالبة مرفوضة.
 *
 * تُنشئ **مطالبة جديدة** تحمل سطور الأصل، وتترك الأصل مرفوضًا موسومًا
 * بـ`resubmitted`. لا تُعدَّل المطالبة المرفوضة في مكانها: تاريخُ ما قُدِّم
 * ومتى ورُدَّ بأيّ سبب هو نصف الملفّ في أيّ نزاع مع شركة تأمين.
 */
create or replace function app_resubmit_claim_form(
  p_form_id uuid,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f   insurance_claim_forms%rowtype;
  v_new uuid;
begin
  select * into v_f from insurance_claim_forms where id = p_form_id for update;
  if v_f.id is null then raise exception 'المطالبة غير موجودة'; end if;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإعادة التقديم (insurance.claims)';
  end if;
  if v_f.status not in ('rejected','partially_approved') then
    raise exception 'إعادة التقديم للمطالبات المرفوضة أو المعتمَدة جزئيًا فقط';
  end if;

  insert into insurance_claim_forms (
    organization_id, form_type, patient_id, doctor_id, clinic_id, membership_id,
    sales_invoice_id, status, form_data, auto_created, claimed_amount,
    membership_snapshot, resubmission_of_id, resubmission_count, created_by)
  values (
    v_f.organization_id, v_f.form_type, v_f.patient_id, v_f.doctor_id, v_f.clinic_id,
    v_f.membership_id, v_f.sales_invoice_id, 'draft',
    coalesce(v_f.form_data, '{}'::jsonb)
      || jsonb_build_object('resubmission_note', nullif(btrim(coalesce(p_note, '')), '')),
    false, v_f.claimed_amount, v_f.membership_snapshot, p_form_id,
    v_f.resubmission_count + 1, auth.uid())
  returning id into v_new;

  insert into insurance_claim_form_items (form_id, item_id, service_code, description, qty, amount)
  select v_new, item_id, service_code, description, qty, amount
    from insurance_claim_form_items where form_id = p_form_id;

  update insurance_claim_forms
     set status = 'resubmitted', updated_at = now(), updated_by = auth.uid()
   where id = p_form_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'add', v_new,
          'مطالبة تأمين', format('إعادة تقديم للمطالبة %s (المحاولة %s)',
                                 p_form_id, v_f.resubmission_count + 1),
          nullif(btrim(coalesce(p_note, '')), ''));

  return v_new;
end;
$$;

-- المطالبة المقدَّمة أو ما بعدها لا تُعدَّل مباشرةً
create or replace function app_guard_submitted_claim()
returns trigger
language plpgsql
as $$
begin
  -- المرفوضة محميّة كالمقدَّمة: هي **دليل** ما قُدِّم وما رُدَّ به، وتعديلها
  -- في مكانها يمحو أساس أيّ اعتراض. التغيير يكون بإعادة تقديم بنسخة جديدة.
  if old.status in ('submitted','approved','partially_approved','paid','resubmitted',
                    'rejected','cancelled')
     and new.status = old.status
     and (new.form_data       is distinct from old.form_data
       or new.sales_invoice_id is distinct from old.sales_invoice_id
       or new.membership_id   is distinct from old.membership_id
       or new.claimed_amount  is distinct from old.claimed_amount) then
    raise exception 'المطالبة المقدَّمة لا تُعدَّل — أعد تقديمها بنسخة جديدة';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_submitted_claim on insurance_claim_forms;
create trigger trg_guard_submitted_claim
  before update on insurance_claim_forms
  for each row execute function app_guard_submitted_claim();

-- ===========================================================================
-- 9) الصلاحيات
-- ===========================================================================

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('insurance.view',      'عرض التأمين والمطالبات',   'insurance', 960),
  ('insurance.manage',    'إدارة الشركات والبوالص',   'insurance', 962),
  ('insurance.contracts', 'إدارة العقود والتغطية',    'insurance', 964),
  ('insurance.preauth',   'إدارة الموافقات المسبقة',  'insurance', 966),
  ('insurance.claims',    'إدارة المطالبات ودفعاتها', 'insurance', 968)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('receptionist',   'insurance.view'), ('receptionist', 'insurance.preauth'),
  ('nurse',          'insurance.view'),
  ('doctor',         'insurance.view'),
  ('accountant',     'insurance.view'), ('accountant', 'insurance.claims'),
  ('branch_manager', 'insurance.view'), ('branch_manager', 'insurance.manage'),
  ('branch_manager', 'insurance.contracts'), ('branch_manager', 'insurance.preauth'),
  ('branch_manager', 'insurance.claims')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('insurance_companies',            'insurance.view', 'insurance.manage'),
      ('insurance_policies',             'insurance.view', 'insurance.manage'),
      ('insurance_networks',             'insurance.view', 'insurance.manage'),
      ('insurance_contracts',            'insurance.view', 'insurance.contracts'),
      ('insurance_coverage_rules',       'insurance.view', 'insurance.contracts'),
      ('patient_insurance_memberships',  'insurance.view', 'insurance.manage'),
      ('insurance_preauthorizations',    'insurance.view', 'insurance.preauth'),
      ('insurance_claim_forms',          'insurance.view', 'insurance.claims'),
      ('insurance_claim_batches',        'insurance.view', 'insurance.claims')
    ) as v(t, pv, pw)
  loop
    -- الإسقاط **بالبحث لا بالاسم**: أسماء السياسات القديمة تختلف من هجرة
    -- لأخرى (`claim_forms_all_members` لا `insurance_claim_forms_all_members`)،
    -- والحذف بالاسم المخمَّن يترك الباب مفتوحًا وهو يظنّ أنه أغلقه.
    declare pol record;
    begin
      for pol in select policyname from pg_policies
                  where schemaname = 'public' and tablename = r.t
      loop
        execute format('drop policy if exists %I on %I', pol.policyname, r.t);
      end loop;
    end;
    execute format('alter table %I enable row level security', r.t);
    execute format(
      'create policy %I on %I for select using (app_has_permission(organization_id, %L))',
      r.t || '_select', r.t, r.pv);
    execute format(
      'create policy %I on %I for insert with check (app_has_permission(organization_id, %L))',
      r.t || '_insert', r.t, r.pw);
    execute format(
      'create policy %I on %I for update using (app_has_permission(organization_id, %L)) with check (app_has_permission(organization_id, %L))',
      r.t || '_update', r.t, r.pw, r.pw);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('insurance_claim_form_items',  'insurance_claim_forms',   'form_id'),
      ('insurance_claim_batch_items', 'insurance_claim_batches', 'batch_id')
    ) as v(t, parent, fk)
  loop
    execute format('alter table %I enable row level security', r.t);
    declare pol record;
    begin
      for pol in select policyname from pg_policies
                  where schemaname = 'public' and tablename = r.t
      loop
        execute format('drop policy if exists %I on %I', pol.policyname, r.t);
      end loop;
    end;
    execute format(
      'create policy %I on %I for select using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_select', r.t, r.parent, r.t, r.fk, 'insurance.view');
    execute format(
      'create policy %I on %I for all using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L))) with check (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_write', r.t, r.parent, r.t, r.fk, 'insurance.claims',
      r.parent, r.t, r.fk, 'insurance.claims');
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_active_preauthorization','app_set_preauth_status',
                         'app_active_insurance_contract','app_insurance_coverage',
                         'app_resolve_item_price_v2','app_claim_status_allowed',
                         'app_set_claim_form_status','app_resubmit_claim_form')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 10) إصلاح فحص الأهلية — الثقب الأصلي
-- ===========================================================================
--
-- الدالة القديمة تقبل أيّ موافقة معتمدة للمريض خلال ٩٠ يومًا مهما كانت
-- الخدمة. تُستبدل الكتلة كلها بنداء `app_active_preauthorization` الذي يطابق
-- الصنف ونافذة السريان.
create or replace function app_check_service_eligibility(
  p_item_id uuid, p_patient_id uuid, p_branch_id uuid default null,
  p_stage text default 'execution'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item     items%rowtype;
  v_patient  patients%rowtype;
  v_age      integer;
  v_blocks   text[] := '{}';
  v_warnings text[] := '{}';
  v_preauth  insurance_preauthorizations%rowtype;
begin
  if p_stage not in ('booking','execution') then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  select * into v_item from items where id = p_item_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة'; end if;
  if not app_is_member(v_item.organization_id) then raise exception 'لا صلاحية'; end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = v_item.organization_id;
  if v_patient.id is null then raise exception 'المريض غير موجود في هذه المنشأة'; end if;

  if v_item.is_archived then
    v_blocks := array_append(v_blocks, 'الخدمة مؤرشفة');
  elsif v_item.is_disabled then
    v_blocks := array_append(v_blocks, 'الخدمة معطَّلة');
  end if;

  if p_branch_id is not null and not app_item_available_in_branch(p_item_id, p_branch_id) then
    v_blocks := array_append(v_blocks, 'الخدمة غير متاحة في هذا الفرع');
  end if;

  if v_patient.birth_date is not null then
    v_age := extract(year from age(current_date, v_patient.birth_date))::int;
    if v_item.min_age_years is not null and v_age < v_item.min_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأكثر، وعمر المريض %s', v_item.min_age_years, v_age));
    end if;
    if v_item.max_age_years is not null and v_age > v_item.max_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأقل، وعمر المريض %s', v_item.max_age_years, v_age));
    end if;
  elsif v_item.min_age_years is not null or v_item.max_age_years is not null then
    v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالعمر وتاريخ ميلاد المريض غير مسجَّل');
  end if;

  if v_item.gender_restriction <> 'any' then
    if v_patient.gender is null then
      v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالجنس وجنس المريض غير مسجَّل');
    elsif v_patient.gender <> v_item.gender_restriction then
      v_blocks := array_append(v_blocks,
        case v_item.gender_restriction when 'male' then 'الخدمة للذكور فقط'
                                       else 'الخدمة للإناث فقط' end);
    end if;
  end if;

  if v_item.requires_fasting then
    v_warnings := array_append(v_warnings,
      coalesce('صيام ' || v_item.fasting_hours || ' ساعة قبل الخدمة', 'الخدمة تتطلّب صيامًا'));
  end if;
  if v_item.preparation_ar is not null and btrim(v_item.preparation_ar) <> '' then
    v_warnings := array_append(v_warnings, 'تحضير مطلوب: ' || v_item.preparation_ar);
  end if;
  if v_item.requires_consent then
    v_warnings := array_append(v_warnings, 'تتطلّب موافقة موقَّعة من المريض');
  end if;
  if v_item.requires_referral then
    v_warnings := array_append(v_warnings, 'تتطلّب إحالة من طبيب');
  end if;

  if v_item.requires_preauthorization then
    v_preauth := app_active_preauthorization(p_patient_id, p_item_id, current_date);
    if v_preauth.id is null then
      if p_stage = 'booking' then
        v_warnings := array_append(v_warnings,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة — اطلبها قبل موعد التنفيذ');
      else
        v_blocks := array_append(v_blocks,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة، ولا توجد موافقة سارية');
      end if;
    elsif v_preauth.valid_to is not null and v_preauth.valid_to <= current_date + 7 then
      v_warnings := array_append(v_warnings,
        format('الموافقة المسبقة تنتهي بتاريخ %s', v_preauth.valid_to));
    end if;
  end if;

  if exists (
    select 1 from item_resources ir
     where ir.item_id = p_item_id and ir.is_required
       and not exists (
         select 1 from resources r
          where r.id = ir.resource_id and r.is_active
            and (p_branch_id is null or r.branch_id is null or r.branch_id = p_branch_id)
       )
  ) then
    v_blocks := array_append(v_blocks, 'مورد مطلوب للخدمة غير متاح في هذا الفرع');
  end if;

  return jsonb_build_object(
    'ok', cardinality(v_blocks) = 0,
    'blocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

-- ===========================================================================
-- 11) المناظير
-- ===========================================================================

create or replace view v_insurance_contracts
with (security_invoker = on) as
select
  c.id, c.organization_id, c.company_id, co.name_ar as company_name,
  c.network_id, n.name_ar as network_name,
  c.contract_number, c.name_ar, c.name_en,
  c.price_list_id, pl.name as price_list_name,
  c.discount_percent, c.default_copay_percent, c.payment_terms_days,
  c.claim_submission_days, c.effective_from, c.effective_to, c.status,
  (c.status = 'active' and c.effective_from <= current_date
   and (c.effective_to is null or c.effective_to >= current_date))  as is_in_effect,
  case when c.effective_to is null then null
       else c.effective_to - current_date end                        as days_to_expiry,
  (select count(*) from insurance_coverage_rules r
    where r.contract_id = c.id and r.is_active)                      as coverage_rules_count,
  c.notes, c.created_at
from insurance_contracts c
join insurance_companies co on co.id = c.company_id
left join insurance_networks n on n.id = c.network_id
left join price_lists pl on pl.id = c.price_list_id;

create or replace view v_claim_register
with (security_invoker = on) as
select
  f.id as form_id, f.organization_id, f.form_type, f.status,
  f.created_at, f.submitted_at, f.responded_at, f.paid_at,
  f.claimed_amount, f.approved_amount, f.rejected_amount,
  f.rejection_code, f.rejection_reason,
  f.resubmission_of_id, f.resubmission_count,
  f.nphies_request_id, f.nphies_status,
  p.id as patient_id, p.name_ar as patient_name, p.file_number,
  d.name_ar as doctor_name,
  cl.name   as clinic_name,
  co.id     as company_id, co.name_ar as company_name,
  pol.policy_name, m.membership_number,
  f.sales_invoice_id, inv.invoice_number, inv.net_amount as invoice_amount,
  f.batch_id, b.batch_number, b.status as batch_status,
  case when f.status = 'rejected' and f.resubmission_count = 0 then true else false end
    as needs_resubmission,
  case when f.status in ('draft','submitted')
        and f.created_at < now() - interval '30 days' then true else false end
    as is_stale
from insurance_claim_forms f
join patients p on p.id = f.patient_id
left join doctors d on d.id = f.doctor_id
left join clinics cl on cl.id = f.clinic_id
left join patient_insurance_memberships m on m.id = f.membership_id
left join insurance_policies pol on pol.id = m.policy_id
left join insurance_companies co on co.id = pol.company_id
left join sales_invoices inv on inv.id = f.sales_invoice_id
left join insurance_claim_batches b on b.id = f.batch_id;

comment on view v_claim_register is
  'سجل المطالبات: ما قُدِّم، وما رُدَّ ولماذا، وما يحتاج إعادة تقديم، وما ركد أكثر من ثلاثين يومًا.';

create or replace view v_patient_insurance_status
with (security_invoker = on) as
select
  u.membership_id, u.organization_id, u.patient_id, u.policy_id, u.company_id,
  co.name_ar   as company_name,
  pol.policy_name, pol.policy_number,
  n.name_ar    as network_name,
  cls.name_ar  as class_name,
  m.membership_number, m.relation, m.expiry_date, m.eligibility_status, m.is_active,
  u.annual_limit, u.used_amount, u.remaining_amount, u.copay_percent,
  u.default_consultation_limit,
  ct.id        as contract_id,
  ct.name_ar   as contract_name,
  (ct.id is not null) as has_active_contract,
  case
    when not m.is_active                                  then 'العضوية غير نشطة'
    when m.expiry_date is not null and m.expiry_date < current_date then 'العضوية منتهية'
    when m.eligibility_status = 'not_eligible'            then 'غير مؤهَّل'
    when u.remaining_amount is not null and u.remaining_amount <= 0 then 'استُهلك السقف السنوي'
    when ct.id is null                                    then 'لا عقد ساري مع الشركة'
    else null
  end as issue
from v_membership_limit_usage u
join patient_insurance_memberships m on m.id = u.membership_id
join insurance_policies pol on pol.id = u.policy_id
join insurance_companies co on co.id = u.company_id
left join insurance_networks n on n.id = pol.network_id
left join lookup_values cls on cls.id = pol.class_value_id
left join lateral (
  select c.* from insurance_contracts c
   where c.organization_id = u.organization_id and c.company_id = u.company_id
     and c.status = 'active' and c.effective_from <= current_date
     and (c.effective_to is null or c.effective_to >= current_date)
   order by c.effective_from desc limit 1
) ct on true;

grant select on v_insurance_contracts, v_claim_register, v_patient_insurance_status,
                v_membership_limit_usage to authenticated;

-- الجداول الجديدة تحتاج منحًا صريحًا: 0078 منحت ما كان موجودًا يومها، وما
-- يُنشأ بعدها لا يرثه — فيصير الجدول محميًّا بـ«permission denied» لا بـRLS،
-- ورسالةٌ كهذه تُقرأ كعطل لا كمنع.
grant select, insert, update on insurance_networks, insurance_contracts, insurance_coverage_rules to authenticated;

-- ===========================================================================
-- 12) فحص ذاتي
-- ===========================================================================
do $$
declare
  v_bad text;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'app_check_service_eligibility'
                and pg_get_functiondef(p.oid) like '%interval ''90 days''%') then
    raise exception 'فحص الأهلية ما زال يقبل أيّ موافقة خلال ٩٠ يومًا — الثقب مفتوح';
  end if;

  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where tablename in ('insurance_companies','insurance_policies','insurance_contracts',
                       'insurance_coverage_rules','insurance_preauthorizations',
                       'insurance_claim_forms','insurance_claim_batches',
                       'patient_insurance_memberships','insurance_networks')
     and cmd in ('ALL','DELETE');
  if v_bad is not null then
    raise exception 'بقيت سياسة واسعة على جداول التأمين: %', v_bad;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_no_overlap') then
    raise exception 'منع تداخل العقود غير مركَّب';
  end if;
end $$;



-- ###########################################################################
-- ###  0090 — إصلاحات تكامل رحلة المريض
-- ###########################################################################
do $announce$
begin raise notice '▶ 0090 — إصلاحات تكامل رحلة المريض'; end;
$announce$;

-- ---------------------------------------------------------------------------
-- 0090 — إصلاحات تكامل رحلة المريض
-- ---------------------------------------------------------------------------
-- المرحلة العاشرة. هذه الهجرة **لا تضيف ميزة**: كل ما فيها أخطاء كشفها
-- `e2e/sql/patient-journey.test.sql` حين مشى في الرحلة كاملةً بمريضٍ واحد.
--
-- كل مرحلةٍ سابقة نجحت في دليلها وحدها. والخلل في **الوصلات** بينها: حيث
-- تُسلَّم مخرجات مرحلة إلى مدخلات التالية، ولا دليلَ وحدةٍ ينظر إلى ذلك.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الزيارة تولد «مخطَّطة» لا «مكتملة»
-- ===========================================================================
--
-- 0087 أضاف `status` بقيمة افتراضية `'completed'`، وكان ذلك صحيحًا **للصفوف
-- القائمة** — زياراتٌ ماضية انتهت فعلًا. لكنه بقي افتراضًا للصفوف **الجديدة**
-- أيضًا، والنتيجة:
--
--   • كل زيارة يبدأها موظف الاستقبال تُولَد «مكتملة» قبل أن يراها الطبيب.
--   • فلا تظهر في `v_incomplete_visits` أبدًا، ودورة الحياة كلها تُتجاوَز في
--     أكثر المسارات استعمالًا في النظام.
--   • وأسوأ: `app_set_visit_status(visit,'in_progress')` من «مكتملة» يُعدّ
--     **إعادة فتح**، فيطلب سببًا مكتوبًا وصلاحية `visits.reopen` — أي أن
--     الطبيب لا يستطيع بدء الزيارة التي سُلِّمت إليه للتوّ.
--
-- الافتراض الصحيح للصف الجديد هو `'planned'`.
alter table patient_visits alter column status set default 'planned';

comment on column patient_visits.status is
  'دورة الزيارة: planned مخطَّطة (الافتراضي للجديد)، waiting منتظرة، in_progress جارية، completed مكتملة، signed موقَّعة سريريًا، closed مغلقة ماليًا، cancelled ملغاة.';

-- ===========================================================================
-- 2) الاستقبال يحرّك حالة الزيارة لا حالة الموعد وحدها
-- ===========================================================================
--
-- `app_reception_transition` كانت تُنشئ الزيارة وتنقل **الموعد** إلى
-- `in_progress`، وتترك **الزيارة** على حالها. فحالتان لشيء واحد تفترقان من
-- اللحظة الأولى: الموعد جارٍ والزيارة مكتملة.
--
-- تُعاد كتابة الفرعين المعنيّين فقط — `start` و`finish` — بترقيع الدالة
-- القائمة عبر مُحفِّز على `appointments`، لا بإعادة كتابة الدالة كلها:
-- إعادة كتابتها تعني نسخ مئتي سطر لم تتغيّر، وكل نسخة فرصة لخطأ.
create or replace function app_sync_visit_with_reception()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit patient_visits%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_visit from patient_visits where appointment_id = new.id;
  if v_visit.id is null then
    return new;
  end if;

  if new.status = 'in_progress' and v_visit.status in ('planned','waiting') then
    update patient_visits
       set status = 'in_progress',
           started_at = coalesce(started_at, now()),
           updated_at = now()
     where id = v_visit.id;

  elsif new.status = 'completed' and v_visit.status = 'in_progress' then
    update patient_visits
       set status = 'completed',
           ended_at = coalesce(ended_at, now()),
           updated_at = now()
     where id = v_visit.id;

  elsif new.status in ('cancelled','no_show')
        and v_visit.status in ('planned','waiting') then
    -- زيارةٌ لم تبدأ ومريضُها لم يحضر: تُلغى بسببها لا تبقى معلّقة إلى الأبد.
    update patient_visits
       set status = 'cancelled',
           cancel_reason = coalesce(new.no_show_reason, 'ألغي الموعد'),
           updated_at = now()
     where id = v_visit.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_visit_with_reception on appointments;
create trigger trg_sync_visit_with_reception
  after update of status on appointments
  for each row execute function app_sync_visit_with_reception();

-- والاتجاه الآخر: `app_reception_transition` تُحدِّث **الموعد أوّلًا** ثم
-- تُنشئ الزيارة. فمُحفِّزُ الموعد يعمل والزيارة لم تُخلق بعد، فلا يجد شيئًا
-- يزامنه. الزيارة الجديدة إذن تستنتج حالتها من موعدها لحظة ميلادها.
create or replace function app_init_visit_status_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt_status text;
begin
  if new.appointment_id is null then
    return new;
  end if;
  select a.status into v_appt_status from appointments a where a.id = new.appointment_id;

  if v_appt_status = 'in_progress' and new.status = 'planned' then
    new.status     := 'in_progress';
    new.started_at := coalesce(new.started_at, now());
  elsif v_appt_status = 'completed' and new.status = 'planned' then
    new.status   := 'completed';
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_init_visit_status on patient_visits;
create trigger trg_init_visit_status
  before insert on patient_visits
  for each row execute function app_init_visit_status_from_appointment();

-- الزيارة التي أنشأها الاستقبال قبل هذه الهجرة وموعدها جارٍ: تُصحَّح مرّة.
update patient_visits v
   set status = 'in_progress', started_at = coalesce(v.started_at, a.called_at, a.checked_in_1_at)
  from appointments a
 where a.id = v.appointment_id
   and a.status = 'in_progress'
   and v.status = 'completed'
   and v.signed_at is null and v.closed_at is null;

-- ===========================================================================
-- 3) الزيارة المغلقة أو الموقَّعة: الحارس كان يمنع حتى تحديثات النظام نفسه
-- ===========================================================================
--
-- `app_guard_signed_visit` (0087) يمنع أيّ `update` على زيارة موقَّعة أو
-- مغلقة. وهذا صحيح للمستخدم، وخاطئ للنظام: مُحفِّزٌ داخليّ يريد ختم
-- `updated_at` أو مزامنة حالة يُمنع أيضًا، فتتعطّل مسارات مشروعة.
--
-- الحلّ: استثناء صريح ومحدود للأعمدة التي لا تحمل محتوى سريريًا.
create or replace function app_guard_signed_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status not in ('signed','closed') then
    return new;
  end if;

  -- تغيير الحالة نفسها يمرّ عبر `app_set_visit_status` وحدها، وهي تفرض
  -- الصلاحية والسبب. أمّا هنا فنمنع تعديل **المحتوى**.
  if new.status is distinct from old.status then
    return new;
  end if;

  if new.main_complaint    is distinct from old.main_complaint
     or new.exam_data      is distinct from old.exam_data
     or new.notes          is distinct from old.notes
     or new.doctor_id      is distinct from old.doctor_id
     or new.clinic_id      is distinct from old.clinic_id
     or new.visit_date     is distinct from old.visit_date
     or new.next_visit_plan is distinct from old.next_visit_plan then
    raise exception 'الزيارة % — لا تُعدَّل مباشرةً، أعد فتحها بسبب مسجَّل',
      case old.status when 'signed' then 'موقَّعة' else 'مغلقة' end;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- 4) الفاتورة تلتقط الموافقة المسبقة وتستهلكها
-- ===========================================================================
--
-- 0089 أضاف `consumed_at` إلى الموافقات و`preauthorization_id` إلى سطور
-- الفاتورة، ولم يكن ثمّة ما يملؤهما: الموافقة تبقى «غير مستهلَكة» بعد أن
-- استُعملت فعلًا، فتُستعمل مرّة أخرى لخدمة ثانية داخل نافذتها.
create or replace function app_consume_preauth_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv sales_invoices%rowtype;
  v_pa  insurance_preauthorizations%rowtype;
begin
  if new.item_id is null then
    return new;
  end if;
  select * into v_inv from sales_invoices where id = new.invoice_id;
  if v_inv.id is null or v_inv.patient_id is null or not v_inv.is_insurance_invoice then
    return new;
  end if;

  v_pa := app_active_preauthorization(v_inv.patient_id, new.item_id, current_date);
  if v_pa.id is null then
    return new;
  end if;

  update insurance_preauthorizations
     set consumed_at = now(), consumed_invoice_id = new.invoice_id, updated_at = now()
   where id = v_pa.id and consumed_at is null;

  new.preauthorization_id := v_pa.id;
  return new;
end;
$$;

drop trigger if exists trg_consume_preauth_on_invoice on sales_invoice_items;
create trigger trg_consume_preauth_on_invoice
  before insert on sales_invoice_items
  for each row execute function app_consume_preauth_on_invoice();

-- ===========================================================================
-- 5) خطّ الرحلة يعرف حالة الزيارة
-- ===========================================================================
--
-- **لا منظور جديد هنا.** `app_get_patient_timeline` (0067) يجمع الرحلة
-- بالفعل من أربعة عشر مصدرًا، وإضافة منظورٍ ثانٍ لنفس الغرض تعني خطّين
-- زمنيّين يفترقان. الناقص فيه شيء واحد: حدث الزيارة يعرض الشكوى ولا يعرض
-- **حالتها** — أضافها 0087 ولم يعرفها الخطّ الزمني بعد، فزيارةٌ موقَّعة
-- وزيارةٌ ملغاة تبدوان سواءً في رحلة المريض.
create or replace function app_patient_timeline_visit_status(p_visit_id uuid)
returns text
language sql
stable
as $$
  select case v.status
    when 'planned'     then 'مخطَّطة'
    when 'waiting'     then 'منتظرة'
    when 'in_progress' then 'جارية'
    when 'completed'   then 'مكتملة'
    when 'signed'      then 'موقَّعة'
    when 'closed'      then 'مغلقة ماليًا'
    when 'cancelled'   then 'ملغاة'
    else v.status
  end
  from patient_visits v where v.id = p_visit_id;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_get_patient_timeline';

  -- الاستبدال بالنصّ لا بإعادة الكتابة: الدالة أربعمئة سطر لم يتغيّر منها
  -- إلّا سطر واحد، وكل نسخة يدوية فرصة لخطأ.
  if v_def like '%''زيارة طبية'', coalesce(v.main_complaint, ''—''), null, ''medical_records''%' then
    v_def := replace(v_def,
      '''زيارة طبية'', coalesce(v.main_complaint, ''—''), null, ''medical_records''',
      '''زيارة طبية'', coalesce(v.main_complaint, ''—''), app_patient_timeline_visit_status(v.id), ''medical_records''');
    execute v_def;
  elsif v_def not like '%app_patient_timeline_visit_status%' then
    raise exception 'تعذّر ترقيع الخطّ الزمني: شكل الدالة تغيّر — راجع 0067';
  end if;
end $$;

revoke all on function app_patient_timeline_visit_status(uuid) from public, anon;
grant execute on function app_patient_timeline_visit_status(uuid) to authenticated;

-- ===========================================================================
-- 5.1) إزالة الخطّ الزمنيّ المكرَّر
-- ===========================================================================
--
-- `v_patient_journey` (0018) و`app_get_patient_timeline` (0067) يجيبان السؤال
-- نفسه من المصادر نفسها. المنظور القديم **لا يقرؤه شيء** في التطبيق منذ 0067
-- — تحقّقتُ بفحص شجرة العميل كلها — وبقاؤه يعني خطّين زمنيّين يفترقان كلما
-- أُضيف حدث إلى أحدهما دون الآخر، وهو ما حدث فعلًا: المنظور لا يعرف الصرف
-- ولا المطالبات ولا حالات الزيارة التي أضافها 0087.
--
-- يُحذف لأنه منظور مشتقّ لا بيانات فيه: لا شيء يضيع.
drop view if exists v_patient_journey;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'patient_visits'
         and column_name = 'status') not like '%planned%' then
    raise exception 'الزيارة الجديدة ما زالت تولد مكتملة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_sync_visit_with_reception')
     or not exists (select 1 from pg_trigger where tgname = 'trg_init_visit_status') then
    raise exception 'مزامنة الاستقبال مع الزيارة غير مركَّبة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_consume_preauth_on_invoice') then
    raise exception 'استهلاك الموافقة المسبقة عند الفوترة غير مركَّب';
  end if;
end $$;



-- ###########################################################################
-- ###  تقرير ختاميّ — يفشل الملف كله إن نقص شيء
-- ###########################################################################
do $final$
declare
  v_missing text := '';
  v_t       text;
  v_bad     int;
begin
  foreach v_t in array array[
    'lab_test_components','lab_reference_ranges','lab_result_amendments',
    'resource_bookings','exam_template_sections','exam_template_fields',
    'exam_field_options','procedure_codes','inventory_reservations',
    'insurance_networks','insurance_contracts','insurance_coverage_rules'
  ] loop
    if to_regclass('public.' || v_t) is null then
      v_missing := v_missing || v_t || '  ';
    end if;
  end loop;

  foreach v_t in array array[
    'app_set_lab_order_status','app_enter_lab_result','app_set_radiology_order_status',
    'app_book_resource','app_clone_exam_template','app_set_visit_status',
    'app_dispense_prescription','app_cancel_dispensing','app_adjust_stock','app_save_drug',
    'app_insurance_coverage','app_set_claim_form_status','app_resubmit_claim_form',
    'app_active_preauthorization','app_resolve_item_price_v2'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_t) then
      v_missing := v_missing || v_t || '()  ';
    end if;
  end loop;

  if v_missing <> '' then
    raise exception 'نقص بعد التنفيذ: %', v_missing;
  end if;

  -- لا صفّ بقي على حالة قديمة: الترحيل تمّ فعلًا لا شكلًا.
  select count(*) into v_bad from lab_orders where status = 'completed';
  if v_bad > 0 then
    raise exception 'بقي % طلب مختبر على الحالة القديمة completed', v_bad;
  end if;
  select count(*) into v_bad from radiology_orders where status in ('completed','reported');
  if v_bad > 0 then
    raise exception 'بقي % طلب أشعة على حالة قديمة', v_bad;
  end if;
  select count(*) into v_bad from items
   where medical_service_type in ('lab','package','product');
  if v_bad > 0 then
    raise exception 'بقي % صنف على نوع خدمة قديم', v_bad;
  end if;

  raise notice ' ';
  raise notice '═══════════════════════════════════════════════';
  raise notice '  ✅ طُبّقت الهجرات 0083 → 0090 كاملةً بنجاح';
  raise notice '═══════════════════════════════════════════════';
  raise notice '  12 جدولًا · 15 دالة · وترحيل البيانات القديمة';
  raise notice '  تحقّقت كلها قبل الـ commit.';
  raise notice ' ';
  raise notice '  الخطوة التالية: ادفع الكود وانشره، ثم أنشئ';
  raise notice '  «قائمة أسعار أساس» واحدة من شاشة قوائم الأسعار.';
  raise notice '═══════════════════════════════════════════════';
end $final$;

commit;
