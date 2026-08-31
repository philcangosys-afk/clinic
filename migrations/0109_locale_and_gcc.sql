-- ============================================================================
-- 0109 — المرحلة 29: التعريب ودعم دول الخليج
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.**
--
-- ثلاث ملاحظات صادقة قبل التفصيل:
--
--   1) `organization_memberships.display_language` موجود ويُحفظ من شاشة
--      المستخدمين منذ زمن — **ولا يقرؤه شيء**. إعدادٌ يختاره المستخدم ولا
--      يتغيّر به شيء. يُفعَّل هنا فعليًّا.
--
--   2) في المخطط **45 عمود `name_en`** تُملأ في بضع شاشات ولا تُعرض في أيّ
--      مكان. لغة عرض البيانات هنا هي ما يجعلها تُقرأ.
--
--   3) **ما يُفعَّل هو لغة عرض *البيانات*** (أسماء الخدمات والفحوص والأدوية
--      والفروع) وتنسيق التواريخ والأرقام والعملة. أمّا نصوص الواجهة نفسها
--      فتبقى عربية في هذه المرحلة، ولن أسمّي الإعداد «لغة النظام» لأن ذلك
--      يَعِد بما لا يُنفَّذ. الاسم في الشاشة: «لغة عرض البيانات».
--
-- ودعم الخليج: بلد المنشأة يحدّد العملة ونسبة الضريبة الافتراضية وصيغة
-- الهوية والهاتف. والتحقّق من الهوية **بخوارزمية حقيقية للسعودية** (رقم
-- تحقّق)، وبفحص الصيغة فقط لبقيّة الدول — لأن خوارزمياتها ليست معلنة، وادّعاء
-- تحقّقٍ لا أملك أساسه أسوأ من عدمه.
-- ============================================================================

-- ===========================================================================
-- 1) إعدادات اللغة والبلد
-- ===========================================================================
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if to_regclass('public.patient_portal_accounts') is null then
    v_missing := v_missing || E'\n  • 0104_patient_portal.sql  (بوابة المريض)';
  end if;
  if to_regclass('public.critical_result_notifications') is null then
    v_missing := v_missing || E'\n  • 0105_doctor_workspace.sql  (مساحة الطبيب والنتائج الحرجة)';
  end if;
  if to_regclass('public.quality_incidents') is null then
    v_missing := v_missing || E'\n  • 0106_quality.sql  (الجودة والحوادث)';
  end if;
  if to_regclass('public.organization_policies') is null then
    v_missing := v_missing || E'\n  • 0107_organization_policies.sql  (سياسات المنشأة)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'app_set_membership_role') then
    v_missing := v_missing || E'\n  • 0108_users_and_permissions.sql  (المستخدمون والصلاحيات)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0109_locale_and_gcc.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

