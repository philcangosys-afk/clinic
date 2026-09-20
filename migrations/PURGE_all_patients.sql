-- ############################################################################
-- ##  ⚠️  حذفٌ نهائيّ — لا تراجع بعده إلّا من نسخةٍ احتياطية.                ##
-- ##  يُزيل **كلّ مريض** ومعه كلّ ما تعلّق به: زياراته ومواعيده وفواتيره      ##
-- ##  وسنداته ووصفاته وتحاليله وأشعّته واتفاقياته ومحفظته وملفّاته.          ##
-- ############################################################################
--
-- هذا يخالف قاعدتك المكتوبة «لا حذف نهائيّ للبيانات الطبية أو المالية» — وهو
-- صوابٌ ما دام المحذوف بياناتِ تجربة قبل التشغيل الحقيقيّ. أقولها لأنّك مَن
-- وضع القاعدة، لا لأعترض.
--
-- **ما يُحذف معه من المال:** فواتير هؤلاء المرضى وسنداتها وتخصيصاتها
-- ومستنداتها الإلكترونية. ولا تُحذف فواتير العملاء الخارجيين ولا أيّ سندٍ لا
-- مريضَ له — الحذف مقيَّدٌ بمعرّفات المرضى وحدها.
--
-- **وأرقام الفواتير لا تعود:** التسلسل يمضي ولا يرجع، فأوّل فاتورةٍ بعد الحذف
-- تأخذ الرقم التالي لا الرقم ١. وهذا مقصود: رقمٌ يُعاد استعماله يكسر أثر
-- المراجعة.
--
-- ── كيف يُستعمل ───────────────────────────────────────────────────────────
--   ١) نفِّذ كتلة `create or replace function` أدناه (مرّة واحدة).
--   ٢) **تجربة** تعرض ما سيُحذف ولا تحذف شيئًا:
--        select * from app_purge_patients('<معرّف المنشأة>', true);
--   ٣) إن وافقك الجدول، **التنفيذ الحقيقيّ**:
--        select * from app_purge_patients('<معرّف المنشأة>', false);
--   ٤) احذف الدالّة بعد الفراغ:
--        drop function app_purge_patients(uuid, boolean);
--
--   ومعرّفات منشآتك:  select id, name from organizations;
--
-- ⚠ إن ردّت القاعدة «بنود الفاتورة الصادرة لا تُعدَّل ولا تُحذف» فذلك حُرّاسُ
--   المنع لا علّةٌ هنا — نفِّذ `PURGE_force.sql` واستعمل
--   `app_purge_patients_force` بدل هذه الدالّة.
--
-- الحذف كلّه داخل **عبارةٍ واحدة** — أي معاملة واحدة: إن تعثّر جدولٌ واحد لم
-- يتغيّر شيء. والتجربة تُنفِّذ الحذف فعلًا ثمّ تتراجع عنه، فالتقرير حقيقةٌ لا
-- تقدير: ما تراه هو ما سيقع.
-- ############################################################################

create or replace function app_purge_patients(
  p_organization_id uuid,
  p_dry_run boolean default true
)
returns table (اسم_الجدول text, المحذوف int)
language plpgsql
security definer
set search_path = public, pg_temp
as $purge$
declare
  v_ids    uuid[];
  v_n      int;
  v_names  text[] := '{}';
  v_counts int[]  := '{}';
  i        int;
