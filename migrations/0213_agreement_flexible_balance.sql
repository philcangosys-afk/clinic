-- ============================================================================
-- 0213 — رصيد الاتفاقية المرن: الفوترة من البند بالمبلغ حتى ينتهي (كما في Kizen)
-- ----------------------------------------------------------------------------
-- المشكلة (المالك، 03/10/2026 — اتفاقية ريتال المالكي 190):
--   البند «رصيد اتفاقية Kizen» بكمية 1 وقيمة 4,200. فوترت الاستقبال منه 200
--   (السعر عُدِّل في الفاتورة). الحساب كان **بالكمية**: فُوتر 1 من 1 ⇒ البند
--   «مفوتَر بالكامل»، فاختفى من الفوترة وتعطّل زرّ «فوترة» مع أنّ الباقي 4,000.
--
-- الآن — **بالمبلغ** (قبل الضريبة، فلا تُربكه نسبة الضريبة ولا الإعفاء):
--   • متبقّي البند = قيمته المتّفق عليها − مجموع ما فُوتر منه.
--   • البند يبقى قابلًا للفوترة ما دام له متبقٍّ، وكلّ فاتورة تنقص منه بقدر
--     مبلغها، وتُسجَّل مربوطةً به (المفوتَر والمتبقّي في الاتفاقية يتحدّثان).
--   • الحارس يمنع تجاوز المتبقّي بالمبلغ، لا بالكمية.
--   • سطر الاتفاقية لا يُقيَّد بالحدّ الأدنى لسعر الصنف: الجزء المحصَّل من
--     مبلغٍ متّفقٍ عليه دفعةٌ منه — والحدّ الأقصى يبقى.
--
-- لا تُغيَّر أيّ فاتورة ولا أيّ بيانات: البنود التي «اكتملت كميّتها» وبقي من
-- مبلغها شيءٌ تعود قابلةً للفوترة تلقائيًّا بالحساب الجديد.
-- لا يمسّ ZATCA ولا إصدار الفاتورة ولا ترقيمها. معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) أرصدة البنود: يُضاف الحساب بالمبلغ (الأعمدة القديمة كما هي) ─────────
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
  coalesce(inv.amount, 0)                      as invoiced_amount,
  -- 0213: قيمة البند قبل الضريبة، وما فُوتر منها، والمتبقّي
  v.line_taxable,
  coalesce(inv.taxable, 0)                     as invoiced_taxable,
  greatest(v.line_taxable - coalesce(inv.taxable, 0), 0) as remaining_taxable,
  greatest(coalesce(nullif(ai.net_amount, 0), v.line_taxable) - coalesce(inv.amount, 0), 0) as remaining_amount
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
cross join lateral (
  select coalesce(nullif(ai.taxable_amount, 0),
                  round(coalesce(ai.qty, 0) * coalesce(ai.unit_price, 0), 2) - coalesce(ai.discount_amount, 0)) as line_taxable
) v
left join lateral (
  select sum(sii.qty)        as qty,
         sum(sii.net_amount) as amount,
         sum(round(coalesce(sii.qty, 0) * coalesce(sii.price, 0), 2) - coalesce(sii.discount_amount, 0)) as taxable
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = ai.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale'
) inv on true;

grant select on v_agreement_item_balances to authenticated;

-- ── ٢) بنود عرض السعر كما تعرضها الشاشة (0193) + المبالغ ────────────────────
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
  b.invoiced_amount,
  -- 0213
  b.invoiced_taxable,
  b.remaining_taxable,
  b.remaining_amount
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join items i on i.id = ai.item_id
left join v_agreement_item_balances b on b.agreement_item_id = ai.id;

grant select on v_agreement_quote_lines to authenticated;

-- ── ٣) ما يُفوتَر من الاتفاقيات (0208) + المبالغ ────────────────────────────
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
  b.remaining_qty,
  -- 0213
  b.line_taxable,
  b.invoiced_taxable,
  b.remaining_taxable,
  b.invoiced_amount,
  b.remaining_amount
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join agreement_quotes q on q.id = ai.quote_id
left join items i on i.id = ai.item_id
join v_agreement_item_balances b on b.agreement_item_id = ai.id
where not a.is_disabled
  and not a.debt_cancelled
  and not coalesce(q.is_cancelled, false)
  and ai.item_id is not null;

grant select on v_agreement_billable_items to authenticated;

-- ── ٤) حارس سطر الفاتورة: بالمبلغ لا بالكمية ────────────────────────────────
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
  v_line      numeric;
  v_disabled  boolean;
  v_cancelled boolean;
  v_number    bigint;
  v_desc      text;
  v_done      numeric;
  v_new       numeric;
begin
  if new.agreement_item_id is null then
    return new;
  end if;

  select is_temporary, status, invoice_type into v_temp, v_status, v_type
    from sales_invoices where id = new.invoice_id;
  if coalesce(v_temp, false) or coalesce(v_type, 'sale') <> 'sale' then
    return new;
  end if;

  select coalesce(nullif(ai.taxable_amount, 0),
                  round(coalesce(ai.qty, 0) * coalesce(ai.unit_price, 0), 2) - coalesce(ai.discount_amount, 0)),
         a.is_disabled, coalesce(q.is_cancelled, false), a.agreement_number,
         coalesce(ai.description, '')
    into v_line, v_disabled, v_cancelled, v_number, v_desc
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

  -- ما فُوتر من البند قبل الضريبة (الفواتير الفعلية غير الملغاة)
  select coalesce(sum(round(coalesce(sii.qty, 0) * coalesce(sii.price, 0), 2) - coalesce(sii.discount_amount, 0)), 0)
    into v_done
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = new.agreement_item_id
     and sii.id <> new.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale';

  v_new := round(coalesce(new.qty, 0) * coalesce(new.price, 0), 2) - coalesce(new.discount_amount, 0);

  if v_done + v_new > v_line + 0.01 then
    raise exception 'المبلغ يتجاوز المتبقّي في الاتفاقية #%: قيمة البند % قبل الضريبة، فُوتر منه %، والمتبقّي %، والمطلوب الآن %',
      v_number, round(v_line, 2), round(v_done, 2), round(greatest(v_line - v_done, 0), 2), round(v_new, 2);
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_agreement_invoice_line on sales_invoice_items;
create trigger trg_guard_agreement_invoice_line
  before insert or update of qty, price, discount_amount, agreement_item_id on sales_invoice_items
  for each row execute function app_guard_agreement_invoice_line();

