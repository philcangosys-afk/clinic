-- ============================================================================
-- 0228_direct_purchase_invoice.sql — فاتورة الشراء المباشرة
-- ============================================================================
-- طلب المالك (05/10/2026): «عدّل المشتريات لتكون بطريقة عادية: فتح فاتورة
-- شراء، ثمّ إدخال المشتريات ونسبها إلى مستودعٍ تدخل فيه، ثمّ حفظ وتقارير — لا
-- طلب ولا أمر ولا استلام؛ كلّه في نافذةٍ واحدة: تفاصيل الفاتورة مع المورد
-- والأصناف، وتذهب إلى المخزون والمورد».
--
-- كان الإدخال المباشر قديمًا يُكتب من المتصفّح بخطوات منفصلة (رأس، بنود،
-- تشغيلات، حركات) فأُزيل لأنّه غير ذرّيّ ويوازي الاستلام. الآن يعود **ذرّيًّا**:
--
--   • `app_save_purchase_invoice(payload)` في معاملةٍ واحدة:
--       رأس الفاتورة ← بنودها ←
--       لكلّ بند تشغيلة مخزون (بالرصيد صفرًا) وحركة `purchase_in` (مُحفِّز
--       المخزون يزيد الرصيد مرّةً واحدة) ← حساب المورد (الفاتورة نفسها مستحقّة
--       عليه في كشفه) ← وإن دُفع شيءٌ الآن فسند سداد بـ`app_pay_supplier_invoice`.
--       الرأس يُدرج بصفرٍ ثمّ تُكتب مجاميعه — كما في «فاتورة المورد من
--       الاستلام» (0097) تمامًا، فلا يختلف أثرها المحاسبيّ عن فواتير الشراء
--       القائمة كلّها.
--       رقم فاتورة المورد لا يتكرّر للمورد نفسه. صنفٌ يُتتبَّع بالصلاحية لا يدخل
--       بلا تاريخ. الضريبة نسبةٌ يكتبها المُدخِل لكلّ بند (ضريبة المدخلات كما في
--       فاتورة المورد — لا قواعد إعفاء المرضى).
--   • `app_cancel_purchase_invoice(id, reason)`: لا حذف — إلغاءٌ بسبب، بشرط ألّا
--     يكون عليها سداد وألّا يكون صُرف شيءٌ من تشغيلاتها؛ فتخرج كمّياتها من
--     المخزون بحركة `return_out` ويُصحَّح حساب المورد.
--
-- الطلب والأمر والاستلام تُخفى من القائمة (الواجهة)؛ جداولها ودوالّها تبقى كما
-- هي بسجلّاتها. لا يمسّ فواتير المبيعات ولا ZATCA.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- لا تغيير في بنية أيّ جدول: التشغيلة تحمل رقم بند الفاتورة
-- (`inventory_lots.purchase_invoice_item_id` منذ 0003) — وهو الرابط الوحيد.

