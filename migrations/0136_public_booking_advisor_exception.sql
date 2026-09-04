-- ============================================================================
-- 0136 — استثناء موقع الحجز العام من إنذار «دالّة مفتوحة أمام anon»
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `v_security_advisor` (0095) يرفع «خطر» لكل دالّة SECURITY DEFINER يستطيع
--   `anon` تنفيذها — وهي قاعدة صحيحة: دالّةٌ كهذه تتخطّى RLS بلا مستخدم.
--
--   لكن موقع الحجز العام (0128–0135) يقوم على أن **الزائر يحجز بلا حساب**،
--   فثلاث دوالّ لا بدّ أن تكون مفتوحة أمام `anon`:
--     • `app_public_booking_catalog` — كتالوج معلن، محصور في 0129
--     • `app_public_doctor_slots`    — المواعيد المتاحة فقط
--     • `app_public_create_booking`  — إنشاء الحجز، محكوم بحارس الأهلية 0130
--
--   فبقاؤها في قائمة «خطر» يعني ثلاثة إنذارات دائمة لا تُغلق أبدًا. وشاشة
--   أمانٍ تصرخ بما لا يُصلَح يتعلّم صاحبها تجاهلها — وعندها يضيع الإنذار
--   الحقيقي حين يأتي. الإنذار الذي لا يُغلق أسوأ من غيابه.
--
-- ما يفعله هذا الملف: يستثني هذه الثلاث **وحدها بالاسم**. أي دالّة رابعة
-- تُفتح أمام `anon` — عمدًا أو سهوًا — ترتفع في المستشار فورًا كما كانت.
-- القائمة مغلقة، لا قاعدة عامة تُسكِت الفحص.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.v_security_advisor') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0136: `v_security_advisor` غير موجود — شغّل 0095_security_audit_pdpl.sql أوّلًا.';
  end if;
  if to_regclass('public.public_booking_settings') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0136: موقع الحجز العام غير مُنشأ — شغّل 0128_public_booking_website.sql أوّلًا.';
  end if;
end
$zc_pre$;

create or replace function app_is_public_booking_endpoint(p_proname text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_proname in ('app_public_booking_catalog',
                       'app_public_doctor_slots',
                       'app_public_create_booking');
$$;

comment on function app_is_public_booking_endpoint(text) is
  'قائمة مغلقة بدوالّ موقع الحجز العام المسموح لـ anon باستدعائها. أي اسم خارجها يبقى «خطر» في مستشار الأمان.';

revoke all on function app_is_public_booking_endpoint(text) from public, anon;
grant execute on function app_is_public_booking_endpoint(text) to authenticated, service_role;

-- إعادة بناء المستشار بالبند المستثنى وحده؛ بقيّة البنود كما هي.
do $zc_rebuild$
declare
  v_def text;
  v_new text;
begin
  select pg_get_viewdef('public.v_security_advisor'::regclass, true) into v_def;
  v_def := replace(v_def, chr(13), '');

  if v_def like '%app_is_public_booking_endpoint%' then
    return;  -- مُستثنى سلفًا
  end if;

  -- البند المقصود هو الوحيد الذي يجمع `prosecdef` مع صلاحية anon.
  v_new := replace(
    v_def,
    'has_function_privilege(''anon''::name, p.oid, ''execute''::text)',
    'has_function_privilege(''anon''::name, p.oid, ''execute''::text) '
    'AND NOT app_is_public_booking_endpoint(p.proname::text)');

  if v_new = v_def then
    raise exception 'تعذّر استثناء دوالّ الحجز العام: شكل `v_security_advisor` تغيّر — راجع 0095 و0136';
  end if;

  execute 'create or replace view v_security_advisor as ' || v_new;
end
$zc_rebuild$;

alter view v_security_advisor set (security_invoker = on);

-- ── تحقّق فوريّ ─────────────────────────────────────────────────────────────
-- لا يكفي أن يُنشأ المنظور: يجب أن تكون الثلاث قد اختفت فعلًا من «خطر»،
-- وأن يبقى الفحص قادرًا على رفع أي دالّة أخرى.
do $zc_verify$
declare
  v_left int;
begin
  select count(*) into v_left
    from v_security_advisor
   where finding_type = 'definer_anon_execute'
     and object_name in ('app_public_booking_catalog',
                         'app_public_doctor_slots',
                         'app_public_create_booking');
  if v_left > 0 then
    raise exception 'الاستثناء لم يُطبَّق: ما زالت % من دوالّ الحجز العام في قائمة الخطر', v_left;
  end if;

  if pg_get_viewdef('public.v_security_advisor'::regclass, true)
       not like '%app_is_public_booking_endpoint%' then
    raise exception 'المنظور لم يُعد بناؤه بالاستثناء';
  end if;
end
$zc_verify$;
