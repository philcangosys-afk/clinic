-- ============================================================================
-- 0247_purchase_invoice_edit.sql — تعديل فاتورة الشراء، وربط سندات سدادها بها
-- ============================================================================
-- طلب المالك (18/10/2026): «في فواتير المشتريات أضف إمكانية التعديل على
-- الفواتير، واعمل إمكانية طباعة السندات بشكلٍ رسميٍّ ومنسّق».
--
-- ١) `financial_vouchers.related_purchase_invoice_id`
--    سند سداد المورد لم يكن يعرف فاتورته — الرابط الوحيد نصّ البيان. فلا تُعرض
--    سندات الفاتورة لتُطبع، وإلغاء سند السداد كان يُبقي «المسدَّد» في الفاتورة
--    كما هو فتبدو مسدَّدةً وهي ليست كذلك.
--      • عمودٌ جديد يشير إلى فاتورة الشراء (فارغٌ لغير سندات السداد).
--      • تعبئة السندات القائمة: سند مصروفٍ للمورد نفسه بيانه بالصيغة التي
--        تكتبها `app_pay_supplier_invoice` / `app_save_purchase_invoice`، أو
--        سجلّ تدقيقه «سُدّد … من فاتورة <الرقم>».
--      • `app_pay_supplier_invoice` تكتب الرابط من الآن (ترقيع النصّ الحيّ).
--      • `app_void_financial_voucher`: إلغاء سند سداد يُنقص «المسدَّد» من
--        فاتورته ويعيد حالتها (ترقيع النصّ الحيّ).
--
-- ٢) `app_update_purchase_invoice(id, payload)` — في معاملةٍ واحدة:
--      • بيانات الفاتورة تُعدَّل دائمًا: رقم فاتورة المورد (لا يتكرّر للمورد)،
--        التاريخ (لا مستقبل)، الرقم الضريبي، الجهة، الملاحظة.
--      • المورد يتغيّر ما لم يكن على الفاتورة سداد (سندات السداد باسمه).
--      • الأصناف والمستودع يُعدَّلان بشرط ألّا يكون صُرف أو حُجز شيءٌ من
--        تشغيلاتها، ولا مرتجع عليها، ولا تكون على مستند استلام: تخرج
--        كمّيات البنود القديمة بحركةٍ عكسية (لا حذف حركات) وتدخل البنود
--        الجديدة بتشغيلاتٍ وحركات `purchase_in` — كما في الحفظ (0228) تمامًا.
--        وإن لم تتغيّر الأصناف ولا المستودع لا تُمسّ حركة مخزون واحدة.
--      • الصافي الجديد لا يقلّ عمّا سُدّد، وتُعاد الحالة (مسدَّدة/جزئيًّا/غير).
--      • سبب التعديل إلزاميّ، ويُكتب في سجلّ التدقيق مع لقطة البنود القديمة.
--    الصلاحية `purchasing.invoice` نفسها التي تُنشئ الفاتورة وتلغيها.
--
-- لا يمسّ فواتير المبيعات ولا ZATCA. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- الجدول الرئيسيّ أوّلًا، ثمّ المُشار إليه
lock table public.financial_vouchers in share row exclusive mode;
lock table public.purchase_invoices in share row exclusive mode;

-- ── ١) الرابط ────────────────────────────────────────────────────────────────
alter table public.financial_vouchers
  add column if not exists related_purchase_invoice_id uuid
    references public.purchase_invoices(id) on delete set null;

create index if not exists idx_vouchers_purchase_invoice
  on public.financial_vouchers (related_purchase_invoice_id)
  where related_purchase_invoice_id is not null;

comment on column public.financial_vouchers.related_purchase_invoice_id is
  'فاتورة الشراء التي سدّدها هذا السند (سند مصروف للمورد). 0247.';

