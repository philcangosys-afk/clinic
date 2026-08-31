-- ============================================================================
-- 0110 — المرحلة 30: التكاملات — رفوفها وسلامتها
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة، ولا أيّ تكامل مزوّد رسائل.**
-- بل إنّ القائمة المغلقة لمفاتيح التكامل هنا **ترفض `sms` صراحةً**، وفحصٌ
-- في الاختبارات يحاول إدخالها ويتوقّع الرفض.
--
-- ولا أبني إطارًا عامًّا جديدًا: النظام يملك صندوقَي إرسال حقيقيَّين —
-- `einvoice_documents` (فاتورة زاتكا) و`nphies_messages` (نفيس) — ولهما
-- شاشاتهما ومناظيرهما. بناء صندوق ثالث «عام» فوقهما تكرارٌ يفرّق المتابعة.
--
-- ما ينقص الصندوقين فعلًا، وهو ما تضيفه هذه الهجرة:
--
--   1) **لا جدولة لإعادة المحاولة**: فيهما `attempt_count` و`last_attempt_at`
--      ولا `next_attempt_at`. أي أن العامل الخلفي إمّا يعيد المحاولة فورًا
--      بلا انقطاع فيُحظر عند المزوّد، أو لا يعيدها أبدًا فتُنسى الرسالة.
--   2) **لا نهاية للمحاولات**: رسالة مرفوضة لسببٍ دائم (بيانات ناقصة) تُعاد
--      إلى الأبد. يلزمها حدٌّ ثم **صندوق موتى** ينبّه إنسانًا.
--   3) **لا أحد ينتبه للعالق**: لا تنبيه حين تتكدّس رسائل فاشلة. الفاتورة
--      التي لم تصل زاتكا اليوم مخالفةٌ بعد أيام.
--   4) **لا سجلّ لعناوين التكامل**، ولا ضمانة أن أحدًا لن يضع مفتاحًا سريًّا
--      في قاعدة البيانات. القاعدة تُقرأ من الواجهة عبر PostgREST، فالمفتاح
--      فيها مفتاحٌ مكشوف. يُخزَّن **اسم المرجع** لا قيمته، وحارسٌ يرفض ما
--      يبدو سرًّا.
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
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if to_regclass('public.organization_policies') is null then
    v_missing := v_missing || E'\n  • 0107_organization_policies.sql  (سياسات المنشأة)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'app_set_membership_role') then
    v_missing := v_missing || E'\n  • 0108_users_and_permissions.sql  (المستخدمون والصلاحيات)';
  end if;
  if to_regclass('public.organization_locale_settings') is null then
    v_missing := v_missing || E'\n  • 0109_locale_and_gcc.sql  (اللغة وإعدادات الخليج)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0110_integrations.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('integrations.view',  'عرض حالة التكاملات', 'integrations', 2200),
  ('integrations.manage','إدارة التكاملات',    'integrations', 2202),
  ('integrations.retry', 'إعادة إرسال الرسائل','integrations', 2204)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'integrations.view'), ('branch_manager', 'integrations.retry'),
  ('accountant',     'integrations.view'), ('accountant',     'integrations.retry')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) جدولة إعادة المحاولة وصندوق الموتى — على الصندوقين القائمين
-- ===========================================================================
alter table einvoice_documents
  add column if not exists next_attempt_at timestamptz,
  add column if not exists max_attempts integer not null default 6,
  add column if not exists failed_permanently boolean not null default false,
  add column if not exists last_error text,
  add column if not exists dead_lettered_at timestamptz;

alter table nphies_messages
  add column if not exists next_attempt_at timestamptz,
  add column if not exists max_attempts integer not null default 6,
  add column if not exists failed_permanently boolean not null default false,
  add column if not exists last_error text,
  add column if not exists dead_lettered_at timestamptz;

create index if not exists idx_einvoice_due
  on einvoice_documents (organization_id, next_attempt_at)
  where not failed_permanently;
create index if not exists idx_nphies_due
  on nphies_messages (organization_id, next_attempt_at)
  where not failed_permanently;

