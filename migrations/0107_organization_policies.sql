-- ============================================================================
-- 0107 — المرحلة 27: سياسات المنشأة والفروع وأوقات العمل
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- المشكلة التي تُحلّ: النظام مليء بقرارات سياسة **مثبَّتة في الشيفرة**:
--   • مهلة الإقرار بالقيمة الحرجة = 30 دقيقة (المرحلة 25)
--   • حدّ طلبات المواعيد المفتوحة للمريض = 3 (المرحلة 24)
--   • مهلة التنبيه قبل انتهاء المستندات = 60 يومًا (المرحلة 23)
--   • الزيارة تُعدّ متأخّرة بعد يومين (المرحلة 25)
-- وكلها أرقام تختلف من منشأة إلى أخرى ومن جهة اعتماد إلى أخرى، ولا سبيل
-- لتغييرها إلا بتعديل شيفرة. تُنقل هنا إلى جدول سياسات **تقرؤه الدوال
-- نفسها فعليًّا** — وهذا شرط: إعدادٌ لا يقرؤه أحد أسوأ من غيابه، لأنه يوهم
-- من غيّره أنه غيّر شيئًا.
--
-- وأوقات عمل الفروع والعطل: تُطبَّق **بتفعيل صريح** لكل منشأة
-- (`enforce_working_hours`) لا افتراضًا، لأن فرض قيدٍ على منشأة تعمل اليوم
-- بلا جداول يوقف حجوزاتها فجأة. المفعِّل يعرف ماذا يفعِّل.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحية
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
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0107_organization_policies.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select 'policies.manage', 'إدارة سياسات المنشأة', 'settings', 2000
where not exists (select 1 from permission_catalog where permission_key = 'policies.manage');

insert into role_default_permissions (role_key, permission_key)
select 'branch_manager', 'policies.manage'
where not exists (select 1 from role_default_permissions
                   where role_key = 'branch_manager' and permission_key = 'policies.manage');

