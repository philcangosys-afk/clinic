-- ---------------------------------------------------------------------------
-- 0061_save_visit_rpc.sql — حفظ الزيارة وكل توابعها في معاملة واحدة
-- ---------------------------------------------------------------------------
-- حفظ الزيارة كان **خمسة عشر طلبًا منفصلًا** من المتصفح: الزيارة، ثم
-- الخدمات، ثم التشخيصات، ثم لوحة الأسنان، ثم المؤشرات، ثم مخطط الجسم، ثم
-- الفحص المهني، ثم طلبات المختبر والأشعة والوصفة. كلٌّ منها معاملة قائمة
-- بذاتها.
--
-- فإن نجح حفظ الزيارة وفشل ما بعده — انقطاع شبكة، إغلاق الحاسوب، سياسة
-- مانعة — بقيت **زيارة محفوظة نصفها**: زيارة بلا تشخيص، أو بخدمات وبلا
-- طلبات. والأسوأ أن الطبيب يرى رسالة فشل فيُعيد الحفظ، فتُستبدل الخدمات
-- مرة أخرى بينما التشخيص الذي فشل أولًا ما زال ناقصًا.
--
-- ولا يُصلح هذا بترتيب الطلبات ولا بحذف تعويضي: الشبكة قد تنقطع بين أي
-- طلبين، وقد يفشل الحذف التعويضي هو الآخر. الذرّية لا تُبنى في العميل.
--
-- هذه الدالة تفعل كل ذلك داخل معاملة واحدة: إمّا الزيارة بكل توابعها، أو
-- لا شيء.
--
-- **ما يبقى في العميل عمدًا:** فحص حظر المريض. الحظر قرار تشغيلي قابل
-- للتجاوز بقرار إداري لا قيد سلامة بيانات؛ فرضه في القاعدة يمنع حتى الحالات
-- المشروعة (طوارئ، تسوية) ولا يترك مخرجًا.
-- ---------------------------------------------------------------------------

begin;

