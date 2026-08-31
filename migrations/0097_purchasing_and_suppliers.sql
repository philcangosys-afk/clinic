-- ============================================================================
-- 0097 — المرحلة 17: المشتريات والموردون
-- ============================================================================
--
-- **ما كان قائمًا**: `distributors` و`purchase_invoices` وبنودها بتشغيلاتها
-- وصلاحياتها، والفاتورة تُدخل المخزون. أي أن النظام يعرف **الفاتورة** ولا
-- يعرف ما قبلها.
--
-- **ما ينقصه — وهو موضع الخسارة**:
--
--   • لا طلب شراء ولا موافقة: يشتري من يشاء بما يشاء، ويُكتشف الأمر في
--     الفاتورة حين لا يبقى إلا الدفع.
--   • لا أمر شراء: لا مرجع يُقاس عليه المستلَم، فالاستلام بأكثر من المطلوب
--     لا يُكتشف أصلًا.
--   • لا استلام منفصل عن الفوترة: البضاعة تصل اليوم والفاتورة بعد أسبوع،
--     فإمّا يدخل المخزون بلا مستند وإمّا يتأخّر الصرف أسبوعًا.
--   • لا مرتجع مشتريات ولا مصروفات شحن: تكلفة الصنف في الدفاتر أقلّ من
--     تكلفته الحقيقية، فيبدو هامش الربح أكبر ممّا هو.
--   • لا كشف حساب مورد: المستحقّ والمدفوع لا يُعرفان إلا بالجمع اليدويّ.
--
-- **التسلسل المنفَّذ**:
--   طلب شراء → موافقة (حسب القيمة) → أمر شراء → استلام مخزني (جزئي أو كامل)
--   → فاتورة مورد → استحقاق ماليّ → دفع المورد
--
-- **لا حذف**: كل مستند يُلغى بحالة وسبب، ولا يُمحى.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('purchasing.view',        'عرض المشتريات',              'purchasing', 1000),
  ('purchasing.request',     'إنشاء طلب شراء',             'purchasing', 1002),
  ('purchasing.approve',     'اعتماد طلبات الشراء',        'purchasing', 1004),
  ('purchasing.order',       'إصدار أوامر الشراء',         'purchasing', 1006),
  ('purchasing.receive',     'الاستلام المخزني',           'purchasing', 1008),
  ('purchasing.over_receive','الاستلام بأكثر من المطلوب',  'purchasing', 1010),
  ('purchasing.invoice',     'تسجيل فواتير الموردين',      'purchasing', 1012),
  ('purchasing.return',      'مرتجع المشتريات',            'purchasing', 1014),
  ('suppliers.manage',       'إدارة الموردين',             'purchasing', 1016),
  ('suppliers.pay',          'دفع مستحقات الموردين',       'purchasing', 1018)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **الاستلام الزائد صلاحية مستقلّة**، لا تابعة للاستلام: من يستلم ليس من
-- يقرّر قبول فائضٍ لم يُطلب.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'purchasing.view'), ('accountant', 'purchasing.request'),
  ('accountant',     'purchasing.invoice'), ('accountant', 'purchasing.return'),
  ('accountant',     'suppliers.manage'), ('accountant', 'suppliers.pay'),
  ('branch_manager', 'purchasing.view'), ('branch_manager', 'purchasing.request'),
  ('branch_manager', 'purchasing.approve'), ('branch_manager', 'purchasing.order'),
  ('branch_manager', 'purchasing.receive'), ('branch_manager', 'purchasing.over_receive'),
  ('branch_manager', 'purchasing.invoice'), ('branch_manager', 'purchasing.return'),
  ('branch_manager', 'suppliers.manage'), ('branch_manager', 'suppliers.pay'),
  ('pharmacist',     'purchasing.view'), ('pharmacist', 'purchasing.request'),
  ('pharmacist',     'purchasing.receive')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) ملف المورد
-- ===========================================================================
alter table distributors
  add column if not exists legal_name         text,
  add column if not exists commercial_register text,
  add column if not exists bank_name          text,
  add column if not exists bank_iban          text,
  add column if not exists bank_account_name  text,
  add column if not exists payment_terms_days integer not null default 0,
  add column if not exists credit_limit       numeric(14,2),
  add column if not exists allowed_branch_ids uuid[],
  add column if not exists is_archived        boolean not null default false,
  add column if not exists archived_at        timestamptz,
  add column if not exists archived_by        uuid references auth.users(id),
  add column if not exists created_by         uuid references auth.users(id),
  add column if not exists updated_by         uuid references auth.users(id);

comment on column distributors.payment_terms_days is
  'مهلة السداد بالأيام من تاريخ الفاتورة. تُشتقّ منها تواريخ الاستحقاق في كشف الحساب، فلا يُحسب التأخير بالتقدير.';
comment on column distributors.bank_iban is
  'الآيبان للتحويل. **ليس سرًّا** — بيانات تحويلٍ يعرفها المورد نفسه؛ ولا تُحفظ هنا أي بيانات دخول أو مفاتيح.';

-- ===========================================================================
-- 3) قواعد الاعتماد حسب القيمة
-- ===========================================================================
create table if not exists purchase_approval_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  min_amount       numeric(14,2) not null default 0,
  max_amount       numeric(14,2),
  required_role_key text not null,
  approval_level   integer not null default 1,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  constraint purchase_approval_rules_range_check
    check (max_amount is null or max_amount > min_amount)
);

comment on table purchase_approval_rules is
  'دورة موافقات المشتريات حسب القيمة. الشريحة تُحدَّد بحدَّين، والمستوى يسمح بتسلسل موافقات لا موافقةً واحدة.';

alter table purchase_approval_rules enable row level security;

