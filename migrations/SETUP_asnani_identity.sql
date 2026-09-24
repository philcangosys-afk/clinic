-- ============================================================================
-- SETUP — هوية المنشأة وبياناتها الضريبية: مجمع أسناني المتميز الطبي
-- ============================================================================
--
-- ليست ترقيةً في التسلسل: بياناتُ منشأةٍ بعينها لا بنيةُ نظام. تُنفَّذ مرّةً
-- على قاعدة هذا المجمع وحدها، وإعادةُ تنفيذها لا تضرّ.
--
-- المصدر: شهادة تسجيل ضريبة القيمة المضافة (هيئة الزكاة والضريبة والجمارك،
-- 10/08/2026) وإثبات العنوان الوطني.
--
--   الاسم            مجمع أسناني المتميز الطبي
--   الرقم الضريبي    314948261800003   (نفاذ التسجيل 2026-09-01)
--   السجل التجاري    7054947911
--   العنوان الوطني   الطائف — حي الجفيجيف — طريق الملك خالد
--                    مبنى 4601، رقم فرعي 8576، رمز بريدي 26523 (TADB4601)
--
-- **الرقم الضريبي هنا للفاتورة لا لـ ZATCA:** تهيئة الأجهزة وشهاداتها تُدخَل
-- من شاشة «الربط مع ZATCA» لأنّها تولّد مفتاحًا خاصًّا لا يمرّ في ترقية.
-- ============================================================================

begin;

do $$
declare
  v_org    uuid;
  v_branch uuid;
begin
  -- المنشأة تُلتقط باسمها القديم أو بكونها الوحيدة — لا يُخمَّن معرّفٌ ثابت
  select id into v_org from public.organizations
   where name in ('مجمع زين الطبي', 'مجمع أسناني المتميز الطبي')
   order by created_at limit 1;

  if v_org is null then
    select id into v_org from public.organizations order by created_at limit 1;
  end if;
  if v_org is null then
    raise exception 'لا توجد منشأة في هذه القاعدة';
  end if;

  update public.organizations
     set name       = 'مجمع أسناني المتميز الطبي',
         tax_number = '314948261800003',
         updated_at = now()
   where id = v_org;

  -- بادئة الرقم الوظيفي (0184) — تُضبط إن كانت الترقية قد نُفِّذت
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'organizations'
       and column_name = 'employee_code_prefix'
  ) then
    execute 'update public.organizations set employee_code_prefix = $1 where id = $2'
      using 'ASN', v_org;
  end if;

  -- الفرع الرئيسي: عنوانه الوطنيّ هو ما يُطبع على الفاتورة الضريبية
  select id into v_branch from public.branches
   where organization_id = v_org and is_main
   order by created_at limit 1;
  if v_branch is null then
    select id into v_branch from public.branches
     where organization_id = v_org order by created_at limit 1;
  end if;

  if v_branch is not null then
    update public.branches
       set name              = 'الفرع الرئيسي — الطائف',
           city              = 'الطائف',
           district          = 'حي الجفيجيف',
           street_name       = 'طريق الملك خالد',
           building_number   = '4601',
           additional_number = '8576',
           postal_code       = '26523',
           cr_number         = '7054947911',
           address           = 'الطائف، حي الجفيجيف، طريق الملك خالد، مبنى 4601، رمز بريدي 26523',
           updated_at        = now()
     where id = v_branch;
  end if;

  -- ══ إعدادات الضريبة ══════════════════════════════════════════════════════
  -- **الحالة تصير `registered`:** المنشأة مسجّلة فعلًا منذ 2026-09-01، ولا
  -- تصدر فاتورة ضريبية إلّا لمسجّلة.
  insert into public.organization_vat_settings (
    organization_id, sales_vat_enabled, purchase_vat_enabled, print_price_with_vat,
    legal_name_ar, legal_name_en, vat_status, vat_registration_number,
    vat_registration_date, cr_number, default_vat_rate,
    building_number, street_name, district, city, postal_code, additional_number,
    country_code, default_document_type, numbering_scope, invoice_number_prefix
  ) values (
    v_org, true, true, true,
    'مجمع أسناني المتميز الطبي', 'Asnani Almutamayez Medical Complex',
    'registered', '314948261800003',
    date '2026-09-01', '7054947911', 15,
    '4601', 'طريق الملك خالد', 'حي الجفيجيف', 'الطائف', '26523', '8576',
    'SA', 'simplified', 'organization', 'ASN'
  )
  on conflict (organization_id) do update set
    legal_name_ar           = excluded.legal_name_ar,
    legal_name_en           = excluded.legal_name_en,
    vat_status              = excluded.vat_status,
    vat_registration_number = excluded.vat_registration_number,
    vat_registration_date   = excluded.vat_registration_date,
    cr_number               = excluded.cr_number,
    default_vat_rate        = excluded.default_vat_rate,
    building_number         = excluded.building_number,
    street_name             = excluded.street_name,
    district                = excluded.district,
    city                    = excluded.city,
    postal_code             = excluded.postal_code,
    additional_number       = excluded.additional_number,
    country_code            = excluded.country_code,
    invoice_number_prefix   = excluded.invoice_number_prefix;

  -- ══ ترويسة الطباعة ═══════════════════════════════════════════════════════
  if to_regclass('public.print_settings') is not null then
    if exists (select 1 from public.print_settings where organization_id = v_org) then
      update public.print_settings
         set invoice_address_line = 'الطائف — حي الجفيجيف — طريق الملك خالد — مبنى 4601 — الرمز البريدي 26523'
       where organization_id = v_org;
    else
      insert into public.print_settings (organization_id, invoice_address_line)
      values (v_org, 'الطائف — حي الجفيجيف — طريق الملك خالد — مبنى 4601 — الرمز البريدي 26523');
    end if;
  end if;

  raise notice 'هوية المنشأة ضُبطت: مجمع أسناني المتميز الطبي (%)', v_org;
end $$;

-- تحقّق: ما كُتب هو ما في الشهادة
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from public.organization_vat_settings
   where vat_registration_number = '314948261800003'
     and cr_number = '7054947911'
     and vat_status = 'registered';
  if v_bad = 0 then
    raise exception 'لم تُكتب بيانات الضريبة — راجع ما سبق';
  end if;
end $$;

commit;
