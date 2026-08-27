-- ============================================================================
-- 0007_dental_lab.sql
-- المرحلة 2 (تابع) — معامل الأسنان (Dental Lab) — موديول اختياري خاص بعيادات الأسنان
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0006 مباشرة (يعتمد عليها جميعًا، وتحديدًا على `distributors`
-- و`tooth_shade_guides`/`tooth_shades` من 0003، وعلى `patient_visits` من 0006)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- تذكير معماري (من 0003): مورد معمل الأسنان هو صف في `distributors` بعمود
-- is_dental_lab = true، وليس كيانًا منفصلًا بالكامل — هذا الملف يبني الطلبيات
-- والكتالوج والأرصدة فوق ذلك القرار مباشرة.
--
-- يغطي هذا الملف:
--   1) كتالوج خدمات كل معمل (Vendor Catalog) — منفصل عن كتالوج الأصناف الداخلي
--   2) طلبيات معامل الأسنان (رأس + بنود) مربوطة باللون/الدليل ورقم/أرقام الأسنان
--   3) ربط مالي: تسجيل مصروف مباشر من شاشة الطلبية (عمود جديد على financial_vouchers)
--   4) أرصدة معامل الأسنان (View حي، بدل تقرير مخزَّن قد يفقد التزامن)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) كتالوج خدمات كل معمل (IMPLANT, ZIRCON CROWN, VENEER, DENTURE ...)
-- ---------------------------------------------------------------------------
create table if not exists dental_lab_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete cascade,
  name_ar text not null,
  name_en text,
  price numeric(12,2) not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_dental_lab_items_distributor on dental_lab_items (distributor_id);

-- ---------------------------------------------------------------------------
-- 2) طلبيات معامل الأسنان — رأس الطلب
--    remaining_amount محسوب تلقائيًا؛ paid_amount يُحدَّث تلقائيًا من السندات
--    المرتبطة (انظر قسم 3 أدناه) بنفس نمط sales_invoices/voucher_invoice_allocations من 0003
-- ---------------------------------------------------------------------------
create table if not exists dental_lab_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete restrict,   -- يجب أن يكون is_dental_lab = true
  order_number bigserial,
  order_date date not null default current_date,
  delivery_date date,
  lab_invoice_number text,
  patient_id uuid references patients(id) on delete set null,
  doctor_id uuid references doctors(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,     -- ربط بزيارة الفحص/لوحة الأسنان من 0006
  shade_guide_id uuid references tooth_shade_guides(id) on delete set null,
  shade_id uuid references tooth_shades(id) on delete set null,        -- اللون الافتراضي للطلبية كاملة
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  remaining_amount numeric(12,2) generated always as (total_amount - paid_amount) stored,
  status text not null default 'pending' check (status in ('pending','in_progress','delivered','cancelled')),
  received_date date,
  received_by text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number)
);
create index if not exists idx_dental_lab_orders_org on dental_lab_orders (organization_id, order_date desc);
create index if not exists idx_dental_lab_orders_patient on dental_lab_orders (patient_id);

-- بنود الطلبية — أرقام الأسنان المحددة (FDI) لكل بند، مع لون خاص بالبند إن اختلف عن لون الطلبية العام
create table if not exists dental_lab_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references dental_lab_orders(id) on delete cascade,
  dental_lab_item_id uuid references dental_lab_items(id) on delete set null,
  description text,
  tooth_numbers text[] not null default '{}',
  shade_id uuid references tooth_shades(id) on delete set null,
  price numeric(12,2) not null default 0,
  qty numeric(12,2) not null default 1,
  discount_percent numeric(5,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_dental_lab_order_items_order on dental_lab_order_items (order_id);
create index if not exists idx_dental_lab_order_items_teeth on dental_lab_order_items using gin (tooth_numbers);

-- ---------------------------------------------------------------------------
-- 3) ربط مالي: "تسجيل مصروف مباشر من شاشة الطلبية" (موثّق في المراجعة)
--    نضيف عمودًا اختياريًا على financial_vouchers (من 0003) بدل جدول موازٍ جديد
-- ---------------------------------------------------------------------------
alter table financial_vouchers
  add column if not exists dental_lab_order_id uuid references dental_lab_orders(id) on delete set null;