-- تعبئة السندات القائمة — مطابقةٌ تامّة لا «يحتوي»: الرقم 1 لا يطابق 104
update public.financial_vouchers v
   set related_purchase_invoice_id = pi.id
  from public.purchase_invoices pi
  join public.distributors d on d.id = pi.distributor_id
 where v.related_purchase_invoice_id is null
   and v.voucher_type = 'expense'
   and v.organization_id = pi.organization_id
   and v.distributor_id = pi.distributor_id
   and coalesce(pi.status, 'unpaid') <> 'cancelled'
   and coalesce(pi.invoice_number, '') <> ''
   and (
         v.description = format('سداد فاتورة شراء %s — %s', pi.invoice_number, d.name_ar)
      or v.description = format('سداد فاتورة مورد %s', pi.invoice_number)
      or exists (select 1 from public.audit_log a
                  where a.entity_id = v.id
                    and a.module = 'purchasing'
                    and a.entity_title = 'سداد مورد'
                    and a.details like 'سُدّد %'
                    and right(a.details, length(' من فاتورة ' || pi.invoice_number))
                        = ' من فاتورة ' || pi.invoice_number)
       );

-- ── ٢) السداد يكتب الرابط من الآن ───────────────────────────────────────────
do $$
declare
  v_src text;
  v_new text;
  v_n   int;
begin
  select pg_get_functiondef('public.app_pay_supplier_invoice(uuid,numeric,uuid,uuid,text,text)'::regprocedure)
    into v_src;
  v_src := replace(v_src, chr(13), '');

  if position('related_purchase_invoice_id' in v_src) > 0 then
    raise notice '0247: app_pay_supplier_invoice تكتب الرابط سلفًا';
    return;
  end if;

  select count(*) into v_n
    from regexp_matches(v_src, 'bank_transfer_ref,\s*description,\s*created_by\)', 'g');
  if v_n <> 1 then
    raise exception 'تعذّر ترقيع app_pay_supplier_invoice — أعمدة إدراج السند تغيّرت (%)', v_n;
  end if;
  select count(*) into v_n
    from regexp_matches(v_src, 'auth\.uid\(\)\)\s*returning id into v_v;', 'g');
  if v_n <> 1 then
    raise exception 'تعذّر ترقيع app_pay_supplier_invoice — قيم إدراج السند تغيّرت (%)', v_n;
  end if;

  v_new := regexp_replace(v_src, 'bank_transfer_ref,\s*description,\s*created_by\)',
                          'bank_transfer_ref, description, created_by, related_purchase_invoice_id)');
  v_new := regexp_replace(v_new, 'auth\.uid\(\)\)\s*returning id into v_v;',
                          E'auth.uid(), v_inv.id)  -- 0247: الرابط بالفاتورة\n  returning id into v_v;');
  execute v_new;
  raise notice '0247 ✓ سند سداد المورد يحمل فاتورته';
end $$;

-- ── ٣) إلغاء سند السداد يعيد المستحقّ إلى فاتورته ──────────────────────────
do $$
declare
  v_src   text;
  v_new   text;
  v_n     int;
  v_block constant text := $blk$
  -- 0247: سند سداد فاتورة شراء — يُنقص المسدَّد منها وتُعاد حالتها
  if v_v.related_purchase_invoice_id is not null then
    update purchase_invoices
       set paid_amount = greatest(coalesce(paid_amount, 0) - v_v.amount, 0),
           status = case
             when coalesce(status, 'unpaid') = 'cancelled' then status
             when greatest(coalesce(paid_amount, 0) - v_v.amount, 0) <= 0.001 then 'unpaid'
             when greatest(coalesce(paid_amount, 0) - v_v.amount, 0) >= coalesce(net_amount, 0) - 0.001 then 'paid'
             else 'partial' end,
           updated_at = now(), updated_by = auth.uid()
     where id = v_v.related_purchase_invoice_id;
  end if;
