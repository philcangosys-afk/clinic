-- 0038: موجودات المستودع بمنطق التسعير (لقطة 74)
--
-- الفجوة: النظام كان يعرض سجل حركات تراكميًا فقط، بلا أي رصيد حالي مجمَّع
-- ولا قيمة مخزون ولا متوسط شراء مرجَّح. لقطة 74 من النظام القديم تعرض
-- "موجودات المستودع" بمتوسط صافي الشراء والربح المتوقع.
--
-- القرار التقني: الرصيد وقيمته يُحسبان من `inventory_lots` لا من مجموع
-- `inventory_movements`. السبب أن الدفعات تحمل تكلفة الشراء الفعلية لكل
-- دفعة (unit_cost)، فيكون المتوسط المرجَّح صحيحًا حتى لو اشتُري نفس الصنف
-- بأسعار مختلفة — وهو الحال الطبيعي. الاعتماد على الحركات كان سيخلط أسعار
-- البيع بأسعار الشراء.
--
-- المتوسط المرجَّح = مجموع (الكمية المتبقية × تكلفة دفعتها) ÷ مجموع الكميات
-- المتبقية. الدفعات المنتهية (qty_remaining = 0) لا تدخل الحساب حتى لا
-- تُثقِل المتوسط بتكاليف قديمة لم يعد منها شيء في المخزن.

create or replace view v_inventory_on_hand as
select
  lots.organization_id,
  lots.warehouse_id,
  w.name                                as warehouse_name,
  lots.item_id,
  i.code                                as item_code,
  i.name_ar                             as item_name_ar,
  i.price                               as sale_price,
  count(*)                              as lot_count,
  sum(lots.qty_remaining)               as qty_on_hand,
  -- قيمة المخزون بتكلفة الشراء الفعلية لكل دفعة
  sum(lots.qty_remaining * lots.unit_cost) as stock_value,
  -- المتوسط المرجَّح — nullif يحمي من القسمة على صفر حين لا يتبقَّ شيء
  round(
    sum(lots.qty_remaining * lots.unit_cost) / nullif(sum(lots.qty_remaining), 0),
    2
  )                                     as weighted_avg_cost,
  -- الربح المتوقع لو بيعت الكمية المتبقية كلها بسعر البيع الحالي
  round(
    (i.price * sum(lots.qty_remaining)) - sum(lots.qty_remaining * lots.unit_cost),
    2
  )                                     as expected_profit,
  min(lots.expiry_date) filter (where lots.qty_remaining > 0) as nearest_expiry
from inventory_lots lots
join items i      on i.id = lots.item_id
join warehouses w on w.id = lots.warehouse_id
where lots.qty_remaining > 0
group by
  lots.organization_id, lots.warehouse_id, w.name,
  lots.item_id, i.code, i.name_ar, i.price;

-- ملخص إجمالي لكل مستودع — يُستخدم لبطاقات المؤشرات أعلى الشاشة
create or replace view v_inventory_warehouse_summary as
select
  organization_id,
  warehouse_id,
  warehouse_name,
  count(*)            as item_count,
  sum(qty_on_hand)    as total_qty,
  sum(stock_value)    as total_value,
  sum(expected_profit) as total_expected_profit
from v_inventory_on_hand
group by organization_id, warehouse_id, warehouse_name;
