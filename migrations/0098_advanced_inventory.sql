-- ============================================================================
-- 0098 — المرحلة 18: المخزون المتقدم
-- ============================================================================
--
-- **ما كان قائمًا**: مستودعات لكل فرع، وتشغيلات بصلاحياتها، وFEFO، ومنع
-- الرصيد السالب، وحجز الوصفات (0088)، وسجل حركة محميّ من الحذف.
--
-- **ما ينقصه**:
--
--   • `stock_transfers` **جدولٌ لا يقوده أحد**: فيه حالة ومعتمِد، ولا دالّة
--     واحدة تنقله بينها. أي أن التحويل بين الفروع يُسجَّل ولا يُنفَّذ، فيبقى
--     الرصيد في مكانه الأصلي بينما البضاعة في مكانٍ آخر.
--   • لا مواقع داخل المستودع: «أين العلبة» سؤالٌ بلا جواب في مستودعٍ كبير.
--   • لا جرد: الفرق بين الدفتر والواقع لا يُكتشف إلا عند النفاد المفاجئ.
--   • حدّ إعادة الطلب **عامّ على الصنف** (`items.reorder_level`) لا لكل
--     مستودع؛ ومستودع الفرع الصغير لا يحتاج ما يحتاجه المركزيّ.
--   • لا تتبّع من الاستلام حتى الصرف: عند سحب تشغيلة معيبة لا يُعرف أين
--     ذهبت.
--
-- **المبدأ**: كل تغيير في الرصيد يمرّ بـ`inventory_movements`، فلا مسار
-- ثانٍ يعدّل الكمّيات من وراء السجلّ.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('inventory.transfer_request', 'طلب تحويل مخزني',      'inventory', 1100),
  ('inventory.transfer_approve', 'اعتماد التحويل',       'inventory', 1102),
  ('inventory.transfer_ship',    'شحن التحويل',          'inventory', 1104),
  ('inventory.transfer_receive', 'استلام التحويل',       'inventory', 1106),
  ('inventory.count',            'تنفيذ الجرد',          'inventory', 1108),
  ('inventory.count_approve',    'اعتماد تسوية الجرد',   'inventory', 1110),
  ('inventory.settings',         'إعدادات حدود المخزون', 'inventory', 1112)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **الجرد والاعتماد لا يجتمعان في دور واحد افتراضيًّا**: من يعدّ ليس من
-- يقرّ الفرق، وإلا صار العجز يُغطّى بقلم مَن سبّبه.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('pharmacist',     'inventory.transfer_request'), ('pharmacist', 'inventory.transfer_ship'),
  ('pharmacist',     'inventory.transfer_receive'), ('pharmacist', 'inventory.count'),
  ('branch_manager', 'inventory.transfer_request'), ('branch_manager', 'inventory.transfer_approve'),
  ('branch_manager', 'inventory.transfer_ship'), ('branch_manager', 'inventory.transfer_receive'),
  ('branch_manager', 'inventory.count'), ('branch_manager', 'inventory.count_approve'),
  ('branch_manager', 'inventory.settings'),
  ('accountant',     'inventory.count_approve'), ('accountant', 'inventory.settings')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) المواقع داخل المستودع
-- ===========================================================================
create table if not exists warehouse_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id    uuid not null references warehouses(id) on delete cascade,
  code            text not null,
  name            text,
  location_type   text not null default 'shelf'
                    check (location_type in ('aisle','shelf','bin','fridge','freezer','quarantine')),
  parent_location_id uuid references warehouse_locations(id),
  temperature_controlled boolean not null default false,
  is_disabled     boolean not null default false,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_warehouse_location_code
  on warehouse_locations (warehouse_id, code);

comment on table warehouse_locations is
  'مواقع التخزين داخل المستودع. `quarantine` موقعٌ للحجر: التالف والمنتهي يُنقل إليه فلا يُصرف بالخطأ وهو ما زال في الرصيد.';

alter table warehouse_locations enable row level security;

alter table inventory_lots
  add column if not exists location_id uuid references warehouse_locations(id);

-- **الموقع يجب أن يكون في نفس المستودع.** تشغيلةٌ في مستودع أ وموقعها في
-- مستودع ب تعني جردًا لا يُطابق أبدًا.
create or replace function app_guard_lot_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_wh uuid;
begin
  if new.location_id is null then return new; end if;
  select warehouse_id into v_wh from warehouse_locations where id = new.location_id;
  if v_wh is distinct from new.warehouse_id then
    raise exception 'موقع التخزين لا ينتمي إلى مستودع التشغيلة';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_lot_location on inventory_lots;
create trigger trg_guard_lot_location
  before insert or update of location_id, warehouse_id on inventory_lots
  for each row execute function app_guard_lot_location();