-- ===========================================================================
-- 2) جدول السياسات
-- ===========================================================================
create table if not exists organization_policies (
  organization_id uuid primary key references organizations(id) on delete cascade,

  -- سلامة المرضى
  critical_ack_minutes         integer not null default 30
                                 check (critical_ack_minutes between 5 and 1440),

  -- بوابة المريض
  portal_open_requests_limit   integer not null default 3
                                 check (portal_open_requests_limit between 1 and 20),
  -- الإلغاء من البوابة يُقفل قبل الموعد بمدّة: صفر يعني حتى لحظة الموعد
  portal_cancel_cutoff_hours   integer not null default 0
                                 check (portal_cancel_cutoff_hours between 0 and 168),

  -- المستندات والتنبيهات
  document_expiry_notice_days  integer not null default 60
                                 check (document_expiry_notice_days between 1 and 365),

  -- التشغيل
  visit_open_alert_days        integer not null default 2
                                 check (visit_open_alert_days between 1 and 60),

  -- أوقات العمل: **معطَّلة افتراضًا**
  enforce_working_hours        boolean not null default false,

  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

alter table organization_policies enable row level security;

-- ساعات عمل الفرع: صفٌّ لكل يوم، ويمكن أكثر من فترة في اليوم
create table if not exists branch_working_hours (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  weekday         integer not null check (weekday between 0 and 6),  -- 0 = الأحد
  opens_at        time not null,
  closes_at       time not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint branch_hours_order check (closes_at > opens_at)
);

create index if not exists idx_branch_hours
  on branch_working_hours (organization_id, branch_id, weekday) where is_active;

alter table branch_working_hours enable row level security;

create table if not exists organization_holidays (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- عطلة عامة للمنشأة أو خاصة بفرع
  branch_id       uuid references branches(id) on delete cascade,
  holiday_date    date not null,
  name_ar         text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create unique index if not exists uq_holiday_day
  on organization_holidays (organization_id,
                            coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            holiday_date);

alter table organization_holidays enable row level security;

-- ===========================================================================
-- 3) قارئ السياسات — يعمل ولو لم يُنشأ صفّ للمنشأة بعد
-- ===========================================================================
create or replace function app_org_policy(p_org uuid)
returns organization_policies
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p organization_policies%rowtype;
begin
  select * into p from organization_policies where organization_id = p_org;
  if p.organization_id is null then
    -- الافتراضات نفسها المعرَّفة في الجدول: المنشأة التي لم تُهيَّأ بعد
    -- تسلك سلوك النظام السابق تمامًا، لا سلوكًا مجهولًا.
    p.organization_id            := p_org;
    p.critical_ack_minutes       := 30;
    p.portal_open_requests_limit := 3;
    p.portal_cancel_cutoff_hours := 0;
    p.document_expiry_notice_days:= 60;
    p.visit_open_alert_days      := 2;
    p.enforce_working_hours      := false;
  end if;
  return p;
end $$;

create or replace function app_save_org_policies(
  p_org       uuid,
  p_changes   jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare cur organization_policies;
begin
  if not app_has_permission(p_org, 'policies.manage') then
    raise exception 'صلاحيتك لا تسمح بتعديل سياسات المنشأة (policies.manage)';
  end if;
  cur := app_org_policy(p_org);

  insert into organization_policies (
    organization_id, critical_ack_minutes, portal_open_requests_limit,
    portal_cancel_cutoff_hours, document_expiry_notice_days,
    visit_open_alert_days, enforce_working_hours, updated_by)
  values (
    p_org,
    coalesce((p_changes ->> 'critical_ack_minutes')::int,        cur.critical_ack_minutes),
    coalesce((p_changes ->> 'portal_open_requests_limit')::int,  cur.portal_open_requests_limit),
    coalesce((p_changes ->> 'portal_cancel_cutoff_hours')::int,  cur.portal_cancel_cutoff_hours),
    coalesce((p_changes ->> 'document_expiry_notice_days')::int, cur.document_expiry_notice_days),
    coalesce((p_changes ->> 'visit_open_alert_days')::int,       cur.visit_open_alert_days),
    coalesce((p_changes ->> 'enforce_working_hours')::boolean,   cur.enforce_working_hours),
    auth.uid())
  on conflict (organization_id) do update set
    critical_ack_minutes        = excluded.critical_ack_minutes,
    portal_open_requests_limit  = excluded.portal_open_requests_limit,
    portal_cancel_cutoff_hours  = excluded.portal_cancel_cutoff_hours,
    document_expiry_notice_days = excluded.document_expiry_notice_days,
    visit_open_alert_days       = excluded.visit_open_alert_days,
    enforce_working_hours       = excluded.enforce_working_hours,
    updated_at = now(), updated_by = auth.uid();

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'settings', 'update', p_org, 'تعديل سياسات المنشأة',
          p_changes::text);
end $$;

-- ===========================================================================
-- 4) **السياسات تُقرأ فعلًا**: تعديل الدوال القائمة لتستعملها
-- ===========================================================================

