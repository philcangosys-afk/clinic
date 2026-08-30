-- ---------------------------------------------------------------------------
-- 0053_visit_services.sql — الخدمات المنفَّذة في الزيارة، وربطها بالفاتورة
-- ---------------------------------------------------------------------------
-- الفجوة التي يسدّها هذا الملف:
--   التسلسل المطلوب هو  خدمة منفَّذة → بند فاتورة → دفعة → إغلاق مالي.
--   وفحص القاعدة أظهر أن **الحلقة الأولى غير موجودة**: `patient_visits` يحمل
--   `exam_data` و`main_complaint` و`notes`، ومعه `patient_visit_diagnoses`
--   للتشخيصات — ولا شيء يربط زيارة بخدمة.
--
--   فالطبيب ينفّذ خدمة، ثم يفتح المحاسب الفاتورة ويعيد اختيار الخدمات من
--   الكتالوج بالذاكرة أو بسؤال الطبيب. وكل خدمة تُنسى لا تُفوتَر — وهو نزيف
--   إيراد صامت لا يظهر في أي تقرير، لأن لا سجل لما نُفِّذ أصلًا.

-- ---------------------------------------------------------------------------
-- 1) قيد التفرّد المطلوب لمفاتيح العزل المركّبة
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_organization_id_id_key') then
    alter table items add constraint items_organization_id_id_key unique (organization_id, id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) الخدمات المنفَّذة في الزيارة
-- ---------------------------------------------------------------------------
create table if not exists patient_visit_services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  visit_id        uuid not null references patient_visits(id) on delete cascade,
  item_id         uuid not null references items(id) on delete restrict,
  qty             numeric(12,2) not null default 1 check (qty > 0),
  -- السعر لحظة التنفيذ: سعر الكتالوج قد يتغيّر بين الزيارة والفوترة، والمريض
  -- يُحاسَب على ما نُفِّذ له يومها لا على سعر اليوم.
  unit_price      numeric(14,2),
  note            text,
  performed_by    uuid references doctors(id) on delete set null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_visit_services_visit on patient_visit_services (visit_id);
create index if not exists idx_visit_services_org   on patient_visit_services (organization_id, created_at desc);

-- عزل المنشآت على نمط 0050
alter table patient_visit_services drop constraint if exists visit_services_visit_tenant_fk;
alter table patient_visit_services add constraint visit_services_visit_tenant_fk
  foreign key (organization_id, visit_id) references patient_visits(organization_id, id);

alter table patient_visit_services drop constraint if exists visit_services_item_tenant_fk;
alter table patient_visit_services add constraint visit_services_item_tenant_fk
  foreign key (organization_id, item_id) references items(organization_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_visit_services_organization_id_id_key') then
    alter table patient_visit_services add constraint patient_visit_services_organization_id_id_key
      unique (organization_id, id);
  end if;
end $$;

alter table patient_visit_services enable row level security;

drop policy if exists "visit_services_all_members" on patient_visit_services;
create policy "visit_services_all_members" on patient_visit_services
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ---------------------------------------------------------------------------
-- 3) ربط بند الفاتورة بالخدمة — ومنع الفوترة المزدوجة في القاعدة
-- ---------------------------------------------------------------------------
alter table sales_invoice_items
  add column if not exists visit_service_id uuid references patient_visit_services(id) on delete set null;

-- **هذا هو ما يمنع «لا تضف الخدمة مرتين»** — لا فحص في الواجهة.
--
-- فهرس فريد جزئي: خدمة واحدة لا تُفوتَر إلا مرة. وبنود المرتجعات لا تحمل
-- المفتاح (المرتجع يشير إلى الفاتورة الأصلية لا إلى الخدمة)، فلا يتعارض
-- إرجاعُ خدمةٍ مع كونها مفوترة مرة واحدة.
create unique index if not exists uq_invoice_item_visit_service
  on sales_invoice_items (visit_service_id) where visit_service_id is not null;

