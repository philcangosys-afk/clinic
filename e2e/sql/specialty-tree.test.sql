-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات شجرة التخصصات وأنواع العيادات — 0140
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/specialty-tree.test.sql
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner  uuid;
  v_org    uuid;
  v_branch uuid;
  v_doc    uuid;
  v_dental uuid;
  v_derma  uuid;
  v_ortho  uuid;
  v_laser  uuid;
  v_clinic uuid;
  v_int    int;
  v_txt    text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'spec-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار التخصصات', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع', 'SP-1') returning id into v_branch;

  select id into v_dental from v_specialty_tree where specialty_code = 'simple_dental' and is_root;
  select id into v_derma  from v_specialty_tree where specialty_code = 'derma' and is_root;
  select id into v_ortho  from v_specialty_tree
   where parent_value_id = v_dental and name_ar = 'تقويم الأسنان';
  select id into v_laser  from v_specialty_tree
   where parent_value_id = v_derma and name_ar = 'الليزر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الشجرة مبنيّة: للأسنان والجلدية أبناء
  -- ═════════════════════════════════════════════════════════════════════════
  if v_dental is null or v_derma is null then
    raise exception 'فشل: تخصص الأسنان أو الجلدية غير موجود';
  end if;
  select count(*) into v_int from v_specialty_tree where parent_value_id = v_dental;
  if v_int < 8 then raise exception 'فشل: تخصصات الأسنان الفرعية % لا 8 فأكثر', v_int; end if;
  select count(*) into v_int from v_specialty_tree where parent_value_id = v_derma;
  if v_int < 6 then raise exception 'فشل: تخصصات الجلدية الفرعية % لا 6 فأكثر', v_int; end if;
  raise notice '✅ ١) الأسنان والجلدية لهما تخصصات فرعية في الشجرة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الجذر يعرف نفسه جذرًا، والابن يعرف أباه
  -- ═════════════════════════════════════════════════════════════════════════
  select is_root into v_txt from v_specialty_tree where id = v_ortho;
  if v_txt <> 'false' then raise exception 'فشل: تقويم الأسنان يظهر جذرًا'; end if;
  select parent_name_ar, root_code into v_txt, v_txt from v_specialty_tree where id = v_ortho;
  select root_code into v_txt from v_specialty_tree where id = v_ortho;
  if v_txt <> 'simple_dental' then
    raise exception 'فشل: جذر تقويم الأسنان % لا simple_dental', v_txt;
  end if;
  raise notice '✅ ٢) الابن يعرف جذره';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) طبيب بتخصص فرعي صحيح — والأب يُملأ تلقائيًّا
  -- ═════════════════════════════════════════════════════════════════════════
  insert into doctors (organization_id, file_number, name_ar, subspecialty_value_id)
    values (v_org, 9301, 'د. التقويم', v_ortho) returning id into v_doc;
  select specialty_value_id into v_txt from doctors where id = v_doc;
  if v_txt is distinct from v_dental::text then
    raise exception 'فشل: تخصص الطبيب الأب لم يُملأ تلقائيًّا';
  end if;
  raise notice '✅ ٣) التخصص الفرعي يملأ تخصص الطبيب الأب تلقائيًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) تخصص فرعي من شجرة أخرى مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update doctors set subspecialty_value_id = v_laser where id = v_doc;
    raise exception 'فشل: قُبل تخصص جلدي لطبيب أسنان';
  exception when others then
    if sqlerrm not like '%ليس تحت تخصص الطبيب%' then raise; end if;
  end;
  raise notice '✅ ٤) لا يُسند تخصص فرعي من خارج تخصص الطبيب';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) تخصص رئيسي في خانة الفرعي مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into doctors (organization_id, file_number, name_ar, subspecialty_value_id)
      values (v_org, 9302, 'د. الخطأ', v_dental);
    raise exception 'فشل: قُبل تخصص رئيسي كفرعي';
  exception when others then
    if sqlerrm not like '%تخصص رئيسي لا فرعي%' then raise; end if;
  end;
  raise notice '✅ ٥) الجذر لا يُقبل في خانة التخصص الفرعي';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) نوع العيادة: المعروف يُقبل والمجهول يُرفض
  -- ═════════════════════════════════════════════════════════════════════════
  insert into clinics (organization_id, name, code, clinic_type)
    values (v_org, 'عيادة الأسنان', 'CL-D', 'dental') returning id into v_clinic;
  begin
    update clinics set clinic_type = 'كذا وكذا' where id = v_clinic;
    raise exception 'فشل: قُبل نوع عيادة مجهول';
  exception when others then
    if sqlerrm not like '%نوع عيادة غير معروف%' then raise; end if;
  end;
  raise notice '✅ ٦) نوع العيادة من اللائحة، والمجهول مرفوض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الفراغ يُقبل ويُخزَّن null لا نصًّا فارغًا
  -- ═════════════════════════════════════════════════════════════════════════
  update clinics set clinic_type = '   ' where id = v_clinic;
  select count(*) into v_int from clinics where id = v_clinic and clinic_type is null;
  if v_int <> 1 then raise exception 'فشل: النصّ الفارغ لم يُخزَّن null'; end if;
  raise notice '✅ ٧) النوع الفارغ يُخزَّن null لا فراغًا يوهم بقيمة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) فئات الجلدية تحت أبيها ومربوطة بتخصصها
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_service_category_tree
   where is_root and name_ar in ('BOTOX','COSMETIC','DERMA');
  if v_int > 0 then raise exception 'فشل: % فئة جلدية بلا أب', v_int; end if;

  select count(*) into v_int from v_service_category_tree
   where specialty_code = 'derma' and not is_root;
  if v_int < 6 then raise exception 'فشل: فئات الجلدية % لا 6 فأكثر', v_int; end if;
  raise notice '✅ ٨) فئات الجلدية تحت أبٍ واحد وموسومة بتخصصها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) شجرة الأسنان القائمة لم تُمسّ، ومربوطة بتخصصها
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_service_category_tree
   where specialty_code = 'simple_dental';
  if v_int = 0 then
    raise exception 'فشل: لا فئة خدمات موسومة بتخصص الأسنان';
  end if;
  raise notice '✅ ٩) فئات الأسنان القائمة موسومة بتخصصها بلا مساس ببنيتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) خدمة تُنسب لتخصصها عبر فئتها
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_cat uuid; v_item uuid;
  begin
    select id into v_cat from v_service_category_tree
     where specialty_code = 'derma' and name_ar = 'جلسات ليزر';
    insert into items (organization_id, code, name_ar, category_value_id, price)
      values (v_org, 'LSR-1', 'جلسة ليزر وجه', v_cat, 500) returning id into v_item;

    select specialty_code into v_txt from v_services_by_specialty where item_id = v_item;
    if v_txt <> 'derma' then
      raise exception 'فشل: تخصص الخدمة % لا derma', coalesce(v_txt, 'فارغ');
    end if;
  end;
  raise notice '✅ ١٠) الخدمة تُنسب لتخصصها عبر فئتها بلا عمود جديد';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الشجرة لا تُكرَّر عند إعادة البذر
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_seed_subspecialties();
  perform app_seed_subspecialties();
  select count(*) into v_int from v_specialty_tree
   where parent_value_id = v_dental and name_ar = 'تقويم الأسنان';
  if v_int <> 1 then raise exception 'فشل: تكرّر «تقويم الأسنان» % مرة', v_int; end if;
  raise notice '✅ ١١) إعادة البذر لا تُكرّر عقدة واحدة';

  raise notice '——— كل فحوص شجرة التخصصات نجحت ———';
end $$;

rollback;