-- ── ٥) سطر الاتفاقية لا يُقيَّد بالحدّ الأدنى لسعر الصنف ────────────────────
-- تعديلٌ موضعيّ في الدالّة القائمة (0167): شرطا الحدّ الأدنى يستثنيان السطر
-- المربوط ببند اتفاقية. إن لم يُعثر على النصّ كما هو لا يُغيَّر شيء (تنبيه).
do $$
declare
  v_src text;
  v_new text;
  v_pat text := E'if v_item.min_price is not null\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_guard_invoice_item_price';
  if v_src is null then
    raise notice 'app_guard_invoice_item_price غير موجودة — لا تعديل';
    return;
  end if;
  v_src := replace(v_src, chr(13), '');
  if position('new.agreement_item_id is null' in v_src) > 0 then
    raise notice 'الحدّ الأدنى يستثني سطر الاتفاقية مسبقًا';
    return;
  end if;
  if (length(v_src) - length(replace(v_src, v_pat, ''))) / length(v_pat) <> 2 then
    raise notice 'نصّ الحدّ الأدنى في app_guard_invoice_item_price تغيّر — لم يُعدَّل';
    return;
  end if;
  v_new := replace(v_src, v_pat, E'if v_item.min_price is not null\n     and new.agreement_item_id is null  -- 0213: دفعةٌ من مبلغ اتفاقية\n');
  execute v_new;
end $$;

-- ── ٦) حفظ عرض السعر: لا تنزل قيمة البند تحت ما فُوتر منه (بالمبلغ) ─────────
-- كان: «لا يُنزَل العدد تحت المفوتَر بالكمية» — فبندٌ بكمية 1 فُوتر منه
-- دفعتان يصير «مفوتَرًا 2» فيُرفض حفظ العرض. تعديلٌ موضعيّ في الدالّة (0193)،
-- يطابق الفحص بنمطٍ لا يتأثّر بالمسافات ولا بنصّ الرسالة، ولكلّ نسخها.
do $$
declare
  r       record;
  v_src   text;
  v_new   text;
  v_n     integer := 0;
  v_done  integer := 0;
  v_pat   text := 'select\s+coalesce\(\s*b\.invoiced_qty\s*,\s*0\s*\)\s+into\s+v_done\s+' ||
                  'from\s+v_agreement_item_balances\s+b\s+where\s+b\.agreement_item_id\s*=\s*v_line_id\s*;\s*' ||
                  'if\s+v_qty\s*<\s*coalesce\(\s*v_done\s*,\s*0\s*\)\s+then\s+' ||
                  'raise\s+exception\s+''[^'']*''\s*,\s*v_idx\s*,\s*v_item\.name_ar\s*,\s*v_done\s*,\s*v_qty\s*;\s*' ||
                  'end\s+if\s*;';
  v_rep   text := E'-- 0213: بالمبلغ قبل الضريبة لا بالكمية\n' ||
                  E'      select coalesce(b.invoiced_taxable, 0) into v_done\n' ||
                  E'        from v_agreement_item_balances b where b.agreement_item_id = v_line_id;\n' ||
                  E'      if v_taxable < coalesce(v_done, 0) - 0.01 then\n' ||
                  E'        raise exception ''السطر % («%»): فُوتر منه % فلا تنزل قيمته إلى %'',\n' ||
                  E'          v_idx, v_item.name_ar, round(v_done, 2), v_taxable;\n' ||
                  E'      end if;';
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_save_agreement_quote'
  loop
    v_src := replace(pg_get_functiondef(r.oid), chr(13), '');
    if position('0213: بالمبلغ' in v_src) > 0 then
      v_done := v_done + 1;
      continue;
    end if;
    v_new := regexp_replace(v_src, v_pat, v_rep);
    if v_new = v_src then
      raise notice 'لم يُعثر على فحص الكمية في % — تُركت', r.sig;
      continue;
    end if;
    if position('v_taxable' in v_src) = 0 then
      raise exception 'الدالّة % بلا v_taxable — أوقفتُ الترحيل كلّه (لم يُطبَّق شيء)', r.sig;
    end if;
    execute v_new;
    v_n := v_n + 1;
  end loop;
  if v_n + v_done = 0 then
    raise exception 'لم يُعثر على فحص المفوتَر بالكمية في app_save_agreement_quote — أوقفتُ الترحيل كلّه (لم يُطبَّق شيء)';
  end if;
  raise notice 'حفظ عرض السعر بالمبلغ: عُدِّلت % ومسبقًا %', v_n, v_done;
end $$;

commit;

-- ── النتيجة: البنود التي اكتملت كميّتها وبقي من مبلغها — تعود للفوترة ──────
select count(*)                                   as "بنود تعود للفوترة بالمبلغ",
       coalesce(sum(b.remaining_amount), 0)        as "مجموع متبقّيها"
  from v_agreement_billable_items b
 where b.remaining_qty <= 0
   and b.remaining_taxable > 0.009;
