-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات مخطّط الأسنان وإجراءاته — 0141
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/dental-odontogram.test.sql
--
-- الرحلة: طبيب يخطّط خلعًا لسنّ وحشوة لآخر ← الخطة تظهر بكلفتها ← ينفّذ
-- الخلع ← تتغيّر حال السنّ وحدها ← يُضاف بند الخدمة للزيارة فيُفوتَر.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_branch  uuid;
  v_doctor  uuid;
  v_clinic  uuid;
  v_patient uuid;
  v_visit   uuid;
  v_extract uuid;
  v_fill    uuid;
  v_clean   uuid;
  v_proc    uuid;
  v_proc2   uuid;
  v_int     int;
  v_num     numeric;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'dent-owner@test.local')
    returning id into v_owner;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organizations (name, organization_type, created_by)
    values ('عيادة اختبار الأسنان', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع', 'DN-1') returning id into v_branch;
  insert into clinics (organization_id, name, code, clinic_type)
    values (v_org, 'عيادة الأسنان', 'CL-DN', 'dental') returning id into v_clinic;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9401, 'د. الأسنان') returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض الأسنان', '1000000008') returning id into v_patient;
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
    returning id into v_visit;

  insert into items (organization_id, code, name_ar, price)
    values (v_org, 'DN-EXT', 'خلع سنّ بسيط', 300) returning id into v_extract;
  insert into items (organization_id, code, name_ar, price)
    values (v_org, 'DN-FIL', 'حشوة تجميلية', 250) returning id into v_fill;
  insert into items (organization_id, code, name_ar, price)
    values (v_org, 'DN-CLN', 'تنظيف وتقليح', 200) returning id into v_clean;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) الخدمة تُوسم بنوع إجراء الأسنان من اسمها تلقائيًّا
  -- ═════════════════════════════════════════════════════════════════════════
  select dental_procedure_kind into v_txt from items where id = v_extract;
  -- `is distinct from` لا `<>`: مقارنة NULL بـ`<>` تُنتج NULL، فالفحص لا
  -- يفشل أبدًا ويمرّ على خدمةٍ بلا وسم — فحصٌ يطمئنك وهو لا يفحص شيئًا.
  if v_txt is distinct from 'extraction' then
    raise exception 'فشل: «خلع سنّ» وُسم % لا extraction', coalesce(v_txt,'فارغ');
  end if;
  select dental_procedure_kind into v_txt from items where id = v_fill;
  if v_txt is distinct from 'filling' then raise exception 'فشل: «حشوة» وُسمت %', coalesce(v_txt,'فارغ'); end if;
  select dental_procedure_kind into v_txt from items where id = v_clean;
  if v_txt is distinct from 'cleaning' then raise exception 'فشل: «تنظيف» وُسمت %', coalesce(v_txt,'فارغ'); end if;
  raise notice '✅ ١) الخدمات القائمة وُسمت بنوع إجرائها من أسمائها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) رقم سنّ غير صالح مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_set_tooth_condition(v_org, v_patient, '19', 'caries');
    raise exception 'فشل: قُبل رقم سنّ 19';
  exception when others then
    if sqlerrm not like '%رقم سنّ غير صالح%' then raise; end if;
  end;
  begin
    perform app_set_tooth_condition(v_org, v_patient, '55', 'caries', 'permanent');
    raise exception 'فشل: قُبل رقم سنّ لبنيّ كدائم';
  exception when others then
    if sqlerrm not like '%رقم سنّ غير صالح%' then raise; end if;
  end;
  raise notice '✅ ٢) أرقام الأسنان محروسة بترقيم FDI';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) وسم حال سنّ يدويًّا، والوسم الثاني يُحدِّث لا يُكرِّر
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_tooth_condition(v_org, v_patient, '16', 'caries', 'permanent',
                                  array['occlusal'], 'تسوّس عميق');
  perform app_set_tooth_condition(v_org, v_patient, '16', 'caries', 'permanent',
                                  array['occlusal','mesial'], 'امتدّ للإنسي');
  select count(*) into v_int from patient_tooth_status
   where patient_id = v_patient and tooth_number = '16';
  if v_int <> 1 then raise exception 'فشل: تكرّر صفّ السنّ 16 (%)', v_int; end if;
  select array_length(surfaces, 1) into v_int from patient_tooth_status
   where patient_id = v_patient and tooth_number = '16';
  if v_int <> 2 then raise exception 'فشل: الأسطح لم تُحدَّث'; end if;
  raise notice '✅ ٣) لكل سنّ صفٌّ واحد يُحدَّث ولا يتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) حالة أو سطح غير معروف مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_set_tooth_condition(v_org, v_patient, '17', 'كذا');
    raise exception 'فشل: قُبلت حالة غير معروفة';
  exception when others then
    if sqlerrm not like '%حالة سنّ غير معروفة%' then raise; end if;
  end;
  begin
    perform app_set_tooth_condition(v_org, v_patient, '17', 'caries', 'permanent',
                                    array['top']);
    raise exception 'فشل: قُبل سطح غير معروف';
  exception when others then
    if sqlerrm not like '%سطح سنّ غير معروف%' then raise; end if;
  end;
  raise notice '✅ ٤) الحالات والأسطح قوائم مغلقة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) خطة: خلع 16 وحشوة 26 — إجراءان لسنّين مختلفين لا جملة واحدة
  -- ═════════════════════════════════════════════════════════════════════════
  select app_plan_tooth_procedures(
    v_org, v_patient,
    jsonb_build_array(
      jsonb_build_object('tooth','16','item_id',v_extract::text,'note','مكسور'),
      jsonb_build_object('tooth','26','item_id',v_fill::text,
                         'surfaces', jsonb_build_array('occlusal'))),
    v_doctor, v_visit, v_branch) into v_int;
  if v_int <> 2 then raise exception 'فشل: خُطِّط % إجراء لا 2', v_int; end if;

  select count(*) into v_int from tooth_procedures
   where patient_id = v_patient and status = 'planned';
  if v_int <> 2 then raise exception 'فشل: عدد المخطَّط % لا 2', v_int; end if;

  select procedure_kind into v_txt from tooth_procedures
   where patient_id = v_patient and tooth_number = '16';
  if v_txt is distinct from 'extraction' then
    raise exception 'فشل: نوع إجراء السنّ 16 % لا extraction', coalesce(v_txt,'فارغ');
  end if;
  raise notice '✅ ٥) لكل سنّ إجراؤه ونوعه — لا جملة واحدة لأسنان مختلفة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) خطة العلاج تظهر بكلفتها
  -- ═════════════════════════════════════════════════════════════════════════
  select planned_items, teeth_count, estimated_total
    into v_int, v_int, v_num
    from v_dental_treatment_plan where patient_id = v_patient;
  if v_num <> 550 then
    raise exception 'فشل: كلفة الخطة % لا 550 (300 خلع + 250 حشوة)', v_num;
  end if;
  raise notice '✅ ٦) خطة العلاج تُحسب كلفتها من أسعار الخدمات (550)';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) التنفيذ: يغيّر حال السنّ المنفَّذ وحده، ويُضيف بند الفوترة
  -- ═════════════════════════════════════════════════════════════════════════
  select id into v_proc from tooth_procedures
   where patient_id = v_patient and tooth_number = '16';
  perform app_complete_tooth_procedure(v_proc, 'خُلع تحت تخدير موضعي', v_visit, true);

  select condition into v_txt from v_patient_odontogram
   where patient_id = v_patient and tooth_number = '16';
  if v_txt is distinct from 'extracted' then
    raise exception 'فشل: حال السنّ 16 % لا extracted', v_txt;
  end if;

  -- السنّ 26 لم يُنفَّذ بعد، فلا يجوز أن تتغيّر حاله.
  select count(*) into v_int from patient_tooth_status
   where patient_id = v_patient and tooth_number = '26';
  if v_int <> 0 then
    raise exception 'فشل: تغيّرت حال سنٍّ لم يُنفَّذ إجراؤه';
  end if;

  select count(*) into v_int from patient_visit_services
   where visit_id = v_visit and item_id = v_extract;
  if v_int <> 1 then raise exception 'فشل: بند الفوترة لم يُضَف للزيارة'; end if;

  select visit_service_id is not null into v_txt from tooth_procedures where id = v_proc;
  if v_txt <> 'true' then raise exception 'فشل: الإجراء لم يُربط ببند الفوترة'; end if;
  raise notice '✅ ٧) التنفيذ يغيّر السنّ المنفَّذ وحده، ويربطه ببند فوترته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) إجراء لا يغيّر الحال لا يفتعل تغييرًا
  -- ═════════════════════════════════════════════════════════════════════════
  select app_plan_tooth_procedures(
    v_org, v_patient,
    jsonb_build_array(jsonb_build_object('tooth','36','item_id',v_clean::text)),
    v_doctor, v_visit, v_branch) into v_int;
  select id into v_proc2 from tooth_procedures
   where patient_id = v_patient and tooth_number = '36';
  perform app_complete_tooth_procedure(v_proc2, null, v_visit, true);

  select count(*) into v_int from patient_tooth_status
   where patient_id = v_patient and tooth_number = '36';
  if v_int <> 0 then
    raise exception 'فشل: التنظيف كتب حالة للسنّ 36 بلا داعٍ';
  end if;
  raise notice '✅ ٨) التنظيف يُسجَّل ويُفوتَر ولا يفتعل حالة للسنّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) لا يُنفَّذ الإجراء مرتين، ولا يُلغى بعد تنفيذه
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_complete_tooth_procedure(v_proc, null, v_visit, true);
    raise exception 'فشل: نُفِّذ إجراء منفَّذ سلفًا';
  exception when others then
    if sqlerrm not like '%منفَّذ سلفًا%' then raise; end if;
  end;
  begin
    perform app_cancel_tooth_procedure(v_proc, 'تراجعنا');
    raise exception 'فشل: أُلغي إجراء منفَّذ';
  exception when others then
    if sqlerrm not like '%منفَّذ — لا يُلغى%' then raise; end if;
  end;
  raise notice '✅ ٩) المنفَّذ لا يُعاد ولا يُمحى — الأثر السريري يبقى';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) الإلغاء قبل التنفيذ يُخرجه من الخطة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_p3 uuid;
  begin
    select id into v_p3 from tooth_procedures
     where patient_id = v_patient and tooth_number = '26';
    perform app_cancel_tooth_procedure(v_p3, 'المريض رفض');
    select count(*) into v_int from tooth_procedures
     where patient_id = v_patient and status = 'planned';
    if v_int <> 0 then raise exception 'فشل: الملغى ما زال في الخطة'; end if;
  end;
  raise notice '✅ ١٠) الإلغاء قبل التنفيذ يُخرج الإجراء من الخطة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) تاريخ السنّ يُقرأ بإجراءاته لا بجملة
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_tooth_procedure_history
   where patient_id = v_patient and tooth_number = '16' and status = 'completed';
  if v_int <> 1 then raise exception 'فشل: تاريخ السنّ 16 فارغ'; end if;
  select item_name into v_txt from v_tooth_procedure_history
   where patient_id = v_patient and tooth_number = '16' and status = 'completed';
  if v_txt is distinct from 'خلع سنّ بسيط' then
    raise exception 'فشل: اسم الخدمة لم يصل التاريخ';
  end if;
  raise notice '✅ ١١) تاريخ كل سنّ يُقرأ بإجراءاته وخدماتها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) العزل بين المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_org2 uuid; v_pat2 uuid;
  begin
    insert into organizations (name, organization_type, created_by)
      values ('عيادة أخرى', 'medical_center', v_owner) returning id into v_org2;
    insert into patients (organization_id, name_ar, id_number)
      values (v_org2, 'مريض غريب', '2038475618') returning id into v_pat2;
    begin
      perform app_set_tooth_condition(v_org, v_pat2, '11', 'caries');
      raise exception 'فشل: وُسم سنّ لمريض من منشأة أخرى';
    exception when others then
      if sqlerrm not like '%غير موجود في هذه المنشأة%' then raise; end if;
    end;
  end;
  raise notice '✅ ١٢) لا يُمسّ سنّ مريضٍ من منشأة أخرى';

  raise notice '——— كل فحوص مخطّط الأسنان نجحت ———';
end $$;

rollback;
