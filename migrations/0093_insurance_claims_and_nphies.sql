-- ---------------------------------------------------------------------------
-- 0093 — التأمين والمطالبات وطبقة NPHIES
-- ---------------------------------------------------------------------------
-- المرحلة الثالثة عشرة. تعتمد على 0091 و0092: المطالبة تُبنى على خدمات
-- سريرية منفَّذة وفاتورة محسوبة نهائيًّا.
--
-- **الحصر أوّلًا:** 0089 بنى الأساس — `insurance_contracts` و
-- `insurance_coverage_rules` و`insurance_networks`، و`app_insurance_coverage`
-- و`app_active_preauthorization` و`app_set_claim_form_status` و
-- `app_resubmit_claim_form`، وسقوف مستهلَكة في `v_membership_limit_usage`.
--
-- فهذه الهجرة **تُكمل** ما بقي، ولا تعيد بناء ما بُني:
--
--   1) **الأهلية لحظية لا تاريخية.** `app_insurance_coverage` تحسب التغطية
--      وتُعيدها، ولا تحفظ شيئًا. فإذا نازعت الشركة بعد شهر: «لم يكن مؤهَّلًا
--      يوم الخدمة» — لا دليل. الأهلية تُحفَظ بنتيجتها ووقتها.
--   2) **الموافقة بحالات أربع فقط.** `pending/approved/rejected/expired` بلا
--      «جاهزة للإرسال» ولا «قيد المراجعة» ولا «موافقة جزئية» — والجزئية هي
--      أكثر ردود الشركات شيوعًا.
--   3) **لا مطالبة من الزيارة.** `insurance_claim_forms` تُملأ يدويًّا بندًا
--      بندًا؛ فما نسيه الموظف لا يُطالَب به.
--   4) **الرفض على مستوى المطالبة لا البند.** الشركة ترفض بندًا وتقبل ثلاثة،
--      والنظام يعرف «مرفوضة» أو «مقبولة» فقط.
--   5) **لا تسويات.** لا سبيل لتسجيل دفعة شركة تأمين ومطابقتها بمطالبات، ولا
--      لمعرفة الفرق بين المطالَب به والمحصَّل.
--   6) **لا طبقة نقل.** حقول نفيس في 0089 بيانات مسطَّحة على المطالبة، بلا
--      رسالة ولا محاولة ولا استجابة ولا فصل بين منطقنا وبروتوكولهم.
--
-- **لا مفاتيح ربط ولا إرسال حقيقيّ هنا.** الجدول يخزّن الرسائل ويستقبل
-- نتائجها؛ ومن يرسل فعلًا هو خدمة خلفية محميّة، لا المتصفّح ولا هذه الهجرة.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الأهلية محفوظة تاريخيًّا
-- ===========================================================================

create table if not exists insurance_eligibility_checks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  patient_id        uuid not null references patients(id),
  membership_id     uuid references patient_insurance_memberships(id),
  contract_id       uuid references insurance_contracts(id),
  visit_id          uuid references patient_visits(id),
  item_id           uuid references items(id),
  checked_at        timestamptz not null default now(),
  checked_by        uuid references auth.users(id),
  source            text not null default 'internal'
                      check (source in ('internal','nphies','manual','payer_portal')),
  is_eligible       boolean not null,
  coverage_result   jsonb not null,
  copay_percent     numeric,
  patient_share     numeric,
  insurer_share     numeric,
  annual_remaining  numeric,
  requires_preauth  boolean not null default false,
  blocks            jsonb,
  warnings          jsonb,
  reference_number  text,
  valid_until       timestamptz,
  created_at        timestamptz not null default now()
);

comment on table insurance_eligibility_checks is
  'نتيجة التحقّق من الأهلية **محفوظة بوقتها**. الحساب اللحظي لا يصلح دليلًا حين تنازع الشركة بعد شهر: «لم يكن مؤهَّلًا يوم الخدمة».';

create index if not exists idx_eligibility_lookup
  on insurance_eligibility_checks (organization_id, patient_id, checked_at desc);
create index if not exists idx_eligibility_visit
  on insurance_eligibility_checks (visit_id) where visit_id is not null;

alter table insurance_eligibility_checks enable row level security;

/**
 * التحقّق من الأهلية — يحسب **ويحفظ**.
 *
 * يبني على `app_insurance_coverage` (0089) ولا يكرّر منطقها. الجديد أن
 * النتيجة تُخزَّن بوقتها ومرجعها، فتصير سجلًّا يُحتجّ به.
 */
create or replace function app_check_insurance_eligibility(
  p_membership_id uuid,
  p_item_id       uuid default null,
  p_visit_id      uuid default null,
  p_amount        numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m    patient_insurance_memberships%rowtype;
  v_cov  jsonb;
  v_id   uuid;
  v_item uuid;
begin
  select * into v_m from patient_insurance_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'العضوية التأمينية غير موجودة'; end if;
  if not app_has_permission(v_m.organization_id, 'insurance.view') then
    raise exception 'صلاحيتك لا تسمح بالتحقّق من الأهلية (insurance.view)';
  end if;

  -- بلا خدمة محدّدة نفحص أهلية العضوية نفسها بأيّ صنف استشارة متاح؛ وإن لم
  -- يوجد فالفحص على العضوية وحدها.
  v_item := coalesce(p_item_id, (
    select i.id from items i
     where i.organization_id = v_m.organization_id
       and i.item_type = 'service' and not i.is_archived
     order by case when i.medical_service_type = 'consultation' then 0 else 1 end
     limit 1));

  if v_item is null then
    raise exception 'لا خدمة في الكتالوج للتحقّق بها — أضف خدمة واحدة على الأقل';
  end if;

  v_cov := app_insurance_coverage(p_membership_id, v_item, p_amount);

  insert into insurance_eligibility_checks (
    organization_id, patient_id, membership_id, contract_id, visit_id, item_id,
    checked_by, source, is_eligible, coverage_result,
    copay_percent, patient_share, insurer_share, annual_remaining,
    requires_preauth, blocks, warnings, valid_until)
  values (
    v_m.organization_id, v_m.patient_id, p_membership_id,
    nullif(v_cov->>'contract_id', '')::uuid, p_visit_id, p_item_id,
    auth.uid(), 'internal',
    coalesce((v_cov->>'ok')::boolean, false), v_cov,
    (v_cov->>'copay_percent')::numeric, (v_cov->>'patient_share')::numeric,
    (v_cov->>'insurer_share')::numeric, (v_cov->>'annual_remaining')::numeric,
    coalesce((v_cov->>'requires_preauth')::boolean, false),
    v_cov->'blocks', v_cov->'warnings',
    -- الأهلية تُعاد قراءتها كل يوم: العضوية قد تُلغى بين موعدٍ وموعد.
    now() + interval '1 day')
  returning id into v_id;

  return v_id;
end;
$$;

-- ===========================================================================
-- 2) الموافقات المسبقة: دورة كاملة
-- ===========================================================================