-- ===========================================================================
-- 4) طلب الشراء
-- ===========================================================================
create table if not exists purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  warehouse_id     uuid references warehouses(id),
  request_number   text,
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','partially_approved',
                                       'rejected','ordered','cancelled')),
  needed_by        date,
  justification    text,
  estimated_total  numeric(14,2) not null default 0,
  requested_by     uuid references auth.users(id),
  submitted_at     timestamptz,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  approval_note    text,
  rejected_reason  text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

create table if not exists purchase_request_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  item_id             uuid not null references items(id),
  qty_requested       numeric(14,3) not null check (qty_requested > 0),
  qty_approved        numeric(14,3),
  estimated_price     numeric(14,2),
  note                text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_pr_org_status
  on purchase_requests (organization_id, status, created_at desc);
create index if not exists idx_pri_request on purchase_request_items (purchase_request_id);

alter table purchase_requests enable row level security;
alter table purchase_request_items enable row level security;

-- ===========================================================================
-- 5) أمر الشراء
-- ===========================================================================
create table if not exists purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid references branches(id),
  warehouse_id        uuid references warehouses(id),
  distributor_id      uuid not null references distributors(id),
  purchase_request_id uuid references purchase_requests(id),
  order_number        text,
  status              text not null default 'draft'
                        check (status in ('draft','sent','partially_received','received',
                                          'invoiced','closed','cancelled')),
  order_date          date not null default current_date,
  expected_date       date,
  payment_terms_days  integer,
  subtotal_amount     numeric(14,2) not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  note                text,
  sent_at             timestamptz,
  closed_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);

create table if not exists purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_id           uuid not null references items(id),
  qty_ordered       numeric(14,3) not null check (qty_ordered > 0),
  qty_received      numeric(14,3) not null default 0,
  qty_returned      numeric(14,3) not null default 0,
  unit_price        numeric(14,2) not null default 0,
  discount_amount   numeric(14,2) not null default 0,
  vat_rate          numeric(6,3) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  net_amount        numeric(14,2) not null default 0,
  request_item_id   uuid references purchase_request_items(id),
  note              text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_po_org_status
  on purchase_orders (organization_id, status, order_date desc);
create index if not exists idx_po_distributor
  on purchase_orders (organization_id, distributor_id, order_date desc);
create index if not exists idx_poi_order on purchase_order_items (purchase_order_id);

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;

-- ===========================================================================
-- 6) الاستلام المخزني — منفصلٌ عن الفوترة
-- ===========================================================================
--
-- البضاعة تصل قبل الفاتورة عادةً. ربطُ دخول المخزون بالفاتورة يعني إمّا
-- إدخالها بلا مستند وإمّا تعطيل الصرف حتى تصل الفاتورة. الاستلام مستندٌ
-- قائم بذاته، والفاتورة تُبنى عليه.
create table if not exists goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  warehouse_id      uuid not null references warehouses(id),
  purchase_order_id uuid references purchase_orders(id),
  distributor_id    uuid not null references distributors(id),
  receipt_number    text,
  status            text not null default 'draft'
                      check (status in ('draft','posted','cancelled')),
  received_at       timestamptz not null default now(),
  received_by       uuid references auth.users(id),
  delivery_note_ref text,
  note              text,
  posted_at         timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

create table if not exists goods_receipt_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  goods_receipt_id       uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid references purchase_order_items(id),
  item_id                uuid not null references items(id),
  qty_received           numeric(14,3) not null check (qty_received > 0),
  free_qty               numeric(14,3) not null default 0,
  unit_cost              numeric(14,2) not null default 0,
  lot_number             text,
  expiry_date            date,
  source_barcode         text,
  lot_id                 uuid references inventory_lots(id),
  over_receipt_approved_by uuid references auth.users(id),
  over_receipt_reason    text,
  note                   text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_gr_org
  on goods_receipts (organization_id, status, received_at desc);
create index if not exists idx_gri_receipt on goods_receipt_items (goods_receipt_id);

alter table goods_receipts enable row level security;
alter table goods_receipt_items enable row level security;

-- ===========================================================================
-- 7) ربط فاتورة المورد بالأمر والاستلام، والمرتجع، والمصروفات
-- ===========================================================================
alter table purchase_invoices
  add column if not exists branch_id         uuid references branches(id),
  add column if not exists purchase_order_id uuid references purchase_orders(id),
  add column if not exists goods_receipt_id  uuid references goods_receipts(id),
  add column if not exists due_date          date,
  add column if not exists status            text not null default 'unpaid',
  add column if not exists paid_amount       numeric(14,2) not null default 0,
  add column if not exists expenses_amount   numeric(14,2) not null default 0,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancel_reason     text,
  add column if not exists updated_by        uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_status_check') then
    alter table purchase_invoices add constraint purchase_invoices_status_check
      check (status in ('unpaid','partial','paid','cancelled'));
  end if;
end $$;

create table if not exists purchase_returns (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid references branches(id),
  warehouse_id        uuid not null references warehouses(id),
  distributor_id      uuid not null references distributors(id),
  purchase_invoice_id uuid references purchase_invoices(id),
  goods_receipt_id    uuid references goods_receipts(id),
  return_number       text,
  status              text not null default 'draft'
                        check (status in ('draft','posted','cancelled')),
  reason              text not null,
  subtotal_amount     numeric(14,2) not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  returned_at         timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);

create table if not exists purchase_return_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  purchase_return_id uuid not null references purchase_returns(id) on delete cascade,
  item_id            uuid not null references items(id),
  lot_id             uuid references inventory_lots(id),
  qty_returned       numeric(14,3) not null check (qty_returned > 0),
  unit_cost          numeric(14,2) not null default 0,
  vat_rate           numeric(6,3) not null default 0,
  vat_amount         numeric(14,2) not null default 0,
  net_amount         numeric(14,2) not null default 0,
  receipt_item_id    uuid references goods_receipt_items(id),
  note               text,
  created_at         timestamptz not null default now()
);