$blk$;
begin
  select pg_get_functiondef('public.app_void_financial_voucher(uuid,text)'::regprocedure)
    into v_src;
  v_src := replace(v_src, chr(13), '');

  if position('0247: سند سداد فاتورة شراء' in v_src) > 0 then
    raise notice '0247: app_void_financial_voucher معدّلة سلفًا';
    return;
  end if;

  select count(*) into v_n
    from regexp_matches(v_src, 'perform app_recalc_invoice_paid_amount\(v_inv\);\s*end loop;', 'g');
  if v_n <> 1 then
    raise exception 'تعذّر ترقيع app_void_financial_voucher — موضع إعادة حساب الفواتير تغيّر (%)', v_n;
  end if;

  v_new := regexp_replace(v_src,
             '(perform app_recalc_invoice_paid_amount\(v_inv\);\s*end loop;)',
             '\1' || replace(v_block, '\', '\\'));
  execute v_new;
  raise notice '0247 ✓ إلغاء سند السداد يعيد المستحقّ إلى فاتورة الشراء';
end $$;

-- ── ٤) تعديل فاتورة الشراء ─────────────────────────────────────────────────
create or replace function public.app_update_purchase_invoice(p_invoice_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv      public.purchase_invoices%rowtype;
  v_org      uuid;
  v_wh       public.warehouses%rowtype;
  v_dist     public.distributors%rowtype;
  v_number   text := nullif(btrim(coalesce(p_payload->>'invoice_number', '')), '');
  v_date     date := nullif(p_payload->>'invoice_date', '')::date;
  v_purpose  text := nullif(p_payload->>'purchase_purpose', '');
  v_note     text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_reason   text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_tax_no   text := nullif(regexp_replace(coalesce(p_payload->>'supplier_tax_number', ''), '\s', '', 'g'), '');
  v_lines    jsonb := p_payload->'lines';
  v_old_keys text[];
  v_new_keys text[];
  v_replace  boolean;
  v_snapshot jsonb;
  v_line     jsonb;
  v_item     public.items%rowtype;
  v_lot      record;
  v_qty      numeric;
  v_free     numeric;
  v_price    numeric;
  v_disc     numeric;
  v_rate     numeric;
  v_base     numeric;
  v_vat      numeric;
  v_expiry   date;
  v_sub      numeric := 0;
  v_vat_sum  numeric := 0;
  v_disc_sum numeric := 0;
  v_net      numeric;
  v_paid     numeric;
  v_pii      uuid;
  v_lot_id   uuid;
  v_n        int := 0;
  v_changes  text[] := '{}';
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'فاتورة الشراء غير موجودة'; end if;
  v_org := v_inv.organization_id;
  if not public.app_has_permission(v_org, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتعديل فواتير الشراء (purchasing.invoice)';
  end if;
  if coalesce(v_inv.status, 'unpaid') = 'cancelled' then
    raise exception 'الفاتورة ملغاة — لا تُعدَّل';
  end if;
  if v_reason is null then raise exception 'اكتب سبب التعديل'; end if;
  v_paid := coalesce(v_inv.paid_amount, 0);

  -- ما لم يُرسَل يبقى كما هو (لا يُمسح حقلٌ لأنّه غاب عن الطلب)
  if not (p_payload ? 'invoice_number') then v_number := v_inv.invoice_number; end if;
  if not (p_payload ? 'note') then v_note := v_inv.note; end if;
  if not (p_payload ? 'purchase_purpose') then v_purpose := v_inv.purchase_purpose; end if;
  if not (p_payload ? 'supplier_tax_number') then v_tax_no := v_inv.supplier_tax_number; end if;

  -- ── الرأس ──
  select * into v_wh from public.warehouses
   where id = coalesce(nullif(p_payload->>'warehouse_id', '')::uuid, v_inv.warehouse_id)
     and organization_id = v_org;
  if v_wh.id is null or (coalesce(v_wh.is_disabled, false) and v_wh.id is distinct from v_inv.warehouse_id) then
    raise exception 'اختر المستودع الذي تدخل إليه المشتريات';
  end if;

  select * into v_dist from public.distributors
   where id = coalesce(nullif(p_payload->>'distributor_id', '')::uuid, v_inv.distributor_id)
     and organization_id = v_org;
  if v_dist.id is null
     or ((coalesce(v_dist.is_disabled, false) or coalesce(v_dist.is_archived, false))
         and v_dist.id is distinct from v_inv.distributor_id) then
    raise exception 'اختر المورد';
  end if;
  if v_dist.id is distinct from v_inv.distributor_id then
    if v_paid > 0 then
      raise exception 'على الفاتورة سدادٌ بمبلغ % للمورد الحالي — لا يتغيّر المورد (ألغِ سند السداد أوّلًا)', v_paid;
    end if;
    if v_inv.goods_receipt_id is not null then
      raise exception 'فاتورةٌ على مستند استلام — لا يتغيّر موردها';
    end if;
  end if;

  if v_number is null then raise exception 'اكتب رقم فاتورة المورد'; end if;
  v_date := coalesce(v_date, v_inv.invoice_date);
  if v_date > current_date then raise exception 'تاريخ الفاتورة لا يكون في المستقبل'; end if;
  if exists (select 1 from public.purchase_invoices pi
              where pi.organization_id = v_org and pi.distributor_id = v_dist.id
                and pi.id <> v_inv.id
                and lower(btrim(pi.invoice_number)) = lower(v_number)
                and coalesce(pi.status, 'unpaid') <> 'cancelled') then
    raise exception 'فاتورة المورد رقم % مسجّلة سابقًا لهذا المورد', v_number;
  end if;
  if v_tax_no is not null and v_tax_no !~ '^[0-9]{15}$' then
    raise exception 'الرقم الضريبي للمورد 15 رقمًا';
  end if;

  -- ── البنود: القديمة كما هي إن لم تُرسَل ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', pii.item_id, 'qty', pii.qty, 'free_qty', coalesce(pii.free_qty, 0),
           'unit_price', pii.purchase_price, 'discount_amount', coalesce(pii.line_discount_amount, 0),
           'vat_rate', coalesce(pii.vat_rate, 0), 'lot_number', pii.lot_number,
           'expiry_date', pii.expiry_date, 'net_amount', pii.net_amount)
           order by pii.created_at, pii.id), '[]'::jsonb)
    into v_snapshot
    from public.purchase_invoice_items pii
   where pii.purchase_invoice_id = v_inv.id;

  if v_lines is null or jsonb_typeof(v_lines) = 'null' then
    v_lines := v_snapshot;
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'أضف صنفًا واحدًا على الأقل';
  end if;

  -- مقارنة البنود بمفتاحٍ مقرَّب (10 و10.000 سواء)
  select array(
    select concat_ws('|', l->>'item_id',
             round(coalesce(nullif(l->>'qty', '')::numeric, 0), 3),
             round(coalesce(nullif(l->>'free_qty', '')::numeric, 0), 3),
             round(coalesce(nullif(l->>'unit_price', '')::numeric, 0), 4),
             round(coalesce(nullif(l->>'discount_amount', '')::numeric, 0), 2),
             round(coalesce(nullif(l->>'vat_rate', '')::numeric, 0), 3),
             coalesce(nullif(btrim(coalesce(l->>'lot_number', '')), ''), '-'),
             coalesce(nullif(l->>'expiry_date', ''), '-'))
      from jsonb_array_elements(v_snapshot) l
     order by 1) into v_old_keys;
  select array(
    select concat_ws('|', l->>'item_id',
             round(coalesce(nullif(l->>'qty', '')::numeric, 0), 3),
             round(coalesce(nullif(l->>'free_qty', '')::numeric, 0), 3),
             round(coalesce(nullif(l->>'unit_price', '')::numeric, 0), 4),
             round(coalesce(nullif(l->>'discount_amount', '')::numeric, 0), 2),
             round(coalesce(nullif(l->>'vat_rate', '')::numeric, 0), 3),
             coalesce(nullif(btrim(coalesce(l->>'lot_number', '')), ''), '-'),
             coalesce(nullif(l->>'expiry_date', ''), '-'))
      from jsonb_array_elements(v_lines) l
     order by 1) into v_new_keys;

  v_replace := v_old_keys is distinct from v_new_keys
               or v_wh.id is distinct from v_inv.warehouse_id;

  if v_replace then
    -- ── شروط تعديل الأصناف ──
    if v_inv.goods_receipt_id is not null then
      raise exception 'فاتورةٌ على مستند استلام — أصنافها ومستودعها لا تُعدَّل هنا (عدّل بياناتها فقط، أو استعمل مرتجع المشتريات)';
    end if;
    if exists (select 1 from public.purchase_returns r
                where r.purchase_invoice_id = v_inv.id
                  and coalesce(r.status, 'draft') <> 'cancelled') then
      raise exception 'على الفاتورة مرتجع مشتريات — أصنافها لا تُعدَّل (عدّل بياناتها فقط)';
    end if;

    -- ١) التحقّق والمجاميع أوّلًا — لا يُكتب شيءٌ قبل أن تصحّ البنود كلّها
    for v_line in select * from jsonb_array_elements(v_lines) loop
      select * into v_item from public.items
       where id = nullif(v_line->>'item_id', '')::uuid and organization_id = v_org;
      if v_item.id is null then raise exception 'صنف غير موجود في الفاتورة'; end if;
      if coalesce(v_item.is_disabled, false) or coalesce(v_item.is_archived, false) then
        raise exception 'الصنف % معطّل', v_item.name_ar;
      end if;
      if not coalesce(v_item.track_inventory, false) then
        raise exception 'الصنف % لا يُتابَع مخزونه — فعّل «متابعة المخزون» في بطاقته أوّلًا', v_item.name_ar;
      end if;
      v_qty   := coalesce(nullif(v_line->>'qty', '')::numeric, 0);
      v_free  := coalesce(nullif(v_line->>'free_qty', '')::numeric, 0);
      v_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, 0);
      v_disc  := coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0);
      v_rate  := coalesce(nullif(v_line->>'vat_rate', '')::numeric, 0);
      v_expiry := nullif(v_line->>'expiry_date', '')::date;
      if v_qty <= 0 then raise exception 'كمية الصنف % يجب أن تكون أكبر من صفر', v_item.name_ar; end if;
      if v_free < 0 or v_price < 0 or v_disc < 0 then raise exception 'قيمٌ سالبة في الصنف %', v_item.name_ar; end if;
      if v_rate < 0 or v_rate > 100 then raise exception 'نسبة ضريبة غير صحيحة في الصنف %', v_item.name_ar; end if;
      if v_disc > v_qty * v_price then raise exception 'خصم الصنف % أكبر من قيمته', v_item.name_ar; end if;
      if coalesce(v_item.track_expiry, false) and v_expiry is null then
        raise exception 'الصنف % يُتتبَّع بالصلاحية — اكتب تاريخ انتهائه', v_item.name_ar;
      end if;
      if v_expiry is not null and v_expiry <= current_date then
        raise exception 'الصنف % منتهٍ أو ينتهي اليوم — لا يُستلَم', v_item.name_ar;
      end if;
      v_base := round(v_qty * v_price - v_disc, 2);
      v_vat  := round(v_base * v_rate / 100, 2);
      v_sub := v_sub + round(v_qty * v_price, 2);
      v_disc_sum := v_disc_sum + v_disc;
      v_vat_sum := v_vat_sum + v_vat;
    end loop;
    v_net := v_sub - v_disc_sum + v_vat_sum;
  else
    -- الأصناف كما هي: المجاميع كما هي
    v_sub      := coalesce(v_inv.subtotal_amount, 0) + coalesce(v_inv.general_discount_amount, 0);
    v_disc_sum := coalesce(v_inv.general_discount_amount, 0);
    v_vat_sum  := coalesce(v_inv.vat_amount, 0);
    v_net      := coalesce(v_inv.net_amount, 0);
  end if;

  -- الرقم الضريبي: المكتوب، وإلّا الذي في بطاقة المورد
  if not (p_payload ? 'supplier_tax_number') and v_dist.id is distinct from v_inv.distributor_id then
    v_tax_no := null;  -- رقم المورد السابق لا ينتقل إلى مورد آخر
  end if;
  v_tax_no := coalesce(v_tax_no, nullif(btrim(coalesce(v_dist.tax_number, '')), ''));
  if v_vat_sum > 0 and v_tax_no is null then
    raise exception 'المورد % بلا رقم ضريبي — اكتب رقمه، أو اجعل الفاتورة «بدون ضريبة»', v_dist.name_ar;
  end if;
  if v_tax_no is not null and nullif(btrim(coalesce(v_dist.tax_number, '')), '') is null then
    update public.distributors set tax_number = v_tax_no, updated_at = now() where id = v_dist.id;
  end if;

  if v_net < v_paid - 0.001 then
    raise exception 'صافي الفاتورة بعد التعديل (%) أقلّ ممّا سُدّد منها (%) — ألغِ سند السداد الزائد أوّلًا', v_net, v_paid;
  end if;

  -- ── ما تغيّر (لسجلّ التدقيق) ──
  if v_number is distinct from v_inv.invoice_number then
    v_changes := v_changes || format('الرقم %s ← %s', v_inv.invoice_number, v_number);
  end if;
  if v_date is distinct from v_inv.invoice_date then
    v_changes := v_changes || format('التاريخ %s ← %s', v_inv.invoice_date, v_date);
  end if;
  if v_dist.id is distinct from v_inv.distributor_id then
    v_changes := v_changes || format('المورد ← %s', v_dist.name_ar);
  end if;
  if v_wh.id is distinct from v_inv.warehouse_id then
    v_changes := v_changes || format('المستودع ← %s', v_wh.name);
  end if;
  if v_tax_no is distinct from v_inv.supplier_tax_number then
    v_changes := v_changes || format('الرقم الضريبي ← %s', coalesce(v_tax_no, 'بلا'));
  end if;
  if v_note is distinct from v_inv.note then v_changes := v_changes || 'الملاحظة'::text; end if;
  if v_purpose is distinct from v_inv.purchase_purpose then v_changes := v_changes || 'الجهة'::text; end if;
  if v_replace then
    v_changes := v_changes || format('الأصناف (الصافي %s ← %s)', v_inv.net_amount, v_net);
  end if;

  -- ── ٢) إخراج البنود القديمة (عند تعديل الأصناف أو المستودع) ──
  if v_replace then
    for v_lot in
      select l.*, i.name_ar
        from public.purchase_invoice_items pii
        join public.inventory_lots l
          on l.purchase_invoice_item_id = pii.id and l.warehouse_id = v_inv.warehouse_id
        join public.items i on i.id = l.item_id
       where pii.purchase_invoice_id = v_inv.id
       for update of l
    loop
      if v_lot.qty_remaining < v_lot.qty_received or coalesce(v_lot.reserved_quantity, 0) > 0 then
        raise exception 'صُرف أو حُجز من الصنف % بعد الشراء — أصناف الفاتورة لا تُعدَّل (عدّل بياناتها فقط، أو استعمل مرتجع المشتريات)', v_lot.name_ar;
      end if;
      if v_lot.qty_remaining > 0 then
        insert into public.inventory_movements (
          organization_id, warehouse_id, item_id, lot_id, movement_type, qty, unit_price,
          total_amount, related_purchase_invoice_id, note, created_by)
        values (
          v_lot.organization_id, v_lot.warehouse_id, v_lot.item_id, v_lot.id,
          -- المنتهية لا يُخرجها إلّا «تسوية» (قاعدة 0088)
          case when v_lot.expiry_date is not null and v_lot.expiry_date < current_date
               then 'adjustment_out' else 'return_out' end,
          v_lot.qty_remaining, v_lot.unit_cost, round(v_lot.qty_remaining * v_lot.unit_cost, 2),
          v_inv.id, format('تعديل فاتورة شراء %s — إخراج البند السابق', coalesce(v_inv.invoice_number, '')),
          auth.uid());
      end if;
    end loop;

    -- البنود القديمة تُستبدل؛ تشغيلاتها (برصيد صفر الآن) وحركاتها تبقى في السجلّ،
    -- ولقطتها كاملةً في سجلّ التدقيق أدناه.
    delete from public.purchase_invoice_items where purchase_invoice_id = v_inv.id;
  end if;

  -- ── ٣) الرأس ──
  update public.purchase_invoices
     set invoice_number      = v_number,
         invoice_date        = v_date,
         due_date            = case when v_date is distinct from v_inv.invoice_date
                                      or v_dist.id is distinct from v_inv.distributor_id
                                    then v_date + coalesce(v_dist.payment_terms_days, 0)
                                    else due_date end,
         distributor_id      = v_dist.id,
         warehouse_id        = v_wh.id,
         branch_id           = coalesce(v_wh.branch_id, branch_id),
         supplier_tax_number = v_tax_no,
         vat_enabled         = v_vat_sum > 0,
         note                = v_note,
         purchase_purpose    = v_purpose,
         updated_at          = now(),
         updated_by          = auth.uid()
   where id = v_inv.id;

  -- الأصناف كما هي والمورد تغيّر: تشغيلاتها تتبعه
  if not v_replace and v_dist.id is distinct from v_inv.distributor_id then
    update public.inventory_lots l
       set distributor_id = v_dist.id, updated_at = now()
      from public.purchase_invoice_items pii
     where pii.purchase_invoice_id = v_inv.id
       and l.purchase_invoice_item_id = pii.id;
  end if;

  -- ── ٤) البنود الجديدة ← تشغيلة ← حركة وارد (مسار 0228 نفسه) ──
  if v_replace then
    for v_line in select * from jsonb_array_elements(v_lines) loop
      select * into v_item from public.items where id = (v_line->>'item_id')::uuid;
      v_qty   := coalesce(nullif(v_line->>'qty', '')::numeric, 0);
      v_free  := coalesce(nullif(v_line->>'free_qty', '')::numeric, 0);
      v_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, 0);
      v_disc  := coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0);
      v_rate  := coalesce(nullif(v_line->>'vat_rate', '')::numeric, 0);
      v_expiry := nullif(v_line->>'expiry_date', '')::date;
      v_base := round(v_qty * v_price - v_disc, 2);
      v_vat  := round(v_base * v_rate / 100, 2);

      insert into public.purchase_invoice_items (
        purchase_invoice_id, item_id, purchase_price, qty, free_qty, discount_percent,
        line_discount_amount, vat_rate, vat_amount, net_amount, expiry_date, lot_number)
      values (v_inv.id, v_item.id, v_price, v_qty, v_free, 0, v_disc, v_rate, v_vat, v_base + v_vat,
              v_expiry, nullif(btrim(coalesce(v_line->>'lot_number', '')), ''))
      returning id into v_pii;

      insert into public.inventory_lots (
        organization_id, warehouse_id, item_id, purchase_invoice_item_id, lot_number, expiry_date,
        qty_received, qty_remaining, unit_cost, distributor_id, received_at, created_by)
      values (
        v_org, v_wh.id, v_item.id, v_pii, nullif(btrim(coalesce(v_line->>'lot_number', '')), ''), v_expiry,
        v_qty + v_free, 0,
        case when v_qty + v_free > 0 then round(v_base / (v_qty + v_free), 4) else v_price end,
        v_dist.id, now(), auth.uid())
      returning id into v_lot_id;

      insert into public.inventory_movements (
        organization_id, warehouse_id, item_id, lot_id, movement_type, qty, unit_price,
        total_amount, related_purchase_invoice_id, note, created_by)
      values (
        v_org, v_wh.id, v_item.id, v_lot_id, 'purchase_in', v_qty + v_free, v_price,
        v_base, v_inv.id, format('فاتورة شراء %s — %s (بعد التعديل)', v_number, v_dist.name_ar), auth.uid());

      v_n := v_n + 1;
    end loop;

    update public.purchase_invoices
       set subtotal_amount = v_sub - v_disc_sum,
           general_discount_amount = 0,
           vat_amount = v_vat_sum,
           net_amount = v_net,
           status = case
             when v_paid > 0 and v_paid >= v_net - 0.001 then 'paid'
             when v_paid > 0 then 'partial'
             else 'unpaid' end
     where id = v_inv.id;
  end if;

  insert into public.audit_log (organization_id, branch_id, user_id, module, action_type,
                                entity_id, entity_title, details, reason)
  values (v_org, v_wh.branch_id, auth.uid(), 'purchasing', 'update', v_inv.id,
          'تعديل فاتورة شراء ' || v_number,
          case when cardinality(v_changes) = 0 then 'بلا تغيير'
               else array_to_string(v_changes, ' · ') end
          || case when v_replace then ' — البنود السابقة: ' || v_snapshot::text else '' end,
          v_reason);

  return v_inv.id;
