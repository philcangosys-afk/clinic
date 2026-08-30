-- ---------------------------------------------------------------------------
-- 0057_visit_orders_billing.sql — فوترة طلبات الزيارة (مختبر/أشعة/وصفة)
-- ---------------------------------------------------------------------------
-- بعد أن صار الطبيب يُصدر الطلبات من داخل الزيارة (0056 + `VisitOrders`)،
-- بقيت الحلقة الأخيرة مقطوعة: **لا شيء يفوتر تلك الطلبات**.
--
-- الأعمدة موجودة ومهجورة منذ 2013 من الترقيم:
--
--   • `lab_tests.billing_item_id` و`radiology_exams.billing_item_id` —
--     مُعلَّق عليهما في 0013/0014 بـ«الربط بكتالوج الفوترة»، ولا قراءة ولا
--     كتابة لهما في الواجهة كلها. فحصٌ بلا صنف = فحصٌ بلا سعر ولا معاملة
--     ضريبية. (أُضيف حقل الربط الآن في شاشتَي المختبر والأشعة.)
--
--   • `lab_orders.sales_invoice_id` و`radiology_orders.sales_invoice_id` —
--     مُعلَّق عليهما «يُملأ عند الفوترة». لم يُملآ قط. فلا أحد يعرف أي فاتورة
--     دفعت أي طلب، ولا يمنع شيءٌ فوترة الطلب مرتين.
--
--   • `prescriptions.is_billed` — يُقلَّب **يدويًا** بزر في شاشة الصيدلية،
--     لا من عملية الفوترة. علامة صحيحة بالصدفة لا بالبناء.
--
-- الأثر عمليًا: الطبيب يطلب تحليلًا وصورة، وينفَّذان، ثم يفتح المحاسب
-- الفاتورة فلا يرى إلا خدمات الزيارة. فإمّا يعيد إدخالهما بالاسم والسعر
-- تخمينًا، وإمّا يسقطان — وهو الأشيع. إيراد منفَّذ ولا يُحصَّل.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) منظور الطلبات غير المفوترة لزيارة
--
-- سطر لكل بند قابل للفوترة. `item_id` قد يكون NULL حين لا يكون الفحص مربوطًا
-- بصنف — ويُعرض عندها في الواجهة معطَّلًا مع سبب صريح («اربط الفحص بصنف
-- فوترة») بدل أن يختفي بلا تفسير. الإخفاء الصامت هو ما جعل هذه الأعمدة تُنسى
-- ثلاث عشرة هجرةً كاملة.
-- ---------------------------------------------------------------------------
create or replace view v_visit_orders_unbilled as
  select
    'lab'::text                            as source_type,
    lo.id                                  as source_order_id,
    loi.id                                 as source_item_id,
    lo.organization_id,
    lo.visit_id,
    lo.patient_id,
    lt.billing_item_id                     as item_id,
    coalesce(i.name_ar, lt.name_ar)        as item_name,
    lt.name_ar                             as source_name,
    1::numeric                             as qty,
    coalesce(i.price, 0)::numeric          as unit_price,
    coalesce(i.is_vat_exempt, false)       as is_vat_exempt
  from lab_orders lo
  join lab_order_items loi on loi.lab_order_id = lo.id
  join lab_tests lt        on lt.id = loi.lab_test_id
  left join items i        on i.id = lt.billing_item_id
  where lo.visit_id is not null
    and lo.sales_invoice_id is null
    and lo.status <> 'cancelled'

  union all

  select
    'radiology'::text,
    ro.id,
    roi.id,
    ro.organization_id,
    ro.visit_id,
    ro.patient_id,
    re.billing_item_id,
    coalesce(i.name_ar, re.name_ar),
    re.name_ar,
    1::numeric,
    coalesce(i.price, 0)::numeric,
    coalesce(i.is_vat_exempt, false)
  from radiology_orders ro
  join radiology_order_items roi on roi.radiology_order_id = ro.id
  join radiology_exams re        on re.id = roi.radiology_exam_id
  left join items i              on i.id = re.billing_item_id
  where ro.visit_id is not null
    and ro.sales_invoice_id is null
    and ro.status <> 'cancelled'

  union all

  -- الوصفة: `prescription_items.drug_item_id` صنفٌ في الكتالوج أصلًا، فلا
  -- حاجة لعمود ربط. الكمية هي الموصوفة لا المصروفة: الفاتورة تُصدر عند
  -- الصرف عادةً، والفرق بينهما شأن الصيدلية لا شأن هذا المنظور.
  select
    'prescription'::text,
    pr.id,
    pi.id,
    pr.organization_id,
    pr.visit_id,
    pr.patient_id,
    pi.drug_item_id,
    coalesce(i.name_ar, 'دواء'),
    coalesce(i.name_ar, 'دواء'),
    pi.quantity_prescribed::numeric,
    coalesce(i.price, 0)::numeric,
    coalesce(i.is_vat_exempt, false)
  from prescriptions pr
  join prescription_items pi on pi.prescription_id = pr.id
  left join items i          on i.id = pi.drug_item_id
  where pr.visit_id is not null
    and pr.is_billed = false
    and pr.status <> 'cancelled';