create or replace function public.app_save_purchase_invoice(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid := nullif(p_payload->>'organization_id', '')::uuid;
  v_wh       public.warehouses%rowtype;
  v_dist     public.distributors%rowtype;
  v_number   text := nullif(btrim(coalesce(p_payload->>'invoice_number', '')), '');
  v_date     date := coalesce(nullif(p_payload->>'invoice_date', '')::date, current_date);
  v_purpose  text := nullif(p_payload->>'purchase_purpose', '');
  v_note     text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_pay      jsonb := p_payload->'payment';
  v_pay_amt  numeric := coalesce(nullif(p_payload->'payment'->>'amount', '')::numeric, 0);
  v_line     jsonb;
  v_item     public.items%rowtype;
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
  v_inv      uuid;
  v_pii      uuid;
  v_lot      uuid;
  v_n        int := 0;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if v_org is null or not public.app_is_member(v_org) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not public.app_has_permission(v_org, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتسجيل فواتير الشراء (purchasing.invoice)';
  end if;

  select * into v_wh from public.warehouses
   where id = nullif(p_payload->>'warehouse_id', '')::uuid and organization_id = v_org;
  if v_wh.id is null or coalesce(v_wh.is_disabled, false) then
    raise exception 'اختر المستودع الذي تدخل إليه المشتريات';
  end if;

  select * into v_dist from public.distributors
   where id = nullif(p_payload->>'distributor_id', '')::uuid and organization_id = v_org;
  if v_dist.id is null or coalesce(v_dist.is_disabled, false) or coalesce(v_dist.is_archived, false) then
    raise exception 'اختر المورد';
  end if;

  if v_number is null then raise exception 'اكتب رقم فاتورة المورد'; end if;
  if v_date > current_date then raise exception 'تاريخ الفاتورة لا يكون في المستقبل'; end if;
  if exists (select 1 from public.purchase_invoices pi
              where pi.organization_id = v_org and pi.distributor_id = v_dist.id
                and lower(btrim(pi.invoice_number)) = lower(v_number)
                and coalesce(pi.status, 'unpaid') <> 'cancelled') then
    raise exception 'فاتورة المورد رقم % مسجّلة سابقًا لهذا المورد', v_number;
  end if;

  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'أضف صنفًا واحدًا على الأقل';
  end if;

  -- ١) التحقّق والمجاميع أوّلًا — لا يُكتب شيءٌ قبل أن تصحّ البنود كلّها
  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
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

  if v_pay_amt < 0 or v_pay_amt > v_net + 0.001 then
    raise exception 'المبلغ المدفوع يتجاوز صافي الفاتورة (%)', v_net;
  end if;

  -- ٢) الرأس — بصفرٍ ثمّ المجاميع بعد البنود (مسار 0097 نفسه)
  insert into public.purchase_invoices (
    organization_id, branch_id, warehouse_id, distributor_id, invoice_number, invoice_date,
    due_date, payment_term, supplier_tax_number, vat_enabled, general_discount_amount,
    subtotal_amount, vat_amount, net_amount, note, source_document, purchase_purpose,
    status, paid_amount, created_by)
  values (
    v_org, v_wh.branch_id, v_wh.id, v_dist.id, v_number, v_date,
    v_date + coalesce(v_dist.payment_terms_days, 0),
    case when v_pay_amt >= v_net - 0.001 then 'cash' else 'credit' end,
    v_dist.tax_number, v_vat_sum > 0, 0,
    0, 0, 0, v_note, 'direct', v_purpose,
    'unpaid', 0, auth.uid())
  returning id into v_inv;

  -- ٣) البنود ← تشغيلة ← حركة وارد
  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
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
    values (v_inv, v_item.id, v_price, v_qty, v_free, 0, v_disc, v_rate, v_vat, v_base + v_vat,
            v_expiry, nullif(btrim(coalesce(v_line->>'lot_number', '')), ''))
    returning id into v_pii;

    -- الرصيد يبقى صفرًا: مُحفِّز الحركة يزيده (0040 — لا مضاعفة).
    -- والمجّانيّ يخفض تكلفة الوحدة (كما في الاستلام، 0097).
    insert into public.inventory_lots (
      organization_id, warehouse_id, item_id, purchase_invoice_item_id, lot_number, expiry_date,
      qty_received, qty_remaining, unit_cost, distributor_id, received_at, created_by)
    values (
      v_org, v_wh.id, v_item.id, v_pii, nullif(btrim(coalesce(v_line->>'lot_number', '')), ''), v_expiry,
      v_qty + v_free, 0,
      case when v_qty + v_free > 0 then round(v_base / (v_qty + v_free), 4) else v_price end,
      v_dist.id, now(), auth.uid())
    returning id into v_lot;

    insert into public.inventory_movements (
      organization_id, warehouse_id, item_id, lot_id, movement_type, qty, unit_price,
      total_amount, related_purchase_invoice_id, note, created_by)
    values (
      v_org, v_wh.id, v_item.id, v_lot, 'purchase_in', v_qty + v_free, v_price,
      v_base, v_inv, format('فاتورة شراء %s — %s', v_number, v_dist.name_ar), auth.uid());

    v_n := v_n + 1;
  end loop;

  update public.purchase_invoices
     set subtotal_amount = v_sub - v_disc_sum, vat_amount = v_vat_sum, net_amount = v_net
   where id = v_inv;

  -- ٤) السداد الآن (إن وُجد) — بالدالّة القائمة: سند مصروف للمورد
  if v_pay_amt > 0 then
    perform public.app_pay_supplier_invoice(
      v_inv, v_pay_amt,
      nullif(v_pay->>'payment_method_value_id', '')::uuid,
      nullif(v_pay->>'cash_register_id', '')::uuid,
      nullif(btrim(coalesce(v_pay->>'reference', '')), ''),
      format('سداد فاتورة شراء %s — %s', v_number, v_dist.name_ar));
  end if;

  insert into public.audit_log (organization_id, branch_id, user_id, module, action_type,
                                entity_id, entity_title, details)
  values (v_org, v_wh.branch_id, auth.uid(), 'purchasing', 'add', v_inv,
          'فاتورة شراء ' || v_number,
          format('%s — %s صنفًا إلى «%s» — الصافي %s — مدفوع %s',
                 v_dist.name_ar, v_n, v_wh.name, v_net, v_pay_amt));

  return v_inv;