alter table purchase_returns enable row level security;
alter table purchase_return_items enable row level security;

-- المصروفات الإضافية: شحن، تخليص، تأمين نقل — تُوزَّع على البنود لتصير
-- التكلفة **تكلفةً واصلة** لا سعر فاتورة.
create table if not exists purchase_expenses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  purchase_invoice_id uuid references purchase_invoices(id),
  goods_receipt_id    uuid references goods_receipts(id),
  expense_type        text not null
                        check (expense_type in ('shipping','customs','insurance','handling','other')),
  amount              numeric(14,2) not null check (amount > 0),
  allocation_method   text not null default 'by_value'
                        check (allocation_method in ('by_value','by_qty')),
  distributor_id      uuid references distributors(id),
  reference_number    text,
  note                text,
  is_allocated        boolean not null default false,
  allocated_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

comment on table purchase_expenses is
  'مصروفات الشراء الإضافية. بلا توزيعها تبقى تكلفة الصنف سعرَ الفاتورة فقط، فيبدو هامش الربح أكبر ممّا هو.';

alter table purchase_expenses enable row level security;

-- ===========================================================================
-- 8) الدوال — التسلسل
-- ===========================================================================

-- 8-1) الاعتماد المطلوب لقيمةٍ ما
create or replace function app_required_approval_role(
  p_organization_id uuid,
  p_amount          numeric,
  p_branch_id       uuid default null
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.required_role_key
    from purchase_approval_rules r
   where r.organization_id = p_organization_id
     and r.is_active
     and (r.branch_id is null or r.branch_id = p_branch_id)
     and coalesce(p_amount, 0) >= r.min_amount
     and (r.max_amount is null or coalesce(p_amount, 0) <= r.max_amount)
   order by r.approval_level desc, r.branch_id nulls last
   limit 1;
$$;

-- 8-2) تقديم الطلب
create or replace function app_submit_purchase_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     purchase_requests%rowtype;
  v_total numeric;
  v_n     int;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.request') then
    raise exception 'صلاحيتك لا تسمح بتقديم طلبات الشراء (purchasing.request)';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'لا يُقدَّم طلب حالته %', v_r.status;
  end if;

  select count(*), coalesce(sum(qty_requested * coalesce(estimated_price, 0)), 0)
    into v_n, v_total
    from purchase_request_items where purchase_request_id = p_request_id;
  if v_n = 0 then raise exception 'الطلب بلا بنود'; end if;

  update purchase_requests
     set status = 'submitted', submitted_at = now(),
         estimated_total = v_total, updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'طلب شراء',
          format('قُدّم الطلب بقيمة تقديرية %s', v_total));
end $$;

-- 8-3) الاعتماد — **بالقيمة ودورها**، وبكمّيات قد تقلّ عن المطلوب
create or replace function app_approve_purchase_request(
  p_request_id uuid,
  p_note       text default null,
  p_lines      jsonb default null   -- [{request_item_id, qty_approved}]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r        purchase_requests%rowtype;
  v_role     text;
  v_my_role  text;
  v_line     jsonb;
  v_any_cut  boolean := false;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد طلبات الشراء (purchasing.approve)';
  end if;
  if v_r.status <> 'submitted' then
    raise exception 'لا يُعتمد طلب حالته %', v_r.status;
  end if;

  -- **مقدّم الطلب لا يعتمده**. فصلُ الطلب عن الاعتماد هو كلّ قيمة الدورة.
  if v_r.requested_by is not null and v_r.requested_by = auth.uid() then
    raise exception 'لا يعتمد الطلبَ مقدّمُه — يلزم معتمِد آخر';
  end if;

  -- دور الاعتماد المطلوب لهذه القيمة
  v_role := app_required_approval_role(v_r.organization_id, v_r.estimated_total, v_r.branch_id);
  if v_role is not null then
    select role_key into v_my_role from organization_memberships
     where organization_id = v_r.organization_id and user_id = auth.uid() and is_active;
    if coalesce(v_my_role, '') <> v_role and not app_is_org_admin(v_r.organization_id) then
      raise exception 'قيمة الطلب (%) تتطلّب اعتماد دور %', v_r.estimated_total, v_role;
    end if;
  end if;

  if p_lines is not null then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      update purchase_request_items
         set qty_approved = least((v_line->>'qty_approved')::numeric, qty_requested)
       where id = (v_line->>'request_item_id')::uuid
         and purchase_request_id = p_request_id;
    end loop;
  end if;

  -- ما لم يُذكر يُعتمد كاملًا
  update purchase_request_items
     set qty_approved = qty_requested
   where purchase_request_id = p_request_id and qty_approved is null;

  select exists (select 1 from purchase_request_items
                  where purchase_request_id = p_request_id
                    and coalesce(qty_approved, 0) < qty_requested)
    into v_any_cut;

  update purchase_requests
     set status = case when v_any_cut then 'partially_approved' else 'approved' end,
         approved_by = auth.uid(), approved_at = now(), approval_note = p_note,
         updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'اعتماد طلب شراء',
          case when v_any_cut then 'اعتماد جزئي' else 'اعتماد كامل' end, p_note);
end $$;

create or replace function app_reject_purchase_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_r purchase_requests%rowtype;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.approve') then
    raise exception 'صلاحيتك لا تسمح برفض طلبات الشراء (purchasing.approve)';
  end if;
  if v_r.status <> 'submitted' then
    raise exception 'لا يُرفض طلب حالته %', v_r.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update purchase_requests
     set status = 'rejected', rejected_reason = p_reason,
         approved_by = auth.uid(), approved_at = now(),
         updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'رفض طلب شراء', 'رُفض الطلب', p_reason);
end $$;

