-- ==========================================================================
-- ZainCare — الجزء 2 من 2 — الهجرات 0101 حتى 0112
-- ==========================================================================
-- كيف يُنفَّذ: انسخ هذا الملف كاملًا في محرّر SQL في Supabase واضغط Run
-- **مرة واحدة**. الملف يُنفَّذ داخل معاملة واحدة: إمّا أن ينجح كلّه أو
-- لا يتغيّر شيء في قاعدتك إطلاقًا. لا خطر من التنفيذ المكرَّر — كل شيء
-- فيه مكتوب ليُعاد بلا أثر (idempotent).
--
-- ترتيب التنفيذ: بعد نجاح الجزء 1. لو نُفِّذ قبله فسيتوقّف برسالة واضحة ولن يغيّر شيئًا.
--
-- يشمل: الأصول والصيانة، المستندات والتواقيع، التنبيهات الداخلية، بوابة
--        المريض، النتائج الحرجة، الجودة، سياسات المنشأة، الصلاحيات،
--        اللغة، التكاملات، التحليلات، جاهزية الإطلاق.
--
-- **لا يوجد أيّ شيء يخصّ SMS في هذا الملف، ولا أيّ تكامل مزوّد رسائل.**
-- القناة الوحيدة المفعَّلة في التنبيهات هي `internal` داخل النظام.
-- ==========================================================================



-- ==========================================================================
-- [1/12]  0101_assets_and_maintenance.sql
--          الأصول والصيانة
-- ==========================================================================

