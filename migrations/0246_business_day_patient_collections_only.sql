-- ============================================================================
-- 0246_business_day_patient_collections_only.sql — اليومية للمرضى وحدهم
-- ============================================================================
-- شكوى المالك (18/10/2026): يومية 21 تعرض «غير محصَّل −1,850.00» (صافي الفواتير
-- 250 والمحصَّل 2,100)، و«بنود المشتريات والمصروفات لا تظهر مع اليومية — وفي
-- أعلى اليومية احذفها».
--
-- السبب:
--   • «غير محصَّل» كان فرقًا حسابيًّا: صافي فواتير اليوم − كلّ ما قُبض في اليوم.
--     فكلّ قبضٍ ليس لفواتير اليوم (سدادُ فاتورةٍ سابقة، أو سند قبضٍ يدويّ من
--     شاشة المحاسبة لا صلة له بمريض) يجعله سالبًا.
--   • والمحصَّل كان يعدّ كلّ سند قبض، ومنه ما لا علاقة له بالمرضى.
--
-- الإصلاح:
--   • «غير محصَّل» = المتبقّي الفعليّ على فواتير اليومية نفسها
--     (`sales_invoices.remaining_amount`) — لا يكون سالبًا أبدًا.
--   • «المحصَّل» وجدول طرق الدفع = قبضٌ من المرضى فقط: سندٌ على فاتورة أو باسم
--     مريض، ناقص استرداد المرضى. سداد الموردين والمصروفات وسندات القبض اليدوية
--     التي لا صلة لها بمريض خارج اليومية كلّيًّا (والواجهة لا تعرضها بعد اليوم).
--   • سجلّ اليوميات بمستخدمٍ مختار (0236) يأخذ «غير محصَّل» بالطريقة نفسها.
--
-- منظوران ودالّة قراءة — لا بيانات تُعدَّل. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

create or replace view public.v_business_day_summary as
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
  coalesce(inv.remaining_amount, 0)       as outstanding_amount,
  d.scheduled_close_at,
  d.auto_closed,
  d.opened_by,
  -- 0243: المصروف في اليومية لغير المرضى — في آخر الأعمدة (لا يُعرض منذ 0246)
  coalesce(vch.expenses_amount, 0)        as expenses_amount
from business_days d
left join lateral (
  select count(*)                                     as invoices_count,
         sum(i.subtotal_amount)                       as gross_amount,
         sum(i.discount_amount)                       as discount_amount,
         sum(i.vat_amount)                            as vat_amount,
         sum(i.exemption_amount)                      as exemption_amount,
         sum(i.net_amount)                            as net_amount,
         -- 0246: المتبقّي الفعليّ على فواتير اليومية (لا فرقًا حسابيًّا قد يسلب)
         sum(case when i.invoice_type = 'return' then 0
                  else greatest(coalesce(i.remaining_amount, 0), 0) end) as remaining_amount
    from sales_invoices i
   where i.business_day_id = d.id
     and i.status <> 'void'
     and not coalesce(i.is_temporary, false)
) inv on true
left join lateral (
  -- 0246: المحصَّل = قبضٌ من المرضى (على فاتورة أو باسم مريض) — لا قبضٌ لا صلة له بمريض
  select sum(case when v.voucher_type = 'receipt'
                   and (v.related_sales_invoice_id is not null or v.patient_id is not null)
                  then v.amount else 0 end)                                 as collected_amount,
         sum(case when v.voucher_type <> 'receipt'
                   and (v.related_sales_invoice_id is not null or v.refund_of_voucher_id is not null)
                  then v.amount else 0 end)                                 as refunded_amount,
         sum(case when v.voucher_type <> 'receipt'
                   and v.related_sales_invoice_id is null
                   and v.refund_of_voucher_id is null
                  then v.amount else 0 end)                                 as expenses_amount
    from financial_vouchers v
   where v.business_day_id = d.id
     and not coalesce(v.is_void, false)
) vch on true;