-- 8-4) أمر الشراء من طلب معتمَد
create or replace function app_create_purchase_order(
  p_request_id     uuid,
  p_distributor_id uuid,
  p_expected_date  date default null,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     purchase_requests%rowtype;
  v_dist  distributors%rowtype;
  v_po    uuid;
  v_line  record;
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_tax   record;
  v_n     int := 0;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.order') then
    raise exception 'صلاحيتك لا تسمح بإصدار أوامر الشراء (purchasing.order)';
  end if;

  -- **أمرٌ من طلبٍ معتمَد فقط.** بلا هذا تُصبح دورة الموافقة زينةً تُتخطّى.
  if v_r.status not in ('approved','partially_approved') then
    raise exception 'لا يُصدَر أمر شراء من طلب حالته % — يلزم اعتماده أوّلًا', v_r.status;
  end if;

  select * into v_dist from distributors where id = p_distributor_id;
  if v_dist.id is null then raise exception 'المورد غير موجود'; end if;
  if coalesce(v_dist.is_disabled, false) or coalesce(v_dist.is_archived, false) then
    raise exception 'المورد معطَّل أو مؤرشف';
  end if;
  if v_dist.allowed_branch_ids is not null
     and array_length(v_dist.allowed_branch_ids, 1) > 0
     and v_r.branch_id is not null
     and not (v_r.branch_id = any(v_dist.allowed_branch_ids)) then
    raise exception 'المورد لا يتعامل مع هذا الفرع';
  end if;

  insert into purchase_orders (organization_id, branch_id, warehouse_id, distributor_id,
                               purchase_request_id, status, expected_date,
                               payment_terms_days, note, created_by)
  values (v_r.organization_id, v_r.branch_id, v_r.warehouse_id, p_distributor_id,
          p_request_id, 'draft', p_expected_date,
          v_dist.payment_terms_days, p_note, auth.uid())
  returning id into v_po;

  for v_line in
    select ri.*, i.name_ar
      from purchase_request_items ri
      join items i on i.id = ri.item_id
     where ri.purchase_request_id = p_request_id
       and coalesce(ri.qty_approved, 0) > 0
  loop
    -- الضريبة من نفس مصدر المرحلة 12، لا بحساب محلّيّ
    select t.vat_rate, t.vat_amount into v_tax
      from app_compute_line_tax(v_r.organization_id, v_line.item_id, null,
                                coalesce(v_line.estimated_price, 0),
                                v_line.qty_approved, 0) t;

    insert into purchase_order_items (organization_id, purchase_order_id, item_id,
                                      qty_ordered, unit_price, vat_rate, vat_amount,
                                      net_amount, request_item_id)
    values (v_r.organization_id, v_po, v_line.item_id,
            v_line.qty_approved, coalesce(v_line.estimated_price, 0),
            coalesce(v_tax.vat_rate, 0), coalesce(v_tax.vat_amount, 0),
            round(coalesce(v_line.estimated_price, 0) * v_line.qty_approved, 2)
              + coalesce(v_tax.vat_amount, 0),
            v_line.id);

    v_sub := v_sub + round(coalesce(v_line.estimated_price, 0) * v_line.qty_approved, 2);
    v_vat := v_vat + coalesce(v_tax.vat_amount, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'لا بنود معتمَدة في الطلب'; end if;

  update purchase_orders
     set subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat
   where id = v_po;

  update purchase_requests set status = 'ordered', updated_at = now()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'add', v_po,
          'أمر شراء', format('أمر بقيمة %s لدى %s', v_sub + v_vat,
                             coalesce(v_dist.name_ar, '')));

  return v_po;
end $$;

-- 8-5) الاستلام — جزئيّ أو كامل، ومنع الزائد إلا بصلاحية
create or replace function app_post_goods_receipt(p_receipt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr      goods_receipts%rowtype;
  v_line    record;
  v_lot     uuid;
  v_ordered numeric;
  v_already numeric;
  v_n       int := 0;
begin
  select * into v_gr from goods_receipts where id = p_receipt_id for update;
  if v_gr.id is null then raise exception 'مستند الاستلام غير موجود'; end if;
  if not app_has_permission(v_gr.organization_id, 'purchasing.receive') then
    raise exception 'صلاحيتك لا تسمح بالاستلام المخزني (purchasing.receive)';
  end if;
  if v_gr.status <> 'draft' then
    raise exception 'مستند الاستلام حالته % — لا يُرحَّل مرّتين', v_gr.status;
  end if;

  for v_line in
    select gri.*, i.track_expiry, i.name_ar
      from goods_receipt_items gri
      join items i on i.id = gri.item_id
     where gri.goods_receipt_id = p_receipt_id
  loop
    -- **الاستلام الزائد**: يُقاس على الأمر، ويحتاج صلاحيةً وسببًا.
    if v_line.purchase_order_item_id is not null then
      select poi.qty_ordered, poi.qty_received into v_ordered, v_already
        from purchase_order_items poi where poi.id = v_line.purchase_order_item_id;

      if v_already + v_line.qty_received > v_ordered then
        if not app_has_permission(v_gr.organization_id, 'purchasing.over_receive') then
          raise exception
            'الاستلام يتجاوز المطلوب للصنف %: المطلوب %, المستلَم سابقًا %, الآن % — يلزم صلاحية purchasing.over_receive',
            v_line.name_ar, v_ordered, v_already, v_line.qty_received;
        end if;
        if coalesce(trim(v_line.over_receipt_reason), '') = '' then
          raise exception 'الاستلام الزائد للصنف % بلا سبب مسجَّل', v_line.name_ar;
        end if;
      end if;
    end if;

    -- صنفٌ يُتتبَّع بالصلاحية لا يدخل بلا تاريخ صلاحية
    if coalesce(v_line.track_expiry, false) and v_line.expiry_date is null then
      raise exception 'الصنف % يُتتبَّع بالصلاحية ولا يدخل بلا تاريخ انتهاء', v_line.name_ar;
    end if;
    if v_line.expiry_date is not null and v_line.expiry_date <= current_date then
      raise exception 'الصنف % منتهٍ أو ينتهي اليوم — لا يُستلَم', v_line.name_ar;
    end if;

    -- **الرصيد يُترك صفرًا**: `app_apply_inventory_movement` هو من يزيده عند
    -- ترحيل الحركة. تعبئته هنا كانت تضاعف الكمّية — الخطأ الذي عالجته 0040
    -- سابقًا لفواتير الشراء، وكان سيتكرّر هنا حرفيًّا.
    insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                                expiry_date, qty_received, qty_remaining, unit_cost,
                                distributor_id, received_at, created_by)
    values (v_gr.organization_id, v_gr.warehouse_id, v_line.item_id,
            v_line.lot_number, v_line.expiry_date,
            v_line.qty_received + coalesce(v_line.free_qty, 0),
            0,
            -- المجّانيّ يخفض تكلفة الوحدة: خمسون علبة بسعر أربعين تكلفتها
            -- الحقيقية أقلّ، وتجاهله يرفع التكلفة الدفترية بلا سبب.
            case when v_line.qty_received + coalesce(v_line.free_qty, 0) > 0
                 then round(v_line.unit_cost * v_line.qty_received
                            / (v_line.qty_received + coalesce(v_line.free_qty, 0)), 4)
                 else v_line.unit_cost end,
            v_gr.distributor_id, v_gr.received_at, auth.uid())
    returning id into v_lot;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_gr.organization_id, v_gr.warehouse_id, v_line.item_id, v_lot,
            'purchase_in', v_line.qty_received + coalesce(v_line.free_qty, 0),
            v_line.unit_cost,
            round(v_line.unit_cost * v_line.qty_received, 2),
            format('استلام %s', coalesce(v_gr.receipt_number, '')), auth.uid());

    update goods_receipt_items set lot_id = v_lot where id = v_line.id;

    if v_line.purchase_order_item_id is not null then
      update purchase_order_items
         set qty_received = qty_received + v_line.qty_received
       where id = v_line.purchase_order_item_id;
    end if;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'مستند الاستلام بلا بنود'; end if;

  update goods_receipts
     set status = 'posted', posted_at = now(), updated_at = now()
   where id = p_receipt_id;

  -- حالة الأمر تُشتقّ من المستلَم لا تُكتب يدويًّا
  if v_gr.purchase_order_id is not null then
    update purchase_orders po
       set status = case
             when not exists (select 1 from purchase_order_items poi
                               where poi.purchase_order_id = po.id
                                 and poi.qty_received < poi.qty_ordered)
               then 'received' else 'partially_received' end,
           updated_at = now()
     where po.id = v_gr.purchase_order_id
       and po.status in ('draft','sent','partially_received');
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_gr.organization_id, v_gr.branch_id, auth.uid(), 'purchasing', 'update',
          p_receipt_id, 'استلام مخزني', format('رُحّل %s بندًا إلى المخزون', v_n));

  return v_n;
