-- =============================================================================
-- 0151_drug_catalog_category.sql
-- إضافة فئة الصنف إلى كتالوج الأدوية — لتعمل شجرة الفئات في شاشة الصيدلية.
-- =============================================================================
--
-- **العيب:** `v_drug_catalog` لا يعرض `category_value_id` إطلاقًا، فشاشة
-- الأدوية لا تستطيع أن تُرشّح بالفئة ولا أن تعرض شجرة فئات — بينما الفئة
-- مسجَّلة على الصنف نفسه في `items` ويستعملها كتالوج الخدمات.
--
-- **لماذا يُلحَق العمودان في الآخر:** `create or replace view` لا تُدرج عمودًا
-- في الوسط ولا تُسقط عمودًا؛ تقبل الإلحاق في النهاية وحده. فبقيّة الأعمدة
-- أُعيدت كما هي حرفًا بحرف من `0088`، والعمودان الجديدان بعد `stock_reserved`.
--
-- لا تغيّر هذه الترقية بيانًا واحدًا: تُوسّع منظورًا للقراءة فقط.
-- =============================================================================

create or replace view v_drug_catalog
with (security_invoker = on) as
select
  i.id                as item_id,
  i.organization_id,
  i.code,
  i.name_ar,
  i.name_en,
  i.unit,
  i.price,
  i.cost_price,
  i.reorder_level,
  i.is_disabled,
  i.is_archived,
  d.generic_name,
  d.brand_name,
  d.dosage_form,
  d.strength_text,
  d.manufacturer,
  d.registration_number,
  d.atc_code,
  d.default_route,
  d.pack_size,
  d.storage_conditions,
  d.requires_prescription,
  d.is_controlled_substance,
  d.controlled_drug_class,
  d.default_dosage_instructions,
  coalesce((select sum(l.qty_remaining) from inventory_lots l
             where l.item_id = i.id and l.status = 'available'), 0) as stock_on_hand,
  coalesce((select sum(l.reserved_quantity) from inventory_lots l
             where l.item_id = i.id and l.status = 'available'), 0) as stock_reserved,
  -- مُلحَق في 0151: فئة الصنف واسمها — لشجرة الفئات في شاشة الأدوية
  i.category_value_id,
  (select lv.name_ar from lookup_values lv where lv.id = i.category_value_id) as category_name
from items i
left join drug_details d on d.item_id = i.id
where i.item_type = 'drug';

comment on view v_drug_catalog is
  'كتالوج الأدوية: الصنف وتفاصيله الدوائية ورصيده وفئته. الشاشات تُرشِّح المؤرشف بنفسها.';

notify pgrst, 'reload schema';
