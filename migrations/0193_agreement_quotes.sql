-- ============================================================================
-- 0193 — الاتفاقيات وعروض أسعارها: مرنةٌ قبل الفاتورة، ومحكومةٌ عند الفوترة
-- ============================================================================
--
-- ── الفكرة ──────────────────────────────────────────────────────────────────
--
-- الطبيب والاستقبال يتّفقان مع المريض على خطة علاجٍ وسعرها **قبل** أن تصدر
-- فاتورة ضريبية: يُعدّلون الخدمات والكمّيات والخصم مرّاتٍ حتى يستقرّ الاتفاق،
-- ثمّ يُفوتَر منه ما يُنفَّذ — كلّه أو جزءٌ منه في كلّ زيارة. والفاتورة
-- الضريبية لا تُعدَّل بعد إصدارها، فالتفاوض لا مكان له فيها.
--
--   الاتفاقية (رأسٌ للمريض: العيادة، الطبيب، مسجِّلها، نصّها، ملاحظاتها)
--     └─ عرض سعر ١، ٢، … (كلٌّ بتاريخه وطبيبه وعيادته)
--          └─ بنود: الخدمة، السعر، العدد، الخصم (مبلغًا أو نسبة)، الضريبة،
--                    الإعفاء، الصافي، **والمفوتَر منه**
--     ⇐ «فوترة»: فاتورةٌ ضريبية عادية ببنودٍ تحمل `agreement_item_id`
--
-- ── ما كان ─────────────────────────────────────────────────────────────────
--
-- `treatment_agreements` وبنودها موجودة منذ 0003، وتُنشأ من «المحاسبة»
-- بإدراجَين منفصلَين من المتصفّح، ولا تُعدَّل أبدًا، ولا عروض أسعار تحتها.
-- و«عرض السعر» في النظام صفٌّ في `sales_invoices` (`is_temporary`) — أي في
-- جدول الفواتير الضريبية نفسه: يأخذ رقم مستند، ويُجمَّد بحارس الفاتورة
-- الصادرة فلا يُعدَّل. وهذا عكس ما يُراد منه.
--
-- ── ما يُضاف ───────────────────────────────────────────────────────────────
--
-- ١. `agreement_quotes` — عرض السعر التابع للاتفاقية، خارج جدول الفواتير.
-- ٢. بنود الاتفاقية تنتمي إلى عرض سعر (`quote_id`)، وتحمل تفصيلها: مبلغ
--    الخصم، الخاضع للضريبة، نسبة الضريبة وقيمتها، والإعفاء.
-- ٣. الحساب في القاعدة بقاعدة الفاتورة نفسها (`app_effective_vat_rate` 0156،
--    وحدّا السعر 0159، والحدّ الأدنى بعد الخصم 0167): فما يُتّفق عليه يُفوتَر
--    بلا رفضٍ مفاجئ عند الفوترة.
-- ٤. «المفوتَر» من كلّ بند يُحسب من الفواتير الفعلية وحدها (لا عرض سعرٍ
--    قديم، ولا ملغاة، ولا مرتجع) في منظورٍ واحد تقرؤه كلّ الشاشات.
-- ٥. حارسٌ على سطر الفاتورة: لا يُفوتَر من بندٍ أكثر من المتبقّي منه، ولا من
--    اتفاقيةٍ معطّلة أو عرض سعرٍ ملغى.
--
-- صلاحيتان جديدتان: `agreements.view` و`agreements.manage`.
--
-- آمنة للتكرار. لا حذف لبيانات: البنود القديمة تُجمع في «عرض سعر ١» لاتفاقيتها.
-- ============================================================================

begin;

-- ── 1) الصلاحيات ────────────────────────────────────────────────────────────
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values
  ('agreements.view',   'عرض اتفاقيات المرضى',            'billing',
   'رؤية الاتفاقيات وعروض أسعارها وما فُوتر منها.', 4130),
  ('agreements.manage', 'إنشاء الاتفاقيات وعروض أسعارها', 'billing',
   'إنشاء الاتفاقية وتعديلها، وإضافة عروض الأسعار وتعديل بنودها وخصمها، وتعطيل الاتفاقية.', 4132)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
values
  ('receptionist',   'agreements.view'), ('receptionist',   'agreements.manage'),
  ('doctor',         'agreements.view'), ('doctor',         'agreements.manage'),
  ('branch_manager', 'agreements.view'), ('branch_manager', 'agreements.manage'),
  ('accountant',     'agreements.view'),
  ('nurse',          'agreements.view')
on conflict (role_key, permission_key) do nothing;

-- ── 2) رأس الاتفاقية ────────────────────────────────────────────────────────
alter table treatment_agreements
  add column if not exists agreement_text  text,
  add column if not exists registrar_id    uuid references auth.users(id),
  add column if not exists updated_by      uuid references auth.users(id),
  add column if not exists disabled_reason text;

