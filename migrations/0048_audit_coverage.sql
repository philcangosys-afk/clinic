-- ---------------------------------------------------------------------------
-- 0048_audit_coverage.sql — توسيع تغطية سجل التدقيق
-- ---------------------------------------------------------------------------
-- لماذا هذه الهجرة:
--   `app_audit_log_auto()` بُنيت في 0025 كدالة **عامة** تصلح لأي جدول فيه
--   `organization_id` و`id` من نوع uuid، ثم رُبطت بأحد عشر جدولًا فقط —
--   واختيارها كان منحازًا للموارد البشرية (المرشحون، الإعلانات الوظيفية،
--   البرامج التدريبية) بينما **المال والتسعير والتأمين والمخزون بلا تدقيق**.
--
--   النتيجة العملية: من غيّر سعر صنف، أو أنشأ سند صرف، أو عدّل نسبة خصم
--   بوليصة، أو حوّل مخزونًا بين مستودعين — لا أثر لأي من ذلك في سجل التدقيق.
--   وهذه بالضبط العمليات التي يُسأل عنها عند اختلاف الجرد أو الحساب.
--
--   هذه الهجرة تربط الدالة نفسها بـ27 جدولًا إضافيًا. لا دالة جديدة ولا عمود
--   جديد — الربط فقط، لأن البنية كانت جاهزة من 0025.
--
-- ملاحظة على الأداء:
--   كل مُحفِّز يضيف صف `audit_log` واحدًا لكل عملية. الجداول المختارة كلها
--   جداول عمليات لا جداول قراءة عالية التردد، والكلفة صف واحد لكل كتابة —
--   وهي الكلفة نفسها المقبولة على `sales_invoices` منذ 0025.
--
-- إعادة التشغيل آمنة: كل مُحفِّز يُسقَط قبل إنشائه.
-- ---------------------------------------------------------------------------


-- المال
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_financial_vouchers on financial_vouchers;
create trigger trg_audit_financial_vouchers
  after insert or update or delete on financial_vouchers
  for each row execute function app_audit_log_auto('description');

drop trigger if exists trg_audit_purchase_invoices on purchase_invoices;
create trigger trg_audit_purchase_invoices
  after insert or update or delete on purchase_invoices
  for each row execute function app_audit_log_auto('invoice_number');

drop trigger if exists trg_audit_treatment_agreements on treatment_agreements;
create trigger trg_audit_treatment_agreements
  after insert or update or delete on treatment_agreements
  for each row execute function app_audit_log_auto('agreement_number');

drop trigger if exists trg_audit_offers on offers;
create trigger trg_audit_offers
  after insert or update or delete on offers
  for each row execute function app_audit_log_auto('title');

drop trigger if exists trg_audit_discount_limits on discount_limits;
create trigger trg_audit_discount_limits
  after insert or update or delete on discount_limits
  for each row execute function app_audit_log_auto();

drop trigger if exists trg_audit_consultation_fee_rules on consultation_fee_rules;
create trigger trg_audit_consultation_fee_rules
  after insert or update or delete on consultation_fee_rules
  for each row execute function app_audit_log_auto();

drop trigger if exists trg_audit_cash_registers on cash_registers;
create trigger trg_audit_cash_registers
  after insert or update or delete on cash_registers
  for each row execute function app_audit_log_auto('name');

drop trigger if exists trg_audit_zatca_companies on zatca_companies;
create trigger trg_audit_zatca_companies
  after insert or update or delete on zatca_companies
  for each row execute function app_audit_log_auto('name');

-- التسعير
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_items on items;
create trigger trg_audit_items
  after insert or update or delete on items
  for each row execute function app_audit_log_auto('name_ar');

-- المخزون
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_stock_transfers on stock_transfers;
create trigger trg_audit_stock_transfers
  after insert or update or delete on stock_transfers
  for each row execute function app_audit_log_auto('transfer_number');

drop trigger if exists trg_audit_warehouses on warehouses;
create trigger trg_audit_warehouses
  after insert or update or delete on warehouses
  for each row execute function app_audit_log_auto('name');

drop trigger if exists trg_audit_distributors on distributors;
create trigger trg_audit_distributors
  after insert or update or delete on distributors
  for each row execute function app_audit_log_auto('name_ar');

