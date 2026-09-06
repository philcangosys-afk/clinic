-- ---------------------------------------------------------------------------
-- تشخيص فشل حفظ الفاتورة — المحاولة الثالثة، وهذه تحاكي نداء الشاشة حرفيًّا.
--
-- الفحص السابق نادى الدالّة بثلاثة معاملات فنجح، والشاشة تُرسل عشرين — فقد
-- يكون العطل في معاملٍ لم يُختبر. وهذا الملفّ:
--
--   ١) يعرض **كل** نسخ الدالّة (قد تبقى نسخة قديمة بجانب الجديدة فتلتبس على
--      PostgREST) وصلاحية التنفيذ على كلٍّ منها.
--   ٢) ينادي الدالّة بالمعاملات العشرين نفسها التي ترسلها الشاشة.
--   ٣) يُعيد رسالة القاعدة ورمزها كاملةً في جدول.
--
-- لا يبقى أثر: التجربة داخل كتلة استثناء تنتهي بخطأ مقصود، فتُلغى.
-- نفّذ الملفّ كلّه وانسخ الجدول.
-- ---------------------------------------------------------------------------

create or replace function app_probe_invoice_failure()
returns table ("الفحص" text, "النتيجة" text)
language plpgsql
security definer
set search_path = public, pg_temp
as $probe$
declare
  v_org uuid; v_actor uuid; v_patient uuid; v_item uuid; v_method uuid;
  v_register uuid; v_inv uuid;
  v_state text; v_msg text; v_detail text; v_hint text; v_ok boolean;
  f record;