comment on column treatment_agreements.agreement_text is
  'نصّ الاتفاقية كما يُقرأ على المريض ويُطبع — الخطة وشروطها.';
comment on column treatment_agreements.registrar_id is
  'مسجِّل الاتفاقية — يُختار، وافتراضه من أنشأها.';

update treatment_agreements set registrar_id = created_by
 where registrar_id is null and created_by is not null;

-- ── 3) عروض الأسعار ────────────────────────────────────────────────────────
create table if not exists agreement_quotes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agreement_id    uuid not null references treatment_agreements(id) on delete cascade,
  quote_number    bigint not null,
  quote_date      timestamptz not null default now(),
  doctor_id       uuid references doctors(id),
  clinic_id       uuid references clinics(id),
  note            text,
  is_cancelled    boolean not null default false,
  cancelled_at    timestamptz,
  cancelled_by    uuid references auth.users(id),
  cancel_reason   text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  unique (organization_id, quote_number)
);

create index if not exists idx_agreement_quotes_agreement on agreement_quotes (agreement_id);

comment on table agreement_quotes is
  'عرض سعر تابع لاتفاقية — مستندٌ مرن قبل الفاتورة الضريبية، لا رقم مستندٍ ضريبيّ ولا تجميد (0193).';

alter table agreement_quotes enable row level security;
drop policy if exists agreement_quotes_read on agreement_quotes;
create policy agreement_quotes_read on agreement_quotes
  for select using (app_is_member(organization_id));
grant select on agreement_quotes to authenticated;
-- الكتابة عبر الدوالّ وحدها: الحساب والحدود والمفوتَر تُفرض هناك.

-- ── 4) البنود: انتماءٌ لعرض السعر وتفصيلٌ للحساب ───────────────────────────
alter table treatment_agreement_items
  add column if not exists quote_id         uuid references agreement_quotes(id) on delete cascade,
  add column if not exists discount_amount  numeric(12,2) not null default 0,
  add column if not exists taxable_amount   numeric(12,2) not null default 0,
  add column if not exists vat_rate         numeric(6,3)  not null default 0,
  add column if not exists vat_amount       numeric(12,2) not null default 0,
  add column if not exists exemption_amount numeric(12,2) not null default 0,
  add column if not exists sort_order       integer       not null default 0;

create index if not exists idx_agreement_items_quote on treatment_agreement_items (quote_id);

comment on column treatment_agreement_items.discount_amount is
  'الخصم بالريال على السطر كلّه — المرجع. والنسبة بيانٌ مشتقّ منه (0193).';
comment on column treatment_agreement_items.exemption_amount is
  'الضريبة المُعفاة (تتحمّلها الدولة عن المواطن) — كما في النظام المرجعيّ: 15% من الخاضع.';

-- ── 5) البنود القديمة بلا عرض سعر ⇒ «عرض سعر» لكلّ اتفاقية ────────────────
do $$
declare
  r      record;
  v_next bigint;
  v_q    uuid;
begin
  for r in
    select a.id, a.organization_id, a.doctor_id, a.clinic_id, a.created_by, a.created_at
      from treatment_agreements a
     where exists (select 1 from treatment_agreement_items i
                    where i.agreement_id = a.id and i.quote_id is null)
     order by a.created_at
  loop
    select coalesce(max(quote_number), 0) + 1 into v_next
      from agreement_quotes where organization_id = r.organization_id;
    insert into agreement_quotes (organization_id, agreement_id, quote_number, quote_date,
                                  doctor_id, clinic_id, created_by, created_at, note)
    values (r.organization_id, r.id, v_next, r.created_at, r.doctor_id, r.clinic_id,
            r.created_by, r.created_at, 'بنود الاتفاقية قبل 0193')
    returning id into v_q;

    update treatment_agreement_items i
       set quote_id       = v_q,
           discount_amount = round(i.qty * i.unit_price * coalesce(i.discount_percent, 0) / 100.0, 2),
           taxable_amount  = round(i.qty * i.unit_price, 2)
                             - round(i.qty * i.unit_price * coalesce(i.discount_percent, 0) / 100.0, 2),
           vat_amount      = greatest(i.net_amount - (round(i.qty * i.unit_price, 2)
                             - round(i.qty * i.unit_price * coalesce(i.discount_percent, 0) / 100.0, 2)), 0)
     where i.agreement_id = r.id and i.quote_id is null;
  end loop;
end $$;

-- ── 6) المفوتَر من كلّ بند — منظورٌ واحد ─────────────────────────────────
--
-- الفاتورة الفعلية وحدها: لا عرض سعرٍ قديم في `sales_invoices`، ولا ملغاة،
-- ولا مرتجع (المرتجع عكسٌ لفاتورةٍ سابقة لا فوترةٌ جديدة من الاتفاقية).
create or replace view v_agreement_item_balances
with (security_invoker = on) as
select
  ai.id                                        as agreement_item_id,
  ai.agreement_id,
  ai.quote_id,
  a.organization_id,
  ai.qty,
  coalesce(inv.qty, 0)                         as invoiced_qty,
  greatest(ai.qty - coalesce(inv.qty, 0), 0)   as remaining_qty,
  coalesce(inv.amount, 0)                      as invoiced_amount
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join lateral (
  select sum(sii.qty) as qty, sum(sii.net_amount) as amount
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = ai.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale'
) inv on true;

