-- ============================================================================
-- 0142 — جلسات الجلدية والتجميل: الجهاز والمنطقة والإعدادات والفاصل الآمن
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `treatment_sessions` (الموجود) يعرف: أيّ مريض، وأيّ طبيب، ورقم الجلسة،
--   وتاريخها، وحالتها، وملاحظة نصّية. وهذا يكفي لعدّ الجلسات المتفَق عليها،
--   ولا يكفي لجلسة ليزر ولا حقن:
--
--     1) **لا منطقة جسم.** جلسة ليزر لـ«الوجه» وأخرى لـ«الساقين» تُسجَّلان
--        سواءً. فلا يُعرف كم جلسة بقيت لكل منطقة، ولا تُقارَن نتيجة منطقة
--        بأخرى.
--
--     2) **لا جهاز ولا إعدادات.** الطاقة ونوع الليزر وعدد النبضات تُكتب في
--        ملاحظة أو لا تُكتب. والجلسة التالية تُعاد بلا معرفة ما استُعمل في
--        السابقة — وهذا خطأ سريريّ لا إداريّ: رفع الطاقة على غير أساس يحرق.
--
--     3) **لا فاصل زمنيّ محروس.** جلسة ليزر قبل أوانها تُسبّب حروقًا
--        وتصبّغات. النظام اليوم يقبل جلستين في يوم واحد بلا اعتراض.
--
--     4) **لا صور قبل/بعد.** وهي جوهر التجميل: لا يُقاس التحسّن بلا صورة،
--        ولا يُردّ على شكوى مريضٍ بلا دليل.
--
--     5) **لا أثر عرضٍ جانبيّ.** الاحمرار والتقرّح والتصبّغ لا مكان لها،
--        فتضيع في ملاحظة نصّية ولا تُستخرَج ولا تُنبّه أحدًا.
--
-- ما يفعله هذا الملف:
--   • **يوسّع `treatment_sessions` نفسه** لا يُنشئ جدول جلسات ثانيًا:
--     المنطقة، الجهاز (من `resources` القائم)، الإعدادات، الأعراض، وقت
--     التنفيذ، والفاصل الموصى به.
--   • بروتوكول الخدمة: كم جلسة، وكم يومًا بينها — في `items` مرّة واحدة.
--   • حارس الفاصل الزمنيّ: لا جلسة قبل أوانها إلا بتجاوزٍ مُعلَّل مسجَّل.
--   • صور قبل/بعد عبر `entity_documents` القائم — لا جدول مرفقات رابع.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.treatment_sessions') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0142: `treatment_sessions` غير موجود.';
  end if;
  if to_regclass('public.entity_documents') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0142: شغّل 0102_documents_and_signatures.sql أولًا.';
  end if;
  if to_regclass('public.resources') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0142: `resources` غير موجود (0084).';
  end if;
end
$zc_pre$;

-- ===========================================================================
-- 1) بروتوكول الخدمة: كم جلسة وكم بينها
-- ===========================================================================
-- الرقمان في الكتالوج لا في رأس الموظّف: «ليزر الوجه ٦ جلسات كل ٤ أسابيع»
-- تُكتب مرّة، فتُحسب مواعيد المريض وتُحرَس الفواصل بلا اجتهاد.
alter table items
  add column if not exists default_sessions_count int,
  add column if not exists session_interval_days  int,
  add column if not exists min_interval_days       int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_session_protocol_check') then
    alter table items add constraint items_session_protocol_check
      check ((default_sessions_count is null or default_sessions_count between 1 and 100)
         and (session_interval_days is null or session_interval_days between 1 and 365)
         and (min_interval_days is null or min_interval_days between 1 and 365)
         and (min_interval_days is null or session_interval_days is null
              or min_interval_days <= session_interval_days));
  end if;
end $$;

comment on column items.session_interval_days is
  'الفاصل الموصى به بين جلستين بالأيام — يُقترح به موعد الجلسة التالية.';