-- ===========================================================================
-- 3) عناوين التكامل — **بلا أسرار**
-- ===========================================================================
create table if not exists integration_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- **قائمة مغلقة، وليس فيها sms**
  integration_key text not null
                    check (integration_key in ('zatca','nphies','lab_analyzer',
                                               'his_hl7','accounting_export','webhook')),
  environment     text not null default 'sandbox'
                    check (environment in ('sandbox','production')),
  base_url        text not null,
  -- **اسم المرجع لا قيمته**: القيمة تعيش في متغيّرات بيئة الدالّة الخلفية
  secret_ref      text,
  is_active       boolean not null default false,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  -- **العنوان يجب أن يكون مشفّرًا**: بيانات مرضى على http نصٌّ مكشوف
  constraint integration_url_https check (base_url ~* '^https://')
);

create unique index if not exists uq_integration_key_env
  on integration_settings (organization_id, integration_key, environment);

alter table integration_settings enable row level security;

-- حارس السرّ: يرفض ما يبدو مفتاحًا أو شهادة بدل اسم مرجع
create or replace function app_guard_integration_secret()
returns trigger
language plpgsql
as $$
declare v text := coalesce(new.secret_ref, '');
begin
  if v = '' then return new; end if;

  if v ~* '-----BEGIN' or v ~* 'PRIVATE KEY' then
    raise exception 'لا تُخزَّن الشهادات في قاعدة البيانات — ضع اسم المرجع فقط';
  end if;
  -- اسم مرجع قصير بحروف الأسماء؛ وأيّ سلسلة طويلة أو عشوائية تُرفض
  if length(v) > 64 then
    raise exception 'قيمة طويلة في خانة اسم المرجع — هذه خانة اسمٍ لا خانة مفتاح';
  end if;
  if v !~ '^[A-Za-z0-9_.-]+$' then
    raise exception 'اسم المرجع يقبل الحروف والأرقام والشرطات فقط';
  end if;
  -- سلسلة فيها حروف وأرقام كثيرة متداخلة أقرب إلى مفتاح منها إلى اسم
  if length(v) >= 24 and v ~ '[0-9]' and v ~ '[a-z]' and v ~ '[A-Z]' then
    raise exception 'هذه القيمة تبدو مفتاحًا سريًّا — تُوضع الأسرار في بيئة الدالّة الخلفية، لا هنا';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_integration_secret on integration_settings;
create trigger trg_guard_integration_secret
  before insert or update on integration_settings
  for each row execute function app_guard_integration_secret();

-- ===========================================================================
-- 4) دوال المحاولة والتصعيد
-- ===========================================================================