grant select on v_agreement_item_balances to authenticated;

-- بنود عرض السعر كما تعرضها الشاشة: الصنف وكوده وحدّاه، والمفوتَر والمتبقّي
create or replace view v_agreement_quote_lines
with (security_invoker = on) as
select
  ai.id,
  ai.agreement_id,
  ai.quote_id,
  a.organization_id,
  ai.item_id,
  i.code                                       as item_code,
  i.barcode                                    as item_barcode,
  coalesce(ai.description, i.name_ar)          as description,
  i.min_price,
  i.max_price,
  coalesce(i.is_vat_exempt, false)             as item_vat_exempt,
  ai.qty,
  ai.unit_price,
  round(ai.qty * ai.unit_price, 2)             as gross_amount,
  ai.discount_amount,
  ai.discount_percent,
  ai.taxable_amount,
  ai.vat_rate,
  ai.vat_amount,
  ai.exemption_amount,
  ai.net_amount,
  ai.sort_order,
  b.invoiced_qty,
  b.remaining_qty,
  b.invoiced_amount
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join items i on i.id = ai.item_id
left join v_agreement_item_balances b on b.agreement_item_id = ai.id;

grant select on v_agreement_quote_lines to authenticated;

-- عروض أسعار الاتفاقية بمجاميعها
create or replace view v_agreement_quote_list
with (security_invoker = on) as
select
  q.id,
  q.organization_id,
  q.agreement_id,
  q.quote_number,
  q.quote_date,
  q.doctor_id,
  d.name_ar                                    as doctor_name,
  q.clinic_id,
  c.name                                       as clinic_name,
  q.note,
  q.is_cancelled,
  q.cancel_reason,
  q.created_by,
  dir.display_name                             as created_by_name,
  q.created_at,
  coalesce(t.lines_count, 0)                   as lines_count,
  coalesce(t.gross, 0)                         as gross_amount,
  coalesce(t.discount, 0)                      as discount_amount,
  coalesce(t.taxable, 0)                       as taxable_amount,
  coalesce(t.vat, 0)                           as vat_amount,
  coalesce(t.exemption, 0)                     as exemption_amount,
  coalesce(t.net, 0)                           as net_amount,
  coalesce(t.invoiced, 0)                      as invoiced_amount,
  coalesce(t.net, 0) - coalesce(t.invoiced, 0) as remaining_amount
from agreement_quotes q
left join doctors d on d.id = q.doctor_id
left join clinics c on c.id = q.clinic_id
left join v_organization_members_directory dir
       on dir.user_id = q.created_by and dir.organization_id = q.organization_id
left join lateral (
  select count(*)                               as lines_count,
         sum(round(ai.qty * ai.unit_price, 2))  as gross,
         sum(ai.discount_amount)                as discount,
         sum(ai.taxable_amount)                 as taxable,
         sum(ai.vat_amount)                     as vat,
         sum(ai.exemption_amount)               as exemption,
         sum(ai.net_amount)                     as net,
         sum(b.invoiced_amount)                 as invoiced
    from treatment_agreement_items ai
    left join v_agreement_item_balances b on b.agreement_item_id = ai.id
   where ai.quote_id = q.id
) t on true;

grant select on v_agreement_quote_list to authenticated;

-- قائمة الاتفاقيات بمجاميعها وخدماتها — كجدول «الاتفاقيات» في النظام المرجعيّ
create or replace view v_agreement_list
with (security_invoker = on) as
select
  a.id,
  a.organization_id,
  a.agreement_number,
  a.patient_id,
  p.name_ar                                    as patient_name,
  p.file_number,
  a.agreement_date,
  a.created_at,
  a.doctor_id,
  d.name_ar                                    as doctor_name,
  a.clinic_id,
  c.name                                       as clinic_name,
  a.registrar_id,
  dir.display_name                             as registrar_name,
  a.note,
  a.agreement_text,
  a.is_disabled,
  a.disabled_reason,
  s.services,
  coalesce(s.quotes_count, 0)                  as quotes_count,
  coalesce(s.gross, 0)                         as gross_amount,
  coalesce(s.discount, 0)                      as discount_amount,
  coalesce(s.vat, 0)                           as vat_amount,
  coalesce(s.net, 0)                           as net_amount,
  coalesce(s.invoiced, 0)                      as invoiced_amount,
  coalesce(s.net, 0) - coalesce(s.invoiced, 0) as remaining_amount
from treatment_agreements a
join patients p on p.id = a.patient_id
left join doctors d on d.id = a.doctor_id
left join clinics c on c.id = a.clinic_id
left join v_organization_members_directory dir
       on dir.user_id = coalesce(a.registrar_id, a.created_by) and dir.organization_id = a.organization_id