end $$;

-- 8-6) فاتورة المورد من الاستلام
create or replace function app_create_purchase_invoice_from_receipt(
  p_receipt_id     uuid,
  p_invoice_number text,
  p_invoice_date   date default null,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr    goods_receipts%rowtype;
  v_dist  distributors%rowtype;
  v_inv   uuid;
  v_line  record;
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_tax   record;
  v_date  date;
begin
  select * into v_gr from goods_receipts where id = p_receipt_id;
  if v_gr.id is null then raise exception 'مستند الاستلام غير موجود'; end if;
  if not app_has_permission(v_gr.organization_id, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتسجيل فواتير الموردين (purchasing.invoice)';
  end if;
  if v_gr.status <> 'posted' then
    raise exception 'لا تُفوتَر بضاعة لم تُرحَّل إلى المخزون (حالة الاستلام: %)', v_gr.status;
  end if;
  if exists (select 1 from purchase_invoices where goods_receipt_id = p_receipt_id
              and coalesce(status, 'unpaid') <> 'cancelled') then
    raise exception 'هذا الاستلام مفوتَر سلفًا';
  end if;

  select * into v_dist from distributors where id = v_gr.distributor_id;
  v_date := coalesce(p_invoice_date, current_date);

  insert into purchase_invoices (organization_id, branch_id, distributor_id, warehouse_id,
                                 purchase_order_id, goods_receipt_id, invoice_number,
                                 invoice_date, due_date, payment_term,
                                 supplier_tax_number, vat_enabled, note, created_by)
  values (v_gr.organization_id, v_gr.branch_id, v_gr.distributor_id, v_gr.warehouse_id,
          v_gr.purchase_order_id, p_receipt_id, p_invoice_number,
          v_date,
          v_date + coalesce(v_dist.payment_terms_days, 0),
          -- `payment_term` قائمة مغلقة (نقدًا/آجل) منذ 0003؛ المهلة بالأيام
          -- تعيش في `due_date` لا هنا.
          case when coalesce(v_dist.payment_terms_days, 0) > 0 then 'credit' else 'cash' end,
          v_dist.tax_number, true, p_note, auth.uid())
  returning id into v_inv;

  for v_line in
    select gri.*, i.name_ar
      from goods_receipt_items gri
      join items i on i.id = gri.item_id
     where gri.goods_receipt_id = p_receipt_id
  loop
    select t.vat_rate, t.vat_amount into v_tax
      from app_compute_line_tax(v_gr.organization_id, v_line.item_id, null,
                                v_line.unit_cost, v_line.qty_received, 0) t;

    insert into purchase_invoice_items (purchase_invoice_id, item_id, qty, free_qty,
                                        purchase_price, vat_rate, vat_amount, net_amount,
                                        lot_number, expiry_date, source_barcode)
    values (v_inv, v_line.item_id, v_line.qty_received, v_line.free_qty,
            v_line.unit_cost, coalesce(v_tax.vat_rate, 0), coalesce(v_tax.vat_amount, 0),
            round(v_line.unit_cost * v_line.qty_received, 2) + coalesce(v_tax.vat_amount, 0),
            v_line.lot_number, v_line.expiry_date, v_line.source_barcode);

    v_sub := v_sub + round(v_line.unit_cost * v_line.qty_received, 2);
    v_vat := v_vat + coalesce(v_tax.vat_amount, 0);
  end loop;

  update purchase_invoices
     set subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat
   where id = v_inv;

  if v_gr.purchase_order_id is not null then
    update purchase_orders set status = 'invoiced', updated_at = now()
     where id = v_gr.purchase_order_id and status = 'received';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_gr.organization_id, v_gr.branch_id, auth.uid(), 'purchasing', 'add', v_inv,
          'فاتورة مورد', format('فاتورة %s بقيمة %s', p_invoice_number, v_sub + v_vat));

  return v_inv;
end $$;

-- 8-7) مرتجع المشتريات — يخرج من المخزون بالتشغيلة نفسها
create or replace function app_post_purchase_return(p_return_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r    purchase_returns%rowtype;
  v_line record;
  v_n    int := 0;
  v_sub  numeric := 0;
  v_vat  numeric := 0;
begin
  select * into v_r from purchase_returns where id = p_return_id for update;
  if v_r.id is null then raise exception 'المرتجع غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.return') then
    raise exception 'صلاحيتك لا تسمح بمرتجع المشتريات (purchasing.return)';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'المرتجع حالته % — لا يُرحَّل مرّتين', v_r.status;
  end if;
  if coalesce(trim(v_r.reason), '') = '' then raise exception 'سبب المرتجع مطلوب'; end if;

  for v_line in
    select pri.*, i.name_ar, l.qty_remaining, l.unit_cost as lot_cost
      from purchase_return_items pri
      join items i on i.id = pri.item_id
      left join inventory_lots l on l.id = pri.lot_id
     where pri.purchase_return_id = p_return_id
  loop
    -- **لا يُردّ أكثر ممّا في التشغيلة.** الحارس هنا فوق حارس المخزون نفسه
    -- ليعطي رسالةً تخصّ المرتجع بدل رسالة حركةٍ عامّة.
    if v_line.lot_id is not null and v_line.qty_returned > coalesce(v_line.qty_remaining, 0) then
      raise exception 'مرتجع الصنف % يتجاوز رصيد التشغيلة (المتاح %)',
        v_line.name_ar, coalesce(v_line.qty_remaining, 0);
    end if;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_r.organization_id, v_r.warehouse_id, v_line.item_id, v_line.lot_id,
            'return_out', v_line.qty_returned,
            coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0),
            round(coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0)
                  * v_line.qty_returned, 2),
            format('مرتجع مشتريات: %s', v_r.reason), auth.uid());

    if v_line.receipt_item_id is not null then
      update purchase_order_items poi
         set qty_returned = poi.qty_returned + v_line.qty_returned
        from goods_receipt_items gri
       where gri.id = v_line.receipt_item_id
         and poi.id = gri.purchase_order_item_id;
    end if;

    v_sub := v_sub + round(coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0)
                           * v_line.qty_returned, 2);
    v_vat := v_vat + coalesce(v_line.vat_amount, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'المرتجع بلا بنود'; end if;

  update purchase_returns
     set status = 'posted', posted_at = now(),
         subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat,
         updated_at = now()
   where id = p_return_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_return_id, 'مرتجع مشتريات',
          format('رُدّ %s بندًا بقيمة %s', v_n, v_sub + v_vat), v_r.reason);

  return v_n;
