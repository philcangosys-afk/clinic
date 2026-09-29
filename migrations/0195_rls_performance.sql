-- ============================================================================
-- 0195 — سرعة النظام بعد استيراد Kizen (25 ألف مريض وأرشيفهم)
-- ============================================================================
--
-- لماذا ثقُل النظام؟
--   سياسات الأمان (RLS) مكتوبةٌ على هيئة `app_has_permission(organization_id, 'x')`
--   و`app_is_member(organization_id)`. هذه دوالّ SECURITY DEFINER لا يستطيع
--   Postgres فكّها، **فتُنفَّذ مرّةً لكلّ صفّ**، و`app_has_permission` وحدها
--   تحوي خمسة استعلامات فرعية. مع مئتي مريض لم يكن لذلك أثر؛ مع 25,847 مريضًا
--   صار كلّ عدٍّ أو بحثٍ في المرضى يستدعيها 25 ألف مرّة:
--     * عدّاد المرضى في الشريط الجانبي (كلّ دقيقتين) ولوحة التحكّم.
--     * قائمة المرضى: الترتيب يمرّ على كلّ الصفوف قبل أخذ الصفحة.
--     * البحث بالاسم/الجوال: `ilike` ليست «مانعة للتسريب» (leakproof)، فيُلزم
--       Postgres بتقييم السياسة على **كلّ** صفوف المنشأة قبل البحث.
--
-- ما تفعله هذه الترقية
--   تعيد كتابة السياسات القائمة — كلّها، في المخطّط public — كتابةً مكافئةً
--   حرفيًّا في المعنى، لكن تُقيَّم الدالّة فيها **مرّةً لكلّ منشأة** لا لكلّ صفّ:
--
--     app_has_permission(organization_id, 'patients.view')
--       ⟶ coalesce(organization_id in (
--            select c.org_id from app_rls_candidate_orgs() c(org_id)
--             where app_has_permission(c.org_id, 'patients.view')), false)
--
--   `app_rls_candidate_orgs()` تُرجع المنشآت التي للمستخدم فيها عضويّةٌ أو
--   صلاحيّةٌ مسجّلة (منشأة أو اثنتان عادةً). والدالّة الأصلية نفسها هي التي
--   تُقرّر — لم يُنسخ منطق الصلاحيات ولم يتغيّر: من كان يرى صفًّا يراه، ومن
--   لم يكن لا يراه. والاستعلام الفرعيّ غير مرتبط بالصفّ فيُحسب مرّةً ويُخزَّن.
--   ‏`coalesce(…, false)` يُبقي النتيجة true/false بالضبط كما كانت، حتى داخل NOT.
--
--   ويُعامَل `app_is_portal_patient(organization_id, id|patient_id)` بالطريقة
--   نفسها على أزواج (المنشأة، المريض) من حسابات بوّابة المستخدم.
--
--   لا يُمسّ: أيّ استدعاءٍ وسيطُه غير `organization_id` المجرّد (مثل
--   `o.organization_id` داخل استعلامٍ فرعيّ، أو `app_can_access_branch` الذي
--   يعتمد على فرع الصفّ)، ولا `app_is_org_admin` — تبقى كما هي.
--
-- الأمان
--   * النصّ الأصليّ لكلّ سياسةٍ تُعدَّل يُحفظ في `app_policy_backup_0195`، والملفّ
--     `ROLLBACK_0195_rls_performance.sql` يعيدها كما كانت.
--   * قبل التعديل يُتحقّق أنّ كلّ دالّةٍ تقرأ الجدول الذي تُبنى منه قائمة
--     المرشّحين؛ وإن لم تكن كذلك تُترك سياساتها دون تعديل.
--   * كلّ شيءٍ في معاملةٍ واحدة: أيّ خطأ يُلغي الترقية كاملة.
--   * إعادة التنفيذ آمنة: السياسة المعدَّلة لا تطابق النمط ثانيةً.
--
-- يُنفَّذ في Supabase ← SQL Editor مرّةً واحدة.
-- ============================================================================

begin;

-- ── 1) قوائم المرشّحين ──────────────────────────────────────────────────────
-- لا تكشف إلّا ما يخصّ المستخدم نفسه (auth.uid())؛ للزائر المجهول تُرجع لا شيء.
create or replace function app_rls_candidate_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.organization_id from organization_memberships m where m.user_id = auth.uid()
  union
  select p.organization_id from membership_permissions p where p.user_id = auth.uid()
$$;

create or replace function app_rls_candidate_portal_links()
returns table (org_id uuid, patient_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.organization_id, a.patient_id
    from patient_portal_accounts a
   where a.user_id = auth.uid()
     and a.patient_id is not null
$$;

revoke all on function app_rls_candidate_orgs() from public;
revoke all on function app_rls_candidate_portal_links() from public;
grant execute on function app_rls_candidate_orgs() to anon, authenticated, service_role;
grant execute on function app_rls_candidate_portal_links() to anon, authenticated, service_role;

-- ── 2) نسخة السياسات الأصلية ────────────────────────────────────────────────
create table if not exists app_policy_backup_0195 (
  schemaname  text not null,
  tablename   text not null,
  policyname  text not null,
  qual        text,
  with_check  text,
  backed_at   timestamptz not null default now(),
  primary key (schemaname, tablename, policyname)
);
alter table app_policy_backup_0195 enable row level security;
revoke all on app_policy_backup_0195 from anon, authenticated;

