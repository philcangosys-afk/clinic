-- ============================================================================
-- 0103 — المرحلة 23: التنبيهات الداخلية وتوجيهها
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة، ولا أيّ تكامل مزوّد رسائل.**
-- القناة الوحيدة المفعَّلة هنا هي `internal` — تنبيهٌ داخل النظام لمستخدم
-- بعينه. عمود القناة موجود لأن الجداول القائمة تستعمله، ولا تُضاف قناة
-- خارجية واحدة حتى إشعارٍ آخر.
--
-- المشكلة التي تُحلّ:
--   النظام يعرف الكثير ولا يُخبر أحدًا. جهازٌ حرِج يخرج من الخدمة، ومطالبةٌ
--   تُرفض، ومسيّر رواتب ينتظر اعتمادًا، وموافقةٌ تُتجاوز في حالة طارئة،
--   وصنفٌ يهبط تحت حدّ الطلب — كلّها أحداث مسجَّلة في القاعدة، ولا يصل
--   منها شيء إلى **الشخص المسؤول**. الشاشات تعرض لمن يفتحها؛ ومن لا يفتحها
--   لا يعرف. `expiring_alerts` قائمةٌ سلبية: تُرى ولا تُسنَد ولا تُقرّ.
--
-- المبدأ هنا: التنبيه يُوجَّه **بالصلاحية لا بالاسم**. من يملك
-- `payroll.approve` هو من يُنبَّه لاعتماد المسيّر — فلا يضيع التنبيه حين
-- يتغيّر الموظف أو ينتقل الدور.
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0103_notifications.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('notifications.view',   'عرض التنبيهات',        'notifications', 1600),
  ('notifications.manage', 'إدارة قواعد التنبيه',  'notifications', 1602)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- التنبيهات حقٌّ لكل عضو: من يعمل يحتاج أن يعرف ما يخصّه
insert into role_default_permissions (role_key, permission_key)
select r, 'notifications.view' from (values
  ('branch_manager'), ('doctor'), ('nurse'), ('receptionist'), ('accountant'),
  ('hr_manager'), ('pharmacist'), ('lab_technician'), ('radiology_technician'),
  ('employee')
) as v(r)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = 'notifications.view');

insert into role_default_permissions (role_key, permission_key)
select 'branch_manager', 'notifications.manage'
where not exists (select 1 from role_default_permissions
                   where role_key = 'branch_manager'
                     and permission_key = 'notifications.manage');

-- ===========================================================================
-- 2) الجداول
-- ===========================================================================
create table if not exists notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  user_id         uuid not null references auth.users(id) on delete cascade,
  event_key       text not null,
  category        text not null default 'operational'
                    check (category in ('clinical','financial','operational',
                                        'inventory','hr','compliance','system')),
  severity        text not null default 'info'
                    check (severity in ('info','warning','critical')),
  title           text not null,
  body            text,
  entity_type     text,
  entity_id       uuid,
  action_path     text,          -- مسار داخل التطبيق، لا رابط خارجي
  -- **مفتاح منع التكرار**: الحدث نفسه لا يُنبَّه به مرّتين لنفس المستخدم.
  -- تنبيهٌ يتكرّر كل دقيقة يُدرَّب المستخدم على تجاهله، فيضيع المهمّ معه.
  dedupe_key      text not null,
  read_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_notification_dedupe
  on notifications (organization_id, user_id, dedupe_key);
create index if not exists idx_notifications_inbox
  on notifications (organization_id, user_id, read_at, created_at desc);

alter table notifications enable row level security;

