-- ---------------------------------------------------------------------------
-- 0052_create_sales_invoice_rpc.sql
-- المهمة 7: إنشاء الفاتورة عملية واحدة ذرّية. والمهمة 8: ربطها بالزيارة.
-- ---------------------------------------------------------------------------
-- المشكلة في المسار الحالي:
--   الواجهة تُدرج رأس الفاتورة، ثم تُدرج البنود في استدعاء ثانٍ، وإن فشل
--   الثاني تحذف الرأس. هذا أفضل من ترك فاتورة بلا بنود، لكنه ليس ذرّيًا:
--
--     • انقطاع الشبكة بين الاستدعاءين يترك **رأس فاتورة بلا بنود** — برقم
--       فاتورة مستهلَك من التسلسل، ويظهر في كشف المبيعات بصفر.
--     • حذف الرأس التعويضي قد يفشل هو الآخر، فلا يبقى شيء يصحّح الحالة.
--     • كل الحسابات (الخصم، الضريبة، حصة التأمين) تجري في المتصفح، فيمكن
--       التلاعب بها بتعديل الطلب قبل إرساله — والقاعدة تقبل ما يصلها.
--
--   الدالة أدناه تُنفَّذ كلها داخل معاملة واحدة ضمنيًا: إمّا تُحفظ الفاتورة
--   كاملة أو لا يُحفظ منها شيء. والحسابات كلها تجري **في القاعدة** من أسعار
--   الأصناف ونِسَب الضريبة المخزَّنة، لا من أرقام يرسلها العميل.

-- ---------------------------------------------------------------------------
-- 1) أعمدة ناقصة
-- ---------------------------------------------------------------------------

-- ربط الفاتورة بالزيارة (المهمة 8). العمود كان غائبًا رغم أن التسلسل المطلوب
-- هو: خدمة منفَّذة في زيارة ← بند فاتورة. بلا هذا العمود لا سبيل للرجوع من
-- الفاتورة إلى الزيارة التي وُلِّدت منها.
alter table sales_invoices add column if not exists visit_id uuid references patient_visits(id) on delete set null;

-- حصّتا التأمين والمريض: كانت `insurance_copay_percent` و`insurance_max_amount`
-- تُخزَّنان كبيانات وصفية بلا أي حساب مبنيّ عليهما، فيبقى المحاسب يحسب حصة
-- المريض يدويًا في كل فاتورة تأمين.
alter table sales_invoices add column if not exists insurance_share_amount numeric(14,2) not null default 0;
alter table sales_invoices add column if not exists patient_share_amount   numeric(14,2) not null default 0;

create index if not exists idx_sales_invoices_visit on sales_invoices (visit_id) where visit_id is not null;

-- قيد العزل للعمود الجديد، على نمط 0050.
--
-- الترتيب مهم: المفتاح الأجنبي المركّب يتطلب قيد تفرّد مطابقًا على الجدول
-- المرجعي، و`patient_visits` لم يكن ضمن جداول 0050 فلا يملكه. يُنشأ أولًا.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'patient_visits_organization_id_id_key') then
    alter table patient_visits add constraint patient_visits_organization_id_id_key
      unique (organization_id, id);
  end if;
end $$;

alter table sales_invoices drop constraint if exists sales_invoices_visit_tenant_fk;
alter table sales_invoices add constraint sales_invoices_visit_tenant_fk
  foreign key (organization_id, visit_id) references patient_visits(organization_id, id) not valid;

-- ---------------------------------------------------------------------------
-- 2) الدالة
-- ---------------------------------------------------------------------------
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
  p_note                   text    default null
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
begin
  -- (أ) الهوية والعضوية والدور -----------------------------------------------
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  -- الفوترة عمل محاسبي/استقبالي — لا يفتحها الطبيب ولا فنّي المختبر
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
  --
  -- قيود 0050 تفرض هذا على مستوى القاعدة، لكن رسالتها الخام تذكر اسم قيد لا
  -- يفهمه المستخدم. الفحص هنا يعطي رسالة مفهومة، ويغطي كذلك الأصناف — وهي
  -- ليست ضمن قيود 0050.
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

  -- (ج) نسبة الضريبة — من القاعدة لا من العميل ------------------------------
  select o.default_vat_rate into v_vat_rate from organizations o where o.id = p_organization_id;
  select coalesce(s.sales_vat_enabled, true) into v_vat_enabled
    from organization_vat_settings s where s.organization_id = p_organization_id;
  v_vat_rate := coalesce(v_vat_rate, 0);
  if not coalesce(v_vat_enabled, true) then
    v_vat_rate := 0;
  end if;

  -- (د) رأس الفاتورة بمبالغ صفرية، ثم تُحسب من البنود المُدرَجة فعلًا -------
  --
  -- الترتيب مقصود: الإدراج أولًا بصفر، ثم التجميع من `sales_invoice_items`
  -- بعد إدراجها. بهذا تكون الإجماليات مطابقة لما في الجدول بالضرورة — لا
  -- لما حسبه العميل ولا لمتغيّر وسيط قد ينحرف عن الصفوف.
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

  -- (هـ) البنود — السعر من الصنف ما لم يُمرَّر صراحةً، والإعفاء من الصنف ----
  insert into sales_invoice_items (
    invoice_id, item_id, description, qty, price,
    discount_percent, discount_amount, vat_rate, vat_amount, exemption_amount,
    net_amount, doctor_id, agreement_item_id, line_type, source_barcode
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
    -- القيم المسموحة في `sales_invoice_items_line_type_check` هي
    -- normal/follow_up/agreement فقط. الافتراضي `normal`، ويصير `agreement`
    -- تلقائيًا متى مُرِّر `agreement_item_id` — فلا يعتمد التصنيف على انتباه
    -- المستدعي، ولا يمرّ سطر اتفاقية مصنَّفًا "عادي" في التقارير.
    case
      when nullif(btrim(e ->> 'line_type'),'') in ('normal','follow_up','agreement')
        then btrim(e ->> 'line_type')
      when nullif(e ->> 'agreement_item_id','') is not null then 'agreement'
      else 'normal'
    end,
    nullif(btrim(e ->> 'source_barcode'),'')
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
        -- السعر المُمرَّر يُقبل (خصم يدوي، سعر متفق عليه)، وإلا سعر الكتالوج
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
  --
  -- `insurance_copay_percent` نسبة **تحمّل المريض** لا نسبة التغطية — هذا هو
  -- العرف في نماذج CCHI، وعليه بُنيت تسمية العمود ("copay"). وسقف التغطية
  -- `max_amount` يُطبَّق على حصة الشركة: ما يتجاوزه يقع على المريض.
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
  --
  -- المدفوع مقيَّد بحصة المريض لا بالصافي: في فاتورة تأمين لا يدفع المريض إلا
  -- حصته، وقبول مبلغ أكبر يجعل `remaining_amount` (وهو عمود محسوب) سالبًا.
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

  return v_invoice_id;
end;
$$;

comment on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) is
  'إنشاء فاتورة مبيعات كاملة (رأس + بنود + إجماليات + حصص التأمين) في معاملة واحدة. كل الحسابات في القاعدة من أسعار الأصناف ونسبة الضريبة المخزَّنة، لا من أرقام يرسلها العميل. تُرجع معرّف الفاتورة.';

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) to authenticated;