-- ===========================================================================
-- 3) حدود المخزون لكل صنف ومستودع
-- ===========================================================================
create table if not exists item_stock_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id    uuid not null references warehouses(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  min_qty         numeric(14,3) not null default 0,
  max_qty         numeric(14,3),
  reorder_level   numeric(14,3) not null default 0,
  reorder_qty     numeric(14,3),
  lead_time_days  integer,
  preferred_distributor_id uuid references distributors(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  constraint item_stock_settings_range_check
    check (max_qty is null or max_qty >= min_qty)
);

create unique index if not exists uq_item_stock_settings
  on item_stock_settings (warehouse_id, item_id);

comment on table item_stock_settings is
  'حدود المخزون لكل صنف في كل مستودع. `items.reorder_level` عامٌّ على الصنف، ومستودع الفرع الصغير لا يحتاج ما يحتاجه المركزيّ.';

alter table item_stock_settings enable row level security;

-- ===========================================================================
-- 4) التحويل المخزني — دورة كاملة
-- ===========================================================================
alter table stock_transfers
  add column if not exists from_branch_id  uuid references branches(id),
  add column if not exists to_branch_id    uuid references branches(id),
  add column if not exists reason          text,
  add column if not exists requested_at    timestamptz not null default now(),
  add column if not exists approved_at     timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists shipped_at      timestamptz,
  add column if not exists shipped_by      uuid references auth.users(id),
  add column if not exists received_at     timestamptz,
  add column if not exists received_by     uuid references auth.users(id),
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancel_reason   text,
  add column if not exists created_by      uuid references auth.users(id),
  add column if not exists updated_by      uuid references auth.users(id);

do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'stock_transfers'::regclass and conname like '%status%';
  if v_con is not null then
    execute format('alter table stock_transfers drop constraint %I', v_con);
  end if;
  alter table stock_transfers add constraint stock_transfers_status_check
    check (status in ('draft','requested','approved','rejected','shipped',
                      'received','cancelled'));
end $$;

alter table stock_transfer_items
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists lot_id          uuid references inventory_lots(id),
  add column if not exists qty_shipped     numeric(14,3) not null default 0,
  add column if not exists qty_received    numeric(14,3) not null default 0,
  add column if not exists received_lot_id uuid references inventory_lots(id),
  add column if not exists variance_note   text;

update stock_transfer_items sti
   set organization_id = st.organization_id
  from stock_transfers st
 where sti.transfer_id = st.id and sti.organization_id is null;

comment on column stock_transfer_items.received_lot_id is
  'التشغيلة الناتجة في المستودع المستقبِل. الربط بينها وبين المصدر هو ما يجعل تتبّع الدواء عبر الفروع ممكنًا.';

create index if not exists idx_transfers_status
  on stock_transfers (organization_id, status, requested_at desc);

create or replace function app_approve_stock_transfer(
  p_transfer_id uuid,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_t stock_transfers%rowtype;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد التحويلات (inventory.transfer_approve)';
  end if;
  if v_t.status not in ('draft','requested') then
    raise exception 'لا يُعتمد تحويل حالته %', v_t.status;
  end if;
  -- طالب التحويل لا يعتمده
  if v_t.requested_by is not null and v_t.requested_by = auth.uid() then
    raise exception 'لا يعتمد التحويلَ طالبُه — يلزم معتمِد آخر';
  end if;

  update stock_transfers
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         note = coalesce(p_note, note), updated_at = now(), updated_by = auth.uid()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'اعتماد تحويل مخزني', 'اعتُمد التحويل');
end $$;

create or replace function app_reject_stock_transfer(
  p_transfer_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_t stock_transfers%rowtype;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_approve') then
    raise exception 'صلاحيتك لا تسمح برفض التحويلات (inventory.transfer_approve)';
  end if;
  if v_t.status not in ('draft','requested') then
    raise exception 'لا يُرفض تحويل حالته %', v_t.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update stock_transfers
     set status = 'rejected', rejected_reason = p_reason,
         approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'رفض تحويل مخزني', 'رُفض التحويل', p_reason);
end $$;