alter table insurance_preauthorizations
  add column if not exists diagnoses          jsonb,
  add column if not exists justification      text,
  add column if not exists attachments        jsonb,
  add column if not exists approved_qty       numeric,
  add column if not exists submitted_at       timestamptz,
  add column if not exists submitted_by       uuid references auth.users(id),
  add column if not exists payer_reference    text,
  add column if not exists eligibility_check_id uuid references insurance_eligibility_checks(id);

do $$
begin
  alter table insurance_preauthorizations drop constraint if exists insurance_preauthorizations_status_check;
  -- **`pending` تبقى مقبولة.** هي القيمة الافتراضية للعمود منذ 0016، وشاشات
  -- ومسارات قائمة تُدرج بها. حذفها من القائمة كسر دليلين من الأدلّة السابقة
  -- فورًا، وهذا هو ما ردّها. تُعامَل معاملة `submitted`: طلبٌ أُرسل ولم يُردّ.
  alter table insurance_preauthorizations add constraint insurance_preauthorizations_status_check check (
    status in ('draft','ready','pending','submitted','in_review','approved',
               'partially_approved','rejected','expired','cancelled')
  );
end $$;

-- والافتراض الجديد `draft`: الطلب يُبنى ثم يُرسل، ولا يولد مُرسَلًا.
alter table insurance_preauthorizations alter column status set default 'draft';

create or replace function app_preauth_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'      then p_to in ('ready','cancelled')
    when 'ready'      then p_to in ('submitted','draft','cancelled')
    when 'submitted'  then p_to in ('in_review','approved','partially_approved','rejected','cancelled')
    when 'in_review'  then p_to in ('approved','partially_approved','rejected','cancelled')
    when 'approved'   then p_to in ('expired','cancelled')
    when 'partially_approved' then p_to in ('expired','cancelled')
    when 'pending'    then p_to in ('approved','partially_approved','rejected','expired','cancelled')
    else false   -- rejected و expired و cancelled نهائية
  end;
$$;

-- الصفوف القائمة على `pending` تبقى كما هي: ترحيلها يغيّر تاريخًا لم يُوثَّق،
-- وخريطة الانتقالات تعرف كيف تخرج منها.

-- **تُسقَط نسخة 0089 أوّلًا.** إضافة معامل جديد تُنشئ تحميلًا زائدًا لا
-- تستبدل الدالة، فيصير النداء بستّة معاملات غامضًا بين نسختين — وهو خطأ
-- تشغيليّ يظهر عند أوّل استدعاء من الواجهة لا في الهجرة.
drop function if exists app_set_preauth_status(uuid, text, text, numeric, text, date);