end $$;

revoke all on function public.app_update_purchase_invoice(uuid, jsonb) from public, anon;
grant execute on function public.app_update_purchase_invoice(uuid, jsonb) to authenticated;

comment on function public.app_update_purchase_invoice(uuid, jsonb) is
  'تعديل فاتورة شراء في معاملة واحدة: البيانات دائمًا، والأصناف والمستودع ما لم يُصرف منها شيء (إخراج عكسي ثمّ إدخال كالحفظ). 0247.';

commit;

notify pgrst, 'reload schema';

-- ── تحقّق ──────────────────────────────────────────────────────────────────
select 'تعديل فاتورة الشراء' as "البند",
       case when to_regprocedure('public.app_update_purchase_invoice(uuid,jsonb)') is not null
            then 'جاهزة' else 'مفقودة' end as "الحالة"
union all
select 'السداد يكتب الرابط',
       case when position('related_purchase_invoice_id' in
                 pg_get_functiondef('public.app_pay_supplier_invoice(uuid,numeric,uuid,uuid,text,text)'::regprocedure)) > 0
            then 'نعم' else 'لا' end
union all
select 'إلغاء السند يعيد المستحقّ',
       case when position('0247: سند سداد فاتورة شراء' in
                 pg_get_functiondef('public.app_void_financial_voucher(uuid,text)'::regprocedure)) > 0
            then 'نعم' else 'لا' end
union all
select 'سندات سداد رُبطت بفواتيرها',
       count(*)::text from public.financial_vouchers where related_purchase_invoice_id is not null
union all
-- فواتير عليها «مسدَّد» لا تغطّيه سنداتها المربوطة — تُراجَع يدويًّا (سند ببيانٍ مخصَّص)
select 'فواتير مسدَّدها أكبر من سنداتها المربوطة',
       count(*)::text
  from public.purchase_invoices pi
 where coalesce(pi.status, 'unpaid') <> 'cancelled'
   and coalesce(pi.paid_amount, 0) > 0
   and coalesce(pi.paid_amount, 0) - coalesce((select sum(v.amount) from public.financial_vouchers v
                                                where v.related_purchase_invoice_id = pi.id
                                                  and not coalesce(v.is_void, false)), 0) > 0.01;
