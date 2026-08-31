-- ============================================================================
-- 0106 — المرحلة 26: الجودة وسلامة المرضى ومؤشرات الأداء
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- المبدأ الحاكم، وهو ما يفصل نظام جودة حقيقيًّا عن شاشة أرقام:
--
--   **المؤشّر يُحسب من بيانات النظام، لا يُكتب باليد.**
--
--   مؤشّرٌ يُدخله موظف يدويًّا كل شهر ليس قياسًا، بل رأيًا مكتوبًا في خانة.
--   وهو أسوأ من غياب المؤشّر لأنه يعطي طمأنينةً بلا أساس، ويُستشهد به في
--   الاعتماد وفي قرارات التشغيل. لذلك كل مؤشّر هنا مربوط بـ `metric_key`
--   من **قائمة مغلقة**، لكلٍّ منها استعلامٌ فعليّ على جداول النظام. وما لا
--   يمكن حسابه من البيانات (رضا المرضى مثلًا، وهو مسحٌ خارجيّ) يُعلَّم
--   صراحةً `is_manual` ويطالب بمصدرٍ مكتوب — فيَظهر للقارئ أنه مُدخَل لا
--   محسوب، ولا يختلط بغيره.
--
-- والحوادث: بلاغ سلامة المريض لا يُحذف، ولا يُغلق بلا سببٍ جذريّ وإجراء
-- تصحيحيّ. بلاغٌ يُغلق فارغًا يُحوّل نظام السلامة إلى أرشيف شكاوى.
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
  if to_regclass('public.critical_result_notifications') is null then
    v_missing := v_missing || E'\n  • 0105_doctor_workspace.sql  (مساحة الطبيب والنتائج الحرجة)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0106_quality.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('quality.view',      'عرض الجودة والمؤشرات',   'quality', 1900),
  ('quality.report',    'رفع بلاغات السلامة',     'quality', 1902),
  ('quality.investigate','التحقيق وإغلاق البلاغات','quality', 1904),
  ('quality.manage',    'إدارة المؤشرات وأهدافها','quality', 1906)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **رفع البلاغ حقٌّ لكل عامل**: نظام سلامة لا يُبلِّغ فيه إلا المدراء لا
-- يرى إلا ما يراه المدراء، وهم أبعد الناس عن موضع الخطأ.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'quality.view'), ('branch_manager', 'quality.report'),
  ('branch_manager', 'quality.investigate'), ('branch_manager', 'quality.manage'),
  ('doctor', 'quality.view'), ('doctor', 'quality.report'),
  ('nurse', 'quality.view'), ('nurse', 'quality.report'),
  ('receptionist', 'quality.report'),
  ('pharmacist', 'quality.report'),
  ('lab_technician', 'quality.report'),
  ('radiology_technician', 'quality.report'),
  ('employee', 'quality.report')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) بلاغات السلامة والحوادث
-- ===========================================================================
create table if not exists quality_incidents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  incident_number   bigint,
  category          text not null
                      check (category in ('medication','procedure','fall','infection',
                                          'documentation','equipment','identification',
                                          'communication','security','other')),
  severity          text not null default 'minor'
                      check (severity in ('near_miss','minor','moderate','major','sentinel')),
  occurred_at       timestamptz not null default now(),
  location_note     text,
  patient_id        uuid references patients(id),
  -- **البلاغ المجهول مسموح**: الخوف من التبعات أكبر أسباب كتمان الأخطاء
  is_anonymous      boolean not null default false,
  reported_by       uuid references auth.users(id),
  reported_at       timestamptz not null default now(),
  description       text not null,
  immediate_action  text,
  status            text not null default 'open'
                      check (status in ('open','under_investigation','closed')),
  root_cause        text,
  corrective_action text,
  preventive_action text,
  closed_by         uuid references auth.users(id),
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_quality_incidents_open
  on quality_incidents (organization_id, status, occurred_at desc);

alter table quality_incidents enable row level security;

create or replace function app_block_quality_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'بلاغ السلامة لا يُحذف — سجلّ الأخطاء هو ما يُتعلَّم منه';
end $$;

drop trigger if exists trg_block_quality_delete on quality_incidents;
create trigger trg_block_quality_delete
  before delete on quality_incidents
  for each row execute function app_block_quality_delete();

