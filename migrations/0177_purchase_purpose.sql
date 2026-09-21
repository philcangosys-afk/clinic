-- ============================================================================
-- 0177 — جهة الشراء: صيدلية، مستلزمات طبية، إدارية
-- ============================================================================
--
-- كانت المشتريات لا تعرف لمن تُشترى: فاتورةٌ لأدوية الصيدلية وفاتورةٌ لقفّازات
-- العيادات وفاتورةٌ لورق الطابعة تُسجَّل كلّها بالشكل نفسه، فلا يُعرف كم صرفت
-- الصيدلية ولا كم صرفت الإدارة، ولا يمنع شيءٌ أن تدخل الأدوية مستودع الإدارة.
--
-- الآن:
--   * لكلّ مستودع نوع: صيدلية، طبي، إداري، أو «عام» يقبل كلّ الجهات.
--   * لكلّ مستند شراء «جهة شراء» تُختار في طلب الشراء، ثمّ تنتقل وحدها إلى
--     أمر الشراء فالاستلام ففاتورة المورد فالمرتجع — لا تُسأل مرّةً ثانية.
--   * المستودع يجب أن يطابق الجهة (أو يكون عامًّا) — وإلّا رُفض المستند.
--   * سند المصروف (المصروفات النقدية) يحمل الجهة أيضًا، فيجتمع في تقرير
--     المشتريات ما اشتُري بفاتورة مورد وما دُفع نقدًا.
--
-- المستندات القديمة: تُصنَّف فقط حيث يدلّ مستودعها على جهةٍ بعينها. ما عدا
-- ذلك يبقى «غير مصنّف» — لا نخترع تصنيفًا لم يختره أحد.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) نوع المستودع ─────────────────────────────────────────────────────────
alter table warehouses add column if not exists purpose text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouses_purpose_check') then
    alter table warehouses add constraint warehouses_purpose_check
      check (purpose in ('general', 'pharmacy', 'medical', 'administrative'));
  end if;
end $$;

-- الاستدلال الوحيد الآمن: مستودعٌ اسمه يقول «صيدلية». وما عداه «عام» يقبل
-- كلّ الجهات كما كان يعمل قبل هذه الترقية، فلا يتعطّل شراءٌ قائم.
update warehouses
   set purpose = case
                   when name ilike '%صيدل%' or name ilike '%pharm%' then 'pharmacy'
                   else 'general'
                 end
 where purpose is null;

alter table warehouses alter column purpose set default 'general';
alter table warehouses alter column purpose set not null;

comment on column warehouses.purpose is
  'نوع المستودع: general عام يقبل كلّ الجهات، pharmacy صيدلية، medical مستلزمات طبية، administrative إداري (0177).';

-- ── 2) جهة الشراء على مستندات الدورة ───────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['purchase_requests', 'purchase_orders', 'goods_receipts',
                           'purchase_invoices', 'purchase_returns', 'financial_vouchers']
  loop
    execute format('alter table %I add column if not exists purchase_purpose text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_purchase_purpose_check') then
      execute format(
        'alter table %I add constraint %I check (purchase_purpose is null or purchase_purpose in (''pharmacy'', ''medical'', ''administrative''))',
        t, t || '_purchase_purpose_check');
    end if;
    execute format('create index if not exists %I on %I (organization_id, purchase_purpose)',
                   'idx_' || t || '_purpose', t);
  end loop;
end $$;

-- ── 3) تصنيف القديم من مستودعه وحده ────────────────────────────────────────
-- حُرّاس المستندات المرحَّلة تمنع تعديلها — وهذا تصنيفٌ لا تعديلٌ لمضمونها،
-- فتُعطَّل الحُرّاس داخل هذه المعاملة وحدها ثمّ تعود.
do $$
declare
  t text;
begin
  foreach t in array array['purchase_requests', 'purchase_orders', 'goods_receipts',
                           'purchase_invoices', 'purchase_returns']
  loop
    execute format('alter table %I disable trigger user', t);
    execute format(
      'update %I d set purchase_purpose = w.purpose
         from warehouses w
        where w.id = d.warehouse_id
          and w.purpose <> ''general''
          and d.purchase_purpose is null', t);
    execute format('alter table %I enable trigger user', t);
  end loop;
end $$;

-- ── 4) الجهة تُورَث وتُطابَق ────────────────────────────────────────────────
create or replace function app_resolve_purchase_purpose()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new        jsonb;
  v_parent     text;
  v_wh_purpose text;
  v_wh_name    text;
  v_labels     constant jsonb := jsonb_build_object(
    'pharmacy', 'الصيدلية',
    'medical', 'المستلزمات الطبية',
    'administrative', 'المشتريات الإدارية');