left join lateral (
  select string_agg(distinct coalesce(ai.description, i.name_ar), '، ') as services,
         count(distinct ai.quote_id)            as quotes_count,
         sum(round(ai.qty * ai.unit_price, 2))  as gross,
         sum(ai.discount_amount)                as discount,
         sum(ai.vat_amount)                     as vat,
         sum(ai.net_amount)                     as net,
         sum(b.invoiced_amount)                 as invoiced
    from treatment_agreement_items ai
    left join agreement_quotes q on q.id = ai.quote_id
    left join items i on i.id = ai.item_id
    left join v_agreement_item_balances b on b.agreement_item_id = ai.id
   where ai.agreement_id = a.id
     and not coalesce(q.is_cancelled, false)
) s on true;

grant select on v_agreement_list to authenticated;

-- ما يُفوتَر من الاتفاقيات: بنود اتفاقياتٍ مفعّلة وعروضٍ غير ملغاة، بمتبقٍّ
create or replace view v_agreement_billable_items
with (security_invoker = on) as
select
  ai.id                                        as agreement_item_id,
  ai.agreement_id,
  a.organization_id,
  a.patient_id,
  a.agreement_number,
  ai.quote_id,
  q.quote_number,
  ai.item_id,
  coalesce(ai.description, i.name_ar)          as description,
  ai.qty,
  ai.unit_price,
  ai.discount_percent,
  ai.discount_amount,
  b.invoiced_qty,
  b.remaining_qty
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join agreement_quotes q on q.id = ai.quote_id
left join items i on i.id = ai.item_id
join v_agreement_item_balances b on b.agreement_item_id = ai.id
where not a.is_disabled
  and not coalesce(q.is_cancelled, false)
  and ai.item_id is not null;

grant select on v_agreement_billable_items to authenticated;

-- ── 7) مجاميع رأس الاتفاقية ─────────────────────────────────────────────────
--
-- `remaining_amount` قد يكون عمودًا محسوبًا في القاعدة (0003) فلا يُكتب، وقد
-- يكون عاديًّا فيجب أن يُكتب — يُسأل عنه `information_schema` بدل الافتراض.
create or replace function app_agreement_refresh(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_net      numeric := 0;
  v_vat      numeric := 0;
  v_invoiced numeric := 0;
begin
  select coalesce(sum(ai.net_amount), 0), coalesce(sum(ai.vat_amount), 0)
    into v_net, v_vat
    from treatment_agreement_items ai
    left join agreement_quotes q on q.id = ai.quote_id
   where ai.agreement_id = p_agreement_id
     and not coalesce(q.is_cancelled, false);

  select coalesce(sum(b.invoiced_amount), 0) into v_invoiced
    from v_agreement_item_balances b
   where b.agreement_id = p_agreement_id;

  update treatment_agreements
     set total_amount    = v_net,
         vat_amount      = v_vat,
         invoiced_amount = v_invoiced,
         updated_at      = now()
   where id = p_agreement_id;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'treatment_agreements'
                and column_name = 'remaining_amount' and is_generated = 'NEVER') then
    execute 'update treatment_agreements set remaining_amount = total_amount - invoiced_amount where id = $1'
      using p_agreement_id;
  end if;
end $$;

revoke all on function app_agreement_refresh(uuid) from public, anon, authenticated;

-- الدالّة القديمة (0003) يناديها مُحفِّز بنود الفواتير — تصير تحسب بالقاعدة
-- الجديدة: فواتير فعلية وحدها، لا عروض أسعارٍ قديمة ولا ملغاة.
create or replace function app_recalc_agreement_invoiced_amount(target_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_agreement_id is not null then
    perform app_agreement_refresh(target_agreement_id);
  end if;
end $$;

-- إلغاء فاتورةٍ (أو تحويل عرض سعرٍ قديم إلى فاتورة) يُغيّر المفوتَر دون أن
-- يمسّ بنودها — فيُعاد الحساب من رأسها أيضًا.
create or replace function app_agreement_refresh_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select distinct ai.agreement_id
      from sales_invoice_items sii
      join treatment_agreement_items ai on ai.id = sii.agreement_item_id
     where sii.invoice_id = new.id
  loop
    perform app_agreement_refresh(r.agreement_id);
  end loop;
  return new;
end $$;

drop trigger if exists trg_agreement_refresh_from_invoice on sales_invoices;
create trigger trg_agreement_refresh_from_invoice
  after update of status, is_temporary on sales_invoices
  for each row
  when (old.status is distinct from new.status or old.is_temporary is distinct from new.is_temporary)
  execute function app_agreement_refresh_from_invoice();

-- ── 8) حارس سطر الفاتورة ────────────────────────────────────────────────────
create or replace function app_guard_agreement_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_temp      boolean;
  v_status    text;
  v_type      text;
  v_qty       numeric;
  v_disabled  boolean;
  v_cancelled boolean;
  v_number    bigint;
  v_done      numeric;