-- ===========================================================================
-- 3) المؤشّرات: التعريف والقياس
-- ===========================================================================
create table if not exists quality_indicators (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  metric_key      text not null,
  name_ar         text not null,
  domain          text not null default 'clinical'
                    check (domain in ('clinical','operational','financial','safety','experience')),
  unit            text not null default 'percent'
                    check (unit in ('percent','minutes','count','ratio','days')),
  -- الاتجاه المرغوب: هل ارتفاع الرقم تحسّن أم تدهور؟ بدونه لا معنى للهدف.
  higher_is_better boolean not null default false,
  target_value    numeric(14,2),
  -- المُدخَل يدويًّا يُعلَّم صراحةً ولا يختلط بالمحسوب
  is_manual       boolean not null default false,
  manual_source   text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_quality_indicator_key
  on quality_indicators (organization_id, metric_key);

alter table quality_indicators enable row level security;

create table if not exists quality_measurements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  indicator_id    uuid not null references quality_indicators(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  value           numeric(14,2),
  numerator       numeric(14,2),
  denominator     numeric(14,2),
  target_value    numeric(14,2),
  is_manual       boolean not null default false,
  note            text,
  measured_at     timestamptz not null default now(),
  measured_by     uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint quality_period_order check (period_end >= period_start)
);

-- قياس واحد لكل مؤشّر لكل فترة: قياسان لفترة واحدة يعني رقمين متناقضين
create unique index if not exists uq_quality_measurement_period
  on quality_measurements (indicator_id, period_start, period_end);

alter table quality_measurements enable row level security;

-- ===========================================================================
-- 4) حسّاب المؤشّرات — قائمة مغلقة، كلٌّ باستعلامه الفعلي
-- ===========================================================================
create or replace function app_compute_quality_metric(
  p_org   uuid,
  p_key   text,
  p_from  date,
  p_to    date,
  out numerator numeric,
  out denominator numeric,
  out value numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  numerator := null; denominator := null; value := null;

  if p_key = 'no_show_rate' then
    -- نسبة عدم الحضور: مواعيد لم يحضرها أصحابها ÷ المواعيد المنتهية
    select count(*) filter (where a.status = 'no_show'), count(*)
      into numerator, denominator
      from appointments a
     where a.organization_id = p_org
       and a.scheduled_start::date between p_from and p_to
       and a.status in ('no_show','completed','in_progress','arrived','checked_in',
                        'called','cancelled_by_patient','cancelled_by_staff');

  elsif p_key = 'patient_cancellation_rate' then
    select count(*) filter (where a.status = 'cancelled_by_patient'), count(*)
      into numerator, denominator
      from appointments a
     where a.organization_id = p_org
       and a.scheduled_start::date between p_from and p_to;

  elsif p_key = 'avg_waiting_minutes' then
    -- متوسّط الانتظار من تسجيل الحضور إلى دخول العيادة
    select avg(extract(epoch from (a.entered_at - a.checked_in_1_at)) / 60),
           count(*)
      into numerator, denominator
      from appointments a
     where a.organization_id = p_org
       and a.scheduled_start::date between p_from and p_to
       and a.checked_in_1_at is not null and a.entered_at is not null;
    value := round(coalesce(numerator, 0), 2);
    return;

  elsif p_key = 'critical_ack_within_30' then
    -- القيم الحرجة التي أُقِرّ بها خلال 30 دقيقة
    select count(*) filter (
             where c.acknowledged_at is not null
               and c.acknowledged_at <= c.detected_at + interval '30 minutes'),
           count(*)
      into numerator, denominator
      from critical_result_notifications c
     where c.organization_id = p_org
       and c.detected_at::date between p_from and p_to;

  elsif p_key = 'critical_unacknowledged' then
    select count(*), null::numeric into numerator, denominator
      from critical_result_notifications c
     where c.organization_id = p_org
       and c.detected_at::date between p_from and p_to
       and c.acknowledged_at is null;
    value := coalesce(numerator, 0);
    return;

  elsif p_key = 'consent_compliance' then
    -- الإجراءات التي تطلب موافقة ونُفّذت بموافقة موقَّعة (لا بتجاوز)
    select count(*) filter (where s.consent_overridden_at is null), count(*)
      into numerator, denominator
      from patient_visit_services s
      join items i on i.id = s.item_id
      join patient_visits v on v.id = s.visit_id
     where s.organization_id = p_org
       and i.requires_consent
       and s.status in ('performed','invoiced','paid','claimed')
       and v.visit_date::date between p_from and p_to;

  elsif p_key = 'visit_closure_rate' then
    select count(*) filter (where v.status not in ('draft','in_progress')), count(*)
      into numerator, denominator
      from patient_visits v
     where v.organization_id = p_org
       and v.visit_date::date between p_from and p_to;

  elsif p_key = 'claim_rejection_rate' then
    select count(*) filter (where f.status = 'rejected'), count(*)
      into numerator, denominator
      from insurance_claim_forms f
     where f.organization_id = p_org
       and f.created_at::date between p_from and p_to;

  elsif p_key = 'incident_rate' then
    select count(*), null::numeric into numerator, denominator
      from quality_incidents q
     where q.organization_id = p_org
       and q.occurred_at::date between p_from and p_to;
    value := coalesce(numerator, 0);
    return;

  elsif p_key = 'incident_closure_rate' then
    select count(*) filter (where q.status = 'closed'), count(*)
      into numerator, denominator
      from quality_incidents q
     where q.organization_id = p_org
       and q.occurred_at::date between p_from and p_to;

  elsif p_key = 'expired_stock_items' then
    select count(*), null::numeric into numerator, denominator
      from inventory_lots l
     where l.organization_id = p_org
       and l.qty_remaining > 0
       and l.expiry_date is not null
       and l.expiry_date <= p_to;
    value := coalesce(numerator, 0);
    return;

  elsif p_key = 'overdue_calibration_devices' then
    select count(*), null::numeric into numerator, denominator
      from assets a
     where a.organization_id = p_org
       and a.requires_calibration
       and a.status <> 'disposed'
       and a.next_calibration_date is not null
       and a.next_calibration_date < p_to;
    value := coalesce(numerator, 0);
    return;

  else
    -- **مفتاحٌ غير معروف لا يُحسب صفرًا**: الصفر رقمٌ يُصدَّق، والمجهول لا
    raise exception 'مؤشّر غير معروف أو غير محسوب آليًّا: %', p_key;
  end if;

  if coalesce(denominator, 0) = 0 then
    value := null;   -- لا مقام، فلا نسبة — ولا يُخترع صفر
  else
    value := round(100.0 * coalesce(numerator, 0) / denominator, 2);
  end if;
end $$;

-- ===========================================================================
-- 5) الدوال التشغيلية
-- ===========================================================================
create or replace function app_report_quality_incident(
  p_org         uuid,
  p_category    text,
  p_severity    text,
  p_description text,
  p_branch_id   uuid default null,
  p_patient_id  uuid default null,
  p_occurred_at timestamptz default now(),
  p_location    text default null,
  p_immediate   text default null,
  p_anonymous   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_num bigint;
begin
  if not app_has_permission(p_org, 'quality.report') then
    raise exception 'صلاحيتك لا تسمح برفع بلاغات السلامة (quality.report)';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'وصف الحادثة مطلوب';
  end if;
  if p_occurred_at > now() then
    raise exception 'لا يُبلَّغ عن حادثة في المستقبل';
  end if;

  v_num := app_next_document_number(p_org, 'quality_incident', p_branch_id);

  insert into quality_incidents (organization_id, branch_id, incident_number, category,
                                 severity, occurred_at, location_note, patient_id,
                                 is_anonymous, reported_by, description, immediate_action)
  values (p_org, p_branch_id, v_num, p_category, p_severity, p_occurred_at, p_location,
          p_patient_id, coalesce(p_anonymous, false),
          -- المجهول لا يُسجَّل مُبلِّغه أصلًا: حفظُ المعرّف مع وعدٍ بالكتمان وعدٌ هشّ
          case when coalesce(p_anonymous, false) then null else auth.uid() end,
          trim(p_description), p_immediate)
  returning id into v_id;

  perform app_notify_event(
    p_org,
    case when p_severity in ('major','sentinel') then 'quality_incident_severe'
         else 'quality_incident' end,
    format('بلاغ سلامة (%s): %s', p_severity, left(trim(p_description), 60)),
    format('incident:%s', v_id),
    p_location, 'quality_incident', v_id, '/quality', p_branch_id);

  return v_id;
end $$;

create or replace function app_close_quality_incident(
  p_id         uuid,
  p_root_cause text,
  p_corrective text,
  p_preventive text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare q quality_incidents%rowtype;
begin
  select * into q from quality_incidents where id = p_id for update;
  if q.id is null then raise exception 'البلاغ غير موجود'; end if;
  if not app_has_permission(q.organization_id, 'quality.investigate') then
    raise exception 'صلاحيتك لا تسمح بإغلاق بلاغات السلامة (quality.investigate)';
  end if;
  if q.status = 'closed' then raise exception 'البلاغ مغلق سلفًا'; end if;
  -- **لا إغلاق بلا سببٍ جذريّ وإجراء تصحيحيّ**: بلاغٌ يُغلق فارغًا يحوّل
  -- نظام السلامة إلى أرشيف شكاوى لا يتعلّم منه أحد.
  if coalesce(trim(coalesce(p_root_cause, '')), '') = '' then
    raise exception 'السبب الجذريّ مطلوب لإغلاق البلاغ';
  end if;
  if coalesce(trim(coalesce(p_corrective, '')), '') = '' then
    raise exception 'الإجراء التصحيحيّ مطلوب لإغلاق البلاغ';
  end if;

  update quality_incidents
     set status = 'closed', root_cause = trim(p_root_cause),
         corrective_action = trim(p_corrective),
         preventive_action = nullif(trim(coalesce(p_preventive, '')), ''),
         closed_by = auth.uid(), closed_at = now(), updated_at = now()
   where id = p_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (q.organization_id, q.branch_id, auth.uid(), 'quality', 'update', p_id,
          'إغلاق بلاغ سلامة', trim(p_root_cause));
end $$;

-- قياس مؤشّر لفترة: يُحسب من البيانات، والمُدخَل يدويًّا يحتاج مصدرًا
create or replace function app_measure_quality_indicator(
  p_indicator_id uuid,
  p_from         date,
  p_to           date,
  p_manual_value numeric default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ind quality_indicators%rowtype;
  v_num numeric; v_den numeric; v_val numeric; v_id uuid;
begin
  select * into ind from quality_indicators where id = p_indicator_id;
  if ind.id is null then raise exception 'المؤشّر غير موجود'; end if;
  if not app_has_permission(ind.organization_id, 'quality.manage') then
    raise exception 'صلاحيتك لا تسمح بقياس المؤشرات (quality.manage)';
  end if;
  if p_to < p_from then raise exception 'نهاية الفترة قبل بدايتها'; end if;
  if p_to > current_date then
    raise exception 'لا تُقاس فترة لم تنتهِ بعد';
  end if;

  if ind.is_manual then
    if p_manual_value is null then
      raise exception 'هذا مؤشّر مُدخَل يدويًّا — القيمة مطلوبة';
    end if;
    -- **المُدخَل يدويًّا يحتاج مصدرًا مكتوبًا**: رقمٌ بلا مصدر رأيٌ لا قياس
    if coalesce(trim(coalesce(p_note, ind.manual_source, '')), '') = '' then
      raise exception 'مصدر الرقم مطلوب للمؤشّر المُدخَل يدويًّا';
    end if;
    v_val := p_manual_value;
  else
    if p_manual_value is not null then
      raise exception 'هذا مؤشّر محسوب آليًّا — لا تُدخل له قيمة يدويّة';
    end if;
    select numerator, denominator, value into v_num, v_den, v_val
      from app_compute_quality_metric(ind.organization_id, ind.metric_key, p_from, p_to);
  end if;

  insert into quality_measurements (organization_id, indicator_id, period_start, period_end,
                                    value, numerator, denominator, target_value,
                                    is_manual, note, measured_by)
  values (ind.organization_id, p_indicator_id, p_from, p_to, v_val, v_num, v_den,
          ind.target_value, ind.is_manual, p_note, auth.uid())
  on conflict (indicator_id, period_start, period_end) do update
    set value = excluded.value, numerator = excluded.numerator,
        denominator = excluded.denominator, target_value = excluded.target_value,
        note = excluded.note, measured_at = now(), measured_by = auth.uid()
  returning id into v_id;

  return v_id;
end $$;

-- بذر المؤشّرات القياسية لمنشأة
create or replace function app_seed_quality_indicators(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into quality_indicators (organization_id, metric_key, name_ar, domain, unit,
                                  higher_is_better, target_value, is_manual)
  select p_org, v.k, v.n, v.d, v.u, v.h, v.t, false
  from (values
    ('no_show_rate',             'نسبة عدم الحضور',              'operational', 'percent', false, 10),
    ('patient_cancellation_rate','نسبة إلغاء المرضى',            'operational', 'percent', false, 15),
    ('avg_waiting_minutes',      'متوسّط زمن الانتظار (دقيقة)',   'experience',  'minutes', false, 20),
    ('critical_ack_within_30',   'إقرار القيم الحرجة خلال 30 دقيقة','safety',    'percent', true,  95),
    ('critical_unacknowledged',  'قيم حرجة بلا إقرار',            'safety',      'count',   false, 0),
    ('consent_compliance',       'التزام الموافقات المسبقة',      'safety',      'percent', true,  100),
    ('visit_closure_rate',       'نسبة إغلاق الزيارات',           'operational', 'percent', true,  98),
    ('claim_rejection_rate',     'نسبة رفض المطالبات',            'financial',   'percent', false, 5),
    ('incident_rate',            'عدد بلاغات السلامة',            'safety',      'count',   false, null),
    ('incident_closure_rate',    'نسبة إغلاق البلاغات',           'safety',      'percent', true,  90),
    ('expired_stock_items',      'دفعات منتهية في المخزون',       'operational', 'count',   false, 0),
    ('overdue_calibration_devices','أجهزة متأخّرة المعايرة',       'safety',      'count',   false, 0)
  ) as v(k, n, d, u, h, t)
  where not exists (select 1 from quality_indicators q
                     where q.organization_id = p_org and q.metric_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function app_seed_quality_on_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_seed_quality_indicators(new.id);
  return new;
end $$;

drop trigger if exists trg_seed_quality_indicators on organizations;
create trigger trg_seed_quality_indicators
  after insert on organizations
  for each row execute function app_seed_quality_on_org();

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_quality_indicators(r.id);
  end loop;
end $$;

-- قواعد التنبيه للجودة
insert into notification_rules (organization_id, event_key, name_ar, category,
                                severity, target_permission)
select o.id, v.k, v.n, 'clinical', v.s, 'quality.investigate'
from organizations o
cross join (values
  ('quality_incident',        'بلاغ سلامة جديد',        'warning'),
  ('quality_incident_severe', 'بلاغ سلامة جسيم',        'critical')
) as v(k, n, s)
where not exists (select 1 from notification_rules r
                   where r.organization_id = o.id and r.event_key = v.k);

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
    ('critical_result',      'قيمة حرجة بانتظار إقرار',      'clinical',    'critical', 'critical.oversee'),
    ('critical_unacknowledged', 'قيمة حرجة لم يُقَرّ بها',    'clinical',    'critical', 'critical.oversee'),
    ('quality_incident',     'بلاغ سلامة جديد',             'clinical',    'warning',  'quality.investigate'),
    ('quality_incident_severe','بلاغ سلامة جسيم',            'clinical',    'critical', 'quality.investigate')
  ) as v(k, n, c, s, p)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===========================================================================
-- 6) المناظير
-- ===========================================================================
drop view if exists v_quality_scorecard;
create view v_quality_scorecard
with (security_invoker = on) as
select
  i.id            as indicator_id,
  i.organization_id,
  i.metric_key,
  i.name_ar,
  i.domain,
  i.unit,
  i.higher_is_better,
  i.target_value,
  i.is_manual,
  i.is_active,
  m.period_start,
  m.period_end,
  m.value,
  m.numerator,
  m.denominator,
  m.note,
  m.measured_at,
  case
    when m.value is null or i.target_value is null then 'unknown'
    when i.higher_is_better and m.value >= i.target_value then 'on_target'
    when not i.higher_is_better and m.value <= i.target_value then 'on_target'
    else 'off_target'
  end             as status,
  coalesce(m.period_end, current_date) as report_date
from quality_indicators i
left join lateral (
  select * from quality_measurements q
   where q.indicator_id = i.id
   order by q.period_end desc limit 1
) m on true
where i.is_active;

comment on view v_quality_scorecard is
  'بطاقة أداء الجودة: آخر قياس لكل مؤشّر وحالته مقابل هدفه — والمُدخَل يدويًّا مميَّز عن المحسوب.';

drop view if exists v_quality_trend;
create view v_quality_trend
with (security_invoker = on) as
select
  m.id, m.organization_id, m.indicator_id, i.metric_key, i.name_ar, i.unit,
  m.period_start, m.period_end, m.value, m.target_value, m.is_manual,
  m.period_end as report_date
from quality_measurements m
join quality_indicators i on i.id = m.indicator_id;

drop view if exists v_quality_incidents;
create view v_quality_incidents
with (security_invoker = on) as
select
  q.id, q.organization_id, q.branch_id, q.incident_number, q.category, q.severity,
  q.occurred_at, q.location_note, q.patient_id,
  case when q.is_anonymous then null else p.name_ar end as patient_name,
  q.is_anonymous, q.description, q.immediate_action, q.status,
  q.root_cause, q.corrective_action, q.preventive_action,
  q.reported_at, q.closed_at,
  (q.status <> 'closed') as is_open,
  case when q.closed_at is not null
       then (q.closed_at::date - q.occurred_at::date) end as days_to_close,
  q.occurred_at::date as report_date
from quality_incidents q
left join patients p on p.id = q.patient_id;

grant select on v_quality_scorecard, v_quality_trend, v_quality_incidents to authenticated;

-- ===========================================================================
-- 7) RLS
-- ===========================================================================
do $$
declare pol record; r record;
begin
  for r in select unnest(array['quality_incidents','quality_indicators',
                               'quality_measurements']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop execute format('drop policy %I on %I', pol.policyname, r.t); end loop;
  end loop;

  -- البلاغ يراه من يحقّق فيه ومن يعرض الجودة؛ ورفعه لكل من يملك quality.report
  create policy quality_incidents_select on quality_incidents for select to authenticated
    using (app_has_permission(organization_id, 'quality.view')
           or app_has_permission(organization_id, 'quality.investigate'));
  create policy quality_incidents_insert on quality_incidents for insert to authenticated
    with check (app_has_permission(organization_id, 'quality.report'));

  create policy quality_indicators_select on quality_indicators for select to authenticated
    using (app_is_member(organization_id));
  create policy quality_indicators_write on quality_indicators for all to authenticated
    using (app_has_permission(organization_id, 'quality.manage'))
    with check (app_has_permission(organization_id, 'quality.manage'));

  create policy quality_measurements_select on quality_measurements for select to authenticated
    using (app_is_member(organization_id));
end $$;

-- ===========================================================================
-- 8) الميزة وحجب الدوال
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'quality', 'الجودة وسلامة المرضى', 'Quality & Safety', 'الإدارة', false, 306
where not exists (select 1 from feature_catalog where feature_key = 'quality');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'quality', true from organizations o
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
  if v_src is not null and position('''quality''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''',
                            '''audit_log'',''settings'',''quality''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة الجودة';
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
       and p.proname in ('app_compute_quality_metric','app_report_quality_incident',
                         'app_close_quality_incident','app_measure_quality_indicator',
                         'app_seed_quality_indicators')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 9) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_compute_quality_metric','app_report_quality_incident',
                             'app_close_quality_incident','app_measure_quality_indicator',
                             'app_seed_quality_indicators']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الجودة % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_seed_quality_indicators') then
    raise exception 'المنشأة الجديدة تُنشأ بلا مؤشّرات جودة';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_quality_measurement_period') then
    raise exception 'المؤشّر يقبل قياسين متناقضين للفترة نفسها';
  end if;

  foreach v_v in array array['v_quality_scorecard','v_quality_trend','v_quality_incidents']
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