-- 4.1 مهلة تصعيد القيم الحرجة
create or replace function app_escalate_critical_results(
  p_org     uuid,
  p_minutes integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; v_n integer := 0; v_min integer;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  -- المهلة من سياسة المنشأة ما لم تُمرَّر صراحةً
  v_min := coalesce(p_minutes, (app_org_policy(p_org)).critical_ack_minutes, 30);

  for r in
    select * from critical_result_notifications
     where organization_id = p_org
       and acknowledged_at is null
       and detected_at < now() - make_interval(mins => greatest(v_min, 1))
  loop
    update critical_result_notifications
       set escalation_level = escalation_level + 1, escalated_at = now(), updated_at = now()
     where id = r.id;

    perform app_notify_event(
      p_org, 'critical_unacknowledged',
      format('قيمة حرجة بلا إقرار منذ %s دقيقة: %s', v_min, coalesce(r.test_name, 'فحص')),
      format('critical-esc:%s:%s', r.id, r.escalation_level + 1),
      coalesce(r.result_value, ''), 'critical_result', r.id,
      '/doctor-workspace', r.branch_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- 4.2 حدّ طلبات المواعيد المفتوحة، ومهلة الإلغاء
create or replace function app_portal_request_appointment(
  p_org       uuid,
  p_clinic_id uuid default null,
  p_doctor_id uuid default null,
  p_date      date default null,
  p_period    text default 'any',
  p_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_patient uuid; v_id uuid; v_open int; v_limit int;
begin
  v_patient := app_portal_patient_id(p_org);
  if v_patient is null then
    raise exception 'لا يوجد حساب بوابة نشط لهذه المنشأة';
  end if;
  if p_date is not null and p_date < current_date then
    raise exception 'لا يُطلب موعد في تاريخ ماضٍ';
  end if;

  v_limit := coalesce((app_org_policy(p_org)).portal_open_requests_limit, 3);
  select count(*) into v_open from appointment_requests
   where organization_id = p_org and patient_id = v_patient and status = 'pending';
  if v_open >= v_limit then
    raise exception 'لديك % طلبات مواعيد قيد المراجعة — انتظر ردّ الاستقبال', v_limit;
  end if;

  insert into appointment_requests (organization_id, patient_id, clinic_id, doctor_id,
                                    preferred_date, preferred_period, reason)
  values (p_org, v_patient, p_clinic_id, p_doctor_id, p_date,
          coalesce(p_period, 'any'), p_reason)
  returning id into v_id;

  perform app_notify_event(
    p_org, 'purchase_request_pending', 'طلب موعد جديد من بوابة المريض',
    format('apptreq:%s', v_id), p_reason, 'appointment_request', v_id,
    '/appointments', null);

  return v_id;
end $$;

create or replace function app_portal_cancel_appointment(
  p_appointment_id uuid,
  p_reason         text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare a appointments%rowtype; v_cutoff int;
begin
  select * into a from appointments where id = p_appointment_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_is_portal_patient(a.organization_id, a.patient_id) then
    raise exception 'هذا الموعد ليس لك';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الإلغاء مطلوب';
  end if;
  if a.scheduled_start < now() then
    raise exception 'لا يُلغى موعد مضى وقته — اتصل بالاستقبال';
  end if;

  -- مهلة الإقفال من سياسة المنشأة: إلغاءٌ قبل الموعد بدقائق يضيّع الفترة
  v_cutoff := coalesce((app_org_policy(a.organization_id)).portal_cancel_cutoff_hours, 0);
  if v_cutoff > 0 and a.scheduled_start < now() + make_interval(hours => v_cutoff) then
    raise exception 'لا يُلغى الموعد قبل أقلّ من % ساعة — اتصل بالاستقبال', v_cutoff;
  end if;

  if a.status not in ('new','scheduled','unconfirmed','confirmed') then
    raise exception 'حالة الموعد (%) لا تسمح بالإلغاء من البوابة', a.status;
  end if;

  update appointments
     set status = 'cancelled_by_patient',
         cancellation_reason = format('إلغاء من بوابة المريض: %s', p_reason),
         updated_at = now()
   where id = p_appointment_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (a.organization_id, a.branch_id, auth.uid(), 'portal', 'update',
          p_appointment_id, 'إلغاء موعد من البوابة', null, p_reason);
end $$;

-- 4.3 مهلة تنبيه انتهاء المستندات
create or replace function app_generate_expiry_notifications(
  p_org  uuid,
  p_days integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; v_n integer := 0; v_days integer;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  v_days := coalesce(p_days, (app_org_policy(p_org)).document_expiry_notice_days, 60);

  for r in
    select alert_type, title, expires_on
      from expiring_alerts
     where organization_id = p_org
       and expires_on is not null
       and expires_on <= current_date + greatest(v_days, 1)
  loop
    v_n := v_n + app_notify_event(
      p_org, 'document_expiring',
      format('%s: %s', r.alert_type, r.title),
      format('exp:%s:%s:%s', r.alert_type, md5(r.title), r.expires_on),
      format('ينتهي في %s', r.expires_on),
      'expiry', null, '/alerts', null);
  end loop;

  return v_n;
end $$;

-- ===========================================================================
-- 5) أوقات العمل والعطل — حارس الحجز، **بتفعيل صريح**
-- ===========================================================================
create or replace function app_is_working_time(
  p_org    uuid,
  p_branch uuid,
  p_at     timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_day int; v_time time;
begin
  -- عطلة المنشأة كلها، أو عطلة هذا الفرع
  if exists (select 1 from organization_holidays h
              where h.organization_id = p_org
                and h.holiday_date = p_at::date
                and (h.branch_id is null or h.branch_id = p_branch)) then
    return false;
  end if;

  -- بلا جدول ساعات للفرع لا قيد: القيد يأتي من جدولٍ موضوع لا من فراغه
  if p_branch is null
     or not exists (select 1 from branch_working_hours w
                     where w.organization_id = p_org and w.branch_id = p_branch
                       and w.is_active) then
    return true;
  end if;

  v_day  := extract(dow from p_at)::int;
  v_time := p_at::time;

  return exists (
    select 1 from branch_working_hours w
     where w.organization_id = p_org and w.branch_id = p_branch
       and w.is_active and w.weekday = v_day
       and v_time >= w.opens_at and v_time < w.closes_at);
end $$;

create or replace function app_guard_appointment_working_hours()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_pol organization_policies;
begin
  if new.scheduled_start is null then return new; end if;
  if tg_op = 'UPDATE' and new.scheduled_start is not distinct from old.scheduled_start then
    return new;
  end if;
  -- الموعد الملغى أو المؤجَّل خارج الدوام لا يُمنع من التسجيل
  if new.status in ('cancelled_by_patient','cancelled_by_staff','no_show') then
    return new;
  end if;

  v_pol := app_org_policy(new.organization_id);
  if not v_pol.enforce_working_hours then
    return new;
  end if;

  if not app_is_working_time(new.organization_id, new.branch_id, new.scheduled_start) then
    raise exception 'الموعد خارج أوقات عمل الفرع أو في يوم عطلة';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_appointment_hours on appointments;
create trigger trg_guard_appointment_hours
  before insert or update of scheduled_start on appointments
  for each row execute function app_guard_appointment_working_hours();

-- ===========================================================================
-- 6) المناظير
-- ===========================================================================
drop view if exists v_organization_policies;
create view v_organization_policies
with (security_invoker = on) as
select
  o.id                              as organization_id,
  o.name                            as organization_name,
  p.critical_ack_minutes,
  p.portal_open_requests_limit,
  p.portal_cancel_cutoff_hours,
  p.document_expiry_notice_days,
  p.visit_open_alert_days,
  p.enforce_working_hours,
  (op.organization_id is not null)  as is_customized,
  op.updated_at,
  current_date                      as report_date
from organizations o
cross join lateral app_org_policy(o.id) p
left join organization_policies op on op.organization_id = o.id;

comment on view v_organization_policies is
  'سياسات المنشأة الفعّالة، مع بيان ما إذا كانت مخصّصة أم على الافتراضات.';

drop view if exists v_branch_schedule;
create view v_branch_schedule
with (security_invoker = on) as
select
  w.id, w.organization_id, w.branch_id, b.name as branch_name,
  w.weekday,
  case w.weekday when 0 then 'الأحد' when 1 then 'الإثنين' when 2 then 'الثلاثاء'
                 when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
                 else 'السبت' end as weekday_name,
  w.opens_at, w.closes_at, w.is_active,
  current_date as report_date
from branch_working_hours w
join branches b on b.id = w.branch_id;

grant select on v_organization_policies, v_branch_schedule to authenticated;

-- ===========================================================================
-- 7) RLS
-- ===========================================================================
do $$
declare pol record; r record;
begin
  for r in select unnest(array['organization_policies','branch_working_hours',
                               'organization_holidays']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop execute format('drop policy %I on %I', pol.policyname, r.t); end loop;

    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t);
    execute format($f$
      create policy %1$I_write on %1$I for all to authenticated
        using (app_has_permission(organization_id, 'policies.manage'))
        with check (app_has_permission(organization_id, 'policies.manage'))
    $f$, r.t);
  end loop;
end $$;

-- ===========================================================================
-- 8) فحص ذاتي — **الإعداد الذي لا يقرؤه أحد يفشل هنا**
-- ===========================================================================
do $$
declare v_src text; v_v text;
begin
  foreach v_v in array array['app_org_policy','app_save_org_policies',
                             'app_is_working_time','app_guard_appointment_working_hours']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة السياسات % غير موجودة', v_v;
    end if;
  end loop;

  -- كل سياسة يجب أن تُقرأ في دالّةٍ ما: إعدادٌ معروض ولا أثر له يوهم من
  -- غيّره أنه غيّر شيئًا.
  select string_agg(pg_get_functiondef(p.oid), E'\n') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_escalate_critical_results','app_portal_request_appointment',
                       'app_portal_cancel_appointment','app_generate_expiry_notifications',
                       'app_guard_appointment_working_hours');

  foreach v_v in array array['critical_ack_minutes','portal_open_requests_limit',
                             'portal_cancel_cutoff_hours','document_expiry_notice_days',
                             'enforce_working_hours']
  loop
    if position(v_v in coalesce(v_src, '')) = 0 then
      raise exception 'السياسة % لا تقرؤها أيّ دالّة — إعدادٌ بلا أثر', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_appointment_hours') then
    raise exception 'حارس أوقات العمل غير مركَّب';
  end if;
end $$;
