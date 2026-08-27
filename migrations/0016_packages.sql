-- ============================================================================
-- 0016_packages.sql — الباقات (Packages)
-- رابع وآخر موديول من مجموعة "المختبر/الأشعة/الصيدلية/الباقات" التي اختارها
-- المستخدم أولًا. الباقة تختلف عن "اتفاقية العلاج" (treatment_agreements، 0003)
-- في أنها كتالوج مُعرَّف مسبقًا بسعر وعدد جلسات ثابتين يُباع كوحدة واحدة (مثال:
-- "باقة تنظيف الأسنان ×4 جلسات")، بينما الاتفاقية خطة علاج حرة تُبنى لكل مريض على
-- حدة. لا تُكرِّر هذه الملف آلية السداد التراكمي من treatment_agreements — الباقة
-- تُباع دفعة واحدة عبر فاتورة مبيعات عادية (sales_invoices الموجود)، وما يُضاف هنا
-- فقط هو تتبّع "الاستهلاك" (كم جلسة استُخدمت من كل صنف داخل الباقة).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) كتالوج الباقات وبنودها
-- ---------------------------------------------------------------------------
create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text,
  name_ar text not null,
  name_en text,
  price numeric(12,2) not null default 0,
  validity_days int,              -- عدد أيام صلاحية الباقة من تاريخ الشراء؛ null = بلا انتهاء
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_packages_org on packages(organization_id);

create table if not exists package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  quantity_included numeric(12,2) not null default 1, -- عدد الجلسات/الوحدات المشمولة لهذا الصنف داخل الباقة
  unique (package_id, item_id)
);

-- ---------------------------------------------------------------------------
-- 2) اشتراك المريض في باقة — تُباع عبر فاتورة مبيعات عادية (sales_invoices)
-- ---------------------------------------------------------------------------
create table if not exists patient_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  package_id uuid not null references packages(id) on delete restrict,
  sales_invoice_id uuid references sales_invoices(id) on delete set null,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,          -- يُحسَب تلقائيًا من purchased_at + validity_days عند الإنشاء
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_packages_org on patient_packages(organization_id);
create index if not exists idx_patient_packages_patient on patient_packages(patient_id);

-- عند إنشاء اشتراك جديد، اُحسب expires_at تلقائيًا من validity_days الباقة (إن وُجد)
create or replace function app_set_patient_package_expiry()
returns trigger
language plpgsql
as $$
declare
  days int;
begin
  select validity_days into days from packages where id = new.package_id;
  if days is not null and new.expires_at is null then
    new.expires_at := new.purchased_at + (days || ' days')::interval;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_patient_package_expiry on patient_packages;
create trigger trg_set_patient_package_expiry
before insert on patient_packages
for each row execute function app_set_patient_package_expiry();

-- ---------------------------------------------------------------------------
-- 3) استهلاك الباقة — كل استخدام لجلسة/وحدة من صنف داخل الباقة
-- ---------------------------------------------------------------------------
create table if not exists patient_package_usages (
  id uuid primary key default gen_random_uuid(),
  patient_package_id uuid not null references patient_packages(id) on delete cascade,
  package_item_id uuid not null references package_items(id) on delete restrict,
  quantity_used numeric(12,2) not null default 1,
  appointment_id uuid references appointments(id) on delete set null,
  used_at timestamptz not null default now(),
  used_by uuid references auth.users(id),
  note text
);
create index if not exists idx_patient_package_usages_subscription on patient_package_usages(patient_package_id);

-- ---------------------------------------------------------------------------
-- 4) Trigger حماية: يمنع استهلاك أكثر من المتبقي في الباقة، ويمنع الاستهلاك
--    من باقة منتهية الصلاحية أو ملغاة — فحص إلزامي في قاعدة البيانات، لا في
--    الواجهة فقط (نفس فلسفة chk_salary_requires_employee من 0008)
-- ---------------------------------------------------------------------------
create or replace function app_validate_package_usage()
returns trigger
language plpgsql
as $$
declare
  included numeric;
  already_used numeric;
  sub patient_packages;
