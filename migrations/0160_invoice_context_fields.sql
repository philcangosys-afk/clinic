-- =============================================================================
-- 0160_invoice_context_fields.sql
-- حقول الفاتورة العليا: الجنسية والمصدر والتصنيف وحدّ الكشفية وأهلية العلاج.
-- =============================================================================
--
-- **خمسة أعمدة قائمة في `sales_invoices` لا يكتبها أحد:**
--
--   `nationality_value_id`           — جنسية الفاتورة لحظة إصدارها
--   `source_value_id`                — مصدر الفاتورة (من أين جاء المريض)
--   `classification_value_id`        — تصنيف الفاتورة
--   `insurance_consultation_limit`   — حدّ الكشفية في وثيقة التأمين
--   `insurance_eligibility`          — أهلية العلاج
--
-- كلّها في المخطط منذ 0002/0005، وشاشة الفوترة لا ترسل واحدًا منها. وتقارير
-- المصدر والتصنيف تقرأ أعمدةً فارغة أبدًا، وشريط الفاتورة في نظام العيادات
-- المرجعيّ يعرضها كلّها.
--
-- **والجنسية تُستنبَط ولا تُستقبَل:** هي جنسية الفاتورة **وقت الإصدار** لا
-- جنسية المريض اليوم — فمريضٌ صُحِّحت جنسيته بعد سنة لا تتغيّر فواتيره
-- القديمة معه. والإعفاء الضريبيّ يُبنى عليها، فتلقّيها من المتصفّح يجعل
-- الإعفاء قابلًا للتزوير بتعديل الطلب.
--
-- **حدّ الكشفية والأهلية يمرّان في `p_insurance`** (jsonb) لا كمعاملَين:
-- jsonb يقبل مفتاحًا جديدًا بلا مساس بالتوقيع، والمعاملان يُلزمان إسقاط
-- الدالّة ومنحها من جديد في كل توسعة.
--
-- **والمعاملان الجديدان يُلحقان في آخر التوقيع** فلا يتغيّر ترتيب ما قبلهما،
-- وتبقى كل نداءات العميل القائمة صحيحة. ومع ذلك تُسقَط النسخة القديمة
-- صراحةً: بقاء توقيعين بنفس الاسم يجعل PostgREST يختار أحدهما بلا تحديد.
--
-- الدالّة **استُخرجت آليًّا من 0152 ولم تُنسخ بيد**: ستّ نقاط تعديل مُعلَّمة
-- وما عداها بايتٌ ببايت. نسخُ أربعمئة وسبعين سطرًا بيدٍ يُسقط سطرًا لا يُرى.
-- =============================================================================

-- التوقيع القديم (اثنان وعشرون معاملًا) يُسقَط قبل إنشاء الموسَّع.
drop function if exists app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[], jsonb);

