-- ---------------------------------------------------------------------------
-- 0067_patient_timeline.sql — رحلة المريض: خط زمني موحَّد
-- ---------------------------------------------------------------------------
-- «رحلة المريض» كانت بطاقات إحصائية: عدد المواعيد، عدد الزيارات، إجمالي
-- الفواتير. وهذه ليست رحلة بل ملخّص.
--
-- ما يحتاجه من يفتحها فعلًا: **ماذا حدث لهذا المريض، بالترتيب**. متى حجز،
-- متى وصل، متى نودي، ماذا شُخِّص، ماذا طُلب له، متى ظهرت النتيجة، وبكم
-- فُوتِر. وهذه الوقائع موزَّعة على أربعة عشر جدولًا لكلٍّ منها شكله وأعمدته
-- الزمنية.
--
-- هذه الدالة تجمعها في شكل واحد. وقرار التصميم الأهم فيها:
--
--   **الأحداث تُشتقّ من الجداول نفسها لا من سجل التدقيق.** سجل التدقيق يسجّل
--   «تغيّر عمود» لا «وصل المريض»، ويبدأ من تاريخ تفعيله فتغيب كل الرحلات
--   السابقة. أما الطوابع الزمنية (`checked_in_1_at`, `called_at`,
--   `entered_at`) فهي في الجدول منذ اليوم الأول — فالرحلة تُقرأ كاملةً بأثر
--   رجعي.
-- ---------------------------------------------------------------------------

begin;