begin
  select * into sub from patient_packages where id = new.patient_package_id;
  if sub.status <> 'active' then
    raise exception 'لا يمكن الاستهلاك من باقة غير نشطة (الحالة الحالية: %)', sub.status;
  end if;
  if sub.expires_at is not null and sub.expires_at < now() then
    raise exception 'انتهت صلاحية هذه الباقة بتاريخ %', sub.expires_at;
  end if;

  select quantity_included into included from package_items where id = new.package_item_id;
  select coalesce(sum(quantity_used), 0) into already_used
  from patient_package_usages
  where package_item_id = new.package_item_id and patient_package_id = new.patient_package_id;

  if already_used + new.quantity_used > included then
    raise exception 'الكمية المطلوبة (%) تتجاوز المتبقي في الباقة (المتاح: %)', new.quantity_used, included - already_used;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_package_usage on patient_package_usages;
create trigger trg_validate_package_usage
before insert on patient_package_usages
for each row execute function app_validate_package_usage();

-- ---------------------------------------------------------------------------
-- 5) عرض حيّ: أرصدة باقات المريض (المتبقي من كل صنف في كل باقة نشطة)
-- ---------------------------------------------------------------------------
create or replace view v_patient_package_balances as
select
  pp.id as patient_package_id,
  pp.organization_id,
  pp.patient_id,
  pt.name_ar as patient_name,
  pp.package_id,
  pk.name_ar as package_name,
  pp.status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  pi.id as package_item_id,
  pi.item_id,
  it.name_ar as item_name,
  pi.quantity_included,
  coalesce(sum(u.quantity_used), 0) as quantity_used,
  pi.quantity_included - coalesce(sum(u.quantity_used), 0) as quantity_remaining
from patient_packages pp
join patients pt on pt.id = pp.patient_id
join packages pk on pk.id = pp.package_id
join package_items pi on pi.package_id = pp.package_id
join items it on it.id = pi.item_id
left join patient_package_usages u on u.package_item_id = pi.id and u.patient_package_id = pp.id
group by pp.id, pp.organization_id, pp.patient_id, pt.name_ar, pp.package_id, pk.name_ar, pp.status,
         pp.purchased_at, pp.expires_at, pi.id, pi.item_id, it.name_ar, pi.quantity_included;

-- ---------------------------------------------------------------------------
-- Row Level Security — نفس نمط كل الجداول السريرية/المالية: أعضاء المؤسسة فقط
-- ---------------------------------------------------------------------------
alter table packages enable row level security;
alter table package_items enable row level security;
alter table patient_packages enable row level security;
alter table patient_package_usages enable row level security;

create policy "packages_all_members" on packages
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "package_items_all_members" on package_items
  for all using (
    exists (select 1 from packages pk where pk.id = package_items.package_id and app_is_member(pk.organization_id))
  )
  with check (
    exists (select 1 from packages pk where pk.id = package_items.package_id and app_is_member(pk.organization_id))
  );

create policy "patient_packages_all_members" on patient_packages
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "patient_package_usages_all_members" on patient_package_usages
  for all using (
    exists (select 1 from patient_packages pp where pp.id = patient_package_usages.patient_package_id and app_is_member(pp.organization_id))
  )
  with check (
    exists (select 1 from patient_packages pp where pp.id = patient_package_usages.patient_package_id and app_is_member(pp.organization_id))
  );

-- ============================================================================
-- نهاية 0016_packages.sql — نهاية المجموعة الأولى من المرحلة 4
-- (المختبر 0013 · الأشعة 0014 · الصيدلية/الوصفات/الصرف 0015 · الباقات 0016)
-- التالي حسب ترتيب المستخدم: مجموعة الإدارة (المحاسبة/المشتريات/المخزون/الرسائل/
-- سجل التدقيق/رحلة المريض)، ثم الموارد البشرية الموسّعة أخيرًا.
-- ============================================================================