CREATE OR REPLACE FUNCTION public.app_create_sales_invoice(p_organization_id uuid, p_items jsonb, p_patient_id uuid DEFAULT NULL::uuid, p_external_customer_name text DEFAULT NULL::text, p_appointment_id uuid DEFAULT NULL::uuid, p_visit_id uuid DEFAULT NULL::uuid, p_doctor_id uuid DEFAULT NULL::uuid, p_clinic_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_invoice_type text DEFAULT 'sale'::text, p_original_invoice_id uuid DEFAULT NULL::uuid, p_is_insurance boolean DEFAULT false, p_insurance jsonb DEFAULT '{}'::jsonb, p_paid_amount numeric DEFAULT 0, p_is_temporary boolean DEFAULT false, p_is_b2b boolean DEFAULT false, p_id_number text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_lab_order_ids uuid[] DEFAULT NULL::uuid[], p_radiology_order_ids uuid[] DEFAULT NULL::uuid[], p_prescription_ids uuid[] DEFAULT NULL::uuid[], p_payments jsonb DEFAULT '[]'::jsonb, p_source_value_id uuid DEFAULT NULL::uuid, p_classification_value_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_invoice_id   uuid;
  -- جنسية **الفاتورة** لا جنسية المريض اليوم: تُلتقط لحظة الإصدار وتبقى،
  -- فمريضٌ صُحِّحت جنسيته بعد سنة لا تتغيّر فواتيره القديمة معه. وهي
  -- تُستنبَط من الملفّ ولا تُستقبَل من العميل: الإعفاء الضريبيّ يُبنى عليها.
  v_nationality  uuid;
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
  v_settings     organization_vat_settings%rowtype;
  v_pat_nat      uuid;
  v_pat_id_num   text;
  v_patient_exempt boolean := false;
  v_branch       uuid;
  v_day_id       uuid;
  v_pay          jsonb;
  v_pay_amount   numeric;
  v_base         numeric(14,2) := 0;
  v_offer_id     uuid;
  v_offer_credit numeric(14,2) := 0;
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

  -- (ج) نسبة الضريبة والإعفاء — من القاعدة لا من العميل ---------------------
  --
  -- الإعفاء بالجنسية كان **معطَّلًا فعليًّا**: الإعداد يُقرأ في
  -- `app_resolve_vat_rate` وهذه الدالّة لا تستدعيها، فبقيت كل فاتورة تُحمَّل
  -- الضريبة مهما اختير في شاشة الإعدادات.
  --
  -- والإعفاء يشترط الهوية لا الجنسية وحدها (`vat_exempt_requires_id`): هو
  -- إعفاء مواطنٍ مُثبَتة هويته، وخانة جنسية مكتوبة بلا هوية ليست إثباتًا.
  select o.default_vat_rate into v_vat_rate from organizations o where o.id = p_organization_id;
  select * into v_settings from organization_vat_settings s where s.organization_id = p_organization_id;
  v_vat_enabled := coalesce(v_settings.sales_vat_enabled, true);
  v_vat_rate := coalesce(v_vat_rate, 0);
  if not v_vat_enabled then
    v_vat_rate := 0;
  end if;

  if p_patient_id is not null then
    select p.nationality_value_id, nullif(btrim(coalesce(p.id_number, '')), '')
      into v_pat_nat, v_pat_id_num
      from patients p where p.id = p_patient_id;
    v_nationality := v_pat_nat;

    -- منع الفاتورة بلا جنسية/هوية — إعدادٌ كان يُحفظ ولا يقرؤه شيء
    if coalesce(v_settings.block_invoice_without_nationality_or_id, false)
       and (v_pat_nat is null or v_pat_id_num is null) then
      raise exception 'الفاتورة تتطلّب جنسية ورقم هوية في ملفّ المريض — أكملهما في الملفّ ثم أعد الإصدار';
    end if;

    if v_pat_nat is not null
       and v_settings.vat_exempt_nationality_value_ids is not null
       and v_pat_nat = any (v_settings.vat_exempt_nationality_value_ids)
       and not coalesce(v_settings.vat_exemption_disabled_for_customer_types, false)
       and (not coalesce(v_settings.vat_exempt_requires_id, true) or v_pat_id_num is not null)
    then
      v_patient_exempt := true;
    end if;
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
    insurance_approval_number, insurance_consultation_limit, insurance_eligibility,
    nationality_value_id, source_value_id, classification_value_id,
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
    -- حدّ الكشفية وأهلية العلاج يمرّان في jsonb التأمين لا كمعاملَين: عمودان
    -- قائمان منذ 0005 لا يكتبهما أحد، وتوسيع التوقيع لأجلهما يُلزم إسقاط
    -- الدالّة وإعادة منحها في كل مرّة — وjsonb يقبل مفتاحًا جديدًا بلا ذلك.
    nullif(p_insurance ->> 'consultation_limit','')::numeric,
    nullif(btrim(p_insurance ->> 'eligibility'),''),
    v_nationality, p_source_value_id, p_classification_value_id,
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
        -- إعفاء المريض يشمل كل بنود فاتورته، وإعفاء الصنف يبقى على حاله
        (v_patient_exempt
         or coalesce(nullif(e ->> 'is_vat_exempt','')::boolean, i.is_vat_exempt, false)) as exempt
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

    -- الضريبة كلّها على المريض، والنسبة تُقسَم على الوعاء قبل الضريبة.
    --
    -- كانت النسبة تُقسَم على `v_net` وهو شاملٌ للضريبة، فتتحمّل شركة التأمين
    -- جزءًا منها بمقدار حصّتها — وقرار المالك أنّ الضريبة على المريض وحده:
    -- السعوديّ معفًى منها أصلًا (فرع الإعفاء أعلاه يجعل `v_vat` صفرًا لكل
    -- بنوده)، وغير السعوديّ يدفعها كاملة.
    --
    -- والمجموع محفوظ: حصّة المريض + حصّة الشركة = الوعاء + الضريبة = `v_net`.
    v_base := v_net - v_vat;

    v_pat_share := round(v_base * v_copay / 100.0, 2);
    v_ins_share := v_base - v_pat_share;

    -- سقف الشركة يقع على حصّتها من الوعاء، لا على المبلغ بضريبته
    if v_max is not null and v_ins_share > v_max then
      v_ins_share := v_max;
      v_pat_share := v_base - v_ins_share;
    end if;

    v_pat_share := v_pat_share + v_vat;
  else
    v_pat_share := v_net;
    v_ins_share := 0;
  end if;

  -- (ز٢) العرض المُطبَّق على الفاتورة ----------------------------------------
  --
  -- `applied_offer_id` و`offer_percent` لم يكن يكتبهما أحد، فتقرير حصيلة
  -- العروض (`v_offers_totals`) يحسب `subtotal × offer_percent` وهو **صفرٌ
  -- دائمًا** — أي أنّ كل عرض في النظام يبدو بلا أثر مهما فُوتِر عليه.
  --
  -- العرض يُستنبَط في القاعدة لا يُستقبَل من العميل: مبلغٌ يُنسَب إلى عرضٍ
  -- بناءً على ما ترسله الشاشة قابلٌ للتزوير، والقاعدة تعرف مصدر الخصم أصلًا.
  -- و`app_resolve_discount_detail` تمشي سلسلة الأولوية نفسها التي تعمل بها
  -- الشاشة (خصم المريض ← الخصم العام ← العروض ← خصم الصنف)، فما يُنسَب إلى
  -- عرضٍ هو ما كان العرض فعلًا مصدره.
  --
  -- والمنسوب لا يتجاوز نسبة العرض: تخفيضٌ يدويّ فوقها ليس من العرض ولا
  -- تُحمَّل حصيلته عليه.
  --
  -- فاتورةٌ عليها عرضان (نادرة): يُسجَّل الأكبر حصيلةً وحده. الرأس يحمل عرضًا
  -- واحدًا منذ 0010، وجمعُ نسبتَي عرضين يُضخّم كليهما في التقرير — والتقليل
  -- هنا أسلم من التضخيم.
  select x.offer_id, x.credited
    into v_offer_id, v_offer_credit
    from (
      select d.offer_id,
             sum(least(
               sii.discount_amount,
               round(round(sii.qty * sii.price, 2) * d.discount_percent / 100.0, 2)
             )) as credited
        from sales_invoice_items sii
        cross join lateral app_resolve_discount_detail(
               p_organization_id, p_patient_id, sii.item_id) d
       where sii.invoice_id = v_invoice_id
         and sii.item_id is not null
         and sii.discount_amount > 0
         and d.discount_source = 'offer'
         and d.offer_id is not null
       group by d.offer_id
    ) x
   order by x.credited desc, x.offer_id
   limit 1;

  if coalesce(v_offer_credit, 0) <= 0 or v_subtotal <= 0 then
    v_offer_id := null;
    v_offer_credit := 0;
  end if;

  -- (ح) المدفوع والحالة ------------------------------------------------------
  v_paid := greatest(coalesce(p_paid_amount, 0), 0);
  v_paid := least(v_paid, v_pat_share);

  v_status := case
    when p_is_temporary then 'unpaid'
    when v_paid >= v_net then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid' end;

  -- اليومية المفتوحة للفرع — تُفتح إن لم تكن مفتوحة. الفرع يأتي من المُحفِّز
  -- الذي ملأه عند الإدراج، فيُقرأ من الصف لا يُخمَّن.
  select branch_id into v_branch from sales_invoices where id = v_invoice_id;
  v_day_id := app_ensure_business_day(p_organization_id, v_branch);

  update sales_invoices
     set business_day_id        = v_day_id,
         applied_offer_id       = v_offer_id,
         -- النسبة تُحفظ كحصّة الخصم المنسوب من إجمالي الفاتورة، فيُعيد
         -- `subtotal × offer_percent / 100` في التقرير المبلغَ نفسه
         offer_percent          = case when v_offer_id is null then 0
                                  else least(round(v_offer_credit * 100.0 / v_subtotal, 2), 100) end,
         subtotal_amount        = v_subtotal,
         discount_amount        = v_discount,
         vat_amount             = v_vat,
         exemption_amount       = v_exemption,
         net_amount             = v_net,
         insurance_share_amount = v_ins_share,
         patient_share_amount   = v_pat_share,
         paid_amount            = v_paid,
         status                 = v_status,
         issued_at              = coalesce(issued_at, now()),
         issued_by              = coalesce(issued_by, auth.uid())
   where id = v_invoice_id;

  -- (ح٢) الدفعات — سندات قبض حقيقية داخل معاملة الفاتورة --------------------
  --
  -- خانة «المدفوع» وحدها كانت تكتب رقمًا في الفاتورة بلا سندٍ يقابله، فيظهر
  -- المال محصَّلًا في الفاتورة وغائبًا عن الصندوق وعن جرد اليومية. والتحصيل
  -- يمرّ بـ`app_receive_invoice_payment` نفسها التي تستعملها شاشة التحصيل:
  -- تفرض سقف المتبقّي، وتشترط مناوبة صندوق مفتوحة للنقد، وتكتب سند القبض
  -- والتخصيص معًا — ونسخُ منطقها هنا كان سيُنتج مسارَي تحصيل يتباعدان.
  --
  -- الدفع لا يقع على عرض سعر (لم يُبَع بعد) ولا على مرتجع (يُردّ لا يُقبض).
  if p_payments is not null and jsonb_typeof(p_payments) = 'array'
     and jsonb_array_length(p_payments) > 0
     and not coalesce(p_is_temporary, false)
     and p_invoice_type = 'sale'
  then
    for v_pay in select * from jsonb_array_elements(p_payments) loop
      v_pay_amount := round(coalesce(nullif(v_pay ->> 'amount','')::numeric, 0), 2);
      -- سطر بمبلغ صفر ليس خطأً: الواجهة تعرض صفَّي دفع ويُملأ أحدهما فقط
      if v_pay_amount > 0 then
        perform app_receive_invoice_payment(
          v_invoice_id,
          v_pay_amount,
          nullif(v_pay ->> 'payment_method_value_id','')::uuid,
          nullif(v_pay ->> 'cash_register_id','')::uuid,
          nullif(btrim(v_pay ->> 'reference'), ''),
          nullif(btrim(v_pay ->> 'note'), ''));
      end if;
    end loop;
  end if;

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
$function$;

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
  jsonb, uuid, uuid) from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
  jsonb, uuid, uuid) to authenticated;

comment on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
  jsonb, uuid, uuid) is
  'إنشاء فاتورة المبيعات كاملةً في معاملة واحدة. الجنسية تُستنبَط من ملفّ المريض لحظة الإصدار، والمصدر والتصنيف معاملان، وحدّ الكشفية وأهلية العلاج مفتاحان في p_insurance.';

notify pgrst, 'reload schema';