begin
  if new.agreement_item_id is null then
    return new;
  end if;

  select is_temporary, status, invoice_type into v_temp, v_status, v_type
    from sales_invoices where id = new.invoice_id;
  if coalesce(v_temp, false) or coalesce(v_type, 'sale') <> 'sale' then
    return new;
  end if;

  select ai.qty, a.is_disabled, coalesce(q.is_cancelled, false), a.agreement_number
    into v_qty, v_disabled, v_cancelled, v_number
    from treatment_agreement_items ai
    join treatment_agreements a on a.id = ai.agreement_id
    left join agreement_quotes q on q.id = ai.quote_id
   where ai.id = new.agreement_item_id;
  if not found then
    return new;
  end if;

  if v_disabled then
    raise exception 'الاتفاقية #% معطّلة — فعّلها أوّلًا أو احذف بندها من الفاتورة', v_number;
  end if;
  if v_cancelled then
    raise exception 'بندٌ من عرض سعرٍ ملغى في الاتفاقية #% — احذفه من الفاتورة', v_number;
  end if;

  select coalesce(sum(sii.qty), 0) into v_done
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = new.agreement_item_id
     and sii.id <> new.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale';

  if v_done + coalesce(new.qty, 0) > v_qty + 0.0001 then
    raise exception 'الكمية تتجاوز المتبقّي في الاتفاقية #%: المتّفق عليه % وفُوتر منه % والمطلوب الآن %',
      v_number, v_qty, v_done, new.qty;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_agreement_invoice_line on sales_invoice_items;
create trigger trg_guard_agreement_invoice_line
  before insert or update of qty, agreement_item_id on sales_invoice_items
  for each row execute function app_guard_agreement_invoice_line();

