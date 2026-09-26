-- ============================================================================
-- 0191 — اليوميات السابقة: من فتحها ومن عمل عليها، وسجلٌّ يُفلتر ويُفتح
-- ============================================================================
--
-- شاشة «اليومية» كانت تعرض يومية التاريخ المختار بلا اسمٍ عليها: لا من
-- فتحها، ولا من أقفلها، ولا من أصدر فواتيرها. والأيام السابقة تُفتح من
-- منتقي تاريخٍ مفتوحٍ لكلّ من يرى الفوترة.
--
-- ── ما يضاف ───────────────────────────────────────────────────────────────
--
-- ١. **صلاحية `billing.day_history` — «عرض اليوميات السابقة».**
--    المالك ومدير النظام يملكانها بتخطّيهما الفحص، ومدير الفرع افتراضًا.
--    ومن سواهم يرى يومية اليوم وحدها. وهي صلاحيةٌ في الكتالوج لا صفةٌ
--    مكتوبة في الشيفرة: تُمنح أو تُسحب لأيّ دور من «الأدوار والصلاحيات».
--
-- ٢. **`app_business_day_people`** — لليومية الواحدة: من فتحها، ومن أقفلها،
--    ومن أصدر فواتيرها. الأسماء بنفس ترتيب 0189 (`app_member_user_name`)،
--    فما يظهر على اليومية هو ما يظهر على الفاتورة.
--
-- ٣. **`app_business_day_history`** — سجلّ اليوميات بفلتر تاريخٍ (من — إلى)
--    وفلتر مستخدم. **مشروطةٌ بالصلاحية في القاعدة** لا بإخفاء زرّ.
--    والمستخدم يُطابق اليومية إن فتحها أو أقفلها أو أصدر فيها فاتورة:
--    اليومية على مستوى المنشأة يعمل فيها أكثر من موظّف، ومن أصدر فاتورةً
--    فيها عمل عليها وإن لم يفتحها.
--
-- ٤. **`v_business_day_summary` + `opened_by`** — عمودٌ في آخر المنظور.
--
-- ── حدٌّ يُقال صراحةً ─────────────────────────────────────────────────────
-- الصلاحية تحكم **سجلّ اليوميات** وشاشتها. أمّا الفواتير نفسها فتبقى تُرى
-- بصلاحية الفوترة كما كانت — تقييدها بيوم العمل قرارٌ آخر لم يُطلب هنا.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) الصلاحية ─────────────────────────────────────────────────────────────
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values ('billing.day_history', 'عرض اليوميات السابقة', 'billing',
        'فتح اليوميات المقفلة وسجلّها بفلتر التاريخ والمستخدم. بدونها يرى العضو يومية اليوم وحدها.',
        4120)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
values ('branch_manager', 'billing.day_history')
on conflict (role_key, permission_key) do nothing;

-- ── 2) المنظور: من فتح اليومية ────────────────────────────────────────────
create or replace view v_business_day_summary as
select
  d.id                                    as business_day_id,
  d.organization_id,
  d.branch_id,
  d.day_number,
  d.business_date,
  d.opened_at,
  d.closed_at,
  d.closed_by,
  d.note,
  (d.closed_at is null)                   as is_open,
  coalesce(inv.invoices_count, 0)         as invoices_count,
  coalesce(inv.gross_amount, 0)           as gross_amount,
  coalesce(inv.discount_amount, 0)        as discount_amount,
  coalesce(inv.vat_amount, 0)             as vat_amount,
  coalesce(inv.exemption_amount, 0)       as exemption_amount,
  coalesce(inv.net_amount, 0)             as net_amount,
  coalesce(vch.collected_amount, 0)       as collected_amount,
  coalesce(vch.refunded_amount, 0)        as refunded_amount,
  coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0) as net_collected_amount,
  coalesce(inv.net_amount, 0) - (coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0))
                                          as outstanding_amount,
  d.scheduled_close_at,
  d.auto_closed,
  -- 0191: من فتح اليومية — يُضاف في آخر الأعمدة، فـ`create or replace`
  -- لا يقبل إدراج عمودٍ بين أعمدةٍ قائمة.
  d.opened_by