create or replace function app_get_patient_timeline(
  p_patient_id  uuid,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_event_types text[]      default null
)
returns table (
  event_id       text,
  event_type     text,
  occurred_at    timestamptz,
  title          text,
  summary        text,
  status         text,
  module         text,
  entity_id      uuid,
  appointment_id uuid,
  visit_id       uuid,
  invoice_id     uuid,
  created_by     uuid,
  metadata       jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select p.organization_id into v_org from patients p where p.id = p_patient_id;
  if v_org is null then
    raise exception 'المريض غير موجود';
  end if;
  -- الفحص هنا لا في السياسات: الدالة `security definer` تتجاوز RLS، فلو لم
  -- تسأل عن العضوية لأصبحت بابًا خلفيًا يقرأ ملف أي مريض بمعرّفه.
  if not app_is_member(v_org) then
    raise exception 'لا تملك صلاحية على منشأة هذا المريض';
  end if;
  if not app_has_permission(v_org, 'patients.view') then
    raise exception 'صلاحيتك لا تسمح بعرض ملفات المرضى';
  end if;

  return query
  with events as (
    -- إنشاء الملف
    select
      'patient:' || p.id::text                         as event_id,
      'patient_created'                                as event_type,
      p.created_at                                     as occurred_at,
      'فُتح ملف المريض'                                 as title,
      coalesce('رقم الملف ' || p.file_number::text, '') as summary,
      null::text                                       as status,
      'patients'                                       as module,
      p.id                                             as entity_id,
      null::uuid                                       as appointment_id,
      null::uuid                                       as visit_id,
      null::uuid                                       as invoice_id,
      p.created_by                                     as created_by,
      jsonb_build_object('file_number', p.file_number)  as metadata
    from patients p
    where p.id = p_patient_id

    union all
    -- حجز الموعد
    select 'appt_created:' || a.id::text, 'appointment_created', a.created_at,
           'حُجز موعد',
           to_char(a.scheduled_start, 'YYYY-MM-DD HH24:MI') || ' مع ' || coalesce(d.name_ar, '—'),
           a.status, 'appointments', a.id, a.id, null, null, a.created_by,
           jsonb_build_object('doctor', d.name_ar, 'clinic_id', a.clinic_id, 'priority', a.priority)
    from appointments a
    left join doctors d on d.id = a.doctor_id
    where a.patient_id = p_patient_id

    union all
    select 'arrived:' || a.id::text, 'arrival', a.checked_in_1_at,
           'وصل المريض',
           case when a.queue_number is not null then 'رقم الدور ' || a.queue_number::text else null end,
           a.status, 'reception', a.id, a.id, null, null, null,
           jsonb_build_object('queue_number', a.queue_number)
    from appointments a
    where a.patient_id = p_patient_id and a.checked_in_1_at is not null

    union all
    select 'checked_in:' || a.id::text, 'check_in', a.checked_in_2_at,
           'سُجّل دخوله', null, a.status, 'reception', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    where a.patient_id = p_patient_id and a.checked_in_2_at is not null

    union all
    select 'called:' || a.id::text, 'call', a.called_at,
           'نودي المريض',
           -- الانتظار يُحسب هنا لا في الواجهة: هو نفسه الرقم الذي تقيسه
           -- تقارير الاستقبال، فمصدره واحد.
           case when a.checked_in_1_at is not null
                then 'انتظر ' || floor(extract(epoch from (a.called_at - a.checked_in_1_at)) / 60)::text || ' دقيقة'
           end,
           a.status, 'reception', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    where a.patient_id = p_patient_id and a.called_at is not null

    union all
    select 'visit_start:' || a.id::text, 'visit_start', a.entered_at,
           'بدأت الزيارة', coalesce(d.name_ar, '—'), a.status, 'reception', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    left join doctors d on d.id = a.doctor_id
    where a.patient_id = p_patient_id and a.entered_at is not null

    union all
    select 'visit_end:' || a.id::text, 'visit_end', a.left_at,
           'انتهت الزيارة',
           case when a.entered_at is not null
                then 'مدّة الزيارة ' || floor(extract(epoch from (a.left_at - a.entered_at)) / 60)::text || ' دقيقة'
           end,
           a.status, 'reception', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    where a.patient_id = p_patient_id and a.left_at is not null

    union all
    -- عدم الحضور والإلغاء: أحداث بذاتها لا غيابٌ في السجل
    select 'no_show:' || a.id::text, 'no_show', a.updated_at,
           'لم يحضر', a.no_show_reason, a.status, 'appointments', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    where a.patient_id = p_patient_id and a.status = 'no_show'

    union all
    select 'cancelled:' || a.id::text, 'cancellation', a.updated_at,
           case when a.status = 'cancelled_by_patient' then 'ألغى المريض الموعد' else 'ألغت المنشأة الموعد' end,
           a.cancellation_reason, a.status, 'appointments', a.id, a.id, null, null, null, '{}'::jsonb
    from appointments a
    where a.patient_id = p_patient_id and a.status in ('cancelled_by_patient','cancelled_by_staff')

    union all
    -- الزيارة الطبية
    select 'visit:' || v.id::text, 'visit', v.visit_date,
           'زيارة طبية', coalesce(v.main_complaint, '—'), null, 'medical_records',
           v.id, v.appointment_id, v.id, null, v.created_by,
           jsonb_build_object('next_visit_date', v.next_visit_date)
    from patient_visits v
    where v.patient_id = p_patient_id

    union all
    select 'diagnosis:' || vd.visit_id::text || ':' || vd.icd10_code_id::text, 'diagnosis', v.visit_date,
           'تشخيص', i.code || ' — ' || coalesce(i.name_ar, i.name_en), null, 'medical_records',
           vd.icd10_code_id, v.appointment_id, v.id, null, null,
           jsonb_build_object('code', i.code)
    from patient_visit_diagnoses vd
    join patient_visits v on v.id = vd.visit_id
    join icd10_codes i on i.id = vd.icd10_code_id
    where v.patient_id = p_patient_id

    union all
    select 'service:' || s.id::text, 'service', s.created_at,
           'خدمة منفَّذة',
           coalesce(it.name_ar, '—') || ' × ' || s.qty::text, null, 'medical_records',
           s.id, v.appointment_id, v.id, null, s.created_by,
           jsonb_build_object('unit_price', s.unit_price)
    from patient_visit_services s
    join patient_visits v on v.id = s.visit_id
    left join items it on it.id = s.item_id
    where v.patient_id = p_patient_id

    union all
    select 'vitals:' || vs.id::text, 'vitals', vs.recorded_at,
           'مؤشرات حيوية',
           concat_ws(' · ',
             case when vs.blood_pressure_systolic is not null
                  then 'ضغط ' || vs.blood_pressure_systolic::text || '/' || coalesce(vs.blood_pressure_diastolic::text,'—') end,
             case when vs.heart_rate is not null then 'نبض ' || vs.heart_rate::text end,
             case when vs.temperature_celsius is not null then 'حرارة ' || vs.temperature_celsius::text end),
           null, 'medical_records', vs.id, null, vs.visit_id, null, vs.created_by,
           jsonb_build_object('bmi', vs.bmi)
    from patient_vital_signs vs
    where vs.patient_id = p_patient_id

    union all
    -- المختبر
    select 'lab_order:' || lo.id::text, 'lab_order', lo.ordered_at,
           'طلب مختبر',
           (select string_agg(lt.name_ar, '، ') from lab_order_items li
              join lab_tests lt on lt.id = li.lab_test_id where li.lab_order_id = lo.id),
           lo.status, 'laboratory', lo.id, null, lo.visit_id, lo.sales_invoice_id, null,
           jsonb_build_object('priority', lo.priority)
    from lab_orders lo
    where lo.patient_id = p_patient_id

    union all
    select 'lab_result:' || lo.id::text, 'lab_result', lo.completed_at,
           'ظهرت نتائج المختبر',
           (select string_agg(lt.name_ar || ': ' || coalesce(li.result_value,'—'), '، ')
              from lab_order_items li join lab_tests lt on lt.id = li.lab_test_id
             where li.lab_order_id = lo.id),
           lo.status, 'laboratory', lo.id, null, lo.visit_id, null, lo.verified_by,
           jsonb_build_object('abnormal',
             (select count(*) from lab_order_items li where li.lab_order_id = lo.id and li.is_abnormal))
    from lab_orders lo
    where lo.patient_id = p_patient_id and lo.completed_at is not null

    union all
    -- الأشعة
    select 'rad_order:' || ro.id::text, 'radiology_order', ro.ordered_at,
           'طلب أشعة',
           (select string_agg(re.name_ar, '، ') from radiology_order_items ri
              join radiology_exams re on re.id = ri.radiology_exam_id where ri.radiology_order_id = ro.id),
           ro.status, 'radiology', ro.id, null, ro.visit_id, ro.sales_invoice_id, null,
           jsonb_build_object('indication', ro.clinical_indication)
    from radiology_orders ro
    where ro.patient_id = p_patient_id

    union all
    select 'rad_report:' || ro.id::text, 'radiology_report', ro.reported_at,
           'صدر تقرير الأشعة',
           (select string_agg(coalesce(ri.impression, ri.findings), ' | ')
              from radiology_order_items ri where ri.radiology_order_id = ro.id),
           ro.status, 'radiology', ro.id, null, ro.visit_id, null, ro.reported_by, '{}'::jsonb
    from radiology_orders ro
    where ro.patient_id = p_patient_id and ro.reported_at is not null

    union all
    -- الوصفات والصرف
    select 'rx:' || pr.id::text, 'prescription', pr.issued_at,
           'وصفة طبية',
           (select string_agg(coalesce(it.name_ar,'دواء'), '، ') from prescription_items pi
              left join items it on it.id = pi.drug_item_id where pi.prescription_id = pr.id),
           pr.status, 'pharmacy', pr.id, null, pr.visit_id, null, null,
           jsonb_build_object('is_billed', pr.is_billed)
    from prescriptions pr
    where pr.patient_id = p_patient_id

    union all
    select 'dispense:' || dr.id::text, 'dispensing', dr.dispensed_at,
           'صرف دواء', null, dr.status, 'pharmacy', dr.id, null, null, dr.sales_invoice_id, null, '{}'::jsonb
    from dispensing_records dr
    where dr.patient_id = p_patient_id

    union all
    -- المال
    select 'invoice:' || s.id::text,
           case when s.invoice_type = 'return' then 'refund' else 'invoice' end,
           s.created_at,
           case when s.invoice_type = 'return' then 'فاتورة مرتجع' else 'فاتورة' end,
           'الصافي ' || s.net_amount::text || ' · المتبقّي ' || s.remaining_amount::text,
           s.status, 'billing', s.id, s.appointment_id, s.visit_id, s.id, s.created_by,
           jsonb_build_object('invoice_number', s.invoice_number,
                              'insurance_share', s.insurance_share_amount,
                              'patient_share', s.patient_share_amount)
    from sales_invoices s
    where s.patient_id = p_patient_id

    union all
    select 'voucher:' || fv.id::text, 'payment', fv.created_at,
           'سند ' || fv.voucher_type,
           'مبلغ ' || fv.amount::text || coalesce(' — ' || fv.description, ''),
           null, 'accounting', fv.id, null, null, fv.related_sales_invoice_id, fv.created_by, '{}'::jsonb
    from financial_vouchers fv
    where fv.patient_id = p_patient_id

    union all
    select 'claim:' || ci.id::text, 'insurance_claim', b.created_at,
           'مطالبة تأمين', 'دفعة ' || coalesce(b.batch_number::text,'—') || ' — مبلغ ' || ci.amount::text,
           b.status, 'insurance', ci.id, null, null, ci.sales_invoice_id, null, '{}'::jsonb
    from insurance_claim_batch_items ci
    join insurance_claim_batches b on b.id = ci.batch_id
    join sales_invoices s on s.id = ci.sales_invoice_id
    where s.patient_id = p_patient_id

    union all
    -- الرسائل والمستندات
    select 'msg:' || m.id::text, 'message', m.created_at,
           'رسالة ' || m.channel, left(coalesce(m.message_text, ''), 120),
           m.status, 'messaging', null, m.appointment_id, null, null, m.created_by,
           jsonb_build_object('event', m.event_key, 'error', m.last_error)
    from message_log m
    where m.patient_id = p_patient_id

    union all
    select 'doc:' || pd.id::text,
           case when pd.is_consent then 'consent' else 'document' end,
           pd.created_at,
           case when pd.is_consent then 'موافقة' else 'مستند' end,
           coalesce(pd.file_name, pd.category), null, 'documents',
           pd.id, null, pd.visit_id, null, pd.uploaded_by,
           jsonb_build_object('expires_at', pd.expires_at)
    from patient_documents pd
    where pd.patient_id = p_patient_id
  )
  select e.event_id, e.event_type, e.occurred_at, e.title, e.summary, e.status, e.module,
         e.entity_id, e.appointment_id, e.visit_id, e.invoice_id, e.created_by, e.metadata
  from events e
  where e.occurred_at is not null
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to   is null or e.occurred_at <= p_to)
    and (p_event_types is null or e.event_type = any (p_event_types))
  order by e.occurred_at desc, e.event_id;
end;
$$;

comment on function app_get_patient_timeline(uuid, timestamptz, timestamptz, text[]) is
  'خط زمني موحَّد لكل ما حدث للمريض: الملف، المواعيد وحالاتها، الاستقبال، الزيارات والتشخيصات والخدمات والمؤشرات، المختبر والأشعة والوصفات والصرف، الفواتير والسندات ومطالبات التأمين، الرسائل والمستندات. يتحقق من عضوية المستخدم في منشأة المريض.';

revoke all on function app_get_patient_timeline(uuid, timestamptz, timestamptz, text[]) from public, anon;
grant execute on function app_get_patient_timeline(uuid, timestamptz, timestamptz, text[]) to authenticated;

commit;