-- الموافقة الجزئية تحمل الكمية والمبلغ المعتمدَين.
create or replace function app_set_preauth_status(
  p_preauth_id uuid,
  p_status     text,
  p_reason     text default null,
  p_amount     numeric default null,
  p_approval_number text default null,
  p_valid_to   date default null,
  p_qty        numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pa insurance_preauthorizations%rowtype;
begin
  select * into v_pa from insurance_preauthorizations where id = p_preauth_id for update;
  if v_pa.id is null then raise exception 'الموافقة غير موجودة'; end if;
  if not app_has_permission(v_pa.organization_id, 'insurance.preauth') then
    raise exception 'صلاحيتك لا تسمح بإدارة الموافقات المسبقة (insurance.preauth)';
  end if;
  if v_pa.status = p_status then return; end if;
  if not app_preauth_status_allowed(v_pa.status, p_status) then
    raise exception 'لا يمكن الانتقال بالموافقة من «%» إلى «%»', v_pa.status, p_status;
  end if;

  if p_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'الرفض يحتاج سببًا مكتوبًا';
  end if;
  if p_status in ('approved','partially_approved')
     and coalesce(btrim(p_approval_number), '') = '' then
    raise exception 'الاعتماد يحتاج رقم موافقة من شركة التأمين';
  end if;
  if p_status = 'partially_approved' and p_amount is null and p_qty is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ أو الكمية المعتمدة';
  end if;
  if p_status = 'ready' and coalesce(btrim(v_pa.justification), '') = '' then
    raise exception 'الإرسال يحتاج مبرّرًا طبيًّا مكتوبًا';
  end if;

  update insurance_preauthorizations set
    status           = p_status,
    submitted_at     = case when p_status = 'submitted' then now() else submitted_at end,
    submitted_by     = case when p_status = 'submitted' then auth.uid() else submitted_by end,
    responded_at     = case when p_status in ('approved','partially_approved','rejected')
                            then now() else responded_at end,
    approval_number  = case when p_status in ('approved','partially_approved')
                            then btrim(p_approval_number) else approval_number end,
    approved_amount  = case when p_status = 'approved' then coalesce(p_amount, requested_amount)
                            when p_status = 'partially_approved' then p_amount
                            else approved_amount end,
    approved_qty     = case when p_status = 'approved' then coalesce(p_qty, qty)
                            when p_status = 'partially_approved' then p_qty
                            else approved_qty end,
    valid_from       = case when p_status in ('approved','partially_approved')
                            then coalesce(valid_from, current_date) else valid_from end,
    valid_to         = case when p_status in ('approved','partially_approved')
                            then coalesce(p_valid_to, valid_to, current_date + 90) else valid_to end,
    rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else rejection_reason end,
    updated_at       = now(),
    updated_by       = auth.uid()
  where id = p_preauth_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pa.organization_id, auth.uid(), 'insurance', 'update', p_preauth_id,
          'موافقة مسبقة', format('%s ← %s', v_pa.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- `app_active_preauthorization` تشمل الجزئية أيضًا: موافقةٌ على بعض الكمية
-- موافقةٌ سارية على ذلك البعض.
create or replace function app_active_preauthorization(
  p_patient_id uuid,
  p_item_id    uuid,
  p_as_of      date default current_date
)
returns insurance_preauthorizations
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
    from insurance_preauthorizations p
   where p.patient_id = p_patient_id
     and p.item_id    = p_item_id
     and p.status in ('approved','partially_approved')
     and p.consumed_at is null
     and coalesce(p.valid_from, p.responded_at::date, p.requested_at::date) <= p_as_of
     and coalesce(p.valid_to,
                  coalesce(p.responded_at, p.requested_at)::date + 90) >= p_as_of
     and app_is_member(p.organization_id)
   order by coalesce(p.responded_at, p.requested_at) desc
   limit 1;
$$;

-- ===========================================================================
-- 3) المطالبة: بنودها ورفضها على مستوى البند
-- ===========================================================================

alter table insurance_claim_form_items
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists visit_service_id uuid references patient_visit_services(id),
  add column if not exists invoice_item_id  uuid references sales_invoice_items(id),
  add column if not exists icd10_code_id    uuid,
  add column if not exists claimed_amount   numeric,
  add column if not exists approved_amount  numeric,
  add column if not exists rejected_amount  numeric,
  add column if not exists rejection_code   text,
  add column if not exists rejection_reason text,
  add column if not exists preauthorization_id uuid references insurance_preauthorizations(id),
  add column if not exists status           text not null default 'claimed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_item_status_check') then
    alter table insurance_claim_form_items add constraint claim_item_status_check check (
      status in ('claimed','approved','partially_approved','rejected','resubmitted')
    );
  end if;
end $$;

update insurance_claim_form_items li
   set organization_id = coalesce(li.organization_id, f.organization_id),
       claimed_amount  = coalesce(li.claimed_amount, li.amount)
  from insurance_claim_forms f
 where f.id = li.form_id and li.organization_id is null;

create index if not exists idx_claim_items_form on insurance_claim_form_items (form_id);

alter table insurance_claim_forms
  add column if not exists visit_id            uuid references patient_visits(id),
  add column if not exists contract_id         uuid references insurance_contracts(id),
  add column if not exists eligibility_check_id uuid references insurance_eligibility_checks(id),
  add column if not exists diagnoses           jsonb,
  add column if not exists validation_errors   jsonb,
  add column if not exists settled_amount      numeric not null default 0,
  add column if not exists version_number      integer not null default 1;

do $$
begin
  alter table insurance_claim_forms drop constraint if exists insurance_claim_forms_status_check;
  alter table insurance_claim_forms add constraint insurance_claim_forms_status_check check (
    status in ('draft','validation_failed','ready','submitted','acknowledged','in_review',
               'approved','partially_approved','rejected','resubmitted','settled','paid','cancelled')
  );
end $$;

create or replace function app_claim_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    -- `draft → submitted` مباشرةً مسموح أيضًا: `ready` خطوةٌ لمن يفصل التجهيز
    -- عن الإرسال، لا ضريبةٌ على من يفعلهما معًا. وحذفها كسر دليل المرحلة ٩.
    when 'draft'              then p_to in ('ready','submitted','validation_failed','cancelled')
    when 'validation_failed'  then p_to in ('draft','ready','cancelled')
    when 'ready'              then p_to in ('submitted','draft','cancelled')
    when 'submitted'          then p_to in ('acknowledged','in_review','approved',
                                            'partially_approved','rejected','cancelled')
    when 'acknowledged'       then p_to in ('in_review','approved','partially_approved','rejected')
    when 'in_review'          then p_to in ('approved','partially_approved','rejected')
    when 'approved'           then p_to in ('settled','paid','rejected')
    when 'partially_approved' then p_to in ('settled','paid','resubmitted','rejected')
    when 'rejected'           then p_to in ('resubmitted','cancelled')
    when 'settled'            then p_to in ('paid')
    else false   -- paid و resubmitted و cancelled نهائية
  end;
$$;

/**
 * إنشاء المطالبة من الزيارة.
 *
 * يجمع التشخيصات والخدمات المفوترة، ويربط أكواد المطالبات، ويتحقّق من
 * الموافقات، ويحسب حصّتَي المريض والشركة من الفاتورة نفسها لا من حسابٍ ثانٍ،
 * ويكشف الناقص بدل أن يُرسل مطالبة تُرفض شكلًا.
 *
 * ويمنع التكرار: زيارةٌ لها مطالبة حيّة لا تُطالَب بها مرّتين.
 */
