-- ============================================================================
-- 0105 — المرحلة 25: مساحة عمل الطبيب والقيم الحرجة
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة**: إبلاغ الطبيب يتمّ بتنبيه
-- داخل النظام (المرحلة 23)، وتوثيق الإبلاغ الهاتفي يُسجَّل يدويًّا كما يجري
-- في المختبرات فعلًا — لا إرسال رسائل ولا تكامل مزوّد.
--
-- الثغرة التي تُغلق هنا، وهي **ثغرة سلامة مرضى لا ثغرة راحة**:
--
--   `lab_order_items.is_critical` موجود في المخطط منذ المرحلة 0083، ويُعلَّم
--   فعلًا عند إدخال نتيجةٍ خارج الحدود الحرجة. و`radiology_order_items`
--   فيه `is_urgent_finding`. ومع ذلك: **لا أحد ملزَم بأن يعرف**. لا إبلاغ،
--   ولا إقرار باستلام، ولا تصعيد إن لم يردّ أحد. قيمة بوتاسيوم مميتة تُسجَّل
--   في القاعدة ويُقفل المختبر، والطبيب لا يعلم.
--
--   المعيار المتّبع عالميًّا لهذه الحالة (critical value read-back) هو:
--   يُبلَّغ الطبيب المعالج، ويُعيد قراءة القيمة بصوته إثباتًا لفهمها، ويُوثَّق
--   الإجراء المتَّخذ. ومن لا يُقِرّ خلال مدّة محدّدة يُصعَّد أمره.
--
-- ولذلك: **الإقرار هنا يشترط إعادة القراءة نصًّا**. إقرارٌ بضغطة زر بلا
-- إعادة قراءة توثيقٌ كاذب — يُثبت أن أحدًا ضغط، لا أن أحدًا فهم.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if to_regclass('public.patient_portal_accounts') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql  (بوابة المريض)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0105_doctor_workspace.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('doctor_workspace.view',   'مساحة عمل الطبيب',        'doctor_workspace', 1800),
  ('critical.acknowledge',    'الإقرار بالقيم الحرجة',   'doctor_workspace', 1802),
  ('critical.oversee',        'متابعة القيم الحرجة',     'doctor_workspace', 1804)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'doctor_workspace.view'), ('doctor', 'critical.acknowledge'),
  ('branch_manager', 'doctor_workspace.view'), ('branch_manager', 'critical.oversee'),
  ('nurse',          'doctor_workspace.view'),
  ('lab_technician', 'critical.oversee'),
  ('radiology_technician', 'critical.oversee')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) بلاغات القيم الحرجة
-- ===========================================================================
create table if not exists critical_result_notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  patient_id        uuid not null references patients(id),
  source_kind       text not null check (source_kind in ('lab','radiology')),
  source_order_id   uuid not null,
  source_item_id    uuid not null,
  test_name         text,
  result_value      text,
  ordering_doctor_id uuid references doctors(id),
  detected_at       timestamptz not null default now(),
  -- الإبلاغ الهاتفي يُوثَّق كما جرى فعلًا: من اتصل ومتى وبمن
  phoned_at         timestamptz,
  phoned_by         uuid references auth.users(id),
  phoned_to         text,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid references auth.users(id),
  -- **إعادة القراءة**: نصّ ما أعاده المستلم بلسانه. هي جوهر الإجراء.
  read_back_text    text,
  action_taken      text,
  escalation_level  integer not null default 0,
  escalated_at      timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- بلاغ واحد لكل نتيجة: تكرار البلاغ يشتّت المتابعة
create unique index if not exists uq_critical_source
  on critical_result_notifications (source_kind, source_item_id);
create index if not exists idx_critical_open
  on critical_result_notifications (organization_id, acknowledged_at, detected_at);

alter table critical_result_notifications enable row level security;

-- **لا حذف لبلاغ قيمة حرجة**: أثرُه دليلٌ في أيّ مراجعة أو نزاع
create or replace function app_block_critical_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'بلاغ القيمة الحرجة لا يُحذف';
end $$;