-- ============================================================================
-- 0101 — المرحلة 21: الأجهزة والأصول والصيانة
-- ============================================================================
--
-- **ما كان قائمًا**: `resources` — موردٌ للحجز فقط (غرفة أو جهاز أشعة يُحجز
-- عليه موعد). لا يعرف رقمًا تسلسليًّا ولا ضمانًا ولا صيانةً ولا معايرة.
--
-- **الخطر العمليّ**: يُحجز موعد أشعة على جهازٍ خارج الخدمة، أو تُجرى فحوص
-- على جهازٍ انتهت معايرته — فالنتيجة غير معتمَدة وقد يُعاد الفحص كلّه.
--
-- **المبدأ**: الأصل والموردُ القابل للحجز **شيءٌ واحد بمعرّفين**؛ نربطهما
-- ولا نكرّرهما، ونمنع الحجز من القاعدة لا من الشاشة.
--
-- **لا حذف**: الأصل المتخلَّص منه يبقى بسجلّه وقيمته وتاريخه.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 0) الميزة في كتالوج المزايا
--    الشاشة بلا مفتاح ميزة تعني رابطًا في القائمة الجانبية لا يظهر لأحد،
--    أو يظهر لكنه لا يُدار من "التحكم في المديولات". تُسجَّل الميزة، وتُفعَّل
--    للمنشآت القائمة، وتُضاف إلى مصفوفة المزايا الافتراضية للمنشآت الجديدة.
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0101_assets_and_maintenance.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'assets', 'الأصول والصيانة', 'Assets & Maintenance', 'التشغيل والإدارة', false, 334
where not exists (select 1 from feature_catalog where feature_key = 'assets');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'assets', true from organizations o
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
  if v_src is null then
    raise exception 'app_after_organization_created غير موجودة';
  end if;
  if position('''assets''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''', '''audit_log'',''settings'',''assets''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة الأصول في مزايا المنشأة الافتراضية — تغيّر نص الدالّة';
    end if;
    execute v_new;
  end if;
end $$;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'app_after_organization_created') not like '%''assets''%' then
    raise exception 'ميزة الأصول لم تُضف إلى منشآت المستقبل';
  end if;
end $$;

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('assets.view',        'عرض الأصول والأجهزة',   'assets', 1400),
  ('assets.manage',      'إدارة الأصول والأجهزة', 'assets', 1402),
  ('assets.maintenance', 'أوامر الصيانة',         'assets', 1404),
  ('assets.calibration', 'المعايرة والشهادات',    'assets', 1406),
  ('assets.dispose',     'التخلّص من الأصول',      'assets', 1408)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **التخلّص من الأصل لا يُمنح افتراضيًّا**: إخراج أصلٍ من الدفاتر قرارٌ ماليّ.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'assets.view'), ('branch_manager', 'assets.manage'),
  ('branch_manager', 'assets.maintenance'), ('branch_manager', 'assets.calibration'),
  ('accountant',     'assets.view'),
  ('radiology_technician', 'assets.view'), ('radiology_technician', 'assets.maintenance'),
  ('lab_technician', 'assets.view'), ('lab_technician', 'assets.maintenance'),
  ('nurse',          'assets.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) سجل الأصول
-- ===========================================================================
create table if not exists assets (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  clinic_id         uuid references clinics(id),
  department_id     uuid,
  room_number       text,
  asset_number      text not null,
  name_ar           text not null,
  name_en           text,
  asset_category    text not null default 'medical_device'
                      check (asset_category in ('medical_device','lab_device','imaging_device',
                                                'furniture','it_equipment','vehicle','other')),
  is_medical        boolean not null default true,
  manufacturer      text,
  model             text,
  serial_number     text,
  barcode           text,
  -- **الربط بالمورد القابل للحجز**، لا تكرار له: جهاز الأشعة موردٌ يُحجز
  -- عليه وأصلٌ يُصان — كيانٌ واحد بمعرّفين.
  resource_id       uuid references resources(id),
  distributor_id    uuid references distributors(id),
  purchase_invoice_id uuid references purchase_invoices(id),
  purchase_date     date,
  purchase_cost     numeric(14,2),
  warranty_end_date date,
  service_contract_end date,
  useful_life_years integer,
  salvage_value     numeric(14,2) not null default 0,
  accumulated_depreciation numeric(14,2) not null default 0,
  status            text not null default 'in_service'
                      check (status in ('in_service','under_maintenance','out_of_service',
                                        'reserved_for_repair','disposed')),
  status_reason     text,
  requires_calibration boolean not null default false,
  calibration_interval_days integer,
  last_calibration_date date,
  next_calibration_date date,
  note              text,
  disposed_at       timestamptz,
  disposed_by       uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);

create unique index if not exists uq_asset_number on assets (organization_id, asset_number);
-- الرقم التسلسلي والباركود يميّزان الجهاز عالميًّا: تكرارهما يعني جهازين
-- بسجلٍّ واحد، فتُنسب صيانة أحدهما للآخر.
create unique index if not exists uq_asset_serial
  on assets (organization_id, serial_number) where serial_number is not null;
create unique index if not exists uq_asset_barcode
  on assets (organization_id, barcode) where barcode is not null;
create unique index if not exists uq_asset_resource
  on assets (resource_id) where resource_id is not null;
create index if not exists idx_assets_status
  on assets (organization_id, branch_id, status);

alter table assets enable row level security;

-- ===========================================================================
-- 3) خطط الصيانة الوقائية وأوامرها
-- ===========================================================================
create table if not exists maintenance_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  asset_id         uuid not null references assets(id) on delete cascade,
  name_ar          text not null,
  frequency_days   integer not null check (frequency_days > 0),
  last_done_date   date,
  next_due_date    date,
  -- المسؤولية الفعلية تُسجَّل على الأمر (performed_by) لا على الخطة، والجهة
  -- الخارجية تُربط بالموزّع في الأمر — لا اسمَ حرًّا مكرَّرًا في مكانين.
  checklist        jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

create table if not exists maintenance_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  asset_id         uuid not null references assets(id),
  request_number   text,
  fault_description text not null,
  severity         text not null default 'normal'
                     check (severity in ('low','normal','high','critical')),
  status           text not null default 'open'
                     check (status in ('open','assigned','in_progress','resolved',
                                       'closed','cancelled')),
  reported_by      uuid references auth.users(id),
  reported_at      timestamptz not null default now(),
  takes_out_of_service boolean not null default false,
  resolved_at      timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists maintenance_orders (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  branch_id          uuid references branches(id),
  asset_id           uuid not null references assets(id),
  maintenance_plan_id uuid references maintenance_plans(id),
  maintenance_request_id uuid references maintenance_requests(id),
  order_number       text,
  order_type         text not null default 'corrective'
                       check (order_type in ('preventive','corrective','calibration','inspection')),
  status             text not null default 'draft'
                       check (status in ('draft','scheduled','in_progress','completed',
                                         'cancelled')),
  scheduled_date     date,
  started_at         timestamptz,
  completed_at       timestamptz,
  performed_by       uuid references auth.users(id),
  vendor_distributor_id uuid references distributors(id),
  labor_cost         numeric(14,2) not null default 0,
  parts_cost         numeric(14,2) not null default 0,
  total_cost         numeric(14,2) not null default 0,
  downtime_hours     numeric(10,2),
  findings           text,
  actions_taken      text,
  next_due_date      date,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);

create table if not exists maintenance_order_parts (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  item_id              uuid references items(id),
  lot_id               uuid references inventory_lots(id),
  part_name            text,
  qty                  numeric(14,3) not null check (qty > 0),
  unit_cost            numeric(14,2) not null default 0,
  total_cost           numeric(14,2) not null default 0,
  issued_from_stock    boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists idx_maint_orders_asset
  on maintenance_orders (organization_id, asset_id, status);
create index if not exists idx_maint_requests_asset
  on maintenance_requests (organization_id, asset_id, status);

alter table maintenance_plans enable row level security;
alter table maintenance_requests enable row level security;
alter table maintenance_orders enable row level security;
alter table maintenance_order_parts enable row level security;

-- ===========================================================================
-- 4) المعايرة والشهادات، والنقل، والتخلّص
-- ===========================================================================
create table if not exists asset_calibrations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  asset_id           uuid not null references assets(id) on delete cascade,
  calibration_date   date not null,
  next_due_date      date,
  performed_by_vendor text,
  certificate_number text,
  -- ملف الشهادة نفسه يُرفق في المرحلة 22 (المستندات) بجدول المستندات العام،
  -- فلا يُحجز له هنا عمودُ مسارٍ لا يكتب فيه أحد.
  result             text not null default 'passed'
                       check (result in ('passed','passed_with_adjustment','failed')),
  measured_deviation text,
  note               text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id)
);

create table if not exists asset_transfers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  asset_id         uuid not null references assets(id) on delete cascade,
  from_branch_id   uuid references branches(id),
  to_branch_id     uuid references branches(id),
  from_clinic_id   uuid references clinics(id),
  to_clinic_id     uuid references clinics(id),
  from_room        text,
  to_room          text,
  transferred_at   timestamptz not null default now(),
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

create table if not exists asset_disposals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  asset_id          uuid not null references assets(id) on delete cascade,
  disposal_date     date not null default current_date,
  disposal_method   text not null
                      check (disposal_method in ('sold','scrapped','donated','returned_to_vendor','lost')),
  sale_amount       numeric(14,2),
  book_value        numeric(14,2),
  gain_loss         numeric(14,2),
  buyer_name        text,
  reason            text not null,
  certificate_path  text,
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists idx_asset_calibrations
  on asset_calibrations (organization_id, asset_id, calibration_date desc);
create index if not exists idx_asset_transfers
  on asset_transfers (organization_id, asset_id, transferred_at desc);

alter table asset_calibrations enable row level security;
alter table asset_transfers enable row level security;
alter table asset_disposals enable row level security;

-- ===========================================================================
-- 5) **منع حجز جهاز خارج الخدمة** — من القاعدة لا من الشاشة
-- ===========================================================================
--
-- الحجز يقع من ثلاثة مسارات على الأقلّ (المواعيد، وجدولة الأشعة، وحجز
-- الموارد). حارسٌ في كل شاشة يعني ثلاثة أماكن يُنسى أحدها؛ الحارس هنا واحد.
create or replace function app_guard_out_of_service_resource()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset assets%rowtype;
  v_res   uuid;
begin
  v_res := case TG_TABLE_NAME
             when 'radiology_orders' then new.resource_id
             else null
           end;
  if v_res is null then return new; end if;

  select * into v_asset from assets where resource_id = v_res;
  if v_asset.id is null then return new; end if;

  if v_asset.status in ('out_of_service','under_maintenance','reserved_for_repair','disposed') then
    raise exception 'الجهاز % خارج الخدمة (%) — لا يُحجز عليه%',
      v_asset.name_ar, v_asset.status,
      case when v_asset.status_reason is not null
           then ': ' || v_asset.status_reason else '' end;
  end if;

  -- **المعايرة المنتهية تُبطل النتيجة**: فحصٌ على جهازٍ غير معاير قد يُعاد كلّه
  if v_asset.requires_calibration
     and v_asset.next_calibration_date is not null
     and v_asset.next_calibration_date < current_date then
    raise exception 'انتهت معايرة الجهاز % بتاريخ % — عايره قبل استخدامه',
      v_asset.name_ar, v_asset.next_calibration_date;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_radiology_resource on radiology_orders;
create trigger trg_guard_radiology_resource
  before insert or update of resource_id on radiology_orders
  for each row execute function app_guard_out_of_service_resource();

-- الحالة تنعكس على المورد القابل للحجز، فلا يظهر في قوائم الاختيار
create or replace function app_sync_asset_resource_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.resource_id is not null
     and new.status is distinct from coalesce(old.status, '') then
    update resources
       set is_active = (new.status = 'in_service'), updated_at = now()
     where id = new.resource_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sync_asset_resource on assets;
create trigger trg_sync_asset_resource
  before update of status on assets
  for each row execute function app_sync_asset_resource_status();

-- ===========================================================================
-- 6) الدوال
-- ===========================================================================

create or replace function app_set_asset_status(
  p_asset_id uuid,
  p_status   text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_a assets%rowtype;
begin
  select * into v_a from assets where id = p_asset_id for update;
  if v_a.id is null then raise exception 'الأصل غير موجود'; end if;
  if not app_has_permission(v_a.organization_id, 'assets.manage') then
    raise exception 'صلاحيتك لا تسمح بتغيير حالة الأصول (assets.manage)';
  end if;
  if v_a.status = 'disposed' then
    raise exception 'الأصل متخلَّص منه — لا تُغيَّر حالته';
  end if;
  if p_status not in ('in_service','under_maintenance','out_of_service','reserved_for_repair') then
    raise exception 'حالة غير معروفة: %', p_status;
  end if;
  -- **إخراج جهاز من الخدمة يحتاج سببًا**: خروجٌ بلا سبب يُنسى فيبقى معطّلًا
  if p_status <> 'in_service' and coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب إخراج الجهاز من الخدمة مطلوب';
  end if;

  update assets
     set status = p_status, status_reason = p_reason,
         updated_at = now(), updated_by = auth.uid()
   where id = p_asset_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_a.organization_id, v_a.branch_id, auth.uid(), 'assets', 'update', p_asset_id,
          'حالة أصل', format('%s ← %s', v_a.status, p_status), p_reason);
end $$;

-- بلاغ عطل: يُخرج الجهاز من الخدمة فورًا إن كان العطل يمنع الاستخدام
create or replace function app_report_asset_fault(
  p_asset_id     uuid,
  p_description  text,
  p_severity     text default 'normal',
  p_out_of_service boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a  assets%rowtype;
  v_id uuid;
begin
  select * into v_a from assets where id = p_asset_id;
  if v_a.id is null then raise exception 'الأصل غير موجود'; end if;
  if not app_has_permission(v_a.organization_id, 'assets.maintenance') then
    raise exception 'صلاحيتك لا تسمح ببلاغات الأعطال (assets.maintenance)';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'وصف العطل مطلوب';
  end if;

  insert into maintenance_requests (organization_id, branch_id, asset_id,
                                    fault_description, severity, reported_by,
                                    takes_out_of_service)
  values (v_a.organization_id, v_a.branch_id, p_asset_id, p_description,
          coalesce(p_severity, 'normal'), auth.uid(),
          coalesce(p_out_of_service, false) or p_severity = 'critical')
  returning id into v_id;

  -- **العطل الحرِج يُخرج الجهاز فورًا**: انتظارُ قرارٍ إداريّ يعني مريضًا
  -- على جهازٍ معطوب.
  if coalesce(p_out_of_service, false) or p_severity = 'critical' then
    update assets
       set status = 'out_of_service',
           status_reason = format('عطل: %s', left(p_description, 200)),
           updated_at = now()
     where id = p_asset_id and status <> 'disposed';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_a.organization_id, v_a.branch_id, auth.uid(), 'assets', 'add', v_id,
          'بلاغ عطل', format('%s — %s', v_a.name_ar, left(p_description, 150)));

  return v_id;
end $$;

create or replace function app_complete_maintenance_order(
  p_order_id     uuid,
  p_findings     text,
  p_actions      text,
  p_return_to_service boolean default true,
  p_labor_cost   numeric default null,
  p_downtime_hours numeric default null,
  p_vendor_distributor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o     maintenance_orders%rowtype;
  v_parts numeric;
  v_plan  maintenance_plans%rowtype;
begin
  select * into v_o from maintenance_orders where id = p_order_id for update;
  if v_o.id is null then raise exception 'أمر الصيانة غير موجود'; end if;
  if not app_has_permission(v_o.organization_id, 'assets.maintenance') then
    raise exception 'صلاحيتك لا تسمح بإغلاق أوامر الصيانة (assets.maintenance)';
  end if;
  if v_o.status in ('completed','cancelled') then
    raise exception 'أمر الصيانة حالته % — لا يُغلق مرّتين', v_o.status;
  end if;
  if coalesce(trim(p_actions), '') = '' then
    raise exception 'الإجراء المتَّخذ مطلوب — أمرٌ يُغلق بلا إجراء لا يُثبت أن الجهاز صُلح';
  end if;

  select coalesce(sum(total_cost), 0) into v_parts
    from maintenance_order_parts where maintenance_order_id = p_order_id;

  if p_labor_cost is not null and p_labor_cost < 0 then
    raise exception 'تكلفة العمالة لا تكون سالبة';
  end if;
  if p_downtime_hours is not null and p_downtime_hours < 0 then
    raise exception 'ساعات التوقّف لا تكون سالبة';
  end if;
  if p_vendor_distributor_id is not null
     and not exists (select 1 from distributors d
                      where d.id = p_vendor_distributor_id
                        and d.organization_id = v_o.organization_id) then
    raise exception 'الجهة الخارجية ليست موزّعًا مسجَّلًا في هذه المنشأة';
  end if;

  update maintenance_orders
     set status = 'completed', completed_at = now(),
         findings = p_findings, actions_taken = p_actions,
         parts_cost = v_parts,
         labor_cost = coalesce(p_labor_cost, labor_cost, 0),
         -- تكلفة الأمر = عمالة + قطع؛ ساعات التوقّف تُقاس لأثر العطل التشغيلي
         total_cost = round(coalesce(p_labor_cost, labor_cost, 0) + v_parts, 2),
         downtime_hours = coalesce(p_downtime_hours, downtime_hours),
         vendor_distributor_id = coalesce(p_vendor_distributor_id, vendor_distributor_id),
         performed_by = coalesce(performed_by, auth.uid()),
         updated_at = now()
   where id = p_order_id;

  -- خطة الوقائية تتقدّم إلى موعدها التالي
  if v_o.maintenance_plan_id is not null then
    select * into v_plan from maintenance_plans where id = v_o.maintenance_plan_id;
    update maintenance_plans
       set last_done_date = current_date,
           next_due_date = current_date + make_interval(days => v_plan.frequency_days),
           updated_at = now()
     where id = v_o.maintenance_plan_id;
  end if;

  -- البلاغ المرتبط يُغلق مع الأمر
  if v_o.maintenance_request_id is not null then
    update maintenance_requests
       set status = 'resolved', resolved_at = now(), updated_at = now()
     where id = v_o.maintenance_request_id;
  end if;

  -- **العودة للخدمة قرارٌ صريح**: أمرٌ اكتمل لا يعني بالضرورة أن الجهاز صالح
  if p_return_to_service then
    update assets
       set status = 'in_service', status_reason = null, updated_at = now()
     where id = v_o.asset_id and status <> 'disposed';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_o.organization_id, v_o.branch_id, auth.uid(), 'assets', 'update', p_order_id,
          'إغلاق أمر صيانة',
          format('تكلفة %s%s', round(coalesce(v_o.labor_cost, 0) + v_parts, 2),
                 case when p_return_to_service then ' — عاد للخدمة' else '' end));
end $$;

-- صرف قطعة غيار من المخزون: حركةٌ حقيقية لا رقمٌ في نصّ
create or replace function app_issue_maintenance_part(
  p_order_id uuid,
  p_lot_id   uuid,
  p_qty      numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o   maintenance_orders%rowtype;
  v_lot inventory_lots%rowtype;
  v_id  uuid;
begin
  select * into v_o from maintenance_orders where id = p_order_id;
  if v_o.id is null then raise exception 'أمر الصيانة غير موجود'; end if;
  if not app_has_permission(v_o.organization_id, 'assets.maintenance') then
    raise exception 'صلاحيتك لا تسمح بصرف قطع الغيار (assets.maintenance)';
  end if;
  if v_o.status in ('completed','cancelled') then
    raise exception 'لا تُصرف قطع على أمرٍ حالته %', v_o.status;
  end if;
  select * into v_lot from inventory_lots where id = p_lot_id;
  if v_lot.id is null then raise exception 'التشغيلة غير موجودة'; end if;

  -- الخروج يمرّ بحركة المخزون: الرصيد السالب والحجر والصلاحية كلّها محروسة هناك
  insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                   movement_type, qty, unit_price, total_amount,
                                   note, created_by)
  values (v_o.organization_id, v_lot.warehouse_id, v_lot.item_id, p_lot_id,
          'consumption_out', p_qty, v_lot.unit_cost,
          round(v_lot.unit_cost * p_qty, 2),
          format('قطعة غيار لأمر صيانة %s', coalesce(v_o.order_number, '')), auth.uid());

  insert into maintenance_order_parts (organization_id, maintenance_order_id, item_id,
                                       lot_id, qty, unit_cost, total_cost,
                                       issued_from_stock)
  values (v_o.organization_id, p_order_id, v_lot.item_id, p_lot_id, p_qty,
          v_lot.unit_cost, round(v_lot.unit_cost * p_qty, 2), true)
  returning id into v_id;

  update maintenance_orders
     set parts_cost = coalesce(parts_cost, 0) + round(v_lot.unit_cost * p_qty, 2),
         total_cost = coalesce(labor_cost, 0) + coalesce(parts_cost, 0)
                    + round(v_lot.unit_cost * p_qty, 2),
         updated_at = now()
   where id = p_order_id;

  return v_id;
end $$;

create or replace function app_record_calibration(
  p_asset_id     uuid,
  p_date         date,
  p_result       text,
  p_certificate  text default null,
  p_vendor       text default null,
  p_note         text default null,
  p_deviation    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a    assets%rowtype;
  v_id   uuid;
  v_next date;
begin
  select * into v_a from assets where id = p_asset_id for update;
  if v_a.id is null then raise exception 'الأصل غير موجود'; end if;
  if not app_has_permission(v_a.organization_id, 'assets.calibration') then
    raise exception 'صلاحيتك لا تسمح بتسجيل المعايرة (assets.calibration)';
  end if;
  if p_result not in ('passed','passed_with_adjustment','failed') then
    raise exception 'نتيجة معايرة غير معروفة: %', p_result;
  end if;

  v_next := case when v_a.calibration_interval_days is not null
                 then p_date + make_interval(days => v_a.calibration_interval_days) end;

  insert into asset_calibrations (organization_id, asset_id, calibration_date,
                                  next_due_date, performed_by_vendor, certificate_number,
                                  result, measured_deviation, note, created_by)
  values (v_a.organization_id, p_asset_id, p_date, v_next, p_vendor, p_certificate,
          p_result, nullif(trim(coalesce(p_deviation, '')), ''), p_note, auth.uid())
  returning id into v_id;

  -- **المعايرة الراسبة تُخرج الجهاز**: نتائجه بعدها غير معتمَدة
  if p_result = 'failed' then
    update assets
       set status = 'out_of_service',
           status_reason = 'رسوب في المعايرة',
           last_calibration_date = p_date,
           next_calibration_date = p_date,
           updated_at = now()
     where id = p_asset_id;
  else
    update assets
       set last_calibration_date = p_date,
           next_calibration_date = v_next,
           updated_at = now()
     where id = p_asset_id;
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_a.organization_id, v_a.branch_id, auth.uid(), 'assets', 'add', v_id,
          'معايرة جهاز', format('%s — %s', v_a.name_ar, p_result));

  return v_id;
end $$;

create or replace function app_transfer_asset(
  p_asset_id     uuid,
  p_to_branch_id uuid,
  p_to_clinic_id uuid default null,
  p_to_room      text default null,
  p_reason       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a  assets%rowtype;
  v_id uuid;
begin
  select * into v_a from assets where id = p_asset_id for update;
  if v_a.id is null then raise exception 'الأصل غير موجود'; end if;
  if not app_has_permission(v_a.organization_id, 'assets.manage') then
    raise exception 'صلاحيتك لا تسمح بنقل الأصول (assets.manage)';
  end if;
  if v_a.status = 'disposed' then
    raise exception 'الأصل متخلَّص منه — لا يُنقل';
  end if;

  insert into asset_transfers (organization_id, asset_id, from_branch_id, to_branch_id,
                               from_clinic_id, to_clinic_id, from_room, to_room,
                               reason, created_by)
  values (v_a.organization_id, p_asset_id, v_a.branch_id, p_to_branch_id,
          v_a.clinic_id, p_to_clinic_id, v_a.room_number, p_to_room, p_reason, auth.uid())
  returning id into v_id;

  update assets
     set branch_id = p_to_branch_id, clinic_id = p_to_clinic_id,
         room_number = p_to_room, updated_at = now(), updated_by = auth.uid()
   where id = p_asset_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_a.organization_id, p_to_branch_id, auth.uid(), 'assets', 'update', p_asset_id,
          'نقل أصل', format('نُقل %s بين الفروع', v_a.name_ar), p_reason);

  return v_id;
end $$;

create or replace function app_dispose_asset(
  p_asset_id uuid,
  p_method   text,
  p_reason   text,
  p_sale_amount numeric default null,
  p_buyer    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a    assets%rowtype;
  v_id   uuid;
  v_book numeric;
  v_gain numeric;
  v_open int;
  v_entry uuid;
  v_cost_acc uuid;
  v_accum_acc uuid;
  v_cash_acc uuid;
  v_gain_acc uuid;
  v_loss_acc uuid;
begin
  select * into v_a from assets where id = p_asset_id for update;
  if v_a.id is null then raise exception 'الأصل غير موجود'; end if;
  if not app_has_permission(v_a.organization_id, 'assets.dispose') then
    raise exception 'صلاحيتك لا تسمح بالتخلّص من الأصول (assets.dispose)';
  end if;
  if v_a.status = 'disposed' then raise exception 'الأصل متخلَّص منه سلفًا'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب التخلّص مطلوب'; end if;

  -- **لا تخلّص وعليه أوامر صيانة مفتوحة**: تكلفةٌ تُصرف على أصلٍ خرج
  select count(*) into v_open from maintenance_orders
   where asset_id = p_asset_id and status in ('draft','scheduled','in_progress');
  if v_open > 0 then
    raise exception 'على الأصل % أمر صيانة مفتوح — أغلقها قبل التخلّص', v_open;
  end if;

  v_book := round(coalesce(v_a.purchase_cost, 0) - coalesce(v_a.accumulated_depreciation, 0), 2);
  v_gain := round(coalesce(p_sale_amount, 0) - v_book, 2);

  insert into asset_disposals (organization_id, asset_id, disposal_method, sale_amount,
                               book_value, gain_loss, buyer_name, reason, created_by)
  values (v_a.organization_id, p_asset_id, p_method, p_sale_amount, v_book, v_gain,
          p_buyer, p_reason, auth.uid())
  returning id into v_id;

  -- **الأصل لا يُحذف**: يبقى بسجلّه وقيمته وتاريخه
  update assets
     set status = 'disposed', status_reason = p_reason,
         disposed_at = now(), disposed_by = auth.uid(), updated_at = now()
   where id = p_asset_id;

  -- ويُعطَّل موردُه فلا يظهر في قوائم الحجز
  if v_a.resource_id is not null then
    update resources set is_active = false, updated_at = now() where id = v_a.resource_id;
  end if;

  -- القيد المحاسبي **مسودّة**: إخراج الأصل من الدفاتر وإقفال مجمّع إهلاكه
  -- وإثبات الربح أو الخسارة. يبقى مسودّة ليعتمده المحاسب كبقية الترحيل
  -- التلقائي في النظام — لا تُغيَّر الدفاتر من شاشة الأصول بلا مراجعة.
  if coalesce(v_a.purchase_cost, 0) > 0 then
    perform app_ensure_asset_accounts(v_a.organization_id);
    select id into v_cost_acc  from chart_of_accounts
      where organization_id = v_a.organization_id and code = '1400';
    select id into v_accum_acc from chart_of_accounts
      where organization_id = v_a.organization_id and code = '1450';
    select id into v_cash_acc  from chart_of_accounts
      where organization_id = v_a.organization_id and code = '1100';
    select id into v_gain_acc  from chart_of_accounts
      where organization_id = v_a.organization_id and code = '4300';
    select id into v_loss_acc  from chart_of_accounts
      where organization_id = v_a.organization_id and code = '5500';

    if v_cost_acc is not null and v_accum_acc is not null then
      insert into journal_entries (organization_id, branch_id, entry_date, reference_type,
                                   reference_id, status, description)
      values (v_a.organization_id, v_a.branch_id, current_date, 'manual', v_id, 'draft',
              format('التخلّص من أصل — %s', v_a.name_ar))
      returning id into v_entry;

      if coalesce(v_a.accumulated_depreciation, 0) > 0 then
        insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
          values (v_entry, v_accum_acc, v_a.accumulated_depreciation, 0);
      end if;
      if coalesce(p_sale_amount, 0) > 0 and v_cash_acc is not null then
        insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
          values (v_entry, v_cash_acc, p_sale_amount, 0);
      end if;
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry, v_cost_acc, 0, v_a.purchase_cost);
      if v_gain > 0 and v_gain_acc is not null then
        insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
          values (v_entry, v_gain_acc, 0, v_gain);
      elsif v_gain < 0 and v_loss_acc is not null then
        insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
          values (v_entry, v_loss_acc, -v_gain, 0);
      end if;

      update asset_disposals set journal_entry_id = v_entry where id = v_id;
    end if;
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_a.organization_id, v_a.branch_id, auth.uid(), 'assets', 'update', p_asset_id,
          'التخلّص من أصل',
          format('%s بطريقة %s، قيمة دفترية %s، فرق %s', v_a.name_ar, p_method,
                 v_book, v_gain), p_reason);

  return v_id;
end $$;

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================
drop view if exists v_asset_register;
create view v_asset_register
with (security_invoker = on) as
select
  a.id                 as asset_id,
  a.organization_id,
  a.branch_id,
  br.name              as branch_name,
  a.clinic_id,
  c.name               as clinic_name,
  a.room_number,
  a.asset_number,
  a.name_ar            as asset_name,
  a.asset_category,
  a.is_medical,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.barcode,
  a.resource_id,
  a.status,
  a.status_reason,
  a.purchase_date      as report_date,
  a.purchase_cost,
  a.accumulated_depreciation,
  round(coalesce(a.purchase_cost, 0) - coalesce(a.accumulated_depreciation, 0), 2)
                       as book_value,
  a.warranty_end_date,
  case when a.warranty_end_date is not null
       then (a.warranty_end_date - current_date) end as warranty_days_left,
  (a.warranty_end_date is not null and a.warranty_end_date < current_date) as warranty_expired,
  d.name_ar            as supplier_name,
  a.requires_calibration,
  a.last_calibration_date,
  a.next_calibration_date,
  case when a.next_calibration_date is not null
       then (a.next_calibration_date - current_date) end as calibration_days_left,
  (a.requires_calibration and a.next_calibration_date is not null
   and a.next_calibration_date < current_date) as calibration_overdue,
  plan.next_due_date   as next_maintenance_due,
  case when plan.next_due_date is not null
       then (plan.next_due_date - current_date) end as maintenance_days_left,
  open_req.open_requests,
  costs.maintenance_cost_total
from assets a
left join branches br on br.id = a.branch_id
left join clinics  c  on c.id  = a.clinic_id
left join distributors d on d.id = a.distributor_id
left join lateral (
  select min(next_due_date) as next_due_date
    from maintenance_plans where asset_id = a.id and is_active
) plan on true
left join lateral (
  select count(*) as open_requests
    from maintenance_requests
   where asset_id = a.id and status in ('open','assigned','in_progress')
) open_req on true
left join lateral (
  select coalesce(sum(total_cost), 0) as maintenance_cost_total
    from maintenance_orders where asset_id = a.id and status = 'completed'
) costs on true;

comment on view v_asset_register is
  'سجل الأصول بحالتها وضمانها ومعايرتها وصيانتها القادمة وتكلفتها المتراكمة.';

drop view if exists v_asset_alerts;
create view v_asset_alerts
with (security_invoker = on) as
select
  a.id                 as asset_id,
  a.organization_id,
  a.branch_id,
  a.asset_number,
  a.name_ar            as asset_name,
  'calibration'::text  as alert_type,
  a.next_calibration_date as due_date,
  a.next_calibration_date as report_date,
  (a.next_calibration_date - current_date) as days_left,
  case when a.next_calibration_date < current_date then 'متأخّرة' else 'قادمة' end as urgency
from assets a
where a.status <> 'disposed' and a.requires_calibration
  and a.next_calibration_date is not null
  and a.next_calibration_date <= current_date + 60
union all
select
  a.id, a.organization_id, a.branch_id, a.asset_number, a.name_ar,
  'warranty', a.warranty_end_date, a.warranty_end_date,
  (a.warranty_end_date - current_date),
  case when a.warranty_end_date < current_date then 'منتهٍ' else 'يقارب الانتهاء' end
from assets a
where a.status <> 'disposed' and a.warranty_end_date is not null
  and a.warranty_end_date <= current_date + 60
union all
-- عقد الصيانة المنتهي يعني أن العطل القادم يُدفع نقدًا: ينبَّه قبل انتهائه
select
  a.id, a.organization_id, a.branch_id, a.asset_number, a.name_ar,
  'service_contract', a.service_contract_end, a.service_contract_end,
  (a.service_contract_end - current_date),
  case when a.service_contract_end < current_date then 'منتهٍ' else 'يقارب الانتهاء' end
from assets a
where a.status <> 'disposed' and a.service_contract_end is not null
  and a.service_contract_end <= current_date + 60
union all
select
  a.id, a.organization_id, a.branch_id, a.asset_number, a.name_ar,
  'maintenance', p.next_due_date, p.next_due_date,
  (p.next_due_date - current_date),
  case when p.next_due_date < current_date then 'متأخّرة' else 'قادمة' end
from maintenance_plans p
join assets a on a.id = p.asset_id
where p.is_active and a.status <> 'disposed'
  and p.next_due_date is not null
  and p.next_due_date <= current_date + 30;

comment on view v_asset_alerts is
  'تنبيهات المعايرة والضمان والصيانة في تدفّق واحد — الجهاز الذي انتهت معايرته تُبطل نتائجه.';

drop view if exists v_maintenance_history;
create view v_maintenance_history
with (security_invoker = on) as
select
  o.id                 as maintenance_order_id,
  o.organization_id,
  o.branch_id,
  o.asset_id,
  a.asset_number,
  a.name_ar            as asset_name,
  o.order_number,
  o.order_type,
  o.status,
  coalesce(o.completed_at::date, o.scheduled_date, o.created_at::date) as report_date,
  o.scheduled_date,
  o.started_at,
  o.completed_at,
  o.performed_by,
  o.vendor_distributor_id,
  d.name_ar          as vendor_name,
  o.labor_cost,
  o.parts_cost,
  o.total_cost,
  o.downtime_hours,
  o.findings,
  o.actions_taken,
  r.fault_description,
  r.severity,
  o.maintenance_plan_id,
  pl.name_ar          as plan_name,
  pl.checklist        as plan_checklist,
  parts.part_count
from maintenance_orders o
join assets a on a.id = o.asset_id
left join maintenance_requests r on r.id = o.maintenance_request_id
left join maintenance_plans pl on pl.id = o.maintenance_plan_id
left join distributors d on d.id = o.vendor_distributor_id
left join lateral (
  select count(*) as part_count from maintenance_order_parts
   where maintenance_order_id = o.id
) parts on true;

comment on view v_maintenance_history is
  'تاريخ الصيانة بتكلفتها وقطعها ومدّة التوقّف — الجهاز الذي تتكرّر أعطاله يظهر هنا قبل أن يُستبدل متأخّرًا.';

-- ===========================================================================
-- 7.5) الإهلاك — لماذا هنا أصلًا؟
--   `accumulated_depreciation` يُقرأ عند التخلّص لحساب القيمة الدفترية والربح
--   أو الخسارة. عمودٌ يُقرأ ولا يكتبه شيء يعني أن كل تخلّصٍ يحسب القيمة
--   الدفترية = تكلفة الشراء، فيظهر ربحٌ وهميّ أو خسارةٌ وهمية في الدفاتر.
--   الإهلاك هنا **بالقسط الثابت شهريًّا**، مرّة واحدة لكل شهر، بقيدٍ محاسبيّ
--   يمرّ بحارس الفترة المالية للمرحلة 19.
-- ===========================================================================
create table if not exists asset_depreciation_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  period_month     date not null,          -- أوّل يوم في الشهر
  asset_count      integer not null default 0,
  total_amount     numeric(14,2) not null default 0,
  journal_entry_id uuid references journal_entries(id),
  posted_at        timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

-- **مرّة واحدة لكل شهر**: تكرار الترحيل يضاعف مجمّع الإهلاك بلا رجعة.
create unique index if not exists uq_depreciation_run_month
  on asset_depreciation_runs (organization_id, period_month);

create table if not exists asset_depreciation_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  run_id           uuid not null references asset_depreciation_runs(id) on delete cascade,
  asset_id         uuid not null references assets(id),
  amount           numeric(14,2) not null check (amount > 0),
  accumulated_after numeric(14,2) not null,
  net_book_value   numeric(14,2) not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_depreciation_lines_asset
  on asset_depreciation_lines (organization_id, asset_id);

alter table asset_depreciation_runs enable row level security;
alter table asset_depreciation_lines enable row level security;

-- حسابات الأصول الثابتة: تُضاف لمن عنده دليل حسابات، وتدخل دليل المنشآت الجديدة
create or replace function app_ensure_asset_accounts(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from chart_of_accounts where organization_id = p_org) then
    return;  -- لا دليل حسابات لهذه المنشأة — المحاسبة موديول اختياري
  end if;
  insert into chart_of_accounts (organization_id, code, name_ar, account_type)
  select p_org, v.code, v.n, v.t
  from (values
    ('1400', 'الأصول الثابتة',            'asset'),
    ('1450', 'مجمّع إهلاك الأصول الثابتة', 'asset'),
    ('5400', 'مصروف الإهلاك',             'expense'),
    ('4300', 'أرباح بيع أصول',            'revenue'),
    ('5500', 'خسائر بيع أصول',            'expense')
  ) as v(code, n, t)
  where not exists (select 1 from chart_of_accounts c
                     where c.organization_id = p_org and c.code = v.code);
end $$;

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_seed_default_chart_of_accounts';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is not null and position('''1450''' in v_src) = 0 then
    v_new := replace(
      v_src,
      '(''5300'', ''مصروفات تشغيلية متنوعة'', ''expense'')',
      '(''5300'', ''مصروفات تشغيلية متنوعة'', ''expense''),
    (''1400'', ''الأصول الثابتة'', ''asset''),
    (''1450'', ''مجمّع إهلاك الأصول الثابتة'', ''asset''),
    (''5400'', ''مصروف الإهلاك'', ''expense''),
    (''4300'', ''أرباح بيع أصول'', ''revenue''),
    (''5500'', ''خسائر بيع أصول'', ''expense'')');
    if v_new = v_src then
      raise exception 'تعذّر إضافة حسابات الأصول الثابتة إلى دليل الحسابات الافتراضي';
    end if;
    execute v_new;
  end if;
end $$;

-- قاعدة الترحيل: `depreciation` كانت مصرَّحًا بها في المرحلة 19 بلا قاعدةٍ
-- واحدة تستعملها. تُسجَّل الآن لتكون القيود مرتبطة بقاعدةٍ معلنة لا بكودٍ صامت.
create or replace function app_seed_asset_depreciation_rule(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_dr uuid; v_cr uuid;
begin
  perform app_ensure_asset_accounts(p_org);
  select id into v_dr from chart_of_accounts where organization_id = p_org and code = '5400';
  select id into v_cr from chart_of_accounts where organization_id = p_org and code = '1450';
  if v_dr is null or v_cr is null then return null; end if;
  select id into v_id from gl_posting_rules
   where organization_id = p_org and rule_key = 'asset_depreciation';
  if v_id is null then
    insert into gl_posting_rules (organization_id, rule_key, name_ar, source_event,
                                  debit_account_id, credit_account_id,
                                  amount_expression, sort_order)
    values (p_org, 'asset_depreciation', 'إهلاك الأصول الثابتة', 'depreciation',
            v_dr, v_cr, 'total_amount', 100)
    returning id into v_id;
  else
    update gl_posting_rules
       set debit_account_id = coalesce(debit_account_id, v_dr),
           credit_account_id = coalesce(credit_account_id, v_cr),
           updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function app_post_asset_depreciation(
  p_org   uuid,
  p_month date default date_trunc('month', current_date)::date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_run   uuid;
  v_entry uuid;
  v_rule  uuid;
  v_dr    uuid;
  v_cr    uuid;
  v_total numeric := 0;
  v_count integer := 0;
  r       record;
  v_amt   numeric;
begin
  if not app_has_permission(p_org, 'assets.manage') then
    raise exception 'صلاحيتك لا تسمح بترحيل الإهلاك (assets.manage)';
  end if;
  -- **لا إهلاك لشهرٍ لم ينتهِ**: الشهر الجاري يُرحَّل بعد انقضائه
  if v_end >= current_date then
    raise exception 'لا يُرحَّل إهلاك شهرٍ لم ينتهِ بعد (%)', to_char(v_month, 'YYYY-MM');
  end if;
  if exists (select 1 from asset_depreciation_runs
              where organization_id = p_org and period_month = v_month) then
    raise exception 'إهلاك شهر % مُرحَّل من قبل — لا يُرحَّل مرّتين', to_char(v_month, 'YYYY-MM');
  end if;

  insert into asset_depreciation_runs (organization_id, period_month, created_by)
  values (p_org, v_month, auth.uid())
  returning id into v_run;

  for r in
    select a.id, a.purchase_cost, a.salvage_value, a.useful_life_years,
           a.accumulated_depreciation
      from assets a
     where a.organization_id = p_org
       and a.status <> 'disposed'
       and coalesce(a.purchase_cost, 0) > 0
       and coalesce(a.useful_life_years, 0) > 0
       and a.purchase_date is not null
       and a.purchase_date <= v_end
     for update
  loop
    -- القسط الثابت: (التكلفة − القيمة التخريدية) ÷ عدد الشهور، بلا تجاوز
    v_amt := round((r.purchase_cost - coalesce(r.salvage_value, 0))
                   / (r.useful_life_years * 12), 2);
    v_amt := least(v_amt,
                   (r.purchase_cost - coalesce(r.salvage_value, 0))
                     - coalesce(r.accumulated_depreciation, 0));
    if v_amt <= 0 then continue; end if;   -- أُهلك بالكامل

    update assets
       set accumulated_depreciation = coalesce(accumulated_depreciation, 0) + v_amt,
           updated_at = now()
     where id = r.id;

    insert into asset_depreciation_lines (organization_id, run_id, asset_id, amount,
                                          accumulated_after, net_book_value)
    values (p_org, v_run, r.id, v_amt,
            coalesce(r.accumulated_depreciation, 0) + v_amt,
            r.purchase_cost - (coalesce(r.accumulated_depreciation, 0) + v_amt));

    v_total := v_total + v_amt;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'لا أصول قابلة للإهلاك في % — لا يُنشأ قيدٌ فارغ', to_char(v_month, 'YYYY-MM');
  end if;

  -- القيد: مدين مصروف الإهلاك، دائن مجمّع الإهلاك. يمرّ بحارس الفترة المالية.
  v_rule := app_seed_asset_depreciation_rule(p_org);
  select debit_account_id, credit_account_id into v_dr, v_cr
    from gl_posting_rules where id = v_rule;

  if v_dr is not null and v_cr is not null then
    insert into journal_entries (organization_id, entry_date, reference_type, reference_id,
                                 status, description, posting_rule_id)
    values (p_org, v_end, 'manual', v_run, 'draft',
            format('إهلاك الأصول الثابتة — %s', to_char(v_month, 'YYYY-MM')), v_rule)
    returning id into v_entry;

    insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
      values (v_entry, v_dr, v_total, 0), (v_entry, v_cr, 0, v_total);
  end if;

  update asset_depreciation_runs
     set asset_count = v_count, total_amount = v_total, journal_entry_id = v_entry
   where id = v_run;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'assets', 'add', v_run, 'ترحيل إهلاك',
          format('%s — %s أصلًا بمبلغ %s', to_char(v_month, 'YYYY-MM'), v_count, v_total));

  return v_run;
end $$;

drop view if exists v_asset_depreciation_schedule;
create view v_asset_depreciation_schedule
with (security_invoker = on) as
select
  a.id              as asset_id,
  a.organization_id,
  a.branch_id,
  a.asset_number,
  a.name_ar         as asset_name,
  a.purchase_date,
  a.purchase_cost,
  a.salvage_value,
  a.useful_life_years,
  case when coalesce(a.useful_life_years, 0) > 0 and coalesce(a.purchase_cost, 0) > 0
       then round((a.purchase_cost - coalesce(a.salvage_value, 0))
                  / (a.useful_life_years * 12), 2) end as monthly_depreciation,
  a.accumulated_depreciation,
  round(coalesce(a.purchase_cost, 0) - coalesce(a.accumulated_depreciation, 0), 2)
                    as net_book_value,
  (select max(r.period_month) from asset_depreciation_lines l
     join asset_depreciation_runs r on r.id = l.run_id
    where l.asset_id = a.id)                    as last_depreciated_month,
  coalesce(a.purchase_date, current_date)       as report_date,
  a.status
from assets a
where a.status <> 'disposed';

comment on view v_asset_depreciation_schedule is
  'جدول الإهلاك بالقسط الثابت: القسط الشهري والمجمَّع والقيمة الدفترية الصافية لكل أصل.';

grant select on v_asset_register, v_asset_alerts, v_maintenance_history,
                v_asset_depreciation_schedule to authenticated;

-- ===========================================================================
-- 8) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['assets','maintenance_plans','maintenance_requests',
                               'maintenance_orders','maintenance_order_parts',
                               'asset_calibrations','asset_transfers','asset_disposals',
                               'asset_depreciation_runs','asset_depreciation_lines']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- الأصل والمعايرة والتخلّص لا تُحذف
create or replace function app_block_asset_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'سجلّات الأصول لا تُحذف — استخدم التعطيل أو التخلّص المسجَّل';
end $$;

do $$
declare r record;
begin
  for r in select unnest(array['assets','asset_calibrations','asset_disposals',
                               'asset_depreciation_runs','asset_depreciation_lines']) as t
  loop
    execute format('drop trigger if exists trg_block_delete_%1$s on %1$I', r.t);
    execute format($f$
      create trigger trg_block_delete_%1$s before delete on %1$I
        for each row execute function app_block_asset_delete()
    $f$, r.t);
  end loop;
end $$;

-- ===========================================================================
-- 9) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_set_asset_status','app_report_asset_fault',
                             'app_complete_maintenance_order','app_issue_maintenance_part',
                             'app_record_calibration','app_transfer_asset',
                             'app_dispose_asset','app_post_asset_depreciation',
                             'app_ensure_asset_accounts','app_seed_asset_depreciation_rule']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الأصول % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_radiology_resource') then
    raise exception 'حارس الحجز على جهاز خارج الخدمة غير مركَّب';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_asset_serial') then
    raise exception 'الرقم التسلسلي غير فريد — جهازان بسجلٍّ واحد';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_depreciation_run_month') then
    raise exception 'الإهلاك قابل للترحيل مرّتين في الشهر نفسه';
  end if;
end $$;


-- ==========================================================================
-- [2/12]  0102_documents_and_signatures.sql
--          المستندات والتواقيع
-- ==========================================================================

-- ============================================================================
-- 0102 — المرحلة 22: إدارة المستندات والموافقات والتواقيع
-- ============================================================================
-- لماذا هذه المرحلة أصلًا؟ ثلاث ثغرات قائمة في النظام اليوم:
--
--   1) `items.requires_consent` موجود، و`v_pending_consents` يعرض الخدمات التي
--      تحتاج موافقة — لكن **لا شيء يمنع تنفيذ الخدمة بلا موافقة**. التقرير
--      يشتكي بعد وقوع الفعل. الموافقة الطبية إمّا أن تكون حارسًا أو لا تكون.
--   2) الفحص القائم يقبل *أيّ* مستند موافقة موقَّع للمريض ولو كان لإجراء آخر.
--      موافقة على خلع ضرس ليست موافقة على تخدير عام.
--   3) `patient_documents.signed_at` عمودٌ يُملأ يدويًّا بلا سجلّ **من وقّع**
--      ولا بأيّ صفة ولا بأيّ وسيلة. التوقيع بلا هوية موقِّع ليس توقيعًا.
--
-- ولا تُنشأ جداول مكرّرة: `patient_documents` و`employee_documents`
-- و`document_templates` و`generated_documents` و`patient_consents` كلّها قائمة
-- وتُوسَّع في مكانها. الجديد اثنان فقط: مستندات الكيانات الأخرى (أصول،
-- موردون، فواتير شراء…) وجدول التواقيع.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
--
-- ملاحظة تشغيلية: الملفات نفسها تبقى في حاوية Supabase Storage القائمة
-- `patient-documents` (المهاجرة 0037) — لا حاوية جديدة. سياستها تتحقّق أن
-- المستخدم عضوٌ في المنشأة التي يمثّلها أوّل جزء من المسار، فمستندات
-- الكيانات الأخرى تُكتب تحت `{organization_id}/entities/...` وتخضع للسياسة
-- نفسها. الجداول هنا تحفظ المسار لا الملف.
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0102_documents_and_signatures.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('documents.view',      'عرض المستندات',            'documents', 1500),
  ('documents.upload',    'رفع المستندات',            'documents', 1502),
  ('documents.archive',   'أرشفة المستندات',          'documents', 1504),
  ('documents.templates', 'إدارة قوالب المستندات',    'documents', 1506),
  ('consents.sign',       'تسجيل الموافقات والتواقيع','documents', 1508),
  ('consents.override',   'تجاوز الموافقة بمبرّر',    'documents', 1510)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **تجاوز الموافقة لا يُمنح افتراضيًّا لأحد**: هو استثناء طبّي مسؤول، لا إعداد.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'documents.view'), ('branch_manager', 'documents.upload'),
  ('branch_manager', 'documents.archive'), ('branch_manager', 'documents.templates'),
  ('branch_manager', 'consents.sign'),
  ('doctor',         'documents.view'), ('doctor', 'documents.upload'),
  ('doctor',         'consents.sign'),
  ('nurse',          'documents.view'), ('nurse', 'documents.upload'),
  ('nurse',          'consents.sign'),
  ('receptionist',   'documents.view'), ('receptionist', 'documents.upload'),
  ('receptionist',   'consents.sign'),
  ('hr_manager',     'documents.view'), ('hr_manager', 'documents.upload'),
  ('accountant',     'documents.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) توسعة مستندات المريض — بلا جدول جديد
-- ===========================================================================
alter table patient_documents
  add column if not exists branch_id uuid references branches(id),
  add column if not exists item_id uuid references items(id),
  add column if not exists template_id uuid references document_templates(id),
  add column if not exists generated_document_id uuid references generated_documents(id),
  add column if not exists document_number bigint,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  -- لا أعمدة إصدار/استبدال هنا: النظام لا يبني تسلسل نسخٍ للمستند، والبديل
  -- العملي القائم هو أرشفة القديم بسبب ورفع الجديد. عمودٌ يَعِد بتسلسلٍ لا
  -- يكتبه أحد أسوأ من غيابه.
  add column if not exists signed_by uuid references auth.users(id),
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archive_reason text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_patient_documents_patient
  on patient_documents (organization_id, patient_id, is_archived);
create index if not exists idx_patient_documents_item
  on patient_documents (organization_id, item_id) where is_consent;

alter table employee_documents
  add column if not exists branch_id uuid references branches(id),
  add column if not exists uploaded_by uuid references auth.users(id),
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archive_reason text;

-- ===========================================================================
-- 3) مستندات الكيانات الأخرى — أصول، موردون، فواتير، تراخيص
--    (شهادة معايرة الجهاز، ضمان، عقد مورّد، رخصة منشأة…)
-- ===========================================================================
create table if not exists entity_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  entity_type      text not null
                     check (entity_type in ('asset','asset_calibration','maintenance_order',
                                            'distributor','purchase_invoice','purchase_order',
                                            'insurance_company','organization','branch','other')),
  entity_id        uuid not null,
  category         text,
  title            text not null,
  storage_path     text not null,
  file_name        text,
  mime_type        text,
  file_size_bytes  bigint,
  issue_date       date,
  expires_at       date,
  note             text,
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  archived_by      uuid references auth.users(id),
  archive_reason   text,
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_entity_documents_entity
  on entity_documents (organization_id, entity_type, entity_id, is_archived);

alter table entity_documents enable row level security;

-- ===========================================================================
-- 4) التواقيع — من وقّع، بأيّ صفة، بأيّ وسيلة، ومتى
--    السجل **غير قابل للتعديل ولا للحذف**: توقيعٌ يُعدَّل ليس توقيعًا.
-- ===========================================================================
create table if not exists document_signatures (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  document_kind     text not null
                      check (document_kind in ('patient_document','entity_document',
                                               'generated_document')),
  document_id       uuid not null,
  signer_role       text not null
                      check (signer_role in ('patient','guardian','doctor','nurse',
                                             'witness','employee','other')),
  signer_name       text not null,
  signer_id_number  text,
  relation_to_patient text,
  signer_user_id    uuid references auth.users(id),
  signature_method  text not null default 'on_screen'
                      check (signature_method in ('on_screen','paper_scan','digital_certificate')),
  signature_path    text,
  signed_at         timestamptz not null default now(),
  note              text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

-- الصفة الواحدة لا توقّع المستند مرّتين
create unique index if not exists uq_signature_role_once
  on document_signatures (document_kind, document_id, signer_role);
create index if not exists idx_signatures_document
  on document_signatures (organization_id, document_kind, document_id);

alter table document_signatures enable row level security;

-- ===========================================================================
-- 5) تجاوز الموافقة — يُسجَّل على الخدمة نفسها بمبرّر ومن قرّره
-- ===========================================================================
alter table patient_visit_services
  add column if not exists consent_override_reason text,
  add column if not exists consent_overridden_by uuid references auth.users(id),
  add column if not exists consent_overridden_at timestamptz;

-- ===========================================================================
-- 6) الدوال
-- ===========================================================================

-- الهجرة قابلة لإعادة التشغيل: تغيّر بصمة الدالّة يترك نسخةً قديمة تتعارض
-- مع الجديدة عند الاستدعاء، فتُسقط كل النسخ السابقة بالاسم أولًا.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_register_patient_document','app_register_entity_document',
                         'app_sign_document','app_archive_document',
                         'app_render_document_template','app_service_consent_status')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

-- 6.1 تسجيل مستند مريض (بعد رفع الملف إلى التخزين)
create or replace function app_register_patient_document(
  p_patient_id  uuid,
  p_storage_path text,
  p_file_name   text,
  -- `category` قائمة مغلقة قائمة من قبل: نوع الملف (صورة/مستند). تصنيف
  -- الغرض مكانه `doc_type_value_id` في البيانات المرجعية، ولا يُكرَّر هنا.
  p_category    text default 'document',
  p_visit_id    uuid default null,
  p_item_id     uuid default null,
  p_is_consent  boolean default false,
  p_expires_at  date default null,
  p_mime_type   text default null,
  p_size_bytes  bigint default null,
  p_template_id uuid default null,
  p_generated_document_id uuid default null,
  p_doc_type_value_id uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_branch uuid;
  v_id     uuid;
  v_num    bigint;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح برفع المستندات (documents.upload)';
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'مسار الملف مطلوب — مستندٌ بلا ملف ليس مستندًا';
  end if;
  if coalesce(p_category, 'document') not in ('image','document') then
    raise exception 'نوع الملف غير معروف: % (المسموح: image أو document)', p_category;
  end if;
  if p_visit_id is not null then
    select branch_id into v_branch from patient_visits
     where id = p_visit_id and organization_id = v_org;
    if not found then raise exception 'الزيارة غير موجودة في هذه المنشأة'; end if;
  end if;
  if p_item_id is not null and not exists (
       select 1 from items where id = p_item_id and organization_id = v_org) then
    raise exception 'الخدمة غير موجودة في هذه المنشأة';
  end if;
  -- الموافقة المرتبطة بخدمة لا معنى لها إن لم تكن الخدمة تطلب موافقة
  if p_is_consent and p_item_id is not null and not exists (
       select 1 from items where id = p_item_id and requires_consent) then
    raise exception 'هذه الخدمة لا تتطلّب موافقة — لا تُربط بها موافقة';
  end if;

  v_num := app_next_document_number(v_org, 'patient_document', v_branch);

  insert into patient_documents (organization_id, branch_id, patient_id, visit_id, item_id,
                                 category, doc_type_value_id, storage_path, file_name,
                                 mime_type,
                                 file_size_bytes, note, expires_at, is_consent,
                                 template_id, generated_document_id, document_number,
                                 uploaded_by)
  values (v_org, v_branch, p_patient_id, p_visit_id, p_item_id,
          coalesce(p_category, 'document'), p_doc_type_value_id,
          trim(p_storage_path), p_file_name, p_mime_type,
          p_size_bytes, p_note, p_expires_at, coalesce(p_is_consent, false),
          p_template_id, p_generated_document_id, v_num, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, v_branch, auth.uid(), 'documents', 'add', v_id,
          case when p_is_consent then 'موافقة مريض' else 'مستند مريض' end,
          coalesce(p_file_name, p_storage_path));

  return v_id;
end $$;

-- 6.2 مستند كيان آخر
create or replace function app_register_entity_document(
  p_org         uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_title       text,
  p_storage_path text,
  p_file_name   text default null,
  p_category    text default null,
  p_branch_id   uuid default null,
  p_issue_date  date default null,
  p_expires_at  date default null,
  p_mime_type   text default null,
  p_size_bytes  bigint default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_ok boolean;
begin
  if not app_has_permission(p_org, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح برفع المستندات (documents.upload)';
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'مسار الملف مطلوب';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'عنوان المستند مطلوب';
  end if;

  -- **الكيان يجب أن يكون موجودًا في هذه المنشأة**: مستندٌ معلّق على معرّفٍ
  -- لا يقابله سجل هو مستندٌ لا يجده أحد.
  v_ok := case p_entity_type
    when 'asset' then exists (select 1 from assets
                               where id = p_entity_id and organization_id = p_org)
    when 'asset_calibration' then exists (select 1 from asset_calibrations
                               where id = p_entity_id and organization_id = p_org)
    when 'maintenance_order' then exists (select 1 from maintenance_orders
                               where id = p_entity_id and organization_id = p_org)
    when 'distributor' then exists (select 1 from distributors
                               where id = p_entity_id and organization_id = p_org)
    when 'purchase_invoice' then exists (select 1 from purchase_invoices
                               where id = p_entity_id and organization_id = p_org)
    when 'purchase_order' then exists (select 1 from purchase_orders
                               where id = p_entity_id and organization_id = p_org)
    when 'insurance_company' then exists (select 1 from insurance_companies
                               where id = p_entity_id and organization_id = p_org)
    when 'organization' then p_entity_id = p_org
    when 'branch' then exists (select 1 from branches
                               where id = p_entity_id and organization_id = p_org)
    else true
  end;
  if not v_ok then
    raise exception 'الكيان المرتبط بالمستند غير موجود في هذه المنشأة';
  end if;

  insert into entity_documents (organization_id, branch_id, entity_type, entity_id,
                                category, title, storage_path, file_name, mime_type,
                                file_size_bytes, issue_date, expires_at, note, uploaded_by)
  values (p_org, p_branch_id, p_entity_type, p_entity_id, p_category, trim(p_title),
          trim(p_storage_path), p_file_name, p_mime_type, p_size_bytes,
          p_issue_date, p_expires_at, p_note, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, p_branch_id, auth.uid(), 'documents', 'add', v_id, 'مستند كيان',
          format('%s — %s', p_entity_type, p_title));

  return v_id;
end $$;

-- 6.3 التوقيع
create or replace function app_sign_document(
  p_kind        text,
  p_document_id uuid,
  p_signer_role text,
  p_signer_name text,
  p_method      text default 'on_screen',
  p_signature_path text default null,
  p_signer_id_number text default null,
  p_relation    text default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_branch uuid;
  v_id     uuid;
  v_signed boolean;
begin
  if p_kind = 'patient_document' then
    select organization_id, branch_id, (signed_at is not null)
      into v_org, v_branch, v_signed
      from patient_documents where id = p_document_id for update;
  elsif p_kind = 'entity_document' then
    select organization_id, branch_id, false into v_org, v_branch, v_signed
      from entity_documents where id = p_document_id for update;
  elsif p_kind = 'generated_document' then
    select organization_id, null::uuid, false into v_org, v_branch, v_signed
      from generated_documents where id = p_document_id for update;
  else
    raise exception 'نوع مستند غير معروف: %', p_kind;
  end if;

  if v_org is null then raise exception 'المستند غير موجود'; end if;
  if not app_has_permission(v_org, 'consents.sign') then
    raise exception 'صلاحيتك لا تسمح بتسجيل التواقيع (consents.sign)';
  end if;
  if coalesce(trim(p_signer_name), '') = '' then
    raise exception 'اسم الموقِّع مطلوب — توقيعٌ بلا هوية موقِّع ليس توقيعًا';
  end if;
  -- التوقيع على الشاشة أو المسح الضوئي كلاهما يحتاج أثرًا محفوظًا
  if p_method in ('on_screen','paper_scan')
     and coalesce(trim(coalesce(p_signature_path, '')), '') = '' then
    raise exception 'صورة التوقيع مطلوبة لهذه الوسيلة';
  end if;
  if p_signer_role = 'guardian' and coalesce(trim(coalesce(p_relation, '')), '') = '' then
    raise exception 'صلة وليّ الأمر بالمريض مطلوبة';
  end if;

  insert into document_signatures (organization_id, branch_id, document_kind, document_id,
                                   signer_role, signer_name, signer_id_number,
                                   relation_to_patient, signer_user_id, signature_method,
                                   signature_path, note, created_by)
  values (v_org, v_branch, p_kind, p_document_id, p_signer_role, trim(p_signer_name),
          p_signer_id_number, p_relation,
          case when p_signer_role in ('doctor','nurse','employee') then auth.uid() end,
          p_method, p_signature_path, p_note, auth.uid())
  returning id into v_id;

  -- المستند يصير موقَّعًا عند أول توقيع، ويُسجَّل من ختمه
  if p_kind = 'patient_document' and not coalesce(v_signed, false) then
    update patient_documents
       set signed_at = now(), signed_by = auth.uid(), updated_at = now()
     where id = p_document_id;
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, v_branch, auth.uid(), 'documents', 'add', v_id, 'توقيع مستند',
          format('%s — %s', p_signer_role, p_signer_name));

  return v_id;
end $$;

-- 6.4 الأرشفة بدل الحذف
create or replace function app_archive_document(
  p_kind        text,
  p_document_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الأرشفة مطلوب';
  end if;
  if p_kind = 'patient_document' then
    select organization_id into v_org from patient_documents where id = p_document_id;
  elsif p_kind = 'entity_document' then
    select organization_id into v_org from entity_documents where id = p_document_id;
  elsif p_kind = 'employee_document' then
    select organization_id into v_org from employee_documents where id = p_document_id;
  else
    raise exception 'نوع مستند غير معروف: %', p_kind;
  end if;
  if v_org is null then raise exception 'المستند غير موجود'; end if;
  if not app_has_permission(v_org, 'documents.archive') then
    raise exception 'صلاحيتك لا تسمح بأرشفة المستندات (documents.archive)';
  end if;

  if p_kind = 'patient_document' then
    update patient_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason, updated_at = now()
     where id = p_document_id;
  elsif p_kind = 'entity_document' then
    update entity_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason, updated_at = now()
     where id = p_document_id;
  else
    update employee_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason
     where id = p_document_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_org, auth.uid(), 'documents', 'update', p_document_id, 'أرشفة مستند',
          p_kind, p_reason);
end $$;

-- 6.5 توليد مستند من قالب — بحقول حقيقية لا فراغات
create or replace function app_render_document_template(
  p_template_id uuid,
  p_patient_id  uuid default null,
  p_employee_id uuid default null,
  p_visit_id    uuid default null,
  p_extra       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t      document_templates%rowtype;
  v_body   text;
  v_vals   jsonb := coalesce(p_extra, '{}'::jsonb);
  v_id     uuid;
  v_key    text;
  v_left   text[];
  v_title  text;
begin
  select * into v_t from document_templates where id = p_template_id;
  if v_t.id is null then raise exception 'القالب غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح بتوليد المستندات (documents.upload)';
  end if;
  if v_t.is_disabled then
    raise exception 'القالب معطَّل — لا يُولَّد منه مستند';
  end if;

  -- الحقول المعروفة تُقرأ من السجلات الحقيقية
  v_vals := v_vals || jsonb_build_object(
    'organization_name', (select name from organizations where id = v_t.organization_id),
    'today', to_char(current_date, 'YYYY-MM-DD')
  );
  if p_patient_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'patient_name', coalesce(p.name_ar, ''),
        'file_number',  coalesce(p.file_number::text, ''),
        'national_id',  coalesce(p.id_number, ''),
        'phone',        coalesce(p.phone_1, ''))
      from patients p where p.id = p_patient_id
        and p.organization_id = v_t.organization_id);
  end if;
  if p_visit_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'visit_date',  to_char(v.visit_date, 'YYYY-MM-DD'),
        'doctor_name', coalesce(d.name_ar, ''),
        'branch_name', coalesce(b.name, ''))
      from patient_visits v
      left join doctors d on d.id = v.doctor_id
      left join branches b on b.id = v.branch_id
      where v.id = p_visit_id and v.organization_id = v_t.organization_id);
  end if;
  if p_employee_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'employee_name', coalesce(e.name_ar, ''),
        'employee_number', coalesce(e.job_number::text, ''))
      from employees e where e.id = p_employee_id
        and e.organization_id = v_t.organization_id);
  end if;

  v_body := coalesce(v_t.body_html, '');
  for v_key in select jsonb_object_keys(v_vals) loop
    v_body := replace(v_body, '{{' || v_key || '}}', coalesce(v_vals ->> v_key, ''));
  end loop;

  -- **لا مستند بفراغات**: أيّ حقل لم يُعبَّأ يوقف التوليد بدل أن يُطبع فارغًا
  select array_agg(distinct m[1]) into v_left
    from regexp_matches(v_body, '\{\{([a-zA-Z0-9_]+)\}\}', 'g') as m;
  if v_left is not null and array_length(v_left, 1) > 0 then
    raise exception 'حقول القالب لم تُعبَّأ: %', array_to_string(v_left, '، ');
  end if;

  v_title := coalesce(v_t.name_ar, 'مستند');
  insert into generated_documents (organization_id, template_id, template_name_snapshot,
                                   patient_id, employee_id, title, body_html,
                                   extra_fields, created_by)
  values (v_t.organization_id, v_t.id, v_t.name_ar, p_patient_id, p_employee_id,
          v_title, v_body, v_vals, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, auth.uid(), 'documents', 'add', v_id,
          'توليد مستند من قالب', v_title);

  return v_id;
end $$;

-- 6.6 حالة الموافقة لخدمة بعينها
create or replace function app_service_consent_status(
  p_visit_id uuid,
  p_item_id  uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_req     boolean;
  v_patient uuid;
  v_ok      int;
  v_expired int;
begin
  select requires_consent into v_req from items where id = p_item_id;
  if not coalesce(v_req, false) then return 'not_required'; end if;

  select patient_id into v_patient from patient_visits where id = p_visit_id;
  if v_patient is null then return 'missing'; end if;

  -- الموافقة المقبولة: موقَّعة، غير مؤرشفة، سارية، **وتخصّ هذا الإجراء**
  -- (مرتبطة بالخدمة نفسها، أو بهذه الزيارة تحديدًا)
  select count(*) into v_ok from patient_documents d
   where d.patient_id = v_patient and d.is_consent and not d.is_archived
     and d.signed_at is not null
     and (d.expires_at is null or d.expires_at >= current_date)
     and (d.item_id = p_item_id or (d.item_id is null and d.visit_id = p_visit_id));
  if v_ok > 0 then return 'signed'; end if;

  select count(*) into v_expired from patient_documents d
   where d.patient_id = v_patient and d.is_consent and not d.is_archived
     and d.signed_at is not null
     and d.expires_at is not null and d.expires_at < current_date
     and (d.item_id = p_item_id or (d.item_id is null and d.visit_id = p_visit_id));
  if v_expired > 0 then return 'expired'; end if;

  return 'missing';
end $$;

-- 6.7 الحارس: خدمة تحتاج موافقة لا تُنفَّذ بلا موافقة موقَّعة
create or replace function app_guard_service_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_name   text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('performed','invoiced','paid','claimed') then
    return new;
  end if;

  v_status := app_service_consent_status(new.visit_id, new.item_id);
  if v_status = 'not_required' or v_status = 'signed' then
    return new;
  end if;

  -- التجاوز ممكن، لكنه **قرارٌ موثَّق بمبرّر ومن صاحب صلاحية**، لا صمت
  if coalesce(trim(coalesce(new.consent_override_reason, '')), '') <> '' then
    if not app_has_permission(new.organization_id, 'consents.override') then
      raise exception 'صلاحيتك لا تسمح بتجاوز الموافقة (consents.override)';
    end if;
    new.consent_overridden_by := coalesce(new.consent_overridden_by, auth.uid());
    new.consent_overridden_at := coalesce(new.consent_overridden_at, now());
    return new;
  end if;

  select name_ar into v_name from items where id = new.item_id;
  raise exception 'لا يمكن تنفيذ «%» بلا موافقة موقَّعة (الحالة: %)',
    coalesce(v_name, 'الخدمة'),
    case when v_status = 'expired' then 'الموافقة منتهية' else 'لا توجد موافقة' end;
end $$;

drop trigger if exists trg_guard_service_consent on patient_visit_services;
create trigger trg_guard_service_consent
  before update on patient_visit_services
  for each row execute function app_guard_service_consent();

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================

-- 7.1 كل المستندات في مكان واحد
drop view if exists v_document_expiry_alerts;
drop view if exists v_documents;
create view v_documents
with (security_invoker = on) as
select
  d.id,
  d.organization_id,
  d.branch_id,
  'patient_document'::text as document_kind,
  'patient'::text          as entity_type,
  d.patient_id             as entity_id,
  p.name_ar                as entity_name,
  coalesce(dt.name_ar, case when d.is_consent then 'موافقة' else d.category end) as category,
  coalesce(d.file_name, d.storage_path) as title,
  d.storage_path,
  d.mime_type,
  d.file_size_bytes,
  d.expires_at,
  d.is_consent,
  d.signed_at,
  d.is_archived,
  d.uploaded_by,
  d.created_at,
  d.created_at::date       as report_date
from patient_documents d
join patients p on p.id = d.patient_id
left join lookup_values dt on dt.id = d.doc_type_value_id
union all
select
  e.id, e.organization_id, e.branch_id, 'employee_document', 'employee',
  e.employee_id, emp.name_ar,
  coalesce(rv.name_ar, 'general'),
  coalesce(e.document_number, 'مستند موظف'),
  e.storage_path, e.mime_type, e.file_size_bytes, e.expiry_date,
  false, null::timestamptz, e.is_archived, e.uploaded_by, e.created_at,
  e.created_at::date
from employee_documents e
join employees emp on emp.id = e.employee_id
left join lookup_values rv on rv.id = e.document_type_value_id
union all
select
  x.id, x.organization_id, x.branch_id, 'entity_document', x.entity_type,
  x.entity_id, null::text,
  coalesce(x.category, 'general'), x.title, x.storage_path, x.mime_type,
  x.file_size_bytes, x.expires_at, false, null::timestamptz, x.is_archived,
  x.uploaded_by, x.created_at, x.created_at::date
from entity_documents x;

comment on view v_documents is
  'كل مستندات المنشأة في منظور واحد: مرضى وموظفون وكيانات أخرى، بمسارها وصلاحيتها وحالتها.';

-- 7.2 تنبيهات انتهاء المستندات
drop view if exists v_document_expiry_alerts;
create view v_document_expiry_alerts
with (security_invoker = on) as
select
  v.id, v.organization_id, v.branch_id, v.document_kind, v.entity_type,
  v.entity_id, v.entity_name, v.title, v.expires_at,
  (v.expires_at - current_date) as days_left,
  case when v.expires_at < current_date then 'منتهٍ' else 'يقارب الانتهاء' end as urgency,
  v.expires_at as report_date
from v_documents v
where not v.is_archived
  and v.expires_at is not null
  and v.expires_at <= current_date + 60;

comment on view v_document_expiry_alerts is
  'المستندات المنتهية أو التي تقارب الانتهاء خلال 60 يومًا — لكل الكيانات.';

-- 7.3 الموافقات المعلّقة — بدقّة الإجراء لا بوجود أيّ ورقة
drop view if exists v_pending_consents;
create view v_pending_consents
with (security_invoker = on) as
select
  s.id                as visit_service_id,
  s.organization_id,
  v.branch_id,
  v.id                as visit_id,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  s.item_id,
  i.name_ar           as item_name,
  i.consent_note_ar,
  v.visit_date,
  s.status,
  app_service_consent_status(v.id, s.item_id) as consent_status,
  (app_service_consent_status(v.id, s.item_id) = 'signed') as has_signed_consent,
  s.consent_override_reason,
  s.consent_overridden_by,
  v.visit_date        as report_date
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
where i.requires_consent
  and s.status in ('draft','ordered','performed');

comment on view v_pending_consents is
  'الخدمات التي تحتاج موافقة وحالتها الحقيقية لكل إجراء على حدة — لا يكفي وجود أيّ موافقة سابقة للمريض.';

-- 7.4 تواقيع المستندات
drop view if exists v_document_signatures;
create view v_document_signatures
with (security_invoker = on) as
select
  g.id, g.organization_id, g.branch_id, g.document_kind, g.document_id,
  g.signer_role, g.signer_name, g.signer_id_number, g.relation_to_patient,
  g.signature_method, g.signature_path, g.signed_at,
  g.signed_at::date as report_date
from document_signatures g;

grant select on v_documents, v_document_expiry_alerts, v_pending_consents,
                v_document_signatures to authenticated;

-- ===========================================================================
-- 8) RLS ومنع الحذف
-- ===========================================================================
do $$
declare r record; pol record;
begin
  for r in select unnest(array['entity_documents','document_signatures']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t);
    execute format($f$
      create policy %1$I_insert on %1$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t);
  end loop;
end $$;

-- التعديل على الجداول التي تُدار بالدوال فقط
do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'entity_documents' and policyname = 'entity_documents_update') then
    create policy entity_documents_update on entity_documents for update to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
end $$;

-- **التوقيع لا يُعدَّل ولا يُحذف، والمستند لا يُحذف**
create or replace function app_block_document_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'المستندات والتواقيع لا تُحذف — استخدم الأرشفة بسبب موثَّق';
end $$;

create or replace function app_block_signature_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'التوقيع لا يُعدَّل — توقيعٌ يُعدَّل ليس توقيعًا';
end $$;

do $$
declare r record;
begin
  for r in select unnest(array['patient_documents','employee_documents',
                               'entity_documents','document_signatures',
                               'generated_documents']) as t
  loop
    execute format('drop trigger if exists trg_block_delete_%1$s on %1$I', r.t);
    execute format($f$
      create trigger trg_block_delete_%1$s before delete on %1$I
        for each row execute function app_block_document_delete()
    $f$, r.t);
  end loop;
end $$;

drop trigger if exists trg_block_signature_update on document_signatures;
create trigger trg_block_signature_update
  before update on document_signatures
  for each row execute function app_block_signature_update();

-- ===========================================================================
-- 9) الميزة في كتالوج المزايا
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'documents', 'المستندات والموافقات', 'Documents & Consents', 'الإدارة', false, 276
where not exists (select 1 from feature_catalog where feature_key = 'documents');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'documents', true from organizations o
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
  if v_src is not null and position('''documents''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''', '''audit_log'',''settings'',''documents''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة المستندات في مزايا المنشأة الافتراضية';
    end if;
    execute v_new;
  end if;
end $$;

-- ===========================================================================
-- 10) حجب الدوال الجديدة عن الزوّار
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_register_patient_document','app_register_entity_document',
                         'app_sign_document','app_archive_document',
                         'app_render_document_template','app_service_consent_status',
                         'app_guard_service_consent')
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
  foreach v_v in array array['app_register_patient_document','app_register_entity_document',
                             'app_sign_document','app_archive_document',
                             'app_render_document_template','app_service_consent_status']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المستندات % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_service_consent') then
    raise exception 'حارس الموافقة غير مركَّب — الخدمة تُنفَّذ بلا موافقة';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_signature_role_once') then
    raise exception 'الصفة الواحدة تستطيع التوقيع مرّتين';
  end if;

  foreach v_v in array array['v_documents','v_document_expiry_alerts',
                             'v_pending_consents','v_document_signatures']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'المنظور % بلا security_invoker — يتجاوز عزل المنشآت', v_v;
    end if;
  end loop;