-- الشحن: يخرج من المصدر بـFEFO إن لم تُحدَّد التشغيلة
create or replace function app_ship_stock_transfer(p_transfer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t     stock_transfers%rowtype;
  v_line  record;
  v_lot   record;
  v_need  numeric;
  v_take  numeric;
  v_n     int := 0;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_ship') then
    raise exception 'صلاحيتك لا تسمح بشحن التحويلات (inventory.transfer_ship)';
  end if;
  -- **الشحن بعد الاعتماد فقط**: بلا ذلك تخرج البضاعة من الفرع بلا إذن.
  if v_t.status <> 'approved' then
    raise exception 'لا يُشحن تحويل حالته % — يلزم اعتماده أوّلًا', v_t.status;
  end if;
  if v_t.from_warehouse_id = v_t.to_warehouse_id then
    raise exception 'مستودع المصدر والوجهة واحد';
  end if;

  for v_line in
    select sti.*, i.name_ar
      from stock_transfer_items sti
      join items i on i.id = sti.item_id
     where sti.transfer_id = p_transfer_id
  loop
    v_need := v_line.qty;

    for v_lot in
      -- **الأقرب انتهاءً أوّلًا**، وبعد خصم المحجوز: المحجوز لوصفةٍ ليس متاحًا
      -- للتحويل ولو بدا في الرصيد.
      select l.id, l.qty_remaining - coalesce(l.reserved_quantity, 0) as available,
             l.unit_cost, l.lot_number, l.expiry_date, l.selling_price, l.distributor_id
        from inventory_lots l
       where l.warehouse_id = v_t.from_warehouse_id
         and l.item_id = v_line.item_id
         and l.qty_remaining - coalesce(l.reserved_quantity, 0) > 0
         and (l.expiry_date is null or l.expiry_date > current_date)
         and coalesce(l.status, 'available') = 'available'
         and (v_line.lot_id is null or l.id = v_line.lot_id)
       order by l.expiry_date nulls last, l.received_at
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_lot.available);

      insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                       movement_type, qty, unit_price, total_amount,
                                       related_stock_transfer_id, note, created_by)
      values (v_t.organization_id, v_t.from_warehouse_id, v_line.item_id, v_lot.id,
              'transfer_out', v_take, v_lot.unit_cost,
              round(v_lot.unit_cost * v_take, 2), p_transfer_id,
              format('شحن تحويل %s', coalesce(v_t.transfer_number::text, '')), auth.uid());

      -- التشغيلة المستقبِلة تُنشأ الآن بكمّية صفر، وتُملأ عند الاستلام:
      -- بهذا تبقى البضاعة **خارج رصيد الوجهة** ما دامت في الطريق.
      if v_line.lot_id is null then
        update stock_transfer_items set lot_id = v_lot.id where id = v_line.id;
      end if;

      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception 'رصيد الصنف % لا يكفي للتحويل: ناقص %', v_line.name_ar, v_need;
    end if;

    update stock_transfer_items set qty_shipped = v_line.qty where id = v_line.id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'التحويل بلا بنود'; end if;

  update stock_transfers
     set status = 'shipped', shipped_at = now(), shipped_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'شحن تحويل مخزني', format('شُحن %s بندًا', v_n));

  return v_n;
end $$;

-- الاستلام: يدخل الوجهة بتشغيلة جديدة تحمل نفس رقم التشغيلة وتاريخ الصلاحية
create or replace function app_receive_stock_transfer(
  p_transfer_id uuid,
  p_lines       jsonb default null   -- [{item_id, qty_received, variance_note}]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t      stock_transfers%rowtype;
  v_line   record;
  v_src    inventory_lots%rowtype;
  v_new    uuid;
  v_qty    numeric;
  v_note   text;
  v_n      int := 0;
  v_short  boolean := false;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_receive') then
    raise exception 'صلاحيتك لا تسمح باستلام التحويلات (inventory.transfer_receive)';
  end if;
  if v_t.status <> 'shipped' then
    raise exception 'لا يُستلَم تحويل حالته % — يلزم شحنه أوّلًا', v_t.status;
  end if;

  for v_line in
    select sti.*, i.name_ar
      from stock_transfer_items sti
      join items i on i.id = sti.item_id
     where sti.transfer_id = p_transfer_id
  loop
    v_qty  := coalesce((select (e->>'qty_received')::numeric
                          from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
                         where (e->>'item_id')::uuid = v_line.item_id),
                       v_line.qty_shipped);
    v_note := (select e->>'variance_note'
                 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
                where (e->>'item_id')::uuid = v_line.item_id);

    if v_qty > v_line.qty_shipped then
      raise exception 'المستلَم من % يتجاوز المشحون (% > %)',
        v_line.name_ar, v_qty, v_line.qty_shipped;
    end if;
    -- **النقص يحتاج ملاحظة**: فرقٌ بين المشحون والمستلَم بلا تفسير هو فقدٌ
    -- يُدفن في الأرقام.
    if v_qty < v_line.qty_shipped and coalesce(trim(v_note), '') = '' then
      raise exception 'نقص في استلام % بلا ملاحظة تفسّره (شُحن %, استُلم %)',
        v_line.name_ar, v_line.qty_shipped, v_qty;
    end if;
    if v_qty < v_line.qty_shipped then v_short := true; end if;

    select * into v_src from inventory_lots where id = v_line.lot_id;

    insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                                expiry_date, qty_received, qty_remaining, unit_cost,
                                selling_price, distributor_id, received_at, created_by)
    values (v_t.organization_id, v_t.to_warehouse_id, v_line.item_id,
            v_src.lot_number, v_src.expiry_date, v_qty, 0,
            coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0),
            v_src.selling_price, v_src.distributor_id, now(), auth.uid())
    returning id into v_new;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     related_stock_transfer_id, note, created_by)
    values (v_t.organization_id, v_t.to_warehouse_id, v_line.item_id, v_new,
            'transfer_in', v_qty,
            coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0),
            round(coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0) * v_qty, 2),
            p_transfer_id,
            format('استلام تحويل %s', coalesce(v_t.transfer_number::text, '')), auth.uid());

    update stock_transfer_items
       set qty_received = v_qty, received_lot_id = v_new,
           variance_note = coalesce(v_note, variance_note)
     where id = v_line.id;

    v_n := v_n + 1;
  end loop;

  update stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.to_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'استلام تحويل مخزني',
          format('استُلم %s بندًا%s', v_n,
                 case when v_short then ' — بفروقات موثَّقة' else '' end));

  return v_n;