-- قواعد التوجيه: أيّ حدث، لمن، بأيّ خطورة — قابلة للتعطيل لكل منشأة
create table if not exists notification_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  event_key        text not null,
  name_ar          text not null,
  category         text not null default 'operational'
                     check (category in ('clinical','financial','operational',
                                         'inventory','hr','compliance','system')),
  severity         text not null default 'info'
                     check (severity in ('info','warning','critical')),
  -- **التوجيه بالصلاحية هو الأصل**، ويجوز تثبيت دور. ولا يُوجَّه لمستخدم
  -- بعينه: التنبيه المعلَّق على شخص يضيع يوم يغادر أو ينتقل دوره.
  target_permission text,
  target_role_key   text,
  -- القناة الوحيدة المسموحة الآن: داخل النظام. لا SMS ولا بريد.
  channel          text not null default 'internal'
                     check (channel in ('internal')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

create unique index if not exists uq_notification_rule_event
  on notification_rules (organization_id, event_key);

alter table notification_rules enable row level security;

-- تفضيلات المستخدم: كتم فئة لا يعنيه
create table if not exists notification_preferences (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        text not null
                    check (category in ('clinical','financial','operational',
                                        'inventory','hr','compliance','system')),
  is_muted        boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id, category)
);

alter table notification_preferences enable row level security;

-- ===========================================================================
-- 3) الدوال
-- ===========================================================================

-- 3.1 من يملك صلاحيةً في منشأة — النسخة الجماعية من app_has_permission
create or replace function app_users_with_permission(
  p_org uuid,
  p_permission text
)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id
    from organization_memberships m
   where m.organization_id = p_org
     and m.is_active
     and (
       m.role_key in ('owner','organization_admin')
       or coalesce(
            (select p.granted from membership_permissions p
              where p.organization_id = p_org and p.user_id = m.user_id
                and p.permission_key = p_permission),
            exists (select 1 from role_default_permissions d
                     where d.role_key = m.role_key
                       and d.permission_key = p_permission)
          )
     );
$$;