create or replace function app_create_claim_from_visit(
  p_visit_id   uuid,
  p_invoice_id uuid default null,
  p_form_type  text default 'ucaf'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit   patient_visits%rowtype;
  v_inv     sales_invoices%rowtype;
  v_member  patient_insurance_memberships%rowtype;
  v_contract insurance_contracts%rowtype;
  v_company uuid;
  v_form    uuid;
  v_elig    uuid;
  v_line    record;
  v_errors  jsonb := '[]'::jsonb;
  v_diag    jsonb;
  v_total   numeric := 0;
  v_n       int := 0;
  v_pa      insurance_preauthorizations%rowtype;
  v_code    text;
begin
  select * into v_visit from patient_visits where id = p_visit_id for update;
  if v_visit.id is null then raise exception 'الزيارة غير موجودة'; end if;
  if not app_has_permission(v_visit.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإنشاء المطالبات (insurance.claims)';
  end if;

  -- **لا مطالبة مكرّرة.**
  if exists (select 1 from insurance_claim_forms f
              where f.visit_id = p_visit_id
                and f.status not in ('cancelled','rejected','resubmitted')) then
    raise exception 'للزيارة مطالبة قائمة — ألغِها أو أعد تقديمها بدل إنشاء ثانية';
  end if;

  -- الفاتورة
  if p_invoice_id is not null then
    select * into v_inv from sales_invoices where id = p_invoice_id;
  else
    select * into v_inv from sales_invoices
     where visit_id = p_visit_id and status <> 'void'
       and document_type not in ('credit_note','debit_note')
     order by created_at desc limit 1;
  end if;
  if v_inv.id is null then
    raise exception 'لا فاتورة لهذه الزيارة — المطالبة تُبنى على فاتورة محسوبة';
  end if;
  if v_inv.issued_at is null then
    raise exception 'الفاتورة مسوّدة — أصدرها قبل المطالبة';
  end if;

  -- العضوية والعقد
  select * into v_member from patient_insurance_memberships
   where patient_id = v_visit.patient_id and is_active
     and (expiry_date is null or expiry_date >= current_date)
   order by created_at desc limit 1;
  if v_member.id is null then
    raise exception 'لا عضوية تأمينية سارية لهذا المريض';
  end if;
  select company_id into v_company from insurance_policies where id = v_member.policy_id;
  v_contract := app_active_insurance_contract(v_visit.organization_id, v_company, current_date);

  -- الأهلية تُحفَظ مع المطالبة
  v_elig := app_check_insurance_eligibility(v_member.id, null, p_visit_id, null);

  -- التشخيصات
  select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name_ar))
    into v_diag
    from patient_visit_diagnoses d
    join icd10_codes c on c.id = d.icd10_code_id
   where d.visit_id = p_visit_id;

  if v_diag is null then
    v_errors := v_errors || jsonb_build_object(
      'field', 'diagnoses', 'message', 'لا تشخيص مسجَّل على الزيارة — المطالبة بلا تشخيص تُرفض');
  end if;
  if v_contract.id is null then
    v_errors := v_errors || jsonb_build_object(
      'field', 'contract', 'message', 'لا عقد ساري مع شركة التأمين');
  end if;

  insert into insurance_claim_forms (
    organization_id, form_type, patient_id, doctor_id, clinic_id, membership_id,
    sales_invoice_id, visit_id, contract_id, eligibility_check_id, status,
    diagnoses, form_data, auto_created, created_by)
  values (
    v_visit.organization_id, p_form_type, v_visit.patient_id, v_visit.doctor_id,
    v_visit.clinic_id, v_member.id, v_inv.id, p_visit_id, v_contract.id, v_elig,
    'draft', v_diag, '{}'::jsonb, false, auth.uid())
  returning id into v_form;

  -- البنود من الفاتورة: ما له حصّة تأمين
  for v_line in
    select li.*, i.name_ar
      from sales_invoice_items li
      left join items i on i.id = li.item_id
     where li.invoice_id = v_inv.id
       and coalesce(li.insurer_share, 0) > 0
  loop
    v_code := app_item_claim_code(v_line.item_id, v_company);

    if v_code is null then
      v_errors := v_errors || jsonb_build_object(
        'field', 'service_code', 'item', coalesce(v_line.item_name_snapshot, v_line.name_ar),
        'message', 'لا كود مطالبة لهذه الخدمة لدى الشركة');
    end if;

    -- **الموافقة تُقرأ من سطر الفاتورة أوّلًا.** 0090 يستهلك الموافقة لحظة
    -- الفوترة ويختم معرّفها على السطر؛ فالبحث عن «موافقة سارية» هنا لا يجد
    -- شيئًا — وقد استُعملت فعلًا. المطالبة تستشهد بالموافقة التي بُنيت عليها
    -- الفاتورة، لا بأخرى ما زالت مفتوحة.
    if v_line.preauthorization_id is not null then
      select * into v_pa from insurance_preauthorizations where id = v_line.preauthorization_id;
    else
      v_pa := app_active_preauthorization(v_visit.patient_id, v_line.item_id, current_date);
    end if;

    insert into insurance_claim_form_items (
      organization_id, form_id, item_id, service_code, description, qty, amount,
      invoice_item_id, visit_service_id, claimed_amount, preauthorization_id, status)
    values (
      v_visit.organization_id, v_form, v_line.item_id, v_code,
      coalesce(v_line.item_name_snapshot, v_line.name_ar), v_line.qty,
      v_line.insurer_share, v_line.id, v_line.visit_service_id,
      v_line.insurer_share, v_pa.id, 'claimed');

    v_total := v_total + coalesce(v_line.insurer_share, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'لا بند في الفاتورة عليه حصّة تأمين';
  end if;

  update insurance_claim_forms set
    claimed_amount    = v_total,
    validation_errors = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
    status            = case when jsonb_array_length(v_errors) > 0
                             then 'validation_failed' else 'draft' end,
    membership_snapshot = jsonb_build_object(
      'membership_number', v_member.membership_number,
      'policy_id',         v_member.policy_id,
      'expiry_date',       v_member.expiry_date,
      'copay_percent',     v_member.copay_percent_override),
    updated_at = now()
  where id = v_form;

  -- خدمات الزيارة تُعلَّم مُطالَبًا بها
  update patient_visit_services s
     set status = 'claimed', status_changed_at = now(), status_changed_by = auth.uid()
    from insurance_claim_form_items ci
   where ci.form_id = v_form and ci.visit_service_id = s.id and s.status in ('invoiced','paid');

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_visit.organization_id, auth.uid(), 'insurance', 'add', v_form,
          'مطالبة تأمين',
          format('أُنشئت من زيارة بـ%s بندًا، المطالَب %s%s', v_n, v_total,
                 case when jsonb_array_length(v_errors) > 0
                      then format(' — %s ملاحظة تحقّق', jsonb_array_length(v_errors))
                      else '' end));

  return v_form;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.1) الردّ على مستوى البند