-- تُستدعى من العامل الخلفي بعد كل محاولة: تجدول التالية أو تُميت الرسالة
create or replace function app_mark_integration_attempt(
  p_kind    text,          -- 'einvoice' أو 'nphies'
  p_id      uuid,
  p_success boolean,
  p_error   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_attempts int;
  v_max      int;
  v_delay    interval;
  v_dead     boolean := false;
begin
  if p_kind not in ('einvoice','nphies') then
    raise exception 'نوع رسالة غير معروف: %', p_kind;
  end if;

  if p_kind = 'einvoice' then
    select organization_id, coalesce(attempt_count, 0) + 1, max_attempts
      into v_org, v_attempts, v_max
      from einvoice_documents where id = p_id for update;
  else
    select organization_id, coalesce(attempt_count, 0) + 1, max_attempts
      into v_org, v_attempts, v_max
      from nphies_messages where id = p_id for update;
  end if;

  if v_org is null then raise exception 'الرسالة غير موجودة'; end if;
  if not app_is_member(v_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;

  if p_success then
    -- النجاح يُصفّر الجدولة: لا إعادة محاولة لما وصل
    if p_kind = 'einvoice' then
      update einvoice_documents
         set attempt_count = v_attempts, last_attempt_at = now(),
             next_attempt_at = null, last_error = null
       where id = p_id;
    else
      update nphies_messages
         set attempt_count = v_attempts, last_attempt_at = now(),
             next_attempt_at = null, last_error = null
       where id = p_id;
    end if;
    return;
  end if;

  -- **تأخير متضاعف**: 1، 2، 4، 8… دقائق. إعادة المحاولة فورًا بلا انقطاع
  -- تُحظر عند المزوّد وتُغرق السجل.
  v_delay := make_interval(mins => least(power(2, greatest(v_attempts - 1, 0))::int, 240));
  if v_attempts >= coalesce(v_max, 6) then
    v_dead := true;
  end if;

  if p_kind = 'einvoice' then
    update einvoice_documents
       set attempt_count = v_attempts, last_attempt_at = now(),
           last_error = p_error,
           next_attempt_at = case when v_dead then null else now() + v_delay end,
           failed_permanently = v_dead,
           dead_lettered_at = case when v_dead then now() end,
           status = case when v_dead then 'failed' else status end
     where id = p_id;
  else
    update nphies_messages
       set attempt_count = v_attempts, last_attempt_at = now(),
           last_error = p_error,
           next_attempt_at = case when v_dead then null else now() + v_delay end,
           failed_permanently = v_dead,
           dead_lettered_at = case when v_dead then now() end,
           status = case when v_dead then 'failed' else status end
     where id = p_id;
  end if;

  -- **الموت لا يمرّ بصمت**: من يتابع التكاملات يُنبَّه ليتدخّل يدويًّا
  if v_dead then
    perform app_notify_event(
      v_org, 'integration_dead_letter',
      format('رسالة تكامل توقّفت نهائيًّا بعد %s محاولة', v_attempts),
      format('deadletter:%s:%s', p_kind, p_id),
      coalesce(p_error, ''), 'integration', p_id, '/integrations', null);
  end if;
end $$;

-- إعادة إحياء رسالة ميتة بعد إصلاح سببها — بقرار إنسان
create or replace function app_requeue_integration_message(
  p_kind   text,
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  if p_kind not in ('einvoice','nphies') then
    raise exception 'نوع رسالة غير معروف: %', p_kind;
  end if;
  if coalesce(trim(coalesce(p_reason, '')), '') = '' then
    raise exception 'سبب إعادة الإرسال مطلوب — ما الذي أُصلح؟';
  end if;

  if p_kind = 'einvoice' then
    select organization_id into v_org from einvoice_documents where id = p_id;
  else
    select organization_id into v_org from nphies_messages where id = p_id;
  end if;
  if v_org is null then raise exception 'الرسالة غير موجودة'; end if;
  if not app_has_permission(v_org, 'integrations.retry') then
    raise exception 'صلاحيتك لا تسمح بإعادة الإرسال (integrations.retry)';
  end if;

  if p_kind = 'einvoice' then
    update einvoice_documents
       set failed_permanently = false, dead_lettered_at = null,
           attempt_count = 0, next_attempt_at = now(),
           status = case when status = 'failed' then 'pending' else status end
     where id = p_id;
  else
    update nphies_messages
       set failed_permanently = false, dead_lettered_at = null,
           attempt_count = 0, next_attempt_at = now(),
           status = case when status = 'failed' then 'queued' else status end
     where id = p_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_org, auth.uid(), 'integrations', 'update', p_id,
          'إعادة إرسال رسالة تكامل', p_kind, p_reason);
end $$;

-- تنبيه العالق: رسائل تجاوزت مهلتها ولم تصل
create or replace function app_check_integration_health(
  p_org     uuid,
  p_minutes integer default 60
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_stuck int := 0; v_dead int := 0;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;

  select count(*) into v_stuck from (
    select 1 from einvoice_documents
     where organization_id = p_org and not failed_permanently
       and status in ('pending','generated','submitted')
       and coalesce(last_attempt_at, submitted_at, now())
           < now() - make_interval(mins => greatest(p_minutes, 1))
    union all
    select 1 from nphies_messages
     where organization_id = p_org and not failed_permanently
       and status in ('queued','sending')
       and coalesce(last_attempt_at, sent_at, now())
           < now() - make_interval(mins => greatest(p_minutes, 1))
  ) s;

  select count(*) into v_dead from (
    select 1 from einvoice_documents
     where organization_id = p_org and failed_permanently
    union all
    select 1 from nphies_messages
     where organization_id = p_org and failed_permanently
  ) d;

  if v_stuck > 0 then
    perform app_notify_event(
      p_org, 'integration_stuck',
      format('%s رسالة تكامل عالقة منذ أكثر من %s دقيقة', v_stuck, p_minutes),
      format('stuck:%s:%s', p_org, to_char(current_date, 'YYYYMMDD')),
      null, 'integration', null, '/integrations', null);
  end if;

  return v_stuck + v_dead;
end $$;

-- قواعد التنبيه
create or replace function app_seed_integration_rules(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into notification_rules (organization_id, event_key, name_ar, category,
                                  severity, target_permission)
  select p_org, v.k, v.n, 'system', v.s, 'integrations.view'
  from (values
    ('integration_stuck',       'رسائل تكامل عالقة',        'warning'),
    ('integration_dead_letter', 'رسالة تكامل توقّفت نهائيًّا','critical')
  ) as v(k, n, s)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function app_seed_integration_rules_on_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_seed_integration_rules(new.id);
  return new;
end $$;

drop trigger if exists trg_seed_integration_rules on organizations;
create trigger trg_seed_integration_rules
  after insert on organizations
  for each row execute function app_seed_integration_rules_on_org();

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_integration_rules(r.id);
  end loop;
end $$;

-- ===========================================================================
-- 5) المناظير
-- ===========================================================================
drop view if exists v_integration_health;
create view v_integration_health
with (security_invoker = on) as
select
  organization_id,
  integration          as integration_key,
  count(*)                                                   as total,
  count(*) filter (where is_open)                            as open_count,
  count(*) filter (where failed_permanently)                 as dead_count,
  count(*) filter (where is_open and next_attempt_at is null and attempt_count > 0)
                                                             as unscheduled_count,
  max(last_attempt_at)                                       as last_attempt_at,
  current_date                                               as report_date
from (
  select organization_id, 'zatca'::text as integration,
         status in ('pending','generated','submitted') as is_open,
         failed_permanently, next_attempt_at, coalesce(attempt_count, 0) as attempt_count,
         last_attempt_at
    from einvoice_documents
  union all
  select organization_id, 'nphies',
         status in ('queued','sending'),
         failed_permanently, next_attempt_at, coalesce(attempt_count, 0),
         last_attempt_at
    from nphies_messages
) x
group by organization_id, integration;

comment on view v_integration_health is
  'صحّة صندوقَي الإرسال: المفتوح، والميت، وما لا موعد لإعادة محاولته — وهو أخطرها لأنه منسيّ.';

drop view if exists v_integration_dead_letters;
create view v_integration_dead_letters
with (security_invoker = on) as
select
  id, organization_id, 'einvoice'::text as kind, 'zatca'::text as integration_key,
  status, attempt_count, last_error, dead_lettered_at,
  sales_invoice_id as reference_id,
  dead_lettered_at::date as report_date
from einvoice_documents
where failed_permanently
union all
select
  id, organization_id, 'nphies', 'nphies',
  status, attempt_count, last_error, dead_lettered_at,
  coalesce(claim_form_id, preauthorization_id, eligibility_check_id),
  dead_lettered_at::date
from nphies_messages
where failed_permanently;

grant select on v_integration_health, v_integration_dead_letters to authenticated;

-- ===========================================================================
-- 6) RLS
-- ===========================================================================
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'integration_settings'
  loop execute format('drop policy %I on integration_settings', pol.policyname); end loop;

  create policy integration_settings_select on integration_settings for select to authenticated
    using (app_has_permission(organization_id, 'integrations.view'));
  create policy integration_settings_write on integration_settings for all to authenticated
    using (app_has_permission(organization_id, 'integrations.manage'))
    with check (app_has_permission(organization_id, 'integrations.manage'));
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_mark_integration_attempt','app_requeue_integration_message',
                         'app_check_integration_health','app_seed_integration_rules')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 7) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_mark_integration_attempt','app_requeue_integration_message',
                             'app_check_integration_health']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة التكامل % غير موجودة', v_v;
    end if;
  end loop;

  -- **لا مكان لـ sms في مفاتيح التكامل**
  if pg_get_constraintdef(
       (select oid from pg_constraint
         where conrelid = 'integration_settings'::regclass
           and conname like '%integration_key%')) like '%sms%' then
    raise exception 'مفتاح sms ظهر في قائمة التكاملات — ممنوع حتى إشعار آخر';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_integration_secret') then
    raise exception 'حارس الأسرار غير مركَّب — قد يُخزَّن مفتاح في القاعدة';
  end if;

  foreach v_v in array array['v_integration_health','v_integration_dead_letters']
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