end $$;


-- ==========================================================================
-- [3/12]  0103_notifications.sql
--          التنبيهات الداخلية
-- ==========================================================================

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


-- ==========================================================================
-- [4/12]  0104_patient_portal.sql
--          بوابة المريض
-- ==========================================================================

-- ============================================================================
-- 0104 — المرحلة 24: بوابة المريض
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة**: لا رمز تحقّق برسالة، ولا
-- دعوة برسالة، ولا أيّ تكامل مزوّد. ربط حساب المريض ببوابته **يتمّ يدويًّا
-- من موظف بعد التحقّق من هويته** — وهو الضبط الصحيح أمنيًّا على أيّ حال:
-- من يربط الحساب يتحمّل مسؤولية التحقّق، ولا يُفتح ملفٌ طبيّ برسالة تصل
-- إلى رقمٍ قد يكون خاطئًا.
--
-- المبادئ الحاكمة هنا، وكلها مطبَّقة في القاعدة لا في الواجهة:
--
--   1) **المريض ليس عضوًا في المنشأة.** كل سياسات النظام مبنية على
--      `app_is_member`، فالمريض لا يرى شيئًا افتراضيًّا. ما يراه يُفتح له
--      سطرًا سطرًا بسياسات ضيّقة، لا بمنحه عضوية.
--   2) **النتيجة غير المعتمدة لا تُعرض.** تحليلٌ قيد المراجعة يصل المريض
--      فيفزعه أو يطمئنه بلا وجه حقّ — يُعرض ما اعتُمد فقط.
--   3) **المريض لا يحجز موعدًا بنفسه في التقويم**، بل يقدّم طلبًا يراجعه
--      الاستقبال. سماح المريض بالكتابة مباشرة في `appointments` يعني
--      احتلال فترات الأطباء من الخارج.
--   4) **بيانات الهوية لا تُعدَّل ذاتيًّا**: طلب تعديل يراجعه موظف. رقم
--      الهوية والاسم أساس مطابقة الملف والتأمين.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات (للموظفين — المريض لا يملك صلاحيات نظام)
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0104_patient_portal.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('patient_portal.view', 'عرض بوابة المرضى',    'portal', 1698),
  ('portal.manage',  'ربط حسابات بوابة المرضى', 'portal', 1700),
  ('portal.requests','مراجعة طلبات المرضى',      'portal', 1702)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'patient_portal.view'),
  ('branch_manager', 'portal.manage'), ('branch_manager', 'portal.requests'),
  ('receptionist',   'patient_portal.view'), ('receptionist', 'portal.requests')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) حسابات البوابة