end $$;

-- ===========================================================================
-- 5) الجرد: دوريّ ومفاجئ، وتسوية بسبب واعتماد
-- ===========================================================================
create table if not exists stock_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  warehouse_id    uuid not null references warehouses(id),
  count_number    text,
  count_type      text not null default 'periodic'
                    check (count_type in ('periodic','surprise','partial','annual')),
  status          text not null default 'open'
                    check (status in ('open','counted','approved','posted','cancelled')),
  scope_note      text,
  started_at      timestamptz not null default now(),
  started_by      uuid references auth.users(id),
  counted_at      timestamptz,
  counted_by      uuid references auth.users(id),
  approved_at     timestamptz,
  approved_by     uuid references auth.users(id),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists stock_count_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  stock_count_id  uuid not null references stock_counts(id) on delete cascade,
  item_id         uuid not null references items(id),
  lot_id          uuid references inventory_lots(id),
  location_id     uuid references warehouse_locations(id),
  -- **الرصيد الدفتري يُجمَّد لحظة فتح الجرد**، لا يُقرأ عند الترحيل: قراءتُه
  -- لاحقًا تجعل كل صرفٍ وقع أثناء العدّ يظهر عجزًا.
  system_qty      numeric(14,3) not null default 0,
  counted_qty     numeric(14,3),
  variance_qty    numeric(14,3) generated always as
                    (coalesce(counted_qty, 0) - system_qty) stored,
  unit_cost       numeric(14,2) not null default 0,
  variance_reason text,
  counted_at      timestamptz,
  counted_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_stock_counts_wh
  on stock_counts (organization_id, warehouse_id, status);
create index if not exists idx_stock_count_items_count
  on stock_count_items (stock_count_id);

alter table stock_counts enable row level security;
alter table stock_count_items enable row level security;

-- جردٌ مفتوح واحد لكل مستودع: جردان متزامنان يتسويان الفرق نفسه مرّتين
create unique index if not exists uq_one_open_count_per_warehouse
  on stock_counts (warehouse_id)
  where status in ('open','counted','approved');