begin
  -- الجهة من المستند السابق في الدورة — هي التي اختارها من طلب الشراء.
  -- الأعمدة تُقرأ من نسخة نصّية للصفّ: الدالّة نفسها على خمسة جداول، و
  -- `new.<عمود>` يفشل على جدولٍ ليس فيه ذلك العمود.
  v_new := to_jsonb(new);
  if tg_table_name = 'purchase_orders' then
    select purchase_purpose into v_parent from purchase_requests
     where id = (v_new ->> 'purchase_request_id')::uuid;
  elsif tg_table_name = 'goods_receipts' then
    select purchase_purpose into v_parent from purchase_orders
     where id = (v_new ->> 'purchase_order_id')::uuid;
  elsif tg_table_name = 'purchase_invoices' then
    select purchase_purpose into v_parent from goods_receipts
     where id = (v_new ->> 'goods_receipt_id')::uuid;
    if v_parent is null then
      select purchase_purpose into v_parent from purchase_orders
       where id = (v_new ->> 'purchase_order_id')::uuid;
    end if;
  elsif tg_table_name = 'purchase_returns' then
    select purchase_purpose into v_parent from purchase_invoices
     where id = (v_new ->> 'purchase_invoice_id')::uuid;
    if v_parent is null then
      select purchase_purpose into v_parent from goods_receipts
       where id = (v_new ->> 'goods_receipt_id')::uuid;
    end if;
  end if;

  if new.purchase_purpose is null then
    new.purchase_purpose := v_parent;
  elsif v_parent is not null and new.purchase_purpose <> v_parent then
    raise exception 'جهة الشراء لا تتغيّر في منتصف الدورة: المستند السابق لـ«%» وهذا لـ«%»',
      v_labels ->> v_parent, v_labels ->> new.purchase_purpose;
  end if;

  if new.warehouse_id is not null then
    select purpose, name into v_wh_purpose, v_wh_name from warehouses where id = new.warehouse_id;
    if new.purchase_purpose is null and v_wh_purpose <> 'general' then
      new.purchase_purpose := v_wh_purpose;
    elsif new.purchase_purpose is not null
          and v_wh_purpose is not null
          and v_wh_purpose <> 'general'
          and v_wh_purpose <> new.purchase_purpose then
      raise exception 'المستودع «%» مخصّص لـ«%» — وهذا الشراء لـ«%». اختر مستودعًا مطابقًا أو مستودعًا عامًّا',
        v_wh_name, v_labels ->> v_wh_purpose, v_labels ->> new.purchase_purpose;
    end if;
  end if;

  -- طلب الشراء أوّل الدورة: لا يُقبل بلا جهة. وما بعده يرث — ومستندٌ من
  -- دورةٍ قديمة غير مصنّفة يبقى كذلك بدل أن يُرفض استلامه.
  if tg_table_name = 'purchase_requests' and new.purchase_purpose is null then
    raise exception 'حدّد جهة الشراء: الصيدلية، أو المستلزمات الطبية، أو المشتريات الإدارية';
  end if;

  return new;
end;
$$;

revoke all on function app_resolve_purchase_purpose() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['purchase_requests', 'purchase_orders', 'goods_receipts',
                           'purchase_invoices', 'purchase_returns']
  loop
    execute format('drop trigger if exists trg_resolve_purchase_purpose on %I', t);
    -- عند الإدراج، وعند تغيير المستودع أو الجهة فقط: تغيير الحالة لا يُعيد الفحص
    execute format(
      'create trigger trg_resolve_purchase_purpose
         before insert or update of warehouse_id, purchase_purpose on %I
         for each row execute function app_resolve_purchase_purpose()', t);
  end loop;
end $$;

-- ── 5) منظور الإنفاق: فواتير الموردين + المصروفات النقدية ──────────────────
drop view if exists v_procurement_spend;
create view v_procurement_spend
with (security_invoker = on) as
select
  'invoice'::text             as source_kind,
  pi.id                       as source_id,
  pi.organization_id,
  pi.branch_id,
  pi.invoice_date             as doc_date,
  pi.invoice_number::text     as doc_number,
  pi.purchase_purpose,
  pi.distributor_id,
  d.name_ar                   as party_name,
  null::text                  as category_name,
  pi.warehouse_id,
  w.name                      as warehouse_name,
  null::uuid                  as clinic_id,
  coalesce(pi.vat_amount, 0)  as vat_amount,
  coalesce(pi.net_amount, 0)  as total_amount,
  coalesce(pi.paid_amount, 0) as paid_amount,
  coalesce(pi.status, 'unpaid') as status
from purchase_invoices pi
left join distributors d on d.id = pi.distributor_id
left join warehouses w on w.id = pi.warehouse_id
where coalesce(pi.status, 'unpaid') <> 'cancelled'
union all
select
  'expense'::text,
  v.id,
  v.organization_id,
  v.branch_id,
  v.voucher_date,
  v.voucher_number::text,
  v.purchase_purpose,
  v.distributor_id,
  coalesce(d.name_ar, v.payee_name),
  lv.name_ar,
  null::uuid,
  null::text,
  v.clinic_id,
  coalesce(v.vat_amount, 0),
  coalesce(v.amount, 0),
  coalesce(v.amount, 0),
  'paid'
from financial_vouchers v
left join distributors d on d.id = v.distributor_id
left join lookup_values lv on lv.id = v.expense_category_value_id
where v.voucher_type = 'expense'
  and not coalesce(v.is_void, false);

comment on view v_procurement_spend is
  'كلّ ما أُنفق على الشراء: فواتير الموردين غير الملغاة وسندات المصروف غير الملغاة، بجهة الشراء (0177).';

grant select on v_procurement_spend to authenticated;

-- ── 6) تحقّق ────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  if (select count(*) from warehouses where purpose is null) > 0 then
    raise exception '0177: مستودعٌ بلا نوع';
  end if;
  foreach t in array array['purchase_requests', 'purchase_orders', 'goods_receipts',
                           'purchase_invoices', 'purchase_returns']
  loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                    where c.relname = t and g.tgname = 'trg_resolve_purchase_purpose'
                      and g.tgenabled = 'O') then
      raise exception '0177: حارس الجهة غير مفعّل على %', t;
    end if;
    -- الحُرّاس التي عُطّلت للتصنيف عادت كلّها
    if exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                where c.relname = t and not g.tgisinternal and g.tgenabled = 'D') then
      raise exception '0177: حارسٌ بقي معطّلًا على %', t;
    end if;
  end loop;
end $$;

commit;