-- `security_invoker` حتى يرث المنظور سياسات RLS للمستخدم السائل لا لمالك
-- المنظور — نفس ما فُرض على كل المناظير في 0051.
alter view v_visit_orders_unbilled set (security_invoker = on);
revoke all on v_visit_orders_unbilled from anon;
grant select on v_visit_orders_unbilled to authenticated;

-- ---------------------------------------------------------------------------
-- 2) `app_create_sales_invoice` — ختم الطلبات بالفاتورة داخل نفس المعاملة
--
-- **الدالة القديمة تُسقَط قبل إنشاء الجديدة.** إضافة معاملات بقيم افتراضية
-- تُنشئ دالة ثانية بنفس الاسم، فيصير النداء القديم مطابقًا للاثنتين وترفض
-- القاعدة: `function app_create_sales_invoice(...) is not unique`. أي أن
-- «الإضافة اللطيفة» كانت ستكسر كل فوترة في النظام.
-- ---------------------------------------------------------------------------
drop function if exists app_create_sales_invoice(
  uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid,
  boolean, jsonb, numeric, boolean, boolean, text, text);

create or replace function app_create_sales_invoice(
  p_organization_id        uuid,
  p_items                  jsonb,
  p_patient_id             uuid    default null,
  p_external_customer_name text    default null,
  p_appointment_id         uuid    default null,
  p_visit_id               uuid    default null,
  p_doctor_id              uuid    default null,
  p_clinic_id              uuid    default null,
  p_warehouse_id           uuid    default null,
  p_invoice_type           text    default 'sale',
  p_original_invoice_id    uuid    default null,
  p_is_insurance           boolean default false,
  p_insurance              jsonb   default '{}'::jsonb,
  p_paid_amount            numeric default 0,
  p_is_temporary           boolean default false,
  p_is_b2b                 boolean default false,
  p_id_number              text    default null,
  p_note                   text    default null,
  p_lab_order_ids          uuid[]  default null,
  p_radiology_order_ids    uuid[]  default null,
  p_prescription_ids       uuid[]  default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id   uuid;
  v_vat_rate     numeric;
  v_vat_enabled  boolean;
  v_subtotal     numeric(14,2) := 0;
  v_discount     numeric(14,2) := 0;
  v_vat          numeric(14,2) := 0;
  v_exemption    numeric(14,2) := 0;
  v_net          numeric(14,2) := 0;
  v_paid         numeric(14,2);
  v_status       text;
  v_copay        numeric;
  v_max          numeric;
  v_ins_share    numeric(14,2) := 0;
  v_pat_share    numeric(14,2) := 0;
  v_count        integer;
  v_expected     integer;
  v_stamped      integer;
begin
  -- (أ) الهوية والعضوية والدور -----------------------------------------------
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(p_organization_id,
        array['owner','organization_admin','branch_manager','accountant','receptionist']) then
    raise exception 'صلاحيتك لا تسمح بإصدار الفواتير';
  end if;

  if p_invoice_type not in ('sale','return') then
    raise exception 'نوع فاتورة غير معروف: %', p_invoice_type;
  end if;
  if p_patient_id is null and coalesce(btrim(p_external_customer_name),'') = '' then
    raise exception 'اختر مريضًا أو أدخل اسم عميل خارجي';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'أضف بندًا واحدًا على الأقل';
  end if;

  -- (ب) عزل المنشآت ----------------------------------------------------------
  if p_patient_id is not null and not exists (
       select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_doctor_id is not null and not exists (
       select 1 from doctors where id = p_doctor_id and organization_id = p_organization_id) then
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
  if p_visit_id is not null and not exists (
       select 1 from patient_visits where id = p_visit_id and organization_id = p_organization_id) then
    raise exception 'الزيارة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;

  select count(*) into v_count
    from jsonb_array_elements(p_items) e
   where nullif(e ->> 'item_id','') is not null
     and not exists (select 1 from items i
                      where i.id = (e ->> 'item_id')::uuid
                        and i.organization_id = p_organization_id);
  if v_count > 0 then
    raise exception '% من الأصناف لا تنتمي لهذه المنشأة', v_count;
  end if;

  select count(*) into v_count
    from jsonb_array_elements(p_items) e
   where nullif(e ->> 'visit_service_id','') is not null
     and not exists (
       select 1 from patient_visit_services s
        where s.id = (e ->> 'visit_service_id')::uuid
          and s.organization_id = p_organization_id
          and (p_visit_id is null or s.visit_id = p_visit_id));
  if v_count > 0 then
    raise exception '% من الخدمات لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
  end if;

  -- الطلبات المُمرَّرة: من هذه المنشأة، ومن الزيارة نفسها إن حُدِّدت. بدون هذا
  -- أمكن تمرير معرّف طلب من زيارة مريض آخر فيُختَم بفاتورة لا تخصّه.
  if p_lab_order_ids is not null and array_length(p_lab_order_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_lab_order_ids) x(id)
     where not exists (
       select 1 from lab_orders o
        where o.id = x.id
          and o.organization_id = p_organization_id
          and (p_visit_id is null or o.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من طلبات المختبر لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;
  if p_radiology_order_ids is not null and array_length(p_radiology_order_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_radiology_order_ids) x(id)
     where not exists (
       select 1 from radiology_orders o
        where o.id = x.id
          and o.organization_id = p_organization_id
          and (p_visit_id is null or o.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من طلبات الأشعة لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;
  if p_prescription_ids is not null and array_length(p_prescription_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_prescription_ids) x(id)
     where not exists (
       select 1 from prescriptions pr
        where pr.id = x.id
          and pr.organization_id = p_organization_id
          and (p_visit_id is null or pr.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من الوصفات لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;

  -- (ج) نسبة الضريبة — من القاعدة لا من العميل ------------------------------
  select o.default_vat_rate into v_vat_rate from organizations o where o.id = p_organization_id;
  select coalesce(s.sales_vat_enabled, true) into v_vat_enabled
    from organization_vat_settings s where s.organization_id = p_organization_id;
  v_vat_rate := coalesce(v_vat_rate, 0);
  if not coalesce(v_vat_enabled, true) then
    v_vat_rate := 0;
  end if;

  -- (د) رأس الفاتورة بمبالغ صفرية، ثم تُحسب من البنود المُدرَجة فعلًا -------
  insert into sales_invoices (
    organization_id, invoice_type, original_invoice_id,
    patient_id, external_customer_name, appointment_id, visit_id,
    doctor_id, clinic_id, warehouse_id,
    is_temporary, is_b2b, id_number, note, created_by,
    is_insurance_invoice,
    insurance_company_name, insurance_policy_number, insurance_class_number,
    insurance_membership_number, insurance_copay_percent, insurance_max_amount,
    insurance_approval_number,
    subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, paid_amount
  ) values (
    p_organization_id, p_invoice_type, p_original_invoice_id,
    p_patient_id, nullif(btrim(p_external_customer_name),''), p_appointment_id, p_visit_id,
    p_doctor_id, p_clinic_id, p_warehouse_id,
    coalesce(p_is_temporary,false), coalesce(p_is_b2b,false),
    nullif(btrim(p_id_number),''), nullif(btrim(p_note),''), auth.uid(),
    coalesce(p_is_insurance,false),
    nullif(btrim(p_insurance ->> 'company_name'),''),
    nullif(btrim(p_insurance ->> 'policy_number'),''),
    nullif(btrim(p_insurance ->> 'class_number'),''),
    nullif(btrim(p_insurance ->> 'membership_number'),''),
    nullif(p_insurance ->> 'copay_percent','')::numeric,
    nullif(p_insurance ->> 'max_amount','')::numeric,
    nullif(btrim(p_insurance ->> 'approval_number'),''),
    0, 0, 0, 0, 0, 0
  ) returning id into v_invoice_id;

  -- (هـ) البنود ---------------------------------------------------------------
  insert into sales_invoice_items (
    invoice_id, item_id, description, qty, price,
    discount_percent, discount_amount, vat_rate, vat_amount, exemption_amount,
    net_amount, doctor_id, agreement_item_id, line_type, source_barcode,
    visit_service_id
  )
  select
    v_invoice_id,
    nullif(e ->> 'item_id','')::uuid,
    coalesce(nullif(btrim(e ->> 'description'),''), i.name_ar, 'بند'),
    q.qty,
    q.price,
    q.disc_pct,
    q.line_discount,
    case when q.exempt then 0 else v_vat_rate end,
    q.line_vat,
    case when q.exempt then q.taxable else 0 end,
    q.taxable + q.line_vat,
    nullif(e ->> 'doctor_id','')::uuid,
    nullif(e ->> 'agreement_item_id','')::uuid,
    case
      when nullif(btrim(e ->> 'line_type'),'') in ('normal','follow_up','agreement')
        then btrim(e ->> 'line_type')
      when nullif(e ->> 'agreement_item_id','') is not null then 'agreement'
      else 'normal'
    end,
    nullif(btrim(e ->> 'source_barcode'),''),
    nullif(e ->> 'visit_service_id','')::uuid
  from jsonb_array_elements(p_items) e
  left join items i on i.id = nullif(e ->> 'item_id','')::uuid
  cross join lateral (
    select
      gq.qty, gq.price, gq.disc_pct, gq.exempt,
      round(gq.qty * gq.price, 2)                                   as line_subtotal,
      round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)             as line_discount,
      round(gq.qty * gq.price, 2)
        - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)         as taxable,
      case when gq.exempt then 0
           else round((round(gq.qty * gq.price, 2)
                       - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2))
                      * v_vat_rate / 100.0, 2) end                  as line_vat
    from (
      select
        greatest(coalesce(nullif(e ->> 'qty','')::numeric, 1), 0)          as qty,
        coalesce(nullif(e ->> 'price','')::numeric, i.price, 0)            as price,
        least(greatest(coalesce(nullif(e ->> 'discount_percent','')::numeric, 0), 0), 100) as disc_pct,
        coalesce(nullif(e ->> 'is_vat_exempt','')::boolean, i.is_vat_exempt, false) as exempt
    ) gq
  ) q;

  -- (و) الإجماليات من الصفوف المُدرَجة --------------------------------------
  select
    coalesce(sum(round(qty * price, 2)), 0),
    coalesce(sum(discount_amount), 0),
    coalesce(sum(vat_amount), 0),
    coalesce(sum(exemption_amount), 0),
    coalesce(sum(net_amount), 0)
  into v_subtotal, v_discount, v_vat, v_exemption, v_net
  from sales_invoice_items where invoice_id = v_invoice_id;

  -- (ز) حصّتا التأمين والمريض ------------------------------------------------
  if coalesce(p_is_insurance, false) then
    v_copay := coalesce(nullif(p_insurance ->> 'copay_percent','')::numeric, 0);
    v_copay := least(greatest(v_copay, 0), 100);
    v_max   := nullif(p_insurance ->> 'max_amount','')::numeric;

    v_pat_share := round(v_net * v_copay / 100.0, 2);
    v_ins_share := v_net - v_pat_share;

    if v_max is not null and v_ins_share > v_max then
      v_ins_share := v_max;
      v_pat_share := v_net - v_ins_share;
    end if;
  else
    v_pat_share := v_net;
    v_ins_share := 0;
  end if;

  -- (ح) المدفوع والحالة ------------------------------------------------------
  v_paid := greatest(coalesce(p_paid_amount, 0), 0);
  v_paid := least(v_paid, v_pat_share);

  v_status := case
    when p_is_temporary then 'unpaid'
    when v_paid >= v_net then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid' end;

  update sales_invoices
     set subtotal_amount        = v_subtotal,
         discount_amount        = v_discount,
         vat_amount             = v_vat,
         exemption_amount       = v_exemption,
         net_amount             = v_net,
         insurance_share_amount = v_ins_share,
         patient_share_amount   = v_pat_share,
         paid_amount            = v_paid,
         status                 = v_status
   where id = v_invoice_id;

  -- (ط) ختم الطلبات بالفاتورة -------------------------------------------------
  --
  -- شرط `sales_invoice_id is null` هو حارس التزامن: لو فُوتِر الطلب في فاتورة
  -- أخرى بين لحظة العرض ولحظة الحفظ، لم يطابق التحديث شيئًا — فيختلف العدد
  -- وتُلغى المعاملة كلها. الاعتماد على الفحص المسبق وحده كان سيسمح بفوترة
  -- الطلب مرتين لمحاسبَيْن فتحا الشاشة معًا.
  --
  -- ولا خَتْم في فاتورة **مرتجعة**: المرتجع لا يُفوتِر الطلب بل يعكس فاتورة
  -- سابقة، وختمه به كان سيجعل الطلب مربوطًا بمرتجع لا بفاتورته الأصلية.
  if p_invoice_type = 'sale' then
    if p_lab_order_ids is not null and array_length(p_lab_order_ids, 1) > 0 then
      v_expected := array_length(p_lab_order_ids, 1);
      update lab_orders
         set sales_invoice_id = v_invoice_id
       where id = any (p_lab_order_ids)
         and organization_id = p_organization_id
         and sales_invoice_id is null;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'أحد طلبات المختبر فُوتِر في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;

    if p_radiology_order_ids is not null and array_length(p_radiology_order_ids, 1) > 0 then
      v_expected := array_length(p_radiology_order_ids, 1);
      update radiology_orders
         set sales_invoice_id = v_invoice_id
       where id = any (p_radiology_order_ids)
         and organization_id = p_organization_id
         and sales_invoice_id is null;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'أحد طلبات الأشعة فُوتِر في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;

    if p_prescription_ids is not null and array_length(p_prescription_ids, 1) > 0 then
      v_expected := array_length(p_prescription_ids, 1);
      update prescriptions
         set is_billed = true
       where id = any (p_prescription_ids)
         and organization_id = p_organization_id
         and is_billed = false;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'إحدى الوصفات فُوتِرت في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;
  end if;

  return v_invoice_id;

exception
  when unique_violation then
    if sqlerrm like '%uq_invoice_item_visit_service%' then
      raise exception 'إحدى الخدمات المحدَّدة مفوترة في فاتورة سابقة — حدِّث الصفحة لترى الخدمات غير المفوترة فقط';
    end if;
    raise;
end;
$$;

comment on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[]) is
  'إنشاء فاتورة مبيعات كاملة (رأس + بنود + إجماليات + حصص التأمين) وختم طلبات المختبر والأشعة والوصفات المُفوترة، في معاملة واحدة. كل الحسابات في القاعدة من أسعار الأصناف ونسبة الضريبة المخزَّنة، لا من أرقام يرسلها العميل. تُرجع معرّف الفاتورة.';

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[]) to authenticated;

commit;
