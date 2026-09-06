-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ بيانات وهمية للتحقّق من القواعد ثم يتراجع عنها (begin … rollback) ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات 0146: اللوائح المرجعية، وتفرّد رقم الهوية، وأكواد الخدمات القصيرة.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/patient-file-essentials.test.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_org2    uuid;
  v_p1      uuid;
  v_p2      uuid;
  v_svc     uuid;
  v_prod    uuid;
  v_int     int;
  v_txt     text;
  v_file    bigint;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pf-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار 0146', 'medical_center', v_owner) returning id into v_org;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة أخرى 0146', 'medical_center', v_owner) returning id into v_org2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) قائمة الجنسيات تحمل «سعودي» وقائمة معتبرة
  --    كانت الفئة موجودة وقائمتها شبه فارغة، فحقل الجنسية في ملف المريض
  --    لا يعرض أشيع جنسية في المملكة.
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int
    from lookup_values lv join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'nationalities' and lc.organization_id is null;
  if v_int < 50 then
    raise exception 'فشل: الجنسيات % قيمة فقط', v_int;
  end if;
  if not exists (
    select 1 from lookup_values lv join lookup_categories lc on lc.id = lv.category_id
     where lc.key = 'nationalities' and btrim(lv.name_ar) = 'سعودي' and not lv.is_disabled
  ) then
    raise exception 'فشل: «سعودي» غائبة عن قائمة الجنسيات';
  end if;
  -- والمدن كذلك: مرشّح المدينة في شاشة المرضى يقارن معرّف قيمة لا نصًّا
  select count(*) into v_int
    from lookup_values lv join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'cities';
  if v_int < 20 then
    raise exception 'فشل: المدن % قيمة فقط', v_int;
  end if;
  raise notice '✅ ١) الجنسيات والمدن مزروعة وتحمل «سعودي»';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) رقم هوية واحد لملف واحد في المنشأة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض الهوية الأول', '1122334455') returning id into v_p1;

  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'مريض الهوية الثاني', '1122334455');
    raise exception 'فشل: فُتح ملف ثانٍ بنفس رقم الهوية';
  exception when others then
    if sqlerrm not like '%مسجَّل في الملف رقم%' then raise; end if;
  end;

  -- المسافات الزائدة لا تُنتج ملفًا ثانيًا (التطبيع بـbtrim في المُحفِّز)
  begin
    insert into patients (organization_id, name_ar, id_number)
      values (v_org, 'مريض بمسافة', '  1122334455 ');
    raise exception 'فشل: مسافة زائدة تجاوزت منع التكرار';
  exception when others then
    if sqlerrm not like '%مسجَّل في الملف رقم%' then raise; end if;
  end;

  -- ونفس الرقم في منشأة أخرى مقبول: العزل بين المنشآت لا يمنع مريضًا من
  -- زيارة مركزَين
  insert into patients (organization_id, name_ar, id_number)
    values (v_org2, 'نفس الشخص في منشأة أخرى', '1122334455');

  -- والمولود الجديد بلا هوية: أكثر من ملف بلا رقم مقبول
  insert into patients (organization_id, name_ar, id_number, is_newborn)
    values (v_org, 'مولود أ', null, true);
  insert into patients (organization_id, name_ar, id_number, is_newborn)
    values (v_org, 'مولود ب', null, true);
  raise notice '✅ ٢) رقم الهوية فريد داخل المنشأة، ومسموح بلا رقم وفي منشأة أخرى';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) الملف المدموج لا يحجز رقم الهوية
  --    بعد الدمج يبقى الملف القديم للتاريخ، ولو حجز الرقم لتعذّر تصحيح
  --    الرقم في الملف الباقي.
  -- ═════════════════════════════════════════════════════════════════════════
  update patients set merged_into_id = v_p1, merged_at = now() where name_ar = 'مولود أ';
  update patients set id_number = '9988776655' where name_ar = 'مولود أ';
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض يأخذ رقم ملف مدموج', '9988776655') returning id into v_p2;
  raise notice '✅ ٣) الملف المدموج لا يحجز رقم الهوية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الفحص المسبق من الواجهة يُعيد الملف القائم برقمه واسمه
  -- ═════════════════════════════════════════════════════════════════════════
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_owner, 'owner', true)
    on conflict do nothing;

  select file_number into v_file
    from app_patient_by_id_number(v_org, ' 1122334455 ', null);
  if v_file is null then
    raise exception 'فشل: الفحص المسبق لم يجد الملف القائم برقم الهوية';
  end if;
  -- واستثناء الملف نفسه شرطٌ للتعديل: بلا ذلك يشتكي الملف من نفسه
  select count(*) into v_int
    from app_patient_by_id_number(v_org, '1122334455', v_p1);
  if v_int <> 0 then
    raise exception 'فشل: الفحص المسبق طابق الملف نفسه (% صفًا)', v_int;
  end if;
  raise notice '✅ ٤) الفحص المسبق يجد الملف القائم ويستثني الملف نفسه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الأكواد القصيرة: رقمان أو ثلاثة، لا تكرار مع المنتجات
  -- ═════════════════════════════════════════════════════════════════════════
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, '10', 'منتج يحجز الكود ١٠', 'product', 5) returning id into v_prod;

  select app_next_short_item_code(v_org) into v_txt;
  if v_txt <> '11' then
    raise exception 'فشل: الكود الحرّ التالي % لا 11 (الكود 10 محجوز لمنتج)', v_txt;
  end if;

  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, 'SRV-CONSULT-0001', 'استشارة', 'service', 150) returning id into v_svc;
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, '99', 'خدمة بكود قصير أصلًا', 'service', 80);
  insert into items (organization_id, code, name_ar, item_type, price)
    values (v_org, 'PROD-LONG-CODE', 'منتج بكود طويل', 'product', 20);

  select app_renumber_service_codes(v_org) into v_int;
  if v_int <> 1 then
    raise exception 'فشل: أُعيد ترقيم % خدمة لا 1', v_int;
  end if;

  select code into v_txt from items where id = v_svc;
  if v_txt !~ '^[0-9]{2,3}$' then
    raise exception 'فشل: كود الخدمة بعد الترقيم % ليس رقمًا من رقمين أو ثلاثة', v_txt;
  end if;
  select legacy_code into v_txt from items where id = v_svc;
  if v_txt <> 'SRV-CONSULT-0001' then
    raise exception 'فشل: الكود القديم لم يُحفظ (%)', coalesce(v_txt, 'null');
  end if;
  -- الخدمة التي كودها قصير أصلًا لا تُرقَّم ثانيةً، والمنتج لا يُمَسّ
  select code into v_txt from items where organization_id = v_org and name_ar = 'خدمة بكود قصير أصلًا';
  if v_txt <> '99' then
    raise exception 'فشل: تغيّر كود خدمة قصير أصلًا إلى %', v_txt;
  end if;
  select code into v_txt from items where organization_id = v_org and name_ar = 'منتج بكود طويل';
  if v_txt <> 'PROD-LONG-CODE' then
    raise exception 'فشل: تغيّر كود منتج (%) — الترقيم للخدمات وحدها', v_txt;
  end if;
  raise notice '✅ ٥) أكواد الخدمات قصيرة، والكود القديم محفوظ، والمنتجات لا تُمَسّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) علَم تاريخ الميلاد التقديريّ موجود وافتراضه «موثَّق»
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patients (organization_id, name_ar, id_number, birth_date, birth_date_is_estimated)
    values (v_org, 'مريض بعمر مُدخَل', '5511223344', current_date - interval '30 years', true);
  if not exists (
    select 1 from patients
     where organization_id = v_org and name_ar = 'مريض بعمر مُدخَل' and birth_date_is_estimated
  ) then
    raise exception 'فشل: علَم التاريخ التقديريّ لم يُحفظ';
  end if;
  if exists (select 1 from patients where id = v_p1 and birth_date_is_estimated) then
    raise exception 'فشل: التاريخ يُعَدّ تقديريًا بالافتراض';
  end if;
  raise notice '✅ ٦) العمر المُدخَل يُوسَم تقديريًا ولا يُخلط بتاريخ موثَّق';

  raise notice '——— كل فحوص 0146 نجحت ———';
end $$;

rollback;