-- ── 3) إعادة الكتابة ────────────────────────────────────────────────────────
do $$
declare
  -- الدوالّ المسموح بإعادة كتابتها: كلّها تشترط صفًّا للمستخدم في
  -- organization_memberships أو membership_permissions للمنشأة نفسها.
  v_fns   text[] := array[]::text[];
  v_org_re text;
  v_org_rep text :=
    'COALESCE((organization_id IN (SELECT zc.org_id FROM app_rls_candidate_orgs() zc(org_id) '
    'WHERE \1(zc.org_id\2))), false)';
  v_portal boolean := false;
  v_portal_re text := 'app_is_portal_patient\(organization_id, (id|patient_id)\)';
  v_portal_rep text :=
    'COALESCE(((organization_id, \1) IN (SELECT zp.org_id, zp.patient_id '
    'FROM app_rls_candidate_portal_links() zp(org_id, patient_id) '
    'WHERE app_is_portal_patient(zp.org_id, zp.patient_id))), false)';
  v_def   text;
  r       record;
  v_qual  text;
  v_check text;
  v_sql   text;
  v_count int := 0;
begin
  v_def := pg_get_functiondef(to_regprocedure('public.app_is_member(uuid)'));
  if v_def ~ 'organization_memberships' then v_fns := array_append(v_fns, 'app_is_member'); end if;

  v_def := pg_get_functiondef(to_regprocedure('public.app_has_permission(uuid,text)'));
  if v_def ~ 'organization_memberships' then v_fns := array_append(v_fns, 'app_has_permission'); end if;

  v_def := pg_get_functiondef(to_regprocedure('public.app_has_role(uuid,text[])'));
  if v_def ~ 'organization_memberships' then v_fns := array_append(v_fns, 'app_has_role'); end if;

  v_def := pg_get_functiondef(to_regprocedure('public.app_is_portal_patient(uuid,uuid)'));
  v_portal := coalesce(v_def ~ 'patient_portal_accounts' and v_def ~ 'auth\.uid\(\)', false);

  if coalesce(array_length(v_fns, 1), 0) = 0 and not v_portal then
    raise exception 'لم يُعثر على دوالّ الصلاحيات المتوقّعة — لم يُعدَّل شيء';
  end if;

  -- الوسيط الثاني (إن وُجد) نصٌّ ثابت أو مصفوفة ثابتة فقط — لا عمود من الصفّ.
  v_org_re := '(' || array_to_string(v_fns, '|') || ')\(organization_id'
           || '((, (''[^'']*''::text\[\]|''[^'']*''::text|ARRAY\[[^]]*\]))?)\)';

  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and (   (coalesce(array_length(v_fns, 1), 0) > 0
                and (coalesce(p.qual, '') ~ v_org_re or coalesce(p.with_check, '') ~ v_org_re))
            or (v_portal
                and (coalesce(p.qual, '') ~ v_portal_re or coalesce(p.with_check, '') ~ v_portal_re)))
     order by p.tablename, p.policyname
  loop
    insert into app_policy_backup_0195 (schemaname, tablename, policyname, qual, with_check)
    values (r.schemaname, r.tablename, r.policyname, r.qual, r.with_check)
    on conflict (schemaname, tablename, policyname) do nothing;  -- يُحفظ الأصل الأوّل دائمًا

    v_qual := r.qual;
    v_check := r.with_check;
    if coalesce(array_length(v_fns, 1), 0) > 0 then
      v_qual  := regexp_replace(v_qual,  v_org_re, v_org_rep, 'g');
      v_check := regexp_replace(v_check, v_org_re, v_org_rep, 'g');
    end if;
    if v_portal then
      v_qual  := regexp_replace(v_qual,  v_portal_re, v_portal_rep, 'g');
      v_check := regexp_replace(v_check, v_portal_re, v_portal_rep, 'g');
    end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_qual is not null then v_sql := v_sql || ' using (' || v_qual || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice 'أُعيدت كتابة % سياسة (الدوالّ: %، البوّابة: %)',
    v_count, array_to_string(v_fns, ', '), v_portal;
end $$;

-- ── 4) إحصاءات الجداول بعد التحميل الكبير ──────────────────────────────────
-- المخطِّط يقرّر بالإحصاءات؛ بعد إدخال عشرات الآلاف دفعةً واحدة قد تبقى قديمة.
analyze patients;
analyze legacy_invoices;
analyze legacy_invoice_items;
analyze legacy_receipts;
analyze legacy_agreements;
analyze legacy_appointments;
analyze legacy_patient_records;
analyze treatment_agreements;
analyze doctors;
analyze lookup_values;

commit;

-- ── النتيجة ─────────────────────────────────────────────────────────────────
select b.tablename as "الجدول", count(*) as "سياسات عُدّلت"
  from app_policy_backup_0195 b
 group by b.tablename
 order by b.tablename;
