-- ============================================================================
-- 0239_vat_payable.sql — صافي ضريبة القيمة المضافة المستحقّ دفعها
-- ============================================================================
-- طلب المالك (10/10/2026): «صفحة تعمل تلقائيًّا: الفرق بين المشتريات والمبيعات،
-- مفصّلة، لتظهر الضريبة المستحقّ دفعها».
--
-- `app_vat_payable(منشأة، من، إلى)` تحسب في القاعدة، لفترةٍ بتوقيت الرياض:
--   ضريبة المخرجات (المبيعات):
--     • الفواتير الصادرة (مبسّطة وضريبية) — لا المسوّدة ولا الملغاة ولا المؤقّتة
--     • − الإشعارات الدائنة   • + الإشعارات المدينة
--   ضريبة المدخلات (المشتريات) — القابلة للخصم وحدها:
--     • فواتير المشتريات غير الملغاة **برقمٍ ضريبيّ للمورد**
--     • − مرتجعات المشتريات غير الملغاة
--     • + المصروفات النقدية بضريبةٍ وبرقمٍ ضريبيّ للمورد
--   وما عليه ضريبةٌ بلا رقمٍ ضريبيّ للمورد يُعرض منفصلًا «غير قابل للخصم».
--   الصافي = المخرجات − المدخلات: موجبٌ يُدفع للهيئة، وسالبٌ رصيدٌ دائن.
--
-- قراءة فقط. للمالك ومدير المنشأة والمحاسب ومدير الفرع. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

drop function if exists public.app_vat_payable(uuid, date, date);

