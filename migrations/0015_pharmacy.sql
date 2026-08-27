-- ============================================================================
-- 0015_pharmacy.sql — الصيدلية + الأدوية والوصفات + صرف الأدوية
-- ثالث موديول من المجموعة الطبية الجديدة، ويُبنى كوحدة واحدة متصلة (بدل ثلاث
-- مراحل منفصلة) لأن الثلاثة يتشاركون مخططًا واحدًا حرفيًا: كتالوج الدواء ← وصفة
-- طبية ← صرف فعلي يُنقِص المخزون. لا تكرار لكتالوج الأصناف أو المخزون — هذا
-- الملف يمتدّ فوق ما بُني أصلًا في 0003 (جدول items الموحّد بـ item_type='drug'،
-- وinventory_lots/inventory_movements الموجودين بالفعل بـ movement_type
-- 'consumption_out' المناسب تمامًا لصرف دواء لمريض دون أي تعديل على 0003).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) تفاصيل الدواء — امتداد 1:1 لجدول items الموجود (نفس نمط امتداد dental_lab_items)
--    لا يُكرَّر الاسم/السعر/تتبّع المخزون الموجودين أصلًا في items
-- ---------------------------------------------------------------------------
create table if not exists drug_details (
  item_id uuid primary key references items(id) on delete cascade,
  generic_name text,
  dosage_form text not null default 'tablet' check (dosage_form in (
    'tablet','capsule','syrup','injection','cream','ointment','drops','inhaler','suppository','other'
  )),
  strength_text text,                         -- مثال: "500mg" أو "5ml/شربة"
  is_controlled_substance boolean not null default false,
  requires_prescription boolean not null default true,
  default_dosage_instructions text            -- نص افتراضي يُقترَح تلقائيًا عند كتابة وصفة لهذا الدواء
);

-- ضمان أن drug_details لا يُربَط إلا بصنف من نوع "دواء" فعليًا من items
create or replace function app_validate_drug_details_item_type()
returns trigger
language plpgsql
as $$
declare
  actual_type text;
begin
  select item_type into actual_type from items where id = new.item_id;
  if actual_type is distinct from 'drug' then
    raise exception 'drug_details.item_id يجب أن يشير إلى صنف من نوع drug في جدول items (النوع الحالي: %)', actual_type;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_drug_details_item_type on drug_details;
create trigger trg_validate_drug_details_item_type
before insert or update of item_id on drug_details
for each row execute function app_validate_drug_details_item_type();

-- ---------------------------------------------------------------------------
-- 2) الوصفات الطبية
-- ---------------------------------------------------------------------------
create table if not exists prescriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  status text not null default 'issued' check (status in (
    'draft','issued','partially_dispensed','dispensed','cancelled'
  )),
  issued_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_prescriptions_org on prescriptions(organization_id);
create index if not exists idx_prescriptions_patient on prescriptions(patient_id);
create index if not exists idx_prescriptions_status on prescriptions(organization_id, status);

create table if not exists prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  drug_item_id uuid not null references items(id) on delete restrict,
  dosage_instructions text,
  frequency text,                    -- مثال: "مرتين يوميًا"
  duration_days int,
  route text default 'oral' check (route in (
    'oral','topical','injection','inhalation','rectal','ophthalmic','otic','nasal','other'
  )),
  quantity_prescribed numeric(12,2) not null default 1,
  dispensed_quantity numeric(12,2) not null default 0, -- تُحدَّث تلقائيًا عبر Trigger من dispensing_items
  is_substitutable boolean not null default true,      -- يسمح للصيدلي باستبدال الدواء بمكافئ علمي
  created_at timestamptz not null default now()
);
create index if not exists idx_prescription_items_prescription on prescription_items(prescription_id);

-- ---------------------------------------------------------------------------
-- 3) الصرف الفعلي — سجل صرف واحد قد يخدم وصفة كاملة أو جزءًا منها، أو بيعًا
--    مباشرًا بلا وصفة (دواء لا يحتاج وصفة، prescription_id = null)
-- ---------------------------------------------------------------------------
create table if not exists dispensing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  prescription_id uuid references prescriptions(id) on delete set null,
  patient_id uuid not null references patients(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  pharmacist_id uuid references auth.users(id),
  sales_invoice_id uuid references sales_invoices(id) on delete set null,
  status text not null default 'completed' check (status in ('completed','cancelled')),
  dispensed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_dispensing_records_org on dispensing_records(organization_id);
create index if not exists idx_dispensing_records_prescription on dispensing_records(prescription_id);

create table if not exists dispensing_items (
  id uuid primary key default gen_random_uuid(),
  dispensing_record_id uuid not null references dispensing_records(id) on delete cascade,
  prescription_item_id uuid references prescription_items(id) on delete set null,
  drug_item_id uuid not null references items(id) on delete restrict,
  lot_id uuid references inventory_lots(id) on delete set null,
  quantity_dispensed numeric(12,2) not null,
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_dispensing_items_record on dispensing_items(dispensing_record_id);

-- ---------------------------------------------------------------------------
-- 4) Trigger: عند تسجيل بند صرف، يُنشئ تلقائيًا حركة مخزون (consumption_out)
--    باستخدام آلية inventory_movements الموجودة أصلًا من 0003 — الـ Trigger
--    الموجود هناك (app_apply_inventory_movement) سيُنقِص qty_remaining في
--    الدفعة تلقائيًا بمجرد إدراج هذه الحركة، فيتسلسل المنطق بلا أي تعديل على 0003.
--    كما يُحدِّث الكمية المصروفة في بند الوصفة المرتبط إن وُجد.
-- ---------------------------------------------------------------------------
create or replace function app_apply_dispensing_item()
returns trigger
language plpgsql
security definer
as $$
declare
  rec dispensing_records;
begin
  select * into rec from dispensing_records where id = new.dispensing_record_id;

  insert into inventory_movements (
    organization_id, warehouse_id, item_id, lot_id, movement_type,
    qty, unit_price, total_amount, related_sales_invoice_id, patient_id, created_by
  ) values (
    rec.organization_id, rec.warehouse_id, new.drug_item_id, new.lot_id, 'consumption_out',
    new.quantity_dispensed, new.unit_price, new.quantity_dispensed * new.unit_price,
    rec.sales_invoice_id, rec.patient_id, rec.pharmacist_id
  );

  if new.prescription_item_id is not null then
    update prescription_items
    set dispensed_quantity = dispensed_quantity + new.quantity_dispensed
    where id = new.prescription_item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_dispensing_item on dispensing_items;
create trigger trg_apply_dispensing_item
after insert on dispensing_items
for each row execute function app_apply_dispensing_item();

-- ---------------------------------------------------------------------------
-- 5) Trigger: إعادة حساب حالة الوصفة تلقائيًا بعد كل تحديث للكمية المصروفة
--    في أحد بنودها (dispensed بالكامل / partially_dispensed / تبقى issued لو صفر)
-- ---------------------------------------------------------------------------
create or replace function app_recalc_prescription_status()
returns trigger
language plpgsql
security definer
as $$
declare
  target_prescription_id uuid;
  all_fully_dispensed boolean;
  any_dispensed boolean;
