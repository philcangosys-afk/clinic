-- 0078_catalog_policy_and_function_hardening.sql
-- تقوية سطح القاعدة: من ينفّذ الدوال، وبأي مسار بحث، وبأي هوية تُقرأ
-- المناظير.
--
-- ثلاث ثغرات قائمة، وجدتها بفحص المخطط لا بالقراءة:
--
--   1) **٦٧ دالة `app_*` ينفّذها `anon`.** أي أحد يملك المفتاح العام — وهو
--      منشور في حزمة المتصفّح بحكم تصميمه — يستطيع استدعاءها عبر PostgREST
--      دون تسجيل دخول. أكثرها `security definer`، أي تعمل بصلاحيات مالكها
--      متجاوزةً RLS. الفحص الداخلي يحمي أغلبها، لكن الاعتماد على أن كل دالة
--      تفحص بنفسها رهانٌ يخسره أول سهو.
--
--   2) **دوال `security definer` بلا `search_path` ثابت.** الدالة تعمل
--      بصلاحيات مالكها وتحلّ أسماء الجداول بمسار المستدعي. من يستطيع
--      الإنشاء في مخطط يسبق `public` يزرع جدولًا بنفس الاسم فتقرأ الدالة
--      جدوله بصلاحيات المالك. هذا تصعيد صلاحيات مكتمل.
--
--   3) **منظور بلا `security_invoker`.** يُقرأ بصلاحيات مالكه لا القارئ،
--      فيتجاوز RLS.
--
-- المعالجة هنا **عامّة لا مُعدَّدة**: تمرّ على كل دالة ومنظور بالوصف لا
-- بالاسم، فتغطّي ما بُني وما سيُبنى بعدها.
-- ---------------------------------------------------------------------------

begin;

create index if not exists idx_item_branches_org_item on item_branches (organization_id, item_id);
create index if not exists idx_item_branches_org_branch on item_branches (organization_id, branch_id);
create index if not exists idx_item_resources_org_item on item_resources (organization_id, item_id);
create index if not exists idx_item_resources_org_resource on item_resources (organization_id, resource_id);
create index if not exists idx_item_claim_codes_org_item on item_claim_codes (organization_id, item_id);
create index if not exists idx_item_claim_codes_org_company on item_claim_codes (organization_id, insurance_company_id);
create index if not exists idx_price_lists_org_branch_fk on price_lists (organization_id, branch_id);
create index if not exists idx_price_lists_org_company_fk on price_lists (organization_id, insurance_company_id);
create index if not exists idx_price_lists_org_client_fk on price_lists (organization_id, external_client_id);
create index if not exists idx_price_list_items_org_list on price_list_items (organization_id, price_list_id);
create index if not exists idx_price_list_items_org_item on price_list_items (organization_id, item_id);
create index if not exists idx_resources_org_clinic on resources (organization_id, clinic_id);
create index if not exists idx_items_org_default_clinic on items (organization_id, default_clinic_id);
create index if not exists idx_items_org_revenue_account on items (organization_id, revenue_account_id);
create index if not exists idx_items_org_cogs_account on items (organization_id, cogs_account_id);

-- ---------------------------------------------------------------------------
-- 1) `search_path` ثابت لكل دالة `security definer`
--
-- `pg_temp` في آخر المسار مقصود: لو تُرك ضمنيًا لسبق `public`، وهو تمامًا
-- المسار الذي تُستغلّ به الثغرة.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prosecdef
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    n := n + 1;
  end loop;
  raise notice 'ضُبط search_path على % دالة', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2) من ينفّذ الدوال
--
--   • `anon` و`public`: لا شيء.
--   • دوال المشغّلات: لا مِنحة لأحد — المشغّل يشغّلها بصلاحيات مالك الجدول،
--     ولا معنى لاستدعائها مباشرةً (تفشل بـ«trigger functions can only be
--     called as triggers»)، فبقاء المِنحة سطحُ هجومٍ بلا فائدة.
--   • ما عداها: `authenticated` فقط.
--
-- سياسات RLS تستدعي `app_is_member` وأخواتها بصلاحيات المستخدم، فمِنحة
-- `authenticated` عليها ضرورية لا تساهل.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n_revoked int := 0;
  n_granted int := 0;
begin
  for r in
    select p.oid::regprocedure as sig,
           p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname like 'app\_%'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    n_revoked := n_revoked + 1;

    if r.is_trigger then
      execute format('revoke all on function %s from authenticated', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
      n_granted := n_granted + 1;
    end if;
  end loop;
  raise notice 'سُحبت المِنح من anon على % دالة، ومُنحت authenticated على %',
    n_revoked, n_granted;
end $$;

-- ---------------------------------------------------------------------------
-- 3) `security_invoker` على كل منظور
--
-- بدونه يُقرأ المنظور بصلاحيات مالكه فيتجاوز RLS الجداول تحته. المناظير
-- التي بنيتُها تحمله؛ هذا يلتقط ما سبقها وما يُنسى لاحقًا.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'v'
       and not coalesce(
             (select option_value::boolean from pg_options_to_table(c.reloptions)
               where option_name = 'security_invoker'), false)
  loop
    execute format('alter view %I set (security_invoker = on)', r.relname);
    execute format('revoke all on %I from anon', r.relname);
    execute format('grant select on %I to authenticated', r.relname);
    n := n + 1;
  end loop;
  raise notice 'ضُبط security_invoker على % منظور', n;
