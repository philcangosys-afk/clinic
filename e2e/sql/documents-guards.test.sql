-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المستندات والموافقات والتواقيع — 0102
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/documents-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- الخطر هنا قانونيّ وطبّيّ معًا: إجراءٌ يُنفَّذ بلا موافقة موقَّعة، أو موافقة
-- على إجراءٍ تُحسب موافقةً على غيره، أو توقيعٌ بلا موقِّع معروف. كل فحص
-- يحاول ذلك ويتوقّع المنع.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid;
  v_owner    uuid;
  v_nurse    uuid;
  v_doctor_u uuid;
  v_branch   uuid;
  v_clinic   uuid;
  v_patient  uuid;
  v_doctor   uuid;
  v_visit    uuid;
  v_item     uuid;
  v_item2    uuid;
  v_plain    uuid;
  v_svc      uuid;
  v_svc2     uuid;
  v_doc      uuid;
  v_sig      uuid;
  v_tmpl     uuid;
  v_gen      uuid;
  v_asset    uuid;
  v_num      numeric;
  v_txt      text;
  v_int      int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'doc-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'doc-nurse@test.local')
    returning id into v_nurse;
  insert into auth.users (id, email) values (gen_random_uuid(), 'doc-doctor@test.local')
    returning id into v_doctor_u;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار المستندات', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_nurse, 'nurse', true), (v_org, v_doctor_u, 'doctor', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','DC1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'د. أحمد')
    returning id into v_doctor;
  insert into patients (organization_id, name_ar, id_number, phone_1)
    values (v_org, 'سالم المريض', '1234567890', '0500000000')
    returning id into v_patient;
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                              branch_id, visit_date, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
    returning id into v_visit;

  -- خدمتان تحتاجان موافقة، وثالثة لا تحتاج
  insert into items (organization_id, item_type, code, name_ar, price, requires_consent,
                     consent_note_ar)
    values (v_org, 'service', 'SURG1', 'عملية جراحية', 5000, true, 'موافقة جراحة')
    returning id into v_item;
  insert into items (organization_id, item_type, code, name_ar, price, requires_consent)
    values (v_org, 'service', 'ANES1', 'تخدير عام', 2000, true) returning id into v_item2;
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'CONS1', 'كشف عام', 200) returning id into v_plain;

  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price,
                                      status, created_by)
    values (v_org, v_visit, v_item, 1, 5000, 'ordered', v_owner) returning id into v_svc;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price,
                                      status, created_by)
    values (v_org, v_visit, v_item2, 1, 2000, 'ordered', v_owner) returning id into v_svc2;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) المستند بلا ملف ليس مستندًا، والرقم يُولَّد
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_register_patient_document(v_patient, '   ', 'x.pdf');
    raise exception 'فشل: سُجّل مستند بلا مسار ملف';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مسار الملف مطلوب%' then raise; end if;
  end;

  v_doc := app_register_patient_document(
             v_patient, 'org/docs/id-copy.pdf', 'صورة الهوية.pdf', 'document');
  select document_number into v_int from patient_documents where id = v_doc;
  if v_int is null or v_int < 1 then
    raise exception 'فشل: لم يُولَّد رقم للمستند';
  end if;
  raise notice '✅ ١) المستند يحتاج ملفًا فعليًّا ويأخذ رقمًا متسلسلًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الموافقة لا تُربط بخدمة لا تطلب موافقة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_register_patient_document(
      v_patient, 'org/docs/c.pdf', 'موافقة.pdf', 'document', v_visit, v_plain, true);
    raise exception 'فشل: رُبطت موافقة بخدمة لا تتطلّبها';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا تتطلّب موافقة%' then raise; end if;
  end;
  raise notice '✅ ٢) الموافقة لا تُعلَّق على خدمة لا تطلبها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **الإجراء لا يُنفَّذ بلا موافقة موقَّعة**
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update patient_visit_services set status = 'performed' where id = v_svc;
    raise exception 'فشل: نُفّذت عملية جراحية بلا موافقة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بلا موافقة موقَّعة%' then raise; end if;
  end;
  raise notice '✅ ٣) الخدمة التي تحتاج موافقة لا تُنفَّذ بلا موافقة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) موافقة *غير موقَّعة* لا تكفي، وموافقةُ إجراءٍ آخر لا تكفي
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_consent_surgery uuid; v_consent_other uuid;
  begin
    v_consent_surgery := app_register_patient_document(
      v_patient, 'org/docs/consent-surg.pdf', 'موافقة جراحة.pdf', 'document',
      v_visit, v_item, true);

    begin
      update patient_visit_services set status = 'performed' where id = v_svc;
      raise exception 'فشل: قُبلت موافقة غير موقَّعة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%بلا موافقة موقَّعة%' then raise; end if;
    end;

    -- توقيعها يفتح الطريق لهذا الإجراء وحده
    v_sig := app_sign_document('patient_document', v_consent_surgery, 'patient',
                               'سالم المريض', 'on_screen', 'org/sig/1.png');
    if (select signed_at from patient_documents where id = v_consent_surgery) is null then
      raise exception 'فشل: التوقيع لم يختم المستند';
    end if;

    update patient_visit_services set status = 'performed' where id = v_svc;
    if (select status from patient_visit_services where id = v_svc) <> 'performed' then
      raise exception 'فشل: لم تُنفَّذ الخدمة رغم الموافقة الموقَّعة';
    end if;

    -- **والتخدير العام ما زال ممنوعًا**: موافقة الجراحة ليست موافقة التخدير
    begin
      update patient_visit_services set status = 'performed' where id = v_svc2;
      raise exception 'فشل: موافقة إجراءٍ حُسبت موافقةً لإجراءٍ آخر';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%بلا موافقة موقَّعة%' then raise; end if;
    end;
  end;
  raise notice '✅ ٤) الموافقة تخصّ إجراءها: موافقة الجراحة لا تُبيح التخدير';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) التوقيع: هوية الموقِّع وصورته وصلة وليّ الأمر، ومرّة واحدة لكل صفة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_c2 uuid;
  begin
    v_c2 := app_register_patient_document(
      v_patient, 'org/docs/consent-anes.pdf', 'موافقة تخدير.pdf', 'document',
      v_visit, v_item2, true);

    begin
      perform app_sign_document('patient_document', v_c2, 'patient', '  ');
      raise exception 'فشل: قُبل توقيع بلا اسم موقِّع';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%اسم الموقِّع مطلوب%' then raise; end if;
    end;

    begin
      perform app_sign_document('patient_document', v_c2, 'patient', 'سالم', 'on_screen', null);
      raise exception 'فشل: قُبل توقيع على الشاشة بلا صورة توقيع';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%صورة التوقيع مطلوبة%' then raise; end if;
    end;

    begin
      perform app_sign_document('patient_document', v_c2, 'guardian', 'أبو سالم',
                                'on_screen', 'org/sig/g.png');
      raise exception 'فشل: وقّع وليّ أمر بلا صلة معلومة بالمريض';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%صلة وليّ الأمر%' then raise; end if;
    end;

    perform app_sign_document('patient_document', v_c2, 'patient', 'سالم المريض',
                              'on_screen', 'org/sig/2.png');
    begin
      perform app_sign_document('patient_document', v_c2, 'patient', 'سالم المريض',
                                'on_screen', 'org/sig/3.png');
      raise exception 'فشل: وقّعت الصفة نفسها مرّتين على المستند';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      null;
    end;

    -- الطبيب يوقّع بصفته، فيُسجَّل مستخدمه
    perform app_sign_document('patient_document', v_c2, 'doctor', 'د. أحمد',
                              'on_screen', 'org/sig/d.png');
    if (select count(*) from document_signatures
         where document_id = v_c2 and signer_role = 'doctor'
           and signer_user_id = v_owner) <> 1 then
      raise exception 'فشل: توقيع الطبيب لم يُنسب لمستخدمه';
    end if;

    -- والتوقيع لا يُعدَّل ولا يُحذف
    begin
      update document_signatures set signer_name = 'شخص آخر' where document_id = v_c2;
      raise exception 'فشل: عُدّل توقيع';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا يُعدَّل%' then raise; end if;
    end;
    begin
      delete from document_signatures where document_id = v_c2;
      raise exception 'فشل: حُذف توقيع';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا تُحذف%' then raise; end if;
    end;

    update patient_visit_services set status = 'performed' where id = v_svc2;
  end;
  raise notice '✅ ٥) التوقيع بهوية وصورة وصلة، مرّة لكل صفة، ولا يُعدَّل ولا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الموافقة المنتهية لا تُبيح الإجراء
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_p2 uuid; v_v2 uuid; v_s3 uuid; v_c3 uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'مريض ثانٍ')
      returning id into v_p2;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_p2, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
      returning id into v_v2;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, created_by)
      values (v_org, v_v2, v_item, 1, 5000, 'ordered', v_owner) returning id into v_s3;

    v_c3 := app_register_patient_document(
      v_p2, 'org/docs/old.pdf', 'موافقة قديمة.pdf', 'document', v_v2, v_item, true,
      current_date - 1);
    perform app_sign_document('patient_document', v_c3, 'patient', 'مريض ثانٍ',
                              'on_screen', 'org/sig/old.png');

    if app_service_consent_status(v_v2, v_item) <> 'expired' then
      raise exception 'فشل: الموافقة المنتهية لم تُصنَّف منتهية';
    end if;
    begin
      update patient_visit_services set status = 'performed' where id = v_s3;
      raise exception 'فشل: نُفّذ إجراء بموافقة منتهية';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%الموافقة منتهية%' then raise; end if;
    end;
  end;
  raise notice '✅ ٦) الموافقة المنتهية تُصنَّف منتهية ولا تُبيح الإجراء';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) التجاوز: ممنوع بلا صلاحية، وموثَّق بمبرّر ومن قرّره
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_p3 uuid; v_v3 uuid; v_s4 uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'مريض طارئ')
      returning id into v_p3;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_p3, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
      returning id into v_v3;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, created_by)
      values (v_org, v_v3, v_item, 1, 5000, 'ordered', v_owner) returning id into v_s4;

    -- الممرّضة لا تملك consents.override
    perform set_config('request.jwt.claim.sub', v_nurse::text, true);
    begin
      update patient_visit_services
         set status = 'performed', consent_override_reason = 'حالة طارئة'
       where id = v_s4;
      raise exception 'فشل: تجاوزت الموافقة بلا صلاحية';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%consents.override%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    update patient_visit_services
       set status = 'performed', consent_override_reason = 'إسعاف — المريض فاقد للوعي'
     where id = v_s4;
    select consent_overridden_by, consent_overridden_at into v_txt, v_num
      from (select consent_overridden_by::text, extract(epoch from consent_overridden_at)
              from patient_visit_services where id = v_s4) t(consent_overridden_by, consent_overridden_at);
    if v_txt is null or v_num is null then
      raise exception 'فشل: التجاوز لم يُوثَّق بمن قرّره ومتى';
    end if;
  end;
  raise notice '✅ ٧) التجاوز يحتاج صلاحية ومبرّرًا، ويُوثَّق بصاحبه ووقته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الأرشفة بسبب، والمؤرشف لا يُحسب موافقةً، والمستند لا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_p4 uuid; v_v4 uuid; v_s5 uuid; v_c4 uuid;
  begin
    insert into patients (organization_id, name_ar) values (v_org, 'مريض ثالث')
      returning id into v_p4;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_p4, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
      returning id into v_v4;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, created_by)
      values (v_org, v_v4, v_item, 1, 5000, 'ordered', v_owner) returning id into v_s5;
    v_c4 := app_register_patient_document(
      v_p4, 'org/docs/c4.pdf', 'موافقة.pdf', 'document', v_v4, v_item, true);
    perform app_sign_document('patient_document', v_c4, 'patient', 'مريض ثالث',
                              'on_screen', 'org/sig/4.png');
    if app_service_consent_status(v_v4, v_item) <> 'signed' then
      raise exception 'فشل: الموافقة الموقَّعة لم تُحتسب';
    end if;

    begin
      perform app_archive_document('patient_document', v_c4, '   ');
      raise exception 'فشل: أُرشف مستند بلا سبب';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%سبب الأرشفة مطلوب%' then raise; end if;
    end;

    perform app_archive_document('patient_document', v_c4, 'رُفع الملف الخطأ');
    if app_service_consent_status(v_v4, v_item) <> 'missing' then
      raise exception 'فشل: موافقة مؤرشفة ما زالت تُحتسب';
    end if;
    begin
      update patient_visit_services set status = 'performed' where id = v_s5;
      raise exception 'فشل: نُفّذ إجراء بموافقة مؤرشفة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%بلا موافقة موقَّعة%' then raise; end if;
    end;

    begin
      delete from patient_documents where id = v_c4;
      raise exception 'فشل: حُذف مستند مريض';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لا تُحذف%' then raise; end if;
    end;
  end;
  raise notice '✅ ٨) الأرشفة بسبب توقف احتساب الموافقة، والمستند لا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) القوالب: لا مستند بفراغات، والمعطَّل لا يُولَّد منه
  -- ═════════════════════════════════════════════════════════════════════════
  insert into document_templates (organization_id, name_ar, applies_to, body_html, created_by)
    values (v_org, 'إقرار استلام', 'patient',
            'أقرّ أنا {{patient_name}} رقم ملفي {{file_number}} بتاريخ {{today}} في {{organization_name}}.',
            v_owner)
    returning id into v_tmpl;

  v_gen := app_render_document_template(v_tmpl, v_patient, null, v_visit);
  select body_html into v_txt from generated_documents where id = v_gen;
  if v_txt like '%{{%' then
    raise exception 'فشل: بقي حقل غير معبَّأ في المستند المولَّد';
  end if;
  if v_txt not like '%سالم المريض%' then
    raise exception 'فشل: اسم المريض الحقيقي لم يُدرَج في المستند';
  end if;

  declare v_bad uuid;
  begin
    insert into document_templates (organization_id, name_ar, applies_to, body_html, created_by)
      values (v_org, 'قالب ناقص', 'patient', 'المبلغ {{unknown_field}}', v_owner)
      returning id into v_bad;
    begin
      perform app_render_document_template(v_bad, v_patient);
      raise exception 'فشل: وُلّد مستند بحقلٍ غير معبَّأ';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لم تُعبَّأ%' then raise; end if;
    end;
    -- والحقل يُمرَّر يدويًّا فيُقبل
    perform app_render_document_template(v_bad, v_patient, null, null,
                                         jsonb_build_object('unknown_field','1500'));

    update document_templates set is_disabled = true where id = v_bad;
    begin
      perform app_render_document_template(v_bad, v_patient, null, null,
                                           jsonb_build_object('unknown_field','1500'));
      raise exception 'فشل: وُلّد مستند من قالب معطَّل';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%معطَّل%' then raise; end if;
    end;
  end;
  raise notice '✅ ٩) القالب يُعبَّأ من السجلات الحقيقية، ولا يُطبع بفراغات، والمعطَّل لا يُستعمل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) مستندات الكيانات: الكيان يجب أن يكون موجودًا في المنشأة
  -- ═════════════════════════════════════════════════════════════════════════
  insert into assets (organization_id, branch_id, asset_number, name_ar, created_by)
    values (v_org, v_branch, 'DOC-AS-1', 'جهاز', v_owner) returning id into v_asset;

  begin
    perform app_register_entity_document(v_org, 'asset', gen_random_uuid(),
                                         'شهادة', 'org/docs/cert.pdf');
    raise exception 'فشل: عُلّق مستند على كيان غير موجود';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير موجود في هذه المنشأة%' then raise; end if;
  end;

  perform app_register_entity_document(
    v_org, 'asset', v_asset, 'شهادة معايرة 2026', 'org/docs/cal-2026.pdf',
    'cal.pdf', 'calibration', v_branch, current_date - 10, current_date + 20);

  if not exists (select 1 from v_documents
                  where organization_id = v_org and entity_type = 'asset'
                    and entity_id = v_asset) then
    raise exception 'فشل: مستند الأصل لا يظهر في منظور المستندات الموحّد';
  end if;
  if not exists (select 1 from v_document_expiry_alerts
                  where organization_id = v_org and entity_id = v_asset
                    and days_left between 0 and 60) then
    raise exception 'فشل: لا تنبيه لمستند يقارب الانتهاء';
  end if;
  raise notice '✅ ١٠) مستندات الأصول والموردين تُربط بكياناتها وتظهر في المنظور والتنبيهات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) منظور الموافقات المعلّقة يعكس حالة كل إجراء على حدة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_signed int; v_missing int;
  begin
    select count(*) into v_signed from v_pending_consents
     where organization_id = v_org and consent_status = 'signed';
    select count(*) into v_missing from v_pending_consents
     where organization_id = v_org and consent_status in ('missing','expired');
    if v_signed = 0 then
      raise exception 'فشل: لا خدمة بموافقة موقَّعة في المنظور';
    end if;
    if v_missing = 0 then
      raise exception 'فشل: المنظور لا يُظهر الخدمات الناقصة موافقتها';
    end if;
    if exists (select 1 from v_pending_consents
                where organization_id = v_org and item_id = v_plain) then
      raise exception 'فشل: خدمة لا تحتاج موافقة ظهرت في المعلّقات';
    end if;
  end;
  raise notice '✅ ١١) منظور الموافقات دقيق لكل إجراء، ولا يشمل ما لا يحتاجها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) عزل المنشآت: مستند منشأة لا يظهر لعضو منشأة أخرى
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_owner2 uuid; v_seen int;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'doc-other@test.local')
      returning id into v_owner2;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'clinic', v_owner2) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_owner2::text, true);
    begin
      perform app_register_patient_document(v_patient, 'org/docs/x.pdf', 'x.pdf');
      raise exception 'فشل: سجّل عضو منشأة أخرى مستندًا لمريض ليس من منشأته';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%صلاحيتك%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١٢) عزل المنشآت قائم على المستندات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) الميزة والصلاحيات مسجَّلة، والدوال محجوبة عن الزوّار
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from feature_catalog where feature_key = 'documents') then
    raise exception 'فشل: ميزة المستندات غير مسجَّلة';
  end if;
  if not exists (select 1 from organization_features
                  where organization_id = v_org and feature_key = 'documents' and enabled) then
    raise exception 'فشل: المنشأة الجديدة بلا ميزة المستندات';
  end if;
  if (select count(*) from permission_catalog
       where permission_key in ('documents.view','documents.upload','documents.archive',
                                'documents.templates','consents.sign','consents.override')) <> 6 then
    raise exception 'فشل: صلاحيات المستندات ناقصة';
  end if;
  if exists (select 1 from role_default_permissions
              where permission_key = 'consents.override') then
    raise exception 'فشل: تجاوز الموافقة مُنح لدورٍ افتراضيًّا';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_sign_document'
       and has_function_privilege('anon', p.oid, 'execute'))
  then
    raise exception 'فشل: دالّة التوقيع متاحة للزوّار';
  end if;
  raise notice '✅ ١٣) الميزة والصلاحيات مسجَّلة، والتجاوز غير ممنوح افتراضيًّا، والدوال محجوبة عن الزوّار';

  raise notice '——— كل فحوص المستندات نجحت ———';
end $$;

rollback;
