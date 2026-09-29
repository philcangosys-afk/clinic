-- ============================================================================
-- تراجع عن 0195 — يعيد نصّ السياسات الأصليّ المحفوظ في app_policy_backup_0195
-- ============================================================================
-- لا يُنفَّذ إلّا عند الحاجة. الدوالّ المساعدة وجدول النسخة يبقيان (لا ضرر منهما).
begin;

do $$
declare
  r     record;
  v_sql text;
  v_n   int := 0;
begin
  if to_regclass('public.app_policy_backup_0195') is null then
    raise exception 'لا توجد نسخة 0195 — لم تُنفَّذ الترقية على هذه القاعدة';
  end if;
  for r in
    select b.* from app_policy_backup_0195 b
      join pg_policies p on p.schemaname = b.schemaname
                        and p.tablename = b.tablename
                        and p.policyname = b.policyname
  loop
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then v_sql := v_sql || ' using (' || r.qual || ')'; end if;
    if r.with_check is not null then v_sql := v_sql || ' with check (' || r.with_check || ')'; end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;
  delete from app_policy_backup_0195;
  raise notice 'أُعيدت % سياسة إلى نصّها الأصليّ', v_n;
end $$;

commit;
