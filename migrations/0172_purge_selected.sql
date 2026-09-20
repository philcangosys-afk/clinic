-- ---------------------------------------------------------------------------
-- 0172 — التفريغ بالتحديد: صفٌّ واحد أو عدّة صفوف لا الكلّ وحده
--
-- 0171 بنت ثلاث دوالّ تُفرّغ المنشأة كلّها. والمطلوب الآن أن يُحذف المحدَّد:
-- مريضٌ بعينه، أو ثلاثة أطباء، أو خدمتان — من شاشتها مباشرةً.
--
-- **والمنطق لا يُكرَّر:** سلاسل الحذف نفسها (٧٤ جدولًا للمريض، وما يُفرَّغ
-- ولا يُحذف للطبيب والصنف) تبقى كما هي واحدةً، ويُضاف إليها معاملٌ واحد
-- `p_ids`. فلو كان للتحديد مسارٌ وللكلّ مسارٌ آخر لافترقا مع الوقت: يُصلَح
-- عيبٌ في أحدهما ويبقى في الآخر.
--
--   p_ids = null  ⇒  كلّ صفوف المنشأة (سلوك 0171 كما هو)
--   p_ids = مصفوفة ⇒ المحدَّد وحده، **وما لا ينتمي للمنشأة يُرفَض** لا
--                    يُتجاهَل بصمت: تجاهلُه يُظهر «تمّ الحذف» وقد بقي الصفّ.
--
-- وتوقيع الدوالّ تغيّر، فتُحذف القديمة أوّلًا — `create or replace` لا تقبل
-- تغيير قائمة المعاملات بإضافة معاملٍ في الوسط.
-- ---------------------------------------------------------------------------

begin;

drop function if exists app_purge_patients(uuid, boolean);
drop function if exists app_purge_doctors(uuid, boolean);
drop function if exists app_purge_items(uuid, boolean);
-- ═══════════════════════════════════════════════════════════════════════════
-- ١) حذف كلّ المرضى — ومعهم كلّ ما تعلّق بهم
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_purge_patients(
  p_organization_id uuid,
  p_ids uuid[] default null,
  p_dry_run boolean default true
)
returns table (table_name text, affected int)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ids    uuid[];
  v_n      int;
  v_names  text[] := '{}';
  v_counts int[]  := '{}';
  i        int;