-- ===========================================================================
create table if not exists patient_portal_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'active'
                    check (status in ('active','suspended','revoked')),
  linked_by       uuid references auth.users(id),
  linked_at       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id),
  revoke_reason   text,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- حسابٌ واحد لكل مريض، ومستخدمٌ واحد لا يمثّل مريضين في المنشأة نفسها
create unique index if not exists uq_portal_account_patient
  on patient_portal_accounts (organization_id, patient_id);
create unique index if not exists uq_portal_account_user
  on patient_portal_accounts (organization_id, user_id);

alter table patient_portal_accounts enable row level security;

-- ===========================================================================
-- 3) طلبات المواعيد وطلبات تعديل البيانات
-- ===========================================================================
create table if not exists appointment_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  patient_id      uuid not null references patients(id) on delete cascade,
  clinic_id       uuid references clinics(id),
  doctor_id       uuid references doctors(id),
  preferred_date  date,
  preferred_period text check (preferred_period in ('morning','evening','any')),
  reason          text,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected','cancelled')),
  appointment_id  uuid references appointments(id),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  source          text not null default 'portal',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_appointment_requests_pending
  on appointment_requests (organization_id, status, preferred_date);

alter table appointment_requests enable row level security;

create table if not exists patient_change_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  field_key       text not null
                    check (field_key in ('phone_1','phone_2','email_1','email_2',
                                        'address','emergency_number')),
  current_value   text,
  requested_value text not null,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);