create or replace function app_save_visit(
  p_organization_id     uuid,
  p_patient_id          uuid,
  p_doctor_id           uuid,
  p_clinic_id           uuid    default null,
  p_appointment_id      uuid    default null,
  p_template_id         uuid    default null,
  p_canvas_type         text    default 'none',
  p_main_complaint      text    default null,
  p_exam_data           jsonb   default '{}'::jsonb,
  p_notes               text    default null,
  p_next_visit_plan     text    default null,
  p_next_visit_date     date    default null,
  p_services            jsonb   default '[]'::jsonb,
  p_diagnoses           uuid[]  default null,
  p_vitals              jsonb   default null,
  p_dental              jsonb   default null,
  p_body_diagram        jsonb   default null,
  p_occupational        jsonb   default null,
  p_lab_test_ids        uuid[]  default null,
  p_radiology_exam_ids  uuid[]  default null,
  p_prescription_items  jsonb   default '[]'::jsonb,
  p_order_priority      text    default 'routine',
  p_lab_notes           text    default null,
  p_clinical_indication text    default null,
  p_prescription_notes  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit_id  uuid;
  v_warnings  text[] := array[]::text[];
  v_count     integer;
  v_locked    integer;
  v_order_id  uuid;
  v_view      text;
begin
  -- (أ) الهوية والصلاحية ------------------------------------------------------
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  -- تسجيل الزيارة عمل سريري: الطبيب والممرّض والإدارة. لا المحاسب ولا فنّي
  -- المختبر — هذان يقرآن الزيارة ولا يكتبانها.
  if not app_has_role(p_organization_id,
        array['owner','organization_admin','branch_manager','doctor','nurse']) then
    raise exception 'صلاحيتك لا تسمح بتسجيل الزيارات';
  end if;
  if p_patient_id is null or p_doctor_id is null then
    raise exception 'أكمل بيانات المريض والطبيب';
  end if;

  -- (ب) عزل المنشآت ----------------------------------------------------------
  if not exists (select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from doctors where id = p_doctor_id and organization_id = p_organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_clinic_id is not null and not exists (
       select 1 from clinics where id = p_clinic_id and organization_id = p_organization_id) then
    raise exception 'العيادة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;
  if p_appointment_id is not null and not exists (
       select 1 from appointments where id = p_appointment_id and organization_id = p_organization_id) then
    raise exception 'الموعد المحدَّد لا ينتمي لهذه المنشأة';
  end if;

  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e
   where not exists (select 1 from items i
                      where i.id = (e ->> 'item_id')::uuid
                        and i.organization_id = p_organization_id);
  if v_count > 0 then
    raise exception '% من الخدمات لا تنتمي لهذه المنشأة', v_count;
  end if;

  if p_lab_test_ids is not null and array_length(p_lab_test_ids, 1) > 0 then
    select count(*) into v_count from unnest(p_lab_test_ids) x(id)
     where not exists (select 1 from lab_tests t
                        where t.id = x.id and t.organization_id = p_organization_id);
    if v_count > 0 then raise exception '% من فحوص المختبر لا تنتمي لهذه المنشأة', v_count; end if;
  end if;

  if p_radiology_exam_ids is not null and array_length(p_radiology_exam_ids, 1) > 0 then
    select count(*) into v_count from unnest(p_radiology_exam_ids) x(id)
     where not exists (select 1 from radiology_exams e2
                        where e2.id = x.id and e2.organization_id = p_organization_id);
    if v_count > 0 then raise exception '% من فحوص الأشعة لا تنتمي لهذه المنشأة', v_count; end if;
  end if;

  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_prescription_items, '[]'::jsonb)) e
   where not exists (select 1 from items i
                      where i.id = (e ->> 'drug_item_id')::uuid
                        and i.organization_id = p_organization_id);
  if v_count > 0 then
    raise exception '% من الأدوية لا تنتمي لهذه المنشأة', v_count;
  end if;

  -- (ج) الزيارة: تُحدَّث إن كانت لهذا الموعد زيارة، وإلا تُنشأ ----------------
  -- الفهرس الفريد `idx_patient_visits_one_per_appointment` يضمن زيارة واحدة
  -- لكل موعد، فالقراءة هنا لا تُخفي تعدّدًا.
  if p_appointment_id is not null then
    select pv.id into v_visit_id from patient_visits pv where pv.appointment_id = p_appointment_id;
  end if;

  if v_visit_id is null then
    insert into patient_visits (
      organization_id, patient_id, doctor_id, clinic_id, appointment_id,
      template_id, canvas_type, main_complaint, exam_data, notes,
      next_visit_plan, next_visit_date, created_by
    ) values (
      p_organization_id, p_patient_id, p_doctor_id, p_clinic_id, p_appointment_id,
      p_template_id, coalesce(p_canvas_type, 'none'),
      nullif(btrim(p_main_complaint), ''), coalesce(p_exam_data, '{}'::jsonb),
      nullif(btrim(p_notes), ''), nullif(btrim(p_next_visit_plan), ''), p_next_visit_date,
      auth.uid()
    ) returning id into v_visit_id;
  else
    update patient_visits set
      patient_id      = p_patient_id,
      doctor_id       = p_doctor_id,
      clinic_id       = p_clinic_id,
      template_id     = p_template_id,
      canvas_type     = coalesce(p_canvas_type, 'none'),
      main_complaint  = nullif(btrim(p_main_complaint), ''),
      exam_data       = coalesce(p_exam_data, '{}'::jsonb),
      notes           = nullif(btrim(p_notes), ''),
      next_visit_plan = nullif(btrim(p_next_visit_plan), ''),
      next_visit_date = p_next_visit_date,
      updated_at      = now()
    where id = v_visit_id and organization_id = p_organization_id;
  end if;

  -- (د) الخدمات: تُستبدل، ما لم تكن مفوترة ------------------------------------
  -- خدمة صدرت بها فاتورة لا تُحذف بتعديل الزيارة، وإلا اختفى سند البند من
  -- فاتورة صادرة. القيد الأجنبي يمنع ذلك أصلًا، والتصفية هنا تتجنّب الاصطدام
  -- به برسالة خام.
  delete from patient_visit_services s
   where s.visit_id = v_visit_id
     and not exists (select 1 from sales_invoice_items li where li.visit_service_id = s.id);

  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, note, performed_by, created_by)
  select p_organization_id, v_visit_id,
         (e ->> 'item_id')::uuid,
         greatest(coalesce(nullif(e ->> 'qty','')::numeric, 1), 0.01),
         nullif(e ->> 'unit_price','')::numeric,
         nullif(btrim(e ->> 'note'), ''),
         p_doctor_id, auth.uid()
    from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e;

  -- (هـ) التشخيصات ------------------------------------------------------------
  delete from patient_visit_diagnoses where visit_id = v_visit_id;
  if p_diagnoses is not null and array_length(p_diagnoses, 1) > 0 then
    insert into patient_visit_diagnoses (visit_id, icd10_code_id)
    select distinct v_visit_id, x.id from unnest(p_diagnoses) x(id);
  end if;

  -- (و) المؤشرات الحيوية — صف واحد لكل زيارة (0056) ---------------------------
  delete from patient_vital_signs where visit_id = v_visit_id;
  if p_vitals is not null and p_vitals <> 'null'::jsonb then
    insert into patient_vital_signs (
      organization_id, patient_id, visit_id, heart_rate,
      blood_pressure_systolic, blood_pressure_diastolic,
      temperature_celsius, glucose_level, height_cm, weight_kg, created_by
    ) values (
      p_organization_id, p_patient_id, v_visit_id,
      nullif(p_vitals ->> 'heart_rate','')::numeric,
      nullif(p_vitals ->> 'blood_pressure_systolic','')::numeric,
      nullif(p_vitals ->> 'blood_pressure_diastolic','')::numeric,
      nullif(p_vitals ->> 'temperature_celsius','')::numeric,
      nullif(p_vitals ->> 'glucose_level','')::numeric,
      nullif(p_vitals ->> 'height_cm','')::numeric,
      nullif(p_vitals ->> 'weight_kg','')::numeric,
      auth.uid()
    );
  end if;

  -- (ز) لوحة الأسنان ----------------------------------------------------------
  delete from dental_chart_entries where visit_id = v_visit_id;
  if p_dental is not null and p_dental <> 'null'::jsonb then
    insert into dental_chart_entries (
      visit_id, tooth_numbers, tooth_type, main_complaint, procedure_done,
      diagnosis_icd10_id, complications, anesthesia, prophylactic_antibiotics,
      patient_family_education, is_xray, ortho_upper, ortho_lower, full_arch,
      next_visit_plan, created_by
    ) values (
      v_visit_id,
      coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(p_dental -> 'tooth_numbers','[]'::jsonb)) t), '{}'),
      coalesce(p_dental ->> 'tooth_type', 'permanent'),
      nullif(btrim(p_main_complaint), ''),
      nullif(btrim(p_dental ->> 'procedure_done'), ''),
      nullif(p_dental ->> 'diagnosis_icd10_id','')::uuid,
      nullif(btrim(p_dental ->> 'complications'), ''),
      nullif(btrim(p_dental ->> 'anesthesia'), ''),
      nullif(btrim(p_dental ->> 'prophylactic_antibiotics'), ''),
      nullif(btrim(p_dental ->> 'patient_family_education'), ''),
      coalesce((p_dental ->> 'is_xray')::boolean, false),
      coalesce((p_dental ->> 'ortho_upper')::boolean, false),
      coalesce((p_dental ->> 'ortho_lower')::boolean, false),
      coalesce((p_dental ->> 'full_arch')::boolean, false),
      nullif(btrim(p_next_visit_plan), ''),
      auth.uid()
    );
  end if;

  -- (ح) مخطط الجسم — رسم واحد لكل منظور ---------------------------------------
  if p_body_diagram is not null and p_body_diagram <> 'null'::jsonb then
    v_view := coalesce(p_body_diagram ->> 'view', 'front');
    delete from body_diagram_annotations
     where visit_id = v_visit_id and diagram_view = v_view;
    if jsonb_array_length(coalesce(p_body_diagram -> 'strokes', '[]'::jsonb)) > 0 then
      insert into body_diagram_annotations (visit_id, diagram_view, annotation_data, created_by)
      values (v_visit_id, v_view,
              jsonb_build_object('strokes', p_body_diagram -> 'strokes'),
              auth.uid());
    end if;
  end if;

  -- (ط) الفحص المهني ----------------------------------------------------------
  delete from occupational_exam_results where visit_id = v_visit_id;
  if p_occupational is not null and p_occupational <> 'null'::jsonb then
    insert into occupational_exam_results (
      organization_id, patient_id, visit_id, exam_purpose, fitness_status,
      employer_value_id, restrictions_note, certificate_number, next_exam_due_date, created_by
    ) values (
      p_organization_id, p_patient_id, v_visit_id,
      coalesce(p_occupational ->> 'exam_purpose', 'periodic'),
      coalesce(p_occupational ->> 'fitness_status', 'pending'),
      nullif(p_occupational ->> 'employer_value_id','')::uuid,
      nullif(btrim(p_occupational ->> 'restrictions_note'), ''),
      nullif(btrim(p_occupational ->> 'certificate_number'), ''),
      nullif(p_occupational ->> 'next_exam_due_date','')::date,
      auth.uid()
    );
  end if;

  -- (ي) الطلبات: تُستبدل ما لم يبدأ تنفيذها أو تُفوتَر -------------------------
  -- إعادة حفظ الزيارة إجراء توثيقي، ولا يجوز أن يمحو عيّنة سُحبت أو صورة
  -- أُخذت أو دواءً صُرف. في هذه الحالة يُترك الطلب ويُنبَّه الطبيب صراحةً بدل
  -- أن يظن أن تعديله سرى.

  -- المختبر
  select count(*) into v_locked from lab_orders o
   where o.visit_id = v_visit_id and (o.status <> 'ordered' or o.sales_invoice_id is not null);
  if v_locked > 0 then
    v_warnings := array_append(v_warnings, 'طلب المختبر السابق بدأ تنفيذه أو فُوتِر — تُرك كما هو');
  else
    delete from lab_orders where visit_id = v_visit_id;
    if p_lab_test_ids is not null and array_length(p_lab_test_ids, 1) > 0 then
      insert into lab_orders (organization_id, patient_id, ordering_doctor_id, visit_id, clinic_id, priority, notes)
      values (p_organization_id, p_patient_id, p_doctor_id, v_visit_id, p_clinic_id,
              coalesce(p_order_priority, 'routine'), nullif(btrim(p_lab_notes), ''))
      returning id into v_order_id;
      insert into lab_order_items (lab_order_id, lab_test_id)
      select distinct v_order_id, x.id from unnest(p_lab_test_ids) x(id);
    end if;
  end if;

  -- الأشعة
  select count(*) into v_locked from radiology_orders o
   where o.visit_id = v_visit_id and (o.status <> 'ordered' or o.sales_invoice_id is not null);
  if v_locked > 0 then
    v_warnings := array_append(v_warnings, 'طلب الأشعة السابق بدأ تنفيذه أو فُوتِر — تُرك كما هو');
  else
    delete from radiology_orders where visit_id = v_visit_id;
    if p_radiology_exam_ids is not null and array_length(p_radiology_exam_ids, 1) > 0 then
      insert into radiology_orders (organization_id, patient_id, ordering_doctor_id, visit_id, clinic_id, priority, clinical_indication)
      values (p_organization_id, p_patient_id, p_doctor_id, v_visit_id, p_clinic_id,
              coalesce(p_order_priority, 'routine'), nullif(btrim(p_clinical_indication), ''))
      returning id into v_order_id;
      insert into radiology_order_items (radiology_order_id, radiology_exam_id)
      select distinct v_order_id, x.id from unnest(p_radiology_exam_ids) x(id);
    end if;
  end if;

  -- الوصفة: الصرف الجزئي يقفلها أيضًا، لا الحالة وحدها
  select count(*) into v_locked from prescriptions pr
   where pr.visit_id = v_visit_id
     and (pr.status not in ('draft','issued')
          or pr.is_billed
          or exists (select 1 from prescription_items pi
                      where pi.prescription_id = pr.id and pi.dispensed_quantity > 0));
  if v_locked > 0 then
    v_warnings := array_append(v_warnings, 'الوصفة السابقة صُرفت أو فُوترت — تُركت كما هي');
  else
    delete from prescriptions where visit_id = v_visit_id;
    if jsonb_array_length(coalesce(p_prescription_items, '[]'::jsonb)) > 0 then
      insert into prescriptions (organization_id, patient_id, doctor_id, visit_id, clinic_id, status, notes)
      values (p_organization_id, p_patient_id, p_doctor_id, v_visit_id, p_clinic_id,
              'issued', nullif(btrim(p_prescription_notes), ''))
      returning id into v_order_id;
      insert into prescription_items (
        prescription_id, drug_item_id, dosage_instructions, frequency,
        duration_days, quantity_prescribed, is_substitutable
      )
      select v_order_id,
             (e ->> 'drug_item_id')::uuid,
             nullif(btrim(e ->> 'dosage'), ''),
             nullif(btrim(e ->> 'frequency'), ''),
             nullif(e ->> 'duration_days','')::integer,
             greatest(coalesce(nullif(e ->> 'quantity','')::numeric, 1), 0.01),
             coalesce((e ->> 'substitutable')::boolean, true)
        from jsonb_array_elements(p_prescription_items) e;
    end if;
  end if;

  return jsonb_build_object('visit_id', v_visit_id, 'warnings', to_jsonb(v_warnings));
end;
$$;

comment on function app_save_visit(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, date, jsonb, uuid[], jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], jsonb, text, text, text, text) is
  'حفظ زيارة وكل توابعها (خدمات، تشخيصات، مؤشرات، لوحة أسنان، مخطط جسم، فحص مهني، طلبات مختبر وأشعة ووصفة) في معاملة واحدة. تُرجع {visit_id, warnings}.';

revoke all on function app_save_visit(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, date, jsonb, uuid[], jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], jsonb, text, text, text, text) from public, anon;
grant execute on function app_save_visit(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, date, jsonb, uuid[], jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], jsonb, text, text, text, text) to authenticated;

commit;