end $$;

-- 8-8) توزيع المصروفات على التكلفة الواصلة
create or replace function app_allocate_purchase_expense(p_expense_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e     purchase_expenses%rowtype;
  v_base  numeric;
  v_line  record;
  v_share numeric;
  v_n     int := 0;
begin
  select * into v_e from purchase_expenses where id = p_expense_id for update;
  if v_e.id is null then raise exception 'المصروف غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتوزيع مصروفات الشراء (purchasing.invoice)';
  end if;
  if v_e.is_allocated then raise exception 'المصروف موزَّع سلفًا'; end if;
  if v_e.goods_receipt_id is null then
    raise exception 'المصروف بلا استلام مرتبط — لا يُعرف على أيّ تشغيلات يُوزَّع';
  end if;

  -- الأساس: القيمة أو الكمّية. الشحن يُوزَّع بالكمّية عادةً، والتخليص بالقيمة.
  if v_e.allocation_method = 'by_qty' then
    select sum(qty_received) into v_base
      from goods_receipt_items where goods_receipt_id = v_e.goods_receipt_id;
  else
    select sum(qty_received * unit_cost) into v_base
      from goods_receipt_items where goods_receipt_id = v_e.goods_receipt_id;
  end if;

  if coalesce(v_base, 0) <= 0 then
    raise exception 'أساس التوزيع صفر — لا يمكن توزيع المصروف';
  end if;

  for v_line in
    select gri.*, l.qty_remaining
      from goods_receipt_items gri
      left join inventory_lots l on l.id = gri.lot_id
     where gri.goods_receipt_id = v_e.goods_receipt_id
       and gri.lot_id is not null
  loop
    v_share := v_e.amount
             * case when v_e.allocation_method = 'by_qty'
                    then v_line.qty_received
                    else v_line.qty_received * v_line.unit_cost end
             / v_base;

    -- **تُزاد تكلفة الوحدة في التشغيلة**، فتنتقل إلى تكلفة المبيع لاحقًا
    update inventory_lots
       set unit_cost = round(unit_cost
                             + v_share / nullif(v_line.qty_received
                                                + coalesce(v_line.free_qty, 0), 0), 4),
           updated_at = now()
     where id = v_line.lot_id;

    v_n := v_n + 1;
  end loop;

  update purchase_expenses
     set is_allocated = true, allocated_at = now() where id = p_expense_id;

  if v_e.purchase_invoice_id is not null then
    update purchase_invoices
       set expenses_amount = expenses_amount + v_e.amount, updated_at = now()
     where id = v_e.purchase_invoice_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_e.organization_id, auth.uid(), 'purchasing', 'update', p_expense_id,
          'توزيع مصروف شراء',
          format('وُزّع %s على %s تشغيلة بطريقة %s', v_e.amount, v_n, v_e.allocation_method));

  return v_n;
