-- ---------------------------------------------------------------------------
-- 0072_price_lists.sql — المرحلة 2: قوائم الأسعار وتاريخ السريان
-- ---------------------------------------------------------------------------
-- السعر اليوم عمود واحد على الصنف: `items.price`. وهذا يعني:
--
--   • **سعر واحد لكل الفروع.** فرعٌ في حيّ راقٍ وفرعٌ في ضاحية بنفس التعرفة.
--   • **سعر واحد لكل شركات التأمين.** والتعاقد مع شركة يعني تعرفةً متفقًا
--     عليها تختلف عن النقدي — فيُفوتَر التأمين بسعر النقدي أو العكس.
--   • **ولا تاريخ.** رفع السعر يمحو القديم، فتُعاد طباعة فاتورة الشهر الماضي
--     بسعر اليوم. `sales_invoice_items.price` يحفظ سعر البند وقت الإصدار
--     فالفاتورة نفسها سليمة — لكن **لا سبيل لمعرفة ما كانت التعرفة** في
--     تاريخ ما، ولا لمراجعة اتفاق تأمين انتهى.
--
-- الحل: قوائم أسعار لها نطاق وسريان، وسعر الصنف يبقى **قاعدة أخيرة** لا
-- يُلغى. فمنشأة لم تُنشئ قائمة واحدة تعمل تمامًا كما تعمل اليوم.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) القوائم
-- ---------------------------------------------------------------------------
create table if not exists price_lists (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  name                  text not null,
  list_kind             text not null default 'base',
  branch_id             uuid references branches(id) on delete cascade,
  insurance_company_id  uuid references insurance_companies(id) on delete cascade,
  external_client_id    uuid references external_clients(id) on delete cascade,
  -- الأولوية للحسم بين قائمتين تنطبقان معًا. الافتراضي يعكس التخصيص:
  -- التأمين أخصّ من الشركة، والشركة أخصّ من الفرع، والفرع أخصّ من الأساس.
  priority              integer not null default 0,
  effective_from        date not null default current_date,
  effective_to          date,
  is_active             boolean not null default true,
  note                  text,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint price_lists_kind_check check (
    list_kind in ('base', 'branch', 'insurance', 'corporate')
  ),
  constraint price_lists_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  -- كل نوع ونطاقه: قائمة تأمين بلا شركة لا تنطبق على أحد، وقائمة أساس
  -- مربوطة بفرع تناقض اسمها. الشرط يمنع الحالتين عند الإدخال بدل أن تجلسا
  -- في الجدول بلا أثر.
  constraint price_lists_scope_check check (
    (list_kind = 'base'      and branch_id is null and insurance_company_id is null and external_client_id is null)
 or (list_kind = 'branch'    and branch_id is not null and insurance_company_id is null and external_client_id is null)
 or (list_kind = 'insurance' and insurance_company_id is not null and external_client_id is null)
 or (list_kind = 'corporate' and external_client_id is not null and insurance_company_id is null)
  )
);

create index if not exists idx_price_lists_org on price_lists (organization_id, is_active);
create index if not exists idx_price_lists_branch on price_lists (branch_id) where branch_id is not null;
create index if not exists idx_price_lists_insurance on price_lists (insurance_company_id) where insurance_company_id is not null;

-- ---------------------------------------------------------------------------
-- 2) أسعار البنود — الصفوف القديمة تبقى
--
-- تغيير السعر **لا يُحدِّث الصف**: يُغلق الصف القائم بتاريخ نهاية ويُدرج صف
-- جديد. فيبقى «كم كان سعر هذه الخدمة في مارس؟» سؤالًا له جواب.
-- ---------------------------------------------------------------------------
create table if not exists price_list_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  price_list_id    uuid not null references price_lists(id) on delete cascade,
  item_id          uuid not null references items(id) on delete cascade,
  price            numeric(14,2) not null check (price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  effective_from   date not null default current_date,
  effective_to     date,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  constraint price_list_items_period_check check (
    effective_to is null or effective_to >= effective_from
  )
);

create index if not exists idx_price_list_items_lookup
  on price_list_items (price_list_id, item_id, effective_from desc);
create index if not exists idx_price_list_items_item on price_list_items (item_id);

-- صفٌّ مفتوح واحد لكل (قائمة، صنف): وجود صفَّين مفتوحين يعني سعرين ساريين
-- في اللحظة نفسها، ولا معنى لذلك. أما الصفوف المغلقة فتتراكم — وهي التاريخ.
create unique index if not exists uq_price_list_items_open
  on price_list_items (price_list_id, item_id) where effective_to is null;

alter table price_lists enable row level security;
alter table price_list_items enable row level security;

drop policy if exists "price_lists_read" on price_lists;
create policy "price_lists_read" on price_lists
  for select using (app_is_member(organization_id));
drop policy if exists "price_lists_write" on price_lists;
create policy "price_lists_write" on price_lists
  for all using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));

drop policy if exists "price_list_items_read" on price_list_items;
create policy "price_list_items_read" on price_list_items
  for select using (app_is_member(organization_id));
drop policy if exists "price_list_items_write" on price_list_items;
create policy "price_list_items_write" on price_list_items
  for all using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));