create or replace function app_start_stock_count(
  p_warehouse_id uuid,
  p_count_type   text default 'periodic',
  p_number       text default null,
  p_item_ids     uuid[] default null,
  p_scope_note   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wh warehouses%rowtype;
  v_id uuid;
  v_n  int;
begin
  select * into v_wh from warehouses where id = p_warehouse_id;
  if v_wh.id is null then raise exception 'المستودع غير موجود'; end if;
  if not app_has_permission(v_wh.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ الجرد (inventory.count)';
  end if;

  insert into stock_counts (organization_id, branch_id, warehouse_id, count_number,
                            count_type, scope_note, started_by)
  values (v_wh.organization_id, v_wh.branch_id, p_warehouse_id, p_number,
          p_count_type, p_scope_note, auth.uid())
  returning id into v_id;

  -- لقطة الرصيد الدفتري لحظة الفتح
  insert into stock_count_items (organization_id, stock_count_id, item_id, lot_id,
                                 location_id, system_qty, unit_cost)
  select v_wh.organization_id, v_id, l.item_id, l.id, l.location_id,
         l.qty_remaining, l.unit_cost
    from inventory_lots l
   where l.warehouse_id = p_warehouse_id
     and coalesce(l.status, 'available') = 'available'
     and (p_item_ids is null or l.item_id = any(p_item_ids));

  get diagnostics v_n = row_count;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_wh.organization_id, v_wh.branch_id, auth.uid(), 'inventory', 'add', v_id,
          'فتح جرد', format('جرد %s على %s تشغيلة', p_count_type, v_n));

  return v_id;
end $$;

create or replace function app_record_stock_count_line(
  p_count_item_id uuid,
  p_counted_qty   numeric,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ci stock_count_items%rowtype;
  v_c  stock_counts%rowtype;
begin
  select * into v_ci from stock_count_items where id = p_count_item_id for update;
  if v_ci.id is null then raise exception 'بند الجرد غير موجود'; end if;
  select * into v_c from stock_counts where id = v_ci.stock_count_id;
  if not app_has_permission(v_c.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ الجرد (inventory.count)';
  end if;
  if v_c.status not in ('open','counted') then
    raise exception 'الجرد حالته % — لا يُعدَّل', v_c.status;
  end if;
  if coalesce(p_counted_qty, -1) < 0 then
    raise exception 'الكمّية المعدودة لا تكون سالبة';
  end if;

  -- **الفرق يحتاج سببًا**. جردٌ يُقفل بفروقٍ بلا أسباب لا يُصلح شيئًا؛
  -- يحوّل العجز إلى رقمٍ مقبول.
  if p_counted_qty <> v_ci.system_qty and coalesce(trim(p_reason), '') = '' then
    raise exception 'فرق الجرد (% مقابل %) يحتاج سببًا مسجَّلًا',
      p_counted_qty, v_ci.system_qty;
  end if;

  update stock_count_items
     set counted_qty = p_counted_qty, variance_reason = p_reason,
         counted_at = now(), counted_by = auth.uid()
   where id = p_count_item_id;

  update stock_counts
     set status = 'counted', counted_at = now(), counted_by = auth.uid(),
         updated_at = now()
   where id = v_ci.stock_count_id and status = 'open';
end $$;

create or replace function app_approve_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c stock_counts%rowtype;
  v_uncounted int;
begin
  select * into v_c from stock_counts where id = p_count_id for update;
  if v_c.id is null then raise exception 'الجرد غير موجود'; end if;
  if not app_has_permission(v_c.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد تسوية الجرد (inventory.count_approve)';
  end if;
  if v_c.status <> 'counted' then
    raise exception 'لا يُعتمد جرد حالته %', v_c.status;
  end if;
  -- **من عدّ لا يعتمد**: وإلا غُطّي العجز بقلم مَن سبّبه
  if v_c.counted_by is not null and v_c.counted_by = auth.uid() then
    raise exception 'لا يعتمد الجردَ من نفّذه — يلزم معتمِد آخر';
  end if;

  select count(*) into v_uncounted
    from stock_count_items where stock_count_id = p_count_id and counted_qty is null;
  if v_uncounted > 0 then
    raise exception 'بقي % بندًا لم يُعدّ — لا يُعتمد جردٌ ناقص', v_uncounted;
  end if;

  update stock_counts
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         updated_at = now()
   where id = p_count_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_c.organization_id, v_c.branch_id, auth.uid(), 'inventory', 'update',
          p_count_id, 'اعتماد جرد', 'اعتُمدت نتائج الجرد');
end $$;

create or replace function app_post_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c    stock_counts%rowtype;
  v_line record;
  v_n    int := 0;
begin
  select * into v_c from stock_counts where id = p_count_id for update;
  if v_c.id is null then raise exception 'الجرد غير موجود'; end if;
  if not app_has_permission(v_c.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح بترحيل تسوية الجرد (inventory.count_approve)';
  end if;
  -- **الترحيل بعد الاعتماد فقط**: التسوية تغيّر الرصيد، فلا تمرّ بلا إقرار.
  if v_c.status <> 'approved' then
    raise exception 'لا يُرحَّل جرد حالته % — يلزم اعتماده أوّلًا', v_c.status;
  end if;

  for v_line in
    select ci.*, i.name_ar
      from stock_count_items ci
      join items i on i.id = ci.item_id
     where ci.stock_count_id = p_count_id
       and ci.variance_qty <> 0
  loop
    -- التسوية حركةٌ في السجلّ لا تعديلٌ مباشر للرصيد: كل تغيير له أثر
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_c.organization_id, v_c.warehouse_id, v_line.item_id, v_line.lot_id,
            case when v_line.variance_qty > 0 then 'adjustment_in' else 'adjustment_out' end,
            abs(v_line.variance_qty), v_line.unit_cost,
            round(v_line.unit_cost * abs(v_line.variance_qty), 2),
            format('تسوية جرد %s: %s', coalesce(v_c.count_number::text, ''),
                   coalesce(v_line.variance_reason, 'بلا سبب')),
            auth.uid());
    v_n := v_n + 1;
  end loop;

  update stock_counts
     set status = 'posted', posted_at = now(), updated_at = now()
   where id = p_count_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_c.organization_id, v_c.branch_id, auth.uid(), 'inventory', 'update',
          p_count_id, 'ترحيل تسوية جرد', format('سُوّي %s فرقًا', v_n));

  return v_n;
end $$;

-- ===========================================================================
-- 6) الحجر والإتلاف — بدل الحذف
-- ===========================================================================
create or replace function app_quarantine_lot(
  p_lot_id uuid,
  p_reason text,
  p_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_l inventory_lots%rowtype;
begin
  select * into v_l from inventory_lots where id = p_lot_id for update;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_has_permission(v_l.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بحجر التشغيلات (inventory.count)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الحجر مطلوب'; end if;

  -- **الحجر لا يخرج الكمّية من الرصيد** — يمنع صرفها فقط. الإخراج يكون
  -- بإتلافٍ مسجَّل، وإلا اختفت البضاعة من الدفاتر بلا حركة.
  update inventory_lots
     set status = 'quarantined',
         location_id = coalesce(p_location_id, location_id),
         updated_at = now()
   where id = p_lot_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_l.organization_id, auth.uid(), 'inventory', 'update', p_lot_id,
          'حجر تشغيلة', format('حُجرت التشغيلة %s', coalesce(v_l.lot_number::text, '')), p_reason);
end $$;

create or replace function app_dispose_lot(
  p_lot_id uuid,
  p_qty    numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_l inventory_lots%rowtype;
begin
  select * into v_l from inventory_lots where id = p_lot_id for update;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_has_permission(v_l.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح بالإتلاف (inventory.count_approve)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإتلاف مطلوب'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'كمّية الإتلاف يجب أن تكون أكبر من صفر'; end if;
  if p_qty > v_l.qty_remaining then
    raise exception 'كمّية الإتلاف تتجاوز رصيد التشغيلة (%)', v_l.qty_remaining;
  end if;

  insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                   movement_type, qty, unit_price, total_amount,
                                   note, created_by)
  values (v_l.organization_id, v_l.warehouse_id, v_l.item_id, p_lot_id,
          'adjustment_out', p_qty, v_l.unit_cost,
          round(v_l.unit_cost * p_qty, 2),
          format('إتلاف: %s', p_reason), auth.uid());

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_l.organization_id, auth.uid(), 'inventory', 'update', p_lot_id,
          'إتلاف مخزون', format('أُتلف %s من التشغيلة %s', p_qty,
                                coalesce(v_l.lot_number::text, '')), p_reason);
end $$;

-- **الحجر يمنع الصرف**: يُفرض في المُحفِّز لا في الاستعلامات، فلا يفلت
-- مسارٌ نسي شرط الحالة.
create or replace function app_guard_quarantined_lot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if new.lot_id is null then return new; end if;
  if new.movement_type not in ('sale_out','consumption_out','transfer_out') then
    return new;
  end if;
  select status into v_status from inventory_lots where id = new.lot_id;
  if coalesce(v_status, 'available') = 'quarantined' then
    raise exception 'التشغيلة محجورة — لا تُصرف ولا تُحوَّل حتى يُرفع الحجر';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_quarantined_lot on inventory_movements;
create trigger trg_guard_quarantined_lot
  before insert on inventory_movements
  for each row execute function app_guard_quarantined_lot();

-- ===========================================================================
-- 7) تتبّع الدواء من الاستلام حتى الصرف
-- ===========================================================================
create or replace function app_trace_lot(p_lot_id uuid)
returns table (
  step_order   integer,
  step_kind    text,
  occurred_at  timestamptz,
  warehouse_id uuid,
  qty          numeric,
  reference    text,
  patient_id   uuid,
  created_by   uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_l   inventory_lots%rowtype;
  v_ids uuid[];
begin
  select * into v_l from inventory_lots where id = p_lot_id;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_is_member(v_l.organization_id) then
    raise exception 'لا تملك صلاحية على منشأة هذه التشغيلة';
  end if;

  -- **التتبّع يعبر الفروع**: التحويل يُنشئ تشغيلةً جديدة في الوجهة، فلو
  -- اقتصر التتبّع على معرّفٍ واحد لانقطع الخيط عند أوّل تحويل.
  select array_agg(x) into v_ids from (
    select p_lot_id as x
    union
    select sti.received_lot_id from stock_transfer_items sti where sti.lot_id = p_lot_id
    union
    select sti.lot_id from stock_transfer_items sti where sti.received_lot_id = p_lot_id
  ) s where x is not null;

  return query
  select row_number() over (order by m.created_at)::int,
         m.movement_type,
         m.created_at,
         m.warehouse_id,
         m.qty,
         coalesce(m.note, ''),
         m.patient_id,
         m.created_by
    from inventory_movements m
   where m.lot_id = any(v_ids)
   order by m.created_at;
end $$;

-- ===========================================================================
-- 8) المناظير
-- ===========================================================================
drop view if exists v_stock_on_hand_detailed;
create view v_stock_on_hand_detailed
with (security_invoker = on) as
select
  l.id                 as lot_id,
  l.organization_id,
  w.branch_id,
  br.name              as branch_name,
  l.warehouse_id,
  w.name               as warehouse_name,
  l.location_id,
  loc.code             as location_code,
  loc.location_type,
  l.item_id,
  i.name_ar            as item_name,
  i.item_type,
  l.lot_number,
  l.expiry_date,
  l.qty_remaining,
  coalesce(l.reserved_quantity, 0) as reserved_quantity,
  l.qty_remaining - coalesce(l.reserved_quantity, 0) as available_qty,
  l.unit_cost,
  round(l.qty_remaining * l.unit_cost, 2) as stock_value,
  coalesce(l.status, 'available') as lot_status,
  l.received_at        as report_date,
  case when l.expiry_date is not null
       then (l.expiry_date - current_date) end as days_to_expiry,
  (l.expiry_date is not null and l.expiry_date <= current_date) as is_expired
from inventory_lots l
join items i on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join branches br on br.id = w.branch_id
left join warehouse_locations loc on loc.id = l.location_id
where l.qty_remaining > 0;

comment on view v_stock_on_hand_detailed is
  'الرصيد بكل أبعاده: منشأة/فرع/مستودع/موقع/تشغيلة/صلاحية، بالمحجوز والمتاح والقيمة.';

-- `v_stock_movement_age` مبنيّ فوقها ويُعاد إنشاؤه في هذا الملف.
drop view if exists v_stock_valuation cascade;
create view v_stock_valuation
with (security_invoker = on) as
select
  l.organization_id,
  w.branch_id,
  br.name              as branch_name,
  l.warehouse_id,
  w.name               as warehouse_name,
  l.item_id,
  i.name_ar            as item_name,
  i.item_type,
  current_date         as report_date,
  sum(l.qty_remaining) as qty_on_hand,
  sum(coalesce(l.reserved_quantity, 0)) as qty_reserved,
  round(sum(l.qty_remaining * l.unit_cost), 2) as stock_value,
  round(case when sum(l.qty_remaining) > 0
             then sum(l.qty_remaining * l.unit_cost) / sum(l.qty_remaining) end, 4)
                       as weighted_avg_cost,
  min(l.expiry_date)   as earliest_expiry,
  count(*)             as lot_count
from inventory_lots l
join items i on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join branches br on br.id = w.branch_id
where l.qty_remaining > 0 and coalesce(l.status, 'available') = 'available'
group by l.organization_id, w.branch_id, br.name, l.warehouse_id, w.name,
         l.item_id, i.name_ar, i.item_type;

comment on view v_stock_valuation is
  'قيمة المخزون بالتكلفة المرجّحة لكل صنف في كل مستودع. المحجوز ظاهرٌ منفصلًا لأنه مملوك وغير متاح.';

-- الراكد والبطيء: يُقاسان بآخر حركة **خروج**، لا بآخر حركة أيًّا كانت.
-- صنفٌ يُستلم شهريًّا ولا يُصرف أبدًا ليس نشطًا.
drop view if exists v_stock_movement_age;
create view v_stock_movement_age
with (security_invoker = on) as
select
  val.organization_id,
  val.branch_id,
  val.branch_name,
  val.warehouse_id,
  val.warehouse_name,
  val.item_id,
  val.item_name,
  val.report_date,
  val.qty_on_hand,
  val.stock_value,
  mv.last_out_at,
  mv.out_qty_90d,
  case when mv.last_out_at is null then null
       else (current_date - mv.last_out_at::date) end as days_since_last_out,
  case
    when mv.last_out_at is null                                  then 'راكد تمامًا'
    when current_date - mv.last_out_at::date > 180               then 'راكد'
    when current_date - mv.last_out_at::date > 90                then 'بطيء'
    else 'نشط'
  end as movement_class
from v_stock_valuation val
left join lateral (
  select max(m.created_at) as last_out_at,
         sum(m.qty) filter (where m.created_at > now() - interval '90 days') as out_qty_90d
    from inventory_movements m
   where m.item_id = val.item_id
     and m.warehouse_id = val.warehouse_id
     and m.movement_type in ('sale_out','consumption_out','transfer_out')
) mv on true;

comment on view v_stock_movement_age is
  'تصنيف الحركة: نشط/بطيء/راكد — يُقاس بآخر حركة خروج لا بآخر حركة أيًّا كانت، فالاستلام ليس نشاطًا.';

drop view if exists v_reorder_suggestions;
create view v_reorder_suggestions
with (security_invoker = on) as
select
  s.organization_id,
  w.branch_id,
  br.name              as branch_name,
  s.warehouse_id,
  w.name               as warehouse_name,
  s.item_id,
  i.name_ar            as item_name,
  current_date         as report_date,
  s.min_qty,
  s.max_qty,
  s.reorder_level,
  s.reorder_qty,
  s.lead_time_days,
  s.preferred_distributor_id,
  d.name_ar            as preferred_supplier_name,
  coalesce(oh.qty_on_hand, 0)   as qty_on_hand,
  coalesce(oh.qty_reserved, 0)  as qty_reserved,
  coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) as available_qty,
  -- الكمّية المقترحة تُكمل إلى الحدّ الأقصى إن وُجد، وإلا فكمّية الطلب المحدَّدة
  greatest(0, coalesce(s.max_qty, coalesce(s.reorder_qty, s.reorder_level))
              - coalesce(oh.qty_on_hand, 0) + coalesce(oh.qty_reserved, 0))
                       as suggested_qty,
  (coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) <= s.reorder_level)
                       as needs_reorder,
  (coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) < s.min_qty)
                       as below_minimum