-- ── 9) حفظ الاتفاقية ────────────────────────────────────────────────────────
create or replace function app_save_agreement(
  p_organization_id uuid,
  p_agreement_id    uuid,
  p_patient_id      uuid,
  p_doctor_id       uuid,
  p_clinic_id       uuid,
  p_agreement_date  date,
  p_agreement_text  text,
  p_note            text,
  p_registrar_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid := p_agreement_id;
  v_patient uuid;
  v_org     uuid;
begin
  if not app_has_permission(p_organization_id, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بإنشاء الاتفاقيات أو تعديلها (agreements.manage)';
  end if;
  if not exists (select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if p_doctor_id is not null
     and not exists (select 1 from doctors where id = p_doctor_id and organization_id = p_organization_id) then
    raise exception 'الطبيب غير موجود في هذه المنشأة';
  end if;
  if p_clinic_id is not null
     and not exists (select 1 from clinics where id = p_clinic_id and organization_id = p_organization_id) then
    raise exception 'العيادة غير موجودة في هذه المنشأة';
  end if;
  if p_registrar_id is not null
     and not exists (select 1 from organization_memberships
                      where organization_id = p_organization_id and user_id = p_registrar_id) then
    raise exception 'مسجِّل الاتفاقية ليس عضوًا في المنشأة';
  end if;

  if v_id is null then
    insert into treatment_agreements (organization_id, patient_id, doctor_id, clinic_id,
                                      agreement_date, agreement_text, note,
                                      registrar_id, created_by)
    values (p_organization_id, p_patient_id, p_doctor_id, p_clinic_id,
            coalesce(p_agreement_date, current_date),
            nullif(btrim(coalesce(p_agreement_text, '')), ''),
            nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_registrar_id, auth.uid()), auth.uid())
    returning id into v_id;

    insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
    values (p_organization_id, auth.uid(), 'billing', 'add', v_id, 'اتفاقية جديدة', null);
  else
    select organization_id, patient_id into v_org, v_patient
      from treatment_agreements where id = v_id for update;
    if v_org is null or v_org <> p_organization_id then
      raise exception 'الاتفاقية غير موجودة';
    end if;
    -- المريض لا يتغيّر: بنودها وجلساتها وفواتيرها مربوطةٌ به
    if v_patient <> p_patient_id then
      raise exception 'لا يُغيَّر مريض الاتفاقية — أنشئ اتفاقيةً جديدة للمريض الآخر';
    end if;

    update treatment_agreements
       set doctor_id      = p_doctor_id,
           clinic_id      = p_clinic_id,
           agreement_date = coalesce(p_agreement_date, agreement_date),
           agreement_text = nullif(btrim(coalesce(p_agreement_text, '')), ''),
           note           = nullif(btrim(coalesce(p_note, '')), ''),
           registrar_id   = coalesce(p_registrar_id, registrar_id),
           updated_by     = auth.uid(),
           updated_at     = now()
     where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function app_save_agreement(uuid, uuid, uuid, uuid, uuid, date, text, text, uuid) from public, anon;
grant execute on function app_save_agreement(uuid, uuid, uuid, uuid, uuid, date, text, text, uuid) to authenticated;

-- ── 10) تعطيل الاتفاقية وتفعيلها ───────────────────────────────────────────
create or replace function app_set_agreement_disabled(
  p_agreement_id uuid,
  p_disabled     boolean,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_number bigint;
begin
  select organization_id, agreement_number into v_org, v_number
    from treatment_agreements where id = p_agreement_id;
  if v_org is null then raise exception 'الاتفاقية غير موجودة'; end if;
  if not app_has_permission(v_org, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بتعطيل الاتفاقيات (agreements.manage)';
  end if;

  update treatment_agreements
     set is_disabled     = p_disabled,
         disabled_reason = case when p_disabled then nullif(btrim(coalesce(p_reason, '')), '') else null end,
         updated_by      = auth.uid(),
         updated_at      = now()
   where id = p_agreement_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'billing', 'update', p_agreement_id,
          case when p_disabled then 'تعطيل اتفاقية #' else 'تفعيل اتفاقية #' end || v_number,
          nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

revoke all on function app_set_agreement_disabled(uuid, boolean, text) from public, anon;
grant execute on function app_set_agreement_disabled(uuid, boolean, text) to authenticated;

-- ── 11) حفظ عرض السعر وبنوده — ذرّيًّا، وبقاعدة الفاتورة نفسها ─────────────
--
-- `p_lines`: [{ id?, item_id, description?, qty, price, discount_amount?,
--              discount_percent? }]
--   * `id` لبندٍ قائم يُعدَّل، وغيابه بندٌ جديد. وما لم يُذكر من البنود
--     القائمة يُحذف — إلّا ما فُوتر منه شيء أو رُبطت به جلسة.
--   * الخصم: المبلغ إن وُجد، وإلّا النسبة. وهما وجهان لخصمٍ واحد (٣٠٪ من
--     ٧٠٠ = ٢١٠) لا خصمان يُجمعان.
create or replace function app_save_agreement_quote(
  p_agreement_id uuid,
  p_quote_id     uuid,
  p_doctor_id    uuid,
  p_clinic_id    uuid,
  p_quote_date   timestamptz,
  p_note         text,
  p_lines        jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a        treatment_agreements%rowtype;
  v_q        uuid := p_quote_id;
  v_next     bigint;
  v_rate     numeric := 0;
  v_pexempt  boolean := false;
  e          jsonb;
  v_idx      integer := 0;
  v_line_id  uuid;
  v_item     items%rowtype;
  v_qty      numeric;
  v_price    numeric;
  v_gross    numeric;
  v_disc     numeric;
  v_pct      numeric;
  v_taxable  numeric;
  v_exempt   boolean;
  v_vat      numeric;
  v_exemp    numeric;
  v_keep     uuid[] := '{}';
  v_done     numeric;
  r          record;
begin
  select * into v_a from treatment_agreements where id = p_agreement_id for update;
  if v_a.id is null then raise exception 'الاتفاقية غير موجودة'; end if;
  if not app_has_permission(v_a.organization_id, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بتعديل عروض الأسعار (agreements.manage)';
  end if;
  if v_a.is_disabled then
    raise exception 'الاتفاقية #% معطّلة — فعّلها قبل تعديل عروض أسعارها', v_a.agreement_number;
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'عرض السعر بلا بنود — أضف خدمةً واحدة على الأقلّ';
  end if;
  if p_doctor_id is not null
     and not exists (select 1 from doctors where id = p_doctor_id and organization_id = v_a.organization_id) then
    raise exception 'الطبيب غير موجود في هذه المنشأة';
  end if;
  if p_clinic_id is not null
     and not exists (select 1 from clinics where id = p_clinic_id and organization_id = v_a.organization_id) then
    raise exception 'العيادة غير موجودة في هذه المنشأة';
  end if;

  -- نسبة الضريبة وإعفاء المريض — بالدالّة نفسها التي تسألها شاشة الفاتورة.
  -- مرّتين: للمريض المُعفى تُرجع النسبة صفرًا، والإعفاء يُعرض بالنسبة الأصلية
  -- (١٥٪ من الخاضع تتحمّلها الدولة) — فتُسأل نسبة المنشأة بلا مريض أيضًا.
  select coalesce(x.vat_rate, 0) into v_rate
    from app_effective_vat_rate(v_a.organization_id, null) x;
  select coalesce(x.patient_exempt, false) into v_pexempt
    from app_effective_vat_rate(v_a.organization_id, v_a.patient_id) x;

  -- رأس عرض السعر
  if v_q is null then
    perform pg_advisory_xact_lock(hashtext('agreement_quotes:' || v_a.organization_id::text));
    select coalesce(max(quote_number), 0) + 1 into v_next
      from agreement_quotes where organization_id = v_a.organization_id;
    insert into agreement_quotes (organization_id, agreement_id, quote_number, quote_date,
                                  doctor_id, clinic_id, note, created_by, updated_by)
    values (v_a.organization_id, v_a.id, v_next, coalesce(p_quote_date, now()),
            coalesce(p_doctor_id, v_a.doctor_id), coalesce(p_clinic_id, v_a.clinic_id),
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), auth.uid())
    returning id into v_q;
  else
    if not exists (select 1 from agreement_quotes where id = v_q and agreement_id = v_a.id) then
      raise exception 'عرض السعر ليس من هذه الاتفاقية';
    end if;
    if exists (select 1 from agreement_quotes where id = v_q and is_cancelled) then
      raise exception 'عرض السعر ملغى — لا يُعدَّل';
    end if;
    update agreement_quotes
       set quote_date = coalesce(p_quote_date, quote_date),
           doctor_id  = p_doctor_id,
           clinic_id  = p_clinic_id,
           note       = nullif(btrim(coalesce(p_note, '')), ''),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_q;
  end if;

  -- البنود
  for e in select * from jsonb_array_elements(p_lines)
  loop
    v_idx := v_idx + 1;
    v_line_id := nullif(e ->> 'id', '')::uuid;
    select * into v_item from items
     where id = nullif(e ->> 'item_id', '')::uuid and organization_id = v_a.organization_id;
    if v_item.id is null then
      raise exception 'السطر %: اختر خدمةً من الكتالوج', v_idx;
    end if;

    v_qty   := coalesce(nullif(e ->> 'qty', '')::numeric, 0);
    v_price := coalesce(nullif(e ->> 'price', '')::numeric, v_item.price, 0);
    if v_qty <= 0 then
      raise exception 'السطر % («%»): العدد يجب أن يكون أكبر من صفر', v_idx, v_item.name_ar;
    end if;
    if v_price < 0 then
      raise exception 'السطر % («%»): السعر سالب', v_idx, v_item.name_ar;
    end if;

    -- حدّا السعر (0159) — كما تفرضهما الفاتورة، فلا يُرفض الاتفاق عند فوترته
    if v_item.min_price is not null and v_price > 0 and v_price < v_item.min_price then
      raise exception 'سعر «%» أقلّ من حدّه الأدنى (%)', v_item.name_ar, v_item.min_price;
    end if;
    if v_item.max_price is not null and v_price > v_item.max_price then
      raise exception 'سعر «%» أعلى من حدّه الأقصى (%)', v_item.name_ar, v_item.max_price;
    end if;

    v_gross := round(v_qty * v_price, 2);
    v_disc  := greatest(coalesce(nullif(e ->> 'discount_amount', '')::numeric, 0), 0);
    if v_disc = 0 then
      v_pct  := least(greatest(coalesce(nullif(e ->> 'discount_percent', '')::numeric, 0), 0), 100);
      v_disc := round(v_gross * v_pct / 100.0, 2);
    end if;
    v_disc := least(v_disc, v_gross);
    v_pct  := case when v_gross > 0 then round(v_disc / v_gross * 100.0, 2) else 0 end;

    -- الحدّ الأدنى على صافي الوحدة بعد الخصم (0167)
    if v_item.min_price is not null and v_disc > 0
       and (v_gross - v_disc) / v_qty < v_item.min_price then
      raise exception 'الخصم يُنزل «%» إلى % للوحدة، وحدّها الأدنى %',
        v_item.name_ar, round((v_gross - v_disc) / v_qty, 2), v_item.min_price;
    end if;

    v_taxable := v_gross - v_disc;
    v_exempt  := v_pexempt or coalesce(v_item.is_vat_exempt, false);
    v_vat     := case when v_exempt then 0 else round(v_taxable * v_rate / 100.0, 2) end;
    -- الإعفاء = الضريبة التي تتحمّلها الدولة عن المريض المُعفى
    v_exemp   := case when v_pexempt and not coalesce(v_item.is_vat_exempt, false)
                      then round(v_taxable * v_rate / 100.0, 2) else 0 end;

    if v_line_id is not null then
      if not exists (select 1 from treatment_agreement_items where id = v_line_id and quote_id = v_q) then
        raise exception 'السطر %: ليس من عرض السعر هذا', v_idx;
      end if;
      select coalesce(b.invoiced_qty, 0) into v_done
        from v_agreement_item_balances b where b.agreement_item_id = v_line_id;
      if v_qty < coalesce(v_done, 0) then
        raise exception 'السطر % («%»): فُوتر منه % فلا يُنزَل عدده إلى %',
          v_idx, v_item.name_ar, v_done, v_qty;
      end if;
      if coalesce(v_done, 0) > 0
         and exists (select 1 from treatment_agreement_items
                      where id = v_line_id and item_id is distinct from v_item.id) then
        raise exception 'السطر %: فُوتر منه — لا تُستبدل خدمته', v_idx;
      end if;

      update treatment_agreement_items
         set item_id          = v_item.id,
             description      = coalesce(nullif(btrim(e ->> 'description'), ''), v_item.name_ar),
             qty              = v_qty,
             unit_price       = v_price,
             discount_percent = v_pct,
             discount_amount  = v_disc,
             taxable_amount   = v_taxable,
             vat_rate         = case when coalesce(v_item.is_vat_exempt, false) then 0 else v_rate end,
             vat_amount       = v_vat,
             exemption_amount = v_exemp,
             net_amount       = v_taxable + v_vat,
             sort_order       = v_idx
       where id = v_line_id;
    else
      insert into treatment_agreement_items (agreement_id, quote_id, item_id, description, qty,
                                             unit_price, discount_percent, discount_amount,
                                             taxable_amount, vat_rate, vat_amount,
                                             exemption_amount, net_amount, sort_order)
      values (v_a.id, v_q, v_item.id,
              coalesce(nullif(btrim(e ->> 'description'), ''), v_item.name_ar),
              v_qty, v_price, v_pct, v_disc, v_taxable,
              case when coalesce(v_item.is_vat_exempt, false) then 0 else v_rate end,
              v_vat, v_exemp, v_taxable + v_vat, v_idx)
      returning id into v_line_id;
    end if;
    v_keep := v_keep || v_line_id;
  end loop;

  -- البنود المحذوفة من الشاشة
  for r in
    select ai.id, coalesce(ai.description, 'بند') as description,
           coalesce(b.invoiced_qty, 0) as invoiced_qty
      from treatment_agreement_items ai
      left join v_agreement_item_balances b on b.agreement_item_id = ai.id
     where ai.quote_id = v_q and not (ai.id = any(v_keep))
  loop
    if r.invoiced_qty > 0 then
      raise exception '«%» فُوتر منه % — لا يُحذف من عرض السعر', r.description, r.invoiced_qty;
    end if;
    if exists (select 1 from treatment_sessions s where s.agreement_item_id = r.id) then
      raise exception '«%» مربوطٌ بجلسات علاجية — لا يُحذف من عرض السعر', r.description;
    end if;
    delete from treatment_agreement_items where id = r.id;
  end loop;

  perform app_agreement_refresh(v_a.id);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_a.organization_id, auth.uid(), 'billing',
          case when p_quote_id is null then 'add' else 'update' end, v_q,
          'عرض سعر للاتفاقية #' || v_a.agreement_number,
          format('%s بندًا', jsonb_array_length(p_lines)));

  return v_q;
end $$;

revoke all on function app_save_agreement_quote(uuid, uuid, uuid, uuid, timestamptz, text, jsonb) from public, anon;
grant execute on function app_save_agreement_quote(uuid, uuid, uuid, uuid, timestamptz, text, jsonb) to authenticated;

-- ── 12) إلغاء عرض السعر ────────────────────────────────────────────────────
create or replace function app_cancel_agreement_quote(p_quote_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q agreement_quotes%rowtype;
begin
  select * into v_q from agreement_quotes where id = p_quote_id for update;
  if v_q.id is null then raise exception 'عرض السعر غير موجود'; end if;
  if not app_has_permission(v_q.organization_id, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بإلغاء عروض الأسعار (agreements.manage)';
  end if;
  if v_q.is_cancelled then return; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الإلغاء مطلوب';
  end if;
  if exists (select 1 from v_agreement_item_balances b
              where b.quote_id = p_quote_id and b.invoiced_qty > 0) then
    raise exception 'فُوتر من عرض السعر هذا — لا يُلغى. عدِّل كمّيات ما لم يُفوتَر بدل ذلك';
  end if;

  update agreement_quotes
     set is_cancelled = true, cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = btrim(p_reason), updated_at = now(), updated_by = auth.uid()
   where id = p_quote_id;

  perform app_agreement_refresh(v_q.agreement_id);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_q.organization_id, auth.uid(), 'billing', 'update', p_quote_id,
          'إلغاء عرض سعر #' || v_q.quote_number, btrim(p_reason));
end $$;

revoke all on function app_cancel_agreement_quote(uuid, text) from public, anon;
grant execute on function app_cancel_agreement_quote(uuid, text) to authenticated;

-- مجاميع كلّ الاتفاقيات القائمة بالقاعدة الجديدة
do $$
declare r record;
begin
  for r in select id from treatment_agreements loop
    perform app_agreement_refresh(r.id);
  end loop;
end $$;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
  v_orphans int;
begin
  select string_agg(f, '، ') into v_missing
    from unnest(array['app_save_agreement','app_set_agreement_disabled','app_save_agreement_quote',
                      'app_cancel_agreement_quote','app_agreement_refresh',
                      'app_guard_agreement_invoice_line']) f
   where not exists (select 1 from pg_proc where proname = f);
  if v_missing is not null then raise exception 'دوالّ ناقصة: %', v_missing; end if;

  select count(*) into v_orphans from treatment_agreement_items where quote_id is null;
  if v_orphans > 0 then raise exception 'بقي % بندًا بلا عرض سعر', v_orphans; end if;

  raise notice '0193 ✓ الاتفاقيات وعروض أسعارها جاهزة';
end $$;