begin
  target_prescription_id := new.prescription_id;

  select
    bool_and(dispensed_quantity >= quantity_prescribed),
    bool_or(dispensed_quantity > 0)
  into all_fully_dispensed, any_dispensed
  from prescription_items
  where prescription_id = target_prescription_id;

  update prescriptions
  set status = case
    when all_fully_dispensed then 'dispensed'
    when any_dispensed then 'partially_dispensed'
    else status
  end
  where id = target_prescription_id and status <> 'cancelled';

  return new;
end;
$$;

drop trigger if exists trg_recalc_prescription_status on prescription_items;
create trigger trg_recalc_prescription_status
after update of dispensed_quantity on prescription_items
for each row execute function app_recalc_prescription_status();

-- ---------------------------------------------------------------------------
-- 6) عرض حيّ: الوصفات التي لم تُصرَف بالكامل — لشاشة الصيدلية
-- ---------------------------------------------------------------------------
create or replace view v_prescriptions_pending_dispensing as
select
  pr.id as prescription_id,
  pr.organization_id,
  pr.patient_id,
  p.name_ar as patient_name,
  pr.doctor_id,
  d.name_ar as doctor_name,
  pr.status,
  pr.issued_at,
  count(pi.id) as items_count,
  count(pi.id) filter (where pi.dispensed_quantity >= pi.quantity_prescribed) as fully_dispensed_items_count
from prescriptions pr
join patients p on p.id = pr.patient_id
left join doctors d on d.id = pr.doctor_id
left join prescription_items pi on pi.prescription_id = pr.id
where pr.status in ('issued','partially_dispensed')
group by pr.id, pr.organization_id, pr.patient_id, p.name_ar, pr.doctor_id, d.name_ar, pr.status, pr.issued_at;

-- ---------------------------------------------------------------------------
-- 7) عرض حيّ: دفعات دواء متاحة للصرف (غير منتهية ومتبقٍ منها كمية) — لاختيار
--    الصيدلي أثناء الصرف (FIFO حسب تاريخ الانتهاء الأقرب)
-- ---------------------------------------------------------------------------
create or replace view v_available_drug_lots as
select
  l.id as lot_id,
  l.organization_id,
  l.warehouse_id,
  l.item_id,
  l.lot_number,
  l.qty_remaining,
  l.expiry_date,
  l.unit_cost
from inventory_lots l
join items i on i.id = l.item_id
where i.item_type = 'drug' and l.qty_remaining > 0
order by l.expiry_date nulls last;

-- ---------------------------------------------------------------------------
-- Row Level Security — نفس نمط كل الجداول السريرية: أعضاء المؤسسة فقط
-- ---------------------------------------------------------------------------
alter table drug_details enable row level security;
alter table prescriptions enable row level security;
alter table prescription_items enable row level security;
alter table dispensing_records enable row level security;
alter table dispensing_items enable row level security;

create policy "drug_details_all_members" on drug_details
  for all using (
    exists (select 1 from items i where i.id = drug_details.item_id and app_is_member(i.organization_id))
  )
  with check (
    exists (select 1 from items i where i.id = drug_details.item_id and app_is_member(i.organization_id))
  );

create policy "prescriptions_all_members" on prescriptions
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "prescription_items_all_members" on prescription_items
  for all using (
    exists (select 1 from prescriptions pr where pr.id = prescription_items.prescription_id and app_is_member(pr.organization_id))
  )
  with check (
    exists (select 1 from prescriptions pr where pr.id = prescription_items.prescription_id and app_is_member(pr.organization_id))
  );

create policy "dispensing_records_all_members" on dispensing_records
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "dispensing_items_all_members" on dispensing_items
  for all using (
    exists (select 1 from dispensing_records r where r.id = dispensing_items.dispensing_record_id and app_is_member(r.organization_id))
  )
  with check (
    exists (select 1 from dispensing_records r where r.id = dispensing_items.dispensing_record_id and app_is_member(r.organization_id))
  );

-- ============================================================================
-- نهاية 0015_pharmacy.sql
-- ============================================================================