create table if not exists organization_locale_settings (
  organization_id  uuid primary key references organizations(id) on delete cascade,
  country_code     text not null default 'SA'
                     check (country_code in ('SA','AE','KW','QA','BH','OM')),
  currency_code    text not null default 'SAR'
                     check (currency_code in ('SAR','AED','KWD','QAR','BHD','OMR')),
  -- لغة عرض البيانات الافتراضية للمنشأة؛ ولكل عضو أن يخالفها
  data_language    text not null default 'ar' check (data_language in ('ar','en')),
  -- التقويم المعروض: ميلادي، هجري، أو كلاهما
  calendar_display text not null default 'gregorian'
                     check (calendar_display in ('gregorian','hijri','both')),
  -- التحقّق من الهوية: معطَّل افتراضًا حتى لا تُرفض ملفات قائمة فجأة
  enforce_id_validation boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

alter table organization_locale_settings enable row level security;

create or replace function app_locale(p_org uuid)
returns organization_locale_settings
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l organization_locale_settings%rowtype;
begin
  select * into l from organization_locale_settings where organization_id = p_org;
  if l.organization_id is null then
    l.organization_id       := p_org;
    l.country_code          := 'SA';
    l.currency_code         := 'SAR';
    l.data_language         := 'ar';
    l.calendar_display      := 'gregorian';
    l.enforce_id_validation := false;
  end if;
  return l;
end $$;

-- افتراضات كل بلد: تُعرض للمستخدم عند اختيار البلد، ولا تُفرض عليه
create or replace function app_country_defaults(p_country text)
returns table (currency_code text, vat_rate numeric, phone_prefix text, id_length int)
language sql
immutable
as $$
  -- الأعمدة تُصرَّح بأنواعها: قائمة القيم تُستنتج نصًّا بلا هذا التصريح
  select v.currency_code, v.vat_rate, v.phone_prefix, v.id_length from (values
    ('SA', 'SAR'::text, 15.0::numeric, '+966'::text, 10::int),
    ('AE', 'AED',  5.0, '+971', 15),
    ('KW', 'KWD',  0.0, '+965', 12),
    ('QA', 'QAR',  0.0, '+974', 11),
    ('BH', 'BHD', 10.0, '+973',  9),
    ('OM', 'OMR',  5.0, '+968',  8)
  ) as v(c, currency_code, vat_rate, phone_prefix, id_length)
  where v.c = upper(coalesce(p_country, 'SA'));
$$;

-- ===========================================================================
-- 2) التحقّق من رقم الهوية
--    السعودية وحدها لها رقم تحقّق معلن (خوارزمية Luhn معدّلة): يُطبَّق فعليًّا.
--    بقيّة الدول: طول وصيغة فقط — ولا يُدّعى أكثر من ذلك.
-- ===========================================================================
create or replace function app_validate_national_id(
  p_country text,
  p_id      text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_id   text := regexp_replace(coalesce(p_id, ''), '\D', '', 'g');
  v_sum  int := 0;
  v_i    int;
  v_d    int;
  v_len  int;
begin
  if v_id = '' then return false; end if;

  if upper(coalesce(p_country, 'SA')) = 'SA' then
    if length(v_id) <> 10 then return false; end if;
    -- **الرقم السعودي يبدأ بـ1 (مواطن) أو 2 (مقيم)**؛ ما عداه ليس هوية
    if substr(v_id, 1, 1) not in ('1', '2') then return false; end if;
    for v_i in 1..9 loop
      v_d := substr(v_id, v_i, 1)::int;
      if v_i % 2 = 1 then
        v_d := v_d * 2;
        if v_d > 9 then v_d := v_d - 9; end if;
      end if;
      v_sum := v_sum + v_d;
    end loop;
    return ((10 - (v_sum % 10)) % 10) = substr(v_id, 10, 1)::int;
  end if;

  -- بقيّة دول الخليج: فحص الطول المعروف فقط
  select id_length into v_len from app_country_defaults(p_country);
  if v_len is null then return length(v_id) between 8 and 15; end if;
  return length(v_id) = v_len;
end $$;

create or replace function app_normalize_phone(
  p_country text,
  p_phone   text
)
returns text
language plpgsql
immutable
as $$
declare
  v_raw    text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_prefix text;
begin
  if v_raw = '' then return null; end if;
  select phone_prefix into v_prefix from app_country_defaults(p_country);
  v_prefix := coalesce(v_prefix, '+966');

  if left(v_raw, 1) = '+' then return v_raw; end if;
  if left(v_raw, 2) = '00' then return '+' || substr(v_raw, 3); end if;
  -- الصيغة المحلية: 05xxxxxxxx ⇒ يُحذف الصفر ويُضاف مفتاح الدولة
  if left(v_raw, 1) = '0' then return v_prefix || substr(v_raw, 2); end if;
  return v_prefix || v_raw;
end $$;

-- الحارس: يعمل **فقط** إن فعّلته المنشأة
create or replace function app_guard_patient_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare l organization_locale_settings;
begin
  if new.id_number is null or trim(new.id_number) = '' then
    return new;   -- الملف بلا هوية مسموح (طوارئ، رضيع، زائر)
  end if;
  if tg_op = 'UPDATE' and new.id_number is not distinct from old.id_number then
    return new;
  end if;

  l := app_locale(new.organization_id);
  if not l.enforce_id_validation then
    return new;
  end if;

  if not app_validate_national_id(l.country_code, new.id_number) then
    raise exception 'رقم الهوية غير صحيح لدولة % — راجع الرقم', l.country_code;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_patient_identity on patients;
create trigger trg_guard_patient_identity
  before insert or update of id_number on patients
  for each row execute function app_guard_patient_identity();

-- ===========================================================================
-- 3) حفظ الإعدادات
-- ===========================================================================
create or replace function app_save_locale_settings(
  p_org     uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare cur organization_locale_settings; v_bad int;
begin
  if not app_has_permission(p_org, 'policies.manage') then
    raise exception 'صلاحيتك لا تسمح بتعديل إعدادات اللغة والبلد (policies.manage)';
  end if;
  cur := app_locale(p_org);

  -- **لا يُفعَّل التحقّق من الهوية وفي الملفات أرقام لا تجتازه**: التفعيل
  -- حينها يمنع تعديل تلك الملفات لاحقًا بلا أن يفهم أحدٌ لماذا.
  if coalesce((p_changes ->> 'enforce_id_validation')::boolean, false)
     and not cur.enforce_id_validation then
    select count(*) into v_bad from patients
     where organization_id = p_org
       and id_number is not null and trim(id_number) <> ''
       and not app_validate_national_id(
             coalesce(p_changes ->> 'country_code', cur.country_code), id_number);
    if v_bad > 0 then
      raise exception 'لا يُفعَّل التحقّق: % ملفًا يحمل رقم هوية لا يجتاز الفحص — صحّحها أوّلًا', v_bad;
    end if;
  end if;

  insert into organization_locale_settings (
    organization_id, country_code, currency_code, data_language,
    calendar_display, enforce_id_validation, updated_by)
  values (
    p_org,
    upper(coalesce(p_changes ->> 'country_code',    cur.country_code)),
    upper(coalesce(p_changes ->> 'currency_code',   cur.currency_code)),
    coalesce(p_changes ->> 'data_language',         cur.data_language),
    coalesce(p_changes ->> 'calendar_display',      cur.calendar_display),
    coalesce((p_changes ->> 'enforce_id_validation')::boolean, cur.enforce_id_validation),
    auth.uid())
  on conflict (organization_id) do update set
    country_code          = excluded.country_code,
    currency_code         = excluded.currency_code,
    data_language         = excluded.data_language,
    calendar_display      = excluded.calendar_display,
    enforce_id_validation = excluded.enforce_id_validation,
    updated_at = now(), updated_by = auth.uid();

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, auth.uid(), 'settings', 'update', p_org,
          'تعديل إعدادات اللغة والبلد', p_changes::text);