alter view public.v_business_day_summary set (security_invoker = on);
grant select on public.v_business_day_summary to authenticated;

-- طرق الدفع: القبض والاسترداد للمرضى فقط — سداد المورد ليس تحصيلًا
create or replace view public.v_business_day_collections as
select v.business_day_id,
       v.organization_id,
       coalesce(lv.name_ar, 'غير محدَّدة'::text) as method_name,
       coalesce((lv.extra ->> 'affects_drawer')::boolean, false) as affects_drawer,
       count(*) as vouchers_count,
       sum(case when v.voucher_type = 'receipt' then v.amount else - v.amount end) as amount
  from financial_vouchers v
  left join lookup_values lv on lv.id = v.payment_method_value_id
 where v.business_day_id is not null
   and not coalesce(v.is_void, false)
   and ((v.voucher_type = 'receipt'
         and (v.related_sales_invoice_id is not null or v.patient_id is not null))
        or (v.voucher_type <> 'receipt'
            and (v.related_sales_invoice_id is not null or v.refund_of_voucher_id is not null)))
 group by v.business_day_id, v.organization_id, lv.name_ar, lv.extra;

alter view public.v_business_day_collections set (security_invoker = on);
grant select on public.v_business_day_collections to authenticated;

create or replace function public.app_business_day_history(
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

  -- بلا مستخدم: اليومية كاملة كما في 0191
  if p_user_id is null then
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
     order by d.business_date desc, d.day_number desc
     limit 500;
    return;
  end if;

  -- بمستخدم: يومياته (فتحها أو أقفلها أو أصدر فيها)، وأرقامه هو وحده:
  -- فواتيره في اليومية، والمقبوض عليها في اليومية نفسها، والباقي منها.
  return query
  select d.id,
         d.day_number::bigint,
         d.business_date,
         d.opened_at,
         d.closed_at,
         (d.closed_at is null),
         coalesce(d.auto_closed, false),
         case when d.opened_by is null then null else app_member_user_name(d.organization_id, d.opened_by) end,
         case when d.closed_by is null then null else app_member_user_name(d.organization_id, d.closed_by) end,
         case when coalesce(inv.cnt, 0) > 0 then app_member_user_name(d.organization_id, p_user_id) end,
         coalesce(inv.cnt, 0)::bigint,
         coalesce(inv.net, 0)::numeric,
         coalesce(vch.collected, 0)::numeric,
         coalesce(inv.remaining, 0)::numeric
    from business_days d
    left join lateral (
      select count(*) as cnt, sum(i.net_amount) as net,
             sum(case when i.invoice_type = 'return' then 0
                      else greatest(coalesce(i.remaining_amount, 0), 0) end) as remaining
        from sales_invoices i
       where i.business_day_id = d.id
         and i.created_by = p_user_id
         and i.status <> 'void'
         and not coalesce(i.is_temporary, false)
    ) inv on true
    left join lateral (
      select sum(case when v.voucher_type = 'receipt' then v.amount else -v.amount end) as collected
        from financial_vouchers v
        join sales_invoices i on i.id = v.related_sales_invoice_id
       where v.business_day_id = d.id
         and not coalesce(v.is_void, false)
         and i.created_by = p_user_id
         and i.status <> 'void'
         and not coalesce(i.is_temporary, false)
    ) vch on true
   where d.organization_id = p_organization_id
     and (p_from is null or d.business_date >= p_from)
     and (p_to   is null or d.business_date <= p_to)
     and (d.opened_by = p_user_id
          or d.closed_by = p_user_id
          or exists (select 1 from sales_invoices i
                      where i.business_day_id = d.id
                        and i.created_by = p_user_id))
   order by d.business_date desc, d.day_number desc
   limit 500;
end $$;

revoke all on function public.app_business_day_history(uuid, date, date, uuid) from public, anon;
grant execute on function public.app_business_day_history(uuid, date, date, uuid) to authenticated;

commit;