-- التأمين
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_insurance_companies on insurance_companies;
create trigger trg_audit_insurance_companies
  after insert or update or delete on insurance_companies
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_insurance_policies on insurance_policies;
create trigger trg_audit_insurance_policies
  after insert or update or delete on insurance_policies
  for each row execute function app_audit_log_auto('policy_name');

drop trigger if exists trg_audit_insurance_claim_forms on insurance_claim_forms;
create trigger trg_audit_insurance_claim_forms
  after insert or update or delete on insurance_claim_forms
  for each row execute function app_audit_log_auto('form_type');

-- السريري
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_patient_visits on patient_visits;
create trigger trg_audit_patient_visits
  after insert or update or delete on patient_visits
  for each row execute function app_audit_log_auto('main_complaint');

drop trigger if exists trg_audit_prescriptions on prescriptions;
create trigger trg_audit_prescriptions
  after insert or update or delete on prescriptions
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_dispensing_records on dispensing_records;
create trigger trg_audit_dispensing_records
  after insert or update or delete on dispensing_records
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_lab_orders on lab_orders;
create trigger trg_audit_lab_orders
  after insert or update or delete on lab_orders
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_radiology_orders on radiology_orders;
create trigger trg_audit_radiology_orders
  after insert or update or delete on radiology_orders
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_patient_documents on patient_documents;
create trigger trg_audit_patient_documents
  after insert or update or delete on patient_documents
  for each row execute function app_audit_log_auto('file_name');

-- التشغيل
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_appointments on appointments;
create trigger trg_audit_appointments
  after insert or update or delete on appointments
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_clinics on clinics;
create trigger trg_audit_clinics
  after insert or update or delete on clinics
  for each row execute function app_audit_log_auto('name');

drop trigger if exists trg_audit_branches on branches;
create trigger trg_audit_branches
  after insert or update or delete on branches
  for each row execute function app_audit_log_auto('name');

drop trigger if exists trg_audit_facility_licenses on facility_licenses;
create trigger trg_audit_facility_licenses
  after insert or update or delete on facility_licenses
  for each row execute function app_audit_log_auto('license_number');

-- الموارد البشرية
-- ------------------------------------------------------------------------

drop trigger if exists trg_audit_leave_requests on leave_requests;
create trigger trg_audit_leave_requests
  after insert or update or delete on leave_requests
  for each row execute function app_audit_log_auto('status');

drop trigger if exists trg_audit_leave_balances on leave_balances;
create trigger trg_audit_leave_balances
  after insert or update or delete on leave_balances
  for each row execute function app_audit_log_auto();

-- ---------------------------------------------------------------------------
-- تسجيل ما تغيّر فعلًا، لا مجرد "حدث تعديل"
-- ---------------------------------------------------------------------------
-- الدالة في 0025 كانت تكتب `action_type = 'update'` وتترك عمود `details`
-- (jsonb، موجود في audit_log منذ 0001) فارغًا. فسجل التدقيق يقول "فلان عدّل
-- الصنف حشوة تجميلية" ولا يقول **ماذا عدّل**: السعر؟ الاسم؟ حالة التفعيل؟
-- وهو السؤال الوحيد الذي يُطرح عند مراجعة تغيير سعر أو نسبة خصم.
--
-- التعديل هنا يملأ `details` بالأعمدة المتغيّرة فقط بصيغة
-- {"price": {"old": "300.00", "new": "450.00"}}.
--
-- قرارات مقصودة:
--  • **الأعمدة المتغيّرة فقط** لا الصف كاملًا: صف كامل لكل تعديل يضاعف حجم
--    سجل التدقيق أضعافًا بلا فائدة.
--  • **`updated_at` مستثنى**: يتغيّر في كل تعديل فيصبح ضجيجًا في كل سجل.
--  • **القيم تُقصَر على 500 محرف**: `exam_data` و`form_data` وحقول jsonb
--    الكبيرة كانت ستنفخ الجدول — والغرض معرفة أن الحقل تغيّر لا أرشفة محتواه.
--  • **الإدراج والحذف يبقيان بلا `details`**: الصف كله معروف من `entity_id`،
--    وتكرار محتواه في سجل التدقيق تخزين مضاعف بلا سؤال يجيب عنه.
-- ---------------------------------------------------------------------------
create or replace function app_audit_log_auto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec       record;
  v_title     text;
  v_action    text;
  v_details   jsonb;
  v_org       uuid;
  v_entity    uuid;
  v_diff_sql  text;
