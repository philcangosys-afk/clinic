-- ============================================================================
-- RESET — تفريغ المرضى والفواتير قبل التشغيل الحقيقي
-- ============================================================================
--
-- ⚠ **حذفٌ نهائيّ لا رجعة فيه.** يُنفَّذ مرّةً واحدة قبل أن تدخل البيانات
-- الحقيقية، ولا يُنفَّذ بعدها أبدًا. خذ نسخة احتياطية من Supabase أوّلًا
-- (Database ← Backups) إن أردت طريق عودة.
--
-- ما يُحذف:
--   * كلّ المرضى وكلّ ما تعلّق بهم (زيارات، مواعيد، وصفات، تحاليل، أشعة،
--     أسنان، موافقات، وثائق، محافظ) — بسلسلة الحذف نفسها التي في
--     `app_purge_patients` (0171): 75 جدولًا من الابن إلى الأب.
--   * ما تبقّى من الماليات بلا مريض: فواتير العملاء الخارجيين وبنودها،
--     السندات وتخصيصاتها، مناوبات الصناديق، اليوميات، وسجلّ إرسال ZATCA.
--   * تسلسل أرقام المستندات يعود إلى الصفر، فتبدأ أوّل فاتورة حقيقية من 1.
--
-- ما يبقى: الخدمات والأسعار والأصناف والأطباء والموظفون والمستودعات
-- والمستخدمون وإعدادات المنشأة وشجرة الحسابات.
--
-- منشأةٌ واحدة في كلّ تنفيذ: تُلتقط باسمها، ولا يُفرَّغ من المنشآت غيرها.
-- ============================================================================

begin;

do $$
declare
  v_org       uuid;
  v_ids       uuid[];
  v_stmt      text;
  v_patients  int;
  v_left      int;
  v_rel       record;