alter table patient_change_requests enable row level security;

-- ===========================================================================
-- 4) دوال الهوية — من هو المريض صاحب هذه الجلسة؟
-- ===========================================================================
create or replace function app_portal_patient_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.patient_id from patient_portal_accounts a
   where a.organization_id = p_org
     and a.user_id = auth.uid()
     and a.status = 'active';
$$;

-- الاستعمال داخل السياسات: هل هذا الصفّ يخصّ المريض صاحب الجلسة؟
create or replace function app_is_portal_patient(p_org uuid, p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_patient_id is not null and exists (
    select 1 from patient_portal_accounts a
     where a.organization_id = p_org
       and a.user_id = auth.uid()
       and a.patient_id = p_patient_id
       and a.status = 'active'
  );
$$;

-- ===========================================================================
-- 5) دوال الموظفين: الربط والإلغاء
-- ===========================================================================
create or replace function app_link_patient_portal_account(
  p_patient_id uuid,
  p_email      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_user uuid;
  v_id   uuid;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.manage') then
    raise exception 'صلاحيتك لا تسمح بربط حسابات البوابة (portal.manage)';
  end if;

  -- **لا يُنشأ حساب من هنا ولا تُلمس كلمة مرور**: المريض يسجّل بنفسه،
  -- والموظف يربط الحساب القائم بملفه بعد التحقّق من هويته.
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'لا يوجد حساب بهذا البريد — يسجّل المريض بنفسه أولًا ثم يُربط ملفه';
  end if;

  if exists (select 1 from organization_memberships m
              where m.organization_id = v_org and m.user_id = v_user) then
    raise exception 'هذا الحساب موظف في المنشأة — لا يُربط كحساب مريض';
  end if;

  insert into patient_portal_accounts (organization_id, patient_id, user_id, linked_by)
  values (v_org, p_patient_id, v_user, auth.uid())
  on conflict (organization_id, patient_id) do update
    set user_id = excluded.user_id, status = 'active',
        linked_by = auth.uid(), linked_at = now(),
        revoked_at = null, revoked_by = null, revoke_reason = null,
        updated_at = now()
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'portal', 'add', v_id, 'ربط حساب بوابة مريض', p_email);

  return v_id;
end $$;

create or replace function app_revoke_patient_portal_access(
  p_account_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  select organization_id into v_org from patient_portal_accounts where id = p_account_id;
  if v_org is null then raise exception 'الحساب غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.manage') then
    raise exception 'صلاحيتك لا تسمح بإلغاء حسابات البوابة (portal.manage)';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب إلغاء الوصول مطلوب';
  end if;

  update patient_portal_accounts
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = p_reason, updated_at = now()
   where id = p_account_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_org, auth.uid(), 'portal', 'update', p_account_id,
          'إلغاء وصول بوابة مريض', null, p_reason);
end $$;

-- ===========================================================================
-- 6) دوال المريض نفسه
-- ===========================================================================
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
declare v_patient uuid; v_id uuid; v_open int;
begin
  v_patient := app_portal_patient_id(p_org);
  if v_patient is null then
    raise exception 'لا يوجد حساب بوابة نشط لهذه المنشأة';
  end if;
  if p_date is not null and p_date < current_date then
    raise exception 'لا يُطلب موعد في تاريخ ماضٍ';
  end if;

  -- **حدّ للطلبات المفتوحة**: بابٌ مفتوح للطلبات بلا حدّ يُغرق الاستقبال
  select count(*) into v_open from appointment_requests
   where organization_id = p_org and patient_id = v_patient and status = 'pending';
  if v_open >= 3 then
    raise exception 'لديك 3 طلبات مواعيد قيد المراجعة — انتظر ردّ الاستقبال';
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
declare a appointments%rowtype;
begin
  select * into a from appointments where id = p_appointment_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_is_portal_patient(a.organization_id, a.patient_id) then
    raise exception 'هذا الموعد ليس لك';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الإلغاء مطلوب';
  end if;
  -- الموعد المنقضي أو الذي حضره المريض لا يُلغى من البوابة
  if a.scheduled_start < now() then
    raise exception 'لا يُلغى موعد مضى وقته — اتصل بالاستقبال';
  end if;
  -- الحالات التي يُقبل الإلغاء منها فقط؛ وما بعد الوصول يُدار من الاستقبال
  if a.status not in ('new','scheduled','unconfirmed','confirmed') then
    raise exception 'حالة الموعد (%) لا تسمح بالإلغاء من البوابة', a.status;
  end if;

  update appointments
     -- **الإلغاء من المريض له حالته الخاصة**: التمييز بين إلغاء المريض
     -- وإلغاء المنشأة أساسٌ لتقارير عدم الحضور ومحاسبة الفترات الضائعة.
     set status = 'cancelled_by_patient',
         cancellation_reason = format('إلغاء من بوابة المريض: %s', p_reason),
         updated_at = now()
   where id = p_appointment_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (a.organization_id, a.branch_id, auth.uid(), 'portal', 'update',
          p_appointment_id, 'إلغاء موعد من البوابة', null, p_reason);
end $$;

create or replace function app_portal_request_change(
  p_org   uuid,
  p_field text,
  p_value text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_patient uuid; v_id uuid; v_current text;
begin
  v_patient := app_portal_patient_id(p_org);
  if v_patient is null then
    raise exception 'لا يوجد حساب بوابة نشط لهذه المنشأة';
  end if;
  if coalesce(trim(coalesce(p_value, '')), '') = '' then
    raise exception 'القيمة المطلوبة مطلوبة';
  end if;

  select case p_field
           when 'phone_1' then phone_1
           when 'phone_2' then phone_2
           when 'email_1' then email_1
           when 'email_2' then email_2
           when 'address' then address
           when 'emergency_number' then emergency_number
           else null end
    into v_current
    from patients where id = v_patient;

  insert into patient_change_requests (organization_id, patient_id, field_key,
                                       current_value, requested_value)
  values (p_org, v_patient, p_field, v_current, trim(p_value))
  returning id into v_id;

  return v_id;
end $$;

create or replace function app_portal_touch(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update patient_portal_accounts
     set last_seen_at = now(), updated_at = now()
   where organization_id = p_org and user_id = auth.uid() and status = 'active';
end $$;

-- ===========================================================================
-- 7) دوال مراجعة الطلبات (موظفون)
-- ===========================================================================
create or replace function app_approve_appointment_request(
  p_request_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_doctor_id  uuid default null,
  p_clinic_id  uuid default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r appointment_requests%rowtype; v_appt uuid; v_branch uuid;
begin
  select * into r from appointment_requests where id = p_request_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(r.organization_id, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if r.status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', r.status;
  end if;
  if p_end <= p_start then
    raise exception 'نهاية الموعد يجب أن تكون بعد بدايته';
  end if;

  select branch_id into v_branch from clinics
   where id = coalesce(p_clinic_id, r.clinic_id);

  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status, note, created_by)
  values (r.organization_id, v_branch, coalesce(p_clinic_id, r.clinic_id),
          coalesce(p_doctor_id, r.doctor_id), r.patient_id, p_start, p_end,
          'scheduled', coalesce(p_note, r.reason), auth.uid())
  returning id into v_appt;

  update appointment_requests
     set status = 'approved', appointment_id = v_appt, decided_by = auth.uid(),
         decided_at = now(), decision_note = p_note, updated_at = now()
   where id = p_request_id;

  return v_appt;
end $$;

create or replace function app_reject_appointment_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_status text;
begin
  select organization_id, status into v_org, v_status
    from appointment_requests where id = p_request_id for update;
  if v_org is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if v_status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', v_status;
  end if;
  -- **الرفض بلا سبب لا يفيد المريض**: يظهر له السبب في بوابته
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  update appointment_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_reason, updated_at = now()
   where id = p_request_id;
end $$;

create or replace function app_decide_patient_change_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r patient_change_requests%rowtype;
begin
  select * into r from patient_change_requests where id = p_request_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(r.organization_id, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if r.status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', r.status;
  end if;
  if not p_approve and coalesce(trim(coalesce(p_note, '')), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  if p_approve then
    -- التعديل يُطبَّق بعد المراجعة، لا قبلها
    if r.field_key = 'phone_1' then
      update patients set phone_1 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'phone_2' then
      update patients set phone_2 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'email_1' then
      update patients set email_1 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'email_2' then
      update patients set email_2 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'address' then
      update patients set address = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'emergency_number' then
      update patients set emergency_number = r.requested_value, updated_at = now()
       where id = r.patient_id;
    end if;
  end if;

  update patient_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_request_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (r.organization_id, auth.uid(), 'portal', 'update', r.patient_id,
          'مراجعة طلب تعديل بيانات',
          format('%s ← %s (%s)', r.field_key, r.requested_value,
                 case when p_approve then 'اعتُمد' else 'رُفض' end));
end $$;

-- ===========================================================================
-- 8) سياسات البوابة — ضيّقة، صفًّا صفًّا
--    كل سياسة هنا تُضاف إلى سياسات الأعضاء القائمة ولا تمسّها.
-- ===========================================================================
do $$
begin
  -- حساب البوابة: الموظف يديره، والمريض يرى حسابه هو
  if not exists (select 1 from pg_policies where tablename = 'patient_portal_accounts'
                  and policyname = 'portal_accounts_staff') then
    create policy portal_accounts_staff on patient_portal_accounts for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_portal_accounts'
                  and policyname = 'portal_accounts_own') then
    create policy portal_accounts_own on patient_portal_accounts for select to authenticated
      using (user_id = auth.uid());
  end if;

  -- ملفّه هو، لا غير
  if not exists (select 1 from pg_policies where tablename = 'patients'
                  and policyname = 'patients_portal_self') then
    create policy patients_portal_self on patients for select to authenticated
      using (app_is_portal_patient(organization_id, id));
  end if;

  -- مواعيده
  if not exists (select 1 from pg_policies where tablename = 'appointments'
                  and policyname = 'appointments_portal_self') then
    create policy appointments_portal_self on appointments for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;

  -- زياراته
  if not exists (select 1 from pg_policies where tablename = 'patient_visits'
                  and policyname = 'visits_portal_self') then
    create policy visits_portal_self on patient_visits for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;

  -- **نتائج المختبر المعتمدة فقط**
  if not exists (select 1 from pg_policies where tablename = 'lab_orders'
                  and policyname = 'lab_orders_portal_self') then
    create policy lab_orders_portal_self on lab_orders for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and status in ('approved','delivered'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lab_order_items'
                  and policyname = 'lab_items_portal_self') then
    create policy lab_items_portal_self on lab_order_items for select to authenticated
      using (exists (select 1 from lab_orders o
                      where o.id = lab_order_id
                        and app_is_portal_patient(o.organization_id, o.patient_id)
                        and o.status in ('approved','delivered')));
  end if;

  -- **تقارير الأشعة المعتمدة فقط**
  if not exists (select 1 from pg_policies where tablename = 'radiology_orders'
                  and policyname = 'radiology_portal_self') then
    create policy radiology_portal_self on radiology_orders for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and status in ('verified','delivered'));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'radiology_order_items'
                  and policyname = 'radiology_items_portal_self') then
    create policy radiology_items_portal_self on radiology_order_items for select to authenticated
      using (exists (select 1 from radiology_orders o
                      where o.id = radiology_order_id
                        and app_is_portal_patient(o.organization_id, o.patient_id)
                        and o.status in ('verified','delivered')));
  end if;

  -- وصفاته
  if not exists (select 1 from pg_policies where tablename = 'prescriptions'
                  and policyname = 'prescriptions_portal_self') then
    create policy prescriptions_portal_self on prescriptions for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prescription_items'
                  and policyname = 'prescription_items_portal_self') then
    create policy prescription_items_portal_self on prescription_items for select to authenticated
      using (exists (select 1 from prescriptions p
                      where p.id = prescription_id
                        and app_is_portal_patient(p.organization_id, p.patient_id)));
  end if;

  -- فواتيره
  if not exists (select 1 from pg_policies where tablename = 'sales_invoices'
                  and policyname = 'invoices_portal_self') then
    create policy invoices_portal_self on sales_invoices for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sales_invoice_items'
                  and policyname = 'invoice_items_portal_self') then
    create policy invoice_items_portal_self on sales_invoice_items for select to authenticated
      using (exists (select 1 from sales_invoices i
                      where i.id = invoice_id
                        and app_is_portal_patient(i.organization_id, i.patient_id)));
  end if;

  -- مستنداته غير المؤرشفة
  if not exists (select 1 from pg_policies where tablename = 'patient_documents'
                  and policyname = 'documents_portal_self') then
    create policy documents_portal_self on patient_documents for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and not coalesce(is_archived, false));
  end if;

  -- طلباته
  if not exists (select 1 from pg_policies where tablename = 'appointment_requests'
                  and policyname = 'appt_requests_staff') then
    create policy appt_requests_staff on appointment_requests for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'appointment_requests'
                  and policyname = 'appt_requests_portal_self') then
    create policy appt_requests_portal_self on appointment_requests for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_change_requests'
                  and policyname = 'change_requests_staff') then
    create policy change_requests_staff on patient_change_requests for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_change_requests'
                  and policyname = 'change_requests_portal_self') then
    create policy change_requests_portal_self on patient_change_requests for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
