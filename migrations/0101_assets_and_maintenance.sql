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