drop trigger if exists trg_block_critical_delete on critical_result_notifications;
create trigger trg_block_critical_delete
  before delete on critical_result_notifications
  for each row execute function app_block_critical_delete();

-- ===========================================================================
-- 3) الالتقاط: النتيجة الحرجة تُنشئ بلاغًا وتُنبّه طبيبها فورًا
-- ===========================================================================
create or replace function app_raise_critical_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_branch   uuid;
  v_patient  uuid;
  v_doctor   uuid;
  v_doc_user uuid;
  v_name     text;
  v_value    text;
  v_id       uuid;
  v_pname    text;
  v_kind     text;
  v_order    uuid;
begin
  if tg_table_name = 'lab_order_items' then
    if not coalesce(new.is_critical, false) then return new; end if;
    select o.organization_id, o.branch_id, o.patient_id, o.ordering_doctor_id
      into v_org, v_branch, v_patient, v_doctor
      from lab_orders o where o.id = new.lab_order_id;
    select name_ar into v_name from lab_tests where id = new.lab_test_id;
    v_value := new.result_value;
    v_kind  := 'lab';
    v_order := new.lab_order_id;
  else
    if not coalesce(new.is_urgent_finding, false) then return new; end if;
    select o.organization_id, o.branch_id, o.patient_id, o.ordering_doctor_id
      into v_org, v_branch, v_patient, v_doctor
      from radiology_orders o where o.id = new.radiology_order_id;
    select name_ar into v_name from radiology_exams where id = new.radiology_exam_id;
    v_value := new.impression;
    v_kind  := 'radiology';
    v_order := new.radiology_order_id;
  end if;

  if v_org is null then return new; end if;

  insert into critical_result_notifications (
    organization_id, branch_id, patient_id, source_kind, source_order_id,
    source_item_id, test_name, result_value, ordering_doctor_id)
  -- المعرّفات تُلتقط داخل فرعها أعلاه: `new` لا يحمل حقول الجدول الآخر،
  -- وأيّ إشارة إليها هنا تفشل وقت التنفيذ مهما كان الشرط.
  values (
    v_org, v_branch, v_patient, v_kind, v_order,
    new.id, v_name, v_value, v_doctor)
  on conflict (source_kind, source_item_id) do nothing
  returning id into v_id;

  if v_id is null then return new; end if;   -- بلاغ قائم، لا تكرار

  select name_ar into v_pname from patients where id = v_patient;
  select user_id into v_doc_user from doctors where id = v_doctor;

  -- **الطبيب الطالب يُنبَّه شخصيًّا**: هذا أحد المواضع التي يكون فيها
  -- المستقبِل شخصًا بعينه لا صاحب صلاحية — لأن المسؤولية السريرية شخصية.
  if v_doc_user is not null then
    perform app_notify(
      v_org, v_doc_user, 'critical_result',
      format('قيمة حرجة: %s — %s', coalesce(v_name, 'فحص'), coalesce(v_pname, '')),
      format('critical:%s', v_id),
      format('النتيجة: %s', coalesce(v_value, '')),
      'clinical', 'critical', 'critical_result', v_id, '/doctor-workspace', v_branch);
  end if;

  -- ومَن يتابع القيم الحرجة يُنبَّه أيضًا: الطبيب قد يكون في عملية
  perform app_notify_event(
    v_org, 'critical_result',
    format('قيمة حرجة بانتظار إقرار: %s', coalesce(v_name, 'فحص')),
    format('critical-oversee:%s', v_id),
    coalesce(v_pname, ''), 'critical_result', v_id, '/doctor-workspace', v_branch);

  return new;
end $$;

drop trigger if exists trg_raise_critical_lab on lab_order_items;
create trigger trg_raise_critical_lab
  after insert or update of is_critical, result_value on lab_order_items
  for each row execute function app_raise_critical_result();