end $$;

-- ===========================================================================
-- 9) مناظير البوابة — security_invoker فتسري عليها السياسات أعلاه
-- ===========================================================================
drop view if exists v_portal_appointments;
create view v_portal_appointments
with (security_invoker = on) as
select
  a.id, a.organization_id, a.branch_id, a.patient_id,
  a.scheduled_start, a.scheduled_end, a.status,
  c.name    as clinic_name,
  d.name_ar as doctor_name,
  (a.scheduled_start > now()) as is_upcoming,
  a.scheduled_start::date as report_date
from appointments a
left join clinics c on c.id = a.clinic_id
left join doctors d on d.id = a.doctor_id;

drop view if exists v_portal_results;
create view v_portal_results
with (security_invoker = on) as
select
  o.id, o.organization_id, o.patient_id, 'lab'::text as result_kind,
  t.name_ar        as test_name,
  i.result_value,
  i.unit_override  as unit,
  i.reference_text,
  i.is_abnormal,
  o.status,
  coalesce(i.entered_at, o.created_at) as resulted_at,
  coalesce(i.entered_at, o.created_at)::date as report_date
from lab_orders o
join lab_order_items i on i.lab_order_id = o.id
left join lab_tests t on t.id = i.lab_test_id
union all
select
  r.id, r.organization_id, r.patient_id, 'radiology',
  ex.name_ar,
  -- **الانطباع المعتمد فقط**: السياسة تمنع ظهور الطلب قبل اعتماده أصلًا
  ri.impression,
  null, null, null, r.status,
  coalesce(r.reported_at, r.ordered_at),
  coalesce(r.reported_at, r.ordered_at)::date
from radiology_orders r
left join radiology_order_items ri on ri.radiology_order_id = r.id
left join radiology_exams ex on ex.id = ri.radiology_exam_id;

comment on view v_portal_results is
  'نتائج المريض المعتمدة فقط — السياسات تمنع ظهور ما لم يُعتمد بعد.';

drop view if exists v_portal_invoices;
create view v_portal_invoices
with (security_invoker = on) as
select
  i.id, i.organization_id, i.branch_id, i.patient_id,
  i.invoice_number, i.invoice_type, i.status,
  i.net_amount, i.paid_amount, i.remaining_amount,
  i.created_at,
  i.created_at::date as report_date
from sales_invoices i;

drop view if exists v_portal_documents;
create view v_portal_documents
with (security_invoker = on) as
select
  d.id, d.organization_id, d.patient_id, d.file_name, d.storage_path,
  d.category, d.is_consent, d.signed_at, d.expires_at, d.created_at,
  d.created_at::date as report_date
from patient_documents d
where not coalesce(d.is_archived, false);

-- منظور الموظفين: الطلبات المعلّقة
drop view if exists v_pending_patient_requests;
create view v_pending_patient_requests
with (security_invoker = on) as
select
  r.id, r.organization_id, r.branch_id, 'appointment'::text as request_kind,
  r.patient_id, p.name_ar as patient_name, p.file_number,
  coalesce(r.reason, '')      as details,
  r.preferred_date::text      as requested_value,
  r.status, r.created_at, r.created_at::date as report_date
from appointment_requests r
join patients p on p.id = r.patient_id
where r.status = 'pending'
union all
select
  c.id, c.organization_id, null::uuid, 'contact_change',
  c.patient_id, p.name_ar, p.file_number,
  c.field_key, c.requested_value, c.status, c.created_at, c.created_at::date
from patient_change_requests c
join patients p on p.id = c.patient_id
where c.status = 'pending';

grant select on v_portal_appointments, v_portal_results, v_portal_invoices,
                v_portal_documents, v_pending_patient_requests to authenticated;