revoke all on price_lists from anon;
revoke all on price_list_items from anon;
grant select, insert, update, delete on price_lists to authenticated;
grant select, insert, update, delete on price_list_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3) تغيير السعر — إغلاق وإدراج في معاملة واحدة
--
-- `effective_to` للصف القديم = **اليوم السابق** لبداية الجديد، لا نفس اليوم:
-- لو تساويا لكان لليوم الواحد سعران، ولاختلف حساب الفاتورة بحسب أيّ صف
-- يُقرأ أولًا.
-- ---------------------------------------------------------------------------
create or replace function app_set_price_list_item(
  p_price_list_id  uuid,
  p_item_id        uuid,
  p_price          numeric,
  p_effective_from date default current_date,
  p_discount_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
  v_current price_list_items%rowtype;
begin
  select organization_id into v_org from price_lists where id = p_price_list_id;
  if v_org is null then
    raise exception 'قائمة الأسعار غير موجودة';
  end if;
  if not app_has_permission(v_org, 'catalog.pricing') then
    raise exception 'صلاحيتك لا تسمح بتعديل الأسعار';
  end if;
  if not exists (select 1 from items where id = p_item_id and organization_id = v_org) then
    raise exception 'الصنف لا ينتمي لهذه المنشأة';
  end if;
  if p_price < 0 then
    raise exception 'السعر لا يكون سالبًا';
  end if;

  select * into v_current
    from price_list_items
   where price_list_id = p_price_list_id and item_id = p_item_id and effective_to is null
   for update;

  if v_current.id is not null then
    if p_effective_from <= v_current.effective_from then
      raise exception 'تاريخ السريان الجديد (%) يجب أن يكون بعد تاريخ السعر الحالي (%)',
        p_effective_from, v_current.effective_from;
    end if;
    if v_current.price = p_price and v_current.discount_percent = coalesce(p_discount_percent, 0) then
      raise exception 'السعر لم يتغيّر';
    end if;
    update price_list_items
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  insert into price_list_items (organization_id, price_list_id, item_id, price,
                                discount_percent, effective_from, created_by)
  values (v_org, p_price_list_id, p_item_id, p_price,
          coalesce(p_discount_percent, 0), p_effective_from, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_set_price_list_item(uuid, uuid, numeric, date, numeric) from public, anon;
grant execute on function app_set_price_list_item(uuid, uuid, numeric, date, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) حسم السعر
--
-- الترتيب من الأخصّ إلى الأعمّ، ثم `items.price` قاعدةً أخيرة. تُعيد الدالة
-- **مصدر السعر مع السعر**: محاسب يرى 250 ولا يعرف من أين جاءت لا يستطيع
-- مراجعتها ولا شرحها للمريض.
-- ---------------------------------------------------------------------------
create or replace function app_resolve_item_price(
  p_organization_id      uuid,
  p_item_id              uuid,
  p_branch_id            uuid default null,
  p_insurance_company_id uuid default null,
  p_external_client_id   uuid default null,
  p_as_of                date default current_date
)
returns table (
  price            numeric,
  discount_percent numeric,
  source_kind      text,
  source_list_id   uuid,
  source_list_name text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(m.price, i.price, 0),
         coalesce(m.discount_percent, i.default_discount_percent, 0),
         coalesce(m.list_kind, 'item'),
         m.list_id,
         coalesce(m.list_name, 'سعر الصنف')
  from items i
  left join lateral (
    select pl.id as list_id, pl.name as list_name, pl.list_kind,
           pli.price, pli.discount_percent
      from price_list_items pli
      join price_lists pl on pl.id = pli.price_list_id
     where pli.item_id = p_item_id
       and pl.organization_id = p_organization_id
       and pl.is_active
       and pl.effective_from <= p_as_of
       and (pl.effective_to is null or pl.effective_to >= p_as_of)
       and pli.effective_from <= p_as_of
       and (pli.effective_to is null or pli.effective_to >= p_as_of)
       and (
            (pl.list_kind = 'insurance' and p_insurance_company_id is not null
             and pl.insurance_company_id = p_insurance_company_id)
         or (pl.list_kind = 'corporate' and p_external_client_id is not null
             and pl.external_client_id = p_external_client_id)
         or (pl.list_kind = 'branch' and p_branch_id is not null and pl.branch_id = p_branch_id)
         or (pl.list_kind = 'base')
       )
     order by
       -- الأخصّ أولًا، ثم الأولوية اليدوية، ثم الأحدث سريانًا
       case pl.list_kind
         when 'insurance' then 1
         when 'corporate' then 2
         when 'branch'    then 3
         else 4
       end,
       pl.priority desc,
       pli.effective_from desc
     limit 1
  ) m on true
  where i.id = p_item_id and i.organization_id = p_organization_id
    -- الدالة SECURITY DEFINER فتتجاوز RLS: بدون هذا الشرط يقرأ أيّ مستخدم
    -- مسجَّل أسعار أيّ منشأة بمعرّف صنف واحد.
    and app_is_member(p_organization_id);
$$;

comment on function app_resolve_item_price(uuid, uuid, uuid, uuid, uuid, date) is
  'يحسم سعر الصنف في تاريخ معيّن: قائمة تأمين ← قائمة شركة ← قائمة فرع ← قائمة أساس ← سعر الصنف. يُعيد مصدر السعر معه.';

revoke all on function app_resolve_item_price(uuid, uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function app_resolve_item_price(uuid, uuid, uuid, uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) منظور تاريخ السعر — للمراجعة
-- ---------------------------------------------------------------------------
create or replace view v_item_price_history as
select
  pli.id,
  pli.organization_id,
  pli.item_id,
  i.name_ar          as item_name,
  pl.id              as price_list_id,
  pl.name            as price_list_name,
  pl.list_kind,
  pli.price,
  pli.discount_percent,
  pli.effective_from,
  pli.effective_to,
  (pli.effective_to is null) as is_current,
  pli.created_by,
  pli.created_at
from price_list_items pli
join price_lists pl on pl.id = pli.price_list_id
join items i on i.id = pli.item_id;

alter view v_item_price_history set (security_invoker = on);
revoke all on v_item_price_history from anon;
grant select on v_item_price_history to authenticated;

commit;