create function public.app_vat_payable(
  p_organization_id uuid,
  p_from            date,
  p_to              date
)
returns table (
  sales_count           bigint,
  sales_taxable         numeric,
  sales_vat             numeric,
  credit_count          bigint,
  credit_taxable        numeric,
  credit_vat            numeric,
  debit_count           bigint,
  debit_taxable         numeric,
  debit_vat             numeric,
  purchase_count        bigint,
  purchase_taxable      numeric,
  purchase_vat          numeric,
  purchase_return_count bigint,
  purchase_return_taxable numeric,
  purchase_return_vat   numeric,
  expense_count         bigint,
  expense_taxable       numeric,
  expense_vat           numeric,
  nondeductible_count   bigint,
  nondeductible_vat     numeric,
  output_vat            numeric,
  input_vat             numeric,
  net_vat               numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s  record;
  pu record;
  pr record;
  ex record;
  nd record;
begin
  if not app_has_role(p_organization_id, array['owner', 'organization_admin', 'accountant', 'branch_manager']) then
    raise exception 'صافي الضريبة للمالك والإدارة والمحاسب';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'حدّد فترةً صحيحة (من — إلى)';
  end if;

  -- المبيعات: الوعاء = الصافي − الضريبة (كما في «الفواتير الضريبية»)
  select count(*) filter (where kind = 'sale')                         as sc,
         coalesce(sum(taxable) filter (where kind = 'sale'), 0)        as st,
         coalesce(sum(vat)     filter (where kind = 'sale'), 0)        as sv,
         count(*) filter (where kind = 'credit')                       as cc,
         coalesce(sum(taxable) filter (where kind = 'credit'), 0)      as ct,
         coalesce(sum(vat)     filter (where kind = 'credit'), 0)      as cv,
         count(*) filter (where kind = 'debit')                        as dc,
         coalesce(sum(taxable) filter (where kind = 'debit'), 0)       as dt,
         coalesce(sum(vat)     filter (where kind = 'debit'), 0)       as dv
    into s
    from (
      select case
               when i.document_type = 'credit_note' or i.invoice_type = 'return' then 'credit'
               when i.document_type = 'debit_note' then 'debit'
               else 'sale'
             end as kind,
             abs(coalesce(i.net_amount, 0)) - abs(coalesce(i.vat_amount, 0)) as taxable,
             abs(coalesce(i.vat_amount, 0)) as vat
        from sales_invoices i
       where i.organization_id = p_organization_id
         and i.issued_at is not null
         and coalesce(i.status, '') not in ('draft', 'void')
         and not coalesce(i.is_temporary, false)
         and (i.issued_at at time zone 'Asia/Riyadh')::date between p_from and p_to
    ) x;

  -- المشتريات بفاتورةٍ ضريبية (برقم المورد الضريبيّ)
  select count(*)                                                       as n,
         coalesce(sum(coalesce(net_amount, 0) - coalesce(vat_amount, 0)), 0) as t,
         coalesce(sum(coalesce(vat_amount, 0)), 0)                      as v
    into pu
    from purchase_invoices
   where organization_id = p_organization_id
     and coalesce(status, '') <> 'cancelled'
     and coalesce(vat_amount, 0) > 0
     and coalesce(btrim(supplier_tax_number), '') <> ''
     and invoice_date between p_from and p_to;

  -- مرتجعات المشتريات (تُنقص المدخلات)
  select count(*)                                                       as n,
         coalesce(sum(coalesce(net_amount, 0) - coalesce(vat_amount, 0)), 0) as t,
         coalesce(sum(coalesce(vat_amount, 0)), 0)                      as v
    into pr
    from purchase_returns
   where organization_id = p_organization_id
     and coalesce(status, '') not in ('cancelled', 'draft')
     and coalesce(vat_amount, 0) > 0
     and (coalesce(posted_at, returned_at, created_at) at time zone 'Asia/Riyadh')::date between p_from and p_to;

  -- المصروفات النقدية بضريبةٍ وبرقمٍ ضريبيّ (المبلغ شاملٌ ضريبته)
  select count(*)                                                       as n,
         coalesce(sum(coalesce(amount, 0) - coalesce(vat_amount, 0)), 0) as t,
         coalesce(sum(coalesce(vat_amount, 0)), 0)                      as v
    into ex
    from financial_vouchers
   where organization_id = p_organization_id
     and voucher_type = 'expense'
     and not coalesce(is_void, false)
     and coalesce(vat_amount, 0) > 0
     and coalesce(btrim(supplier_tax_number), '') <> ''
     and voucher_date between p_from and p_to;

  -- عليها ضريبة بلا رقمٍ ضريبيّ للمورد: لا تُخصم
  select count(*) as n, coalesce(sum(v), 0) as v
    into nd
    from (
      select coalesce(vat_amount, 0) as v
        from purchase_invoices
       where organization_id = p_organization_id
         and coalesce(status, '') <> 'cancelled'
         and coalesce(vat_amount, 0) > 0
         and coalesce(btrim(supplier_tax_number), '') = ''
         and invoice_date between p_from and p_to
      union all
      select coalesce(vat_amount, 0)
        from financial_vouchers
       where organization_id = p_organization_id
         and voucher_type = 'expense'
         and not coalesce(is_void, false)
         and coalesce(vat_amount, 0) > 0
         and coalesce(btrim(supplier_tax_number), '') = ''
         and voucher_date between p_from and p_to
    ) y;

  sales_count := s.sc;   sales_taxable := s.st;   sales_vat := s.sv;
  credit_count := s.cc;  credit_taxable := s.ct;  credit_vat := s.cv;
  debit_count := s.dc;   debit_taxable := s.dt;   debit_vat := s.dv;
  purchase_count := pu.n;        purchase_taxable := pu.t;        purchase_vat := pu.v;
  purchase_return_count := pr.n; purchase_return_taxable := pr.t; purchase_return_vat := pr.v;
  expense_count := ex.n;         expense_taxable := ex.t;         expense_vat := ex.v;
  nondeductible_count := nd.n;   nondeductible_vat := nd.v;
  output_vat := round(s.sv - s.cv + s.dv, 2);
  input_vat  := round(pu.v - pr.v + ex.v, 2);
  net_vat    := round(output_vat - input_vat, 2);
  return next;
end $$;

revoke all on function public.app_vat_payable(uuid, date, date) from public, anon;
grant execute on function public.app_vat_payable(uuid, date, date) to authenticated;

comment on function public.app_vat_payable(uuid, date, date) is
  'صافي ضريبة القيمة المضافة لفترة: المخرجات (مبيعات − دائنة + مدينة) − المدخلات القابلة للخصم (مشتريات ومصروفات برقم ضريبي − مرتجعات). 0239.';

commit;