from item_stock_settings s
join items i on i.id = s.item_id
join warehouses w on w.id = s.warehouse_id
left join branches br on br.id = w.branch_id
left join distributors d on d.id = s.preferred_distributor_id
left join lateral (
  select sum(l.qty_remaining) as qty_on_hand,
         sum(coalesce(l.reserved_quantity, 0)) as qty_reserved
    from inventory_lots l
   where l.warehouse_id = s.warehouse_id and l.item_id = s.item_id
     and coalesce(l.status, 'available') = 'available'
) oh on true
where s.is_active;

comment on view v_reorder_suggestions is
  'اقتراحات إعادة الطلب بحدود كل مستودع. المتاح = الرصيد ناقص المحجوز، فلا يُطلب صنفٌ رصيده محجوز بالكامل ولا يُترك صنفٌ يبدو موجودًا.';

drop view if exists v_stock_count_variance;
create view v_stock_count_variance
with (security_invoker = on) as
select
  ci.id                as count_item_id,
  c.id                 as stock_count_id,
  c.organization_id,
  c.branch_id,
  c.warehouse_id,
  w.name               as warehouse_name,
  c.count_number,
  c.count_type,
  c.status,
  coalesce(c.posted_at, c.counted_at, c.started_at)::date as report_date,
  ci.item_id,
  i.name_ar            as item_name,
  ci.lot_id,
  l.lot_number,
  l.expiry_date,
  ci.location_id,
  loc.code             as location_code,
  ci.system_qty,
  ci.counted_qty,
  ci.variance_qty,
  ci.unit_cost,
  round(ci.variance_qty * ci.unit_cost, 2) as variance_value,
  ci.variance_reason,
  ci.counted_by,
  c.approved_by
