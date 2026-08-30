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