-- 3.2 إنشاء تنبيه لمستخدم — يحترم الكتم ومنع التكرار
create or replace function app_notify(
  p_org        uuid,
  p_user_id    uuid,
  p_event_key  text,
  p_title      text,
  p_dedupe_key text,
  p_body       text default null,
  p_category   text default 'operational',
  p_severity   text default 'info',
  p_entity_type text default null,
  p_entity_id  uuid default null,
  p_action_path text default null,
  p_branch_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_user_id is null or p_org is null then return null; end if;
  if coalesce(trim(coalesce(p_dedupe_key, '')), '') = '' then
    raise exception 'مفتاح منع التكرار مطلوب — تنبيهٌ بلا مفتاح يتكرّر بلا حدّ';
  end if;

  -- الفئة المكتومة لا تُنشئ تنبيهًا أصلًا **إلا الحرِج**: الخطورة الحرِجة
  -- لا تُكتم، وإلا صار الكتم بابًا لتفويت ما لا يُفوَّت.
  if p_severity <> 'critical' and exists (
       select 1 from notification_preferences
        where organization_id = p_org and user_id = p_user_id
          and category = p_category and is_muted)
  then
    return null;
  end if;

  insert into notifications (organization_id, branch_id, user_id, event_key, category,
                             severity, title, body, entity_type, entity_id,
                             action_path, dedupe_key)
  values (p_org, p_branch_id, p_user_id, p_event_key, p_category, p_severity,
          p_title, p_body, p_entity_type, p_entity_id, p_action_path, p_dedupe_key)
  on conflict (organization_id, user_id, dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end $$;

-- 3.3 البثّ حسب القاعدة: الحدث يُوجَّه لمن تُحدّده القاعدة
create or replace function app_notify_event(
  p_org        uuid,
  p_event_key  text,
  p_title      text,
  p_dedupe_key text,
  p_body       text default null,
  p_entity_type text default null,
  p_entity_id  uuid default null,
  p_action_path text default null,
  p_branch_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule notification_rules%rowtype;
  v_u    uuid;
  v_n    integer := 0;
begin
  select * into v_rule from notification_rules
   where organization_id = p_org and event_key = p_event_key;

  -- **حدثٌ بلا قاعدة لا يُنبَّه به بصمت**: القاعدة تُنشأ معطَّلة الافتراض
  -- عند البذر (app_seed_notification_rules)، فغيابها يعني أن المنشأة لم
  -- تُهيَّأ بعد — لا نخترع مستقبِلين.
  if v_rule.id is null or not v_rule.is_active then
    return 0;
  end if;

  if v_rule.target_permission is not null then
    for v_u in select app_users_with_permission(p_org, v_rule.target_permission) loop
      if app_notify(p_org, v_u, p_event_key, p_title, p_dedupe_key, p_body,
                    v_rule.category, v_rule.severity, p_entity_type, p_entity_id,
                    p_action_path, p_branch_id) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  elsif v_rule.target_role_key is not null then
    for v_u in select m.user_id from organization_memberships m
                where m.organization_id = p_org and m.is_active
                  and m.role_key = v_rule.target_role_key loop
      if app_notify(p_org, v_u, p_event_key, p_title, p_dedupe_key, p_body,
                    v_rule.category, v_rule.severity, p_entity_type, p_entity_id,
                    p_action_path, p_branch_id) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return v_n;
end $$;

-- 3.4 بذر القواعد الافتراضية لمنشأة
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
    ('purchase_request_pending', 'طلب شراء ينتظر الموافقة',  'operational', 'info',     'purchasing.approve')
  ) as v(k, n, c, s, p)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 3.5 قراءة/إخفاء
create or replace function app_mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update notifications set read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'التنبيه غير موجود أو ليس لك';
  end if;
end $$;

create or replace function app_mark_all_notifications_read(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update notifications set read_at = now()
   where organization_id = p_org and user_id = auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function app_dismiss_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update notifications
     set dismissed_at = now(), read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'التنبيه غير موجود أو ليس لك';
  end if;
end $$;

create or replace function app_set_notification_preference(
  p_org uuid, p_category text, p_muted boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'غير مسجَّل الدخول'; end if;
  if not app_is_member(p_org) then raise exception 'لست عضوًا في هذه المنشأة'; end if;
  insert into notification_preferences (organization_id, user_id, category, is_muted)
  values (p_org, auth.uid(), p_category, p_muted)
  on conflict (organization_id, user_id, category)
  do update set is_muted = excluded.is_muted, updated_at = now();
end $$;

-- ===========================================================================
-- 4) ربط الأحداث التشغيلية الحقيقية بالتنبيه
--    كل ما يلي يقرأ من جداول قائمة ويُطلق عند الحدث نفسه — لا مهام مجدولة
--    ولا استطلاع دوري.
-- ===========================================================================

-- 4.1 بلاغ عطل حرِج / خروج جهاز من الخدمة
create or replace function app_notify_asset_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_branch uuid;
begin
  select name_ar, branch_id into v_name, v_branch from assets where id = new.asset_id;
  if tg_table_name = 'maintenance_requests' and new.severity = 'critical' then
    perform app_notify_event(
      new.organization_id, 'asset_critical_fault',
      format('عطل حرِج: %s', coalesce(v_name, 'جهاز')),
      format('fault:%s', new.id),
      new.fault_description, 'asset', new.asset_id, '/assets', v_branch);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_asset_fault on maintenance_requests;
create trigger trg_notify_asset_fault
  after insert on maintenance_requests
  for each row execute function app_notify_asset_event();

create or replace function app_notify_asset_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'out_of_service' and old.status is distinct from 'out_of_service' then
    perform app_notify_event(
      new.organization_id, 'asset_out_of_service',
      format('خرج من الخدمة: %s', new.name_ar),
      -- المفتاح يحمل وقت الخروج، فخروجٌ لاحق ينبِّه من جديد
      format('oos:%s:%s', new.id, to_char(now(), 'YYYYMMDDHH24MI')),
      new.status_reason, 'asset', new.id, '/assets', new.branch_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_asset_status on assets;
create trigger trg_notify_asset_status
  after update on assets
  for each row execute function app_notify_asset_status();

-- 4.2 تجاوز الموافقة — حدثٌ رقابيّ لا يمرّ بصمت
create or replace function app_notify_consent_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_item text; v_patient text; v_branch uuid;
begin
  if new.consent_overridden_at is not null
     and old.consent_overridden_at is null then
    select i.name_ar into v_item from items i where i.id = new.item_id;
    select p.name_ar, v.branch_id into v_patient, v_branch
      from patient_visits v join patients p on p.id = v.patient_id
     where v.id = new.visit_id;
    perform app_notify_event(
      new.organization_id, 'consent_overridden',
      format('تجاوز موافقة: %s', coalesce(v_item, 'إجراء')),
      format('override:%s', new.id),
      format('المريض %s — المبرّر: %s', coalesce(v_patient, ''),
             coalesce(new.consent_override_reason, '')),
      'visit_service', new.id, '/documents', v_branch);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_consent_override on patient_visit_services;
create trigger trg_notify_consent_override
  after update on patient_visit_services
  for each row execute function app_notify_consent_override();

-- 4.3 مطالبة تأمين مرفوضة
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'insurance_claim_forms' and column_name = 'status') then
    execute $f$
      create or replace function app_notify_claim_rejected()
      returns trigger
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $g$
      begin
        if new.status = 'rejected' and old.status is distinct from 'rejected' then
          perform app_notify_event(
            new.organization_id, 'claim_rejected',
            'مطالبة تأمين مرفوضة',
            format('claim_rej:%s', new.id),
            coalesce(new.rejection_reason, ''),
            'insurance_claim', new.id, '/insurance', null);
        end if;
        return new;
      end $g$;
    $f$;
    execute 'drop trigger if exists trg_notify_claim_rejected on insurance_claim_forms';
    execute 'create trigger trg_notify_claim_rejected after update on insurance_claim_forms
               for each row execute function app_notify_claim_rejected()';
  end if;
end $$;

-- 4.4 مسيّر رواتب ينتظر الاعتماد
create or replace function app_notify_payroll_pending()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'calculated' and old.status is distinct from 'calculated' then
    perform app_notify_event(
      new.organization_id, 'payroll_awaiting_approval',
      'مسيّر رواتب ينتظر الاعتماد',
      format('payroll:%s', new.id),
      null, 'payroll_run', new.id, '/payroll', new.branch_id);
  end if;
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'payroll_runs') then
    execute 'drop trigger if exists trg_notify_payroll_pending on payroll_runs';
    execute 'create trigger trg_notify_payroll_pending after update on payroll_runs
               for each row execute function app_notify_payroll_pending()';
  end if;
end $$;

-- 4.5 المخزون تحت حدّ الطلب — عند كل حركة، لا باستطلاع
create or replace function app_notify_stock_reorder()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_on_hand numeric;
  v_min     numeric;
  v_name    text;
begin
  select reorder_level into v_min from item_stock_settings
   where organization_id = new.organization_id and item_id = new.item_id
     and is_active
     and (warehouse_id is null or warehouse_id = new.warehouse_id)
   order by warehouse_id nulls last limit 1;
  if coalesce(v_min, 0) <= 0 then return new; end if;

  select coalesce(sum(qty_remaining), 0) into v_on_hand from inventory_lots
   where organization_id = new.organization_id and item_id = new.item_id;
  if v_on_hand > v_min then return new; end if;

  select name_ar into v_name from items where id = new.item_id;
  perform app_notify_event(
    new.organization_id, 'stock_below_reorder',
    format('تحت حدّ الطلب: %s', coalesce(v_name, 'صنف')),
    -- مفتاح يوميّ: تنبيه واحد في اليوم للصنف الواحد مهما تكرّرت الحركات
    format('reorder:%s:%s', new.item_id, to_char(current_date, 'YYYYMMDD')),
    format('الرصيد %s والحدّ %s', v_on_hand, v_min),
    'item', new.item_id, '/inventory', null);
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'item_stock_settings') then
    execute 'drop trigger if exists trg_notify_stock_reorder on inventory_movements';
    execute 'create trigger trg_notify_stock_reorder after insert on inventory_movements
               for each row execute function app_notify_stock_reorder()';
  end if;
end $$;

-- ===========================================================================
-- 5) تنبيهات الانتهاء — تُولَّد عند الطلب من قائمة موحّدة
--    لا مؤقّت في القاعدة: تُستدعى من الشاشة أو من وظيفة مجدولة لاحقًا،
--    ومفتاح منع التكرار يجعل تكرار الاستدعاء بلا أثر.
-- ===========================================================================
create or replace function app_generate_expiry_notifications(
  p_org  uuid,
  p_days integer default 30
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
    select alert_type, title, expires_on
      from expiring_alerts
     where organization_id = p_org
       and expires_on is not null
       and expires_on <= current_date + greatest(coalesce(p_days, 30), 1)
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
-- 6) توسعة قائمة الانتهاء الموحّدة بمصادر المرحلتين 21 و22
--    كانت خمسة مصادر بينما صار في النظام أصولٌ ومستندات كيانات لها صلاحية
--    أيضًا — قائمةٌ ناقصة تعطي طمأنينة كاذبة.
-- ===========================================================================
drop view if exists expiring_alerts cascade;
create view expiring_alerts
with (security_invoker = on) as
select fl.organization_id, 'facility_license'::text as alert_type,
       fl.authority_name as title, fl.end_date as expires_on
  from facility_licenses fl
 where fl.is_disabled = false