end $$;

-- ---------------------------------------------------------------------------
-- 4) `anon` لا يقرأ أي جدول
--
-- الدخول كله يمرّ بـ`authenticated`. المفتاح العام لا يفتح شيئًا.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('anon', c.oid, 'select, insert, update, delete')
  loop
    execute format('revoke all on %I from anon', r.relname);
    n := n + 1;
  end loop;
  raise notice 'سُحبت صلاحيات anon عن % جدول', n;
end $$;

-- ---------------------------------------------------------------------------
-- 5) كل جدول تشغيلي عليه RLS مفعَّل
--
-- جدولٌ بلا `enable row level security` يقرؤه أي عضو مسجَّل من أي منشأة.
-- هذا الفحص يرفع خطأً بأسماء الجداول الناقصة بدل أن يمرّ صامتًا: تفعيل RLS
-- بلا سياسة يقفل الجدول تمامًا ويكسر شاشات، فالقرار يحتاج مراجعة لا
-- أتمتة.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped);

  if v_missing is not null then
    raise exception 'جداول تحمل organization_id وRLS معطَّل عليها: %', v_missing;
  end if;
  raise notice 'كل جدول يحمل organization_id عليه RLS مفعَّل';
end $$;

-- القراءة لكل عضو، والكتابة فقط بصلاحية الكتالوج المناسبة.
drop policy if exists "item_branches_read" on item_branches;
drop policy if exists "item_branches_write" on item_branches;
drop policy if exists "item_branches_insert" on item_branches;
drop policy if exists "item_branches_update" on item_branches;
drop policy if exists "item_branches_delete" on item_branches;
create policy "item_branches_read" on item_branches for select to authenticated
  using (app_is_member(organization_id));
create policy "item_branches_insert" on item_branches for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy "item_branches_update" on item_branches for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy "item_branches_delete" on item_branches for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists resources_select on resources;
drop policy if exists resources_write on resources;
drop policy if exists resources_insert on resources;
drop policy if exists resources_update on resources;
drop policy if exists resources_delete on resources;
create policy resources_select on resources for select to authenticated
  using (app_is_member(organization_id));
create policy resources_insert on resources for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy resources_update on resources for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy resources_delete on resources for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists item_resources_select on item_resources;
drop policy if exists item_resources_write on item_resources;
drop policy if exists item_resources_insert on item_resources;
drop policy if exists item_resources_update on item_resources;
drop policy if exists item_resources_delete on item_resources;
create policy item_resources_select on item_resources for select to authenticated
  using (app_is_member(organization_id));
create policy item_resources_insert on item_resources for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_resources_update on item_resources for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_resources_delete on item_resources for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists item_claim_codes_select on item_claim_codes;
drop policy if exists item_claim_codes_write on item_claim_codes;
drop policy if exists item_claim_codes_insert on item_claim_codes;
drop policy if exists item_claim_codes_update on item_claim_codes;
drop policy if exists item_claim_codes_delete on item_claim_codes;
create policy item_claim_codes_select on item_claim_codes for select to authenticated
  using (app_is_member(organization_id));
create policy item_claim_codes_insert on item_claim_codes for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_claim_codes_update on item_claim_codes for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_claim_codes_delete on item_claim_codes for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists "price_lists_read" on price_lists;
drop policy if exists "price_lists_write" on price_lists;
drop policy if exists "price_lists_insert" on price_lists;
drop policy if exists "price_lists_update" on price_lists;
drop policy if exists "price_lists_delete" on price_lists;
create policy "price_lists_read" on price_lists for select to authenticated
  using (app_is_member(organization_id));
create policy "price_lists_insert" on price_lists for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_lists_update" on price_lists for update to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_lists_delete" on price_lists for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'));

drop policy if exists "price_list_items_read" on price_list_items;
drop policy if exists "price_list_items_write" on price_list_items;
drop policy if exists "price_list_items_insert" on price_list_items;
drop policy if exists "price_list_items_update" on price_list_items;
drop policy if exists "price_list_items_delete" on price_list_items;
create policy "price_list_items_read" on price_list_items for select to authenticated
  using (app_is_member(organization_id));
create policy "price_list_items_insert" on price_list_items for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_list_items_update" on price_list_items for update to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_list_items_delete" on price_list_items for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'));

commit;