end $$;

-- 8-9) دفع المورد — يستعمل سند الصرف القائم لا جدولًا جديدًا
create or replace function app_pay_supplier_invoice(
  p_invoice_id      uuid,
  p_amount          numeric,
  p_payment_method_value_id uuid,
  p_cash_register_id uuid default null,
  p_reference       text default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   purchase_invoices%rowtype;
  v_due   numeric;
  v_v     uuid;
begin
  select * into v_inv from purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'فاتورة المورد غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'suppliers.pay') then
    raise exception 'صلاحيتك لا تسمح بدفع مستحقات الموردين (suppliers.pay)';
  end if;
  if coalesce(v_inv.status, 'unpaid') = 'cancelled' then
    raise exception 'الفاتورة ملغاة';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;

  v_due := coalesce(v_inv.net_amount, 0) - coalesce(v_inv.paid_amount, 0);
  -- **لا دفع فوق المستحقّ.** الزيادة تُخفي إمّا خطأً في الفاتورة وإمّا دفعًا
  -- لفاتورة أخرى، وكلاهما يظهر لاحقًا كفرقٍ لا يُفسَّر.
  if p_amount > v_due + 0.001 then
    raise exception 'المبلغ يتجاوز المستحقّ: المتبقّي %', v_due;
  end if;

  insert into financial_vouchers (organization_id, branch_id, voucher_type, amount,
                                  voucher_date, distributor_id,
                                  payment_method_value_id, cash_register_id,
                                  bank_transfer_ref, description, created_by)
  -- `voucher_type` قائمة مغلقة منذ 0003؛ سداد المورد **مصروف** لا نوعٌ جديد.
  -- إضافة نوع كانت ستُخرج هذه السندات من كل تقرير مصروفات قائم.
  values (v_inv.organization_id, v_inv.branch_id, 'expense', p_amount,
          current_date, v_inv.distributor_id,
          p_payment_method_value_id, p_cash_register_id, p_reference,
          coalesce(p_note, format('سداد فاتورة مورد %s', coalesce(v_inv.invoice_number, ''))),
          auth.uid())
  returning id into v_v;

  update purchase_invoices
     set paid_amount = coalesce(paid_amount, 0) + p_amount,
         status = case
           when coalesce(paid_amount, 0) + p_amount >= coalesce(net_amount, 0) - 0.001
             then 'paid'
           when coalesce(paid_amount, 0) + p_amount > 0 then 'partial'
           else 'unpaid' end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_invoice_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_inv.organization_id, v_inv.branch_id, auth.uid(), 'purchasing', 'add', v_v,
          'سداد مورد', format('سُدّد %s من فاتورة %s', p_amount,
                              coalesce(v_inv.invoice_number, '')));

  return v_v;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================
drop view if exists v_purchase_pipeline;
create view v_purchase_pipeline
with (security_invoker = on) as
select
  po.id                as purchase_order_id,
  po.organization_id,
  po.branch_id,
  br.name              as branch_name,
  po.order_date        as report_date,
  po.order_number,
  po.status,
  po.distributor_id,
  d.name_ar            as supplier_name,
  po.warehouse_id,
  w.name               as warehouse_name,
  po.purchase_request_id,
  pr.request_number,
  pr.status            as request_status,
  po.subtotal_amount,
  po.vat_amount,
  po.net_amount,
  po.expected_date,
  agg.line_count,
  agg.qty_ordered,
  agg.qty_received,
  agg.qty_returned,
  case when coalesce(agg.qty_ordered, 0) > 0
       then round(100.0 * coalesce(agg.qty_received, 0) / agg.qty_ordered, 1) end
                       as received_percent,
  (select count(*) from goods_receipts gr
    where gr.purchase_order_id = po.id and gr.status = 'posted') as receipt_count,
  (select count(*) from purchase_invoices pi2
    where pi2.purchase_order_id = po.id) as invoice_count
from purchase_orders po
left join branches br on br.id = po.branch_id
left join distributors d on d.id = po.distributor_id
left join warehouses w on w.id = po.warehouse_id
left join purchase_requests pr on pr.id = po.purchase_request_id
left join lateral (
  select count(*) as line_count,
         sum(qty_ordered) as qty_ordered,
         sum(qty_received) as qty_received,
         sum(qty_returned) as qty_returned
    from purchase_order_items where purchase_order_id = po.id
) agg on true;

comment on view v_purchase_pipeline is
  'مسار الشراء من الطلب إلى الفاتورة، بنسبة المستلَم من المطلوب — الفجوة بينهما هي ما لم يصل بعد.';

-- `v_supplier_balances` مبنيّ فوقها ويُعاد إنشاؤه في هذا الملف.
drop view if exists v_supplier_ledger cascade;
create view v_supplier_ledger
with (security_invoker = on) as
select
  'invoice'::text      as entry_kind,
  pi.id                as reference_id,
  pi.invoice_number::text as reference_number,
  pi.organization_id,
  pi.branch_id,
  pi.distributor_id,
  d.name_ar            as supplier_name,
  pi.invoice_date      as report_date,
  pi.due_date,
  pi.net_amount        as debit_amount,
  0::numeric           as credit_amount,
  pi.status::text      as status,
  case when pi.due_date is not null and pi.due_date < current_date
            and coalesce(pi.status, 'unpaid') <> 'paid'
       then (current_date - pi.due_date)::integer end as days_overdue
