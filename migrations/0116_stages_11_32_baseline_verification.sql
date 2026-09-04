begin;

do $$
begin
  if not (
    to_regprocedure('public.app_create_invoice_from_visit(uuid,boolean,uuid,text)') is not null
    and to_regprocedure('public.app_generate_einvoice(uuid)') is not null
    and to_regprocedure('public.app_create_claim_from_visit(uuid,uuid,text)') is not null
    and to_regclass('public.v_report_revenue') is not null
    -- توقيعان مقبولان: الخماسي (المرحلة 15) والسداسي بعد أن أضافت 0125
    -- وسيطًا سادسًا وأسقطت الخماسي. تثبيت الخماسي وحده كان يجعل إعادة تشغيل
    -- هذا الملف تفشل بعد 0125 برسالة «كائن رئيسي غير موجود» — والكائن موجود
    -- بتوقيع أحدث. التحقّق يسأل عن الدالّة لا عن شكل توقيعها.
    and (to_regprocedure('public.app_log_record_access(uuid,text,text,text,uuid)') is not null
      or to_regprocedure('public.app_log_record_access(uuid,text,text,text,uuid,text)') is not null)
    and to_regprocedure('public.app_sell_package(uuid,uuid,uuid,uuid,uuid,text)') is not null
    and to_regprocedure('public.app_create_purchase_order(uuid,uuid,date,text)') is not null
    and to_regprocedure('public.app_start_stock_count(uuid,text,text,uuid[],text)') is not null
    and to_regprocedure('public.app_post_journal_entry(uuid)') is not null
    and to_regprocedure('public.app_calculate_payroll_run(uuid)') is not null
    and to_regprocedure('public.app_post_asset_depreciation(uuid,date)') is not null
    and to_regprocedure('public.app_sign_document(text,uuid,text,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.app_notify_event(uuid,text,text,text,text,text,uuid,text,uuid)') is not null
    and to_regprocedure('public.app_portal_request_appointment(uuid,uuid,uuid,date,text,text)') is not null
    and to_regprocedure('public.app_acknowledge_critical_result(uuid,text,text)') is not null
    and to_regprocedure('public.app_report_quality_incident(uuid,text,text,text,uuid,uuid,timestamptz,text,text,boolean)') is not null
    and to_regprocedure('public.app_save_org_policies(uuid,jsonb)') is not null
    and to_regprocedure('public.app_set_membership_role(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.app_save_locale_settings(uuid,jsonb)') is not null
    and to_regprocedure('public.app_mark_integration_attempt(text,uuid,boolean,text)') is not null
    and to_regprocedure('public.app_analytics_summary(uuid,date,date)') is not null
    and to_regprocedure('public.app_launch_readiness(uuid)') is not null
  ) then
    raise exception 'فشل تحقق Baseline للمراحل 11-32: كائن رئيسي واحد أو أكثر غير موجود';
  end if;
end
$$;

commit;