create index if not exists idx_invoice_items_visit_service
  on sales_invoice_items (visit_service_id) where visit_service_id is not null;

-- ---------------------------------------------------------------------------
-- 4) التدقيق
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_patient_visit_services on patient_visit_services;
create trigger trg_audit_patient_visit_services
  after insert or update or delete on patient_visit_services
  for each row execute function app_audit_log_auto();

-- ---------------------------------------------------------------------------
-- 5) منظور الخدمات غير المفوترة — مصدر اقتراح بنود الفاتورة
--
--   `security_invoker` من البداية (لا كإصلاح لاحق كما في 0051): المنظور
--   يعرض بيانات سريرية ومالية، وبلا ذلك يقرأ منه أي عضو بيانات كل المنشآت.
-- ---------------------------------------------------------------------------
create or replace view v_visit_services_unbilled
with (security_invoker = on) as
select
  s.id            as visit_service_id,
  s.organization_id,
  s.visit_id,
  v.appointment_id,
  v.patient_id,
  s.item_id,
  i.name_ar       as item_name,
  i.is_vat_exempt,
  s.qty,
  coalesce(s.unit_price, i.price, 0) as unit_price,
  s.note,
  s.performed_by,
  s.created_at
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join items i          on i.id = s.item_id
where not exists (
  select 1 from sales_invoice_items sii
   where sii.visit_service_id = s.id
);

comment on view v_visit_services_unbilled is
  'الخدمات المنفَّذة في الزيارات ولم تُفوتَر بعد. تقرؤها شاشة الفوترة لاقتراح بنود الفاتورة.';

revoke all on v_visit_services_unbilled from anon;

-- ---------------------------------------------------------------------------
-- 6) تحديث دالة إنشاء الفاتورة لتحمل الربط
--
--   الدالة أُنشئت في 0052، وتُعاد كتابتها هنا كاملةً لأن PostgreSQL لا يسمح
--   بتعديل جزء من جسم دالة. التغيير الوحيد: قراءة `visit_service_id` من كل
--   بند وكتابته في `sales_invoice_items` — فيصبح منع الفوترة المزدوجة مضمونًا
--   بالفهرس الفريد أعلاه، لا برجاء ألّا يضغط المستخدم مرتين.
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

  -- الخدمات المُمرَّرة يجب أن تكون من هذه المنشأة، ومن الزيارة نفسها إن
  -- حُدِّدت — وإلا أمكن تمرير معرّف خدمة من زيارة أخرى فتُفوتَر في غير موضعها.
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
    nullif(btrim(e ->> 'source_barcode'),''),
    -- الربط بالخدمة المنفَّذة في الزيارة (0053). الفهرس الفريد على هذا العمود
    -- هو ما يمنع فوترة الخدمة مرتين — لو أُرسلت مرة ثانية فشلت المعاملة كلها
    -- بدل أن تُنشأ فاتورة مكرَّرة.
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

exception
  -- الفهرس الفريد `uq_invoice_item_visit_service` يمنع فوترة الخدمة مرتين،
  -- لكن رسالته الخام تذكر اسم فهرس ومعرّفًا سداسيًا لا يفهمهما المحاسب.
  -- تُترجَم هنا إلى سبب مفهوم — والمعاملة مُلغاة أصلًا فلا فاتورة ناقصة.
  when unique_violation then
    if sqlerrm like '%uq_invoice_item_visit_service%' then
      raise exception 'إحدى الخدمات المحدَّدة مفوترة في فاتورة سابقة — حدِّث الصفحة لترى الخدمات غير المفوترة فقط';
    end if;
    raise;
end;
$$;

comment on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) is
  'إنشاء فاتورة مبيعات كاملة (رأس + بنود + إجماليات + حصص التأمين) في معاملة واحدة. كل الحسابات في القاعدة من أسعار الأصناف ونسبة الضريبة المخزَّنة، لا من أرقام يرسلها العميل. تُرجع معرّف الفاتورة.';

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text) to authenticated;