comment on column items.min_interval_days is
  'أقلّ فاصل مسموح. الجلسة قبله تحتاج تجاوزًا مُعلَّلًا يُسجَّل — لأن التبكير في الليزر يحرق.';

-- ===========================================================================
-- 2) توسيع الجلسة القائمة
-- ===========================================================================
-- **لا جدول جلسات ثانٍ.** `treatment_sessions` هو الجلسة في هذا النظام،
-- وإنشاء «جلسة تجميل» بجانبه يعني عدّادين للجلسة الواحدة يفترقان.
alter table treatment_sessions
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists item_id              uuid references items(id),
  add column if not exists body_area_value_id   uuid references lookup_values(id),
  add column if not exists body_area_note       text,
  add column if not exists device_resource_id   uuid references resources(id),
  add column if not exists parameters           jsonb not null default '{}'::jsonb,
  add column if not exists adverse_events       text[] not null default '{}',
  add column if not exists adverse_note         text,
  add column if not exists performed_at         timestamptz,
  add column if not exists performed_by         uuid references auth.users(id),
  add column if not exists next_due_date        date,
  add column if not exists interval_override_reason text,
  add column if not exists package_id           uuid references patient_packages(id),
  add column if not exists updated_at           timestamptz not null default now();

comment on column treatment_sessions.parameters is
  'إعدادات الجهاز كما استُعملت فعلًا (طاقة، طول موجة، عدد نبضات…). تُقرأ في الجلسة التالية بدل التخمين.';
comment on column treatment_sessions.adverse_events is
  'الأعراض الجانبية الملاحَظة — قائمة مغلقة تُستخرَج وتُحصى، لا نصّ يضيع في ملاحظة.';
comment on column treatment_sessions.interval_override_reason is
  'سبب تنفيذ الجلسة قبل أقلّ فاصل مسموح. بلا سبب لا تُنفَّذ.';

create index if not exists idx_sessions_patient_item
  on treatment_sessions (patient_id, item_id, performed_at desc);
create index if not exists idx_sessions_due
  on treatment_sessions (organization_id, next_due_date)
  where status = 'completed';

-- الأعراض الجانبية: قائمة مغلقة.
create or replace function app_adverse_event_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['redness','swelling','blistering','burn','hyperpigmentation',
               'hypopigmentation','pain','itching','infection','scarring','none'];
$$;

create or replace function app_guard_session_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_bad text;
begin
  select e into v_bad from unnest(coalesce(new.adverse_events, '{}')) e
   where e <> all(app_adverse_event_keys()) limit 1;
  if v_bad is not null then
    raise exception 'عرض جانبيّ غير معروف: %', v_bad;
  end if;

  -- «لا شيء» مع عرضٍ آخر تناقض: إمّا سليمة أو فيها شيء.
  if 'none' = any(coalesce(new.adverse_events, '{}'))
     and array_length(new.adverse_events, 1) > 1 then
    raise exception 'لا يجتمع «بلا أعراض» مع عرضٍ مسجَّل';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_session_row on treatment_sessions;
create trigger trg_guard_session_row
  before insert or update on treatment_sessions
  for each row execute function app_guard_session_row();