from business_days d
left join lateral (
  select count(*)                                     as invoices_count,
         sum(i.subtotal_amount)                       as gross_amount,
         sum(i.discount_amount)                       as discount_amount,
         sum(i.vat_amount)                            as vat_amount,
         sum(i.exemption_amount)                      as exemption_amount,
         sum(i.net_amount)                            as net_amount
    from sales_invoices i
   where i.business_day_id = d.id
     and i.status <> 'void'
     and not coalesce(i.is_temporary, false)
) inv on true
left join lateral (
  select sum(case when v.voucher_type = 'receipt' then v.amount else 0 end) as collected_amount,
         sum(case when v.voucher_type <> 'receipt' then v.amount else 0 end) as refunded_amount
    from financial_vouchers v
   where v.business_day_id = d.id
     and not coalesce(v.is_void, false)
) vch on true;

alter view v_business_day_summary set (security_invoker = on);
grant select on v_business_day_summary to authenticated;

-- ── 3) أشخاص اليومية الواحدة ───────────────────────────────────────────────
create or replace function app_business_day_people(p_business_day_id uuid)
returns table (opened_by_name text, closed_by_name text, issuers text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_open   uuid;
  v_close  uuid;
begin
  select organization_id, opened_by, closed_by into v_org, v_open, v_close
    from business_days where id = p_business_day_id;
  if v_org is null then
    raise exception 'اليومية غير موجودة';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا صلاحية على هذه اليومية';
  end if;

  return query
  select case when v_open  is null then null else app_member_user_name(v_org, v_open)  end,
         case when v_close is null then null else app_member_user_name(v_org, v_close) end,
         (select string_agg(n, '، ' order by n)
            from (select distinct app_member_user_name(v_org, i.created_by) as n
                    from sales_invoices i
                   where i.business_day_id = p_business_day_id
                     and i.created_by is not null) x
           where n is not null);
end $$;

revoke all on function app_business_day_people(uuid) from public, anon;
grant execute on function app_business_day_people(uuid) to authenticated;

-- ── 4) سجلّ اليوميات ───────────────────────────────────────────────────────
create or replace function app_business_day_history(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null,
  p_user_id         uuid default null
)
returns table (
  business_day_id      uuid,
  day_number           bigint,
  business_date        date,
  opened_at            timestamptz,
  closed_at            timestamptz,
  is_open              boolean,
  auto_closed          boolean,
  opened_by_name       text,
  closed_by_name       text,
  issuers              text,
  invoices_count       bigint,
  net_amount           numeric,
  net_collected_amount numeric,
  outstanding_amount   numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'billing.day_history') then
    raise exception 'صلاحيتك لا تسمح بعرض اليوميات السابقة (billing.day_history)';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'تاريخ «إلى» قبل تاريخ «من»';
  end if;

  return query
  select s.business_day_id,
         s.day_number::bigint,
         s.business_date,
         s.opened_at,
         s.closed_at,
         s.is_open,
         coalesce(s.auto_closed, false),
         case when d.opened_by is null then null else app_member_user_name(d.organization_id, d.opened_by) end,
         case when d.closed_by is null then null else app_member_user_name(d.organization_id, d.closed_by) end,
         (select string_agg(n, '، ' order by n)
            from (select distinct app_member_user_name(d.organization_id, i.created_by) as n
                    from sales_invoices i
                   where i.business_day_id = d.id
                     and i.created_by is not null) x
           where n is not null),
         s.invoices_count::bigint,
         s.net_amount::numeric,
         s.net_collected_amount::numeric,
         s.outstanding_amount::numeric
    from v_business_day_summary s
    join business_days d on d.id = s.business_day_id
   where d.organization_id = p_organization_id
     and (p_from is null or d.business_date >= p_from)
     and (p_to   is null or d.business_date <= p_to)
     and (p_user_id is null
          or d.opened_by = p_user_id
          or d.closed_by = p_user_id
          or exists (select 1 from sales_invoices i
                      where i.business_day_id = d.id
                        and i.created_by = p_user_id))
   order by d.business_date desc, d.day_number desc
   limit 500;
end $$;

revoke all on function app_business_day_history(uuid, date, date, uuid) from public, anon;
grant execute on function app_business_day_history(uuid, date, date, uuid) to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from permission_catalog where permission_key = 'billing.day_history') then
    raise exception 'billing.day_history لم تُضف إلى الكتالوج';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'v_business_day_summary' and column_name = 'opened_by') then
    raise exception 'v_business_day_summary بلا opened_by';
  end if;
  if not exists (select 1 from pg_proc where proname = 'app_member_user_name') then
    raise exception 'app_member_user_name غير موجودة — نفّذ 0189 أوّلًا';
  end if;
  raise notice '0191 ✓ سجلّ اليوميات وأشخاصها جاهزان';
end $$;