from stock_count_items ci
join stock_counts c on c.id = ci.stock_count_id
join items i on i.id = ci.item_id
join warehouses w on w.id = c.warehouse_id
left join inventory_lots l on l.id = ci.lot_id
left join warehouse_locations loc on loc.id = ci.location_id;

comment on view v_stock_count_variance is
  'فروقات الجرد بقيمتها وسببها ومَن عدّها ومَن اعتمدها.';

drop view if exists v_transfer_pipeline;
create view v_transfer_pipeline
with (security_invoker = on) as
select
  t.id                 as transfer_id,
  t.organization_id,
  t.from_branch_id     as branch_id,
  fb.name              as from_branch_name,
  tb.name              as to_branch_name,
  t.transfer_number::text as transfer_number,
  t.status,
  t.requested_at::date as report_date,
  t.from_warehouse_id,
  fw.name              as from_warehouse_name,
  t.to_warehouse_id,
  tw.name              as to_warehouse_name,
  t.requested_by,
  t.approved_by,
  t.shipped_at,
  t.received_at,
  t.reason,
  t.rejected_reason,
  agg.line_count,
  agg.qty_requested,
  agg.qty_shipped,
  agg.qty_received,
  (coalesce(agg.qty_shipped, 0) - coalesce(agg.qty_received, 0)) as qty_in_transit,
  case when t.shipped_at is not null and t.received_at is not null
       then round(extract(epoch from (t.received_at - t.shipped_at)) / 3600.0, 1) end
                       as transit_hours