drop trigger if exists trg_raise_critical_radiology on radiology_order_items;
create trigger trg_raise_critical_radiology
  after insert or update of is_urgent_finding, impression on radiology_order_items
  for each row execute function app_raise_critical_result();

-- قاعدة التوجيه للمتابعين
create or replace function app_seed_notification_rules(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into notification_rules (organization_id, event_key, name_ar, category,
                                  severity, target_permission)
  select p_org, v.k, v.n, v.c, v.s, v.p
  from (values
    ('asset_critical_fault', 'عطل حرِج في جهاز',            'operational', 'critical', 'assets.maintenance'),
    ('asset_out_of_service', 'جهاز خرج من الخدمة',          'operational', 'warning',  'assets.maintenance'),
    ('calibration_due',      'معايرة جهاز مستحقّة',          'operational', 'warning',  'assets.calibration'),
    ('stock_below_reorder',  'صنف تحت حدّ إعادة الطلب',      'inventory',   'warning',  'inventory.manage'),
    ('lot_expiring',         'دفعة تقارب انتهاء الصلاحية',   'inventory',   'warning',  'inventory.manage'),
    ('claim_rejected',       'مطالبة تأمين مرفوضة',          'financial',   'warning',  'insurance.claims'),
    ('payroll_awaiting_approval', 'مسيّر رواتب ينتظر الاعتماد','hr',         'warning',  'payroll.approve'),
    ('consent_overridden',   'تجاوز موافقة مريض',            'compliance',  'critical', 'audit.view'),
    ('document_expiring',    'مستند يقارب الانتهاء',         'compliance',  'warning',  'documents.view'),
    ('purchase_request_pending', 'طلب شراء ينتظر الموافقة',  'operational', 'info',     'purchasing.approve'),
    -- المرحلة 25
    ('critical_result',      'قيمة حرجة بانتظار إقرار',      'clinical',    'critical', 'critical.oversee'),
    ('critical_unacknowledged', 'قيمة حرجة لم يُقَرّ بها',    'clinical',    'critical', 'critical.oversee')
  ) as v(k, n, c, s, p)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_notification_rules(r.id);
  end loop;
end $$;

-- ===========================================================================
-- 4) الإقرار والتصعيد
-- ===========================================================================
create or replace function app_record_critical_phone_call(
  p_id      uuid,
  p_called  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  select organization_id into v_org from critical_result_notifications where id = p_id;
  if v_org is null then raise exception 'البلاغ غير موجود'; end if;
  if not app_has_permission(v_org, 'critical.oversee') then
    raise exception 'صلاحيتك لا تسمح بتوثيق إبلاغ القيم الحرجة (critical.oversee)';
  end if;
  if coalesce(trim(coalesce(p_called, '')), '') = '' then
    raise exception 'اسم من أُبلغ مطلوب — إبلاغٌ بلا مُبلَّغ ليس إبلاغًا';
  end if;

  update critical_result_notifications
     set phoned_at = now(), phoned_by = auth.uid(), phoned_to = trim(p_called),
         updated_at = now()
   where id = p_id;
end $$;

create or replace function app_acknowledge_critical_result(
  p_id        uuid,
  p_read_back text,
  p_action    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c critical_result_notifications%rowtype;
begin
  select * into c from critical_result_notifications where id = p_id for update;
  if c.id is null then raise exception 'البلاغ غير موجود'; end if;
  if not app_has_permission(c.organization_id, 'critical.acknowledge') then
    raise exception 'صلاحيتك لا تسمح بالإقرار بالقيم الحرجة (critical.acknowledge)';
  end if;
  if c.acknowledged_at is not null then
    raise exception 'أُقِرّ بهذا البلاغ سلفًا';
  end if;
  -- **إعادة القراءة إلزامية**: إقرارٌ بضغطة زر يثبت أن أحدًا ضغط، لا أن
  -- أحدًا فهم. النصّ هو ما يُراجَع لاحقًا.
  if coalesce(trim(coalesce(p_read_back, '')), '') = '' then
    raise exception 'إعادة قراءة القيمة مطلوبة — الإقرار بلا إعادة قراءة توثيقٌ فارغ';
  end if;
  if coalesce(trim(coalesce(p_action, '')), '') = '' then
    raise exception 'الإجراء المتَّخذ مطلوب';
  end if;

  update critical_result_notifications
     set acknowledged_at = now(), acknowledged_by = auth.uid(),
         read_back_text = trim(p_read_back), action_taken = trim(p_action),
         closed_at = now(), updated_at = now()
   where id = p_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (c.organization_id, c.branch_id, auth.uid(), 'clinical', 'update', p_id,
          'إقرار بقيمة حرجة',
          format('%s — %s | الإجراء: %s', coalesce(c.test_name, ''),
                 trim(p_read_back), trim(p_action)));
end $$;

-- التصعيد: ما لم يُقَرّ به خلال المهلة يُرفع لمن يتابع
create or replace function app_escalate_critical_results(
  p_org     uuid,
  p_minutes integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; v_n integer := 0;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;

  for r in
    select * from critical_result_notifications
     where organization_id = p_org
       and acknowledged_at is null
       and detected_at < now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 1))
  loop
    update critical_result_notifications
       set escalation_level = escalation_level + 1, escalated_at = now(), updated_at = now()
     where id = r.id;

    perform app_notify_event(
      p_org, 'critical_unacknowledged',
      format('قيمة حرجة بلا إقرار منذ %s دقيقة: %s',
             p_minutes, coalesce(r.test_name, 'فحص')),
      -- مفتاح لكل مستوى تصعيد: التصعيد الثاني تنبيهٌ جديد لا مكرّر
      format('critical-esc:%s:%s', r.id, r.escalation_level + 1),
      coalesce(r.result_value, ''), 'critical_result', r.id,
      '/doctor-workspace', r.branch_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ===========================================================================
-- 5) مناظير مساحة عمل الطبيب
-- ===========================================================================

-- 5.1 القيم الحرجة
drop view if exists v_critical_results;
create view v_critical_results
with (security_invoker = on) as
select
  c.id, c.organization_id, c.branch_id, c.patient_id,
  p.name_ar        as patient_name,
  p.file_number,
  c.source_kind, c.source_order_id, c.test_name, c.result_value,
  c.ordering_doctor_id,
  d.name_ar        as doctor_name,
  c.detected_at, c.phoned_at, c.phoned_to,
  c.acknowledged_at, c.read_back_text, c.action_taken,
  c.escalation_level,
  (c.acknowledged_at is null) as is_open,
  round(extract(epoch from (coalesce(c.acknowledged_at, now()) - c.detected_at)) / 60)::int
                    as minutes_to_ack,
  c.detected_at::date as report_date
from critical_result_notifications c
join patients p on p.id = c.patient_id
left join doctors d on d.id = c.ordering_doctor_id;

-- المنظور القديم `v_lab_critical_results` (المرحلة 0083) كان يعرض القيم
-- الحرجة بلا أيّ حالة إقرار — قائمةٌ تُرى ولا تُلزم أحدًا، ولم تكن أيّ شاشة
-- تقرؤها أصلًا. يُسقط الآن ليبقى مصدرٌ واحد للقيم الحرجة يحمل حالتها.
drop view if exists v_lab_critical_results;

comment on view v_critical_results is
  'القيم الحرجة وإقراراتها ومدّة الاستجابة — العمود الأهم هو ما لم يُقَرّ به بعد.';

-- 5.2 يوم الطبيب
drop view if exists v_doctor_worklist;
create view v_doctor_worklist
with (security_invoker = on) as
select
  a.id                  as appointment_id,
  a.organization_id,
  a.branch_id,
  a.doctor_id,
  doc.user_id           as doctor_user_id,
  a.patient_id,
  p.name_ar             as patient_name,
  p.file_number,
  a.scheduled_start,
  a.scheduled_end,
  a.status,
  cl.name               as clinic_name,
  a.checked_in_1_at,
  a.called_at,
  a.entered_at,
  -- انتظار المريض من لحظة تسجيل حضوره حتى دخوله (أو حتى الآن إن لم يدخل)
  case when a.checked_in_1_at is not null
       then round(extract(epoch from (coalesce(a.entered_at, now()) - a.checked_in_1_at)) / 60)::int
  end                   as waiting_minutes,
  v.id                  as visit_id,
  v.status              as visit_status,
  a.scheduled_start::date as report_date
from appointments a
join patients p on p.id = a.patient_id
left join doctors doc on doc.id = a.doctor_id
left join clinics cl on cl.id = a.clinic_id
left join patient_visits v on v.appointment_id = a.id;

comment on view v_doctor_worklist is
  'قائمة عمل الطبيب: مواعيد اليوم بحالتها وزمن انتظار كل مريض وزيارته إن فُتحت.';

-- 5.3 زيارات لم تُغلق
drop view if exists v_doctor_open_visits;
create view v_doctor_open_visits
with (security_invoker = on) as
select
  v.id                as visit_id,
  v.organization_id,
  v.branch_id,
  v.doctor_id,
  doc.user_id         as doctor_user_id,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  v.visit_date,
  v.status,
  -- `visit_date` طابع زمني لا تاريخ: الطرح المباشر يعطي فاصلًا لا عددًا
  (current_date - v.visit_date::date) as days_open,
  (select count(*) from patient_visit_services s where s.visit_id = v.id) as service_count,
  v.visit_date::date  as report_date
from patient_visits v
join patients p on p.id = v.patient_id
left join doctors doc on doc.id = v.doctor_id
where v.status in ('draft','in_progress');

comment on view v_doctor_open_visits is
  'زيارات مفتوحة لم تُوقَّع ولا تُغلق — الزيارة المفتوحة لا تُفوتر ولا تدخل مطالبة.';

grant select on v_critical_results, v_doctor_worklist, v_doctor_open_visits to authenticated;

-- ===========================================================================
-- 6) RLS
-- ===========================================================================
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'critical_result_notifications'
  loop execute format('drop policy %I on critical_result_notifications', pol.policyname); end loop;

  create policy critical_select on critical_result_notifications for select to authenticated
    using (app_is_member(organization_id));
  create policy critical_update on critical_result_notifications for update to authenticated
    using (app_has_permission(organization_id, 'critical.acknowledge')
           or app_has_permission(organization_id, 'critical.oversee'))
    with check (app_has_permission(organization_id, 'critical.acknowledge')
                or app_has_permission(organization_id, 'critical.oversee'));