end $$;

-- ===========================================================================
-- 4) المناظير
-- ===========================================================================
drop view if exists v_locale_settings;
create view v_locale_settings
with (security_invoker = on) as
select
  o.id                as organization_id,
  o.name              as organization_name,
  l.country_code,
  l.currency_code,
  l.data_language,
  l.calendar_display,
  l.enforce_id_validation,
  d.vat_rate          as country_default_vat,
  d.phone_prefix,
  (ls.organization_id is not null) as is_customized,
  current_date        as report_date
from organizations o
cross join lateral app_locale(o.id) l
left join organization_locale_settings ls on ls.organization_id = o.id
left join lateral app_country_defaults(l.country_code) d on true;

-- **تغطية الترجمة**: أين ينقص الاسم الإنجليزي فعلًا
drop view if exists v_translation_coverage;
create view v_translation_coverage
with (security_invoker = on) as
select organization_id, 'items'::text as entity, count(*) as total,
       count(*) filter (where coalesce(trim(name_en), '') = '') as missing_en,
       current_date as report_date
from items group by organization_id
union all
select organization_id, 'lab_tests', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from lab_tests group by organization_id
union all
select organization_id, 'radiology_exams', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from radiology_exams group by organization_id
union all
select organization_id, 'clinics', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from clinics group by organization_id
union all
select organization_id, 'doctors', count(*),
       count(*) filter (where coalesce(trim(name_en), '') = ''), current_date
from doctors group by organization_id;

comment on view v_translation_coverage is
  'ما ينقصه الاسم الإنجليزي في كل كتالوج — قبل أن تُشغَّل لغة عرض البيانات بالإنجليزية.';

grant select on v_locale_settings, v_translation_coverage to authenticated;

-- ===========================================================================
-- 5) RLS
-- ===========================================================================
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'organization_locale_settings'
  loop execute format('drop policy %I on organization_locale_settings', pol.policyname); end loop;

  create policy locale_select on organization_locale_settings for select to authenticated
    using (app_is_member(organization_id));
  create policy locale_write on organization_locale_settings for all to authenticated
    using (app_has_permission(organization_id, 'policies.manage'))
    with check (app_has_permission(organization_id, 'policies.manage'));
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_locale','app_save_locale_settings','app_guard_patient_identity')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
begin
  -- خوارزمية الهوية السعودية تُفحص بأرقامٍ معروفة الصحّة والبطلان
  if not app_validate_national_id('SA', '1000000008') then
    raise exception 'خوارزمية التحقّق ترفض رقمًا صحيحًا';
  end if;
  if app_validate_national_id('SA', '1000000000') then
    raise exception 'خوارزمية التحقّق تقبل رقم تحقّق خاطئًا';
  end if;
  if app_validate_national_id('SA', '3000000008') then
    raise exception 'خوارزمية التحقّق تقبل بادئة غير 1 أو 2';
  end if;
  if app_validate_national_id('SA', '100000000') then
    raise exception 'خوارزمية التحقّق تقبل طولًا خاطئًا';
  end if;

  if app_normalize_phone('SA', '0501234567') <> '+966501234567' then
    raise exception 'تطبيع الهاتف السعودي غير صحيح: %',
      app_normalize_phone('SA', '0501234567');
  end if;
  if app_normalize_phone('AE', '0501234567') <> '+971501234567' then
    raise exception 'تطبيع الهاتف الإماراتي غير صحيح';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_patient_identity') then
    raise exception 'حارس رقم الهوية غير مركَّب';
  end if;
  if (select vat_rate from app_country_defaults('SA')) <> 15.0 then
    raise exception 'نسبة الضريبة الافتراضية للسعودية غير صحيحة';
  end if;
end $$;