begin
  -- منشأةٌ بعينها إن حُدِّدت قبل التشغيل:
  --   select set_config('zaincare.target_org', '<معرّف المنشأة>', false);
  v_org := nullif(current_setting('zaincare.target_org', true), '')::uuid;

  if v_org is null then
    select id into v_org from public.organizations
     where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
     order by created_at limit 1;
  end if;
  if v_org is null then
    select id into v_org from public.organizations order by created_at limit 1;
  end if;
  if v_org is null then
    raise exception 'لا توجد منشأة في هذه القاعدة';
  end if;

  -- **يُقال أيّ منشأة تُفرَّغ قبل أن يُحذف صفٌّ واحد:** قاعدةٌ فيها أكثر من
  -- منشأة، وتفريغُ غير المقصودة لا يُكتشف إلّا بعد فوات الأوان.
  for v_rel in
    select o.name,
           (select count(*) from public.patients p where p.organization_id = o.id) as patients,
           (select count(*) from public.sales_invoices s where s.organization_id = o.id) as invoices
      from public.organizations o where o.id = v_org
  loop
    raise notice 'يُفرَّغ من: % (%) — % مريضًا، % فاتورة', v_rel.name, v_org, v_rel.patients, v_rel.invoices;
  end loop;

  -- المنشأة تُمرَّر إلى كتلة التحقّق: التحقّق بلا تقييدٍ بها كان يعدّ صفوف
  -- منشآتٍ أخرى في القاعدة نفسها ويرفع خطأً على تفريغٍ تمّ كما ينبغي.
  perform set_config('zaincare.reset_org', v_org::text, false);

  select count(*) into v_patients from public.patients where organization_id = v_org;

  -- ══ ٠) تعطيل حُرّاس المنع داخل هذه المعاملة وحدها ══════════════════════════
  --
  -- القاعدة فيها حُرّاس يمنعون المساس بما صدر: بنود الفاتورة الصادرة، وحذف
  -- السندات، وحركات المخزون، والقيود. وهي **صحيحة وتبقى**: حذف سطرٍ من فاتورةٍ
  -- مصدَرة أثناء التشغيل تزويرٌ محاسبيّ.
  --
  -- لكنّ التفريغ ليس تعديل سطر: الفاتورة كلّها تذهب مع مريضها، فلا سطرَ
  -- يُيتَّم ولا مجموعَ يختلّ — فالحارس هنا يحرس ما لم يعد له وجود. (وهذا
  -- بالضبط ما يفعله `PURGE_force.sql` لسبب الخطأ نفسه.)
  --
  -- والتعطيل أمر DDL يخضع للمعاملة: إن تعثّر شيء عاد كلّ حارسٍ مكانه بـ
  -- `rollback` بلا تدخّل، ويُعاد تمكينها صراحةً في آخر الكتلة قبل `commit`.
  -- وحُرّاس المفاتيح الأجنبية (`tgisinternal`) لا تُمَسّ، فترتيب الحذف يبقى
  -- محروسًا: جدولٌ نُسي في السلسلة يُوقف العملية ولا يترك صفًّا يتيمًا.
  for v_rel in
    select distinct c.relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I disable trigger user', v_rel.relname);
  end loop;

  -- ══ ١) المرضى ومعهم كلّ ما تعلّق بهم ══════════════════════════════════════
  -- سلسلة الحذف نفسها التي في `app_purge_patients` (0171) حرفًا بحرف، مكرَّرةً
  -- هنا عن قصد: الدالّة تفحص `auth.uid()` وتُرفض إن نُفِّذت من محرّر SQL في
  -- لوحة Supabase (دور `postgres` بلا مستخدم)، وهو المكان الذي يُنفَّذ منه هذا
  -- الملفّ. الترتيب من الابن إلى الأب — 75 جدولًا.
  --
  -- **ما لا وجود له يُتخطّى، وما عدا ذلك يُفجِّر العملية:** جدولٌ أو عمودٌ
  -- غير موجود في هذه النسخة من القاعدة يُذكر في رسالة ويُمضى، أمّا خطأ مفتاح
  -- أجنبيّ أو صلاحية فيوقف كلّ شيء — فلا يبقى نصف مريضٍ محذوفًا.
  v_ids := array(select id from public.patients where organization_id = v_org);

  foreach v_stmt in array array[
    $stmt$delete from sms_credit_transactions where related_message_id in (select id from message_log where patient_id = any($1))$stmt$,
    $stmt$delete from message_log where patient_id = any($1)$stmt$,
    $stmt$delete from appointment_reminder_jobs where appointment_id in (select id from appointments where patient_id = any($1))$stmt$,
    $stmt$delete from appointment_requests where patient_id = any($1)$stmt$,
    $stmt$delete from appointment_waitlist where patient_id = any($1)$stmt$,
    $stmt$delete from insurance_claim_form_items where form_id in (select id from insurance_claim_forms where patient_id = any($1))$stmt$,
    $stmt$delete from treatment_sessions where patient_id = any($1)$stmt$,
    $stmt$delete from sales_invoice_items where patient_id = any($1)$stmt$,
    $stmt$delete from tooth_procedures where patient_id = any($1)$stmt$,
    $stmt$delete from patient_visit_services where visit_id in (select id from patient_visits where patient_id = any($1))$stmt$,
    $stmt$delete from patient_package_usages where patient_package_id in (select id from patient_packages where patient_id = any($1))$stmt$,
    $stmt$delete from body_diagram_annotations where visit_id in (select id from patient_visits where patient_id = any($1))$stmt$,
    $stmt$delete from cbahi_forms where patient_id = any($1)$stmt$,
    $stmt$delete from dental_chart_entries where visit_id in (select id from patient_visits where patient_id = any($1))$stmt$,
    $stmt$delete from dental_lab_order_events where order_id in (select id from dental_lab_orders where patient_id = any($1))$stmt$,
    $stmt$delete from dental_lab_order_items where order_id in (select id from dental_lab_orders where patient_id = any($1))$stmt$,
    $stmt$delete from bank_reconciliation_lines where voucher_id in (select id from financial_vouchers where patient_id = any($1))$stmt$,
    $stmt$delete from insurance_settlement_claims where claim_form_id in (select id from insurance_claim_forms where patient_id = any($1))$stmt$,
    $stmt$delete from insurance_settlements where payment_voucher_id in (select id from financial_vouchers where patient_id = any($1))$stmt$,
    $stmt$delete from patient_wallet_transactions where patient_id = any($1)$stmt$,
    $stmt$delete from payroll_item_details where payroll_run_item_id in (select id from payroll_run_items where patient_id = any($1))$stmt$,
    $stmt$delete from payroll_run_items where paid_voucher_id in (select id from financial_vouchers where patient_id = any($1))$stmt$,
    $stmt$delete from voucher_invoice_allocations where voucher_id in (select id from financial_vouchers where patient_id = any($1))$stmt$,
    $stmt$delete from financial_vouchers where patient_id = any($1)$stmt$,
    $stmt$delete from dental_lab_orders where patient_id = any($1)$stmt$,
    $stmt$delete from nphies_messages where eligibility_check_id in (select id from insurance_eligibility_checks where patient_id = any($1))$stmt$,
    $stmt$delete from insurance_claim_forms where patient_id = any($1)$stmt$,
    $stmt$delete from insurance_preauthorizations where patient_id = any($1)$stmt$,
    $stmt$delete from insurance_eligibility_checks where patient_id = any($1)$stmt$,
    $stmt$delete from lab_result_amendments where lab_order_item_id in (select id from lab_order_items where patient_id = any($1))$stmt$,
    $stmt$delete from lab_order_items where lab_order_id in (select id from lab_orders where patient_id = any($1))$stmt$,
    $stmt$delete from lab_result_attachments where lab_order_id in (select id from lab_orders where patient_id = any($1))$stmt$,
    $stmt$delete from lab_orders where patient_id = any($1)$stmt$,
    $stmt$delete from medical_record_access_log where patient_id = any($1)$stmt$,
    $stmt$delete from medical_reports where patient_id = any($1)$stmt$,
    $stmt$delete from occupational_exam_results where patient_id = any($1)$stmt$,
    $stmt$delete from patient_consents where patient_id = any($1)$stmt$,
    $stmt$delete from patient_documents where patient_id = any($1)$stmt$,
    $stmt$delete from patient_visit_diagnoses where visit_id in (select id from patient_visits where patient_id = any($1))$stmt$,
    $stmt$delete from vital_sign_requests where patient_id = any($1)$stmt$,
    $stmt$delete from patient_vital_signs where patient_id = any($1)$stmt$,
    $stmt$delete from dispensing_items where dispensing_record_id in (select id from dispensing_records where patient_id = any($1))$stmt$,
    $stmt$delete from dispensing_records where patient_id = any($1)$stmt$,
    $stmt$delete from inventory_reservations where prescription_id in (select id from prescriptions where patient_id = any($1))$stmt$,
    $stmt$delete from prescription_items where prescription_id in (select id from prescriptions where patient_id = any($1))$stmt$,
    $stmt$delete from prescriptions where patient_id = any($1)$stmt$,
    $stmt$delete from radiology_images where radiology_order_item_id in (select id from radiology_order_items where patient_id = any($1))$stmt$,
    $stmt$delete from radiology_order_items where radiology_order_id in (select id from radiology_orders where patient_id = any($1))$stmt$,
    $stmt$delete from resource_bookings where patient_id = any($1)$stmt$,
    $stmt$delete from radiology_orders where patient_id = any($1)$stmt$,
    $stmt$delete from einvoice_documents where sales_invoice_id in (select id from sales_invoices where patient_id = any($1))$stmt$,
    $stmt$delete from insurance_claim_batch_items where sales_invoice_id in (select id from sales_invoices where patient_id = any($1))$stmt$,
    $stmt$delete from inventory_movements where patient_id = any($1)$stmt$,
    $stmt$delete from patient_packages where patient_id = any($1)$stmt$,
    $stmt$delete from sales_invoices where patient_id = any($1)$stmt$,
    $stmt$delete from staff_requests where patient_id = any($1)$stmt$,
    $stmt$delete from patient_visits where patient_id = any($1)$stmt$,
    $stmt$delete from appointments where patient_id = any($1)$stmt$,
    $stmt$delete from blocked_external_contacts where patient_id = any($1)$stmt$,
    $stmt$delete from critical_result_notifications where patient_id = any($1)$stmt$,
    $stmt$delete from generated_documents where patient_id = any($1)$stmt$,
    $stmt$delete from patient_allergies where patient_id = any($1)$stmt$,
    $stmt$delete from patient_change_requests where patient_id = any($1)$stmt$,
    $stmt$delete from patient_contacts where patient_id = any($1)$stmt$,
    $stmt$delete from patient_health_conditions where patient_id = any($1)$stmt$,
    $stmt$delete from patient_insurance_memberships where patient_id = any($1)$stmt$,
    $stmt$delete from patient_medical_history where patient_id = any($1)$stmt$,
    $stmt$delete from patient_notes where patient_id = any($1)$stmt$,
    $stmt$delete from patient_portal_accounts where patient_id = any($1)$stmt$,
    $stmt$delete from patient_tooth_status where patient_id = any($1)$stmt$,
    $stmt$delete from patient_wallets where patient_id = any($1)$stmt$,
    $stmt$delete from quality_incidents where patient_id = any($1)$stmt$,
    $stmt$delete from treatment_agreement_items where agreement_id in (select id from treatment_agreements where patient_id = any($1))$stmt$,
    $stmt$delete from treatment_agreements where patient_id = any($1)$stmt$,
    $stmt$delete from patients where id = any($1)$stmt$
  ] loop
    if coalesce(array_length(v_ids, 1), 0) = 0 then exit; end if;
    begin
      execute v_stmt using v_ids;
    exception
      when undefined_table or undefined_column then
        raise notice 'تُخطّي: %', left(v_stmt, 70);
    end;
  end loop;

  -- ══ ٢) ما تبقّى من الماليات بلا مريض، والترقيم يبدأ من جديد ═══════════════
  --
  -- فواتير العملاء الخارجيين وبنودها، والسندات وتخصيصاتها، والمناوبات،
  -- واليوميات، وسجلّ إرسال ZATCA، وتسلسل أرقام المستندات.
  --
  -- **عدّاد جهاز ZATCA لا يُحذف صفُّه**: يُعاد إلى أوّله (ICV = 1 والـPIH
  -- الابتدائيّ) ولأجهزة المحاكاة وحدها — عدّادُ جهازِ إنتاجٍ أرسل فعلًا إلى
  -- الهيئة لا يُعاد، فسلسلته عندهم لا عندنا.
  --
  -- الترتيب من الابن إلى الأب، والتسامح نفسه: ما لا وجود له يُتخطّى، وما
  -- بقي بعد ذلك يكشفه التحقّق في آخر الملفّ.
  foreach v_stmt in array array[
    $stmt$delete from public.zatca_invoice_submission_logs where organization_id = $1$stmt$,
    $stmt$update public.zatca_device_sequences s set next_icv = 1, last_pih = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==', reservation_token = null, reservation_expires_at = null from public.zatca_onboarding_settings o where o.id = s.onboarding_id and o.organization_id = $1 and o.mode = 'simulation'$stmt$,
    $stmt$delete from public.einvoice_documents where sales_invoice_id in (select id from public.sales_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.insurance_claim_batch_items where sales_invoice_id in (select id from public.sales_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.bank_reconciliation_lines where voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$delete from public.insurance_settlements where payment_voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$update public.payroll_run_items set paid_voucher_id = null where paid_voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$delete from public.voucher_invoice_allocations where voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$delete from public.sales_invoice_items where invoice_id in (select id from public.sales_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.financial_vouchers where organization_id = $1$stmt$,
    $stmt$delete from public.sales_invoices where organization_id = $1$stmt$,
    $stmt$delete from public.cash_register_shifts where cash_register_id in (select id from public.cash_registers where organization_id = $1)$stmt$,
    $stmt$delete from public.business_days where organization_id = $1$stmt$,
    $stmt$delete from public.document_number_sequences where organization_id = $1$stmt$
  ] loop
    begin
      execute v_stmt using v_org;
    exception
      when undefined_table or undefined_column then
        raise notice 'تُخطّي: %', left(v_stmt, 70);
    end;
  end loop;

  -- ══ ٤) إعادة الحُرّاس ═════════════════════════════════════════════════════
  for v_rel in
    select distinct c.relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I enable trigger user', v_rel.relname);
  end loop;

  select count(*) into v_left from public.sales_invoices where organization_id = v_org;
  raise notice 'حُذف % مريضًا، وبقي % فاتورة (يجب أن تكون صفرًا)', v_patients, v_left;
end $$;

-- تحقّق: لا مريض ولا فاتورة ولا سند **في المنشأة المفرَّغة**
do $$
declare
  v_org uuid := nullif(current_setting('zaincare.reset_org', true), '')::uuid;
  v_p int; v_i int; v_v int;
  r record;
begin
  if v_org is null then
    raise exception 'لم تُحدَّد المنشأة — لم تُنفَّذ الكتلة الأولى';
  end if;
  select count(*) into v_p from public.patients          where organization_id = v_org;
  select count(*) into v_i from public.sales_invoices    where organization_id = v_org;
  select count(*) into v_v from public.financial_vouchers where organization_id = v_org;
  if v_p + v_i + v_v > 0 then
    raise exception 'بقي في المنشأة المفرَّغة: % مريضًا، % فاتورة، % سندًا — راجع الرسائل أعلاه', v_p, v_i, v_v;
  end if;

  -- منشآتٌ أخرى في القاعدة نفسها: بياناتها لم تُمسّ عن قصد. تُذكر لتُفرَّغ
  -- بتشغيلٍ مستقلٍّ إن أُريد ذلك — لا يُفرَّغ من منشأتين في تنفيذٍ واحد.
  for r in
    select o.id, o.name,
           (select count(*) from public.patients p where p.organization_id = o.id)        as patients,
           (select count(*) from public.sales_invoices s where s.organization_id = o.id)  as invoices,
           (select count(*) from public.financial_vouchers f where f.organization_id = o.id) as vouchers
      from public.organizations o
     where o.id <> v_org
  loop
    if r.patients + r.invoices + r.vouchers > 0 then
      raise notice 'منشأة أخرى لم تُمسّ: % (%) — % مريضًا، % فاتورة، % سندًا',
        r.name, r.id, r.patients, r.invoices, r.vouchers;
    end if;
  end loop;
end $$;

-- تحقّق: لم يبقَ حارسٌ معطَّلًا قبل الإغلاق
do $$
declare v_off int;
begin
  select count(*) into v_off
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not t.tgisinternal and t.tgenabled = 'D';
  if v_off > 0 then
    raise exception 'بقي % حارسًا معطَّلًا — تُلغى المعاملة ويعود كلّ شيء', v_off;
  end if;
end $$;

commit;
