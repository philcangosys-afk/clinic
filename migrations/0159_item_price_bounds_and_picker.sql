-- =============================================================================
-- 0159_item_price_bounds_and_picker.sql
-- حدّا سعر الصنف ومُنتقي الخدمات.
-- =============================================================================
--
-- **ما تفعله:** تُضيف حدًّا أدنى وأعلى لسعر الصنف — كعمودَي «الحد الأدنى /
-- الحد الأعلى» في نظام العيادات المرجعيّ — و**تفرضهما**، ثمّ تجمع ما يحتاجه
-- منتقي الخدمات في منظورٍ واحد.
--
-- **ولماذا يُفرَضان لا يُعرضان فقط:** عمودٌ يُحفَظ ولا يقرؤه شيء هو العيب
-- المتكرّر في هذا المستودع بعينه — `show_logo` بلا شعار، و`consultation_fee_rules`
-- بلا تطبيق، و`vat_responsibility` بلا حساب. حدٌّ للسعر لا يمنع تجاوزه ليس
-- حدًّا، بل عمودٌ يوهم صاحب المنشأة أنّه ضبط شيئًا.
--
-- **والفرض بمُحفِّز لا داخل `app_create_sales_invoice`:** المُحفِّز يحرس كل
-- مسارٍ يكتب بندًا — الفاتورة، والمرتجع، وأيّ إدخالٍ مباشر — بينما الفحص داخل
-- دالّةٍ واحدة يحرس بابًا ويترك البقيّة. وإعادة تعريف دالّةٍ من ستّمئة سطر
-- لأجل شرطين سطرين مخاطرةٌ بلا مقابل.
--
-- إضافةٌ محضة: عمودان يُلحقان، ومُحفِّز جديد، ومنظور جديد.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) حدّا السعر
--
-- الفارغ يعني «بلا حدّ» لا «صفر»: أكثر الأصناف لا حدّ لها، وصفرٌ افتراضيّ
-- كان سيمنع كل بيعٍ فوق الصفر في اليوم الأول.
-- ═══════════════════════════════════════════════════════════════════════════

alter table items
  add column if not exists min_price numeric(12,2),
  add column if not exists max_price numeric(12,2);

comment on column items.min_price is
  'أدنى سعر بيع مسموح لهذا الصنف. فارغٌ = بلا حدّ. يفرضه مُحفِّز بنود الفاتورة.';
comment on column items.max_price is
  'أعلى سعر بيع مسموح لهذا الصنف. فارغٌ = بلا حدّ. يفرضه مُحفِّز بنود الفاتورة.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_price_bounds_check') then
    alter table items add constraint items_price_bounds_check
      check (min_price is null or max_price is null or max_price >= min_price) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_price_bounds_sign_check') then
    alter table items add constraint items_price_bounds_sign_check
      check (coalesce(min_price, 0) >= 0 and coalesce(max_price, 0) >= 0) not valid;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) فرض الحدّين على كل بندٍ يُكتب
--
-- **الاستثناءات مقصودة وتُقال:**
--   • البند بلا `item_id` (وصفٌ حرّ) لا حدّ له — لا صنف يحمله.
--   • **المرتجع مستثنًى**: هو عكسٌ لفاتورةٍ سابقة بسعرها، فلو تغيّر الحدّ بعد
--     البيع لتعذّر ردّ ما بيع — وهذا حبسٌ لمال المريض لا حماية.
--   • السعر صفرًا مستثنًى: بند هدية أو تسويةٍ بصفر ليس تجاوزًا للحدّ الأدنى.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_guard_invoice_item_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_item   items%rowtype;
  v_type   text;