union all
select l.organization_id, 'inventory_lot_expiry', coalesce(l.lot_number, 'دفعة بلا رقم'),
       l.expiry_date
  from inventory_lots l
 where l.expiry_date is not null and l.qty_remaining > 0
union all
select ed.organization_id, 'employee_document_expiry', e.name_ar, ed.expiry_date
  from employee_documents ed
  join employees e on e.id = ed.employee_id
 where ed.expiry_date is not null and not coalesce(ed.is_archived, false)
union all
select pi.organization_id, 'insurance_membership_expiry', p.name_ar, pi.expiry_date
  from patient_insurance_memberships pi
  join patients p on p.id = pi.patient_id
 where pi.expiry_date is not null
union all
select c.organization_id, 'employee_contract_expiry', e.name_ar, c.end_date
  from employee_contracts c
  join employees e on e.id = c.employee_id
 where c.end_date is not null
union all
-- المرحلة 21: ضمان الأجهزة وعقود صيانتها ومواعيد معايرتها
select a.organization_id, 'asset_warranty_expiry', a.name_ar, a.warranty_end_date
  from assets a
 where a.warranty_end_date is not null and a.status <> 'disposed'
union all
select a.organization_id, 'asset_service_contract_expiry', a.name_ar, a.service_contract_end
  from assets a
 where a.service_contract_end is not null and a.status <> 'disposed'
