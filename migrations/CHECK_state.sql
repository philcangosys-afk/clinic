-- CHECK_state.sql — تشخيص: ما المطبَّق على هذه القاعدة وما الناقص؟
--
-- الصقه كاملًا في محرّر SQL في Supabase. لا يعدّل شيئًا؛ يقرأ فقط.
-- كل سطر يقول: هل الشيء موجود، وأي هجرة أضافته.

select 'أعمدة items (0071/0073)' as المجموعة, x.العنصر, x.الهجرة,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='items'
                            and column_name = x.العنصر) then '✅' else '❌ ناقص' end as الحالة
from (values
  ('description_ar','0071'), ('medical_service_type','0071'), ('default_clinic_id','0071'),
  ('duration_minutes','0071'), ('provider_role','0071'), ('is_archived','0071'),
  ('revenue_account_id','0071'), ('cogs_account_id','0071'),
  ('requires_fasting','0073'), ('min_age_years','0073'), ('gender_restriction','0073'),
  ('requires_consent','0073'), ('requires_preauthorization','0073'), ('consent_note_ar','0073'),
  ('preparation_en','0073')
) as x(العنصر, الهجرة)

union all

select 'جداول', x.العنصر, x.الهجرة,
       case when to_regclass('public.' || x.العنصر) is not null then '✅' else '❌ ناقص' end
from (values
  ('item_branches','0071'), ('price_lists','0072'), ('price_list_items','0072'),
  ('resources','0073'), ('item_resources','0073'), ('item_claim_codes','0073')
) as x(العنصر, الهجرة)

union all

select 'مناظير', x.العنصر, x.الهجرة,
       case when to_regclass('public.' || x.العنصر) is not null then '✅' else '❌ ناقص' end
from (values
  ('v_service_catalog','0071'), ('v_item_price_history','0072'),
  ('v_visit_services_status','0073'), ('v_unbilled_performed_services','0074'),
  ('v_pending_consents','0076')
) as x(العنصر, الهجرة)

union all

-- هذا هو سبب خطأ 42703 الذي تراه في /services
select 'أعمدة v_service_catalog', x.العنصر, x.الهجرة,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='v_service_catalog'
                            and column_name = x.العنصر) then '✅' else '❌ ناقص' end
from (values
  ('category_name','0076'), ('is_archived','0076'), ('archive_reason','0076'),
  ('archived_at','0076'), ('branch_ids','0071'), ('resource_ids','0073'),
  ('primary_claim_code','0073'), ('primary_claim_code_system','0073'), ('clinic_name','0071')
) as x(العنصر, الهجرة)

union all

select 'دوال', x.العنصر, x.الهجرة,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname = x.العنصر) then '✅' else '❌ ناقص' end
from (values
  ('app_archive_item','0071'), ('app_item_available_in_branch','0071'),
  ('app_set_price_list_item','0072'), ('app_resolve_item_price','0072'),
  ('app_check_service_eligibility','0073'), ('app_set_visit_service_status','0073'),
  ('app_item_claim_code','0073'), ('app_consume_package_item','0075'),
  ('app_save_service','0077')
) as x(العنصر, الهجرة)

union all

select 'أمان', 'كتابة items مقصورة على catalog.manage', '0079',
       case when exists (
         select 1 from pg_policy
          where polrelid='items'::regclass and polcmd in ('*','w','a')
            and pg_get_expr(coalesce(polwithcheck, polqual), polrelid) not like '%catalog.manage%'
       ) then '❌ ما زالت مفتوحة لكل عضو' else '✅' end

union all

select 'أمان', 'دوال ينفّذها anon', '0078',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname like 'app\_%'
                     and has_function_privilege('anon', p.oid,'execute')) > 0
            then '❌ ' || (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                            where n.nspname='public' and p.proname like 'app\_%'
                              and has_function_privilege('anon', p.oid,'execute')) || ' دالة'
            else '✅' end

order by 1, 3, 2;