end $$;

-- ===========================================================================
-- 7) الميزة وحجب الدوال
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'doctor_workspace', 'مساحة عمل الطبيب', 'Doctor Workspace', 'الكتالوج الطبي', false, 92
where not exists (select 1 from feature_catalog where feature_key = 'doctor_workspace');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'doctor_workspace', true from organizations o
on conflict (organization_id, feature_key) do nothing;

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is not null and position('''doctor_workspace''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''',
                            '''audit_log'',''settings'',''doctor_workspace''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة مساحة عمل الطبيب';
    end if;
    execute v_new;
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_raise_critical_result','app_acknowledge_critical_result',
                         'app_record_critical_phone_call','app_escalate_critical_results')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 8) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_raise_critical_result','app_acknowledge_critical_result',
                             'app_record_critical_phone_call','app_escalate_critical_results']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة القيم الحرجة % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_raise_critical_lab') then
    raise exception 'القيمة الحرجة في المختبر لا تُنشئ بلاغًا';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_raise_critical_radiology') then
    raise exception 'الاكتشاف العاجل في الأشعة لا يُنشئ بلاغًا';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_critical_source') then
    raise exception 'النتيجة الواحدة تُنشئ بلاغات مكرّرة';
  end if;

  foreach v_v in array array['v_critical_results','v_doctor_worklist','v_doctor_open_visits']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'المنظور % بلا security_invoker', v_v;
    end if;
  end loop;
end $$;
