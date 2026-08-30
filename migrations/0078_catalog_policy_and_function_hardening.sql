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

commit;