union all
select a.organization_id, 'asset_calibration_due', a.name_ar, a.next_calibration_date
  from assets a
 where a.requires_calibration and a.next_calibration_date is not null
   and a.status <> 'disposed'
union all
-- المرحلة 22: مستندات المرضى والكيانات
select d.organization_id, 'patient_document_expiry',
       coalesce(d.file_name, 'مستند مريض'), d.expires_at
  from patient_documents d
 where d.expires_at is not null and not coalesce(d.is_archived, false)
union all
select x.organization_id, 'entity_document_expiry', x.title, x.expires_at
  from entity_documents x
 where x.expires_at is not null and not x.is_archived;

comment on view expiring_alerts is
  'كل ما تنتهي صلاحيته في المنشأة: تراخيص، دفعات، وثائق موظفين، عضويات تأمين، عقود، أجهزة ومعايراتها، ومستندات المرضى والكيانات.';

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================
drop view if exists v_my_notifications;
create view v_my_notifications
with (security_invoker = on) as
select
  n.id, n.organization_id, n.branch_id, n.user_id, n.event_key, n.category,
  n.severity, n.title, n.body, n.entity_type, n.entity_id, n.action_path,
  n.read_at, n.dismissed_at, n.created_at,
  (n.read_at is null) as is_unread,
  n.created_at::date  as report_date
from notifications n
where n.user_id = auth.uid()
  and n.dismissed_at is null;

comment on view v_my_notifications is
  'صندوق تنبيهات المستخدم الحالي — غير المخفيّة، الأحدث أولًا.';

