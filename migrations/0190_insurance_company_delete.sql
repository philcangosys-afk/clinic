-- ============================================================================
-- 0190 — حذف شركة تأمين نهائيًّا حين لا يتعلّق بها شيء
-- ============================================================================
--
-- شاشة «شركات التأمين والبوليصات» تُنشئ الشركة وتُعطّلها (بالضغط على شارة
-- «نشطة») ولا تحذفها. فشركة الأمان التجريبية التي زرعتها 0127 للاختبار
-- باقيةٌ في منشأةٍ حقيقية بلا طريقٍ لإزالتها.
--
-- ── بابان كما في الموظّفين (0188) ────────────────────────────────────────
--
-- **التعطيل** لشركةٍ عملت فعلًا: مطالباتها وموافقاتها وبنود فواتيرها تشير
-- إليها، وحذفها يكسر ذلك. تُعطَّل فتختفي من قوائم الاختيار ويبقى أثرها.
--
-- **الحذف النهائيّ** لشركةٍ لم يتعلّق بها شيء — أُدخلت بالخطأ أو للتجربة.
--
-- ── ما يُحذف معها، وما يمنع حذفها ─────────────────────────────────────────
--
-- **تعريف الشركة** يُحذف معها، لأنّه جزءٌ منها لا أثرٌ لعمل:
--   شبكاتها · بوالصها · عقودها · قواعد التغطية على تلك العقود والبوالص.
--
-- **وكلّ ما سواه يمنع** — عضويات المرضى، المطالبات، الموافقات المسبقة،
-- دفعات المطالبات، بنود الفواتير — وتُسمّى جداوله في رسالة الرفض.
--
-- والفحص باستدلالين معًا لا بقائمةٍ مكتوبة (الدرس من 0188):
--   ١. `pg_constraint`: كلّ قيدٍ أجنبيّ يشير إلى أحد جداول التعريف الخمسة
--   ٢. **وأيضًا** كلّ عمود uuid اسمه ينتهي بـ `company_id` أو `policy_id` أو
--      `network_id` أو `contract_id` أو `rule_id` — فجدولٌ ينقصه القيد لا
--      يُرى نظيفًا فيمضي الحذف ويترك صفوفًا معلّقة.
-- والمطابقة بالمعرّف (uuid) لا بالاسم، فعمود `contract_id` في عقود الموظّفين
-- مثلًا لا يُطابق خطأً: لا يحمل معرّفًا من معرّفات هذه الشركة.
--
-- وإن فات الفحصَ شيءٌ رغم ذلك، فالحذف يجري داخل الدالّة في معاملةٍ واحدة:
-- أيّ قيدٍ أجنبيّ يرفض يُسقط العملية كلّها ولا يبقى نصف حذف.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) معرّفات تعريف الشركة ─────────────────────────────────────────────────
create or replace function app_insurance_company_ids(p_company_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids   uuid[];
begin
  v_ids := array[p_company_id]
    || coalesce((select array_agg(id) from insurance_networks  where company_id = p_company_id), '{}')
    || coalesce((select array_agg(id) from insurance_policies  where company_id = p_company_id), '{}')
    || coalesce((select array_agg(id) from insurance_contracts where company_id = p_company_id), '{}');

  v_ids := v_ids
    || coalesce((select array_agg(r.id)
                   from insurance_coverage_rules r
                  where r.contract_id = any(v_ids)
                     or r.policy_id   = any(v_ids)), '{}');
  return v_ids;
end $$;

revoke all on function app_insurance_company_ids(uuid) from public, anon, authenticated;

-- ── 2) ما يتعلّق بالشركة ────────────────────────────────────────────────────
create or replace function app_insurance_company_dependencies(p_company_id uuid)
returns table (table_name text, column_name text, row_count bigint, blocking boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_ids uuid[];
  v_def text[] := array['insurance_companies','insurance_networks','insurance_policies',
                        'insurance_contracts','insurance_coverage_rules'];
  v_rec record;
  v_n   bigint;
begin
  select organization_id into v_org from insurance_companies where id = p_company_id;
  if v_org is null then
    raise exception 'شركة التأمين غير موجودة';
  end if;
  if not app_has_permission(v_org, 'insurance.view') then
    raise exception 'صلاحيتك لا تسمح بعرض شركات التأمين';
  end if;

  v_ids := app_insurance_company_ids(p_company_id);

  for v_rec in
    -- (أ) ما يشير بقيدٍ صريح إلى أحد جداول التعريف
    select cl.relname::text as tbl, att.attname::text as col
      from pg_constraint c
      join pg_class      cl  on cl.oid = c.conrelid
      join pg_namespace  ns  on ns.oid = cl.relnamespace
      join pg_class      rcl on rcl.oid = c.confrelid
      join unnest(c.conkey) as k(attnum) on true
      join pg_attribute  att on att.attrelid = c.conrelid and att.attnum = k.attnum
     where c.contype = 'f'
       and ns.nspname = 'public'
       and rcl.relname = any(v_def)
       and array_length(c.conkey, 1) = 1
    union
    -- (ب) ما يشير إليها بعمودٍ باسمه بلا قيد
    select cl.relname::text, att.attname::text
      from pg_class     cl
      join pg_namespace ns  on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = cl.oid
     where cl.relkind = 'r'
       and ns.nspname = 'public'
       and att.attnum > 0
       and not att.attisdropped
       and att.atttypid = 'uuid'::regtype
       and (att.attname like '%company_id'
         or att.attname like '%policy_id'
         or att.attname like '%network_id'
         or att.attname like '%contract_id'
         or att.attname like '%rule_id')
  loop
    if v_rec.tbl = any(v_def) then
      -- جداول التعريف: صفوفها التي هي من تعريف هذه الشركة تُحذف معها، أمّا
      -- صفٌّ **من خارجه** يشير إليها (شركةٌ فرعية عبر `parent_company_id`،
      -- أو بوليصةُ شركةٍ أخرى على شبكتها) فيمنع — وإلّا بقي معلّقًا.
      execute format('select count(*) from %I where %I = any($1) and id = any($1)',
                     v_rec.tbl, v_rec.col)
         into v_n using v_ids;
      if v_n > 0 then
        table_name := v_rec.tbl; column_name := v_rec.col;
        row_count := v_n; blocking := false;
        return next;
      end if;
      execute format('select count(*) from %I where %I = any($1) and not (id = any($1))',
                     v_rec.tbl, v_rec.col)
         into v_n using v_ids;
      if v_n > 0 then
        table_name := v_rec.tbl; column_name := v_rec.col;
        row_count := v_n; blocking := true;
        return next;
      end if;
    else
      execute format('select count(*) from %I where %I = any($1)', v_rec.tbl, v_rec.col)
         into v_n using v_ids;
      if v_n > 0 then
        table_name := v_rec.tbl; column_name := v_rec.col;
        row_count := v_n; blocking := true;
        return next;
      end if;
    end if;
  end loop;
end $$;

revoke all on function app_insurance_company_dependencies(uuid) from public, anon;
grant execute on function app_insurance_company_dependencies(uuid) to authenticated;

-- ── 3) الحذف النهائيّ ───────────────────────────────────────────────────────
create or replace function app_delete_insurance_company(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_name    text;
  v_ids     uuid[];
  v_blocked text;
  v_detail  text;
begin
  select organization_id, name_ar into v_org, v_name
    from insurance_companies where id = p_company_id;
  if v_org is null then
    raise exception 'شركة التأمين غير موجودة';
  end if;
  if not app_has_permission(v_org, 'insurance.manage') then
    raise exception 'صلاحيتك لا تسمح بحذف شركات التأمين';
  end if;

  select string_agg(d.table_name || ' (' || d.row_count || ')', '، ' order by d.table_name)
    into v_blocked
    from app_insurance_company_dependencies(p_company_id) d
   where d.blocking;

  if v_blocked is not null then
    raise exception
      'لا تُحذف هذه الشركة نهائيًّا: يتعلّق بها سجلّاتٌ في %. عطّلها بدل ذلك — تختفي من قوائم الاختيار ويبقى أثرها.',
      v_blocked;
  end if;

  v_ids := app_insurance_company_ids(p_company_id);

  begin
    -- الترتيب من الأبناء إلى الأب: القواعد ← العقود ← البوالص ← الشبكات ← الشركة
    delete from insurance_coverage_rules where id = any(v_ids);
    delete from insurance_contracts      where company_id = p_company_id;
    delete from insurance_policies       where company_id = p_company_id;
    delete from insurance_networks       where company_id = p_company_id;
    delete from insurance_companies      where id = p_company_id;
  exception when foreign_key_violation then
    -- جدولٌ فات الفحصَ اسمُه وقيدُه يرفض هنا، والكتلة كلّها تتراجع
    get stacked diagnostics v_detail = pg_exception_detail;
    raise exception 'لا تُحذف هذه الشركة: ما زال يشير إليها سجلّ — %. عطّلها بدل ذلك.', v_detail;
  end;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'insurance', 'delete', p_company_id,
          'حذف نهائيّ لشركة تأمين: ' || coalesce(v_name, '—'),
          'مع شبكاتها وبوالصها وعقودها — لم يكن لها أيّ عضويةٍ أو مطالبةٍ أو فاتورة');

  return true;
end $$;

revoke all on function app_delete_insurance_company(uuid) from public, anon;
grant execute on function app_delete_insurance_company(uuid) to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(f, '، ')
    into v_missing
    from unnest(array['app_insurance_company_ids','app_insurance_company_dependencies',
                      'app_delete_insurance_company']) f
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f);
  if v_missing is not null then
    raise exception 'دوالّ ناقصة: %', v_missing;
  end if;
  raise notice '0190 ✓ حذف شركة التأمين المحميّ جاهز';
end $$;