-- ---------------------------------------------------------------------------
create or replace function app_record_claim_item_response(
  p_item_id  uuid,
  p_status   text,
  p_approved numeric default null,
  p_code     text default null,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_it insurance_claim_form_items%rowtype;
  v_f  insurance_claim_forms%rowtype;
  v_app numeric;
  v_rej numeric;
  v_all_rejected boolean;
  v_any_rejected boolean;
begin
  select * into v_it from insurance_claim_form_items where id = p_item_id for update;
  if v_it.id is null then raise exception 'بند المطالبة غير موجود'; end if;
  select * into v_f from insurance_claim_forms where id = v_it.form_id for update;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الردّ (insurance.claims)';
  end if;
  if p_status not in ('approved','partially_approved','rejected') then
    raise exception 'حالة غير مقبولة للبند: %', p_status;
  end if;
  -- **الرفض بلا كود ولا سبب لا يُبنى عليه اعتراض.** وهذا هو الفرق بين
  -- مطالبة تُستعاد وأخرى تُشطب.
  if p_status in ('rejected','partially_approved')
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'الرفض أو الاعتماد الجزئي يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'partially_approved' and p_approved is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ المعتمَد';
  end if;
  if coalesce(p_approved, 0) > coalesce(v_it.claimed_amount, 0) + 0.001 then
    raise exception 'المعتمَد % يتجاوز المطالَب به %', p_approved, v_it.claimed_amount;
  end if;

  v_app := case p_status when 'approved' then coalesce(p_approved, v_it.claimed_amount)
                         when 'partially_approved' then p_approved
                         else 0 end;
  v_rej := greatest(coalesce(v_it.claimed_amount, 0) - v_app, 0);

  update insurance_claim_form_items set
    status           = p_status,
    approved_amount  = v_app,
    rejected_amount  = v_rej,
    rejection_code   = nullif(btrim(coalesce(p_code, '')), ''),
    rejection_reason = case when p_status = 'approved' then null else btrim(p_reason) end
  where id = p_item_id;

  -- حالة المطالبة تُشتقّ من بنودها لا تُكتب يدويًّا
  select bool_and(status = 'rejected'), bool_or(status in ('rejected','partially_approved'))
    into v_all_rejected, v_any_rejected
    from insurance_claim_form_items where form_id = v_f.id;

  if not exists (select 1 from insurance_claim_form_items
                  where form_id = v_f.id and status = 'claimed') then
    update insurance_claim_forms set
      approved_amount = (select coalesce(sum(approved_amount), 0)
                           from insurance_claim_form_items where form_id = v_f.id),
      rejected_amount = (select coalesce(sum(rejected_amount), 0)
                           from insurance_claim_form_items where form_id = v_f.id),
      status = case when v_all_rejected then 'rejected'
                    when v_any_rejected then 'partially_approved'
                    else 'approved' end,
      responded_at = now(),
      updated_at = now()
    where id = v_f.id
      and app_claim_status_allowed(v_f.status,
            case when v_all_rejected then 'rejected'
                 when v_any_rejected then 'partially_approved'
                 else 'approved' end);
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'update', v_f.id,
          'بند مطالبة', format('%s: معتمَد %s ومرفوض %s', p_status, v_app, v_rej),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- ===========================================================================
-- 4) التسويات المالية
-- ===========================================================================

create table if not exists insurance_settlements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  company_id       uuid not null references insurance_companies(id),
  contract_id      uuid references insurance_contracts(id),
  settlement_number bigint,
  settlement_date  date not null default current_date,
  reference_number text,
  total_claimed    numeric not null default 0,
  total_approved   numeric not null default 0,
  total_rejected   numeric not null default 0,
  total_paid       numeric not null default 0,
  payment_voucher_id uuid references financial_vouchers(id),
  status           text not null default 'draft'
                     check (status in ('draft','matched','paid','closed')),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

comment on table insurance_settlements is
  'تسوية دفعة شركة تأمين مع مطالبة أو عدّة مطالبات. بلا تسوية لا يُعرف الفرق بين المطالَب به والمحصَّل.';

create table if not exists insurance_settlement_claims (
  id             uuid primary key default gen_random_uuid(),
  settlement_id  uuid not null references insurance_settlements(id) on delete cascade,
  claim_form_id  uuid not null references insurance_claim_forms(id),
  claimed_amount numeric not null default 0,
  approved_amount numeric not null default 0,
  paid_amount    numeric not null default 0,
  variance_amount numeric generated always as (paid_amount - approved_amount) stored,
  note           text,
  created_at     timestamptz not null default now()
);

create unique index if not exists uq_settlement_claim
  on insurance_settlement_claims (settlement_id, claim_form_id);

alter table insurance_settlements enable row level security;
alter table insurance_settlement_claims enable row level security;

/**
 * تسجيل دفعة شركة التأمين ومطابقتها.
 *
 * **لا تحوّل المرفوض إلى المريض تلقائيًّا.** ذلك قرار سياسة لا حساب: بعض
 * الرفض خطأ ترميز يُصحَّح ويُعاد تقديمه، وتحميله على المريض فورًا يخسره
 * ويخسر حقّ المنشأة معًا. تبقى المبالغ المرفوضة ظاهرة في `v_claim_settlement`
 * لقرارٍ بشريّ.
 */