from stock_transfers t
left join warehouses fw on fw.id = t.from_warehouse_id
left join warehouses tw on tw.id = t.to_warehouse_id
left join branches fb on fb.id = t.from_branch_id
left join branches tb on tb.id = t.to_branch_id
left join lateral (
  select count(*) as line_count, sum(qty) as qty_requested,
         sum(qty_shipped) as qty_shipped, sum(qty_received) as qty_received
    from stock_transfer_items where transfer_id = t.id
) agg on true;

comment on view v_transfer_pipeline is
  'مسار التحويلات: المطلوب والمشحون والمستلَم، وما هو في الطريق، ومدّة العبور.';

grant select on v_stock_on_hand_detailed, v_stock_valuation, v_stock_movement_age,
                v_reorder_suggestions, v_stock_count_variance, v_transfer_pipeline
  to authenticated;

-- ===========================================================================
-- 9) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['warehouse_locations','item_stock_settings',
                               'stock_counts','stock_count_items']) as t
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

-- الجرد المرحَّل لا يُحذف
create or replace function app_block_posted_count_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('approved','posted') then
    raise exception 'الجرد المعتمَد أو المرحَّل لا يُحذف';
  end if;
  return old;
end $$;

drop trigger if exists trg_block_count_delete on stock_counts;
create trigger trg_block_count_delete
  before delete on stock_counts
  for each row execute function app_block_posted_count_delete();

-- ===========================================================================
-- 10) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_approve_stock_transfer','app_reject_stock_transfer',
                             'app_ship_stock_transfer','app_receive_stock_transfer',
                             'app_start_stock_count','app_record_stock_count_line',
                             'app_approve_stock_count','app_post_stock_count',
                             'app_quarantine_lot','app_dispose_lot','app_trace_lot']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المخزون % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where indexname = 'uq_one_open_count_per_warehouse') then
    raise exception 'لا حارس ضدّ جردين متزامنين على مستودع واحد';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_quarantined_lot') then
    raise exception 'الحجر لا يمنع الصرف — الحارس غير مركَّب';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'stock_count_items' and column_name = 'variance_qty') then
    raise exception 'فرق الجرد غير محسوب';
  end if;
end $$;