from purchase_invoices pi
join distributors d on d.id = pi.distributor_id
where coalesce(pi.status, 'unpaid') <> 'cancelled'
union all
select
  'payment', v.id, v.voucher_number::text, v.organization_id, v.branch_id,
  v.distributor_id, d.name_ar, v.voucher_date, null::date,
  0::numeric, v.amount, 'paid'::text, null::integer
from financial_vouchers v
join distributors d on d.id = v.distributor_id
where v.distributor_id is not null
  and v.voucher_type = 'expense'
  and coalesce(v.is_void, false) = false
union all
select
  'return', pr.id, pr.return_number::text, pr.organization_id, pr.branch_id,
  pr.distributor_id, d.name_ar, pr.returned_at::date, null::date,
  0::numeric, pr.net_amount, pr.status::text, null::integer
from purchase_returns pr
join distributors d on d.id = pr.distributor_id
where pr.status = 'posted';

comment on view v_supplier_ledger is
  'كشف حساب المورد: الفواتير مدينة، والمدفوعات والمرتجعات دائنة، بتواريخ الاستحقاق وأيّام التأخير.';

drop view if exists v_supplier_balances;
create view v_supplier_balances
with (security_invoker = on) as
select
  d.id                 as distributor_id,
  d.organization_id,
  d.name_ar            as supplier_name,
  d.payment_terms_days,
  d.credit_limit,
  coalesce(sum(l.debit_amount), 0)  as total_invoiced,
  coalesce(sum(l.credit_amount), 0) as total_settled,
  coalesce(sum(l.debit_amount), 0) - coalesce(sum(l.credit_amount), 0) as balance_due,
  coalesce(sum(l.debit_amount) filter (where l.days_overdue is not null), 0) as overdue_amount,
  max(l.days_overdue)  as max_days_overdue,
  count(*) filter (where l.entry_kind = 'invoice') as invoice_count,
  case when d.credit_limit is not null
        and coalesce(sum(l.debit_amount), 0) - coalesce(sum(l.credit_amount), 0)
            > d.credit_limit
       then true else false end as over_credit_limit
from distributors d
left join v_supplier_ledger l on l.distributor_id = d.id
where coalesce(d.is_archived, false) = false
group by d.id, d.organization_id, d.name_ar, d.payment_terms_days, d.credit_limit;

comment on view v_supplier_balances is
  'أرصدة الموردين: المفوتَر والمسدَّد والمستحقّ والمتأخّر، وتجاوز حدّ الائتمان.';

drop view if exists v_pending_receipts;
create view v_pending_receipts
with (security_invoker = on) as
select
  poi.id               as purchase_order_item_id,
  po.id                as purchase_order_id,
  po.organization_id,
  po.branch_id,
  po.order_date        as report_date,
  po.order_number,
  po.expected_date,
  po.distributor_id,
  d.name_ar            as supplier_name,
  po.warehouse_id,
  poi.item_id,
  i.name_ar            as item_name,
  poi.qty_ordered,
  poi.qty_received,
  poi.qty_ordered - poi.qty_received as qty_pending,
  poi.unit_price,
  case when po.expected_date is not null and po.expected_date < current_date
       then current_date - po.expected_date end as days_late
from purchase_order_items poi
join purchase_orders po on po.id = poi.purchase_order_id
join items i on i.id = poi.item_id
left join distributors d on d.id = po.distributor_id
where po.status in ('draft','sent','partially_received')
  and poi.qty_received < poi.qty_ordered;

comment on view v_pending_receipts is
  'ما طُلب ولم يصل، بأيّام التأخير عن الموعد المتوقَّع.';

grant select on v_purchase_pipeline, v_supplier_ledger, v_supplier_balances,
                v_pending_receipts to authenticated;

-- ===========================================================================
-- 10) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['purchase_approval_rules','purchase_requests',
                               'purchase_request_items','purchase_orders',
                               'purchase_order_items','goods_receipts',
                               'goods_receipt_items','purchase_returns',
                               'purchase_return_items','purchase_expenses']) as t
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

-- **لا حذف للمستندات المرحَّلة.** الإلغاء حالةٌ وسبب، لا محو.
create or replace function app_block_posted_document_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('posted','received','partially_received','invoiced','closed') then
    raise exception 'المستند المرحَّل لا يُحذف — استخدم الإلغاء بسبب';
  end if;
  return old;
end $$;

do $$
declare r record;
begin
  for r in select unnest(array['goods_receipts','purchase_returns','purchase_orders']) as t
  loop
    execute format('drop trigger if exists trg_block_delete_%1$s on %1$I', r.t);
    execute format($f$
      create trigger trg_block_delete_%1$s
        before delete on %1$I
        for each row execute function app_block_posted_document_delete()
    $f$, r.t);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_submit_purchase_request','app_approve_purchase_request',
                             'app_reject_purchase_request','app_create_purchase_order',
                             'app_post_goods_receipt','app_create_purchase_invoice_from_receipt',
                             'app_post_purchase_return','app_allocate_purchase_expense',
                             'app_pay_supplier_invoice','app_required_approval_role']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المشتريات % غير موجودة', v_v;
    end if;
  end loop;

  foreach v_v in array array['purchase_requests','purchase_orders','goods_receipts',
                             'purchase_returns','purchase_expenses',
                             'purchase_approval_rules']
  loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = v_v and c.relrowsecurity) then
      raise exception 'جدول المشتريات % بلا RLS', v_v;
    end if;
  end loop;

  if not exists (select 1 from permission_catalog
                  where permission_key = 'purchasing.over_receive') then
    raise exception 'صلاحية الاستلام الزائد غير مسجَّلة';
  end if;
end $$;