begin
  if new.item_id is null then
    return new;
  end if;

  select invoice_type into v_type from sales_invoices where id = new.invoice_id;
  if coalesce(v_type, 'sale') <> 'sale' then
    return new;
  end if;

  select * into v_item from items where id = new.item_id;
  if not found then
    return new;
  end if;
  if v_item.min_price is null and v_item.max_price is null then
    return new;
  end if;

  if v_item.min_price is not null
     and coalesce(new.price, 0) > 0
     and new.price < v_item.min_price then
    raise exception 'سعر «%» أقلّ من حدّه الأدنى (%). عدِّل الحدّ من بطاقة الصنف أو ارفع السعر.',
      coalesce(v_item.name_ar, 'الصنف'), v_item.min_price;
  end if;

  if v_item.max_price is not null and coalesce(new.price, 0) > v_item.max_price then
    raise exception 'سعر «%» أعلى من حدّه الأقصى (%). عدِّل الحدّ من بطاقة الصنف أو اخفض السعر.',
      coalesce(v_item.name_ar, 'الصنف'), v_item.max_price;
  end if;

  return new;
end;
$$;

comment on function app_guard_invoice_item_price() is
  'يمنع بيع الصنف خارج حدَّي سعره. المرتجع والبند الحرّ والسعر صفرًا مستثناة.';

drop trigger if exists trg_guard_invoice_item_price on sales_invoice_items;
create trigger trg_guard_invoice_item_price
  before insert or update of price, item_id on sales_invoice_items
  for each row execute function app_guard_invoice_item_price();


-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) منظور منتقي الخدمات
--
-- ما يعرضه المنتقي في قراءةٍ واحدة: الكود والباركود والاسم والسعر والحدّان،
-- واسم التصنيف ومعرّفه (للشجرة)، وهل للصنف تغطية تأمينية نشطة.
--
-- **«مغطّى تأمينيًّا» تعني: له قاعدة تغطية نشطة في عقدٍ أو وثيقة** — لا أنّ
-- تأمين هذا المريض بعينه يغطّيه. التغطية تُحسم بالعقد وقت الفوترة
-- (`insurance_coverage_rules` منذ 0089)، والعمود هنا دليلٌ للموظّف لا حكم.
--
-- الأصناف المؤرشفة والمعطَّلة تخرج: قائمةٌ تعرض ما لا يُباع تُطيل البحث
-- وتُنتج بنودًا مرفوضة عند الحفظ.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_item_picker;
create view v_item_picker
with (security_invoker = on) as
select
  i.id                        as item_id,
  i.organization_id,
  i.item_type,
  i.code,
  i.legacy_code,
  i.barcode,
  i.name_ar,
  i.name_en,
  i.unit,
  i.price,
  i.min_price,
  i.max_price,
  i.is_vat_exempt,
  i.default_discount_percent,
  i.requires_preauthorization,
  i.medical_service_type,
  i.default_clinic_id,
  cl.name                     as default_clinic_name,
  i.category_value_id,
  cat.name_ar                 as category_name,
  cat.parent_value_id         as category_parent_id,
  exists (
    select 1
      from insurance_coverage_rules r
     where r.organization_id = i.organization_id
       and coalesce(r.is_active, true) = true
       and r.coverage in ('covered', 'requires_preauth')
       and (
         r.item_id = i.id
         or (r.item_id is null and r.category_value_id is not null
             and r.category_value_id = i.category_value_id)
         or (r.item_id is null and r.category_value_id is null
             and r.medical_service_type is not null
             and r.medical_service_type = i.medical_service_type)
       )
  )                           as is_insured
from items i
left join lookup_values cat on cat.id = i.category_value_id
left join clinics cl        on cl.id = i.default_clinic_id
where coalesce(i.is_disabled, false) = false
  and coalesce(i.is_archived, false) = false;

comment on view v_item_picker is
  'أصناف الكتالوج القابلة للبيع كما يعرضها منتقي الخدمات: الكود والباركود والسعر وحدّاه والتصنيف والتغطية التأمينية.';

grant select on v_item_picker to authenticated;

notify pgrst, 'reload schema';