-- ===========================================================================
-- 3) صور قبل/بعد — عبر المستندات القائمة لا جدول مرفقات رابع
-- ===========================================================================
-- في النظام أربع طبقات مرفقات سلفًا (مستندات المريض، مستندات الكيانات، صور
-- الأشعة، مرفقات المختبر). خامسةٌ للجلسات تعني خمس نسخ من منطقٍ واحد. تُوسَّع
-- أنواع كيانات `entity_documents` لتقبل الجلسة، فتعمل سياسات التخزين ودالّة
-- التسجيل كما هي.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'entity_documents'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%entity_type%'
   limit 1;

  if v_def is null then
    raise exception 'قيد أنواع كيانات المستندات غير موجود';
  end if;

  if position('treatment_session' in v_def) = 0 then
    execute 'alter table entity_documents drop constraint '
            || (select conname from pg_constraint
                 where conrelid = 'entity_documents'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%entity_type%' limit 1);
    alter table entity_documents add constraint entity_documents_entity_type_check
      check (entity_type = any(array['asset','asset_calibration','maintenance_order',
                                     'distributor','purchase_invoice','purchase_order',
                                     'insurance_company','organization','branch',
                                     'treatment_session','other']));
  end if;
end $$;

-- فئة الصورة: قبل أم بعد. `category` في `entity_documents` نصّ حرّ، فالقيم
-- المعتادة تُوثَّق هنا ويستعملها العرض أدناه.
comment on column entity_documents.category is
  'فئة المستند. لصور الجلسات: before أو after — يقرأهما v_session_photos.';

-- ===========================================================================
-- 4) تسجيل جلسة — عملية واحدة
-- ===========================================================================
-- تحسب رقم الجلسة، وتحرس الفاصل الزمنيّ، وتسجّل الجهاز والإعدادات
-- والأعراض، وتحسب موعد الجلسة التالية. الفصل بين هذه يعني جلسةً منفَّذة بلا
-- موعدٍ تالٍ، أو فاصلًا يُتجاوَز بلا أثر.
create or replace function app_record_treatment_session(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_item_id         uuid,
  p_doctor_id       uuid default null,
  p_body_area_value_id uuid default null,
  p_device_resource_id uuid default null,
  p_parameters      jsonb default '{}'::jsonb,
  p_adverse_events  text[] default '{}',
  p_adverse_note    text default null,
  p_note            text default null,
  p_agreement_item_id uuid default null,
  p_package_id      uuid default null,
  p_override_reason text default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id        uuid;
  v_last      timestamptz;
  v_min       int;
  v_interval  int;
  v_number    int;
  v_days      numeric;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الجلسات';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  select min_interval_days, session_interval_days into v_min, v_interval
    from items where id = p_item_id and organization_id = p_organization_id;
  if not found then
    raise exception 'الخدمة غير موجودة في هذه المنشأة';
  end if;

  if p_device_resource_id is not null and not exists (
       select 1 from resources where id = p_device_resource_id
        and organization_id = p_organization_id) then
    raise exception 'الجهاز غير موجود في هذه المنشأة';
  end if;

  -- الفاصل يُحسب على **نفس الخدمة ونفس المنطقة**: ليزر الوجه لا يمنع ليزر
  -- الساقين في اليوم نفسه.
  select max(performed_at) into v_last
    from treatment_sessions
   where patient_id = p_patient_id
     and item_id = p_item_id
     and status = 'completed'
     and coalesce(body_area_value_id::text, '-')
         = coalesce(p_body_area_value_id::text, '-');

  if v_last is not null and v_min is not null then
    v_days := extract(epoch from (now() - v_last)) / 86400.0;
    if v_days < v_min then
      if coalesce(btrim(coalesce(p_override_reason,'')), '') = '' then
        raise exception
          'الجلسة السابقة قبل % يومًا، وأقلّ فاصل مسموح % يومًا. التبكير يحتاج سببًا مُعلَّلًا.',
          round(v_days)::text, v_min;
      end if;
    end if;
  end if;

  select coalesce(max(session_number), 0) + 1 into v_number
    from treatment_sessions
   where patient_id = p_patient_id and item_id = p_item_id;

  insert into treatment_sessions (organization_id, branch_id, patient_id, doctor_id,
                                  item_id, agreement_item_id, package_id,
                                  body_area_value_id, device_resource_id,
                                  parameters, adverse_events, adverse_note,
                                  session_number, scheduled_date, status, note,
                                  performed_at, performed_by, next_due_date,
                                  interval_override_reason)
  values (p_organization_id, p_branch_id, p_patient_id, p_doctor_id,
          p_item_id, p_agreement_item_id, p_package_id,
          p_body_area_value_id, p_device_resource_id,
          coalesce(p_parameters, '{}'::jsonb),
          coalesce(p_adverse_events, '{}'),
          nullif(btrim(coalesce(p_adverse_note,'')), ''),
          v_number, current_date, 'completed',
          nullif(btrim(coalesce(p_note,'')), ''),
          now(), auth.uid(),
          case when v_interval is not null
               then current_date + v_interval else null end,
          nullif(btrim(coalesce(p_override_reason,'')), ''))
  returning id into v_id;

  -- عرضٌ جانبيّ حقيقيّ يُخطَر به، ولا يُترك في سجلٍّ لا يفتحه أحد.
  if array_length(coalesce(p_adverse_events, '{}'), 1) > 0
     and not ('none' = any(p_adverse_events)) then
    perform app_notify_event(
      p_organization_id, 'session_adverse_event', 'عرض جانبيّ في جلسة',
      'adverse:' || v_id::text,
      coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
        || ' — ' || array_to_string(p_adverse_events, ', '),
      'treatment_session', v_id, '/patients/' || p_patient_id::text, p_branch_id);
  end if;

  return v_id;
end;
$$;

create or replace function app_seed_session_rules(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into notification_rules (organization_id, event_key, name_ar, category,
                                  severity, target_permission, channel)
  select p_org, 'session_adverse_event', 'عرض جانبيّ في جلسة', 'clinical',
         'warning', 'medical_records.view', 'internal'
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org
                       and r.event_key = 'session_adverse_event');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $zc_hook$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'app_seed_notification_rules';
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'app_seed_notification_rules غير موجودة'; end if;
  if position('app_seed_session_rules' in v_src) > 0 then return; end if;
  v_new := replace(v_src, E'  return v_n;',
                   E'  v_n := v_n + app_seed_session_rules(p_org);\n  return v_n;');
  if v_new = v_src then raise exception 'تعذّر ربط قاعدة الأعراض الجانبية بالبذر'; end if;
  execute v_new;
end
$zc_hook$;

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_session_rules(r.id);
  end loop;
end $$;

do $$
declare v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('app_record_treatment_session','app_adverse_event_keys',
                         'app_seed_session_rules')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- ===========================================================================
-- 5) العروض
-- ===========================================================================

