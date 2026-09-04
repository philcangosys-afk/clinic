-- ============================================================================
-- 0137 — إعادة الصلاحيات التي تحتاجها الواجهة، بعد تأمين ما كان مفتوحًا
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `0114` سحبت `execute` من `public` عن **كل** دالّة تبدأ بـ`app_`. وهذه
--   خطوة صحيحة في أصلها، لكن `authenticated` كان يرث التنفيذ عبر `public`،
--   فكل دالّة لم تُمنح له صراحةً صارت محجوبة عنه. أربع منها تحتاجها الواجهة
--   فعلًا، فانكسرت بصمت — «permission denied for function …» عند المستخدم:
--
--     • `app_mask_text`       — يستعمله `v_patient_directory`، والعرض
--                               `security_invoker` أي يقرأ بصلاحية المستخدم.
--                               النتيجة: **دليل المرضى لا يفتح**.
--     • `app_country_defaults`— يستعمله عرض إعدادات اللغة، وبالمثل.
--     • `app_seed_default_chart_of_accounts` و`app_seed_gl_posting_rules` —
--       تستدعيهما شاشة المحاسبة بـ`rpc` مباشرة. بلا صلاحية = **زرّان لا
--       يعملان**، وهو ما اشترطتَ ألّا يوجد.
--
--   لكن الإعادة المجرَّدة خطأ أكبر: `app_seed_default_chart_of_accounts`
--   دالّة `SECURITY DEFINER` **بلا أيّ تحقّق من العضوية**، تأخذ معرّف منشأة
--   وتكتب فيه. منحها لـ`authenticated` كما هي يعني أن أيّ مستخدم مسجَّل في
--   أيّ منشأة يستطيع تهيئة دليل حسابات **منشأة غيره** بتمرير معرّفها. لذلك
--   حُجبت في 0123 — والحجب عالج الثغرة وكسر الزر معًا.
--
--   الحلّ هنا: يُسدّ الثقب أوّلًا بحارس صلاحية داخل الدالّة، ثم تُعاد
--   الصلاحية. لا زرّ معطَّل، ولا منشأة مكشوفة.
--
-- بقيّة ما سحبته 0114 و0123 يبقى محجوبًا عن الواجهة: دوالّ البذر التلقائي
-- ودوالّ المهام الخلفية (`app_notify`, `app_claim_pending_messages`,
-- `app_mark_message_*`, `app_process_due_appointment_reminders` …) تُستدعى من
-- المحفِّزات أو من `service_role`، ولا تُنادى من المتصفّح أصلًا.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regprocedure('public.app_has_permission(uuid,text)') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0137: `app_has_permission` غير موجودة — شغّل هجرات الصلاحيات أوّلًا.';
  end if;
end
$zc_pre$;

-- ── 1) سدّ الثقب: تهيئة دليل الحسابات تتحقّق من الصلاحية ───────────────────
-- نفس مفتاح الصلاحية الذي تستعمله `app_seed_gl_posting_rules` (`gl.rules`):
-- من يملك ضبط قواعد الترحيل هو من يملك تهيئة الدليل الافتراضي.
do $zc_guard$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_seed_default_chart_of_accounts';
  v_src := replace(v_src, chr(13), '');

  if v_src is null then
    raise exception 'app_seed_default_chart_of_accounts غير موجودة — شغّل 0017/0099 أوّلًا';
  end if;

  if position('gl.rules' in v_src) > 0 then
    return;  -- محروسة سلفًا
  end if;

  -- الحارس يُدرج مباشرةً بعد `begin` الأولى في جسم الدالّة.
  v_new := replace(
    v_src,
    E'AS $function$\nbegin\n',
    E'AS $function$\nbegin\n'
    '  if not app_has_permission(target_organization_id, ''gl.rules'') then\n'
    '    raise exception ''صلاحيتك لا تسمح بتهيئة دليل الحسابات (gl.rules)'';\n'
    '  end if;\n\n');

  if v_new = v_src then
    raise exception 'تعذّر إدراج حارس الصلاحية في app_seed_default_chart_of_accounts — راجع 0137';
  end if;

  execute v_new;
end
$zc_guard$;

-- ── 2) إعادة الصلاحيات للأربع، وللأربع وحدها ──────────────────────────────
do $zc_grant$
declare
  v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_mask_text',
                         'app_country_defaults',
                         'app_seed_default_chart_of_accounts',
                         'app_seed_gl_posting_rules')
  loop
    execute format('grant execute on function %s to authenticated', v_sig);
    -- `anon` يبقى محجوبًا: لا شيء من هذه الأربع يُنادى بلا تسجيل دخول.
    execute format('revoke all on function %s from anon, public', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end
$zc_grant$;

-- ── تحقّق فوريّ ─────────────────────────────────────────────────────────────
do $zc_verify$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_mask_text','app_country_defaults',
                       'app_seed_default_chart_of_accounts','app_seed_gl_posting_rules')
     and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'ما زالت محجوبة عن authenticated: %', v_bad;
  end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_mask_text','app_country_defaults',
                       'app_seed_default_chart_of_accounts','app_seed_gl_posting_rules')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'مفتوحة أمام anon بلا داعٍ: %', v_bad;
  end if;

  if pg_get_functiondef('public.app_seed_default_chart_of_accounts(uuid)'::regprocedure)
       not like '%gl.rules%' then
    raise exception 'حارس الصلاحية لم يُثبَّت في تهيئة دليل الحسابات';
  end if;
end
$zc_verify$;
