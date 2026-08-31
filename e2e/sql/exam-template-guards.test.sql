-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات نماذج الفحص السريري — 0085
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/exam-template-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- اثنا عشر فحصًا: `schema_definition` يُبنى تلقائيًا ويبقى مطابقًا، الحقل
-- الشرطي من النموذج نفسه، الحقل لا يكون شرطًا لظهور نفسه، القسم من النموذج
-- نفسه، الزيارة تلتقط نسخة النموذج مرة واحدة، تعديل النموذج لا يغيّر النسخة
-- الملتقطة، تغيير مفتاح حقلٍ مستعمَل مرفوض، النسخ ينقل الأقسام والحقول
-- والخيارات والشروط، والصلاحيات.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_recep   uuid;
  v_patient uuid;
  v_doctor  uuid;
  v_tpl     uuid;
  v_tpl2    uuid;
  v_sec     uuid;
  v_sec_b   uuid;
  v_f1      uuid;
  v_f2      uuid;
  v_visit   uuid;
  v_json    jsonb;
  v_snap    jsonb;
  v_int     int;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'tpl-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'tpl-recep@test.local')
    returning id into v_recep;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار النماذج', 'clinic', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_recep, 'receptionist', true);
  insert into patients (organization_id, name_ar) values (v_org, 'مريض النماذج')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب النماذج')
    returning id into v_doctor;

  insert into clinic_exam_templates (organization_id, specialty_code, name_ar, canvas_type,
                                     schema_definition)
    values (v_org, 'general', 'نموذج الباطنة', 'none', '{"sections":[]}'::jsonb)
    returning id into v_tpl;

  -- ── 1) الأقسام والحقول
  insert into exam_template_sections (organization_id, template_id, key, name_ar, sort_order)
    values (v_org, v_tpl, 'general', 'الفحص العام', 1) returning id into v_sec;
  insert into exam_template_sections (organization_id, template_id, key, name_ar, sort_order)
    values (v_org, v_tpl, 'extra', 'تفاصيل إضافية', 2) returning id into v_sec_b;

  insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar,
                                    field_type, is_required, sort_order)
    values (v_org, v_tpl, v_sec, 'has_pain', 'يشكو من ألم؟', 'yes_no', true, 1)
    returning id into v_f1;

  insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar,
                                    field_type, unit, min_value, max_value, sort_order,
                                    visible_when_field_id, visible_when_value)
    values (v_org, v_tpl, v_sec_b, 'pain_score', 'شدة الألم', 'number', 'من ١٠', 0, 10, 1,
            v_f1, 'yes')
    returning id into v_f2;
  raise notice '✅ الأقسام والحقول والإظهار الشرطي';

  -- ── 2) `schema_definition` يُبنى تلقائيًا
  select schema_definition into v_json from clinic_exam_templates where id = v_tpl;
  if jsonb_array_length(v_json -> 'sections') <> 2 then
    raise exception 'فشل: المخطط لم يُبنَ (%)', v_json;
  end if;
  if v_json #>> '{sections,0,fields,0,key}' <> 'has_pain' then
    raise exception 'فشل: الحقل الأول ليس has_pain (%)', v_json #>> '{sections,0,fields,0,key}';
  end if;
  if v_json #>> '{sections,1,fields,0,visible_when,field}' <> 'has_pain' then
    raise exception 'فشل: الشرط لم يظهر في المخطط';
  end if;
  raise notice '✅ schema_definition يُبنى من الجداول ولا يُحرَّر يدويًا';

  -- ── 3) الخيارات تدخل المخطط
  insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar,
                                    field_type, sort_order)
    values (v_org, v_tpl, v_sec, 'severity', 'الشدّة', 'select', 2);
  insert into exam_field_options (organization_id, field_id, value, label_ar, sort_order)
    select v_org, id, 'mild', 'خفيف', 1 from exam_template_fields
     where template_id = v_tpl and key = 'severity';
  insert into exam_field_options (organization_id, field_id, value, label_ar, sort_order)
    select v_org, id, 'severe', 'شديد', 2 from exam_template_fields
     where template_id = v_tpl and key = 'severity';

  select schema_definition into v_json from clinic_exam_templates where id = v_tpl;
  if v_json #>> '{sections,0,fields,1,options,0,label_ar}' <> 'خفيف' then
    raise exception 'فشل: الخيارات لم تدخل المخطط';
  end if;
  raise notice '✅ الخيارات تدخل المخطط تلقائيًا';

  -- ── 4) القسم من نموذج آخر مرفوض
  insert into clinic_exam_templates (organization_id, specialty_code, name_ar, canvas_type,
                                     schema_definition)
    values (v_org, 'dental', 'نموذج الأسنان', 'none', '{"sections":[]}'::jsonb)
    returning id into v_tpl2;
  begin
    insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar, field_type)
      values (v_org, v_tpl2, v_sec, 'x', 'س', 'text');
    raise exception 'فشل: قُبل قسم من نموذج آخر';
  exception when others then
    if sqlerrm not like '%نموذجًا آخر%' then raise; end if;
    raise notice '✅ القسم من نموذج آخر مرفوض';
  end;

  -- ── 5) الحقل لا يكون شرطًا لظهور نفسه
  begin
    update exam_template_fields set visible_when_field_id = v_f2, visible_when_value = 'x'
     where id = v_f2;
    raise exception 'فشل: قُبل حقل شرطٌ لظهور نفسه';
  exception when others then
    if sqlerrm not like '%لظهور نفسه%' then raise; end if;
    raise notice '✅ الحقل لا يكون شرطًا لظهور نفسه';
  end;

  -- ── 6) شرط ناقص مرفوض
  begin
    insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar,
                                      field_type, visible_when_field_id)
      values (v_org, v_tpl, v_sec, 'bad', 'ناقص', 'text', v_f1);
    raise exception 'فشل: قُبل شرط بلا قيمة';
  exception when check_violation then
    raise notice '✅ الشرط الناقص مرفوض';
  end;

  -- ── 7) الزيارة تلتقط نسخة النموذج
  insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, template_id)
    values (v_org, v_patient, v_doctor, current_date, v_tpl) returning id into v_visit;

  select exam_schema_snapshot into v_snap from patient_visits where id = v_visit;
  if v_snap is null then
    raise exception 'فشل: الزيارة لم تلتقط نسخة النموذج';
  end if;
  if (select template_version from patient_visits where id = v_visit) <> 1 then
    raise exception 'فشل: رقم إصدار النموذج لم يُحفظ';
  end if;
  raise notice '✅ الزيارة تلتقط نسخة النموذج ورقم إصداره';

  -- ── 8) تعديل النموذج لا يغيّر النسخة الملتقطة
  --
  -- هذا جوهر المرحلة: بدونه يغيّر تعديلُ اليوم **معنى** ما كُتب قبل سنة.
  update exam_template_fields set label_ar = 'ألم الصدر' where id = v_f1;

  select exam_schema_snapshot into v_json from patient_visits where id = v_visit;
  if v_json #>> '{sections,0,fields,0,label_ar}' <> 'يشكو من ألم؟' then
    raise exception 'فشل: النسخة الملتقطة تغيّرت مع النموذج (%)',
      v_json #>> '{sections,0,fields,0,label_ar}';
  end if;
  select schema_definition into v_json from clinic_exam_templates where id = v_tpl;
  if v_json #>> '{sections,0,fields,0,label_ar}' <> 'ألم الصدر' then
    raise exception 'فشل: النموذج الحالي لم يتحدّث';
  end if;
  raise notice '✅ تعديل النموذج لا يمسّ الزيارات السابقة';

  -- ── 9) تغيير مفتاح حقلٍ مستعمَل مرفوض
  if app_template_usage_count(v_tpl) <> 1 then
    raise exception 'فشل: عدّاد الاستعمال خاطئ';
  end if;
  begin
    update exam_template_fields set key = 'renamed' where id = v_f1;
    raise exception 'فشل: تغيّر مفتاح حقل في نموذج مستعمَل';
  exception when others then
    if sqlerrm not like '%أنشئ نسخة جديدة%' then raise; end if;
    raise notice '✅ تغيير مفتاح حقل مستعمَل مرفوض';
  end;

  begin
    update exam_template_fields set field_type = 'text' where id = v_f1;
    raise exception 'فشل: تغيّر نوع حقل في نموذج مستعمَل';
  exception when others then
    if sqlerrm not like '%أنشئ نسخة جديدة%' then raise; end if;
    raise notice '✅ تغيير نوع حقل مستعمَل مرفوض';
  end;

  -- ── 10) النسخة الجديدة تنقل كل شيء
  v_tpl2 := app_clone_exam_template(v_tpl, 'نموذج الباطنة v2');

  select count(*) into v_int from exam_template_sections where template_id = v_tpl2;
  if v_int <> 2 then raise exception 'فشل: الأقسام لم تُنسخ (%)', v_int; end if;

  select count(*) into v_int from exam_template_fields where template_id = v_tpl2;
  if v_int <> 3 then raise exception 'فشل: الحقول لم تُنسخ (%)', v_int; end if;

  select count(*) into v_int from exam_field_options o
    join exam_template_fields f on f.id = o.field_id where f.template_id = v_tpl2;
  if v_int <> 2 then raise exception 'فشل: الخيارات لم تُنسخ (%)', v_int; end if;

  select k.key into v_txt
    from exam_template_fields f
    join exam_template_fields k on k.id = f.visible_when_field_id
   where f.template_id = v_tpl2 and f.key = 'pain_score';
  if v_txt is distinct from 'has_pain' then
    raise exception 'فشل: الشرط لم يُربط في النسخة (%)', v_txt;
  end if;

  if (select version from clinic_exam_templates where id = v_tpl2) <> 2 then
    raise exception 'فشل: رقم الإصدار الجديد ليس ٢';
  end if;
  if not (select is_disabled from clinic_exam_templates where id = v_tpl2) then
    raise exception 'فشل: النسخة الجديدة يجب أن تُنشأ معطَّلة حتى تُراجَع';
  end if;
  raise notice '✅ النسخة الجديدة تنقل الأقسام والحقول والخيارات والشروط';

  -- ── 11) النسخة الجديدة قابلة للتعديل (غير مستعمَلة)
  update exam_template_fields set key = 'chest_pain'
   where template_id = v_tpl2 and key = 'has_pain';
  raise notice '✅ النسخة غير المستعمَلة قابلة للتعديل';

  -- ── 12) الصلاحيات
  perform set_config('request.jwt.claim.sub', v_recep::text, true);
  begin
    perform app_clone_exam_template(v_tpl, 'محاولة');
    raise exception 'فشل: موظف الاستقبال أنشأ نسخة';
  exception when others then
    if sqlerrm not like '%صلاحيتك%' then raise; end if;
    raise notice '✅ إدارة النماذج تحتاج صلاحيتها';
  end;

  raise notice '——— كل فحوص نماذج الفحص نجحت ———';
end $$;

rollback;