drop view if exists v_session_history;
create view v_session_history
with (security_invoker = on) as
select s.id,
       s.organization_id,
       s.branch_id,
       s.patient_id,
       p.name_ar        as patient_name,
       s.item_id,
       i.name_ar        as service_name,
       s.session_number,
       s.status,
       s.body_area_value_id,
       b.name_ar        as body_area,
       s.device_resource_id,
       r.name_ar        as device_name,
       s.parameters,
       s.adverse_events,
       s.adverse_note,
       s.doctor_id,
       d.name_ar        as doctor_name,
       s.performed_at,
       s.scheduled_date,
       s.next_due_date,
       s.interval_override_reason,
       s.note,
       i.default_sessions_count,
       i.session_interval_days,
       (select count(*) from treatment_sessions x
         where x.patient_id = s.patient_id and x.item_id = s.item_id
           and x.status = 'completed')                as completed_for_service
  from treatment_sessions s
  join patients p on p.id = s.patient_id
  left join items i on i.id = s.item_id
  left join lookup_values b on b.id = s.body_area_value_id
  left join resources r on r.id = s.device_resource_id
  left join doctors d on d.id = s.doctor_id;

comment on view v_session_history is
  'تاريخ جلسات المريض بالجهاز والمنطقة والإعدادات والأعراض — ما يُقرأ قبل الجلسة التالية.';