drop view if exists v_notification_summary;
create view v_notification_summary
with (security_invoker = on) as
select
  n.organization_id,
  n.user_id,
  n.category,
  count(*) filter (where n.read_at is null)                        as unread_count,
  count(*) filter (where n.read_at is null and n.severity = 'critical') as critical_count,
  max(n.created_at)                                                as last_at,
  current_date                                                     as report_date
from notifications n
where n.dismissed_at is null and n.user_id = auth.uid()
group by n.organization_id, n.user_id, n.category;

grant select on v_my_notifications, v_notification_summary, expiring_alerts to authenticated;

-- ===========================================================================
-- 8) RLS
-- ===========================================================================
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'notifications'
  loop execute format('drop policy %I on notifications', pol.policyname); end loop;

  -- **التنبيه يراه صاحبه فقط**: صندوق غيرك ليس صندوقك
  create policy notifications_select_own on notifications for select to authenticated
    using (user_id = auth.uid() and app_is_member(organization_id));

  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'notification_rules'
  loop execute format('drop policy %I on notification_rules', pol.policyname); end loop;
  create policy notification_rules_select on notification_rules for select to authenticated
    using (app_is_member(organization_id));
  create policy notification_rules_write on notification_rules for all to authenticated
    using (app_has_permission(organization_id, 'notifications.manage'))
    with check (app_has_permission(organization_id, 'notifications.manage'));

  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'notification_preferences'
  loop execute format('drop policy %I on notification_preferences', pol.policyname); end loop;
  create policy notification_prefs_own on notification_preferences for select to authenticated
    using (user_id = auth.uid() and app_is_member(organization_id));
end $$;

-- ===========================================================================
-- 9) الميزة والقواعد للمنشآت القائمة
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'notifications', 'التنبيهات', 'Notifications', 'لوحة التحكم', true, 16
where not exists (select 1 from feature_catalog where feature_key = 'notifications');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'notifications', true from organizations o
on conflict (organization_id, feature_key) do nothing;

do $$
declare v_src text; v_new text; r record;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is not null and position('''notifications''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''',
                            '''audit_log'',''settings'',''notifications''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة التنبيهات في مزايا المنشأة الافتراضية';
    end if;
    execute v_new;
  end if;

  -- قواعد التوجيه للمنشآت القائمة
  for r in select id from organizations loop
    perform app_seed_notification_rules(r.id);
  end loop;
end $$;

-- والمنشأة الجديدة تُبذر قواعدها بمشغّل مستقلّ، لا بترقيع نصّ دالّة الإنشاء:
-- منشأةٌ بلا قواعد توجيه هي منشأةٌ لا يصلها تنبيهٌ واحد.
create or replace function app_seed_notification_rules_on_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_seed_notification_rules(new.id);
  return new;
end $$;

drop trigger if exists trg_seed_notification_rules on organizations;
create trigger trg_seed_notification_rules
  after insert on organizations
  for each row execute function app_seed_notification_rules_on_org();

-- ===========================================================================
-- 10) حجب الدوال عن الزوّار
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_notify','app_notify_event','app_users_with_permission',
                         'app_seed_notification_rules','app_mark_notification_read',
                         'app_mark_all_notifications_read','app_dismiss_notification',
                         'app_set_notification_preference','app_generate_expiry_notifications')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_notify','app_notify_event','app_users_with_permission',
                             'app_seed_notification_rules','app_mark_notification_read',
                             'app_generate_expiry_notifications']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة التنبيهات % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where indexname = 'uq_notification_dedupe') then
    raise exception 'التنبيه قابل للتكرار — سيغرق المستخدم فيتجاهل المهم';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_seed_notification_rules') then
    raise exception 'المنشأة الجديدة تُنشأ بلا قواعد توجيه — لن يصلها تنبيه';
  end if;

  -- **لا قناة خارجية**: القيد نفسه يمنع إدخال قناة غير داخلية
  if exists (
    select 1 from pg_constraint
     where conrelid = 'notification_rules'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%sms%')
  then
    raise exception 'قناة SMS ظهرت في قواعد التنبيه — ممنوع حتى إشعار آخر';
  end if;

  foreach v_v in array array['v_my_notifications','v_notification_summary','expiring_alerts']
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
