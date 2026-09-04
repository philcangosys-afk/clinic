-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات اللغة والبلد والتحقّق من الهوية — 0109
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/locale-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- الخطر: تفعيل تحقّقٍ يرفض ملفات قائمة فجأة، أو ادّعاء تحقّقٍ لا أساس له.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org    uuid;
  v_owner  uuid;
  v_p      uuid;
  v_int    integer;
  v_txt    text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'lo-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار اللغة', 'medical_center', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الافتراضات: السعودية والريال والعربية والميلادي وبلا فرض تحقّق
  -- ═════════════════════════════════════════════════════════════════════════
  if (app_locale(v_org)).country_code <> 'SA' then
    raise exception 'فشل: البلد الافتراضي ليس السعودية';
  end if;
  if (app_locale(v_org)).enforce_id_validation then
    raise exception 'فشل: فرض التحقّق من الهوية مفعَّل افتراضًا';
  end if;
  if (select country_default_vat from v_locale_settings where organization_id = v_org) <> 15.0 then
    raise exception 'فشل: نسبة الضريبة الافتراضية للسعودية ليست 15';
  end if;
  raise notice '✅ ١) الافتراضات سعودية والتحقّق معطَّل حتى يُفعَّل صراحةً';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) **خوارزمية الهوية السعودية حقيقية**: تقبل الصحيح وترفض الباطل
  -- ═════════════════════════════════════════════════════════════════════════
  if not app_validate_national_id('SA', '1000000008') then
    raise exception 'فشل: رُفض رقم هوية صحيح';
  end if;
  if not app_validate_national_id('SA', '2038475618') then
    raise exception 'فشل: رُفض رقم إقامة صحيح';
  end if;
  if app_validate_national_id('SA', '2038475617') then
    raise exception 'فشل: قُبل رقم تحقّقه خاطئ';
  end if;
  if app_validate_national_id('SA', '3038475618') then
    raise exception 'فشل: قُبلت بادئة ليست 1 ولا 2';
  end if;
  if app_validate_national_id('SA', '203847561') then
    raise exception 'فشل: قُبل رقم من تسع خانات';
  end if;
  -- الفواصل والمسافات تُنظَّف قبل الفحص
  if not app_validate_national_id('SA', '2038-4756-18') then
    raise exception 'فشل: رُفض رقم صحيح مكتوب بفواصل';
  end if;
  raise notice '✅ ٢) خوارزمية الهوية السعودية تقبل الصحيح وترفض الباطل والمشوّه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) بقيّة الخليج: فحص طول فقط — ولا يُدّعى أكثر
  -- ═════════════════════════════════════════════════════════════════════════
  if not app_validate_national_id('AE', '784198512345678') then
    raise exception 'فشل: رُفض رقم إماراتي بطوله الصحيح (15)';
  end if;
  if app_validate_national_id('AE', '78419851234') then
    raise exception 'فشل: قُبل رقم إماراتي بطول خاطئ';
  end if;
  if not app_validate_national_id('BH', '123456789') then
    raise exception 'فشل: رُفض رقم بحريني بطوله الصحيح (9)';
  end if;
  raise notice '✅ ٣) دول الخليج الأخرى تُفحص بالطول فقط كما هو معلن';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) تطبيع الهاتف بحسب البلد
  -- ═════════════════════════════════════════════════════════════════════════
  if app_normalize_phone('SA', '0501234567') <> '+966501234567' then
    raise exception 'فشل: تطبيع الرقم المحلي السعودي';
  end if;
  if app_normalize_phone('SA', '00966501234567') <> '+966501234567' then
    raise exception 'فشل: تطبيع الصيغة الدولية بصفرين';
  end if;
  if app_normalize_phone('SA', '+966501234567') <> '+966501234567' then
    raise exception 'فشل: الرقم الدولي تغيّر بلا داعٍ';
  end if;
  if app_normalize_phone('KW', '051234567') <> '+96551234567' then
    raise exception 'فشل: تطبيع الرقم الكويتي (%)', app_normalize_phone('KW', '051234567');
  end if;
  if app_normalize_phone('SA', '   ') is not null then
    raise exception 'فشل: الفراغ أنتج رقمًا';
  end if;
  raise notice '✅ ٤) تطبيع الهاتف يحترم مفتاح كل دولة ويقبل صيغه الثلاث';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) **بلا تفعيل لا منع**: رقم خاطئ يُقبل ما دام التحقّق معطَّلًا
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض برقم خاطئ', '1111111111') returning id into v_p;
  if v_p is null then
    raise exception 'فشل: مُنع رقم خاطئ والتحقّق معطَّل';
  end if;
  raise notice '✅ ٥) التحقّق المعطَّل لا يمنع شيئًا — الملفات القائمة آمنة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) **لا يُفعَّل التحقّق وفي الملفات ما لا يجتازه**
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_save_locale_settings(v_org, jsonb_build_object('enforce_id_validation', true));
    raise exception 'فشل: فُعّل التحقّق رغم وجود أرقام لا تجتازه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%صحّحها أوّلًا%' then raise; end if;
  end;

  -- بعد تصحيح الرقم يُقبل التفعيل
  update patients set id_number = '1000000008' where id = v_p;
  perform app_save_locale_settings(v_org, jsonb_build_object('enforce_id_validation', true));
  if not (app_locale(v_org)).enforce_id_validation then
    raise exception 'فشل: لم يُفعَّل التحقّق بعد التصحيح';
  end if;
  raise notice '✅ ٦) التفعيل يفشل ما دامت هناك أرقام لا تجتازه، وينجح بعد تصحيحها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) بعد التفعيل: الرقم الخاطئ يُرفض، والملف بلا هوية يُقبل
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'مريض جديد', '1234567890');
    raise exception 'فشل: قُبل رقم هوية خاطئ بعد التفعيل';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%رقم الهوية غير صحيح%' then raise; end if;
  end;

  -- **الطوارئ والرضّع والزوّار بلا هوية**: الملف بلا رقم يُقبل دائمًا
  declare v_p2 uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'مجهول الهوية')
      returning id into v_p2;
    if v_p2 is null then
      raise exception 'فشل: مُنع فتح ملف بلا رقم هوية';
    end if;
  end;
  raise notice '✅ ٧) بعد التفعيل يُرفض الخاطئ ويبقى الملف بلا هوية ممكنًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) تغيير البلد يغيّر قاعدة التحقّق
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_save_locale_settings(v_org, jsonb_build_object(
    'country_code', 'AE', 'currency_code', 'AED'));
  declare v_p3 uuid;
  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'مقيم إماراتي', '784198512345678') returning id into v_p3;
    if v_p3 is null then
      raise exception 'فشل: رُفض رقم إماراتي صحيح بعد تغيير البلد';
    end if;
  end;
  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'رقم سعودي في منشأة إماراتية', '1000000008');
    raise exception 'فشل: قُبل رقم بطول سعودي والبلد إماراتي';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%رقم الهوية غير صحيح%' then raise; end if;
  end;
  if (select country_default_vat from v_locale_settings where organization_id = v_org) <> 5.0 then
    raise exception 'فشل: نسبة الضريبة لم تتبع البلد الجديد';
  end if;
  raise notice '✅ ٨) تغيير البلد يغيّر قاعدة الهوية والعملة ونسبة الضريبة المقترحة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) تغطية الترجمة تُحصي ما ينقصه الاسم الإنجليزي
  -- ═════════════════════════════════════════════════════════════════════════
  insert into items (organization_id, item_type, code, name_ar, name_en, price)
    values (v_org, 'service', 'TR1', 'كشف', 'Consultation', 100);
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'TR2', 'متابعة', 80);

  select missing_en into v_int from v_translation_coverage
   where organization_id = v_org and entity = 'items';
  if coalesce(v_int, 0) <> 1 then
    raise exception 'فشل: عدّاد الترجمة الناقصة % بدل 1', v_int;
  end if;
  select total into v_int from v_translation_coverage
   where organization_id = v_org and entity = 'items';
  if coalesce(v_int, 0) <> 2 then
    raise exception 'فشل: إجمالي الأصناف % بدل 2', v_int;
  end if;
  raise notice '✅ ٩) تغطية الترجمة تُحصي الناقص من الإجمالي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) التعديل محميّ بصلاحيته وموثَّق
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_stranger uuid; v_org2 uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'lo-other@test.local')
      returning id into v_stranger;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'medical_center', v_stranger) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_stranger::text, true);
    begin
      perform app_save_locale_settings(v_org, jsonb_build_object('country_code', 'KW'));
      raise exception 'فشل: عدّل غريبٌ إعدادات منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%policies.manage%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  if not exists (select 1 from audit_log
                  where organization_id = v_org
                    and entity_title = 'تعديل إعدادات اللغة والبلد') then
    raise exception 'فشل: تعديل الإعدادات لم يدخل سجل التدقيق';
  end if;
  raise notice '✅ ١٠) التعديل محميّ بصلاحيته ومسجَّل في التدقيق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) التعديل الجزئي لا يمسّ بقية الإعدادات
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_save_locale_settings(v_org, jsonb_build_object('data_language', 'en'));
  if (app_locale(v_org)).country_code <> 'AE' then
    raise exception 'فشل: تعديل اللغة أعاد البلد إلى الافتراض';
  end if;
  if not (app_locale(v_org)).enforce_id_validation then
    raise exception 'فشل: تعديل اللغة ألغى فرض التحقّق';
  end if;
  raise notice '✅ ١١) التعديل الجزئي يحفظ بقية الإعدادات';

  raise notice '——— كل فحوص اللغة والبلد نجحت ———';
end $$;

rollback;