begin
  -- (١) نسخ الدالّة وصلاحياتها — نسختان تعنيان التباسًا عند PostgREST -------
  for f in
    select p.oid, p.pronargs,
           coalesce(array_to_string(p.proargnames, ','), '') as args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as can_auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
     order by p.pronargs
  loop
    "الفحص" := '١) نسخة من دالّة الفاتورة (' || f.pronargs || ' معاملًا)';
    "النتيجة" := 'تنفيذ للمستخدم المُوثَّق=' || f.can_auth ||
                 ' · p_payments=' || (position('p_payments' in f.args) > 0)::text;
    return next;
  end loop;

  -- (٢) بيانات التجربة ------------------------------------------------------
  select id into v_org from organizations order by created_at limit 1;
  select user_id into v_actor from organization_memberships
   where organization_id = v_org and role_key = 'owner' and is_active limit 1;
  select id into v_patient from patients
   where organization_id = v_org and merged_into_id is null order by file_number limit 1;
  select id into v_item from items
   where organization_id = v_org and item_type = 'service'
     and not is_archived and not is_disabled order by code limit 1;
  select lv.id into v_method from lookup_values lv
    join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'payment_methods' and lv.code = 'cash' limit 1;
  select id into v_register from cash_registers
   where organization_id = v_org and not is_disabled order by name limit 1;

  "الفحص" := '٢) بيانات التجربة';
  "النتيجة" := 'مستخدم=' || coalesce(v_actor::text,'❌') ||
               ' · مريض=' || coalesce(v_patient::text,'❌') ||
               ' · خدمة=' || coalesce(v_item::text,'❌') ||
               ' · نقدي=' || coalesce(v_method::text,'❌') ||
               ' · صندوق=' || coalesce(v_register::text,'❌');
  return next;

  if v_actor is null or v_patient is null or v_item is null then
    "الفحص" := '⚠️'; "النتيجة" := 'نقص في بيانات التجربة'; return next; return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  -- (٣) النداء بالمعاملات العشرين نفسها التي ترسلها الشاشة -------------------
  v_ok := false;
  begin
    v_inv := app_create_sales_invoice(
      p_organization_id        => v_org,
      p_items                  => jsonb_build_array(jsonb_build_object(
                                    'item_id', v_item,
                                    'description', 'استشارة',
                                    'qty', 1,
                                    'price', 120,
                                    'discount_percent', 0,
                                    'is_vat_exempt', false,
                                    'agreement_item_id', null,
                                    'visit_service_id', null)),
      p_patient_id             => v_patient,
      p_external_customer_name => null,
      p_appointment_id         => null,
      p_visit_id               => null,
      p_doctor_id              => null,
      p_clinic_id              => null,
      p_warehouse_id           => null,
      p_invoice_type           => 'sale',
      p_is_insurance           => false,
      p_insurance              => '{}'::jsonb,
      p_is_temporary           => false,
      p_is_b2b                 => false,
      p_id_number              => null,
      p_note                   => null,
      p_lab_order_ids          => null,
      p_radiology_order_ids    => null,
      p_prescription_ids       => null,
      p_payments               => jsonb_build_array(jsonb_build_object(
                                    'amount', 138,
                                    'payment_method_value_id', v_method,
                                    'cash_register_id', v_register)));
    v_ok := true;
    raise exception 'PROBE_ROLLBACK';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail,
                            v_hint = pg_exception_hint, v_state = returned_sqlstate;
  end;
  "الفحص" := '٣) نداء بالمعاملات العشرين (نقدي ١٣٨ + صندوق)';
  "النتيجة" := case when v_ok then '✅ نجحت'
    else '❌ [' || coalesce(v_state,'') || '] ' || coalesce(v_msg,'') ||
         ' | تفصيل: ' || coalesce(v_detail,'—') || ' | تلميح: ' || coalesce(v_hint,'—') end;
  return next;

  -- (٤) وبلا دفعات، بنفس المعاملات — لعزل عطل التحصيل عن عطل الفوترة --------
  v_ok := false;
  begin
    v_inv := app_create_sales_invoice(
      p_organization_id        => v_org,
      p_items                  => jsonb_build_array(jsonb_build_object(
                                    'item_id', v_item, 'qty', 1, 'price', 120)),
      p_patient_id             => v_patient,
      p_external_customer_name => null,
      p_appointment_id         => null,
      p_visit_id               => null,
      p_doctor_id              => null,
      p_clinic_id              => null,
      p_warehouse_id           => null,
      p_invoice_type           => 'sale',
      p_is_insurance           => false,
      p_insurance              => '{}'::jsonb,
      p_is_temporary           => false,
      p_is_b2b                 => false,
      p_id_number              => null,
      p_note                   => null,
      p_lab_order_ids          => null,
      p_radiology_order_ids    => null,
      p_prescription_ids       => null,
      p_payments               => '[]'::jsonb);
    v_ok := true;
    raise exception 'PROBE_ROLLBACK';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
  end;
  "الفحص" := '٤) نفس النداء بلا دفعات';
  "النتيجة" := case when v_ok then '✅ نجحت'
    else '❌ [' || coalesce(v_state,'') || '] ' || coalesce(v_msg,'') end;
  return next;

  -- (٥) المناوبة المفتوحة على الصندوق — شرط القبض النقديّ -------------------
  "الفحص" := '٥) مناوبة مفتوحة على الصندوق';
  select coalesce(string_agg(cr.name || '=' || s.status, ', '), '❌ لا مناوبة مفتوحة')
    into "النتيجة"
    from cash_register_shifts s join cash_registers cr on cr.id = s.cash_register_id
   where s.status = 'open' and cr.organization_id = v_org;
  return next;

  -- (٦) صلاحية التحصيل في جدول الصلاحيات ------------------------------------
  "الفحص" := '٦) صلاحية cashier.receive للمستخدم';
  begin
    select app_has_permission(v_org, 'cashier.receive')::text into "النتيجة";
  exception when others then
    "النتيجة" := 'تعذّر الفحص: ' || sqlerrm;
  end;
  return next;
end;
$probe$;

select * from app_probe_invoice_failure();

drop function if exists app_probe_invoice_failure();