-- ما استُحقّ ولم يُنفَّذ: مرضى ينتظرون جلستهم التالية.
drop view if exists v_sessions_due;
create view v_sessions_due
with (security_invoker = on) as
select distinct on (s.patient_id, s.item_id, s.body_area_value_id)
       s.id            as last_session_id,
       s.organization_id,
       s.branch_id,
       s.patient_id,
       p.name_ar       as patient_name,
       p.phone_1       as patient_phone,
       s.item_id,
       i.name_ar       as service_name,
       s.body_area_value_id,
       b.name_ar       as body_area,
       s.session_number,
       i.default_sessions_count,
       s.performed_at  as last_performed_at,
       s.next_due_date,
       (current_date - s.next_due_date)               as days_overdue,
       s.doctor_id,
       d.name_ar       as doctor_name
  from treatment_sessions s
  join patients p on p.id = s.patient_id
  left join items i on i.id = s.item_id
  left join lookup_values b on b.id = s.body_area_value_id
  left join doctors d on d.id = s.doctor_id
 where s.status = 'completed'
   and s.next_due_date is not null
   -- انتهى البروتوكول؟ لا استحقاق بعده.
   and (i.default_sessions_count is null
        or s.session_number < i.default_sessions_count)
 -- `session_number` فاصلٌ حاسم بعد الوقت: جلستان تُسجَّلان في معاملة واحدة
 -- تحملان `now()` نفسها (وقت المعاملة لا وقت السطر)، فالترتيب بالوقت وحده
 -- يختار إحداهما اعتباطًا — ويصير «الجلسة الأخيرة» رقمًا لا يُعتمد عليه.
 order by s.patient_id, s.item_id, s.body_area_value_id,
          s.performed_at desc, s.session_number desc;

comment on view v_sessions_due is
  'الجلسة التالية المستحقّة لكل مريض/خدمة/منطقة — ومن تأخّر عنها.';

-- صور قبل/بعد لكل جلسة، من المستندات القائمة.
drop view if exists v_session_photos;
create view v_session_photos
with (security_invoker = on) as
select e.id,
       e.organization_id,
       e.entity_id     as session_id,
       s.patient_id,
       e.category,
       e.title,
       e.storage_path,
       e.file_name,
       e.mime_type,
       e.file_size_bytes,
       e.created_at
  from entity_documents e
  join treatment_sessions s on s.id = e.entity_id
 where e.entity_type = 'treatment_session'
   and not coalesce(e.is_archived, false);

comment on view v_session_photos is
  'صور الجلسات (before/after) — مصدرها entity_documents، لا جدول مرفقات خامس.';

-- ===========================================================================
-- 6) تحقّق فوريّ
-- ===========================================================================
do $zc_verify$
declare v_n int;
begin
  if to_regprocedure('public.app_record_treatment_session(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text[],text,text,uuid,uuid,text,uuid)') is null then
    raise exception 'app_record_treatment_session لم تُنشأ بالتوقيع المتوقَّع';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_session_row') then
    raise exception 'حارس الجلسة لم يُركَّب';
  end if;

  -- نوع الكيان الجديد مقبول فعلًا لا شكلًا.
  if position('treatment_session' in
       (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'entity_documents'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%entity_type%' limit 1)) = 0 then
    raise exception 'entity_documents لا يقبل مستندات الجلسات';
  end if;

  if exists (select 1 from organizations o
              where not exists (select 1 from notification_rules r
                                 where r.organization_id = o.id
                                   and r.event_key = 'session_adverse_event')) then
    raise exception 'منشأة بلا قاعدة تنبيه للأعراض الجانبية';
  end if;

  select count(*) into v_n from information_schema.columns
   where table_name = 'treatment_sessions'
     and column_name in ('body_area_value_id','device_resource_id','parameters',
                         'adverse_events','performed_at','next_due_date','item_id');
  if v_n <> 7 then
    raise exception 'أعمدة الجلسة السريرية ناقصة (% من 7)', v_n;
  end if;
end
$zc_verify$;