create index if not exists idx_vouchers_dental_lab_order on financial_vouchers (dental_lab_order_id) where dental_lab_order_id is not null;

-- إعادة حساب "المدفوع" في الطلبية تلقائيًا من مجموع سندات الصرف المرتبطة بها
create or replace function app_recalc_dental_lab_order_paid(target_order uuid)
returns void
language plpgsql
security definer
as $$
begin
  if target_order is null then
    return;
  end if;
  update dental_lab_orders
    set paid_amount = coalesce((
          select sum(v.amount) from financial_vouchers v
          where v.dental_lab_order_id = target_order and v.voucher_type = 'expense'
        ), 0),
        updated_at = now()
    where id = target_order;
end;
$$;

-- ملاحظة أمان: نفس نمط التفرّع الصريح حسب TG_OP المعتمد منذ 0003 لتفادي خطأ
-- "record NEW/OLD is not assigned yet" عند التنفيذ الفعلي على DELETE/INSERT
create or replace function app_apply_dental_lab_voucher()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op in ('DELETE','UPDATE') then
    perform app_recalc_dental_lab_order_paid(old.dental_lab_order_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform app_recalc_dental_lab_order_paid(new.dental_lab_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;
drop trigger if exists trg_dental_lab_voucher_apply on financial_vouchers;
create trigger trg_dental_lab_voucher_apply
  after insert or update or delete on financial_vouchers
  for each row execute function app_apply_dental_lab_voucher();

-- ---------------------------------------------------------------------------
-- 4) أرصدة معامل الأسنان (View حي — إجمالي طلبيات/مدفوعات/متبقي لكل معمل)
-- ---------------------------------------------------------------------------
create or replace view dental_lab_balances as
select
  d.id as distributor_id,
  d.organization_id,
  d.name_ar,
  coalesce(sum(o.total_amount), 0) as total_orders,
  coalesce(sum(o.paid_amount), 0) as total_paid,
  coalesce(sum(o.total_amount), 0) - coalesce(sum(o.paid_amount), 0) as balance_due
from distributors d
left join dental_lab_orders o on o.distributor_id = d.id
where d.is_dental_lab = true
group by d.id, d.organization_id, d.name_ar;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table dental_lab_items enable row level security;
alter table dental_lab_orders enable row level security;
alter table dental_lab_order_items enable row level security;

create policy "dental_lab_items_all_members" on dental_lab_items
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "dental_lab_orders_all_members" on dental_lab_orders
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "dental_lab_order_items_all_members" on dental_lab_order_items
  for all using (exists (select 1 from dental_lab_orders o where o.id = dental_lab_order_items.order_id and app_is_member(o.organization_id)))
  with check (exists (select 1 from dental_lab_orders o where o.id = dental_lab_order_items.order_id and app_is_member(o.organization_id)));

-- ملاحظة: dental_lab_balances هو View فوق جداول محمية أصلًا بـ RLS (distributors
-- من 0003 و dental_lab_orders أعلاه) — Postgres يطبّق سياسات الجداول الأساسية
-- تلقائيًا عند الاستعلام من الـ View (Security Invoker الافتراضي)، فلا حاجة لأي
-- سياسة إضافية عليه.

-- ============================================================================
-- نهاية 0007_dental_lab.sql
-- الخطوة التالية: 0008_hr_payroll.sql
--   (جدول employees الفعلي + ربط employee_ref_id في financial_vouchers من 0003،
--    تراخيص/وثائق الموظفين عبر expiring_alerts، صرف الرواتب كسند صرف خاص)
-- ============================================================================