end $$;

revoke all on function public.app_save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.app_save_purchase_invoice(jsonb) to authenticated;

comment on function public.app_save_purchase_invoice(jsonb) is
  'فاتورة شراء مباشرة في معاملة واحدة: الرأس والبنود وتشغيلات المخزون وحركات الوارد وحساب المورد والسداد الفوري. 0228.';

create or replace function public.app_cancel_purchase_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv  public.purchase_invoices%rowtype;
  v_lot  record;
begin
  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'فاتورة الشراء غير موجودة'; end if;
  if not public.app_has_permission(v_inv.organization_id, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بإلغاء فواتير الشراء (purchasing.invoice)';
  end if;
  if coalesce(v_inv.status, 'unpaid') = 'cancelled' then raise exception 'الفاتورة ملغاة سلفًا'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  if coalesce(v_inv.paid_amount, 0) > 0 then
    raise exception 'على الفاتورة سدادٌ بمبلغ % — لا تُلغى (استعمل مرتجع المشتريات)', v_inv.paid_amount;
  end if;
  if v_inv.goods_receipt_id is not null then
    raise exception 'فاتورةٌ على مستند استلام — تُعالَج من مرتجع المشتريات';
  end if;

  for v_lot in
    select l.*, i.name_ar
      from public.purchase_invoice_items pii
      -- تشغيلة البند في مستودع الفاتورة (يشمل الإدخال المباشر القديم قبل 0228)
      join public.inventory_lots l
        on l.purchase_invoice_item_id = pii.id and l.warehouse_id = v_inv.warehouse_id
      join public.items i on i.id = l.item_id
     where pii.purchase_invoice_id = v_inv.id
     for update of l
  loop
    if v_lot.qty_remaining < v_lot.qty_received or coalesce(v_lot.reserved_quantity, 0) > 0 then
      raise exception 'صُرف من الصنف % بعد الشراء — لا تُلغى الفاتورة (استعمل مرتجع المشتريات)', v_lot.name_ar;
    end if;
    if v_lot.qty_remaining > 0 then
      insert into public.inventory_movements (
        organization_id, warehouse_id, item_id, lot_id, movement_type, qty, unit_price,
        total_amount, related_purchase_invoice_id, note, created_by)
      values (
        v_lot.organization_id, v_lot.warehouse_id, v_lot.item_id, v_lot.id, 'return_out',
        v_lot.qty_remaining, v_lot.unit_cost, round(v_lot.qty_remaining * v_lot.unit_cost, 2),
        v_inv.id, format('إلغاء فاتورة شراء %s', coalesce(v_inv.invoice_number, '')), auth.uid());
    end if;
  end loop;

  update public.purchase_invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason),
         updated_at = now(), updated_by = auth.uid()
   where id = v_inv.id;

  insert into public.audit_log (organization_id, branch_id, user_id, module, action_type,
                                entity_id, entity_title, details)
  values (v_inv.organization_id, v_inv.branch_id, auth.uid(), 'purchasing', 'update', v_inv.id,
          'إلغاء فاتورة شراء ' || coalesce(v_inv.invoice_number, ''), btrim(p_reason));
end $$;

revoke all on function public.app_cancel_purchase_invoice(uuid, text) from public, anon;
grant execute on function public.app_cancel_purchase_invoice(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'فاتورة الشراء المباشرة' as "البند",
       case when to_regprocedure('public.app_save_purchase_invoice(jsonb)') is not null then 'جاهزة' else 'مفقودة' end as "الحالة"
union all
select 'إلغاء فاتورة الشراء',
       case when to_regprocedure('public.app_cancel_purchase_invoice(uuid,text)') is not null then 'جاهزة' else 'مفقودة' end
union all
select 'مستودعات نشطة', count(*)::text from public.warehouses where not coalesce(is_disabled, false)
union all
select 'موردون نشطون', count(*)::text from public.distributors where not coalesce(is_disabled, false) and not coalesce(is_archived, false)
union all
select 'أصناف يُتابَع مخزونها', count(*)::text from public.items where coalesce(track_inventory, false) and not coalesce(is_disabled, false);
