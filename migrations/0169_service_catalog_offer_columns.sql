-- ---------------------------------------------------------------------------
-- 0169 — `v_service_catalog` يعرض العرض النشط والإذن بالمجانيّ والحدّين
--
-- شاشة الخدمات تقرأ `v_service_catalog` لا `items`. فالعرض الذي أنشأته 0167
-- والإذن بالمنح مجانًا **لا يظهران في القائمة أصلًا**، ولا يمكن للمستخدم أن
-- يعرف أيّ خدمةٍ عليها عرضٌ اليوم إلّا بفتح كلّ خدمةٍ على حِدة. وحدّا السعر
-- (0159) مثلهما: أُضيفا إلى الجدول ولم يُضافا إلى المنظور.
--
-- والأعمدة تُلحَق في الآخر لا تُدسّ في الوسط: `create or replace view` لا
-- تقبل إلّا الإلحاق، وتغيير الترتيب يوجب حذف المنظور وإعادة بنائه — ومعه كل
-- ما يعتمد عليه.
--
-- **العرض المعروض هو النشط اليوم وحده**: عرضٌ انتهى أمس ليس حالًا يُعرض،
-- وعرضٌ يبدأ الشهر القادم ليس سعرًا يُفوَّتر به الآن.
-- ---------------------------------------------------------------------------

begin;

create or replace view v_service_catalog as
select
  i.id,
  i.organization_id,
  i.code,
  i.barcode,
  i.name_ar,
  i.name_en,
  i.description_ar,
  i.description_en,
  i.item_type,
  i.medical_service_type,
  i.category_value_id,
  cat.name_ar        as category_name,
  i.default_clinic_id,
  c.name             as clinic_name,
  i.duration_minutes,
  i.provider_role,
  i.requires_appointment,
  i.price,
  i.cost_price,
  i.default_discount_percent,
  i.is_vat_exempt,
  i.revenue_account_id,
  i.cogs_account_id,
  i.is_disabled,
  i.is_archived,
  i.archive_reason,
  i.archived_at,
  i.requires_fasting,
  i.fasting_hours,
  i.preparation_ar,
  i.min_age_years,
  i.max_age_years,
  i.gender_restriction,
  i.requires_consent,
  i.requires_preauthorization,
  i.requires_referral,
  coalesce(b.branch_ids, '{}')   as branch_ids,
  coalesce(r.resource_ids, '{}') as resource_ids,
  cc.code        as primary_claim_code,
  cc.code_system as primary_claim_code_system,
  i.created_at,
  i.updated_at,
  -- ── مُلحَقٌ في 0169 ──────────────────────────────────────────────────────
  i.min_price,
  i.max_price,
  i.allow_complimentary,
  i.complimentary_note,
  off.id            as offer_id,
  off.title         as offer_title,
  off.offer_price,
  off.show_before_after as offer_show_before_after,
  off.end_date      as offer_end_date,
  -- السعر الذي يُفوَّتر به اليوم فعلًا — عمودٌ واحد يغني الشاشة عن الحساب
  coalesce(off.offer_price, i.price) as effective_price
from items i
left join clinics c on c.id = i.default_clinic_id
left join lookup_values cat on cat.id = i.category_value_id
left join lateral (
  select array_agg(ib.branch_id) as branch_ids
    from item_branches ib where ib.item_id = i.id
) b on true
left join lateral (
  select array_agg(ir.resource_id) as resource_ids
    from item_resources ir where ir.item_id = i.id
) r on true
left join lateral (
  select x.code, x.code_system
    from item_claim_codes x
   where x.item_id = i.id and x.insurance_company_id is null and x.is_primary
   limit 1
) cc on true
left join lateral (
  select o.id, o.title, o.offer_price, o.show_before_after, o.end_date
    from item_offers o
   where o.item_id = i.id
     and o.organization_id = i.organization_id
     and o.is_disabled = false
     and (o.start_date is null or o.start_date <= current_date)
     and (o.end_date   is null or o.end_date   >= current_date)
   order by o.start_date desc nulls last
   limit 1
) off on true;

comment on view v_service_catalog is
  'الكتالوج الكامل بما فيه المؤرشف — رشّح بـ is_archived حسب الشاشة. ومنذ 0169: العرض النشط اليوم، والسعر الساري، والإذن بالمنح مجانًا، وحدّا السعر.';

alter view v_service_catalog set (security_invoker = on);
revoke all on v_service_catalog from anon;
grant select on v_service_catalog to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- حرسٌ ختاميّ: الأعمدة موجودة فعلًا، ولا قراءة لـ auth.users
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text := '';
  v_col text;
begin
  foreach v_col in array array['min_price','max_price','allow_complimentary',
                               'complimentary_note','offer_id','offer_title',
                               'offer_price','offer_show_before_after',
                               'offer_end_date','effective_price']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'v_service_catalog'
         and column_name = v_col
    ) then
      v_missing := v_missing || v_col || ' ';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'v_service_catalog ينقصه: %', v_missing;
  end if;
  if pg_get_viewdef('v_service_catalog'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_service_catalog يقرأ auth.users — وهو security_invoker فيُخفق للمستخدم العادي';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0169_service_catalog_offer_columns.sql
-- ---------------------------------------------------------------------------