-- ===========================================================================
-- 10) الميزة وحجب الدوال
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'patient_portal', 'بوابة المريض', 'Patient Portal', 'الاستقبال والمواعيد', false, 46
where not exists (select 1 from feature_catalog where feature_key = 'patient_portal');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'patient_portal', true from organizations o
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
  if v_src is not null and position('''patient_portal''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''',
                            '''audit_log'',''settings'',''patient_portal''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة بوابة المريض في مزايا المنشأة الافتراضية';
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
       and p.proname in ('app_portal_patient_id','app_is_portal_patient',
                         'app_link_patient_portal_account','app_revoke_patient_portal_access',
                         'app_portal_request_appointment','app_portal_cancel_appointment',
                         'app_portal_request_change','app_portal_touch',
                         'app_approve_appointment_request','app_reject_appointment_request',
                         'app_decide_patient_change_request')
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
  foreach v_v in array array['app_portal_patient_id','app_is_portal_patient',
                             'app_link_patient_portal_account','app_portal_request_appointment',
                             'app_portal_cancel_appointment','app_approve_appointment_request']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة البوابة % غير موجودة', v_v;
    end if;
  end loop;

  -- **المريض لا يكتب في التقويم**: لا سياسة إدراج/تعديل للبوابة على المواعيد
  if exists (
    select 1 from pg_policies
     where tablename = 'appointments' and cmd in ('INSERT','UPDATE','ALL')
       and qual like '%app_is_portal_patient%')
  then
    raise exception 'المريض يستطيع الكتابة في جدول المواعيد — ممنوع';
  end if;

  -- النتيجة غير المعتمدة محجوبة بالسياسة نفسها
  if not exists (
    select 1 from pg_policies
     where tablename = 'lab_orders' and policyname = 'lab_orders_portal_self'
       and qual like '%approved%')
  then
    raise exception 'سياسة المختبر لا تقصر العرض على النتائج المعتمدة';
  end if;

  foreach v_v in array array['v_portal_appointments','v_portal_results','v_portal_invoices',
                             'v_portal_documents','v_pending_patient_requests']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'منظور البوابة % بلا security_invoker — يتجاوز السياسات', v_v;
    end if;
  end loop;
end $$;


-- ==========================================================================
-- [5/12]  0105_doctor_workspace.sql
--          مساحة الطبيب والنتائج الحرجة
-- ==========================================================================

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


-- ==========================================================================
-- [6/12]  0106_quality.sql
--          الجودة والحوادث
-- ==========================================================================

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


-- ==========================================================================
-- [7/12]  0107_organization_policies.sql
--          سياسات المنشأة
-- ==========================================================================

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


-- ==========================================================================
-- [8/12]  0108_users_and_permissions.sql
--          المستخدمون والصلاحيات
-- ==========================================================================

-- ============================================================================
-- 0108 — المرحلة 28: المستخدمون والصلاحيات
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- النظام يملك منذ البداية آليّة صلاحيات محكمة (`app_has_permission`: المالك
-- والأدمن كل شيء، ثم منحٌ أو منعٌ صريح للعضو، ثم افتراضات دوره). لكن ينقصها
-- ثلاثة أشياء تجعلها قابلة للحوكمة لا للاستعمال فقط:
--
--   1) **لا أحد يستطيع أن يرى ما يستطيعه مستخدمٌ فعلًا.** المنطق موزَّع على
--      ثلاث طبقات، ولا منظور يجمعها. مديرٌ لا يعرف من يملك ماذا لا يستطيع
--      ضبط شيء، وأيّ مراجعة اعتماد تبدأ بهذا السؤال بالذات.
--
--   2) **لا حماية من قفل المنشأة على نفسها.** تعطيل آخر مالكٍ نشط أو تغيير
--      دوره ممكن اليوم، وبعدها لا يبقى في المنشأة من يستطيع إعادة تعيين أحد.
--      خطأٌ من نقرةٍ واحدة لا رجعة فيه إلا من قاعدة البيانات مباشرة.
--
--   3) **لا مانع من ترقية النفس.** عضوٌ يملك إدارة المستخدمين يستطيع اليوم
--      أن يمنح نفسه أيّ صلاحية. الفصل بين من يَمنح ومن يُمنَح أساسٌ رقابيّ:
--      من أراد صلاحيةً جديدة يطلبها من غيره، ويبقى الطلب في سجلّ.
--
-- وزيادةً على ذلك: منظور **تعارض المهام** — من يملك طرفَي عمليةٍ واحدة
-- (يُنشئ ويعتمد، يُصدر ويُلغي). النظام يمنع التنفيذ المزدوج وقت العمل،
-- لكن وجود التعارض أصلًا ملاحظةٌ تُرفع للإدارة قبل أن تُستعمل.
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0108_users_and_permissions.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('users.view',        'عرض المستخدمين',        'users', 2100),
  ('users.manage',      'إدارة الأعضاء وأدوارهم','users', 2102),
  ('users.permissions', 'منح الصلاحيات ومنعها',  'users', 2104)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select 'branch_manager', 'users.view'
where not exists (select 1 from role_default_permissions
                   where role_key = 'branch_manager' and permission_key = 'users.view');

-- ===========================================================================
-- 2) **حماية آخر مالك**: لا تُقفل المنشأة على نفسها
-- ===========================================================================
create or replace function app_guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_user uuid; v_was_owner boolean; v_remaining int;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_user := old.user_id;
    v_was_owner := old.role_key = 'owner' and old.is_active;
  else
    v_org := new.organization_id; v_user := new.user_id;
    -- يهمّنا فقدان صفة المالك: بالتعطيل أو بتغيير الدور
    v_was_owner := old.role_key = 'owner' and old.is_active
                   and (new.role_key <> 'owner' or not new.is_active);
  end if;

  if not coalesce(v_was_owner, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into v_remaining
    from organization_memberships m
   where m.organization_id = v_org
     and m.role_key = 'owner'
     and m.is_active
     and m.user_id <> v_user;

  if v_remaining = 0 then
    raise exception 'لا يمكن إزالة آخر مالك للمنشأة — عيّن مالكًا آخر أولًا';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_last_owner on organization_memberships;
create trigger trg_guard_last_owner
  before update or delete on organization_memberships
  for each row execute function app_guard_last_owner();

-- ===========================================================================
-- 3) **لا ترقية للنفس**: من يَمنح غير من يُمنَح
-- ===========================================================================
create or replace function app_guard_self_privilege()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid; v_role_changed boolean := false;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;   -- ترحيل/نظام
  end if;

  if tg_table_name = 'membership_permissions' then
    v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    if v_user = auth.uid() then
      raise exception 'لا تُعدَّل صلاحياتك بنفسك — اطلبها من مسؤولٍ آخر';
    end if;
  else
    if tg_op = 'UPDATE' then
      v_role_changed := new.role_key is distinct from old.role_key;
      if v_role_changed and new.user_id = auth.uid() then
        raise exception 'لا تُغيّر دورك بنفسك — اطلبه من مسؤولٍ آخر';
      end if;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_self_permissions on membership_permissions;
create trigger trg_guard_self_permissions
  before insert or update or delete on membership_permissions
  for each row execute function app_guard_self_privilege();

drop trigger if exists trg_guard_self_role on organization_memberships;
create trigger trg_guard_self_role
  before update on organization_memberships
  for each row execute function app_guard_self_privilege();

-- ===========================================================================
-- 4) الدوال التشغيلية — كلها موثَّقة في سجل التدقيق
-- ===========================================================================
create or replace function app_set_membership_role(
  p_org      uuid,
  p_user_id  uuid,
  p_role_key text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old text;
begin
  if not app_has_permission(p_org, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  select role_key into v_old from organization_memberships
   where organization_id = p_org and user_id = p_user_id;
  if v_old is null then raise exception 'العضو غير موجود في هذه المنشأة'; end if;
  if v_old = p_role_key then return; end if;

  update organization_memberships
     set role_key = p_role_key
   where organization_id = p_org and user_id = p_user_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id, 'تغيير دور عضو',
          format('%s ← %s', v_old, p_role_key), p_reason);
end $$;

create or replace function app_set_member_active(
  p_org     uuid,
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأعضاء (users.manage)';
  end if;
  -- **تعطيل عضو قرارٌ يُعلَّل**: يقطع وصوله لسجلات المرضى فورًا
  if not p_active and coalesce(trim(coalesce(p_reason, '')), '') = '' then
    raise exception 'سبب التعطيل مطلوب';
  end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'لا تُعطّل عضويتك بنفسك';
  end if;

  update organization_memberships
     set is_active = p_active
   where organization_id = p_org and user_id = p_user_id;
  if not found then raise exception 'العضو غير موجود في هذه المنشأة'; end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          case when p_active then 'تفعيل عضو' else 'تعطيل عضو' end, null, p_reason);
end $$;

create or replace function app_set_member_permission(
  p_org        uuid,
  p_user_id    uuid,
  p_permission text,
  p_granted    boolean,   -- true = منح صريح، false = منع صريح
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بمنح الصلاحيات (users.permissions)';
  end if;
  if not exists (select 1 from permission_catalog where permission_key = p_permission) then
    raise exception 'صلاحية غير معروفة: %', p_permission;
  end if;
  if not exists (select 1 from organization_memberships
                  where organization_id = p_org and user_id = p_user_id) then
    raise exception 'العضو غير موجود في هذه المنشأة';
  end if;

  insert into membership_permissions (organization_id, user_id, permission_key, granted)
  values (p_org, p_user_id, p_permission, p_granted)
  on conflict (organization_id, user_id, permission_key)
  do update set granted = excluded.granted;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          case when p_granted then 'منح صلاحية' else 'منع صلاحية' end,
          p_permission, p_reason);
end $$;

create or replace function app_clear_member_permission(
  p_org        uuid,
  p_user_id    uuid,
  p_permission text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_org, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بتعديل الصلاحيات (users.permissions)';
  end if;

  delete from membership_permissions
   where organization_id = p_org and user_id = p_user_id
     and permission_key = p_permission;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'users', 'update', p_user_id,
          'إعادة صلاحية إلى افتراض الدور', p_permission);
end $$;

-- ===========================================================================
-- 5) المناظير
-- ===========================================================================

-- 5.1 ما يستطيعه كل عضو فعلًا، ومن أين جاءت الصلاحية
-- المنظوران التاليان يعتمدان عليه، فيُسقطان قبله لتبقى الهجرة قابلة للإعادة
drop view if exists v_duty_conflicts;
drop view if exists v_members_overview;
drop view if exists v_user_effective_permissions;
create view v_user_effective_permissions
with (security_invoker = on) as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  c.permission_key,
  c.name_ar        as permission_name,
  c.module_key,
  case
    when m.role_key in ('owner','organization_admin') then true
    when mp.permission_key is not null then mp.granted
    else exists (select 1 from role_default_permissions d
                  where d.role_key = m.role_key
                    and d.permission_key = c.permission_key)
  end              as is_allowed,
  case
    when m.role_key in ('owner','organization_admin') then 'admin'
    when mp.permission_key is not null and mp.granted then 'explicit_grant'
    when mp.permission_key is not null and not mp.granted then 'explicit_deny'
    when exists (select 1 from role_default_permissions d
                  where d.role_key = m.role_key
                    and d.permission_key = c.permission_key) then 'role_default'
    else 'none'
  end              as source,
  current_date     as report_date
from organization_memberships m
cross join permission_catalog c
left join membership_permissions mp
       on mp.organization_id = m.organization_id
      and mp.user_id = m.user_id
      and mp.permission_key = c.permission_key
where m.is_active;

comment on view v_user_effective_permissions is
  'الصلاحية الفعلية لكل عضو ومصدرها: صفة إدارية، أو منح/منع صريح، أو افتراض دوره.';

-- 5.2 نظرة عامة على الأعضاء
drop view if exists v_members_overview;
create view v_members_overview
with (security_invoker = on) as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  m.is_active,
  m.branch_id,
  b.name       as branch_name,
  u.email,
  d.id         as doctor_id,
  d.name_ar    as doctor_name,
  (select count(*) from membership_permissions p
    where p.organization_id = m.organization_id and p.user_id = m.user_id
      and p.granted)                                   as explicit_grants,
  (select count(*) from membership_permissions p
    where p.organization_id = m.organization_id and p.user_id = m.user_id
      and not p.granted)                               as explicit_denies,
  (select count(*) from v_user_effective_permissions e
    where e.organization_id = m.organization_id and e.user_id = m.user_id
      and e.is_allowed)                                as allowed_count,
  m.created_at,
  m.created_at::date as report_date
from organization_memberships m
left join auth.users u on u.id = m.user_id
left join branches b on b.id = m.branch_id
left join doctors d on d.user_id = m.user_id and d.organization_id = m.organization_id;

-- 5.3 **تعارض المهام**: من يملك طرفَي العملية الواحدة
drop view if exists v_duty_conflicts;
create view v_duty_conflicts
with (security_invoker = on) as
with pairs(conflict_key, name_ar, perm_a, perm_b) as (
  values
    ('payroll',   'يحتسب الرواتب ويعتمدها',      'payroll.run',        'payroll.approve'),
    ('purchase',  'يطلب الشراء ويوافق عليه',     'purchasing.request', 'purchasing.approve'),
    ('billing',   'يُصدر الفواتير ويُلغيها',      'billing.issue',      'billing.void'),
    ('journal',   'يُنشئ القيود ويرحّلها',        'accounting.manage',  'accounting.post'),
    ('inventory', 'يجرد المخزون ويعتمد الجرد',   'inventory.count',    'inventory.count_approve'),
    ('consent',   'يسجّل الموافقات ويتجاوزها',    'consents.sign',      'consents.override')
)
select
  a.organization_id,
  a.user_id,
  a.role_key,
  p.conflict_key,
  p.name_ar        as conflict_name,
  p.perm_a,
  p.perm_b,
  current_date     as report_date
from pairs p
join v_user_effective_permissions a
  on a.permission_key = p.perm_a and a.is_allowed
join v_user_effective_permissions b
  on b.organization_id = a.organization_id and b.user_id = a.user_id
 and b.permission_key = p.perm_b and b.is_allowed;

comment on view v_duty_conflicts is
  'أعضاء يملكون طرفَي عملية واحدة. النظام يمنع التنفيذ المزدوج وقت العمل، وهذا المنظور يُظهر التعارض قبل أن يُستعمل.';

grant select on v_user_effective_permissions, v_members_overview, v_duty_conflicts
  to authenticated;

-- ===========================================================================
-- 6) الميزة وحجب الدوال
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_set_membership_role','app_set_member_active',
                         'app_set_member_permission','app_clear_member_permission',
                         'app_guard_last_owner','app_guard_self_privilege')
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
  foreach v_v in array array['app_set_membership_role','app_set_member_active',
                             'app_set_member_permission','app_clear_member_permission']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المستخدمين % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_last_owner') then
    raise exception 'حماية آخر مالك غير مركَّبة — المنشأة قابلة للقفل على نفسها';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_self_permissions') then
    raise exception 'منع ترقية النفس غير مركَّب';
  end if;

  foreach v_v in array array['v_user_effective_permissions','v_members_overview',
                             'v_duty_conflicts']
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


-- ==========================================================================
-- [9/12]  0109_locale_and_gcc.sql
--          اللغة وإعدادات الخليج
-- ==========================================================================

-- ============================================================================
-- 0109 — المرحلة 29: التعريب ودعم دول الخليج
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- ثلاث ملاحظات صادقة قبل التفصيل:
--
--   1) `organization_memberships.display_language` موجود ويُحفظ من شاشة
--      المستخدمين منذ زمن — **ولا يقرؤه شيء**. إعدادٌ يختاره المستخدم ولا
--      يتغيّر به شيء. يُفعَّل هنا فعليًّا.
--
--   2) في المخطط **45 عمود `name_en`** تُملأ في بضع شاشات ولا تُعرض في أيّ
--      مكان. لغة عرض البيانات هنا هي ما يجعلها تُقرأ.
--
--   3) **ما يُفعَّل هو لغة عرض *البيانات*** (أسماء الخدمات والفحوص والأدوية
--      والفروع) وتنسيق التواريخ والأرقام والعملة. أمّا نصوص الواجهة نفسها
--      فتبقى عربية في هذه المرحلة، ولن أسمّي الإعداد «لغة النظام» لأن ذلك
--      يَعِد بما لا يُنفَّذ. الاسم في الشاشة: «لغة عرض البيانات».
--
-- ودعم الخليج: بلد المنشأة يحدّد العملة ونسبة الضريبة الافتراضية وصيغة
-- الهوية والهاتف. والتحقّق من الهوية **بخوارزمية حقيقية للسعودية** (رقم
-- تحقّق)، وبفحص الصيغة فقط لبقيّة الدول — لأن خوارزمياتها ليست معلنة، وادّعاء
-- تحقّقٍ لا أملك أساسه أسوأ من عدمه.
-- ============================================================================

-- ===========================================================================
-- 1) إعدادات اللغة والبلد
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
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0109_locale_and_gcc.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

create table if not exists organization_locale_settings (
  organization_id  uuid primary key references organizations(id) on delete cascade,
  country_code     text not null default 'SA'
                     check (country_code in ('SA','AE','KW','QA','BH','OM')),
  currency_code    text not null default 'SAR'
                     check (currency_code in ('SAR','AED','KWD','QAR','BHD','OMR')),
  -- لغة عرض البيانات الافتراضية للمنشأة؛ ولكل عضو أن يخالفها
  data_language    text not null default 'ar' check (data_language in ('ar','en')),
  -- التقويم المعروض: ميلادي، هجري، أو كلاهما
  calendar_display text not null default 'gregorian'
                     check (calendar_display in ('gregorian','hijri','both')),
  -- التحقّق من الهوية: معطَّل افتراضًا حتى لا تُرفض ملفات قائمة فجأة
  enforce_id_validation boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

alter table organization_locale_settings enable row level security;

create or replace function app_locale(p_org uuid)
returns organization_locale_settings
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l organization_locale_settings%rowtype;
begin
  select * into l from organization_locale_settings where organization_id = p_org;
  if l.organization_id is null then
    l.organization_id       := p_org;
    l.country_code          := 'SA';
    l.currency_code         := 'SAR';
    l.data_language         := 'ar';
    l.calendar_display      := 'gregorian';
    l.enforce_id_validation := false;
  end if;
  return l;
end $$;

-- افتراضات كل بلد: تُعرض للمستخدم عند اختيار البلد، ولا تُفرض عليه
create or replace function app_country_defaults(p_country text)
returns table (currency_code text, vat_rate numeric, phone_prefix text, id_length int)
language sql
immutable
as $$
  -- الأعمدة تُصرَّح بأنواعها: قائمة القيم تُستنتج نصًّا بلا هذا التصريح
  select v.currency_code, v.vat_rate, v.phone_prefix, v.id_length from (values
    ('SA', 'SAR'::text, 15.0::numeric, '+966'::text, 10::int),
    ('AE', 'AED',  5.0, '+971', 15),
    ('KW', 'KWD',  0.0, '+965', 12),
    ('QA', 'QAR',  0.0, '+974', 11),
    ('BH', 'BHD', 10.0, '+973',  9),
    ('OM', 'OMR',  5.0, '+968',  8)
  ) as v(c, currency_code, vat_rate, phone_prefix, id_length)
  where v.c = upper(coalesce(p_country, 'SA'));
$$;

-- ===========================================================================
-- 2) التحقّق من رقم الهوية
--    السعودية وحدها لها رقم تحقّق معلن (خوارزمية Luhn معدّلة): يُطبَّق فعليًّا.
--    بقيّة الدول: طول وصيغة فقط — ولا يُدّعى أكثر من ذلك.
-- ===========================================================================
create or replace function app_validate_national_id(
  p_country text,
  p_id      text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_id   text := regexp_replace(coalesce(p_id, ''), '\D', '', 'g');
  v_sum  int := 0;
  v_i    int;
  v_d    int;
  v_len  int;
begin
  if v_id = '' then return false; end if;

  if upper(coalesce(p_country, 'SA')) = 'SA' then
    if length(v_id) <> 10 then return false; end if;
    -- **الرقم السعودي يبدأ بـ1 (مواطن) أو 2 (مقيم)**؛ ما عداه ليس هوية
    if substr(v_id, 1, 1) not in ('1', '2') then return false; end if;
    for v_i in 1..9 loop
      v_d := substr(v_id, v_i, 1)::int;
      if v_i % 2 = 1 then
        v_d := v_d * 2;
        if v_d > 9 then v_d := v_d - 9; end if;
      end if;
      v_sum := v_sum + v_d;
    end loop;
    return ((10 - (v_sum % 10)) % 10) = substr(v_id, 10, 1)::int;
  end if;

  -- بقيّة دول الخليج: فحص الطول المعروف فقط
  select id_length into v_len from app_country_defaults(p_country);
  if v_len is null then return length(v_id) between 8 and 15; end if;
  return length(v_id) = v_len;
end $$;

create or replace function app_normalize_phone(
  p_country text,
  p_phone   text
)
returns text
language plpgsql
immutable
as $$
declare
  v_raw    text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_prefix text;
begin
  if v_raw = '' then return null; end if;
  select phone_prefix into v_prefix from app_country_defaults(p_country);
  v_prefix := coalesce(v_prefix, '+966');

  if left(v_raw, 1) = '+' then return v_raw; end if;
  if left(v_raw, 2) = '00' then return '+' || substr(v_raw, 3); end if;
  -- الصيغة المحلية: 05xxxxxxxx ⇒ يُحذف الصفر ويُضاف مفتاح الدولة
  if left(v_raw, 1) = '0' then return v_prefix || substr(v_raw, 2); end if;
  return v_prefix || v_raw;
end $$;

-- الحارس: يعمل **فقط** إن فعّلته المنشأة
create or replace function app_guard_patient_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare l organization_locale_settings;
begin
  if new.id_number is null or trim(new.id_number) = '' then
    return new;   -- الملف بلا هوية مسموح (طوارئ، رضيع، زائر)
  end if;
  if tg_op = 'UPDATE' and new.id_number is not distinct from old.id_number then
    return new;
  end if;

  l := app_locale(new.organization_id);
  if not l.enforce_id_validation then
    return new;
  end if;

  if not app_validate_national_id(l.country_code, new.id_number) then
    raise exception 'رقم الهوية غير صحيح لدولة % — راجع الرقم', l.country_code;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_patient_identity on patients;
create trigger trg_guard_patient_identity
  before insert or update of id_number on patients
  for each row execute function app_guard_patient_identity();

-- ===========================================================================
-- 3) حفظ الإعدادات
-- ===========================================================================
create or replace function app_save_locale_settings(
  p_org     uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare cur organization_locale_settings; v_bad int;
begin
  if not app_has_permission(p_org, 'policies.manage') then
    raise exception 'صلاحيتك لا تسمح بتعديل إعدادات اللغة والبلد (policies.manage)';
  end if;
  cur := app_locale(p_org);

  -- **لا يُفعَّل التحقّق من الهوية وفي الملفات أرقام لا تجتازه**: التفعيل
  -- حينها يمنع تعديل تلك الملفات لاحقًا بلا أن يفهم أحدٌ لماذا.
  if coalesce((p_changes ->> 'enforce_id_validation')::boolean, false)
     and not cur.enforce_id_validation then
    select count(*) into v_bad from patients
     where organization_id = p_org
       and id_number is not null and trim(id_number) <> ''
       and not app_validate_national_id(
             coalesce(p_changes ->> 'country_code', cur.country_code), id_number);
    if v_bad > 0 then
      raise exception 'لا يُفعَّل التحقّق: % ملفًا يحمل رقم هوية لا يجتاز الفحص — صحّحها أوّلًا', v_bad;
    end if;
  end if;

  insert into organization_locale_settings (
    organization_id, country_code, currency_code, data_language,
    calendar_display, enforce_id_validation, updated_by)
  values (
    p_org,
    upper(coalesce(p_changes ->> 'country_code',    cur.country_code)),
    upper(coalesce(p_changes ->> 'currency_code',   cur.currency_code)),
    coalesce(p_changes ->> 'data_language',         cur.data_language),
    coalesce(p_changes ->> 'calendar_display',      cur.calendar_display),
    coalesce((p_changes ->> 'enforce_id_validation')::boolean, cur.enforce_id_validation),
    auth.uid())
  on conflict (organization_id) do update set
    country_code          = excluded.country_code,
    currency_code         = excluded.currency_code,
    data_language         = excluded.data_language,
    calendar_display      = excluded.calendar_display,
    enforce_id_validation = excluded.enforce_id_validation,
    updated_at = now(), updated_by = auth.uid();

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'settings', 'update', p_org,
          'تعديل إعدادات اللغة والبلد', p_changes::text);
end $$;

-- ===========================================================================
-- 4) المناظير
-- ===========================================================================
drop view if exists v_locale_settings;
create view v_locale_settings
with (security_invoker = on) as
select
  o.id                as organization_id,
  o.name              as organization_name,
  l.country_code,
  l.currency_code,
  l.data_language,
  l.calendar_display,
  l.enforce_id_validation,
  d.vat_rate          as country_default_vat,
  d.phone_prefix,
  (ls.organization_id is not null) as is_customized,
  current_date        as report_date
from organizations o
cross join lateral app_locale(o.id) l
left join organization_locale_settings ls on ls.organization_id = o.id
left join lateral app_country_defaults(l.country_code) d on true;

-- **تغطية الترجمة**: أين ينقص الاسم الإنجليزي فعلًا
drop view if exists v_translation_coverage;
create view v_translation_coverage
with (security_invoker = on) as
select organization_id, 'items'::text as entity, count(*) as total,
       count(*) filter (where coalesce(trim(name_en), '') = '') as missing_en,
       current_date as report_date
from items group by organization_id
union all
select organization_id, 'lab_tests', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from lab_tests group by organization_id
union all
select organization_id, 'radiology_exams', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from radiology_exams group by organization_id
union all
select organization_id, 'clinics', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from clinics group by organization_id
union all
select organization_id, 'doctors', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from doctors group by organization_id;

comment on view v_translation_coverage is
  'ما ينقصه الاسم الإنجليزي في كل كتالوج — قبل أن تُشغَّل لغة عرض البيانات بالإنجليزية.';

grant select on v_locale_settings, v_translation_coverage to authenticated;

-- ===========================================================================
-- 5) RLS
-- ===========================================================================
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'organization_locale_settings'
  loop execute format('drop policy %I on organization_locale_settings', pol.policyname); end loop;

  create policy locale_select on organization_locale_settings for select to authenticated
    using (app_is_member(organization_id));
  create policy locale_write on organization_locale_settings for all to authenticated
    using (app_has_permission(organization_id, 'policies.manage'))
    with check (app_has_permission(organization_id, 'policies.manage'));
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_locale','app_save_locale_settings','app_guard_patient_identity')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
begin
  -- خوارزمية الهوية السعودية تُفحص بأرقامٍ معروفة الصحّة والبطلان
  if not app_validate_national_id('SA', '1000000008') then
    raise exception 'خوارزمية التحقّق ترفض رقمًا صحيحًا';
  end if;
  if app_validate_national_id('SA', '1000000000') then
    raise exception 'خوارزمية التحقّق تقبل رقم تحقّق خاطئًا';
  end if;
  if app_validate_national_id('SA', '3000000008') then
    raise exception 'خوارزمية التحقّق تقبل بادئة غير 1 أو 2';
  end if;
  if app_validate_national_id('SA', '100000000') then
    raise exception 'خوارزمية التحقّق تقبل طولًا خاطئًا';
  end if;

  if app_normalize_phone('SA', '0501234567') <> '+966501234567' then
    raise exception 'تطبيع الهاتف السعودي غير صحيح: %',
      app_normalize_phone('SA', '0501234567');
  end if;
  if app_normalize_phone('AE', '0501234567') <> '+971501234567' then
    raise exception 'تطبيع الهاتف الإماراتي غير صحيح';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_patient_identity') then
    raise exception 'حارس رقم الهوية غير مركَّب';
  end if;
  if (select vat_rate from app_country_defaults('SA')) <> 15.0 then
    raise exception 'نسبة الضريبة الافتراضية للسعودية غير صحيحة';
  end if;
end $$;


-- ==========================================================================
-- [10/12]  0110_integrations.sql
--          التكاملات
-- ==========================================================================

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


-- ==========================================================================
-- [11/12]  0111_analytics.sql
--          التحليلات
-- ==========================================================================

-- ============================================================================
-- 0111 — المرحلة 31: التحليلات والاتجاهات
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- النظام مليء بالتقارير منذ المرحلة 14 (خمسة عشر منظورًا)، وكلّها تُجيب عن
-- سؤال «ماذا حدث؟» صفًّا صفًّا. وما ينقص سؤالٌ آخر تمامًا:
--
--     **«هل نتحسّن أم نتراجع؟»**
--
-- ولا يُجاب عنه بقائمة، بل بسلسلةٍ زمنية ومقارنةٍ بفترةٍ سابقة. وبلا ذلك
-- يبقى الرقم بلا معنى: «١٢ حالة عدم حضور» ليست خبرًا حتى تُقارن بالشهر
-- الماضي.
--
-- ومبدآن يحكمان هذا الملف:
--
--   1) **الحساب في القاعدة لا في الشاشة.** لو حسبت الشاشة الفروق بنفسها
--      لاختلف رقم لوحة التحكم عن رقم التقرير عن رقم التصدير، ولصار لكل
--      شاشة حقيقتها. المصدر واحد هنا.
--   2) **لا مقارنة بلا أساس.** إن كانت الفترة السابقة صفرًا فلا نسبة تغيّر
--      — تُترك فارغة ولا تُكتب «+100%» ولا «∞».
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحية
-- ===========================================================================
-- المفتاح `advanced_analytics.view` لا `analytics.view`: ميزة التحليلات
-- المتقدّمة قائمة في كتالوج المزايا منذ 0001، وقاعدة النظام أن صلاحية فتح
-- الموديول هي «مفتاح الميزة + view». اختراع مفتاحٍ ثانٍ يعني بابين لغرفة واحدة.
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
  if to_regclass('public.integration_settings') is null then
    v_missing := v_missing || E'\n  • 0110_integrations.sql  (التكاملات)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0111_analytics.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select 'advanced_analytics.view', 'عرض التحليلات', 'analytics', 2300
where not exists (select 1 from permission_catalog
                   where permission_key = 'advanced_analytics.view');

insert into role_default_permissions (role_key, permission_key)
select r, 'advanced_analytics.view' from (values ('branch_manager'), ('accountant')) as v(r)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r
                     and d.permission_key = 'advanced_analytics.view');

-- ===========================================================================
-- 2) السلسلة اليومية — أساس كل رسم بياني
--    يومٌ واحد لكل منشأة/فرع، بكل ما يُقاس في ذلك اليوم.
-- ===========================================================================
drop view if exists v_analytics_daily;
create view v_analytics_daily
with (security_invoker = on) as
with days as (
  select organization_id, branch_id, day from (
    select organization_id, branch_id, scheduled_start::date as day
      from appointments
    union
    select organization_id, branch_id, visit_date::date from patient_visits
    union
    select organization_id, branch_id, created_at::date from sales_invoices
    union
    select organization_id, branch_id, created_at::date from patients
  ) s
  where day is not null
),
appt as (
  select organization_id, branch_id, scheduled_start::date as day,
         count(*)                                            as appointments_total,
         count(*) filter (where status = 'no_show')           as no_shows,
         count(*) filter (where status = 'cancelled_by_patient') as patient_cancellations,
         avg(extract(epoch from (entered_at - checked_in_1_at)) / 60)
           filter (where checked_in_1_at is not null and entered_at is not null)
                                                              as avg_waiting_minutes
    from appointments group by 1, 2, 3
),
vis as (
  select organization_id, branch_id, visit_date::date as day,
         count(*)                                             as visits_total,
         count(*) filter (where status in ('draft','in_progress')) as visits_open
    from patient_visits group by 1, 2, 3
),
newp as (
  select organization_id, branch_id, created_at::date as day, count(*) as new_patients
    from patients group by 1, 2, 3
),
inv as (
  select organization_id, branch_id, created_at::date as day,
         count(*)                          as invoices_count,
         sum(coalesce(net_amount, 0))      as revenue,
         sum(coalesce(remaining_amount, 0)) as outstanding_added
    from sales_invoices
   where status <> 'void'
   group by 1, 2, 3
)
select
  d.organization_id,
  d.branch_id,
  d.day                                        as report_date,
  coalesce(a.appointments_total, 0)            as appointments_total,
  coalesce(a.no_shows, 0)                      as no_shows,
  coalesce(a.patient_cancellations, 0)         as patient_cancellations,
  round(a.avg_waiting_minutes)::int            as avg_waiting_minutes,
  coalesce(v.visits_total, 0)                  as visits_total,
  coalesce(v.visits_open, 0)                   as visits_open,
  coalesce(n.new_patients, 0)                  as new_patients,
  coalesce(i.invoices_count, 0)                as invoices_count,
  round(coalesce(i.revenue, 0), 2)             as revenue,
  round(coalesce(i.outstanding_added, 0), 2)   as outstanding_added
from days d
left join appt a on a.organization_id = d.organization_id
                and a.branch_id is not distinct from d.branch_id and a.day = d.day
left join vis  v on v.organization_id = d.organization_id
                and v.branch_id is not distinct from d.branch_id and v.day = d.day
left join newp n on n.organization_id = d.organization_id
                and n.branch_id is not distinct from d.branch_id and n.day = d.day
left join inv  i on i.organization_id = d.organization_id
                and i.branch_id is not distinct from d.branch_id and i.day = d.day;

comment on view v_analytics_daily is
  'سلسلة يومية لكل منشأة/فرع: المواعيد وعدم الحضور والانتظار والزيارات والمرضى الجدد والإيراد.';

-- ===========================================================================
-- 3) المقارنة بفترة سابقة — **الحساب هنا لا في الشاشة**
-- ===========================================================================
create or replace function app_analytics_summary(
  p_org  uuid,
  p_from date,
  p_to   date
)
returns table (
  metric_key      text,
  metric_name     text,
  current_value   numeric,
  previous_value  numeric,
  change_percent  numeric,
  higher_is_better boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days     int;
  v_prev_to  date;
  v_prev_from date;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  if p_to < p_from then
    raise exception 'نهاية الفترة قبل بدايتها';
  end if;

  -- الفترة السابقة بطول الفترة الحالية نفسها: مقارنة أسبوعٍ بشهرٍ لا معنى لها
  v_days      := (p_to - p_from) + 1;
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  return query
  with cur as (
    select
      coalesce(sum(appointments_total), 0)::numeric  as appointments,
      coalesce(sum(no_shows), 0)::numeric            as no_shows,
      coalesce(sum(visits_total), 0)::numeric        as visits,
      coalesce(sum(new_patients), 0)::numeric        as new_patients,
      coalesce(sum(revenue), 0)::numeric             as revenue,
      avg(avg_waiting_minutes)::numeric              as waiting
    from v_analytics_daily
     where organization_id = p_org and report_date between p_from and p_to
  ),
  prv as (
    select
      coalesce(sum(appointments_total), 0)::numeric  as appointments,
      coalesce(sum(no_shows), 0)::numeric            as no_shows,
      coalesce(sum(visits_total), 0)::numeric        as visits,
      coalesce(sum(new_patients), 0)::numeric        as new_patients,
      coalesce(sum(revenue), 0)::numeric             as revenue,
      avg(avg_waiting_minutes)::numeric              as waiting
    from v_analytics_daily
     where organization_id = p_org and report_date between v_prev_from and v_prev_to
  ),
  pairs as (
    select 'appointments'::text as k, 'المواعيد'::text as n,
           c.appointments as cur_v, p.appointments as prev_v, true as hib
      from cur c cross join prv p
    union all
    select 'visits', 'الزيارات', c.visits, p.visits, true from cur c cross join prv p
    union all
    select 'new_patients', 'مرضى جدد', c.new_patients, p.new_patients, true
      from cur c cross join prv p
    union all
    select 'revenue', 'الإيراد', c.revenue, p.revenue, true from cur c cross join prv p
    union all
    select 'no_shows', 'عدم الحضور', c.no_shows, p.no_shows, false
      from cur c cross join prv p
    union all
    select 'avg_waiting', 'متوسّط الانتظار (د)', c.waiting, p.waiting, false
      from cur c cross join prv p
  )
  select
    pairs.k,
    pairs.n,
    round(coalesce(pairs.cur_v, 0), 2),
    round(coalesce(pairs.prev_v, 0), 2),
    -- **لا نسبة تغيّر بلا أساس**: قسمةٌ على صفر تُترك فارغة لا تُكتب ∞
    case when coalesce(pairs.prev_v, 0) = 0 then null
         else round(((coalesce(pairs.cur_v, 0) - pairs.prev_v) / pairs.prev_v) * 100, 1) end,
    pairs.hib
  from pairs;
end $$;

-- ===========================================================================
-- 4) مناظير مساعدة
-- ===========================================================================

-- أكثر الخدمات طلبًا: يجيب «فيمَ نعمل فعلًا؟»
drop view if exists v_analytics_top_services;
create view v_analytics_top_services
with (security_invoker = on) as
select
  s.organization_id,
  v.branch_id,
  s.item_id,
  i.name_ar        as item_name,
  i.name_en        as item_name_en,
  count(*)         as times_performed,
  sum(coalesce(s.qty, 1))                                   as total_qty,
  round(sum(coalesce(s.unit_price, 0) * coalesce(s.qty, 1)), 2) as total_value,
  v.visit_date::date as report_date
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join items i on i.id = s.item_id
where s.status in ('performed','invoiced','paid','claimed')
group by s.organization_id, v.branch_id, s.item_id, i.name_ar, i.name_en, v.visit_date::date;

-- ساعات الذروة: متى يزدحم المكان؟ أساس توزيع المناوبات
drop view if exists v_analytics_peak_hours;
create view v_analytics_peak_hours
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  extract(dow  from scheduled_start)::int  as weekday,
  extract(hour from scheduled_start)::int  as hour_of_day,
  count(*)                                 as appointments,
  count(*) filter (where status = 'no_show') as no_shows,
  scheduled_start::date                    as report_date
from appointments
group by organization_id, branch_id,
         extract(dow from scheduled_start), extract(hour from scheduled_start),
         scheduled_start::date;

grant select on v_analytics_daily, v_analytics_top_services,
                v_analytics_peak_hours to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'app_analytics_summary'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 5) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_analytics_summary') then
    raise exception 'دالّة ملخّص التحليلات غير موجودة';
  end if;

  foreach v_v in array array['v_analytics_daily','v_analytics_top_services',
                             'v_analytics_peak_hours']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'منظور التحليلات % بلا security_invoker', v_v;
    end if;
  end loop;
end $$;


-- ==========================================================================
-- [12/12]  0112_launch_readiness.sql
--          جاهزية الإطلاق
-- ==========================================================================

-- ============================================================================
-- 0112 — المرحلة 32: جاهزية الإطلاق
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- هذه آخر مراحل الخطّة، ووظيفتها سؤالٌ واحد: **هل هذه المنشأة جاهزة للعمل
-- الحقيقي؟** — ولا يُجاب عنه بقائمة مهام يشطبها المستخدم بيده. قائمةٌ تُشطب
-- يدويًّا تقول ما ادّعاه من شطبها، لا ما في النظام.
--
-- فكل فحصٍ هنا **يُحسب من قاعدة البيانات لحظة السؤال**: لا خانة تُعلَّم، ولا
-- حالة تُحفظ، ولا شيء يبقى «مكتملًا» بعد أن يتغيّر ما بُني عليه. وإن حُذفت
-- قائمة الأسعار غدًا عاد الفحص أحمر من تلقاء نفسه.
--
-- والتصنيف ثلاثي وصريح:
--   • مانع (blocker): العمل به يُنتج بيانات خاطئة أو مخالفة نظامية.
--   • تحذير (warning): يعمل، لكن بنقصٍ سيُكلّف لاحقًا.
--   • معلومة (info): للعلم لا للتوقّف.
-- ============================================================================

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
  if to_regclass('public.integration_settings') is null then
    v_missing := v_missing || E'\n  • 0110_integrations.sql  (التكاملات)';
  end if;
  if to_regclass('public.v_analytics_daily') is null then
    v_missing := v_missing || E'\n  • 0111_analytics.sql  (التحليلات)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0112_launch_readiness.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

create or replace function app_launch_readiness(p_org uuid)
returns table (
  check_key   text,
  severity    text,
  title       text,
  detail      text,
  item_count  integer,
  is_ok       boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_locale organization_locale_settings;
  v_n      integer;
begin
  if not app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  v_locale := app_locale(p_org);

  -- ═══════════════════════════════════════════════════════════════════════
  -- الأساسيات التي لا يعمل النظام بدونها
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from branches where organization_id = p_org;
  return query select 'branches', 'blocker', 'فروع المنشأة',
    case when v_n = 0 then 'لا يوجد فرع واحد — كل عملية تشغيلية تُنسب إلى فرع'
         else format('%s فرعًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from clinics
   where organization_id = p_org and not coalesce(is_disabled, false);
  return query select 'clinics', 'blocker', 'العيادات',
    case when v_n = 0 then 'لا عيادة نشطة — لا يمكن حجز موعد ولا فتح زيارة'
         else format('%s عيادة نشطة', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from doctors
   where organization_id = p_org and coalesce(is_enabled, true);
  return query select 'doctors', 'blocker', 'الأطباء',
    case when v_n = 0 then 'لا طبيب مفعَّل'
         else format('%s طبيبًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from items
   where organization_id = p_org and item_type = 'service'
     and not coalesce(is_disabled, false);
  return query select 'services', 'blocker', 'كتالوج الخدمات',
    case when v_n = 0 then 'لا خدمة واحدة — لا فوترة بلا خدمات'
         else format('%s خدمة', v_n) end,
    v_n, v_n > 0;

  -- **قائمة الأسعار الأساسية**: بلا قائمة أساسية تخرج الفواتير بأسعار صفرية
  select count(*) into v_n from price_lists
   where organization_id = p_org and list_kind = 'base'
     and coalesce(is_active, true)
     and (effective_to is null or effective_to >= current_date);
  return query select 'base_price_list', 'blocker', 'قائمة الأسعار الأساسية',
    case when v_n = 0
         then 'لا قائمة أسعار أساسية — الأسعار في الفواتير ستخرج صفرية'
         else 'موجودة' end,
    v_n, v_n > 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- المالية
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from chart_of_accounts where organization_id = p_org;
  return query select 'chart_of_accounts', 'warning', 'دليل الحسابات',
    case when v_n = 0
         then 'لا دليل حسابات — العمليات لن تُرحَّل محاسبيًّا (المحاسبة موديول اختياري)'
         else format('%s حسابًا', v_n) end,
    v_n, v_n > 0;

  select count(*) into v_n from fiscal_periods p
    join fiscal_years y on y.id = p.fiscal_year_id
   where p.organization_id = p_org and p.status = 'open'
     and current_date between p.start_date and p.end_date;
  return query select 'open_fiscal_period', 'warning', 'الفترة المالية',
    case when v_n = 0
         then 'لا فترة مالية مفتوحة لتاريخ اليوم — القيود ستُرفض'
         else 'مفتوحة' end,
    v_n, v_n > 0;

  select count(*) into v_n from organization_vat_settings where organization_id = p_org;
  return query select 'vat_settings', 'warning', 'إعدادات الضريبة',
    case when v_n = 0 then 'لم تُضبط بعد'
         else format('مضبوطة (الافتراض لدولتك %s%%)',
                     (select vat_rate from app_country_defaults(v_locale.country_code))) end,
    v_n, v_n > 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- الحوكمة والصلاحيات
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from organization_memberships
   where organization_id = p_org and role_key = 'owner' and is_active;
  return query select 'owners', 'warning', 'مالكو المنشأة',
    case when v_n <= 1
         then 'مالكٌ واحد فقط — إن فقد وصوله لا يبقى من يدير المنشأة'
         else format('%s مالكًا', v_n) end,
    v_n, v_n > 1;

  select count(*) into v_n from v_duty_conflicts where organization_id = p_org;
  return query select 'duty_conflicts', 'warning', 'تعارض المهام',
    case when v_n = 0 then 'لا تعارض'
         else format('%s حالة يملك فيها شخصٌ طرفَي عملية واحدة', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- سلامة المرضى — **الأشدّ**
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from critical_result_notifications
   where organization_id = p_org and acknowledged_at is null;
  return query select 'critical_open', 'blocker', 'قيم حرجة بلا إقرار',
    case when v_n = 0 then 'لا شيء معلّق'
         else format('%s قيمة حرجة لم يُقَرّ بها بعد', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from v_pending_consents
   where organization_id = p_org and consent_status in ('missing','expired')
     and status in ('performed','invoiced','paid','claimed')
     and consent_override_reason is null;
  return query select 'consents_missing', 'blocker', 'إجراءات نُفّذت بلا موافقة',
    case when v_n = 0 then 'لا شيء'
         else format('%s إجراءً منفَّذًا بلا موافقة موقَّعة ولا تجاوز موثَّق', v_n) end,
    v_n, v_n = 0;

  -- تُقيَّد بالجدول: `severity` اسم عمود خارج في هذه الدالّة أيضًا
  select count(*) into v_n from quality_incidents q
   where q.organization_id = p_org and q.status <> 'closed'
     and q.severity in ('major','sentinel');
  return query select 'severe_incidents', 'warning', 'بلاغات سلامة جسيمة مفتوحة',
    case when v_n = 0 then 'لا شيء' else format('%s بلاغًا', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- التشغيل
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from patient_visits
   where organization_id = p_org and status in ('draft','in_progress')
     and visit_date < now() - make_interval(days => (app_org_policy(p_org)).visit_open_alert_days);
  return query select 'stale_visits', 'warning', 'زيارات مفتوحة متأخّرة',
    case when v_n = 0 then 'لا شيء'
         else format('%s زيارة لم تُغلق — لا تُفوتر ولا تدخل مطالبة', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from assets
   where organization_id = p_org and requires_calibration and status <> 'disposed'
     and next_calibration_date is not null and next_calibration_date < current_date;
  return query select 'overdue_calibration', 'blocker', 'أجهزة متأخّرة المعايرة',
    case when v_n = 0 then 'لا شيء'
         else format('%s جهازًا لا يجوز استخدامه حتى تُجدَّد معايرته', v_n) end,
    v_n, v_n = 0;

  select count(*) into v_n from inventory_lots
   where organization_id = p_org and qty_remaining > 0
     and expiry_date is not null and expiry_date < current_date;
  return query select 'expired_stock', 'blocker', 'دفعات منتهية في المخزون',
    case when v_n = 0 then 'لا شيء'
         else format('%s دفعة منتهية وما زال لها رصيد', v_n) end,
    v_n, v_n = 0;

  -- ═══════════════════════════════════════════════════════════════════════
  -- التكاملات واللغة
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from (
    select 1 from einvoice_documents where organization_id = p_org and failed_permanently
    union all
    select 1 from nphies_messages where organization_id = p_org and failed_permanently
  ) d;
  return query select 'integration_dead', 'warning', 'رسائل تكامل متوقّفة',
    case when v_n = 0 then 'لا شيء'
         else format('%s رسالة استنفدت محاولاتها', v_n) end,
    v_n, v_n = 0;

  if v_locale.data_language = 'en' then
    select coalesce(sum(missing_en), 0) into v_n from v_translation_coverage
     where organization_id = p_org;
    return query select 'translation_gap', 'warning', 'أسماء تنقصها الإنجليزية',
      case when v_n = 0 then 'التغطية كاملة'
           else format('%s اسمًا سيُعرض بالعربية رغم اختيار الإنجليزية', v_n) end,
      v_n, v_n = 0;
  end if;

  if v_locale.enforce_id_validation then
    select count(*) into v_n from patients
     where organization_id = p_org and id_number is not null and trim(id_number) <> ''
       and not app_validate_national_id(v_locale.country_code, id_number);
    return query select 'invalid_ids', 'warning', 'أرقام هوية لا تجتاز التحقّق',
      case when v_n = 0 then 'لا شيء' else format('%s ملفًا', v_n) end,
      v_n, v_n = 0;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- معلومات للعلم
  -- ═══════════════════════════════════════════════════════════════════════
  select count(*) into v_n from organization_features
   where organization_id = p_org and enabled;
  return query select 'features', 'info', 'المزايا المفعَّلة',
    format('%s ميزة', v_n), v_n, true;

  select count(*) into v_n from patients where organization_id = p_org;
  return query select 'patients', 'info', 'الملفات المسجَّلة',
    format('%s ملفًا', v_n), v_n, true;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'app_launch_readiness'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- فحص ذاتي
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_launch_readiness') then
    raise exception 'دالّة جاهزية الإطلاق غير موجودة';
  end if;

  -- **لا جدول حالة**: وجود جدولٍ يحفظ «تمّ» يعني قائمةً تُشطب يدويًّا
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'launch_checklist') then
    raise exception 'ظهر جدول قائمة مهام يدوية — الجاهزية تُحسب لا تُعلَّم';
  end if;
end $$;


-- ==========================================================================
-- نهاية الجزء 2 (الهجرات 0101–0112) — 12 هجرة
-- ==========================================================================
do $zc_done$
begin
  raise notice '=== اكتمل % بنجاح ===', 'الجزء 2 (الهجرات 0101–0112)';
end
$zc_done$;