create or replace function app_settle_insurance_claims(
  p_company_id uuid,
  p_claims     uuid[],
  p_paid_total numeric,
  p_reference  text default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_id       uuid;
  v_claim    uuid;
  v_f        insurance_claim_forms%rowtype;
  v_claimed  numeric := 0;
  v_approved numeric := 0;
  v_rejected numeric := 0;
  v_share    numeric;
  v_n        bigint;
begin
  select organization_id into v_org from insurance_companies where id = p_company_id;
  if v_org is null then raise exception 'شركة التأمين غير موجودة'; end if;
  if not app_has_permission(v_org, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بالتسويات (insurance.claims)';
  end if;
  if p_claims is null or array_length(p_claims, 1) is null then
    raise exception 'حدّد مطالبة واحدة على الأقل';
  end if;
  if coalesce(p_paid_total, 0) <= 0 then
    raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر';
  end if;

  select coalesce(max(settlement_number), 0) + 1 into v_n
    from insurance_settlements where organization_id = v_org;

  insert into insurance_settlements (
    organization_id, company_id, settlement_number, reference_number,
    total_paid, status, note, created_by)
  values (v_org, p_company_id, v_n, nullif(btrim(p_reference), ''),
          p_paid_total, 'matched', nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  foreach v_claim in array p_claims loop
    select * into v_f from insurance_claim_forms where id = v_claim for update;
    if v_f.id is null then raise exception 'المطالبة % غير موجودة', v_claim; end if;
    if v_f.organization_id <> v_org then
      raise exception 'المطالبة تتبع منشأة أخرى';
    end if;
    if v_f.status not in ('approved','partially_approved','settled') then
      raise exception 'المطالبة % — تُسوّى المعتمَدة كليًّا أو جزئيًّا فقط', v_f.status;
    end if;

    v_claimed  := v_claimed + coalesce(v_f.claimed_amount, 0);
    v_approved := v_approved + coalesce(v_f.approved_amount, 0);
    v_rejected := v_rejected + coalesce(v_f.rejected_amount, 0);

    insert into insurance_settlement_claims (
      settlement_id, claim_form_id, claimed_amount, approved_amount)
    values (v_id, v_claim, coalesce(v_f.claimed_amount, 0), coalesce(v_f.approved_amount, 0));
  end loop;

  -- توزيع المدفوع على المطالبات بنسبة المعتمَد لكل منها
  for v_claim in select claim_form_id from insurance_settlement_claims where settlement_id = v_id
  loop
    select approved_amount into v_share from insurance_settlement_claims
     where settlement_id = v_id and claim_form_id = v_claim;
    update insurance_settlement_claims
       set paid_amount = case when v_approved > 0
                              then round(p_paid_total * v_share / v_approved, 2) else 0 end
     where settlement_id = v_id and claim_form_id = v_claim;

    update insurance_claim_forms
       set settled_amount = (select paid_amount from insurance_settlement_claims
                              where settlement_id = v_id and claim_form_id = v_claim),
           status = case when app_claim_status_allowed(status, 'settled') then 'settled'
                         else status end,
           updated_at = now()
     where id = v_claim;
  end loop;

  update insurance_settlements
     set total_claimed = v_claimed, total_approved = v_approved, total_rejected = v_rejected,
         updated_at = now()
   where id = v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_org, auth.uid(), 'insurance', 'add', v_id, 'تسوية تأمين',
          format('تسوية %s: مطالَب %s، معتمَد %s، مدفوع %s',
                 v_n, v_claimed, v_approved, p_paid_total));

  return v_id;
end;
$$;

-- ===========================================================================
-- 5) طبقة NPHIES — رسائل بلا إرسال
-- ===========================================================================

create table if not exists nphies_messages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  message_type      text not null
                      check (message_type in ('eligibility','preauthorization','claim',
                                              'claim_response','payment_notice','poll','cancel')),
  direction         text not null default 'outbound'
                      check (direction in ('outbound','inbound')),
  environment       text not null default 'sandbox'
                      check (environment in ('sandbox','production')),
  status            text not null default 'queued'
                      check (status in ('queued','sending','sent','acknowledged',
                                        'completed','failed','cancelled')),
  request_id        text,
  response_id       text,
  correlation_id    uuid,
  eligibility_check_id uuid references insurance_eligibility_checks(id),
  preauthorization_id  uuid references insurance_preauthorizations(id),
  claim_form_id        uuid references insurance_claim_forms(id),
  request_payload   jsonb,
  response_payload  jsonb,
  errors            jsonb,
  attempt_count     integer not null default 0,
  last_attempt_at   timestamptz,
  sent_at           timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

comment on table nphies_messages is
  'طبقة النقل مع نفيس: نوع الرسالة ومعرّفاها والمحاولات والاستجابة. **مفصولة عن منطق النظام** — المنطق في جداول التأمين، والبروتوكول هنا. لا مفاتيح ربط في هذا الجدول، ولا إرسال من المتصفّح: من يرسل خدمة خلفية محميّة.';

create index if not exists idx_nphies_pending
  on nphies_messages (organization_id, status, created_at)
  where status in ('queued','sending','failed');
create index if not exists idx_nphies_claim on nphies_messages (claim_form_id)
  where claim_form_id is not null;

-- **منع التكرار**: رسالةٌ واحدة حيّة لكل مرجع ونوع. بلا هذا تُرسل المطالبة
-- مرّتين عند أوّل بطء في الشبكة، فتُفتح مطالبتان لخدمة واحدة.
create unique index if not exists uq_nphies_live_message
  on nphies_messages (message_type, coalesce(claim_form_id, preauthorization_id,
                                             eligibility_check_id))
  where status in ('queued','sending','sent') and direction = 'outbound';

alter table nphies_messages enable row level security;

create or replace function app_queue_nphies_message(
  p_organization_id uuid,
  p_message_type    text,
  p_payload         jsonb,
  p_claim_form_id   uuid default null,
  p_preauth_id      uuid default null,
  p_eligibility_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id         uuid;
  v_request_id text;
  v_company    insurance_companies%rowtype;
  v_member_id  uuid;
begin
  if not app_has_permission(p_organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإرسال رسائل نفيس (insurance.claims)';
  end if;
  if coalesce(p_claim_form_id, p_preauth_id, p_eligibility_id) is null then
    raise exception 'الرسالة يجب أن ترتبط بمطالبة أو موافقة أو أهلية';
  end if;

  -- **الدافع يُحسم قبل الإدراج، لا بعد الإرسال.**
  -- شركة غير مفعَّلة على نفيس أو بلا معرّف دافع تعني رسالةً سترتدّ من البوّابة
  -- بعد أن نكون قد وسمنا المطالبة "مُرسَلة". نمنعها هنا.
  select coalesce(cf.membership_id, pa.membership_id, el.membership_id)
    into v_member_id
    from (select 1) x
    left join insurance_claim_forms      cf on cf.id = p_claim_form_id
    left join insurance_preauthorizations pa on pa.id = p_preauth_id
    left join insurance_eligibility_checks el on el.id = p_eligibility_id;

  if v_member_id is not null then
    select c.* into v_company
      from patient_insurance_memberships m
      join insurance_policies p on p.id = m.policy_id
      join insurance_companies c on c.id = p.company_id
     where m.id = v_member_id;

    if v_company.id is not null then
      if coalesce(v_company.nphies_enabled, false) is not true then
        raise exception 'شركة % غير مفعَّلة على نفيس — فعّلها من بيانات الشركة أولًا',
          coalesce(v_company.name_ar, v_company.name_en, '؟');
      end if;
      if coalesce(nullif(trim(v_company.nphies_payer_id), ''), '') = '' then
        raise exception 'معرّف الدافع (Payer ID) غير مسجَّل للشركة % — لا يمكن تكوين الرسالة',
          coalesce(v_company.name_ar, v_company.name_en, '؟');
      end if;
    end if;
  end if;

  v_request_id := gen_random_uuid()::text;

  insert into nphies_messages (
    organization_id, message_type, request_payload,
    claim_form_id, preauthorization_id, eligibility_check_id,
    request_id, created_by)
  values (
    p_organization_id, p_message_type,
    -- معرّف الدافع جزء من الظرف لا من الأسرار؛ المفاتيح تبقى في الخدمة الخلفية
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object('payer_id', v_company.nphies_payer_id),
    p_claim_form_id, p_preauth_id, p_eligibility_id,
    v_request_id, auth.uid())
  returning id into v_id;

  -- الأعمدة القديمة على نموذج المطالبة تبقى مصدر العرض في شاشات المطالبات،
  -- فنكتب فيها بدل أن نتركها فارغة بجانب جدول الرسائل.
  if p_claim_form_id is not null then
    update insurance_claim_forms
       set nphies_request_id  = v_request_id,
           nphies_status      = 'queued',
           nphies_last_sync_at = now(),
           updated_at         = now()
     where id = p_claim_form_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'insurance', 'add', v_id,
          'رسالة نفيس', format('أُدرجت رسالة %s في الطابور', p_message_type));

  return v_id;
end;
$$;

create or replace function app_record_nphies_response(
  p_message_id uuid,
  p_status     text,
  p_response   jsonb default null,
  p_errors     jsonb default null,
  p_response_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m nphies_messages%rowtype;
begin
  select * into v_m from nphies_messages where id = p_message_id for update;
  if v_m.id is null then raise exception 'الرسالة غير موجودة'; end if;
  if not app_has_permission(v_m.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الاستجابة (insurance.claims)';
  end if;
  if p_status not in ('sending','sent','acknowledged','completed','failed','cancelled') then
    raise exception 'حالة غير معروفة: %', p_status;
  end if;

  update nphies_messages set
    status          = p_status,
    response_payload = coalesce(p_response, response_payload),
    errors          = coalesce(p_errors, errors),
    response_id     = coalesce(p_response_id, response_id),
    attempt_count   = case when p_status in ('sending','failed')
                           then attempt_count + 1 else attempt_count end,
    last_attempt_at = case when p_status in ('sending','failed') then now() else last_attempt_at end,
    sent_at         = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    responded_at    = case when p_status in ('acknowledged','completed','failed')
                           then now() else responded_at end,
    updated_at      = now()
  where id = p_message_id;

  -- ترجمة حالة النقل إلى حالة داخلية — الاتجاه الوحيد المسموح بين الطبقتين
  if v_m.claim_form_id is not null then
    -- حالة النقل ومهر آخر مزامنة يُكتبان دائمًا، حتى عند الفشل، ليعرف الموظف
    -- من الشاشة نفسها أين وقفت الرسالة بدل أن يفتح جدول الرسائل.
    update insurance_claim_forms
       set nphies_status       = p_status,
           nphies_last_sync_at = now(),
           updated_at          = now()
     where id = v_m.claim_form_id;

    if p_status = 'sent' then
      update insurance_claim_forms set status = 'submitted', submitted_at = coalesce(submitted_at, now())
       where id = v_m.claim_form_id and app_claim_status_allowed(status, 'submitted');
    elsif p_status = 'acknowledged' then
      update insurance_claim_forms set status = 'acknowledged'
       where id = v_m.claim_form_id and app_claim_status_allowed(status, 'acknowledged');
    end if;
  end if;
end;
$$;

-- ===========================================================================
-- 6) الأذونات وRLS
-- ===========================================================================
do $$
declare r record; pol record;
begin
  for r in
    select * from (values
      ('insurance_eligibility_checks', 'insurance.view', 'insurance.view'),
      ('insurance_settlements',        'insurance.view', 'insurance.claims'),
      ('nphies_messages',              'insurance.view', 'insurance.claims')
    ) as v(t, pv, pw)
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy if exists %I on %I', pol.policyname, r.t);
    end loop;
    execute format(
      'create policy %I on %I for select using (app_has_permission(organization_id, %L))',
      r.t || '_select', r.t, r.pv);
    execute format(
      'create policy %I on %I for insert with check (app_has_permission(organization_id, %L))',
      r.t || '_insert', r.t, r.pw);
    execute format(
      'create policy %I on %I for update using (app_has_permission(organization_id, %L))',
      r.t || '_update', r.t, r.pw);
  end loop;
end $$;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'insurance_settlement_claims'
  loop
    execute format('drop policy if exists %I on insurance_settlement_claims', pol.policyname);
  end loop;
  execute $p$create policy isc_select on insurance_settlement_claims for select
    using (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.view')))$p$;
  execute $p$create policy isc_write on insurance_settlement_claims for all
    using (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.claims')))
    with check (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.claims')))$p$;
end $$;

grant select, insert, update on
  insurance_eligibility_checks, insurance_settlements,
  insurance_settlement_claims, nphies_messages to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_check_insurance_eligibility','app_preauth_status_allowed',
                         'app_create_claim_from_visit','app_record_claim_item_response',
                         'app_settle_insurance_claims','app_queue_nphies_message',
                         'app_record_nphies_response')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================

create or replace view v_claim_settlement
with (security_invoker = on) as
select
  f.id as claim_form_id, f.organization_id, f.status,
  f.claimed_amount, f.approved_amount, f.rejected_amount, f.settled_amount,
  coalesce(f.approved_amount, 0) - coalesce(f.settled_amount, 0) as unsettled_amount,
  f.submitted_at, f.responded_at,
  case when f.submitted_at is not null and f.responded_at is not null
       then extract(day from f.responded_at - f.submitted_at)::int end as response_days,
  case when f.submitted_at is not null and f.responded_at is null
       then (current_date - f.submitted_at::date) end as days_pending,
  co.id as company_id, co.name_ar as company_name,
  p.name_ar as patient_name, p.file_number,
  d.name_ar as doctor_name,
  f.visit_id, f.sales_invoice_id,
  (select count(*) from insurance_claim_form_items ci
    where ci.form_id = f.id and ci.status = 'rejected')          as rejected_items,
  (select string_agg(distinct ci.rejection_code, '، ')
     from insurance_claim_form_items ci
    where ci.form_id = f.id and ci.rejection_code is not null)   as rejection_codes,
  f.validation_errors is not null                                as has_validation_errors
from insurance_claim_forms f
left join patient_insurance_memberships m on m.id = f.membership_id
left join insurance_policies pol on pol.id = m.policy_id
left join insurance_companies co on co.id = pol.company_id
left join patients p on p.id = f.patient_id
left join doctors d on d.id = f.doctor_id;

comment on view v_claim_settlement is
  'المطالبة من التقديم إلى التحصيل: المطالَب والمعتمَد والمرفوض والمسدَّد، ومدّة المعالجة، وأكواد الرفض.';

create or replace view v_insurance_receivables
with (security_invoker = on) as
select
  co.id as company_id, co.organization_id, co.name_ar as company_name,
  count(f.id)                                     as claim_count,
  sum(coalesce(f.claimed_amount, 0))              as total_claimed,
  sum(coalesce(f.approved_amount, 0))             as total_approved,
  sum(coalesce(f.rejected_amount, 0))             as total_rejected,
  sum(coalesce(f.settled_amount, 0))              as total_settled,
  sum(coalesce(f.approved_amount, 0) - coalesce(f.settled_amount, 0)) as outstanding,
  count(f.id) filter (where f.status = 'rejected')                    as rejected_claims,
  count(f.id) filter (where f.status = 'submitted'
                        and f.submitted_at < now() - interval '30 days') as stale_claims
from insurance_companies co
left join insurance_policies pol on pol.company_id = co.id
left join patient_insurance_memberships m on m.policy_id = pol.id
left join insurance_claim_forms f on f.membership_id = m.id
                                 and f.status not in ('draft','cancelled')
group by co.id, co.organization_id, co.name_ar;

comment on view v_insurance_receivables is
  'ذمم شركات التأمين: المطالَب والمعتمَد والمحصَّل والفرق، وما ركد أكثر من ثلاثين يومًا.';

drop view if exists v_nphies_queue;
create view v_nphies_queue
with (security_invoker = on) as
select
  n.id, n.organization_id, n.message_type, n.direction, n.status, n.environment,
  n.attempt_count, n.last_attempt_at, n.sent_at, n.responded_at, n.errors,
  n.claim_form_id, n.preauthorization_id, n.eligibility_check_id,
  n.request_id,
  cf.nphies_status       as claim_nphies_status,
  cf.nphies_last_sync_at as claim_nphies_last_sync_at,
  comp.name_ar           as payer_name,
  comp.nphies_payer_id   as payer_id,
  (n.status = 'failed' and n.attempt_count >= 3) as needs_manual_review,
  n.created_at
from nphies_messages n
left join insurance_claim_forms cf on cf.id = n.claim_form_id
left join patient_insurance_memberships m
       on m.id = coalesce(cf.membership_id,
                          (select pa.membership_id from insurance_preauthorizations pa
                            where pa.id = n.preauthorization_id),
                          (select el.membership_id from insurance_eligibility_checks el
                            where el.id = n.eligibility_check_id))
left join insurance_policies  pol  on pol.id = m.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

grant select on v_claim_settlement, v_insurance_receivables, v_nphies_queue to authenticated;

-- ===========================================================================
-- 8) فحص ذاتي
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_nphies_live_message') then
    raise exception 'منع تكرار رسائل نفيس غير مركَّب';
  end if;
  if exists (select 1 from nphies_messages where environment = 'production') then
    raise exception 'وُجدت رسالة ببيئة إنتاج — هذه الهجرة لا تُفعّل الإنتاج';
  end if;
  -- لا مفاتيح ولا أسرار في جداول التأمين
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'nphies_messages'
                and column_name in ('api_key','client_secret','certificate','private_key')) then
    raise exception 'أسرار الربط لا تُخزَّن في جدول الرسائل';
  end if;
end $$;