begin
  if p_organization_id is null then
    raise exception 'حدِّد معرّف المنشأة — الحذف من كل المنشآت دفعةً واحدة ليس بابًا أفتحه';
  end if;
  if not exists (select 1 from organizations o where o.id = p_organization_id) then
    raise exception 'لا توجد منشأة بهذا المعرّف';
  end if;

  select coalesce(array_agg(p.id), '{}') into v_ids
    from patients p where p.organization_id = p_organization_id;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    اسم_الجدول := 'لا مرضى في هذه المنشأة'; المحذوف := 0;
    return next; return;
  end if;

  -- كتلةٌ متداخلة = نقطة حفظ: التجربة تحذف فعلًا ثمّ تتراجع، فالعدد حقيقيّ.
  begin
  -- الحذف بترتيب الاعتماد: الابن قبل الأب. 74 جدولًا.
    delete from sms_credit_transactions where related_message_id in (select id from message_log where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sms_credit_transactions'::text; v_counts := v_counts || v_n; end if;
    delete from message_log where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'message_log'::text; v_counts := v_counts || v_n; end if;
    delete from appointment_reminder_jobs where appointment_id in (select id from appointments where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_reminder_jobs'::text; v_counts := v_counts || v_n; end if;
    delete from appointment_requests where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_requests'::text; v_counts := v_counts || v_n; end if;
    delete from appointment_waitlist where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_waitlist'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_claim_form_items where form_id in (select id from insurance_claim_forms where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_claim_form_items'::text; v_counts := v_counts || v_n; end if;
    delete from treatment_sessions where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_sessions'::text; v_counts := v_counts || v_n; end if;
    delete from sales_invoice_items where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sales_invoice_items'::text; v_counts := v_counts || v_n; end if;
    delete from tooth_procedures where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'tooth_procedures'::text; v_counts := v_counts || v_n; end if;
    delete from patient_visit_services where visit_id in (select id from patient_visits where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visit_services'::text; v_counts := v_counts || v_n; end if;
    delete from patient_package_usages where patient_package_id in (select id from patient_packages where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_package_usages'::text; v_counts := v_counts || v_n; end if;
    delete from body_diagram_annotations where visit_id in (select id from patient_visits where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'body_diagram_annotations'::text; v_counts := v_counts || v_n; end if;
    delete from cbahi_forms where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'cbahi_forms'::text; v_counts := v_counts || v_n; end if;
    delete from dental_chart_entries where visit_id in (select id from patient_visits where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dental_chart_entries'::text; v_counts := v_counts || v_n; end if;
    delete from dental_lab_order_events where order_id in (select id from dental_lab_orders where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dental_lab_order_events'::text; v_counts := v_counts || v_n; end if;
    delete from dental_lab_order_items where order_id in (select id from dental_lab_orders where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dental_lab_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from bank_reconciliation_lines where voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'bank_reconciliation_lines'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_settlement_claims where claim_form_id in (select id from insurance_claim_forms where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_settlement_claims'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_settlements where payment_voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_settlements'::text; v_counts := v_counts || v_n; end if;
    delete from patient_wallet_transactions where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_wallet_transactions'::text; v_counts := v_counts || v_n; end if;
    -- رواتب الموظفين ليست من ملفّ المريض. `payroll_run_items` لا عمود
    -- `patient_id` فيه أصلًا، و`paid_voucher_id` اختياريّ بلا مفتاحٍ أجنبيّ —
    -- فيبقى صفّ الراتب ويُنزع منه الربط بالسند المحذوف. وحذفُ راتب موظّفٍ لأنّ
    -- مريضًا حُذف خطأٌ لا تنظيف. (وسندُ المريض ليس سندَ راتبٍ أصلًا، فالغالب
    -- ألّا يمسّ هذا صفًّا واحدًا — يبقى للاكتمال لا للأثر.)
    update payroll_run_items set paid_voucher_id = null
     where paid_voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'payroll_run_items.paid_voucher_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    delete from voucher_invoice_allocations where voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'voucher_invoice_allocations'::text; v_counts := v_counts || v_n; end if;
    delete from financial_vouchers where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'financial_vouchers'::text; v_counts := v_counts || v_n; end if;
    delete from dental_lab_orders where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dental_lab_orders'::text; v_counts := v_counts || v_n; end if;
    delete from nphies_messages where eligibility_check_id in (select id from insurance_eligibility_checks where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'nphies_messages'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_claim_forms where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_claim_forms'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_preauthorizations where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_preauthorizations'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_eligibility_checks where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_eligibility_checks'::text; v_counts := v_counts || v_n; end if;
    delete from lab_result_amendments where lab_order_item_id in (select id from lab_order_items where lab_order_id in (select id from lab_orders where patient_id = any(v_ids)));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_result_amendments'::text; v_counts := v_counts || v_n; end if;
    delete from lab_order_items where lab_order_id in (select id from lab_orders where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from lab_result_attachments where lab_order_id in (select id from lab_orders where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_result_attachments'::text; v_counts := v_counts || v_n; end if;
    delete from lab_orders where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_orders'::text; v_counts := v_counts || v_n; end if;
    delete from medical_record_access_log where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'medical_record_access_log'::text; v_counts := v_counts || v_n; end if;
    delete from medical_reports where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'medical_reports'::text; v_counts := v_counts || v_n; end if;
    delete from occupational_exam_results where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'occupational_exam_results'::text; v_counts := v_counts || v_n; end if;
    delete from patient_consents where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_consents'::text; v_counts := v_counts || v_n; end if;
    delete from patient_documents where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_documents'::text; v_counts := v_counts || v_n; end if;
    delete from patient_visit_diagnoses where visit_id in (select id from patient_visits where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visit_diagnoses'::text; v_counts := v_counts || v_n; end if;
    delete from vital_sign_requests where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'vital_sign_requests'::text; v_counts := v_counts || v_n; end if;
    delete from patient_vital_signs where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_vital_signs'::text; v_counts := v_counts || v_n; end if;
    delete from dispensing_items where dispensing_record_id in (select id from dispensing_records where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dispensing_items'::text; v_counts := v_counts || v_n; end if;
    delete from dispensing_records where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dispensing_records'::text; v_counts := v_counts || v_n; end if;
    delete from inventory_reservations where prescription_id in (select id from prescriptions where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_reservations'::text; v_counts := v_counts || v_n; end if;
    delete from prescription_items where prescription_id in (select id from prescriptions where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'prescription_items'::text; v_counts := v_counts || v_n; end if;
    delete from prescriptions where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'prescriptions'::text; v_counts := v_counts || v_n; end if;
    delete from radiology_images where radiology_order_item_id in (select id from radiology_order_items where radiology_order_id in (select id from radiology_orders where patient_id = any(v_ids)));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_images'::text; v_counts := v_counts || v_n; end if;
    delete from radiology_order_items where radiology_order_id in (select id from radiology_orders where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from resource_bookings where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'resource_bookings'::text; v_counts := v_counts || v_n; end if;
    delete from radiology_orders where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_orders'::text; v_counts := v_counts || v_n; end if;
    delete from einvoice_documents where sales_invoice_id in (select id from sales_invoices where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'einvoice_documents'::text; v_counts := v_counts || v_n; end if;
    delete from insurance_claim_batch_items where sales_invoice_id in (select id from sales_invoices where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_claim_batch_items'::text; v_counts := v_counts || v_n; end if;
    delete from inventory_movements where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_movements'::text; v_counts := v_counts || v_n; end if;
    delete from patient_packages where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_packages'::text; v_counts := v_counts || v_n; end if;
    delete from sales_invoices where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sales_invoices'::text; v_counts := v_counts || v_n; end if;
    delete from staff_requests where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'staff_requests'::text; v_counts := v_counts || v_n; end if;
    delete from patient_visits where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visits'::text; v_counts := v_counts || v_n; end if;
    delete from appointments where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointments'::text; v_counts := v_counts || v_n; end if;
    delete from blocked_external_contacts where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'blocked_external_contacts'::text; v_counts := v_counts || v_n; end if;
    delete from critical_result_notifications where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'critical_result_notifications'::text; v_counts := v_counts || v_n; end if;
    delete from generated_documents where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'generated_documents'::text; v_counts := v_counts || v_n; end if;
    delete from patient_allergies where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_allergies'::text; v_counts := v_counts || v_n; end if;
    delete from patient_change_requests where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_change_requests'::text; v_counts := v_counts || v_n; end if;
    delete from patient_contacts where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_contacts'::text; v_counts := v_counts || v_n; end if;
    delete from patient_health_conditions where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_health_conditions'::text; v_counts := v_counts || v_n; end if;
    delete from patient_insurance_memberships where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_insurance_memberships'::text; v_counts := v_counts || v_n; end if;
    delete from patient_medical_history where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_medical_history'::text; v_counts := v_counts || v_n; end if;
    delete from patient_notes where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_notes'::text; v_counts := v_counts || v_n; end if;
    delete from patient_portal_accounts where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_portal_accounts'::text; v_counts := v_counts || v_n; end if;
    delete from patient_tooth_status where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_tooth_status'::text; v_counts := v_counts || v_n; end if;
    delete from patient_wallets where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_wallets'::text; v_counts := v_counts || v_n; end if;
    delete from quality_incidents where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'quality_incidents'::text; v_counts := v_counts || v_n; end if;
    delete from treatment_agreement_items where agreement_id in (select id from treatment_agreements where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_agreement_items'::text; v_counts := v_counts || v_n; end if;
    delete from treatment_agreements where patient_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_agreements'::text; v_counts := v_counts || v_n; end if;
    v_names := v_names || 'patients'::text;
    delete from patients where id = any(v_ids);
    get diagnostics v_n = row_count;
    v_counts := v_counts || v_n;

    if p_dry_run then
      raise exception using errcode = 'P0001', message = 'ZAINCARE_DRY_RUN';
    end if;
  exception when others then
    if sqlerrm = 'ZAINCARE_DRY_RUN' then
      -- تراجعت كل عمليات الحذف إلى نقطة الحفظ؛ الأعداد المجموعة تبقى.
      null;
    else
      raise;
    end if;
  end;

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    اسم_الجدول := v_names[i];
    المحذوف    := v_counts[i];
    return next;
  end loop;

  اسم_الجدول := case when p_dry_run
                     then '── تجربة فقط: لم يُحذف شيء. أعِد النداء بـ false للتنفيذ'
                     else '── تمّ الحذف نهائيًّا' end;
  المحذوف := coalesce(array_length(v_ids, 1), 0);
  return next;
end
$purge$;

revoke all on function app_purge_patients(uuid, boolean) from public, anon, authenticated;