begin
  perform app_assert_purge_allowed(p_organization_id);

  select coalesce(array_agg(p.id), '{}') into v_ids
    from patients p
   where p.organization_id = p_organization_id
     and (p_ids is null or p.id = any(p_ids));

  -- ما طُلب حذفه ولا ينتمي لهذه المنشأة يُرفَض ولا يُتجاهَل: التجاهل يُظهر
  -- «تمّ الحذف» وقد بقي الصفّ سليمًا في منشأةٍ أخرى.
  if p_ids is not null
     and coalesce(array_length(v_ids, 1), 0) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'بعض ما حدّدته لا ينتمي لهذه المنشأة — حدِّث الصفحة وأعد التحديد';
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    table_name := 'لا صفوف مطابقة في هذه المنشأة'; affected := 0;
    return next; return;
  end if;

  -- كتلةٌ متداخلة = نقطة حفظ: التجربة تُنفّذ فعلًا ثمّ تتراجع، فالعدد حقيقيّ.
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
    delete from payroll_item_details where payroll_run_item_id in (select id from payroll_run_items where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'payroll_item_details'::text; v_counts := v_counts || v_n; end if;
    delete from payroll_run_items where paid_voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'payroll_run_items'::text; v_counts := v_counts || v_n; end if;
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
    delete from lab_result_amendments where lab_order_item_id in (select id from lab_order_items where patient_id = any(v_ids));
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
    delete from radiology_images where radiology_order_item_id in (select id from radiology_order_items where patient_id = any(v_ids));
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
      null;   -- تراجع كلّ شيء إلى نقطة الحفظ؛ الأعداد المجموعة تبقى
    else
      raise;
    end if;
  end;

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    table_name := v_names[i];
    affected   := v_counts[i];
    return next;
  end loop;

  table_name := case when p_dry_run
                     then '── تجربة فقط: لم يتغيّر شيء'
                     else '── تمّ التنفيذ نهائيًّا' end;
  affected := coalesce(array_length(v_ids, 1), 0);
  return next;
end
$fn$;

revoke all on function app_purge_patients(uuid, uuid[], boolean) from public, anon;
grant execute on function app_purge_patients(uuid, uuid[], boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) حذف كلّ الأطباء — وتاريخُ المنشأة يبقى بلا أسمائهم
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_purge_doctors(
  p_organization_id uuid,
  p_ids uuid[] default null,
  p_dry_run boolean default true
)
returns table (table_name text, affected int)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ids    uuid[];
  v_n      int;
  v_names  text[] := '{}';
  v_counts int[]  := '{}';
  i        int;
begin
  perform app_assert_purge_allowed(p_organization_id);

  select coalesce(array_agg(d.id), '{}') into v_ids
    from doctors d
   where d.organization_id = p_organization_id
     and (p_ids is null or d.id = any(p_ids));

  -- ما طُلب حذفه ولا ينتمي لهذه المنشأة يُرفَض ولا يُتجاهَل: التجاهل يُظهر
  -- «تمّ الحذف» وقد بقي الصفّ سليمًا في منشأةٍ أخرى.
  if p_ids is not null
     and coalesce(array_length(v_ids, 1), 0) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'بعض ما حدّدته لا ينتمي لهذه المنشأة — حدِّث الصفحة وأعد التحديد';
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    table_name := 'لا صفوف مطابقة في هذه المنشأة'; affected := 0;
    return next; return;
  end if;

  -- كتلةٌ متداخلة = نقطة حفظ: التجربة تُنفّذ فعلًا ثمّ تتراجع، فالعدد حقيقيّ.
  begin
    -- مصفوفاتٌ لا يراها مفتاح ربط: تُنزع منها المعرّفات المحذوفة
    update patients set participating_doctor_ids =
        (select coalesce(array_agg(x), '{}'::uuid[]) from unnest(participating_doctor_ids) x
          where not (x = any(v_ids)))
      where participating_doctor_ids && v_ids;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patients.participating_doctor_ids (تُنزع)'::text; v_counts := v_counts || v_n; end if;
    update consultation_fee_rules set doctor_ids =
        (select coalesce(array_agg(x), '{}'::uuid[]) from unnest(doctor_ids) x
          where not (x = any(v_ids)))
      where doctor_ids && v_ids;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'consultation_fee_rules.doctor_ids (تُنزع)'::text; v_counts := v_counts || v_n; end if;
    update packages set allowed_doctor_ids =
        (select coalesce(array_agg(x), '{}'::uuid[]) from unnest(allowed_doctor_ids) x
          where not (x = any(v_ids)))
      where allowed_doctor_ids && v_ids;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'packages.allowed_doctor_ids (تُنزع)'::text; v_counts := v_counts || v_n; end if;

    -- ١) فكّ الذِكر: أعمدةٌ اختيارية تُفرَّغ ولا تُحذف صفوفها
    update appointment_requests set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_requests.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update appointment_requests set referred_by_doctor_id = null where referred_by_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_requests.referred_by_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update appointment_waitlist set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_waitlist.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update cash_registers set assigned_doctor_id = null where assigned_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'cash_registers.assigned_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update cost_centers set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'cost_centers.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update critical_result_notifications set ordering_doctor_id = null where ordering_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'critical_result_notifications.ordering_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update dental_lab_orders set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dental_lab_orders.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update financial_vouchers set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'financial_vouchers.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_claim_forms set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_claim_forms.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_preauthorizations set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_preauthorizations.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update inventory_movements set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_movements.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update lab_orders set ordering_doctor_id = null where ordering_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_orders.ordering_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update medical_reports set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'medical_reports.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update patient_visit_services set performed_by = null where performed_by = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visit_services.performed_by (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update patient_visits set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visits.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update patients set treating_doctor_id = null where treating_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patients.treating_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update prescriptions set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'prescriptions.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update radiology_orders set ordering_doctor_id = null where ordering_doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_orders.ordering_doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update sales_invoice_items set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sales_invoice_items.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update sales_invoices set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sales_invoices.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update staff_requests set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'staff_requests.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update tooth_procedures set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'tooth_procedures.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update treatment_agreements set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_agreements.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update treatment_sessions set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_sessions.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update vital_sign_requests set doctor_id = null where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'vital_sign_requests.doctor_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;

    -- ٢) الحذف بترتيب الاعتماد: الابن قبل الأب. 7 جدولًا.
    delete from appointment_reminder_jobs where appointment_id in (select id from appointments where doctor_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointment_reminder_jobs'::text; v_counts := v_counts || v_n; end if;
    delete from appointments where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointments'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_branches where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_branches'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_clinics where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_clinics'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_schedules where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_schedules'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_services where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_services'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_working_hours where doctor_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_working_hours'::text; v_counts := v_counts || v_n; end if;

    v_names := v_names || 'doctors'::text;
    delete from doctors where id = any(v_ids);
    get diagnostics v_n = row_count;
    v_counts := v_counts || v_n;

    if p_dry_run then
      raise exception using errcode = 'P0001', message = 'ZAINCARE_DRY_RUN';
    end if;
  exception when others then
    if sqlerrm = 'ZAINCARE_DRY_RUN' then
      null;   -- تراجع كلّ شيء إلى نقطة الحفظ؛ الأعداد المجموعة تبقى
    else
      raise;
    end if;
  end;

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    table_name := v_names[i];
    affected   := v_counts[i];
    return next;
  end loop;

  table_name := case when p_dry_run
                     then '── تجربة فقط: لم يتغيّر شيء'
                     else '── تمّ التنفيذ نهائيًّا' end;
  affected := coalesce(array_length(v_ids, 1), 0);
  return next;
end
$fn$;

revoke all on function app_purge_doctors(uuid, uuid[], boolean) from public, anon;
grant execute on function app_purge_doctors(uuid, uuid[], boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) حذف كلّ الخدمات والأصناف — وسطور الفواتير تبقى بأسمائها المحفوظة
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_purge_items(
  p_organization_id uuid,
  p_ids uuid[] default null,
  p_dry_run boolean default true
)
returns table (table_name text, affected int)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ids    uuid[];
  v_n      int;
  v_names  text[] := '{}';
  v_counts int[]  := '{}';
  i        int;
begin
  perform app_assert_purge_allowed(p_organization_id);

  select coalesce(array_agg(i.id), '{}') into v_ids
    from items i
   where i.organization_id = p_organization_id
     and (p_ids is null or i.id = any(p_ids));

  -- ما طُلب حذفه ولا ينتمي لهذه المنشأة يُرفَض ولا يُتجاهَل: التجاهل يُظهر
  -- «تمّ الحذف» وقد بقي الصفّ سليمًا في منشأةٍ أخرى.
  if p_ids is not null
     and coalesce(array_length(v_ids, 1), 0) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'بعض ما حدّدته لا ينتمي لهذه المنشأة — حدِّث الصفحة وأعد التحديد';
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    table_name := 'لا صفوف مطابقة في هذه المنشأة'; affected := 0;
    return next; return;
  end if;

  -- كتلةٌ متداخلة = نقطة حفظ: التجربة تُنفّذ فعلًا ثمّ تتراجع، فالعدد حقيقيّ.
  begin
    -- ١) فكّ الذِكر: أعمدةٌ اختيارية تُفرَّغ ولا تُحذف صفوفها
    update appointments set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'appointments.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update consultation_fee_rules set consultation_item_id = null where consultation_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'consultation_fee_rules.consultation_item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update consultation_fee_rules set follow_up_item_id = null where follow_up_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'consultation_fee_rules.follow_up_item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_claim_form_items set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_claim_form_items.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_coverage_rules set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_coverage_rules.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_eligibility_checks set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_eligibility_checks.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update insurance_preauthorizations set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'insurance_preauthorizations.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update maintenance_order_parts set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'maintenance_order_parts.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update offer_items set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'offer_items.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update patient_allergies set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_allergies.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update patient_documents set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_documents.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update sales_invoice_items set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'sales_invoice_items.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update tooth_procedures set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'tooth_procedures.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update treatment_agreement_items set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_agreement_items.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;
    update treatment_sessions set item_id = null where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'treatment_sessions.item_id (تُفرَّغ)'::text; v_counts := v_counts || v_n; end if;

    -- ٢) الحذف بترتيب الاعتماد: الابن قبل الأب. 32 جدولًا.
    delete from dispensing_items where drug_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'dispensing_items'::text; v_counts := v_counts || v_n; end if;
    delete from doctor_services where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'doctor_services'::text; v_counts := v_counts || v_n; end if;
    delete from drug_details where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'drug_details'::text; v_counts := v_counts || v_n; end if;
    delete from purchase_return_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'purchase_return_items'::text; v_counts := v_counts || v_n; end if;
    delete from goods_receipt_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'goods_receipt_items'::text; v_counts := v_counts || v_n; end if;
    delete from inventory_movements where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_movements'::text; v_counts := v_counts || v_n; end if;
    delete from inventory_reservations where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_reservations'::text; v_counts := v_counts || v_n; end if;
    delete from stock_count_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'stock_count_items'::text; v_counts := v_counts || v_n; end if;
    delete from stock_transfer_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'stock_transfer_items'::text; v_counts := v_counts || v_n; end if;
    delete from inventory_lots where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'inventory_lots'::text; v_counts := v_counts || v_n; end if;
    delete from item_branches where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'item_branches'::text; v_counts := v_counts || v_n; end if;
    delete from item_claim_codes where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'item_claim_codes'::text; v_counts := v_counts || v_n; end if;
    delete from item_offers where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'item_offers'::text; v_counts := v_counts || v_n; end if;
    delete from item_resources where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'item_resources'::text; v_counts := v_counts || v_n; end if;
    delete from item_stock_settings where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'item_stock_settings'::text; v_counts := v_counts || v_n; end if;
    -- تُخطّى lab_result_amendments: أبوه بلا رابط مباشر
    delete from lab_order_items where lab_test_id in (select id from lab_tests where billing_item_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from lab_reference_ranges where lab_test_id in (select id from lab_tests where billing_item_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_reference_ranges'::text; v_counts := v_counts || v_n; end if;
    delete from lab_test_components where lab_test_id in (select id from lab_tests where billing_item_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_test_components'::text; v_counts := v_counts || v_n; end if;
    delete from lab_tests where billing_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'lab_tests'::text; v_counts := v_counts || v_n; end if;
    delete from patient_visit_services where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_visit_services'::text; v_counts := v_counts || v_n; end if;
    delete from patient_package_usages where package_item_id in (select id from package_items where item_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'patient_package_usages'::text; v_counts := v_counts || v_n; end if;
    delete from package_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'package_items'::text; v_counts := v_counts || v_n; end if;
    delete from prescription_items where drug_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'prescription_items'::text; v_counts := v_counts || v_n; end if;
    delete from price_list_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'price_list_items'::text; v_counts := v_counts || v_n; end if;
    delete from purchase_invoice_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'purchase_invoice_items'::text; v_counts := v_counts || v_n; end if;
    delete from purchase_order_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'purchase_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from purchase_request_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'purchase_request_items'::text; v_counts := v_counts || v_n; end if;
    delete from quick_invoice_group_items where item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'quick_invoice_group_items'::text; v_counts := v_counts || v_n; end if;
    -- تُخطّى radiology_images: أبوه بلا رابط مباشر
    delete from radiology_order_items where radiology_exam_id in (select id from radiology_exams where billing_item_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_order_items'::text; v_counts := v_counts || v_n; end if;
    delete from radiology_exams where billing_item_id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || 'radiology_exams'::text; v_counts := v_counts || v_n; end if;

    v_names := v_names || 'items'::text;
    delete from items where id = any(v_ids);
    get diagnostics v_n = row_count;
    v_counts := v_counts || v_n;

    if p_dry_run then
      raise exception using errcode = 'P0001', message = 'ZAINCARE_DRY_RUN';
    end if;
  exception when others then
    if sqlerrm = 'ZAINCARE_DRY_RUN' then
      null;   -- تراجع كلّ شيء إلى نقطة الحفظ؛ الأعداد المجموعة تبقى
    else
      raise;
    end if;
  end;

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    table_name := v_names[i];
    affected   := v_counts[i];
    return next;
  end loop;

  table_name := case when p_dry_run
                     then '── تجربة فقط: لم يتغيّر شيء'
                     else '── تمّ التنفيذ نهائيًّا' end;
  affected := coalesce(array_length(v_ids, 1), 0);
  return next;
end
$fn$;

revoke all on function app_purge_items(uuid, uuid[], boolean) from public, anon;
grant execute on function app_purge_items(uuid, uuid[], boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0172_purge_selected.sql
-- ---------------------------------------------------------------------------