begin
  v_rec := case when TG_OP = 'DELETE' then OLD else NEW end;

  execute format('select ($1).organization_id, ($1).id%s',
                 case when TG_NARGS > 0 then format(', ($1).%I::text', TG_ARGV[0]) else ', null::text' end)
    into v_org, v_entity, v_title
    using v_rec;

  -- حذف المنشأة نفسها: `audit_log.organization_id` مفتاح أجنبي على
  -- `organizations` بـ `on delete cascade` (0001). أثناء الحذف المتتالي يُحذف
  -- صف المنشأة أولًا ثم أبناؤها، فيحاول هذا المُحفِّز إدراج صف تدقيق يشير إلى
  -- منشأة لم تعد موجودة — فيفشل الحذف كله بخطأ مفتاح أجنبي.
  --
  -- كان هذا قائمًا منذ 0025 لكنه أصاب أحد عشر جدولًا فقط؛ بعد التوسيع إلى 38
  -- لم يعد يمكن حذف أي منشأة غير فارغة عمليًا.
  if TG_OP = 'DELETE' and not exists (select 1 from organizations o where o.id = v_org) then
    return OLD;
  end if;

  v_action := case TG_OP when 'INSERT' then 'add' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  if TG_OP = 'UPDATE' then
    select string_agg(
             format($f$case when ($1).%1$I is distinct from ($2).%1$I
                       then jsonb_build_object(%2$L, jsonb_build_object(
                              'old', to_jsonb(left(($1).%1$I::text, 500)),
                              'new', to_jsonb(left(($2).%1$I::text, 500))))
                       else '{}'::jsonb end$f$, a.attname, a.attname), ' || ')
      into v_diff_sql
      from pg_attribute a
     where a.attrelid = TG_RELID
       and a.attnum > 0
       and not a.attisdropped
       -- `updated_at` يتغيّر في كل تعديل فيصبح ضجيجًا في كل سطر
       and a.attname <> 'updated_at'
       -- أعمدة jsonb/json والمصفوفات تُستثنى من المقارنة.
       --
       -- `exam_data` و`form_data` و`csr_config` تبلغ ميجابايتات، ومقارنتها
       -- تفكّ ضغط (detoast) القيمتين القديمة والجديدة كاملتين حتى حين لا
       -- تتغيّران. القياس على 200 صف بـ exam_data بحجم 2MB: 2.4ms بلا مُحفِّز،
       -- و1020ms مع مقارنة الصف كاملًا كـ jsonb.
       and a.atttypid not in ('jsonb'::regtype, 'json'::regtype)
       and a.attndims = 0;

    if v_diff_sql is not null then
      execute 'select ' || v_diff_sql into v_details using OLD, NEW;
      if v_details = '{}'::jsonb then v_details := null; end if;
    end if;

    -- تعديل لم يغيّر شيئًا لا يُسجَّل.
    --
    -- مُحفِّزات قائمة تُصدر تحديثات لا تغيّر شيئًا: `app_recalc_prescription_status`
    -- يكتب `else status` (إعادة كتابة مضمونة بلا تغيير)، و
    -- `app_recalc_agreement_invoiced_amount` يضبط `updated_at` وحده. فصرف وصفة
    -- من عشرة بنود كان يُنتج عشرة أسطر تدقيق فارغة — ضجيج يدفن التعديل الحقيقي.
    if v_details is null then
      return NEW;
    end if;
  end if;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, device_name)
  values (
    v_org,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_entity,
    v_title,
    -- `audit_log.details` من نوع text لا jsonb (0001) — التحويل صريح حتى لا
    -- يعتمد الإدراج على تحويل ضمني قد يختلف سلوكه بين إصدارات PostgreSQL.
    v_details::text,
    app_request_device_name()
  );

  return coalesce(NEW, OLD);
end;
$$;
